// Un .xls con las marcas de una unidad entera fallaba con
// "Offset is outside the bounds of the DataView".
//
// La causa era una suposicion escrita en el propio codigo: los numeros de los
// primeros 109 sectores de la FAT van en la cabecera, y se dio por hecho que un
// archivo del reloj control nunca pasaria de ahi ("serian ~7 MB"). Con varios
// trabajadores si pasa. La FAT quedaba a medias, los sectores que faltaban se
// leian como `undefined` y la lectura moria.
//
// La continuacion de esa lista es la DIFAT: una cadena de sectores donde cada
// uno guarda mas numeros y, en sus ultimos 4 bytes, donde sigue la lista.
import test from "node:test";
import assert from "node:assert/strict";

const { fatSectorNumbers } = await import("../js/xlsReader.js");

const SECTOR = 512;
const POR_SECTOR = SECTOR / 4 - 1; // 127 numeros + el puntero al siguiente
const FIN = 0xfffffffe;
const LIBRE = 0xffffffff;

/**
 * Cabecera de compound file con `enCabecera` numeros de FAT y, si se pide, una
 * cadena de sectores DIFAT con el resto.
 */
function armarArchivo({ fatCount, difatSectors = 0 }) {
    const total = SECTOR * (2 + difatSectors);
    const bytes = new Uint8Array(total);
    const view = new DataView(bytes.buffer);
    let siguiente = 0;

    view.setUint32(44, fatCount, true);
    // Primer sector DIFAT y cuantos son.
    view.setUint32(68, difatSectors ? 0 : FIN, true);
    view.setUint32(72, difatSectors, true);

    // Los primeros 109 van en la cabecera, desde el offset 76.
    for (let i = 0; i < Math.min(fatCount, 109); i++) {
        view.setUint32(76 + i * 4, siguiente++, true);
    }

    // El resto, en la cadena DIFAT. El sector DIFAT n vive en el sector n del
    // archivo, o sea en el offset (n + 1) * SECTOR.
    for (let s = 0; s < difatSectors; s++) {
        const base = (s + 1) * SECTOR;

        for (let i = 0; i < POR_SECTOR; i++) {
            const quedan = fatCount - 109 - s * POR_SECTOR - i;

            view.setUint32(base + i * 4, quedan > 0 ? siguiente++ : LIBRE, true);
        }

        view.setUint32(
            base + POR_SECTOR * 4,
            s + 1 < difatSectors ? s + 1 : FIN,
            true
        );
    }

    return view;
}

test("un archivo chico se resuelve con la cabecera", () => {
    const view = armarArchivo({ fatCount: 12 });

    assert.deepEqual(
        fatSectorNumbers(view, SECTOR, 12),
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    );
});

test("justo en el limite de 109 tampoco hace falta la DIFAT", () => {
    const view = armarArchivo({ fatCount: 109 });

    assert.equal(fatSectorNumbers(view, SECTOR, 109).length, 109);
});

test("pasado el limite se sigue la DIFAT", () => {
    // Es el caso que fallaba: antes devolvia 109 y la FAT quedaba incompleta.
    const view = armarArchivo({ fatCount: 150, difatSectors: 1 });
    const numeros = fatSectorNumbers(view, SECTOR, 150);

    assert.equal(numeros.length, 150);
    // Sin huecos ni repetidos: el sector 109 en adelante viene de la DIFAT.
    assert.equal(numeros[108], 108);
    assert.equal(numeros[109], 109);
    assert.equal(numeros[149], 149);
});

test("la cadena DIFAT puede tener varios sectores", () => {
    // 109 + 127 + 127 = 363 numeros disponibles en dos sectores DIFAT.
    const view = armarArchivo({ fatCount: 300, difatSectors: 2 });
    const numeros = fatSectorNumbers(view, SECTOR, 300);

    assert.equal(numeros.length, 300);
    assert.equal(numeros[299], 299);
});

test("nunca se devuelven mas numeros de los que dice la cabecera", () => {
    const view = armarArchivo({ fatCount: 120, difatSectors: 1 });

    assert.equal(fatSectorNumbers(view, SECTOR, 120).length, 120);
});

test("una DIFAT que apunta fuera del archivo corta en vez de reventar", () => {
    // Archivo truncado o corrupto: mejor leer de menos que lanzar el error del
    // DataView, que no le dice nada a nadie.
    const bytes = new Uint8Array(SECTOR * 2);
    const view = new DataView(bytes.buffer);

    view.setUint32(44, 200, true);
    view.setUint32(68, 9999, true); // sector DIFAT inexistente
    view.setUint32(72, 1, true);

    assert.doesNotThrow(() => fatSectorNumbers(view, SECTOR, 200));
});

test("un puntero de fin en la cadena la termina", () => {
    const bytes = new Uint8Array(SECTOR * 2);
    const view = new DataView(bytes.buffer);

    view.setUint32(44, 200, true);
    view.setUint32(68, FIN, true);
    view.setUint32(72, 0, true);

    // Solo alcanza a juntar lo de la cabecera, y no se queda dando vueltas.
    assert.ok(fatSectorNumbers(view, SECTOR, 200).length <= 109);
});
