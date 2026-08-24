// Textos de la tabla compartida (SST) partidos entre registros CONTINUE.
//
// Con muchos trabajadores la SST no cabe en un registro y BIFF la parte. Cada
// trozo arranca con un byte de bandera que dice si el resto del texto viene en
// 8 o en 16 bits, y ese byte NO es texto.
//
// El lector concatenaba los trozos sin consumirlo, asi que a partir del primer
// corte todo quedaba corrido: el largo del texto siguiente se leia de bytes que
// no eran un largo, salia un numero enorme, y la lectura se iba fuera del
// buffer con "Offset is outside the bounds of the DataView".
import test from "node:test";
import assert from "node:assert/strict";

const { readSharedStrings } = await import("../js/xlsReader.js");

const SST = 0x00fc;

/**
 * Arma el cuerpo de una SST tal como quedaria despues de unir los CONTINUE,
 * junto con las posiciones de los cortes.
 */
function armarSST(textos, { cortarEn = -1 } = {}) {
    const partes = [];
    const breaks = [];
    let largo = 0;

    const empujar = (bytes) => {
        partes.push(bytes);
        largo += bytes.length;
    };

    // Cabecera: total de cadenas y cadenas unicas.
    const cabecera = new Uint8Array(8);
    new DataView(cabecera.buffer).setUint32(0, textos.length, true);
    new DataView(cabecera.buffer).setUint32(4, textos.length, true);
    empujar(cabecera);

    textos.forEach((texto, indice) => {
        const head = new Uint8Array(3);

        new DataView(head.buffer).setUint16(0, texto.length, true);
        head[2] = 0; // comprimido, sin formato ni idioma
        empujar(head);

        const chars = new Uint8Array(texto.length);

        for (let i = 0; i < texto.length; i++) chars[i] = texto.charCodeAt(i);

        if (indice === cortarEn) {
            // El texto queda partido: mitad aqui y mitad en el trozo siguiente,
            // que empieza con su byte de bandera.
            const mitad = Math.floor(texto.length / 2);

            empujar(chars.subarray(0, mitad));
            breaks.push(largo);
            empujar(new Uint8Array([0])); // bandera: sigue comprimido
            empujar(chars.subarray(mitad));
        } else {
            empujar(chars);
        }
    });

    const body = new Uint8Array(largo);
    let cursor = 0;

    partes.forEach(parte => {
        body.set(parte, cursor);
        cursor += parte.length;
    });

    return [{ opcode: SST, body, breaks }];
}

test("sin cortes se leen todos los textos", () => {
    // Control: si esto fallara, el problema seria del armador y no del lector.
    const records = armarSST(["17816632-8", "ANA SOTO", "08:00"]);

    assert.deepEqual(
        readSharedStrings(records),
        ["17816632-8", "ANA SOTO", "08:00"]
    );
});

test("un texto partido entre dos trozos se reconstruye entero", () => {
    // Es el caso que rompia: el byte de bandera del segundo trozo se colaba
    // dentro del texto y corria todo lo que venia despues.
    const records = armarSST(
        ["17816632-8", "TRABAJADOR PARTIDO", "20:15"],
        { cortarEn: 1 }
    );

    assert.deepEqual(
        readSharedStrings(records),
        ["17816632-8", "TRABAJADOR PARTIDO", "20:15"]
    );
});

test("los textos que vienen DESPUES del corte tampoco se corren", () => {
    // Lo grave no era perder un texto sino perder la alineacion: los RUT
    // siguientes salian ilegibles y sus marcas se descartaban.
    const records = armarSST(
        ["11111111-1", "PARTIDO AQUI", "22222222-2", "33333333-3"],
        { cortarEn: 1 }
    );
    const leidos = readSharedStrings(records);

    assert.equal(leidos[2], "22222222-2");
    assert.equal(leidos[3], "33333333-3");
});

test("un cuerpo truncado corta la lectura en vez de reventar", () => {
    // Antes se leia fuera del buffer y saltaba el error del DataView, que no le
    // dice nada a nadie.
    const [record] = armarSST(["11111111-1", "22222222-2"]);
    const truncado = [{
        opcode: SST,
        body: record.body.subarray(0, record.body.length - 6),
        breaks: []
    }];

    assert.doesNotThrow(() => readSharedStrings(truncado));
    // Y lo que alcanzo a leer bien se conserva.
    assert.equal(readSharedStrings(truncado)[0], "11111111-1");
});

test("una SST sin cabecera completa no rompe", () => {
    assert.deepEqual(
        readSharedStrings([{ opcode: SST, body: new Uint8Array(4), breaks: [] }]),
        []
    );
});

test("sin SST no hay textos, y no es un error", () => {
    assert.deepEqual(readSharedStrings([]), []);
});
