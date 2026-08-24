// Resumen de incidencias de marcaje del mes, en el inicio.
//
// Cuenta atrasos, marcas de entrada y de salida que faltan, llegadas tarde a
// turnos que no son la base, y salidas antes de hora.
//
// Sale de los MISMOS hechos que dibujan las celdas del reporte, para que el
// resumen y el reporte no puedan decir cosas distintas: si el reporte muestra
// una cruz, aqui hay un evento, y al reves.
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

const {
    ATTENDANCE_INCIDENT_KINDS,
    buildAttendanceIncidents
} = await import("../js/hoursReport.js");

const home = (await readFile(
    new URL("../js/home.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
const importacion = (await readFile(
    new URL("../js/attendanceImport.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const NOMBRE = "TRABAJADOR DE PRUEBA";
const RUT = "17816632-8";
const A = 2026;
const M = 6; // julio: mes ya pasado, para que las cruces cuenten
const PERFIL = [{ name: NOMBRE, rut: RUT }];
const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));

function sembrar(base, marcas) {
    localStorage.clear();
    set(`rotativa_${NOMBRE}`, {
        type: "4turno", start: "2026-07-01", firstTurn: "larga"
    });
    set(`shift_${NOMBRE}`, true);
    set(`baseData_${NOMBRE}`, base);
    set(`data_${NOMBRE}`, base);
    set("attendanceMarks", { [RUT]: marcas });
}

const dia = (n) => `${A}-${M}-${n}`;
const iso = (n) => `2026-07-${String(n).padStart(2, "0")}`;

/* =========================================================
   Los cinco tipos
========================================================= */

test("son los cinco que pidio el usuario, en orden", () => {
    assert.deepEqual(
        ATTENDANCE_INCIDENT_KINDS.map(kind => kind.label),
        [
            "Atrasos",
            "Sin marcaje entrada",
            "Sin marcaje salida",
            "Entrada tardía",
            "Salida temprana"
        ]
    );
});

test("un atraso en turno base se cuenta como atraso", async () => {
    // Larga: entra 08:00. Marca 08:20 -> 20 minutos.
    sembrar(
        { [dia(6)]: 1 },
        { [iso(6)]: [{ time: "08:20", type: "in" }, { time: "20:00", type: "out" }] }
    );

    const { totals, events } = await buildAttendanceIncidents(
        PERFIL,
        new Date(A, M, 1)
    );
    const delDia = events.filter(evento => evento.iso === iso(6));

    assert.equal(totals.atraso, 1);
    assert.equal(delDia[0].kind, "atraso");
    assert.match(delDia[0].detail, /20 min/);
    assert.equal(delDia[0].profile, NOMBRE);
});

test("llegar tarde a un turno extra es entrada tardia, no atraso", async () => {
    // Base libre, hace una Noche extra y marca 20:30.
    localStorage.clear();
    set(`rotativa_${NOMBRE}`, {
        type: "4turno", start: "2026-07-01", firstTurn: "larga"
    });
    set(`shift_${NOMBRE}`, true);
    set(`baseData_${NOMBRE}`, { [dia(6)]: 0 });
    set(`data_${NOMBRE}`, { [dia(6)]: 2 });
    set("attendanceMarks", {
        [RUT]: {
            [iso(6)]: [{ time: "20:30", type: "in" }],
            [iso(7)]: [{ time: "08:00", type: "out" }]
        }
    });

    const { totals } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.equal(totals.atraso, 0);
    assert.equal(totals.lateOnExtra, 1);
});

test("un turno sin marcas cuenta las dos que faltan", async () => {
    // El dia 6 no tiene marcas, pero el periodo SI esta cargado: hay marcas
    // el 3 y el 9, asi que la planilla de esos dias ya se subio y la falta del
    // 6 es real.
    sembrar({ [dia(6)]: 1 }, {
        [iso(3)]: [{ time: "08:00", type: "in" }],
        [iso(9)]: [{ time: "08:00", type: "in" }]
    });

    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));
    const delDia = events
        .filter(evento => evento.iso === iso(6))
        .map(evento => evento.kind)
        .sort();

    assert.deepEqual(delDia, ["missingEntry", "missingExit"]);
});

test("sin planilla cargada NO se inventan faltas de marcaje", async () => {
    // Los datos del reloj solo llegan al subir el .xls. Antes de eso, que no
    // haya marcas no dice nada del trabajador: dice que falta el archivo.
    // Sin esta regla, el resumen del mes en curso aparecia lleno de cruces.
    sembrar({ [dia(6)]: 1 }, {});

    const { totals } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.equal(totals.missingEntry, 0);
    assert.equal(totals.missingExit, 0);
});

test("fuera del periodo cargado tampoco", async () => {
    // La planilla cubre hasta el dia 9; del 10 en adelante no sabemos nada
    // todavia, aunque la fecha ya haya pasado.
    sembrar({ [dia(9)]: 1, [dia(20)]: 1 }, {
        [iso(9)]: [{ time: "08:00", type: "in" }, { time: "20:00", type: "out" }]
    });

    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.equal(
        events.filter(evento => evento.iso === iso(20)).length,
        0
    );
});

test("irse antes de hora es salida temprana", async () => {
    // Larga termina 20:00; se va 19:30.
    sembrar(
        { [dia(6)]: 1 },
        { [iso(6)]: [{ time: "08:00", type: "in" }, { time: "19:30", type: "out" }] }
    );

    const { totals } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.equal(totals.earlyExit, 1);
    assert.equal(totals.atraso, 0);
});

test("un dia sin problemas no genera nada", async () => {
    sembrar(
        { [dia(6)]: 1 },
        { [iso(6)]: [{ time: "07:58", type: "in" }, { time: "20:04", type: "out" }] }
    );

    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    assert.deepEqual(events.filter(evento => evento.iso === iso(6)), []);
});

test("cada evento dice de quien, de que dia y por que", async () => {
    // Es lo que hace util el detalle: sin el nombre y la fecha no se puede ir
    // a revisar el caso.
    sembrar(
        { [dia(6)]: 1 },
        { [iso(6)]: [{ time: "08:20", type: "in" }, { time: "20:00", type: "out" }] }
    );

    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));
    const delDia = events.filter(evento => evento.iso === iso(6));

    assert.equal(delDia.length, 1);
    assert.deepEqual(Object.keys(delDia[0]).sort(), [
        "detail", "iso", "kind", "profile"
    ]);
});

