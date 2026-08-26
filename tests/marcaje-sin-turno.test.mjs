// Caso real (Miguel Gonzalez, 25 de agosto): se le aplico un turno, se le
// modifico el marcaje y despues se le quito el turno. El marcaje quedo huerfano
// y la casilla se bloqueo: seguia mostrando el icono del reloj, el click abria
// el detalle del marcaje en vez de editar el dia, y el boton "Modificar
// marcaje" se negaba a abrir ("Selecciona un dia que tenga turno"). No habia
// forma de sacar el icono ni de volver a asignar un turno.
//
// Sin turno no hay horario contra el cual comparar la marca: el reloj no se
// dibuja, la casilla vuelve a ser editable y, al cambiar el turno de/hacia
// Libre, el marcaje viejo se borra para que no reaparezca pegado al turno nuevo.
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

const dispatched = [];

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: event => { dispatched.push(event); return true; },
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

const [calendar, timeline] = await Promise.all([
    readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
    readFile(new URL("../js/timeline.js", import.meta.url), "utf8")
]);

const { TURNO } = await import("../js/constants.js");
const {
    clearClockMark,
    clockMarkAppliesToTurn,
    getClockMarks
} = await import("../js/clockMarks.js");

const NAME = "MIGUEL ANGEL GONZALEZ DIAZ MUNOZ";
const KEY = "2026-7-25";

function seedClockMark() {
    localStorage.clear();
    localStorage.setItem(`clockMarks_${NAME}`, JSON.stringify({
        [KEY]: {
            segments: {
                larga: { entryTime: "09:30", exitTime: "20:00" }
            },
            updatedAt: "2026-08-25T13:00:00.000Z"
        }
    }));
}

test("sin turno el marcaje no aplica; con turno si", () => {
    assert.equal(clockMarkAppliesToTurn(TURNO.LIBRE), false);
    assert.equal(clockMarkAppliesToTurn(0), false);
    assert.equal(clockMarkAppliesToTurn(undefined), false);
    assert.equal(clockMarkAppliesToTurn(null), false);
    assert.equal(clockMarkAppliesToTurn(TURNO.LARGA), true);
    assert.equal(clockMarkAppliesToTurn(TURNO.NOCHE), true);
    assert.equal(clockMarkAppliesToTurn(String(TURNO.DIURNO)), true);
});

test("clearClockMark borra el marcaje del dia y avisa a la proyeccion", () => {
    seedClockMark();
    dispatched.length = 0;

    assert.equal(clearClockMark(NAME, KEY), true);
    assert.deepEqual(getClockMarks(NAME), {});
    // saveClockMarks avisa para republicar la proyeccion del trabajador.
    assert.ok(dispatched.some(event =>
        event.type === "proturnos:clockMarksChanged" &&
        event.detail?.profile === NAME
    ));

    // Sin nada que borrar no reescribe ni avisa.
    dispatched.length = 0;
    assert.equal(clearClockMark(NAME, KEY), false);
    assert.equal(dispatched.length, 0);
});

test("clearClockMark no toca los otros dias ni otros perfiles", () => {
    seedClockMark();
    localStorage.setItem(`clockMarks_${NAME}`, JSON.stringify({
        [KEY]: { segments: { larga: { entryTime: "09:30" } } },
        "2026-7-21": { segments: { diurno: { entryTime: "08:40" } } }
    }));

    clearClockMark(NAME, KEY);

    assert.deepEqual(Object.keys(getClockMarks(NAME)), ["2026-7-21"]);
});

test("el calendario ignora el marcaje del dia sin turno", () => {
    // Casilla: el reloj sale del marcaje solo si el dia tiene turno.
    assert.match(
        calendar,
        /const clockMark = clockMarkAppliesToTurn\(state\)\s*\n\s*\? clockMarks\[keyDay\] \|\| null\s*\n\s*: null;/
    );
    // Click de la casilla: sin turno no se secuestra, cae a la edicion directa.
    assert.match(
        calendar,
        /const clockMarkApplies = clockMarkAppliesToTurn\(state\);/
    );
    assert.match(
        calendar,
        /const severeClockIncident =\s*\n\s*clockMarkApplies &&\s*\n\s*hasSevereClockIncident\(activeProfile, keyDay\);/
    );
    assert.match(
        calendar,
        /const clockMarkForDay = clockMarkApplies\s*\n\s*\? getClockMarks\(activeProfile\)\[keyDay\] \|\| null\s*\n\s*: null;/
    );
});

test("el timeline tampoco marca el dia sin turno", () => {
    assert.match(
        timeline,
        /const clockMarkApplies = clockMarkAppliesToTurn\(realTurn\);/
    );
    assert.match(timeline, /const severeClockIncident = !clockMarkApplies\s*\n\s*\? false/);
    assert.match(timeline, /const simpleClockIncident =\s*\n\s*clockMarkApplies &&/);
});

test("la edicion directa borra el marcaje al entrar o salir de Libre", () => {
    assert.match(calendar, /function dropClockMarkForTurnChange\(/);
    // Solo se conserva cuando el dia tiene turno antes y despues del cambio.
    assert.match(
        calendar,
        /if \(\s*clockMarkAppliesToTurn\(previousTurn\) &&\s*clockMarkAppliesToTurn\(nextTurn\)\s*\) \{\s*return false;/
    );
    assert.match(calendar, /if \(!clearClockMark\(profileName, keyDay\)\) return false;/);
    assert.match(calendar, /"Elimino marcaje de reloj control"/);
    // Enganchado al mismo punto donde se anulan los respaldos del turno extra.
    assert.match(
        calendar,
        /cancelManualExtraBackupsForTurnChange\(\s*\n\s*profileName,\s*\n\s*keyDay,\s*\n\s*nuevo\s*\n\s*\);\s*\n\s*dropClockMarkForTurnChange\(\s*\n\s*profileName,\s*\n\s*keyDay,\s*\n\s*currentState,\s*\n\s*nuevo\s*\n\s*\);/
    );
});
