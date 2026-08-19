// Un respaldo de marcaje ("clock_extra") guardaba las horas del marcaje en el
// propio registro (record.clockHours) y el panel de HH.EE usaba esa foto: solo
// recalculaba cuando venia vacia. Si despues se borraba o corregia el marcaje,
// el respaldo quedaba huerfano pero seguia mostrando -y sumando- sus horas
// antiguas. Caso real: una trabajadora con una extension horaria de 3 h el mismo
// dia veia las mismas 3 h dos veces, una como "Marcaje reloj control" y otra
// como "Extensión horaria".
import test from "node:test";
import assert from "node:assert/strict";

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

const NAME = "Barbara";
const YEAR = 2026;
const MONTH = 7;
const ISO = "2026-08-26";
const KEY = "2026-7-26";

// Respaldo del marcaje con las horas ya guardadas, tal como quedan al registrar
// el motivo de un excedente detectado por el reloj.
const CLOCK_BACKING = {
    id: "clock-1",
    worker: NAME,
    date: ISO,
    year: YEAR,
    month: MONTH,
    turno: "D",
    source: "clock_extra",
    replaced: "",
    reason: "EXTENSION APOYO RAYOS Y TAC",
    absenceType: "Marcaje reloj control",
    clockLabel: "Marcaje reloj control",
    clockHours: { d: 3, n: 0 }
};

// Extension horaria del mismo dia, registrada aparte. Esta si es real.
const MANUAL_EXTENSION = {
    id: "manual-1",
    worker: NAME,
    date: ISO,
    year: YEAR,
    month: MONTH,
    turno: "HT",
    source: "manual_extra",
    replaced: "",
    reason: "Extensión Apoyo Clínico Rx TC",
    absenceType: "Motivo manual"
};

function seed({ withClockMark, exitTime = "20:00" }) {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([{
        id: "p-b",
        name: NAME,
        estamento: "Profesional",
        profession: "TM Imagenología",
        contractType: "Contrata",
        active: true
    }]));
    localStorage.setItem(`rotativa_${NAME}`, JSON.stringify({
        type: "diurno",
        start: "2026-07-20",
        firstTurn: "larga"
    }));
    localStorage.setItem(`shift_${NAME}`, JSON.stringify(false));
    localStorage.setItem("replacements", JSON.stringify([
        CLOCK_BACKING,
        MANUAL_EXTENSION
    ]));
    localStorage.setItem(
        `clockMarks_${NAME}`,
        JSON.stringify(withClockMark
            // Miercoles: la jornada diurna termina a las 17:00, asi que salir a
            // las 20:00 deja 3 h de excedente y salir a las 19:00 deja 2 h.
            ? { [KEY]: { segments: { diurno: { exitTime } } } }
            : {})
    );
}

function recordsFor(options) {
    seed(options);

    return getHheeMonthRecords(NAME, YEAR, MONTH, {});
}

test("sin marcaje vigente, el respaldo huerfano no aporta horas", () => {
    const records = recordsFor({ withClockMark: false });
    const labels = records.map(record => record.label);

    assert.equal(
        labels.filter(label => label === "Marcaje reloj control").length,
        0,
        "el respaldo de marcaje sin marcaje no debe listarse"
    );
    // La extension horaria sigue estando: es la que representa horas reales.
    assert.deepEqual(labels, ["Extensión horaria"]);

    const total = records.reduce(
        (sum, record) => ({ d: sum.d + record.d, n: sum.n + record.n }),
        { d: 0, n: 0 }
    );

    // 3 h una sola vez, no 6.
    assert.deepEqual(total, { d: 3, n: 0 });
});

test("con marcaje vigente el respaldo si aporta sus horas", () => {
    const records = recordsFor({ withClockMark: true });
    const clock = records.find(
        record => record.label === "Marcaje reloj control"
    );

    assert.ok(clock, "con marcaje el respaldo se lista");
    assert.deepEqual({ d: clock.d, n: clock.n }, { d: 3, n: 0 });
});

test("las horas salen del marcaje vigente, no de la foto guardada", () => {
    // El respaldo guardo 3 h, pero el marcaje se corrigio a una salida a las
    // 19:00: valen 2 h. Antes se seguia mostrando la foto de 3 h.
    const records = recordsFor({ withClockMark: true, exitTime: "19:00" });
    const clock = records.find(
        record => record.label === "Marcaje reloj control"
    );

    assert.ok(clock, "el respaldo se lista mientras el marcaje exista");
    assert.deepEqual({ d: clock.d, n: clock.n }, { d: 2, n: 0 });
    assert.notEqual(clock.d, CLOCK_BACKING.clockHours.d);
});
