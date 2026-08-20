// El ranking de licencias medicas del dashboard recorria TODOS los perfiles,
// incluidos los desactivados. Un ex trabajador con muchas licencias se quedaba
// arriba del top 15 y empujaba fuera a gente que si esta en la dotacion.
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

const { buildLicenseRanking } = await import("../js/dashboard.js");
const { currentDate } = await import("../js/calendar.js");

// Dias dentro de la ventana del ranking (mes visible del calendario).
function licenseDays(count) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const map = {};

    for (let day = 1; day <= count; day++) {
        map[`${year}-${month}-${day}`] = { type: "license" };
    }

    return map;
}

function seed() {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([
        { id: "1", name: "Ana Activa", estamento: "Profesional", active: true },
        // Muchas mas licencias: sin el filtro encabezaba el ranking.
        { id: "2", name: "Beto Inactivo", estamento: "Profesional", active: false },
        { id: "3", name: "Carla Activa", estamento: "Técnico", active: true }
    ]));
    localStorage.setItem("absences_Ana Activa", JSON.stringify(licenseDays(3)));
    localStorage.setItem("absences_Beto Inactivo", JSON.stringify(licenseDays(12)));
    localStorage.setItem("absences_Carla Activa", JSON.stringify(licenseDays(1)));
}

test("los perfiles desactivados no aparecen en el ranking", () => {
    seed();

    const rows = buildLicenseRanking();

    assert.equal(
        rows.some(row => row.name === "Beto Inactivo"),
        false,
        "un perfil desactivado no es parte de la dotacion"
    );
});

test("los activos conservan su orden y sus dias", () => {
    seed();

    const rows = buildLicenseRanking();

    assert.deepEqual(
        rows.map(row => [row.name, row.days]),
        [["Ana Activa", 3], ["Carla Activa", 1]]
    );
});

test("si el inactivo era el unico con licencias, el ranking queda vacio", () => {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([
        { id: "1", name: "Ana Activa", estamento: "Profesional", active: true },
        { id: "2", name: "Beto Inactivo", estamento: "Profesional", active: false }
    ]));
    localStorage.setItem("absences_Beto Inactivo", JSON.stringify(licenseDays(9)));

    assert.deepEqual(buildLicenseRanking(), []);
});
