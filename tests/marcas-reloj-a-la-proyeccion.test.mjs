// El trabajador veia en su telefono la ENTRADA de su turno pero no la SALIDA,
// mientras que en el reporte del supervisor estaban las dos (31-08-2026, 07:53 y
// 20:10). Pasaba solo con algunos trabajadores y algunas marcas.
//
// La causa no era el disparador -importar la planilla SI pide la proyeccion-
// sino el vaciado previo. `publishHotNow` vacia a Firestore, antes de pedirla,
// las claves globales fijas mas `<prefijo><nombre>` por perfil. La planilla del
// reloj no escribe en ninguna de esas: escribe en la global `attendanceMarks`.
// Asi que la Cloud Function calculaba con las marcas viejas, y las de un
// trabajador solo aparecian si algo mas volvia a tocarlo despues.
//
// `attendanceMarks` NO puede ir en la lista global fija: el vaciado escribe
// todas las claves que recibe, cambien o no, y esa clave viaja entera (no esta
// troceada). Estaria reescribiendo el archivo del reloj completo en cada
// edicion de turno. Por eso viaja como `stateKeys` solo cuando cambio.
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

const dispatched = [];

globalThis.localStorage = new MemoryStorage();
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" },
    dispatchEvent(event) { dispatched.push(event); return true; }
};

const workerAppSrc = await readFile(
    new URL("../js/workerAppDataSync.js", import.meta.url),
    "utf8"
);
const mainSrc = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);
const importSrc = await readFile(
    new URL("../js/attendanceImport.js", import.meta.url),
    "utf8"
);

test("el importador exporta las claves que escribe", async () => {
    const { ATTENDANCE_STATE_KEYS } = await import(
        "../js/attendanceImport.js"
    );

    assert.deepEqual(
        [...ATTENDANCE_STATE_KEYS].sort(),
        ["attendanceMarks", "attendanceMarksImportedAt"]
    );

    // Que sean de verdad las que escribe, no una copia que se quedo atras.
    assert.match(importSrc, /const STORAGE_KEY = "attendanceMarks"/);
    assert.match(
        importSrc,
        /const IMPORTED_AT_KEY = "attendanceMarksImportedAt"/
    );
    assert.match(importSrc, /setJSON\(STORAGE_KEY, marks \|\| \{\}\)/);
});

test("al importar la planilla se vacian esas claves antes de pedir la proyeccion", () => {
    // El oyente del evento las manda como `stateKeys`.
    assert.match(
        mainSrc,
        /proturnos:attendanceMarksChanged[\s\S]{0,1800}stateKeys: ATTENDANCE_STATE_KEYS/
    );
    // Y las toma del modulo que las escribe, no de una constante repetida.
    assert.match(
        mainSrc,
        /import \{\s*\n\s*ATTENDANCE_STATE_KEYS,[\s\S]{0,120}from "\.\/attendanceImport\.js"/
    );
});

test("las claves extra llegan hasta el vaciado y se reintentan si falla", () => {
    // Se acumulan como los perfiles sucios...
    assert.match(workerAppSrc, /let hotPublishExtraStateKeys = new Set\(\)/);
    assert.match(workerAppSrc, /options\.stateKeys/);

    // ...se consumen y se limpian en la publicacion...
    assert.match(
        workerAppSrc,
        /const extraStateKeys = \[\.\.\.hotPublishExtraStateKeys\]/
    );
    assert.match(
        workerAppSrc,
        /await flushWorkerAppProjectionState\(\[\.\.\.dirtyNames\], extraStateKeys\)/
    );

    // ...y si el intento revienta vuelven a la cola, o la planilla se perderia
    // igual que antes pero con menos ruido.
    assert.match(
        workerAppSrc,
        /extraStateKeys\.forEach\(key => hotPublishExtraStateKeys\.add\(key\)\)/
    );
});

test("attendanceMarks NO esta en la lista global fija", () => {
    const global = workerAppSrc.match(
        /const WORKER_APP_PROJECTION_GLOBAL_STATE_KEYS = \[[\s\S]*?\]/
    )?.[0] || "";

    assert.notEqual(global, "", "no se pudo aislar la lista global");
    assert.doesNotMatch(
        global,
        /attendanceMarks/,
        "el vaciado escribe todas las claves que recibe: en la lista fija, " +
        "esto reescribiria el archivo del reloj entero en cada edicion"
    );
});

// El caso que se escapo: la salida del 31-08 ya estaba guardada de una carga
// anterior, asi que no venia entre las "30 nuevas" y su proyeccion nunca se
// pidio. En el reporte del supervisor estaba, en el telefono no, y ninguna
// carga posterior lo recuperaba.
test("una planilla republica a TODOS los que trae, no solo a los que cambian", async () => {
    const { mergeAttendanceMarks } = await import("../js/attendanceImport.js");

    const salida = {
        rut: "17816632-8",
        name: "Alan Plaza",
        date: "2026-08-31",
        time: "20:10",
        type: "salida",
        id: "m-salida"
    };

    // Primera carga: la marca entra.
    dispatched.length = 0;
    const primera = mergeAttendanceMarks([salida]);
    assert.equal(primera.added, 1);

    // Segunda carga: su marca ya estaba (duplicada), pero OTRO trabajador trae
    // una nueva. Su RUT tiene que viajar igual en el evento.
    dispatched.length = 0;
    const segunda = mergeAttendanceMarks([
        salida,
        {
            rut: "11111111-1",
            name: "Otra Persona",
            date: "2026-09-01",
            time: "08:00",
            type: "entrada",
            id: "m-otro"
        }
    ]);

    assert.equal(segunda.duplicated, 1, "su marca se reconoce como repetida");
    assert.equal(segunda.added, 1, "solo entra la del otro trabajador");

    const evento = dispatched.find(
        item => item.type === "proturnos:attendanceMarksChanged"
    );

    assert.ok(evento, "la carga tiene que anunciar el cambio");
    assert.deepEqual(
        [...evento.detail.ruts].sort(),
        ["11111111-1", "17816632-8"],
        "el RUT con marca repetida tambien se republica: pudo no haber " +
        "llegado nunca a su proyeccion"
    );
});
