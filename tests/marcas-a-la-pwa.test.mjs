// Las marcas del reloj viajan a la aplicacion del trabajador.
//
// La PWA no tiene el archivo del reloj ni el motor de turnos: si intentara
// deducir las marcas, diria algo distinto al reporte. Se publican ya resueltas
// -con la salida de un turno de noche traida al dia en que se entro- para que
// el trabajador vea exactamente lo mismo que su supervisor.
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
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { dataset: {} }
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { createAttendanceMarksReader } =
    await import("../js/hoursReport.js");

const main = (await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const html = (await readFile(
    new URL("../index.html", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const importacion = (await readFile(
    new URL("../js/attendanceImport.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const sync = (await readFile(
    new URL("../js/workerAppDataSync.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

// OJO: el motor de proyeccion esta DUPLICADO. Hoy quien publica es la Cloud
// Function, y esa corre serverEngine.js; workerAppDataSync.js conserva su copia
// para el navegador del supervisor. Cablear las marcas en una sola de las dos
// es no publicarlas: fue exactamente lo que paso.
const engine = (await readFile(
    new URL("../js/serverEngine.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const NOMBRE = "TRABAJADOR";
const RUT = "1-9";
const PERFIL = { name: NOMBRE, rut: RUT };
const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// Agosto de 2026: el 17 una Larga, el 18 una Noche que cierra el 19.
function sembrar(marcas) {
    localStorage.clear();
    set(`rotativa_${NOMBRE}`, { type: "4turno", start: "2026-08-01" });
    set(`shift_${NOMBRE}`, true);

    const base = { "2026-7-17": 1, "2026-7-18": 2, "2026-7-19": 0 };

    set(`baseData_${NOMBRE}`, base);
    set(`data_${NOMBRE}`, base);
    set("attendanceMarks", { [RUT]: marcas });
}

const leer = () => createAttendanceMarksReader(PERFIL);

test("un turno con marcas devuelve entrada y salida", () => {
    sembrar({
        "2026-08-17": [
            { time: "07:58", type: "in" },
            { time: "20:04", type: "out" }
        ]
    });

    const marks = leer()("2026-7-17", new Date(2026, 7, 17), {});

    assert.equal(marks.entrada, "07:58");
    assert.equal(marks.salida, "20:04");
});

test("la salida de una noche viene traida a su dia", () => {
    // Es el punto: el trabajador la busca en el dia en que entro, no en el
    // libre del dia siguiente.
    sembrar({
        "2026-08-18": [{ time: "19:55", type: "in" }],
        "2026-08-19": [{ time: "08:03", type: "out" }]
    });

    const leerDia = leer();
    const noche = leerDia("2026-7-18", new Date(2026, 7, 18), {});

    assert.equal(noche.entrada, "19:55");
    assert.equal(noche.salida, "08:03");

    // Y el libre del dia siguiente no la muestra otra vez.
    const libre = leerDia("2026-7-19", new Date(2026, 7, 19), {});

    assert.equal(libre, null);
});

test("lo que falta viaja como falta, no como vacio", () => {
    // El periodo esta cargado -hay marcas el 17-, asi que la ausencia del 18
    // es real y la aplicacion la muestra con cruz.
    sembrar({
        "2026-08-17": [
            { time: "07:58", type: "in" },
            { time: "20:04", type: "out" }
        ],
        "2026-08-19": [{ time: "08:00", type: "out" }]
    });

    const marks = leer()("2026-7-18", new Date(2026, 7, 18), {});

    assert.equal(marks.missingEntry, true);
});

test("un dia sin nada que decir no ocupa espacio en la proyeccion", () => {
    // Viaja a cada telefono: un campo vacio por dia la engorda sin aportar.
    sembrar({});

    assert.equal(leer()("2026-7-19", new Date(2026, 7, 19), {}), null);
});

test("sin perfil no revienta", () => {
    assert.equal(createAttendanceMarksReader(null)("x", new Date(), {}), null);
});

// Las dos copias del motor tienen que llevar el mismo cableado: la Cloud
// Function publica con serverEngine.js y el navegador con workerAppDataSync.js.
for (const [nombre, src] of [
    ["serverEngine.js (Cloud Function)", engine],
    ["workerAppDataSync.js (navegador del supervisor)", sync]
]) {
    test(`${nombre}: arma el lector UNA vez por trabajador`, () => {
        // Recorre meses enteros de dias: rehacerlo por dia significaria releer
        // sus datos y el almacen de marcas una vez por jornada.
        assert.match(src, /readMarks: createAttendanceMarksReader\(profile\)/);

        const usos = src.match(/createAttendanceMarksReader\(/g) || [];

        assert.equal(usos.length, 1);
    });

    test(`${nombre}: cada dia publicado lleva sus marcas cuando las tiene`, () => {
        assert.match(src, /const marks = ctx\.readMarks\(/);
        assert.match(src, /return marks \? \{ marks \} : \{\};/);
    });
}

/* =========================================================
   Subir la planilla es lo que las envia

   Sin boton de por medio: cargar el archivo es el momento en que los datos
   cambian, y es cuando tienen que llegar al telefono.
========================================================= */

test("no hay un boton para esto: ocurre solo", () => {
    assert.doesNotMatch(html, /attendanceRepublishBtn/);
    assert.doesNotMatch(main, /bindAttendanceRepublish/);
});

test("subir una planilla republica a los trabajadores que trae", () => {
    // Lo que ve el trabajador en su aplicacion cambia con la planilla: si no
    // se republica, las marcas recien cargadas no llegan a su telefono hasta
    // que algo mas de ese trabajador cambie.
    assert.match(
        main,
        /addEventListener\("proturnos:attendanceMarksChanged"[\s\S]{0,700}scheduleWorkerAppDataPublish\(300, names, null/
    );
});

test("solo a los que venian en el archivo, no a la unidad entera", () => {
    // Republicar 42 trabajadores por una planilla de tres es trabajo y
    // escrituras de mas.
    assert.match(
        main,
        /\.filter\(profile => ruts\.has\(normalizeRut\(profile\.rut\)\)\)/
    );
});

test("el archivo informa que RUT trajo", () => {
    assert.match(importacion, /ruts: \[\.\.\.workers\]/);
});
