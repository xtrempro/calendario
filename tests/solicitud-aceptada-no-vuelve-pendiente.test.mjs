// Aceptar un cambio de turno desde el inicio aplicaba el cambio pero la
// solicitud seguia apareciendo como pendiente en el menu Solicitudes.
//
// La resolucion se guarda local y la subida a Firestore va con 650 ms de
// retraso. En esa ventana, cualquier snapshot que llegara reemplazaba la lista
// local COMPLETA por la remota, donde la solicitud seguia pendiente. Peor: la
// subida siguiente lee la lista ya revertida y sube "pendiente" de vuelta, con
// lo que la aceptacion se pierde para siempre.
//
// El cambio de turno si quedaba aplicado porque viaja por otro modulo de estado;
// lo unico que se revertia era el estado de la solicitud, que es exactamente lo
// que se veia.
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
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { mergeRemoteRequests } =
    await import("../js/firebaseWorkerRequests.js");
const { mergeRemoteReplacementRequests } =
    await import("../js/firebaseReplacementRequests.js");

const sync = (await readFile(
    new URL("../js/firebaseWorkerRequests.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const solicitud = extra => ({
    id: "swap-1",
    type: "swap",
    profile: "Ana Soto",
    status: "pending",
    createdAt: "2026-08-01T10:00:00.000Z",
    ...extra
});

test("una solicitud recien aceptada no vuelve a pendiente", () => {
    // El caso exacto del bug: local ya la acepto, el remoto todavia no se entera.
    const local = [solicitud({ status: "accepted", acceptedAt: "2026-08-20T21:00:00.000Z" })];
    const remoto = [solicitud({ status: "pending" })];
    const { requests, remoteIsBehind } = mergeRemoteRequests(local, remoto);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].status, "accepted");
    assert.equal(requests[0].acceptedAt, "2026-08-20T21:00:00.000Z");
    // Y hay que empujar la subida: el remoto quedo atrasado.
    assert.equal(remoteIsBehind, true);
});

test("lo mismo vale para una rechazada", () => {
    const local = [solicitud({ status: "rejected", rejectReason: "Sin dotacion" })];
    const { requests } = mergeRemoteRequests(local, [solicitud({ status: "pending" })]);

    assert.equal(requests[0].status, "rejected");
    assert.equal(requests[0].rejectReason, "Sin dotacion");
});

test("el remoto manda en todo lo demas", () => {
    // La proteccion es SOLO contra volver a pendiente. Si no, dos supervisores
    // dejarian de verse los cambios entre si.
    const local = [solicitud({ status: "pending" })];
    const remoto = [solicitud({ status: "accepted", acceptedAt: "2026-08-20T22:00:00.000Z" })];
    const { requests, remoteIsBehind } = mergeRemoteRequests(local, remoto);

    assert.equal(requests[0].status, "accepted");
    assert.equal(remoteIsBehind, false);
});

test("una resuelta remota no la pisa otra resolucion local distinta", () => {
    // Si las dos estan resueltas, gana el remoto: es el que ya esta publicado.
    const local = [solicitud({ status: "accepted" })];
    const remoto = [solicitud({ status: "rejected" })];

    assert.equal(mergeRemoteRequests(local, remoto).requests[0].status, "rejected");
});

test("una solicitud que solo existe local no se borra", () => {
    // Antes el snapshot reemplazaba la lista entera: una solicitud creada aca
    // desaparecia si el snapshot llegaba antes que su subida.
    const local = [solicitud({ id: "nueva", status: "pending" })];
    const remoto = [solicitud({ id: "vieja", status: "accepted" })];
    const { requests, remoteIsBehind } = mergeRemoteRequests(local, remoto);

    assert.deepEqual(
        requests.map(request => request.id).sort(),
        ["nueva", "vieja"]
    );
    assert.equal(remoteIsBehind, true);
});

test("una solicitud que solo existe en el remoto entra tal cual", () => {
    // Es el caso normal: la PWA la creo y aca todavia no se conocia.
    const { requests, remoteIsBehind } = mergeRemoteRequests(
        [],
        [solicitud({ id: "desde-pwa" })]
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].id, "desde-pwa");
    assert.equal(remoteIsBehind, false);
});

test("el snapshot ya no reemplaza la lista a ciegas", () => {
    // El sintoma nacia de que applyRemoteSnapshot guardaba remoteRequests tal
    // cual, ignorando lo local (que ademas calculaba y no usaba).
    assert.doesNotMatch(sync, /saveWorkerRequests\(remoteRequests, \{ silent: true \}\)/);
    assert.match(sync, /mergeRemoteRequests\(\s*\n\s*localRequests,\s*\n\s*remoteRequests\s*\n\s*\)/);
    assert.match(sync, /saveWorkerRequests\(requests, \{ silent: true \}\)/);
    // Y cuando el local gana, se empuja la subida para que el remoto se ponga
    // al dia en vez de quedar discrepando.
    assert.match(sync, /if \(remoteIsBehind\) scheduleWorkerRequestUpload\(\);/);
});

/* =========================================================
   Las solicitudes de turno extra tenian el mismo defecto
========================================================= */

test("una solicitud de turno extra resuelta tampoco vuelve a pendiente", () => {
    // Mismo mecanismo, otra coleccion: aca costaria una anulacion o una
    // aceptacion de turno extra.
    const local = [{ id: "r1", status: "canceled", canceledAt: "x" }];
    const remoto = [{ id: "r1", status: "pending" }];
    const { requests, remoteIsBehind } =
        mergeRemoteReplacementRequests(local, remoto);

    assert.equal(requests[0].status, "canceled");
    assert.equal(remoteIsBehind, true);
});

test("el remoto sigue mandando en el resto", () => {
    const { requests, remoteIsBehind } = mergeRemoteReplacementRequests(
        [{ id: "r1", status: "pending" }],
        [{ id: "r1", status: "accepted" }]
    );

    assert.equal(requests[0].status, "accepted");
    assert.equal(remoteIsBehind, false);
});

test("una solicitud que solo existe local no se pierde", () => {
    const { requests } = mergeRemoteReplacementRequests(
        [{ id: "nueva", status: "pending" }],
        [{ id: "vieja", status: "accepted" }]
    );

    assert.deepEqual(requests.map(r => r.id).sort(), ["nueva", "vieja"]);
});
