// Una unidad espejo es una copia de solo lectura de otra unidad, para poder
// mirarla sin ser miembro de ella. Lo que este test protege no es la copia sino
// lo que NO se copia: si el espejo llevara los enlaces de las PWA, empezaria a
// publicar turnos y notificaciones a los telefonos de trabajadores reales desde
// una segunda unidad.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = (await readFile(
    new URL("../scripts/mirror-workspace.mjs", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

function listaDe(nombre) {
    const inicio = script.indexOf(`const ${nombre} = `);

    assert.notEqual(inicio, -1, `no se encontro ${nombre}`);

    // El primer cierre que aparezca: MODULES termina en "];" y EXCLUDED en "};".
    const cierres = ['];', '};']
        .map(cierre => script.indexOf(cierre, inicio))
        .filter(posicion => posicion !== -1);

    return script.slice(inicio, Math.min(...cierres) + 1);
}

test("copia solo los modulos de estado que se miran", () => {
    const modulos = listaDe("MODULES");

    ["profile", "turnos", "clockmarks", "swap", "hours", "weekly", "tasks"]
        .forEach(modulo => assert.match(modulos, new RegExp(`"${modulo}"`)));
});

test("no copia nada que llegue a un trabajador real", () => {
    const excluidas = listaDe("EXCLUDED");

    // Enlaces y datos publicados: el origen de las notificaciones duplicadas.
    assert.match(excluidas, /workerLinks:/);
    assert.match(excluidas, /workerAppData:/);
    assert.match(excluidas, /workerPushTokens:/);
    assert.match(excluidas, /workerAppInvites:/);
    // Conversaciones y solicitudes vivas.
    assert.match(excluidas, /workerMessages:/);
    assert.match(excluidas, /workerSwapRequests:/);
    assert.match(excluidas, /workerRequests:/);
    assert.match(excluidas, /workerNotifications:/);
    // Y ninguna de ellas puede aparecer en la lista que si se copia.
    const modulos = listaDe("MODULES");
    assert.doesNotMatch(modulos, /worker/i);
});

test("cada exclusion dice por que", () => {
    // El motivo es lo que evita que alguien reponga una de estas colecciones
    // pensando que faltaba por descuido.
    const excluidas = listaDe("EXCLUDED");
    const sinMotivo = excluidas
        .split("\n")
        .filter(linea => /^\s+\w+:/.test(linea))
        .filter(linea => !/: "[^"]{8,}"/.test(linea));

    assert.deepEqual(sinMotivo, []);
});

test("no escribe salvo que se lo pidan", () => {
    // El modo por defecto es simulacion: --apply es explicito.
    assert.match(script, /const APPLY = args\.includes\("--apply"\);/);
    assert.match(script, /if \(!APPLY\) continue;/);
});

test("no sobreescribe un espejo que ya tiene datos", () => {
    // Repetir la copia sobre un espejo lleno mezclaria dos fotos distintas.
    assert.match(script, /ABORTA: el destino ya tiene/);
    assert.match(script, /if \(TARGET === SOURCE\)/);
});