test("solo se mira el mes pedido", async () => {
    sembrar(
        { [dia(6)]: 1, [`${A}-${M + 1}-6`]: 1 },
        { [iso(6)]: [{ time: "08:20", type: "in" }] }
    );

    const julio = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));
    const agosto = await buildAttendanceIncidents(PERFIL, new Date(A, M + 1, 1));

    assert.ok(julio.events.some(evento => evento.iso === iso(6)));
    assert.ok(!agosto.events.some(evento => evento.iso === iso(6)));
});

test("sin trabajadores no falla ni inventa", async () => {
    localStorage.clear();

    const { events, totals } = await buildAttendanceIncidents(
        [],
        new Date(A, M, 1)
    );

    assert.deepEqual(events, []);
    ATTENDANCE_INCIDENT_KINDS.forEach(kind => {
        assert.equal(totals[kind.key], 0, kind.key);
    });
});

/* =========================================================
   El recuadro
========================================================= */

test("se puede avanzar y retroceder de mes", () => {
    assert.match(home, /data-hm="inc-prev"/);
    assert.match(home, /data-hm="inc-next"/);
    assert.match(home, /paso\.dataset\.hm === "inc-next" \? 1 : -1/);
});

test("el calculo no bloquea el inicio", () => {
    // Recorrer el mes de todos los trabajadores toma del orden de 100 ms con
    // una unidad completa: el inicio aparece y el resultado entra despues.
    assert.match(home, /Revisando el mes\.\.\./);
    assert.match(home, /void cargarIncidencias\(panel\);/);
});

test("lo calculado se descarta al subir una planilla nueva", () => {
    // Los datos del reloj solo cambian ahi, asi que no hace falta recalcular a
    // cada rato: basta con enterarse cuando cambian.
    assert.match(home, /"proturnos:attendanceMarksChanged", "proturnos:clockMarksChanged"/);
    assert.match(home, /incidenciasCache = null;/);
});

test("el aviso lo emite quien guarda las marcas", () => {
    // Asi cubre cualquier via que cargue marcas, no solo el boton de importar.
    assert.match(importacion, /proturnos:attendanceMarksChanged/);
    assert.match(importacion, /if \(added\) \{/);
});

test("solo se recalcula si el inicio esta a la vista", () => {
    assert.match(home, /document\.body\.dataset\.activeView === "home"/);
});

test("no se recalcula el mismo mes dos veces", () => {
    assert.match(
        home,
        /if \(incidenciasCache\?\.key === incidenciasMesKey\(incidenciasMes\)\) \{/
    );
});

test("cambiar de mes rapido no pinta un resultado viejo", () => {
    // Sin esto, el mes que tarda mas en calcularse pisa al que se pidio
    // despues.
    assert.match(home, /const requestId = \+\+incidenciasRequest;/);
    assert.match(home, /if \(requestId !== incidenciasRequest\) return;/);
});

test("las cinco filas se muestran aunque esten en cero", () => {
    // Ver un 0 al lado de "Sin marcaje entrada" dice algo; que la fila
    // desaparezca, no.
    assert.match(home, /\$\{cantidad \? "" : "disabled"\}/);
});

test("cada tipo abre su detalle", () => {
    assert.match(home, /data-hm="inc-kind"/);
    assert.match(home, /function incidenciasDetalleHTML\(kind\)/);
    assert.match(home, /evento\.kind === kind/);
    assert.match(home, /data-hm="inc-modal"/);
});

test("el detalle va ordenado por fecha", () => {
    assert.match(
        home,
        /\.sort\(\(a, b\) => a\.iso\.localeCompare\(b\.iso\) \|\|/
    );
});
