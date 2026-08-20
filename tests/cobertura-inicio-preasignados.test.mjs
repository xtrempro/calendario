// La tarjeta "Cobertura de turnos" del inicio listaba los turnos preasignados
// pero sin poder resolverlos: habia que ir al calendario, buscar el dia y abrir
// el modal. Ahora cada preasignado trae CONFIRMAR y CANCELAR, que ejecutan
// exactamente las mismas acciones que ese modal.
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

const { confirmPreassignment, cancelPreassignment, getReplacementForCoveredShift } =
    await import("../js/replacements.js");
const { getPreassignments } = await import("../js/preassignments.js");
const { TURNO } = await import("../js/constants.js");

const REPLACED = "Hugo Rojas Tapia";
const WORKER = "Mariana Rojas Bravo";
const DAY_KEY = "2026-7-13";
const DAY_ISO = "2026-08-13";
const ID = "pre-1";

function seed() {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([
        { id: "p-1", name: REPLACED, estamento: "Profesional", active: true },
        { id: "p-2", name: WORKER, estamento: "Profesional", active: true }
    ]));
    localStorage.setItem("preassignments", JSON.stringify([{
        id: ID,
        worker: WORKER,
        replaced: REPLACED,
        date: DAY_ISO,
        turno: "L",
        absenceType: "P. Administrativo",
        at: "2026-08-19T21:49:41.000Z"
    }]));
    localStorage.setItem("replacements", JSON.stringify([]));
}

function preassignment() {
    return getPreassignments().find(item => item.id === ID);
}

test("confirmar convierte la preasignacion en reemplazo real", () => {
    seed();

    assert.ok(preassignment(), "la preasignacion existe antes");

    assert.equal(confirmPreassignment(preassignment()), true);

    // Deja de ser reserva tentativa...
    assert.equal(preassignment(), undefined);
    // ...y pasa a ser un reemplazo que si proyecta turno y suma HH.EE.
    const replacement = getReplacementForCoveredShift(REPLACED, DAY_KEY);

    assert.ok(replacement, "tiene que quedar el reemplazo del turno cubierto");
    assert.equal(replacement.worker, WORKER);
    assert.equal(replacement.source, "replacement");
    assert.equal(Number(replacement.turno) || replacement.turno, "L");
});

test("cancelar quita la preasignacion sin crear reemplazo", () => {
    seed();

    assert.equal(cancelPreassignment(preassignment()), true);

    assert.equal(preassignment(), undefined);
    assert.equal(
        getReplacementForCoveredShift(REPLACED, DAY_KEY),
        null,
        "el turno vuelve a quedar pendiente de cobertura"
    );
});

test("sin registro valido no hacen nada", () => {
    seed();

    assert.equal(confirmPreassignment(null), false);
    assert.equal(cancelPreassignment({}), false);
    assert.equal(confirmPreassignment({ id: ID }), false, "sin fecha no procede");
    assert.ok(preassignment(), "la preasignacion sigue intacta");
});

test("la tarjeta del inicio pinta los dos botones y los cablea", async () => {
    const home = (await readFile(
        new URL("../js/home.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    // El id del registro viaja hasta la fila para poder resolverlo.
    assert.match(home, /id: record\.id,/);
    assert.match(home, /data-hm="cob-confirm" data-preassign-id="\$\{esc\(item\.id\)\}"/);
    assert.match(home, /data-hm="cob-cancel" data-preassign-id="\$\{esc\(item\.id\)\}"/);
    assert.match(home, />CONFIRMAR</);
    assert.match(home, />CANCELAR</);
    // Solo en los preasignados, no en los "sin cubrir".
    assert.match(home, /kind === "preasignado" && item\.id/);
    // Y usan las mismas acciones del modal del calendario.
    assert.match(home, /confirmPreassignment\(preassignment\)/);
    assert.match(home, /cancelPreassignment\(preassignment\)/);
    // Tras resolver hay que repintar el resto de la app.
    assert.match(home, /refreshAll\(\);\s*\n\s*renderHomePanel\(\);/);
});

test("resolver desde el inicio actualiza calendario Y timeline", async () => {
    const [home, refresh] = await Promise.all([
        readFile(new URL("../js/home.js", import.meta.url), "utf8"),
        readFile(new URL("../js/refresh.js", import.meta.url), "utf8")
    ]).then(sources => sources.map(text => text.replace(/\r\n/g, "\n")));

    // refreshAll repinta SOLO la vista activa, y al resolver desde el inicio la
    // activa es "home": ni el calendario ni el timeline se enteraban, y el
    // marcador de preasignado seguia ahi hasta recargar.
    assert.match(refresh, /if \(activeView === "turnos"\) \{\s*\n\s*renderCalendar/);
    assert.match(refresh, /if \(activeView === "timeline"\) \{\s*\n\s*renderTimeline/);

    // Por eso el inicio actualiza las casillas directamente, como el modal.
    assert.match(home, /await updateDayCell\(replaced, keyDay\);/);
    assert.match(home, /await updateDayCell\(worker, keyDay\);/);
    assert.match(home, /updateTimelineCells\(replaced, \[keyDay\]\);/);
    assert.match(home, /updateTimelineCells\(worker, \[keyDay\]\);/);
    assert.match(home, /await updateVisibleCalendarDays\(\{ updateSummary: true \}\);/);
    // Los nombres se leen ANTES de resolver: despues la preasignacion ya no esta.
    assert.match(
        home,
        /const worker = preassignment\.worker;[\s\S]{0,200}?const done = confirmar/
    );
});

test("el calendario ya no duplica la logica, la reusa", async () => {
    const calendar = (await readFile(
        new URL("../js/calendar.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.match(calendar, /confirmPreassignment\(preassignment\);/);
    assert.match(calendar, /cancelPreassignment\(preassignment\);/);
    // La copia anterior vivia inline en el modal.
    assert.doesNotMatch(calendar, /"Confirmo preasignacion"/);
    assert.doesNotMatch(calendar, /"Cancelo preasignacion"/);
});
