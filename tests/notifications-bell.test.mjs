// Campanita del supervisor: cuenta las solicitudes PENDIENTES del trabajador
// (permiso, cambio de turno, incidencia de marcaje) y detecta cuando llega una
// nueva por su id, para disparar el sonido/vibracion una sola vez.
import test from "node:test";
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
    pendingWorkerRequests,
    pendingRequestIds,
    hasNewPendingRequest
} = await import("../js/notificationsBell.js");

test("cuenta solo las solicitudes pendientes del trabajador", () => {
    const requests = [
        { id: "a", status: "pending", type: "swap", profile: "X" },
        { id: "b", status: "approved", type: "swap", profile: "Y" },
        { id: "c", status: "pending", type: "clock_incident", profile: "Z" },
        { id: "d", status: "pending", profile: "W" } // permiso sin type
    ];

    assert.deepEqual(
        pendingWorkerRequests(requests).map(r => r.id).sort(),
        ["a", "c", "d"]
    );
});

test("pendingRequestIds ignora las no pendientes", () => {
    const ids = pendingRequestIds([
        { id: "a", status: "pending", profile: "X" },
        { id: "b", status: "rejected", profile: "Y" }
    ]);

    assert.deepEqual([...ids], ["a"]);
});

test("detecta una solicitud nueva por id", () => {
    const previous = new Set(["a", "b"]);

    // Sin cambios: no hay nueva.
    assert.equal(hasNewPendingRequest(previous, new Set(["a", "b"])), false);
    // Aparece "c": hay nueva.
    assert.equal(hasNewPendingRequest(previous, new Set(["a", "b", "c"])), true);
    // Una solicitud que se resuelve (desaparece) NO cuenta como nueva.
    assert.equal(hasNewPendingRequest(previous, new Set(["a"])), false);
});
