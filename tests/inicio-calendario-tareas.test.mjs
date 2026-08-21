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
const { isTaskActiveOn, isTaskDoneOn, toggleTaskDoneOn } =
    await import("../js/homeTasks.js");

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
    assert.match(home, /trigger\.addEventListener\("keydown"/);
});

test("la tarjeta de tareas diarias muestra SOLO las de hoy", () => {
    // Una tarea programada para el 27 no puede aparecer en el resumen del 20.
    // El bug era que la tarjeta listaba getHomeTasks() sin mirar la fecha.
    assert.match(home, /const tasks = getTasksForDay\(new Date\(\)\);/);
    assert.doesNotMatch(
        home,
        /function tasksListHTML\(\) \{[\s\S]{0,200}getHomeTasks\(\)/
    );
});

test("una tarea futura se ve en el calendario, no en la tarjeta", () => {
    // El 20 de agosto no la muestra; el 27, si.
    const task = tarea({
        id: "futura", repeat: "Una sola vez", date: "2026-08-27"
    });

    assert.equal(getTasksForDay(new Date(ANIO, MES, 20), [task]).length, 0);
    assert.equal(getTasksForDay(new Date(ANIO, MES, 27), [task]).length, 1);

    const cells = buildTaskCalendarCells(ANIO, MES, [task]);

    assert.equal(celda(cells, 20).tasks.length, 0);
    assert.deepEqual(celda(cells, 27).tasks.map(item => item.id), ["futura"]);
});

test("una tarea sin fecha de inicio no desaparece", () => {
    // Sin fecha no hay donde anclarla. Descartarla la sacaria de la tarjeta, del
    // calendario y de las alertas a la vez, sin dejar rastro para el usuario.
    const sinFecha = tarea({ id: "vieja", repeat: "Semanal", date: "" });

    assert.equal(isTaskActiveOn(sinFecha, new Date(ANIO, MES, 20)), true);
    assert.equal(getTasksForDay(new Date(ANIO, MES, 20), [sinFecha]).length, 1);
});

test("\"Ver todas las tareas\" tambien abre el calendario", () => {
    // Es donde uno va a buscar la tarea que ya no ve en la tarjeta.
    assert.match(home, /panelLink\("Ver todas las tareas", "open-taskcal"\)/);
    // Los dos disparadores se cablean, no solo el primero.
    assert.match(home, /panel\.querySelectorAll\('\[data-hm="open-taskcal"\]'\)/);
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

test("se puede abrir cualquier dia para agregar tareas", () => {
    // Un dia vacio tambien sirve: desde su listado se agrega una tarea nueva.
    assert.match(home, /const clickable = true;/);
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

/* =========================================================
   Periodicidad "Diario Hábil"
========================================================= */

// isBusinessDay indexa los feriados como "año-mes(0)-dia".
// El 21 de agosto de 2026 es viernes: aca se marca como feriado a proposito,
// para separar "no es habil por feriado" de "no es habil por fin de semana".
const FERIADOS = { "2026-7-21": "Feriado de prueba" };

test("Diario Hábil salta fines de semana y feriados", () => {
    const task = tarea({ repeat: "Diario Hábil", date: "2026-08-01" });
    const activo = dia => isTaskActiveOn(task, new Date(ANIO, MES, dia), FERIADOS);

    assert.equal(activo(20), true, "jueves habil");
    assert.equal(activo(21), false, "viernes feriado");
    assert.equal(activo(22), false, "sabado");
    assert.equal(activo(23), false, "domingo");
    assert.equal(activo(24), true, "lunes habil");
});

test("Diario Hábil cae solo en los habiles del mes", () => {
    const task = tarea({ id: "habil", repeat: "Diario Hábil", date: "2026-08-01" });
    const cells = buildTaskCalendarCells(ANIO, MES, [task], FERIADOS);
    const conTarea = cells.filter(Boolean)
        .filter(cell => cell.tasks.length)
        .map(cell => cell.day);

    // Agosto 2026 tiene 31 dias y empieza sabado: 10 de fin de semana y 21
    // habiles, menos el feriado del 21 = 20.
    assert.equal(conTarea.length, 20);
    assert.ok(!conTarea.includes(21), "el feriado queda fuera");
    assert.ok(!conTarea.includes(1), "el sabado 1 queda fuera");
    assert.ok(conTarea.includes(3), "el lunes 3 entra");
});

test("Diario Hábil es distinto de Diario", () => {
    // Si fueran lo mismo, la opcion nueva no serviria de nada.
    const habil = tarea({ repeat: "Diario Hábil", date: "2026-08-01" });
    const diario = tarea({ repeat: "Diario", date: "2026-08-01" });
    const sabado = new Date(ANIO, MES, 22);

    assert.equal(isTaskActiveOn(habil, sabado, FERIADOS), false);
    assert.equal(isTaskActiveOn(diario, sabado, FERIADOS), true);
});

test("la periodicidad nueva esta en el formulario", () => {
    assert.match(home, /"Diario Hábil"/);
    // Los dos formularios (agregar y modificar) salen de la misma lista, para
    // que no se pueda elegir en uno y no en el otro.
    assert.match(home, /data-hm="nt-repeat">\$\{optionsHTML\(REPEAT_OPTS, "Diario"\)\}/);
    assert.match(home, /data-hm="et-repeat">\$\{optionsHTML\(REPEAT_OPTS, "Diario"\)\}/);
});

/* =========================================================
   Visto de realizada, por dia
========================================================= */

test("marcar un dia no borra el visto de otro", () => {
    // Con una sola fecha de visto, cerrar el 27 borraba el del 26: en una tarea
    // que se repite, el calendario mostraria un solo dia hecho.
    let task = tarea({ repeat: "Diario", date: "2026-08-01" });

    task = toggleTaskDoneOn(task, "2026-08-26");
    task = toggleTaskDoneOn(task, "2026-08-27");

    assert.equal(isTaskDoneOn(task, "2026-08-26"), true);
    assert.equal(isTaskDoneOn(task, "2026-08-27"), true);
    assert.equal(isTaskDoneOn(task, "2026-08-28"), false);
});

test("volver a marcar el mismo dia lo desmarca", () => {
    let task = toggleTaskDoneOn(tarea({}), "2026-08-27");

    assert.equal(isTaskDoneOn(task, "2026-08-27"), true);

    task = toggleTaskDoneOn(task, "2026-08-27");

    assert.equal(isTaskDoneOn(task, "2026-08-27"), false);
});

test("el visto viejo de una sola fecha no se pierde", () => {
    // Las tareas guardadas antes traen doneDate (una fecha), no doneDates.
    const antigua = { id: "v", name: "Vieja", time: "08:00", repeat: "Diario", doneDate: "2026-08-26" };
    const migrada = toggleTaskDoneOn(antigua, "2026-08-27");

    assert.equal(isTaskDoneOn(migrada, "2026-08-26"), true);
    assert.equal(isTaskDoneOn(migrada, "2026-08-27"), true);
});

test("desde el calendario el visto se marca contra el dia abierto", () => {
    // No contra hoy: se cierra el 27 estando parado en el 20.
    assert.match(home, /toggleTaskDoneOn\(tasks\[index\], openDayIso\)/);
    // Y en la tarjeta del inicio, contra hoy.
    assert.match(home, /toggleTaskDoneOn\(tasks\[index\], todayISO\(\)\)/);
});

test("desde el calendario se puede modificar la tarea", () => {
    // La misma via que la tarjeta del inicio: openTaskEdit.
    assert.match(home, /data-hm="dt-row" data-id=/);
    assert.match(home, /const editFromDay = id => \{[\s\S]{0,40}openTaskEdit\(panel, id\);/);
    // Y el modal de modificar tiene que quedar POR ENCIMA del listado del dia.
    assert.match(home, /hm-modal-backdrop--top" data-hm="task-edit-modal"/);
});

test("desde el calendario se puede agregar una tarea en el dia abierto", () => {
    // El signo + del listado abre el mismo modal de alta que la tarjeta diaria,
    // pero dejando precargada la fecha seleccionada en el calendario.
    assert.match(home, /data-hm="dt-add"/);
    assert.match(home, /openTaskAdd\(panel, openDayIso, \{ top: true \}\)/);
    assert.match(home, /modal\.querySelector\('\[data-hm="nt-date"\]'\)\.value = date \|\| todayISO\(\);/);
});

test("modificar una tarea repinta las tres superficies", () => {
    // Tarjeta del dia, grilla del mes y listado del dia abierto muestran el
    // mismo dato: si solo se repintara una, las otras quedarian mintiendo.
    assert.match(
        home,
        /const refreshTasks = \(\) => \{[\s\S]{0,400}tasksListHTML\(\);[\s\S]{0,120}reRenderTaskCalendar\(panel\);[\s\S]{0,60}renderDayTasks\(panel\);/
    );
});
