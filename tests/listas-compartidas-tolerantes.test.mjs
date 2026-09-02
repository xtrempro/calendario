// Lectura tolerante de las listas compartidas.
//
// Un delta mal aplicado puede dejar una lista guardada como mapa
// `{ id: registro }`. Paso en produccion el 31-08-2026: `swaps` quedo como
// objeto, .some() reventaba y el calendario no pintaba una sola casilla.
// Recargar no arreglaba nada porque el dato roto seguia ahi.
//
// Los registros no se pierden: siguen dentro, solo cambio el envase.
import test from "node:test";
import assert from "node:assert/strict";

const reemplazo = (id, worker, date) => ({ id, worker, date });

/* ======================================================================
   Lectura tolerante: una lista rota no deja la pantalla en blanco
   ====================================================================== */

test("una lista que quedo como objeto se recupera al leerla", async () => {
    // Es lo que dejo la aplicacion inutilizable: `swaps` convertido en mapa,
    // y getSwaps devolviendo un objeto sobre el que .some() revienta. Los
    // registros siguen ahi, solo cambio el envase.
    const { asRecordList } = await import("../js/storage.js");
    const corrupto = {
        r1: reemplazo("r1", "ANA", "2026-08-25"),
        r2: reemplazo("r2", "BETO", "2026-08-28")
    };
    const recuperado = asRecordList(corrupto);

    assert.ok(Array.isArray(recuperado));
    assert.deepEqual(recuperado.map(item => item.worker), ["ANA", "BETO"]);
});

test("una lista sana pasa intacta", async () => {
    const { asRecordList } = await import("../js/storage.js");
    const sana = [reemplazo("r1", "ANA", "2026-08-25")];

    assert.equal(asRecordList(sana), sana);
});

test("un valor sin sentido devuelve lista vacia, no una excepcion", async () => {
    // Una pantalla en blanco es mucho peor que un dato raro.
    const { asRecordList } = await import("../js/storage.js");

    ["basura", 42, null, undefined, true].forEach(valor => {
        assert.deepEqual(asRecordList(valor), []);
    });
});
