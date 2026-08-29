// El modal de dotacion del inicio -el que se abre al apretar la tarjeta de un
// estamento- mostraba SOLO el dia de hoy y no habia forma de mirar otro. Para
// saber quien queda de noche el sabado habia que irse al calendario.
//
// Ahora el modal se mueve: flechas para el dia anterior y el siguiente, y un
// boton de calendario que abre el mes para saltar a cualquier fecha. Lo que se
// fija aca es que la cuenta de dotacion se hace con la fecha pedida -y no con
// "hoy" escondido adentro- y que el modal queda cableado a esa fecha.
//
// Y cada trabajador del listado muestra ademas las tareas que le asigno el
// supervisor ese dia. Salen de la MISMA cuenta que se proyecta a la PWA
// (getDayTaskAssignments), asi que el supervisor lee en el inicio lo mismo que
// el trabajador ve en su telefono.
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
    location: { hostname: "localhost" }
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

const { getDotacionDetalle } = await import("../js/home.js");
const { TURNO } = await import("../js/constants.js");
const {
    TASK_ASSIGNMENT_ENTRIES_KEY,
    TASK_ASSIGNMENT_TASKS_KEY
} = await import("../js/taskAssignmentProjection.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const home = await read("../js/home.js");
const styles = await read("../styles.css");

const DIA = "Ana Perez Soto";
const NOCHE = "Bruno Lagos Diaz";

// Clave interna del calendario: mes 0-based.
const key = date =>
    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

const hoy = new Date();
const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
const pasado = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 2);

function seed() {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([
        { id: "p-1", name: DIA, estamento: "Profesional", active: true },
        { id: "p-2", name: NOCHE, estamento: "Profesional", active: true }
    ]));
    // Ana trabaja hoy de dia; Bruno, manana de noche. Pasado manana no hay
    // nadie: el dia vacio tambien tiene que poder mirarse.
    localStorage.setItem("data_" + DIA, JSON.stringify({
        [key(hoy)]: TURNO.LARGA
    }));
    localStorage.setItem("data_" + NOCHE, JSON.stringify({
        [key(manana)]: TURNO.NOCHE
    }));
}

// Lunes de la semana del dia, que es como se agrupan las asignaciones.
function weekISO(date) {
    const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = base.getDay();

    base.setDate(base.getDate() + (day === 0 ? -6 : 1 - day));

    return `${base.getFullYear()}` +
        `-${String(base.getMonth() + 1).padStart(2, "0")}` +
        `-${String(base.getDate()).padStart(2, "0")}`;
}

function seedTareas(tasks, entries = {}) {
    localStorage.setItem(TASK_ASSIGNMENT_TASKS_KEY, JSON.stringify(tasks));
    localStorage.setItem(TASK_ASSIGNMENT_ENTRIES_KEY, JSON.stringify(entries));
}

// Una tarea puesta a mano en el tablero: la casilla es turno|tarea|dia.
function asignacion(shift, taskId, date, workers) {
    return {
        [weekISO(date)]: {
            [`${shift}|${taskId}|${key(date)}`]: { workers }
        }
    };
}

const tareasDe = (lista, name) =>
    lista.find(item => item.name === name)?.tasks;

/* =========================================================
   La cuenta se hace con la fecha que se pide
========================================================= */

test("sin fecha, la dotacion sigue siendo la de hoy", () => {
    seed();

    const { byEstamento } = getDotacionDetalle();

    // Es lo que cuentan las tarjetas del inicio, que hablan del dia de hoy.
    assert.deepEqual(
        byEstamento.Profesional.dia.map(x => x.name),
        [DIA]
    );
    assert.deepEqual(byEstamento.Profesional.noche, []);
});

test("con otra fecha, la dotacion es la de ese dia", () => {
    seed();

    const { byEstamento, estamentos } = getDotacionDetalle(manana);

    assert.deepEqual(estamentos, ["Profesional"]);
    // Ana ya no aparece de dia: manana esta libre.
    assert.deepEqual(byEstamento.Profesional.dia, []);
    assert.deepEqual(
        byEstamento.Profesional.noche,
        [{ name: NOCHE, time: "20:00 a 08:00", tasks: [] }]
    );
});

test("un dia sin nadie en servicio no inventa estamentos", () => {
    seed();

    const { byEstamento, estamentos } = getDotacionDetalle(pasado);

    assert.deepEqual(estamentos, []);
    assert.equal(byEstamento.Profesional, undefined);
});

test("la ausencia de ese dia -no la de hoy- es la que saca de la lista", () => {
    seed();
    // Bruno pide administrativo justo el dia que le tocaba turno de noche.
    localStorage.setItem("admin_" + NOCHE, JSON.stringify({
        [key(manana)]: true
    }));

    assert.deepEqual(getDotacionDetalle(manana).estamentos, []);
    // Y hoy, donde no pidio nada, la dotacion queda intacta.
    assert.deepEqual(
        getDotacionDetalle().byEstamento.Profesional.dia.map(x => x.name),
        [DIA]
    );
});

/* =========================================================
   Las tareas asignadas viajan con cada trabajador
========================================================= */

test("sin tareas asignadas la fila queda como estaba", () => {
    seed();

    assert.deepEqual(
        getDotacionDetalle().byEstamento.Profesional.dia[0],
        { name: DIA, time: "08:00 a 20:00", tasks: [] }
    );
});

test("la tarea que el supervisor puso a mano aparece en su fila", () => {
    seed();
    seedTareas(
        [{ id: "t1", shift: "both", title: "Sala de yeso", order: 0 }],
        asignacion("day", "t1", hoy, [DIA])
    );

    assert.deepEqual(
        tareasDe(getDotacionDetalle().byEstamento.Profesional.dia, DIA),
        ["Sala de yeso"]
    );
});

