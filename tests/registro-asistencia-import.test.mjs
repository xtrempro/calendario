// Importacion de las marcas del reloj control al reporte.
//
// El sistema de asistencia exporta un .xls binario (BIFF8 dentro de un compound
// file OLE), no un .xlsx. El parser que ya tenia la app lee .xlsx, que es un zip
// de XML, asi que hubo que escribir un lector propio: js/xlsReader.js.
//
// Los tests corren contra el ARCHIVO REAL exportado por el reloj
// (tests/fixtures/registro-asistencia.xls), no contra uno inventado: es la
// unica forma de saber que el lector entiende lo que ese sistema produce.
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

const { readXlsRows, dateFromExcelSerial } =
    await import("../js/xlsReader.js");
const {
    findHeader,
    getAttendanceCells,
    mergeAttendanceMarks,
    normalizeRut,
    parseAttendanceRows
} = await import("../js/attendanceImport.js");

const fixture = await readFile(
    new URL("./fixtures/registro-asistencia.xls", import.meta.url)
);
const buffer = fixture.buffer.slice(
    fixture.byteOffset,
    fixture.byteOffset + fixture.byteLength
);
const rows = readXlsRows(buffer);

const reportSource = (await readFile(
    new URL("../js/hoursReport.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const RUT = "17.816.632-8";

function sembrar() {
    localStorage.clear();
    return mergeAttendanceMarks(parseAttendanceRows(rows).marks);
}

/* =========================================================
   El lector de .xls
========================================================= */

test("lee el archivo real del reloj control", () => {
    assert.equal(rows.length, 25);
    assert.equal(rows[0].length, 11);
});

test("los acentos del encabezado sobreviven", () => {
    // El texto viene en la tabla de cadenas compartidas del BIFF, en latin-1 o
    // UTF-16 segun la cadena. Si se leyera mal, las columnas no se encontrarian.
    assert.deepEqual(rows[4], [
        "Código", "RUT", "Nombre", "Sucursal", "Departamento",
        "Reloj", "Fecha/Hora", "Tipo registro", "Dirección",
        "Estado", "Checksum"
    ]);
});

test("un archivo que no es .xls se rechaza con un mensaje claro", () => {
    assert.throws(
        () => readXlsRows(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer),
        /formato Excel esperado/
    );
});

test("la fecha de Excel se lee como hora de pared", () => {
    // Un serial de Excel NO lleva zona horaria. Tratarlo como UTC corria las
    // marcas 4 horas en Chile: un marcaje de las 08:18 aparecia como 04:18 y
    // los de la madrugada saltaban al dia anterior.
    const date = dateFromExcelSerial(rows[5][6]);

    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 7);
    assert.equal(date.getDate(), 17);
    assert.equal(date.getHours(), 8);
    assert.equal(date.getMinutes(), 18);
});

/* =========================================================
   El encabezado
========================================================= */

test("el encabezado se busca por nombre, no por posicion", () => {
    // Antes de la tabla hay titulo, rango de fechas y nombre de la empresa: el
    // encabezado no es la primera fila.
    const header = findHeader(rows);

    assert.equal(header.row, 4);
    assert.equal(header.columns.rut, 1);
    assert.equal(header.columns.timestamp, 6);
    assert.equal(header.columns.type, 7);
    assert.equal(header.columns.id, 10);
});

test("si faltan las columnas clave se avisa en vez de leer basura", () => {
    assert.throws(
        () => parseAttendanceRows([["Hola"], ["Mundo"]]),
        /No se encontraron las columnas RUT y Fecha\/Hora/
    );
});

/* =========================================================
   Las marcas
========================================================= */

test("se leen todas las marcas del archivo", () => {
    const { marks, skipped } = parseAttendanceRows(rows);

    assert.equal(marks.length, 17);
    // Las 3 descartadas son las filas de titulo y resumen, sin RUT.
    assert.equal(skipped, 3);
});

test("cada marca sale normalizada", () => {
    const { marks } = parseAttendanceRows(rows);

    assert.deepEqual(marks[0], {
        rut: "17816632-8",
        name: "ALAN PLAZA MARTINEZ",
        date: "2026-08-17",
        time: "08:18",
        type: "out",
        id: "F6EA921E"
    });
});

test("el RUT se compara sin puntos ni guion de por medio", () => {
    // El archivo lo trae con puntos y el perfil puede tenerlo de cualquier
    // forma; si no se normalizaran, nunca calzarian.
    assert.equal(normalizeRut("17.816.632-8"), "17816632-8");
    assert.equal(normalizeRut("17816632-8"), "17816632-8");
    assert.equal(normalizeRut(" 17816632 8 "), "17816632-8");
    assert.equal(normalizeRut("12.345.678-k"), "12345678-K");
    assert.equal(normalizeRut(""), "");
});

/* =========================================================
   Subir dos veces no duplica
========================================================= */

test("la primera carga guarda todo", () => {
    const result = sembrar();

    assert.equal(result.added, 17);
    assert.equal(result.duplicated, 0);
    assert.equal(result.workers, 1);
});

test("volver a subir el mismo archivo no agrega nada", () => {
    sembrar();

    const result = mergeAttendanceMarks(parseAttendanceRows(rows).marks);

    assert.equal(result.added, 0);
    assert.equal(result.duplicated, 17);
});

test("un archivo que se solapa solo agrega lo nuevo", () => {
    sembrar();

    const { marks } = parseAttendanceRows(rows);
    const mezcla = [
        ...marks.slice(0, 5),
        {
            rut: "17816632-8",
            name: "ALAN PLAZA MARTINEZ",
            date: "2026-08-19",
            time: "07:55",
            type: "in",
            id: "NUEVA0001"
        }
    ];
    const result = mergeAttendanceMarks(mezcla);

    assert.equal(result.added, 1);
    assert.equal(result.duplicated, 5);
});

test("la identidad de una marca es su checksum", () => {
    // Es lo que hace fiable la deteccion de duplicados: la misma hora podria
    // repetirse legitimamente entre archivos distintos, el checksum no.
    sembrar();

    const result = mergeAttendanceMarks([{
        rut: "17816632-8",
        date: "2026-08-17",
        // Misma hora y tipo que una ya cargada, pero otra marca.
        time: "08:18",
        type: "out",
        id: "OTRO9999"
    }]);

    assert.equal(result.added, 1);
});

/* =========================================================
   Las celdas del reporte
========================================================= */

test("entrada y salida quedan en su columna", () => {
    sembrar();

    // Del archivo: 15-08 entrada 07:57:32 y salida 20:06:22.
    assert.deepEqual(getAttendanceCells(RUT, "2026-08-15"), {
        entrada: "07:57",
        salida: "20:06"
    });
});

test("un turno de noche reparte sus marcas por dia", () => {
    sembrar();

    // El 13-08 tiene la salida del turno anterior (08:08) y la entrada del
    // turno de noche (19:54). Las dos van en el dia en que se marcaron.
    assert.deepEqual(getAttendanceCells(RUT, "2026-08-13"), {
        entrada: "19:54",
        salida: "08:08"
    });
});

test("un dia sin marcas devuelve celdas vacias", () => {
    sembrar();

    assert.deepEqual(getAttendanceCells(RUT, "2026-08-25"), {
        entrada: "",
        salida: ""
    });
    // Y un trabajador que no esta en el archivo tampoco rompe nada.
    assert.deepEqual(getAttendanceCells("99.999.999-9", "2026-08-15"), {
        entrada: "",
        salida: ""
    });
});

test("varias marcas del mismo tipo se muestran TODAS", () => {
    // Un trabajador puede salir y volver a entrar el mismo dia; esconder marcas
    // seria perder justamente lo que se quiere revisar.
    localStorage.clear();
    mergeAttendanceMarks([
        { rut: "11111111-1", date: "2026-08-10", time: "08:00", type: "in", id: "a" },
        { rut: "11111111-1", date: "2026-08-10", time: "13:00", type: "out", id: "b" },
        { rut: "11111111-1", date: "2026-08-10", time: "14:00", type: "in", id: "c" },
        { rut: "11111111-1", date: "2026-08-10", time: "18:00", type: "out", id: "d" }
    ]);

    assert.deepEqual(getAttendanceCells("11111111-1", "2026-08-10"), {
        entrada: "08:00 · 14:00",
        salida: "13:00 · 18:00"
    });
});

test("las marcas se ordenan por hora aunque lleguen desordenadas", () => {
    localStorage.clear();
    mergeAttendanceMarks([
        { rut: "22222222-2", date: "2026-08-10", time: "18:00", type: "in", id: "b" },
        { rut: "22222222-2", date: "2026-08-10", time: "08:00", type: "in", id: "a" }
    ]);

    assert.equal(
        getAttendanceCells("22222222-2", "2026-08-10").entrada,
        "08:00 · 18:00"
    );
});

/* =========================================================
   El reporte
========================================================= */

test("el detalle de turnos trae las dos columnas nuevas", () => {
    // Entre "Turno realizado" y las horas, en las dos variantes del reporte.
    assert.match(
        reportSource,
        /\{ key: "turnoRealizado", label: "Turno realizado" \},\s*\n\s*\{ key: "entrada", label: "Entrada" \},\s*\n\s*\{ key: "salida", label: "Salida" \},\s*\n\s*\{ key: "horasDiurnas"/
    );
    assert.match(
        reportSource,
        /\{ key: "turnoRealizado", label: "Turno realizado" \},\s*\n\s*\{ key: "entrada", label: "Entrada" \},\s*\n\s*\{ key: "salida", label: "Salida" \},\s*\n\s*\{ key: "hheeDiurnas"/
    );
});

test("las filas del reporte se llenan por RUT", () => {
    assert.match(reportSource, /\.\.\.getAttendanceCells\(profile\.rut, iso\)/);
});
