import assert from "node:assert/strict";
import test from "node:test";

import {
    remoteEntryId,
    remoteEntrySignature,
    selectUnappliedStateEntries
} from "../js/firebaseAppState.js";

// Dos sesiones editando el mismo mes: una agrega un turno y la otra tarda en
// verlo, o lo ve aparecer y desaparecer. El log de rendimiento mostro por que:
//
//   entries-snapshot   moduleId: "log"   changeCount: 1   entryCount: 15
//   apply-deferred                                     pendingCount: 15
//
// Firestore notifica por DOCUMENTO, y el troceo por elemento de esta rama vive
// DENTRO del documento (mapa `items`). Tocar un elemento reenvia los quince, y
// los quince se volvian a aplicar: el trabajo crecia con el tamaño de la clave
// en vez de con el tamaño del cambio. Estas pruebas sujetan el filtro.

function entrada(itemKey, value, extra = {}) {
    return {
        moduleId: "log",
        storageKey: "bitacora",
        itemKey,
        value,
        ...extra
    };
}

function firmarTodas(entries) {
    return new Map(
        entries.map(entry => [
            remoteEntryId(entry),
            remoteEntrySignature(entry)
        ])
    );
}

test("un cambio de uno no reaplica los otros catorce", () => {
    const aplicadas = Array.from({ length: 15 }, (_unused, indice) =>
        entrada(`item_${indice}`, { texto: `linea ${indice}` })
    );
    const firmas = firmarTodas(aplicadas);

    // El documento vuelve entero, pero solo el ultimo elemento es distinto.
    const reenviadas = aplicadas.map((entry, indice) =>
        indice === 14
            ? entrada("item_14", { texto: "linea corregida" })
            : entry
    );

    const pendientes = selectUnappliedStateEntries(reenviadas, firmas);

    assert.equal(pendientes.length, 1, "solo cruza el elemento que cambio");
    assert.equal(pendientes[0].itemKey, "item_14");
});

test("el documento reenviado sin cambios no encola nada", () => {
    const aplicadas = [
        entrada("a", { turno: "noche" }),
        entrada("b", { turno: "larga" })
    ];

    assert.deepEqual(
        selectUnappliedStateEntries(aplicadas, firmarTodas(aplicadas)),
        []
    );
});

test("la primera carga no filtra nada", () => {
    const entradas = [entrada("a", { turno: "noche" })];

    // Sin firmas conocidas todo es nuevo: es exactamente el arranque, donde
    // filtrar de mas dejaria la sesion sin datos.
    assert.equal(
        selectUnappliedStateEntries(entradas, new Map()).length,
        1
    );
});

test("la firma no depende del orden en que llegan las claves", () => {
    // El SDK no garantiza el orden de claves entre dos lecturas. Si la firma
    // dependiera de el, cada snapshot pareceria un cambio y el filtro seria
    // inutil justo cuando mas se necesita.
    const unOrden = entrada("a", {
        inicio: "08:00",
        fin: "20:00",
        perfil: { rut: "1-9", nombre: "Ana" }
    });
    const otroOrden = entrada("a", {
        perfil: { nombre: "Ana", rut: "1-9" },
        fin: "20:00",
        inicio: "08:00"
    });

    assert.equal(
        remoteEntrySignature(unOrden),
        remoteEntrySignature(otroOrden)
    );
    assert.deepEqual(
        selectUnappliedStateEntries([otroOrden], firmarTodas([unOrden])),
        []
    );
});

test("un borrado no se confunde con el valor que tenia", () => {
    const presente = entrada("a", { turno: "noche" });
    const borrada = entrada("a", undefined, { deleted: true });

    assert.notEqual(
        remoteEntrySignature(presente),
        remoteEntrySignature(borrada)
    );
    assert.equal(
        selectUnappliedStateEntries([borrada], firmarTodas([presente])).length,
        1,
        "el borrado tiene que cruzar el filtro"
    );
});

test("distingue valores parecidos pero distintos", () => {
    const casos = [
        [{ horas: 8 }, { horas: "8" }],
        [{ activo: false }, { activo: null }],
        [{ lista: [1, 2] }, { lista: [2, 1] }],
        [{ a: 1 }, { a: 1, b: undefined }]
    ];

    casos.forEach(([uno, otro], indice) => {
        assert.equal(
            selectUnappliedStateEntries(
                [entrada("a", otro)],
                firmarTodas([entrada("a", uno)])
            ).length,
            1,
            `el caso ${indice} tendria que verse como un cambio`
        );
    });
});
