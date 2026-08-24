// Un P. Administrativo, un F. Legal o un F. Compensatorio dejan el dia libre
// COMPLETO. En esos dias no puede haber ningun turno, ni siquiera una noche
// extra.
//
// El caso que lo destapo: un trabajador con turno 24 podia recibir un P.
// Administrativo. Como la validacion miraba solo el turno BASE -que en un 24 es
// la Larga-, el permiso pasaba y el dia quedaba con la Larga cubierta por el
// permiso y la Noche en pie como turno extra.
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

const { MODO, TURNO } = await import("../js/constants.js");
const {
    estaBloqueadoModo,
    tieneTurnoExtraAgregado
} = await import("../js/rulesEngine.js");
const { workerHasAbsence } = await import("../js/replacements.js");

const permisos = (await readFile(
    new URL("../js/leaveEngine.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const DIA = "2026-7-17";

function bloqueado(modo, base, actual) {
    return estaBloqueadoModo(
        modo,
        DIA,
        base,
        true,          // dia habil
        {}, {}, {}, {},// admin, legal, comp, absences
        true,          // con asignacion de turno
        { actualState: actual, rotativa: "4turno" }
    );
}

/* =========================================================
   Que cuenta como turno extra
========================================================= */

test("un 24 sobre base Larga lleva una Noche extra", () => {
    assert.equal(
        tieneTurnoExtraAgregado(TURNO.LARGA, TURNO.TURNO24),
        true
    );
    // Y sobre base Noche, una Larga extra.
    assert.equal(
        tieneTurnoExtraAgregado(TURNO.NOCHE, TURNO.TURNO24),
        true
    );
});

test("un turno igual a su base no es extra", () => {
    assert.equal(tieneTurnoExtraAgregado(TURNO.LARGA, TURNO.LARGA), false);
    assert.equal(tieneTurnoExtraAgregado(TURNO.LIBRE, TURNO.LIBRE), false);
});

test("un turno sobre un dia libre es todo extra", () => {
    assert.equal(tieneTurnoExtraAgregado(TURNO.LIBRE, TURNO.NOCHE), true);
});

/* =========================================================
   No se puede aplicar el permiso sobre un turno extra
========================================================= */

test("con un 24 no se puede aplicar P. Administrativo", () => {
    // Antes se podia: la base es Larga y la validacion solo miraba la base.
    assert.equal(bloqueado(MODO.ADMIN, TURNO.LARGA, TURNO.TURNO24), true);
});

test("con una Larga sola si se puede", () => {
    // Control: si esto tambien bloqueara, la restriccion seria demasiado ancha.
    assert.equal(bloqueado(MODO.ADMIN, TURNO.LARGA, TURNO.LARGA), false);
});

test("lo mismo vale para F. Legal y F. Compensatorio", () => {
    assert.equal(bloqueado("legal", TURNO.LARGA, TURNO.TURNO24), true);
    assert.equal(bloqueado("comp", TURNO.LARGA, TURNO.TURNO24), true);
});

test("y tambien cuando el extra va sobre un dia libre", () => {
    assert.equal(bloqueado(MODO.ADMIN, TURNO.LIBRE, TURNO.NOCHE), true);
});

test("las tres funciones que aplican el permiso lo comprueban", () => {
    // El bloqueo de la celda es de la interfaz; si algo aplica el permiso por
    // otra via -una solicitud aprobada desde la PWA, por ejemplo- tiene que
    // frenar igual.
    assert.match(permisos, /function algunDiaTieneTurnoExtra\(profile, keys\)/);

    const usos = permisos.match(/algunDiaTieneTurnoExtra\(/g) || [];

    // La definicion mas las tres llamadas.
    assert.equal(usos.length, 4);
    assert.match(
        permisos,
        /if \(algunDiaTieneTurnoExtra\(currentProfile, keys\)\) return false;/
    );
    assert.match(
        permisos,
        /if \(algunDiaTieneTurnoExtra\(getCurrentProfile\(\), nuevos\)\) return false;/
    );
});

/* =========================================================
   Y al reves: no se puede agregar el turno extra sobre el permiso
========================================================= */

test("un trabajador con permiso no aparece como candidato", () => {
    ["admin", "legal", "comp"].forEach(tipo => {
        localStorage.clear();
        localStorage.setItem(`${tipo}_ANA`, JSON.stringify({ [DIA]: true }));

        assert.equal(workerHasAbsence("ANA", DIA), true, tipo);
    });
});

test("sin permiso si aparece", () => {
    localStorage.clear();

    assert.equal(workerHasAbsence("ANA", DIA), false);
});
