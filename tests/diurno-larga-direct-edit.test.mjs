// En la edicion directa del calendario, un trabajador DIURNO debe poder pasar su
// turno a LARGA (antes solo ofrecia D+N). Larga extiende la jornada hasta las
// 20:00, sumando las horas diurnas extra sobre el diurno: 3 de lunes a jueves y
// 4 los viernes (el diurno termina 17:00 L-J y 16:00 los viernes).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(k) { return this.values.has(k) ? this.values.get(k) : null; }
    key(i) { return [...this.values.keys()][i] ?? null; }
    removeItem(k) { this.values.delete(k); }
    setItem(k, v) { this.values.set(k, String(v)); }
}

globalThis.localStorage = new MemoryStorage();

const { setJSON } = await import("../js/persistence.js");
const { calcularHorasMesPerfil } = await import("../js/hoursEngine.js");
const { getProtectedDirectEditTurn } = await import("../js/turnEngine.js");
const { TURNO } = await import("../js/constants.js");

const NOMBRE = "Diurna";
// Julio 2026: 1 = miercoles. Lunes 6, martes 7, miercoles 8, jueves 9, viernes 10.
const LUNES = "2026-6-6";
const VIERNES = "2026-6-10";

function seedDiurno() {
    localStorage.clear();
    setJSON("profiles", [
        { name: NOMBRE, contractType: "Planta", estamento: "Profesional" }
    ]);
    setJSON("rotativa_" + NOMBRE, {
        type: "diurno",
        start: "2026-07-01",
        firstTurn: "larga"
    });
}

beforeEach(seedDiurno);

test("la edicion directa de un diurno ofrece Larga (no solo D+N)", () => {
    const cycle = [];
    let actual = TURNO.DIURNO;

    for (let i = 0; i < 3; i++) {
        actual = getProtectedDirectEditTurn(NOMBRE, LUNES, actual, true, {
            effectiveBaseTurn: TURNO.DIURNO
        }).nextVisibleTurn;
        cycle.push(actual);
    }

    assert.ok(cycle.includes(TURNO.LARGA), "el ciclo debe incluir Larga");
    // Primer click desde Diurno -> Larga.
    assert.equal(cycle[0], TURNO.LARGA);
    // Y sigue permitiendo D+N y volver a Diurno.
    assert.ok(cycle.includes(TURNO.DIURNO_NOCHE));
    assert.ok(cycle.includes(TURNO.DIURNO));
});

test("Larga en un diurno suma 3 h diurnas de lunes a jueves", () => {
    setJSON("data_" + NOMBRE, { [LUNES]: TURNO.LARGA });

    const days = new Date(2026, 6, 31).getDate();
    const stats = calcularHorasMesPerfil(
        NOMBRE, 2026, 6, days, {},
        { [LUNES]: TURNO.LARGA }, {}, { d: 0, n: 0 }
    );

    assert.equal(stats.hheeDiurnas, 3);
    assert.equal(stats.hheeNocturnas, 0);
});

test("Larga en un diurno suma 4 h diurnas los viernes", () => {
    setJSON("data_" + NOMBRE, { [VIERNES]: TURNO.LARGA });

    const days = new Date(2026, 6, 31).getDate();
    const stats = calcularHorasMesPerfil(
        NOMBRE, 2026, 6, days, {},
        { [VIERNES]: TURNO.LARGA }, {}, { d: 0, n: 0 }
    );

    assert.equal(stats.hheeDiurnas, 4);
    assert.equal(stats.hheeNocturnas, 0);
});