test("cada tarea va en la columna de su turno", () => {
    seed();
    // Ana hace 24 horas: sale en las dos columnas, y cada una con lo suyo.
    localStorage.setItem("data_" + DIA, JSON.stringify({
        [key(hoy)]: TURNO.TURNO24
    }));
    seedTareas(
        [
            { id: "t1", shift: "both", title: "Sala de yeso", order: 0 },
            { id: "t2", shift: "both", title: "Ronda nocturna", order: 1 }
        ],
        {
            [weekISO(hoy)]: {
                [`day|t1|${key(hoy)}`]: { workers: [DIA] },
                [`night|t2|${key(hoy)}`]: { workers: [DIA] }
            }
        }
    );

    const { byEstamento } = getDotacionDetalle();

    assert.deepEqual(tareasDe(byEstamento.Profesional.dia, DIA), ["Sala de yeso"]);
    assert.deepEqual(
        tareasDe(byEstamento.Profesional.noche, DIA),
        ["Ronda nocturna"]
    );
});

test("las tareas predefinidas tambien se ven, no solo las puestas a mano", () => {
    seed();
    // La regla predefinida mira el turno BASE, no el programado.
    localStorage.setItem("baseData_" + DIA, JSON.stringify({
        [key(hoy)]: TURNO.LARGA
    }));
    seedTareas([{
        id: "t1",
        shift: "both",
        title: "Control de stock",
        order: 0,
        defaultWorkerRules: [{
            workerName: DIA,
            interval: 1,
            anchorKeyDay: key(hoy),
            habilOnly: false
        }]
    }]);

    assert.deepEqual(
        tareasDe(getDotacionDetalle().byEstamento.Profesional.dia, DIA),
        ["Control de stock"]
    );
});

test("las tareas son las del dia que se esta mirando", () => {
    seed();
    localStorage.setItem("data_" + DIA, JSON.stringify({
        [key(hoy)]: TURNO.LARGA,
        [key(manana)]: TURNO.LARGA
    }));
    seedTareas(
        [{ id: "t1", shift: "both", title: "Sala de yeso", order: 0 }],
        asignacion("day", "t1", manana, [DIA])
    );

    // Hoy no le toca...
    assert.deepEqual(
        tareasDe(getDotacionDetalle().byEstamento.Profesional.dia, DIA),
        []
    );
    // ...y manana si.
    assert.deepEqual(
        tareasDe(getDotacionDetalle(manana).byEstamento.Profesional.dia, DIA),
        ["Sala de yeso"]
    );
});

test("la fila del modal pinta las tareas y el CSS las baja a su linea", () => {
    assert.match(home, /class="hm-dot-tasks"/);
    assert.match(home, /class="hm-dot-task"/);
    assert.ok(styles.includes(".hm-dot-tasks { flex-basis: 100%"));
    // Sin flex-wrap la segunda linea no cabe y la fila se estira a lo ancho.
    assert.ok(styles.includes(".hm-dot-row { display: flex; flex-wrap: wrap;"));
});

/* =========================================================
   El modal cableado a esa fecha
========================================================= */

test("el modal trae flechas de dia y boton de calendario", () => {
    assert.match(home, /data-hm="dot-prev"/);
    assert.match(home, /data-hm="dot-next"/);
    assert.match(home, /data-hm="dot-cal"/);
    // El calendario del modal vive en su propio contenedor, aparte del listado.
    assert.match(home, /data-hm="dot-picker"/);
});

test("las flechas mueven un dia y repintan sin cerrar el modal", () => {
    assert.match(
        home,
        /dot-prev"\], \[data-hm="dot-next"\]'\);\s*\n\s*if \(paso\) \{\s*\n\s*irADia\(addDays\(dotacionDate, paso\.dataset\.hm === "dot-next" \? 1 : -1\)\);/
    );
    // Y el repintado usa la fecha que se esta mirando, no new Date(). El
    // detalle se guarda en una variable porque los chips de estamento tambien
    // lo necesitan; lo que importa sigue siendo de donde sale la fecha.
    assert.match(
        home,
        /const detalle = getDotacionDetalle\(dotacionDate\);\s*\n\s*const e = detalle\.byEstamento\[dotacionEst\];/
    );
});

test("elegir un dia en el calendario lo cierra y muestra ese dia", () => {
    assert.match(
        home,
        /if \(dia\) irADia\(dateFromISO\(dia\.dataset\.iso\), \{ cerrarCalendario: true \}\)/
    );
    // Las casillas del calendario llevan la fecha en ISO.
    assert.match(home, /data-hm="dot-day"/);
});

test("la tarjeta siempre abre en hoy, no donde quedo la vez anterior", () => {
    const abrir = home.slice(home.indexOf("function openDotacion("));

    assert.match(abrir.slice(0, 500), /dotacionDate = new Date\(\);/);
    assert.match(abrir.slice(0, 500), /dotacionPickerOpen = false;/);
});

test("el titulo dice que dia se esta mirando", () => {
    assert.match(home, /en servicio hoy/);
    assert.match(home, /en servicio el \$\{dotDateLabel\(dotacionDate\)\}/);
});

test("el calendario del modal tiene estilos propios", () => {
    for (const clase of [".hm-dp-grid", ".hm-dp-cell", ".hm-dp-today"]) {
        assert.ok(styles.includes(clase), `falta ${clase} en styles.css`);
    }
    // La flecha de dias y el boton de calendario van juntos en el encabezado:
    // sin esto, el margen automatico de cada uno los separa a media cabecera.
    assert.ok(styles.includes(".hm-bday-nav + .hm-modal-action"));
});
