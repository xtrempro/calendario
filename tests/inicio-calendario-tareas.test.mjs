// Calendario organizativo de tareas: se abre al hacer click en la fecha del
// encabezado del inicio ("Hoy es ...") y muestra, dia por dia, las tareas que
// anoto el supervisor. En una casilla no caben todas, asi que las que sobran se
// resumen en "+N mas" y el dia se abre en un segundo modal con el listado
// completo.
//
// Lo importante que se fija aca: el calendario usa la MISMA regla de
// recurrencia que dispara las alertas sonoras (isTaskActiveOn). Si se
// duplicara, el calendario mostraria una tarea un dia y el aviso sonaria otro.
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

const { buildTaskCalendarCells, getTasksForDay } = await import("../js/home.js");
const { isTaskActiveOn } = await import("../js/homeTasks.js");

const home = (await readFile(new URL("../js/home.js", import.meta.url), "utf8"))
    .replace(/\r\n/g, "\n");

// Agosto de 2026: el dia 1 cae sabado.
const ANIO = 2026;
const MES = 7;

const tarea = (extra) => ({
    id: extra.id || "x",
    name: extra.name || "Tarea",
    time: extra.time || "08:00",
    repeat: extra.repeat || "Diario",
    date: extra.date || "",
    alert: "Sin alerta",
    doneDate: extra.doneDate || "",
    ...extra
});

function celda(cells, dia) {
    return cells.find(cell => cell && cell.day === dia);
}

test("la fecha del encabezado abre el calendario", () => {
    assert.match(home, /class="hm-date" data-hm="open-taskcal" role="button" tabindex="0"/);
    // Y tambien con el teclado, no solo con el mouse.
    assert.match(home, /dateBtn\.addEventListener\("keydown"/);
});

test("el dia 1 cae en su columna, con la semana en lunes", () => {
    const cells = buildTaskCalendarCells(ANIO, MES, []);

    // 1 de agosto de 2026 es sabado: sexta columna con la semana en lunes,
    // o sea 5 casillas en blanco antes.
    assert.equal(cells.filter(cell => cell === null).length, 5);
    assert.equal(cells[5].day, 1);
    // Agosto tiene 31 dias.
    assert.equal(cells.filter(Boolean).length, 31);
    assert.equal(cells.at(-1).day, 31);
});

test("cada recurrencia cae donde corresponde", () => {
    const tasks = [
        tarea({ id: "d", name: "Diaria", repeat: "Diario", date: "2026-08-01" }),
        // 2026-08-05 es miercoles.
        tarea({ id: "s", name: "Semanal", repeat: "Semanal", date: "2026-08-05" }),
        tarea({ id: "m", name: "Mensual", repeat: "Mensual", date: "2026-08-12" }),
        tarea({ id: "u", name: "Una vez", repeat: "Una sola vez", date: "2026-08-20" })
    ];
    const cells = buildTaskCalendarCells(ANIO, MES, tasks);
    const ids = dia => celda(cells, dia).tasks.map(task => task.id);

    // La diaria esta todos los dias desde su inicio.
    assert.ok(ids(1).includes("d"));
    assert.ok(ids(31).includes("d"));
    // La semanal, solo los miercoles.
    assert.deepEqual(
        cells.filter(Boolean)
            .filter(cell => cell.tasks.some(task => task.id === "s"))
            .map(cell => cell.day),
        [5, 12, 19, 26]
    );
    // La mensual, solo el 12.
    assert.ok(ids(12).includes("m"));
    assert.ok(!ids(13).includes("m"));
    // La de una sola vez, solo el 20.
    assert.deepEqual(ids(20).filter(id => id === "u"), ["u"]);
    assert.ok(!ids(21).includes("u"));
});

test("una tarea no aparece antes de su fecha de inicio", () => {
    const tasks = [tarea({ id: "d", repeat: "Diario", date: "2026-08-15" })];
    const cells = buildTaskCalendarCells(ANIO, MES, tasks);

    assert.equal(celda(cells, 14).tasks.length, 0);
    assert.equal(celda(cells, 15).tasks.length, 1);
});

test("las tareas del dia salen ordenadas por hora", () => {
    const tasks = [
        tarea({ id: "tarde", time: "18:00", repeat: "Diario" }),
        tarea({ id: "manana", time: "07:30", repeat: "Diario" }),
        tarea({ id: "medio", time: "12:00", repeat: "Diario" })
    ];

    assert.deepEqual(
        getTasksForDay(new Date(ANIO, MES, 10), tasks).map(task => task.id),
        ["manana", "medio", "tarde"]
    );
});

test("es la misma regla que la de las alertas sonoras", () => {
    // No una copia: si se duplicara, el calendario y el aviso se irian
    // separando con cada cambio de recurrencia.
    const task = tarea({ repeat: "Semanal", date: "2026-08-05" });
    const miercoles = new Date(ANIO, MES, 12);
    const jueves = new Date(ANIO, MES, 13);

    assert.equal(isTaskActiveOn(task, miercoles), true);
    assert.equal(getTasksForDay(miercoles, [task]).length, 1);
    assert.equal(isTaskActiveOn(task, jueves), false);
    assert.equal(getTasksForDay(jueves, [task]).length, 0);
});

test("lo que no cabe en la casilla se resume en +N mas", () => {
    // El limite por casilla y el resumen tienen que ser coherentes: el texto
    // "+N mas" cuenta exactamente lo que no se pinto.
    assert.match(home, /const TASKS_PER_CELL = 3;/);
    assert.match(home, /const extra = cell\.tasks\.length - TASKS_PER_CELL;/);
    assert.match(home, /slice\(0, TASKS_PER_CELL\)/);
    assert.match(home, /\$\{extra\} más/);
});

test("solo se puede abrir un dia que tenga tareas", () => {
    // Un dia vacio no es clickeable: abriria un modal sin nada.
    assert.match(home, /const clickable = cell\.tasks\.length > 0;/);
    assert.match(home, /data-hm="taskcal-day" data-iso=/);
    assert.match(home, /const cell = event\.target\.closest\('\[data-hm="taskcal-day"\]'\);/);
});

test("el listado del dia se abre encima del calendario", () => {
    // Cerrar el listado deja el calendario abierto detras, no vuelve al inicio.
    assert.match(home, /hm-modal-backdrop--over" data-hm="dayTasks-modal"/);
    assert.match(
        home,
        /dayTasks\.addEventListener\("click"[\s\S]{0,220}dayTasks\.hidden = true;/
    );
});

test("el calendario se mueve de mes y siempre abre en el actual", () => {
    assert.match(home, /data-hm="tc-prev"/);
    assert.match(home, /data-hm="tc-next"/);
    // Entrar por "Hoy es ..." tiene que llevar al mes de hoy, no a donde quedo
    // la vez anterior.
    assert.match(
        home,
        /const openCalendar = \(\) => \{[\s\S]{0,320}taskCalYear = now\.getFullYear\(\);/
    );
});
