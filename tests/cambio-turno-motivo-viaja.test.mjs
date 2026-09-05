// El motivo de horas extra viaja con el turno que se cambia.
//
// Caso real: dos trabajadores Diurno intercambian sus Largas por la aplicacion,
// el supervisor acepta y el enroque se aplica. El turno se movia, pero el
// motivo se quedaba anclado a la casilla de ORIGEN: justificaba un turno que
// ese dia ya no se hace, y la casilla donde el turno aterriza aparecia sin
// motivo. En el reporte de horas extra eso es un turno sin respaldo.
//
// El motivo es un respaldo (`manual_extra`) anclado a una FECHA, asi que mover
// el turno sin mover el respaldo los separa.
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
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    // La bitacora lee de aqui quien esta operando.
    body: { dataset: {} }
};

const { getReplacements, saveReplacements } =
    await import("../js/storage.js");
const { moveManualExtraBackup } = await import("../js/replacements.js");
const { registrarCambio, deshacerCambioTurno, getSwaps } = await (async () => {
    const swaps = await import("../js/swaps.js");
    const storage = await import("../js/storage.js");

    return { ...swaps, getSwaps: storage.getSwaps };
})();

const MICHEL = "MICHEL";
const COLEGA = "COLEGA";
// Septiembre de 2026: cede su Larga el 3 y la recibe de vuelta el 10.
const CEDE = "2026-09-03";
const RECIBE = "2026-09-10";

// Un respaldo tal como lo deja el modal de motivo: justifica un turno de un
// dia, no agrega turno por su cuenta.
function respaldo(worker, date, turno = "L", reason = "Apoyo TAC") {
    return {
        id: `r_${worker}_${date}_${turno}`,
        worker,
        replaced: "",
        reason,
        source: "manual_extra",
        addsShift: false,
        date,
        turno,
        year: Number(date.slice(0, 4)),
        month: Number(date.slice(5, 7)) - 1,
        canceled: false
    };
}

const fechasDe = (worker, turno = "L") => getReplacements()
    .filter(item => item.worker === worker && item.turno === turno)
    .map(item => item.date);

function sembrar(replacements) {
    localStorage.clear();
    saveReplacements(replacements);
}

/* ───────── El traslado, suelto ───────── */

test("el motivo se mueve a la fecha en la que aterriza el turno", () => {
    sembrar([respaldo(MICHEL, CEDE)]);

    assert.equal(moveManualExtraBackup(MICHEL, CEDE, RECIBE, "L"), 1);
    assert.deepEqual(fechasDe(MICHEL), [RECIBE]);
});

test("y se lleva el mes con la fecha", () => {
    // `year` y `month` agrupan el respaldo por mes: dejarlos atras lo contaria
    // en un mes al que ya no pertenece.
    sembrar([respaldo(MICHEL, "2026-09-30")]);

    moveManualExtraBackup(MICHEL, "2026-09-30", "2026-10-02", "L");

    const movido = getReplacements()[0];

    assert.equal(movido.date, "2026-10-02");
    assert.equal(movido.year, 2026);
    assert.equal(movido.month, 9);
});

test("solo se mueve el motivo del turno que se cambia", () => {
    // Un dia puede tener el respaldo de un Diurno y el de una Larga: llevarse
    // los dos dejaria sin motivo a un turno que no se movio.
    sembrar([
        respaldo(MICHEL, CEDE, "L"),
        respaldo(MICHEL, CEDE, "D")
    ]);

    moveManualExtraBackup(MICHEL, CEDE, RECIBE, "L");

    assert.deepEqual(fechasDe(MICHEL, "L"), [RECIBE]);
    assert.deepEqual(fechasDe(MICHEL, "D"), [CEDE]);
});

test("no toca el motivo de otro trabajador ni el ya anulado", () => {
    sembrar([
        respaldo(COLEGA, CEDE),
        { ...respaldo(MICHEL, CEDE), canceled: true }
    ]);

    assert.equal(moveManualExtraBackup(MICHEL, CEDE, RECIBE, "L"), 0);
    assert.deepEqual(fechasDe(COLEGA), [CEDE]);
});

test("ni un reemplazo de verdad, que no es un motivo", () => {
    // Solo los respaldos `manual_extra` justifican un turno propio; un
    // reemplazo cubre a otra persona y no se mueve con este cambio.
    sembrar([{ ...respaldo(MICHEL, CEDE), source: "replacement" }]);

    assert.equal(moveManualExtraBackup(MICHEL, CEDE, RECIBE, "L"), 0);
});

/* ───────── El caso completo ───────── */

test("al registrar el cambio, cada motivo sigue a su turno", () => {
    // Michel cede su Larga el 3 y la recibe el 10; su colega, al reves.
    sembrar([
        respaldo(MICHEL, CEDE),
        respaldo(COLEGA, RECIBE)
    ]);

    registrarCambio({
        from: MICHEL,
        to: COLEGA,
        fecha: CEDE,
        devolucion: RECIBE,
        turno: "L",
        turnoDevuelto: "L",
        year: 2026,
        month: 8
    });

    assert.deepEqual(fechasDe(MICHEL), [RECIBE], "Michel cede el 3, recibe el 10");
    assert.deepEqual(fechasDe(COLEGA), [CEDE], "el colega, al reves");
});

test("y al anular el cambio, cada motivo vuelve por donde vino", () => {
    sembrar([
        respaldo(MICHEL, CEDE),
        respaldo(COLEGA, RECIBE)
    ]);

    registrarCambio({
        from: MICHEL,
        to: COLEGA,
        fecha: CEDE,
        devolucion: RECIBE,
        turno: "L",
        turnoDevuelto: "L",
        year: 2026,
        month: 8
    });
    deshacerCambioTurno(getSwaps()[0]);

    assert.deepEqual(fechasDe(MICHEL), [CEDE]);
    assert.deepEqual(fechasDe(COLEGA), [RECIBE]);
});

test("un tramo saltado no mueve turno, asi que tampoco su motivo", () => {
    sembrar([respaldo(MICHEL, CEDE)]);

    registrarCambio({
        from: MICHEL,
        to: COLEGA,
        fecha: CEDE,
        devolucion: RECIBE,
        turno: "L",
        turnoDevuelto: "L",
        year: 2026,
        month: 8
    });

    const swap = getSwaps()[0];

    // Se rehace con el tramo saltado, que es como queda cuando solo una de las
    // dos mitades del enroque se aplica.
    sembrar([respaldo(MICHEL, CEDE)]);
    localStorage.setItem(
        "swaps",
        JSON.stringify([{ ...swap, skipDevolucion: true }])
    );
    deshacerCambioTurno(getSwaps()[0]);

    assert.deepEqual(fechasDe(MICHEL), [CEDE]);
});
