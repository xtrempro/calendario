// Color OPCIONAL del turno devuelto en un cambio de turno: vacio = usar el color
// normal del turno; un hex valido = pintar con ese color.
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

const {
    getTurnoColorConfig,
    saveTurnoColorConfig,
    getDefaultTurnoColorConfig,
    resetTurnoColorConfig,
    invalidateTurnoColorCache
} = await import("../js/turnoColors.js");

beforeEach(() => {
    localStorage.clear();
    invalidateTurnoColorCache();
});

test("por defecto el turno devuelto no tiene color propio", () => {
    assert.equal(getTurnoColorConfig().turnChangeReturn, "");
    assert.equal(getDefaultTurnoColorConfig().turnChangeReturn, "");
});

test("guarda un color valido para el turno devuelto", () => {
    saveTurnoColorConfig({ turnChangeReturn: "#7c3aed" });
    invalidateTurnoColorCache();

    assert.equal(getTurnoColorConfig().turnChangeReturn, "#7c3aed");
});

test("un color invalido o vacio deja el turno devuelto sin color", () => {
    saveTurnoColorConfig({ turnChangeReturn: "azul" });
    invalidateTurnoColorCache();
    assert.equal(getTurnoColorConfig().turnChangeReturn, "");

    saveTurnoColorConfig({ turnChangeReturn: "" });
    invalidateTurnoColorCache();
    assert.equal(getTurnoColorConfig().turnChangeReturn, "");
});

test("restablecer/limpiar quita el color del turno devuelto", () => {
    saveTurnoColorConfig({ turnChangeReturn: "#7c3aed" });
    resetTurnoColorConfig();
    invalidateTurnoColorCache();

    assert.equal(getTurnoColorConfig().turnChangeReturn, "");
});
