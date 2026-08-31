// "Titulares de Turnos": los cuatro grupos del 4to turno.
//
// El 4to turno es un ciclo de cuatro dias (Largo, Noche, Libre, Libre), asi que
// hay exactamente cuatro fases y cada trabajador esta en una. Lo que se prueba
// aca es que el programa las reconozca solo mirando el calendario, que las
// letras no se muevan de un dia para otro, y que los colores salgan por
// estamento -y por profesion dentro de Profesional-.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

const noopEl = {
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.alert = () => {};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    COLUMN_LETTERS,
    buildColorAssignments,
    buildShiftHolders,
    cyclePositionAt,
    detectHolderPlacement,
    formatHolderStreak,
    holderColorKey,
    renderShiftHoldersPanel
} = await import("../js/shiftHolders.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const HOY = new Date(2026, 8, 10);   // 10 de septiembre de 2026

function keyFromDate(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function addDays(date, amount) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

/** Siembra la unidad: perfiles y su rotativa. */
function sembrar(workers) {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify(
        workers.map(worker => ({
            id: worker.name,
            name: worker.name,
            estamento: worker.estamento || "Técnico",
            profession: worker.profession || "Técnico en Enfermería",
            active: worker.active !== false
        }))
    ));

    workers.forEach(worker => {
        localStorage.setItem(`rotativa_${worker.name}`, JSON.stringify({
            type: worker.type || "4turno",
            start: worker.start || "2026-01-05",
            firstTurn: worker.firstTurn || "larga"
        }));

        if (worker.baseData) {
            localStorage.setItem(
                `baseData_${worker.name}`,
                JSON.stringify(worker.baseData)
            );
        }
    });
}

/* ======================================================================
   La fase se reconoce sola
   ====================================================================== */

test("dos trabajadores con la misma rotativa caen en la misma columna", () => {
    sembrar([
        { name: "Ana" },
        { name: "Beto" }
    ]);

    const ana = detectHolderPlacement("Ana", HOY);
    const beto = detectHolderPlacement("Beto", HOY);

    assert.equal(ana.letter, beto.letter);
    assert.ok(COLUMN_LETTERS.includes(ana.letter));
});

test("un dia de desfase es otra columna, y las cuatro se ocupan", () => {
    // Cuatro trabajadores corridos un dia entre si cubren las cuatro fases: es
    // la definicion misma del 4to turno.
    sembrar([
        { name: "A1", start: "2026-01-05" },
        { name: "A2", start: "2026-01-06" },
        { name: "A3", start: "2026-01-07" },
        { name: "A4", start: "2026-01-08" }
    ]);

    const letras = ["A1", "A2", "A3", "A4"]
        .map(name => detectHolderPlacement(name, HOY).letter);

    assert.equal(new Set(letras).size, 4, "las cuatro columnas quedan ocupadas");
});

test("el primer turno tambien define la fase, no solo la fecha de inicio", () => {
    // Mismo dia de inicio, distinto "primer turno": son grupos distintos.
    sembrar([
        { name: "Larga", firstTurn: "larga" },
        { name: "Noche", firstTurn: "noche" },
        { name: "Libre1", firstTurn: "libre1" },
        { name: "Libre2", firstTurn: "libre2" }
    ]);

    const letras = ["Larga", "Noche", "Libre1", "Libre2"]
        .map(name => detectHolderPlacement(name, HOY).letter);

    assert.equal(new Set(letras).size, 4);
});

test("un ciclo completo de desfase vuelve a la misma columna", () => {
    // Cuatro dias de diferencia es el ciclo entero: el mismo grupo.
    sembrar([
        { name: "Hoy", start: "2026-01-05" },
        { name: "Cuatro", start: "2026-01-09" }
    ]);

    assert.equal(
        detectHolderPlacement("Hoy", HOY).letter,
        detectHolderPlacement("Cuatro", HOY).letter
    );
});

/* ======================================================================
   Las letras no se mueven
   ====================================================================== */

test("la columna es la misma hoy, mañana y en un mes", () => {
    // Es la decision de diseño: si la letra dependiera del turno del dia, cada
    // trabajador cambiaria de columna cada 24 horas y el listado dejaria de ser
    // un listado de titulares.
    sembrar([{ name: "Ana" }]);

    const letras = [0, 1, 2, 3, 30, 97].map(offset =>
        detectHolderPlacement("Ana", addDays(HOY, offset)).letter
    );

    assert.equal(new Set(letras).size, 1, `no debe cambiar: ${letras.join(", ")}`);
});

test("lo que si cambia cada dia es el turno que muestra el encabezado", () => {
    sembrar([{ name: "Ana" }]);

    const turnos = [0, 1, 2, 3].map(offset =>
        detectHolderPlacement("Ana", addDays(HOY, offset)).todayTurnLabel
    );

    // En cuatro dias recorre el ciclo entero.
    assert.deepEqual([...turnos].sort(), ["Largo", "Libre", "Libre", "Noche"]);
});

test("cyclePositionAt gira en los dos sentidos", () => {
    const base = new Date(2026, 8, 10);

    assert.equal(cyclePositionAt(0, base, addDays(base, 1)), 1);
    assert.equal(cyclePositionAt(0, base, addDays(base, 4)), 0);
    assert.equal(cyclePositionAt(0, base, addDays(base, -1)), 3, "hacia atras");
    assert.equal(cyclePositionAt(3, base, addDays(base, 1)), 0);
});

/* ======================================================================
   Solo 4to turno
   ====================================================================== */

test("el diurno, el 3er turno y los reemplazos quedan fuera", async () => {
    // El diurno no tiene fases y el 3er turno tiene un ciclo de seis dias, que
    // serian otras tantas columnas.
    sembrar([
        { name: "Cuarto", type: "4turno" },
        { name: "Diurno", type: "diurno" },
        { name: "Tercero", type: "3turno" },
        { name: "Reemplazo", type: "reemplazo" }
    ]);

    assert.equal(detectHolderPlacement("Diurno", HOY), null);
    assert.equal(detectHolderPlacement("Tercero", HOY), null);
    assert.equal(detectHolderPlacement("Reemplazo", HOY), null);
    assert.ok(detectHolderPlacement("Cuarto", HOY));

    const board = await buildShiftHolders(HOY);

    assert.equal(board.total, 1);
});

test("los trabajadores inactivos no aparecen", async () => {
    sembrar([
        { name: "Activo" },
        { name: "Inactivo", active: false }
    ]);

    const board = await buildShiftHolders(HOY);
    const nombres = board.columns
        .flatMap(column => column.workers.map(worker => worker.profile.name));

    assert.deepEqual(nombres, ["Activo"]);
});

/* ======================================================================
   Historia hacia atras
   ====================================================================== */

test("con tres meses limpios no hay aviso", () => {
    sembrar([{ name: "Ana", start: "2025-01-05" }]);

    const ana = detectHolderPlacement("Ana", HOY);

    assert.equal(ana.changedGroup, false);
    assert.equal(ana.shortHistory, false);
    assert.equal(ana.historyDays, 92);
    assert.equal(ana.streakDays, 92, "la racha cubre toda la ventana");
});

test("un ingreso reciente usa lo que haya, sin marcarlo como cambio", () => {
    // El requerimiento lo dice: tres meses "o menos si no hay suficientes datos
    // de turnos hacia atras".
    sembrar([{ name: "Nueva", start: "2026-08-24" }]);

    const nueva = detectHolderPlacement("Nueva", HOY);

    assert.equal(nueva.historyDays, 18, "desde el inicio de su rotativa");
    assert.equal(nueva.streakDays, 18);
    assert.equal(nueva.shortHistory, true);
    assert.equal(nueva.changedGroup, false, "no cambio de grupo: recien entra");
});

test("quien cambio de grupo queda en el nuevo, avisando desde cuando", () => {
    sembrar([{ name: "Rosa", start: "2025-01-05" }]);

    const antes = detectHolderPlacement("Rosa", HOY);

    // Se le reescribe la base de los ultimos 20 dias con la fase corrida un
    // lugar: es lo que pasa cuando a alguien lo pasan de grupo.
    const nuevaFase = (antes.position + 1) % 4;
    const CICLO = [1, 2, 0, 0];   // Largo, Noche, Libre, Libre
    const baseData = {};

    for (let back = 0; back < 20; back++) {
        const fase = ((nuevaFase - back) % 4 + 4) % 4;

        baseData[keyFromDate(addDays(HOY, -back))] = CICLO[fase];
    }

    sembrar([{ name: "Rosa", start: "2025-01-05", baseData }]);

    const despues = detectHolderPlacement("Rosa", HOY);

    assert.equal(despues.streakDays, 20, "la racha se corta donde cambio");
    assert.equal(despues.historyDays, 92, "pero la ventana sigue siendo de 3 meses");
    assert.equal(despues.changedGroup, true);
    assert.equal(despues.shortHistory, false);
    // Queda en su grupo ACTUAL, no en el que dice su ficha.
    assert.equal(despues.position, nuevaFase);
    assert.notEqual(despues.letter, antes.letter);
});

test("el aviso se lee en la unidad que corresponde", () => {
    assert.equal(formatHolderStreak(0), "sin coincidencias");
    assert.equal(formatHolderStreak(1), "1 día");
    assert.equal(formatHolderStreak(9), "9 días");
    assert.equal(formatHolderStreak(21), "3 semanas");
    assert.equal(formatHolderStreak(92), "3 meses");
});

/* ======================================================================
   Colores
   ====================================================================== */

const perfil = (estamento, profession) => ({ estamento, profession });

test("cada estamento lleva su color", () => {
    const perfiles = [
        perfil("Profesional", "Enfermería"),
        perfil("Técnico", "Técnico en Enfermería"),
        perfil("Administrativo", "Secretaria"),
        perfil("Auxiliar", "Auxiliar de servicio")
    ];
    const { colors, splitProfessions } = buildColorAssignments(perfiles);

    assert.equal(splitProfessions, false, "una sola profesion profesional");
    assert.equal(colors.size, 4);
    assert.equal(new Set(colors.values()).size, 4, "cuatro colores distintos");
    assert.equal(colors.get("Profesional"), 0);
});

test("dentro de Profesional, cada profesion lleva el suyo", () => {
    const perfiles = [
        perfil("Profesional", "Enfermería"),
        perfil("Profesional", "Kinesiología"),
        perfil("Profesional", "Obstetricia"),
        perfil("Técnico", "Técnico en Enfermería")
    ];
    const { colors, splitProfessions } = buildColorAssignments(perfiles);

    assert.equal(splitProfessions, true);
    assert.deepEqual(
        [...colors.keys()],
        [
            "Profesional · Enfermería",
            "Profesional · Kinesiología",
            "Profesional · Obstetricia",
            "Técnico"
        ]
    );
    assert.equal(new Set(colors.values()).size, 4);
});

test("los demas estamentos NO se abren por profesion", () => {
    // El requerimiento lo pide solo para Profesional.
    const perfiles = [
        perfil("Técnico", "Técnico en Enfermería"),
        perfil("Técnico", "Técnico en Farmacia"),
        perfil("Técnico", "Técnico en Imagenología")
    ];
    const { colors } = buildColorAssignments(perfiles);

    assert.deepEqual([...colors.keys()], ["Técnico"]);
});

test("con una sola profesion profesional no se abre nada", () => {
    const perfiles = [
        perfil("Profesional", "Enfermería"),
        perfil("Profesional", "Enfermería")
    ];
    const { colors, splitProfessions } = buildColorAssignments(perfiles);

    assert.equal(splitProfessions, false);
    assert.deepEqual([...colors.keys()], ["Profesional"]);
    assert.equal(holderColorKey(perfiles[0], false), "Profesional");
    assert.equal(
        holderColorKey(perfiles[0], true),
        "Profesional · Enfermería"
    );
});

test("el color de alguien no cambia porque entre otro trabajador", () => {
    // Si el orden dependiera de como llegan los perfiles, agregar a una persona
    // recolorearia la pantalla entera.
    const base = [
        perfil("Profesional", "Obstetricia"),
        perfil("Técnico", "Técnico en Enfermería")
    ];
    const conMas = [
        perfil("Técnico", "Técnico en Enfermería"),
        perfil("Profesional", "Obstetricia"),
        perfil("Auxiliar", "Auxiliar de servicio")
    ];

    assert.equal(
        buildColorAssignments(base).colors.get("Profesional"),
        buildColorAssignments(conMas).colors.get("Profesional")
    );
    assert.equal(
        buildColorAssignments(base).colors.get("Técnico"),
        buildColorAssignments(conMas).colors.get("Técnico")
    );
});

/* ======================================================================
   El tablero
   ====================================================================== */

test("el tablero arma cuatro columnas y reparte a la gente", async () => {
    sembrar([
        { name: "Ana", start: "2026-01-05" },
        { name: "Beto", start: "2026-01-05" },
        { name: "Cira", start: "2026-01-06" },
        { name: "Dino", start: "2026-01-07" },
        { name: "Eva", start: "2026-01-08" }
    ]);

    const board = await buildShiftHolders(HOY);

    assert.deepEqual(board.columns.map(column => column.letter), ["A", "B", "C", "D"]);
    assert.equal(board.total, 5);
    assert.deepEqual(
        board.columns.map(column => column.workers.length).sort(),
        [1, 1, 1, 2]
    );

    // Cada columna dice que hace hoy, y entre las cuatro cubren el ciclo.
    assert.deepEqual(
        board.columns.map(column => column.todayTurnLabel).sort(),
        ["Largo", "Libre", "Libre", "Noche"]
    );
});

test("una columna vacia igual dice que turno le toca hoy", async () => {
    sembrar([{ name: "Ana", start: "2026-01-05" }]);

    const board = await buildShiftHolders(HOY);
    const vacias = board.columns.filter(column => !column.workers.length);

    assert.equal(vacias.length, 3);
    vacias.forEach(column => {
        assert.ok(
            ["Largo", "Noche", "Libre"].includes(column.todayTurnLabel),
            column.todayTurnLabel
        );
    });
});

test("dentro de la columna la gente va por nombre", async () => {
    sembrar([
        { name: "Zoe", start: "2026-01-05" },
        { name: "Ana", start: "2026-01-05" },
        { name: "Mia", start: "2026-01-05" }
    ]);

    const board = await buildShiftHolders(HOY);
    const columna = board.columns.find(column => column.workers.length);

    assert.deepEqual(
        columna.workers.map(worker => worker.profile.name),
        ["Ana", "Mia", "Zoe"]
    );
});

/* ======================================================================
   Pintado
   ====================================================================== */

test("el panel se pinta con las cuatro columnas, la leyenda y los avisos", async () => {
    sembrar([
        { name: "Ana Perez", start: "2026-01-05", estamento: "Profesional", profession: "Enfermería" },
        { name: "Kine Uno", start: "2026-01-06", estamento: "Profesional", profession: "Kinesiología" },
        { name: "Tens Uno", start: "2026-01-07", estamento: "Técnico", profession: "Técnico en Enfermería" },
        { name: "Nueva", start: "2026-08-24", estamento: "Auxiliar", profession: "Auxiliar de servicio" }
    ]);

    const nodo = { innerHTML: "" };

    globalThis.document.getElementById = id =>
        (id === "shiftHoldersPanel" ? nodo : null);

    try {
        await renderShiftHoldersPanel();
    } finally {
        globalThis.document.getElementById = () => null;
    }

    const html = nodo.innerHTML;

    assert.match(html, /Titulares de Turnos/);
    // Las cuatro letras, cada una con lo que hace hoy.
    ["A", "B", "C", "D"].forEach(letra => {
        assert.match(html, new RegExp(`class="tt-letter">${letra}<`));
    });
    assert.equal((html.match(/class="tt-today"/g) || []).length, 4);
    assert.equal((html.match(/class="tt-column"/g) || []).length, 4);

    // La leyenda separa las dos profesiones del estamento Profesional.
    assert.match(html, /Profesional · Enfermería/);
    assert.match(html, /Profesional · Kinesiología/);
    assert.match(html, /tt-legend-item tt-color-\d/);

    // Cada trabajador con su color y su antigüedad en el grupo.
    assert.match(html, /Ana Perez/);
    assert.match(html, /class="tt-worker tt-color-\d/);
    // La recién llegada lleva el aviso de historia corta.
    assert.match(html, /⚠ /);
});

/* ======================================================================
   Cableado
   ====================================================================== */

test("el menu esta enganchado a su vista y a su panel", async () => {
    const html = await read("../index.html");
    const navigation = await read("../js/navigation.js");
    const main = await read("../js/main.js");
    const css = await read("../styles.css");

    assert.match(html, /data-target="shiftHoldersPanel"[\s\S]{0,900}Titulares de Turnos/);
    assert.match(html, /<section id="shiftHoldersPanel"/);
    assert.match(navigation, /shiftHoldersPanel"\) \{\s*\n\s*return "holders";/);
    assert.match(main, /nextView === "holders"[\s\S]{0,80}renderShiftHoldersPanel\(\)/);
    // El panel solo se ve en su vista.
    assert.match(css, /body:not\(\[data-active-view="holders"\]\) #shiftHoldersPanel/);
});

test("el barrido cede el hilo entre trabajador y trabajador", async () => {
    // Cada trabajador mira hasta 92 dias de calendario: hacerlo de corrido en
    // una unidad grande congelaria la pagina.
    const source = await read("../js/shiftHolders.js");

    assert.match(source, /runCooperativeRange\(0, profiles\.length - 1/);
});
