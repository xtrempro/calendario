// Horario propio de un trabajador.
//
// Algunos entran y salen a horas distintas de las del turno: un diurno que
// entra 8:40 y sale 17:40 (16:40 los viernes), o alguien de tercer turno con
// la Larga de 7:30 a 19:30. Sus atrasos y sus incidencias se miden contra ESE
// horario; si no, apareceria llegando tarde todos los dias.
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

const { TURNO } = await import("../js/constants.js");
const {
    getWorkerSchedule,
    normalizeWorkerSchedule,
    saveWorkerSchedule,
    scheduleSegmentsForRotativa,
    workerEntryTime,
    workerExitTime
} = await import("../js/workerSchedule.js");

const reporte = (await readFile(
    new URL("../js/hoursReport.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const LUNES = new Date(2026, 7, 17);
const VIERNES = new Date(2026, 7, 21);

/* =========================================================
   Que se puede configurar segun la rotativa
========================================================= */

test("el diurno configura un solo tramo, con su viernes", () => {
    const segmentos = scheduleSegmentsForRotativa("diurno");

    assert.equal(segmentos.length, 1);
    assert.equal(segmentos[0].key, "diurno");
    assert.equal(segmentos[0].hasFriday, true);
});

test("tercer y cuarto turno configuran Larga y Noche", () => {
    ["3turno", "4turno"].forEach(tipo => {
        assert.deepEqual(
            scheduleSegmentsForRotativa(tipo).map(s => s.key),
            ["larga", "noche"],
            tipo
        );
    });
});

test("sin rotativa no hay nada que configurar", () => {
    // Un reemplazo o un perfil sin rotativa no tiene turno base contra el cual
    // definir un horario propio.
    assert.deepEqual(scheduleSegmentsForRotativa(""), []);
    assert.deepEqual(scheduleSegmentsForRotativa("libre"), []);
});

/* =========================================================
   Los ejemplos del usuario
========================================================= */

test("diurno de 8:40 a 17:40, y 16:40 los viernes", () => {
    const horario = normalizeWorkerSchedule({
        diurno: { entry: "08:40", exit: "17:40", exitFriday: "16:40" }
    });

    assert.equal(workerEntryTime(horario, TURNO.DIURNO), "08:40");
    assert.equal(workerExitTime(horario, TURNO.DIURNO, LUNES), "17:40");
    assert.equal(workerExitTime(horario, TURNO.DIURNO, VIERNES), "16:40");
});

test("sin hora de viernes, el viernes usa la de siempre", () => {
    const horario = normalizeWorkerSchedule({
        diurno: { entry: "08:40", exit: "17:40" }
    });

    assert.equal(workerExitTime(horario, TURNO.DIURNO, VIERNES), "17:40");
});

test("tercer turno con la Larga de 7:30 a 19:30", () => {
    const horario = normalizeWorkerSchedule({
        larga: { entry: "07:30", exit: "19:30" },
        noche: { entry: "19:30", exit: "07:30" }
    });

    assert.equal(workerEntryTime(horario, TURNO.LARGA), "07:30");
    assert.equal(workerExitTime(horario, TURNO.LARGA, LUNES), "19:30");
    assert.equal(workerEntryTime(horario, TURNO.NOCHE), "19:30");
    assert.equal(workerExitTime(horario, TURNO.NOCHE, LUNES), "07:30");
});

test("en un 24 se entra por la Larga y se sale por la Noche", () => {
    // Un 24 son los dos tramos seguidos: la hora de llegada es la de la Larga
    // y la de termino, la de la Noche.
    const horario = normalizeWorkerSchedule({
        larga: { entry: "07:30", exit: "19:30" },
        noche: { entry: "19:30", exit: "07:30" }
    });

    assert.equal(workerEntryTime(horario, TURNO.TURNO24), "07:30");
    assert.equal(workerExitTime(horario, TURNO.TURNO24, LUNES), "07:30");
});

test("un tramo sin configurar no impone nada", () => {
    // Devolver "" es lo que hace que el motor caiga al horario del turno.
    const horario = normalizeWorkerSchedule({
        larga: { entry: "07:30", exit: "19:30" }
    });

    assert.equal(workerEntryTime(horario, TURNO.NOCHE), "");
    assert.equal(workerExitTime(horario, TURNO.NOCHE, LUNES), "");
});

/* =========================================================
   Lo que se guarda
========================================================= */

test("una hora a medio escribir no se guarda", () => {
    // Un campo incompleto no puede convertirse en un horario que despues mida
    // atrasos contra una hora inventada.
    const horario = normalizeWorkerSchedule({
        diurno: { entry: "8:4", exit: "25:00", exitFriday: "" }
    });

    assert.deepEqual(horario, {});
});

test("se guarda y se recupera por trabajador", () => {
    localStorage.clear();
    saveWorkerSchedule("ANA", {
        diurno: { entry: "08:40", exit: "17:40" }
    });

    assert.equal(getWorkerSchedule("ANA").diurno.entry, "08:40");
    // Y no se le pega a nadie mas.
    assert.deepEqual(getWorkerSchedule("BEATRIZ"), {});
});

test("guardar vacio borra el horario propio", () => {
    localStorage.clear();
    saveWorkerSchedule("ANA", { diurno: { entry: "08:40", exit: "17:40" } });
    saveWorkerSchedule("ANA", {});

    assert.deepEqual(getWorkerSchedule("ANA"), {});
});

/* =========================================================
   Como lo usa el motor
========================================================= */

test("la hora del dia manda sobre el horario propio", () => {
    // Y el horario propio sobre el del turno. De lo mas especifico a lo mas
    // general: una autorizacion puntual gana sobre un acuerdo permanente.
    assert.match(
        reporte,
        /return authorized\s*\n\s*\|\| workerEntryTime\(getWorkerSchedule\(profileName\), state\)\s*\n\s*\|\| formatClockTime\(first\.start\);/
    );
    assert.match(
        reporte,
        /return authorized\s*\n\s*\|\| workerExitTime\(getWorkerSchedule\(profileName\), state, date\)\s*\n\s*\|\| formatClockTime\(last\.end\);/
    );
});

test("la salida propia recibe la fecha, para saber si es viernes", () => {
    assert.match(reporte, /workerExitTime\(getWorkerSchedule\(profileName\), state, date\)/);
});

test("el horario propio se sincroniza con el resto del entorno", async () => {
    // Sin esto quedaria solo en el navegador de quien lo configuro, y otro
    // supervisor de la misma unidad veria atrasos que no existen.
    const modulos = (await readFile(
        new URL("../js/firebaseStateModules.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.match(modulos, /\["workerSchedules", "clockmarks"\]/);
});
