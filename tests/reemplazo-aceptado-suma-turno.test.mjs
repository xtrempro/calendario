// Un trabajador con un turno extra de Larga ya registrado acepta, desde su
// telefono, una solicitud de reemplazo de Noche para el mismo dia. El supervisor
// suma los dos turnos y su plataforma muestra un 24h. La PWA mostraba "Noche":
// la casilla se REEMPLAZABA por el turno aceptado en vez de sumarlo.
//
// Y quedaba asi para siempre. La reconciliacion daba por confirmado el aceptado
// optimista solo si la etiqueta publicada era IGUAL a la del reemplazo; como el
// supervisor publica la suma ("24h") y nunca "Noche", nunca coincidian, el
// optimista no se borraba y seguia tapando el turno real.
//
// Estas pruebas cubren las dos mitades: que el motor de suma de la PWA sea el
// mismo del supervisor, y que las dos funciones de la app lo usen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get length() {
        return this.values.size;
    }

    clear() {
        this.values.clear();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    key(index) {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key) {
        this.values.delete(key);
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = globalThis.window || {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {}
};
globalThis.CustomEvent = globalThis.CustomEvent || class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};

const PWA = "../../APP TurnoPlus/www/js/";

const { fusionarTurnos: fusionarSupervisor } =
    await import("../js/turnEngine.js");
const {
    TURNO,
    TURNO_LABEL,
    classNameForDay,
    fusionarTurnos: fusionarPWA,
    turnoFromShiftValue
} = await import(new URL(`${PWA}rotationEngine.js`, import.meta.url));

const appSource = (await readFile(
    new URL(`${PWA}app.js`, import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

/* =========================================================
   El motor de suma de la PWA es el del supervisor
========================================================= */

test("las 81 combinaciones de turnos dan lo mismo en los dos lados", () => {
    const estados = Object.values(TURNO);

    for (const actual of estados) {
        for (const recibido of estados) {
            assert.equal(
                fusionarPWA(actual, recibido),
                fusionarSupervisor(actual, recibido),
                `${actual} + ${recibido} difiere entre la PWA y el supervisor`
            );
        }
    }
});

test("Larga + Noche es un 24h, no la Noche sola", () => {
    assert.equal(fusionarPWA(TURNO.LARGA, TURNO.NOCHE), TURNO.TURNO24);
    assert.equal(fusionarPWA(TURNO.NOCHE, TURNO.LARGA), TURNO.TURNO24);
    assert.equal(fusionarPWA(TURNO.DIURNO, TURNO.NOCHE), TURNO.DIURNO_NOCHE);
});

test("el turno llega como codigo, como letra y como etiqueta", () => {
    // La proyeccion manda el codigo; el supervisor guarda la letra en la
    // solicitud; la etiqueta es lo que ya se muestra en pantalla.
    assert.equal(turnoFromShiftValue(TURNO.TURNO24), TURNO.TURNO24);
    assert.equal(turnoFromShiftValue("N"), TURNO.NOCHE);
    assert.equal(turnoFromShiftValue("L"), TURNO.LARGA);
    assert.equal(turnoFromShiftValue("24"), TURNO.TURNO24);
    assert.equal(turnoFromShiftValue("24h"), TURNO.TURNO24);
    assert.equal(turnoFromShiftValue("Larga"), TURNO.LARGA);
    assert.equal(turnoFromShiftValue("Noche"), TURNO.NOCHE);
    assert.equal(turnoFromShiftValue("D+N"), TURNO.DIURNO_NOCHE);
    assert.equal(turnoFromShiftValue("Extensión horaria"), TURNO.MEDIA_TARDE);
    assert.equal(turnoFromShiftValue("18 horas"), TURNO.TURNO18);

    // Lo que no se reconoce es LIBRE, que hace caer en el camino de respaldo en
    // vez de inventar una suma con un turno equivocado.
    assert.equal(turnoFromShiftValue(""), TURNO.LIBRE);
    assert.equal(turnoFromShiftValue("Comision de servicio"), TURNO.LIBRE);
    assert.equal(turnoFromShiftValue(null), TURNO.LIBRE);
});

/* =========================================================
   Las dos funciones de la app, corriendo de verdad

   Se recortan del fuente de app.js (24 mil lineas con Firebase y DOM adentro)
   y se ejecutan con sus dependencias reales al lado.
========================================================= */

function recortar(nombre) {
    const inicio = appSource.indexOf(`\nfunction ${nombre}(`);

    assert.notEqual(inicio, -1, `no se encontro la funcion: ${nombre}`);

    const fin = appSource.indexOf("\n}\n", inicio);

    assert.notEqual(fin, -1, `no se encontro el cierre de: ${nombre}`);

    return appSource.slice(inicio, fin + 3);
}

const NOMBRES = [
    "normalizeSearchText",
    "displayShiftLabel",
    "safeShiftClass",
    "classNameFromShiftLabel",
    "isFreeWorkerShift",
    "acceptedReplacementShift",
    "syncedCoversAcceptedTurn"
];

const modulo = [
    'import { TURNO_LABEL, classNameForDay, fusionarTurnos, turnoFromShiftValue }',
    `  from ${JSON.stringify(new URL(`${PWA}rotationEngine.js`, import.meta.url).href)};`,
    ...NOMBRES.map(recortar),
    `export { ${NOMBRES.join(", ")} };`
].join("\n");

const app = await import(
    `data:text/javascript;base64,${Buffer.from(modulo, "utf8").toString("base64")}`
);

const NOCHE_ACEPTADA = { requestId: "r1", turno: TURNO.NOCHE, turnoLabel: "Noche" };

function casilla(turno) {
    return {
        turno,
        label: TURNO_LABEL[turno] || "Libre",
        className: classNameForDay(turno, false)
    };
}

test("aceptar una Noche sobre un turno extra de Larga deja un 24h", () => {
    const resultado = app.acceptedReplacementShift(
        casilla(TURNO.LARGA),
        NOCHE_ACEPTADA
    );

    assert.equal(resultado.label, "24h");
    assert.equal(resultado.className, "turno24");
});

test("sobre un dia libre, el reemplazo es todo el turno del dia", () => {
    for (const libre of [casilla(TURNO.LIBRE), { label: "S/D", className: "sin-datos" }]) {
        const resultado = app.acceptedReplacementShift(libre, NOCHE_ACEPTADA);

        assert.equal(resultado.label, "Noche");
        assert.equal(resultado.className, "noche");
    }
});

test("un turno que no admite la suma se queda como estaba", () => {
    // Ya tiene la noche del dia: aceptar otra Noche no la duplica.
    const resultado = app.acceptedReplacementShift(
        casilla(TURNO.NOCHE),
        NOCHE_ACEPTADA
    );

    assert.equal(resultado.label, "Noche");
    assert.equal(resultado.className, "noche");
});

test("una etiqueta que la PWA no conoce muestra el reemplazo, no un turno inventado", () => {
    const resultado = app.acceptedReplacementShift(
        { label: "Capacitación", className: "larga" },
        NOCHE_ACEPTADA
    );

    assert.equal(resultado.label, "Noche");
    assert.equal(resultado.className, "noche");
});

test("el 24h publicado confirma la Noche aceptada y suelta el optimista", () => {
    assert.equal(
        app.syncedCoversAcceptedTurn(casilla(TURNO.TURNO24), NOCHE_ACEPTADA),
        true
    );
    assert.equal(
        app.syncedCoversAcceptedTurn(casilla(TURNO.DIURNO_NOCHE), NOCHE_ACEPTADA),
        true
    );
    assert.equal(
        app.syncedCoversAcceptedTurn(casilla(TURNO.NOCHE), NOCHE_ACEPTADA),
        true
    );
});

test("mientras el supervisor no aplique el turno, el optimista sigue en pie", () => {
    // La Larga sola es lo que ya habia: todavia falta la Noche aceptada.
    assert.equal(
        app.syncedCoversAcceptedTurn(casilla(TURNO.LARGA), NOCHE_ACEPTADA),
        false
    );
    assert.equal(
        app.syncedCoversAcceptedTurn(casilla(TURNO.LIBRE), NOCHE_ACEPTADA),
        false
    );
});

/* =========================================================
   Las llamadas
========================================================= */

test("la casilla del calendario suma el reemplazo al turno que ya tenia", () => {
    assert.match(
        appSource,
        /state: "accepted",\n\s*\.\.\.acceptedReplacementShift\(baseShift, optimistic\)/,
        "getReplacementCalendarState volvio a pisar la casilla con el reemplazo"
    );
});

test("la reconciliacion pregunta por la suma, no por la etiqueta", () => {
    assert.match(
        appSource,
        /const confirmed = synced && syncedCoversAcceptedTurn\(synced, entry\);/,
        "reconcileOptimisticReplacements volvio a comparar etiquetas"
    );
});

test("la proyeccion entrega el codigo del turno a la casilla", () => {
    // Sin el codigo, la suma dependeria de adivinar el turno desde una etiqueta
    // que la unidad puede tener personalizada.
    assert.match(
        appSource,
        /turno: turnoFromShiftValue\(day\.turno\),/,
        "syncedShiftForDate dejo de publicar el codigo del turno"
    );
});
