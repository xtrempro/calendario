// Las fechas del panel "Registros HH.EE del mes" son el boton de accion de cada
// fila: abren el cuadro que le falta a ese dia. Antes había que salir a Turnos,
// buscar el dia en el calendario y clickear la casilla.
//
// Cada registro tiene que viajar con lo que ese cuadro necesita para abrirse
// (keyDay siempre, y ademas el turno pendiente o el id del reemplazo segun el
// caso); sin eso el click no tiene con que rutear.
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

const { getHheeMonthRecords } = await import("../js/replacements.js");
const { TURNO } = await import("../js/constants.js");

const NAME = "Ana";
const YEAR = 2026;
const MONTH = 7;

function seed() {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([{
        id: "p-a",
        name: NAME,
        estamento: "Profesional",
        profession: "TM Imagenología",
        contractType: "Contrata",
        active: true
    }]));
    localStorage.setItem(`shift_${NAME}`, JSON.stringify(true));
    localStorage.setItem(`rotativa_${NAME}`, JSON.stringify({
        type: "4turno", start: "", firstTurn: "larga"
    }));

    localStorage.setItem(`baseData_${NAME}`, JSON.stringify({
        // Turno extra manual sin respaldo (el "?" del calendario).
        "2026-7-5": TURNO.LIBRE,
        // Turno base con marcaje: genera excedente y deficit.
        "2026-7-17": TURNO.LARGA
    }));
    localStorage.setItem(`data_${NAME}`, JSON.stringify({
        "2026-7-5": TURNO.LARGA,
        "2026-7-17": TURNO.LARGA
    }));
    // Sale antes: deja un descuento por marcaje.
    localStorage.setItem(`clockMarks_${NAME}`, JSON.stringify({
        "2026-7-17": { segments: { larga: { exitTime: "19:00" } } }
    }));
    // Turno extra CON respaldo.
    localStorage.setItem("replacements", JSON.stringify([{
        id: "rep-1",
        worker: NAME,
        date: "2026-08-09",
        year: YEAR,
        month: MONTH,
        turno: "L",
        source: "manual_extra",
        addsShift: false,
        replaced: "",
        reason: "Apoyo Oncológico",
        absenceType: "Motivo manual"
    }]));
}

function recordsByKind() {
    seed();

    const records = getHheeMonthRecords(NAME, YEAR, MONTH, {});
    const byKind = {};

    records.forEach(record => {
        byKind[record.kind] = byKind[record.kind] || [];
        byKind[record.kind].push(record);
    });

    return { records, byKind };
}

test("cada registro dice de que tipo es y a que dia apunta", () => {
    const { records } = recordsByKind();

    assert.equal(records.length > 0, true);
    records.forEach(record => {
        assert.ok(record.kind, `sin kind: ${record.label}`);
        assert.match(
            record.keyDay,
            /^\d{4}-\d{1,2}-\d{1,2}$/,
            `keyDay invalido en ${record.label}`
        );
    });
});

test("el pendiente manual lleva el turno que hay que respaldar", () => {
    const { byKind } = recordsByKind();
    const pendiente = byKind["pending-manual"]?.[0];

    assert.ok(pendiente, "falta el turno extra sin respaldo");
    assert.equal(pendiente.backed, false);
    // Sin el turno, openExtraReasonDialog no tiene que ofrecer.
    assert.equal(Number(pendiente.pendingTurn) > 0, true);
});

test("el respaldo existente lleva el id para poder anularlo", () => {
    const { byKind } = recordsByKind();
    const respaldado = byKind["backed-replacement"]?.[0];

    assert.ok(respaldado, "falta el turno extra con respaldo");
    assert.equal(respaldado.replacementId, "rep-1");
});

test("el descuento por marcaje apunta al dia del marcaje", () => {
    const { byKind } = recordsByKind();
    const descuento = byKind["deficit"]?.[0];

    assert.ok(descuento, "falta la linea de descuento");
    assert.equal(descuento.keyDay, "2026-7-17");
    assert.equal(descuento.adjustment, true);
});

test("el panel rutea cada tipo a su cuadro", async () => {
    const main = (await readFile(
        new URL("../js/main.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.match(main, /class="hh-rec__date hh-rec__date--action"/);
    assert.match(main, /data-hhee-record-index="\$\{index\}"/);
    assert.match(main, /async function openHheeRecordAction\(record\)/);

    // Agregar respaldo.
    assert.match(main, /record\.kind === "pending-manual"[\s\S]{0,200}openExtraReasonDialog/);
    assert.match(main, /record\.kind === "pending-clock"[\s\S]{0,200}openClockExtraReasonDialog/);
    // Modificar marcaje.
    assert.match(
        main,
        /record\.kind === "clock-backing" \|\| record\.kind === "deficit"[\s\S]{0,220}openClockMarkDetailForDate/
    );
    // Anular horas extras.
    assert.match(main, /openReplacementDetailDialog\?\.\(\s*\n\s*profileName,\s*\n\s*keyDay,\s*\n\s*record\.replacementId/);

    // Resolver desde aca repinta la propia lista.
    assert.match(
        main,
        /addEventListener\("proturnos:calendarProfilesChanged"[\s\S]{0,260}renderProfileHoursSummary/
    );
});

test("el detalle del marcaje tiene entrada desde fuera del calendario", async () => {
    const calendar = (await readFile(
        new URL("../js/calendar.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    // Resuelve por su cuenta fecha, turno realizado y feriados.
    assert.match(
        calendar,
        /window\.openClockMarkDetailForDate = async \(profile, keyDay\) => \{/
    );
    assert.match(calendar, /const holidays = await fetchHolidays\(date\.getFullYear\(\)\);/);
});
