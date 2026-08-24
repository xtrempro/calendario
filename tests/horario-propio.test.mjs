// Horario propio de un trabajador, por periodos.
//
// Algunos entran y salen a horas distintas de las del turno: un diurno de 8:40
// a 17:40 (16:40 los viernes), o alguien de tercer turno con la Larga de 7:30
// a 19:30. Sus atrasos e incidencias se miden contra ESE horario; si no,
// apareceria llegando tarde todos los dias.
//
// Va por periodos porque un acuerdo empieza un dia: al cambiarle el horario a
// alguien, lo nuevo rige de ahi en adelante y los meses ya revisados no se
// recalculan con un horario que entonces no existia.
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
    addWorkerSchedulePeriod,
    getWorkerScheduleAt,
    getWorkerSchedulePeriods,
    normalizeWorkerSchedule,
    removeWorkerSchedulePeriod,
    saveWorkerSchedule,
    scheduleSegmentsForRotativa,
    workerEntryTime,
    workerExitTime
} = await import("../js/workerSchedule.js");

const reporte = (await readFile(
    new URL("../js/hoursReport.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const ANA = "ANA";
const LUNES = new Date(2026, 7, 17);
const VIERNES = new Date(2026, 7, 21);

function sembrar(...periodos) {
    localStorage.clear();
    saveWorkerSchedule(ANA, { periods: periodos });
}

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
    sembrar({
        from: "2026-01-01",
        diurno: { entry: "08:40", exit: "17:40", exitFriday: "16:40" }
    });

    const horario = getWorkerScheduleAt(ANA, LUNES);

    assert.equal(workerEntryTime(horario, TURNO.DIURNO), "08:40");
    assert.equal(workerExitTime(horario, TURNO.DIURNO, LUNES), "17:40");
    assert.equal(
        workerExitTime(getWorkerScheduleAt(ANA, VIERNES), TURNO.DIURNO, VIERNES),
        "16:40"
    );
});

test("sin hora de viernes, el viernes usa la de siempre", () => {
    sembrar({
        from: "2026-01-01",
        diurno: { entry: "08:40", exit: "17:40" }
    });

    assert.equal(
        workerExitTime(getWorkerScheduleAt(ANA, VIERNES), TURNO.DIURNO, VIERNES),
        "17:40"
    );
});

test("tercer turno con la Larga de 7:30 a 19:30", () => {
    sembrar({
        from: "2026-01-01",
        larga: { entry: "07:30", exit: "19:30" },
        noche: { entry: "19:30", exit: "07:30" }
    });

    const horario = getWorkerScheduleAt(ANA, LUNES);

    assert.equal(workerEntryTime(horario, TURNO.LARGA), "07:30");
    assert.equal(workerExitTime(horario, TURNO.LARGA, LUNES), "19:30");
    assert.equal(workerEntryTime(horario, TURNO.NOCHE), "19:30");
    assert.equal(workerExitTime(horario, TURNO.NOCHE, LUNES), "07:30");
});

test("en un 24 se entra por la Larga y se sale por la Noche", () => {
    sembrar({
        from: "2026-01-01",
        larga: { entry: "07:30", exit: "19:30" },
        noche: { entry: "19:30", exit: "07:30" }
    });

    const horario = getWorkerScheduleAt(ANA, LUNES);

    assert.equal(workerEntryTime(horario, TURNO.TURNO24), "07:30");
    assert.equal(workerExitTime(horario, TURNO.TURNO24, LUNES), "07:30");
});

test("un tramo sin configurar no impone nada", () => {
    // Devolver "" es lo que hace que el motor caiga al horario del turno.
    sembrar({ from: "2026-01-01", larga: { entry: "07:30", exit: "19:30" } });

    const horario = getWorkerScheduleAt(ANA, LUNES);

    assert.equal(workerEntryTime(horario, TURNO.NOCHE), "");
    assert.equal(workerExitTime(horario, TURNO.NOCHE, LUNES), "");
});

/* =========================================================
   La vigencia: lo nuevo NO recalcula hacia atras
========================================================= */

test("fuera de su periodo, el horario propio no aplica", () => {
    sembrar({
        from: "2026-08-01",
        diurno: { entry: "08:40", exit: "17:40" }
    });

    // Julio quedo antes: ese mes se sigue midiendo con el horario del turno.
    assert.deepEqual(getWorkerScheduleAt(ANA, new Date(2026, 6, 20)), {});
    assert.notEqual(getWorkerScheduleAt(ANA, LUNES).diurno, undefined);
});

test("agregar un horario cierra el anterior el dia antes", () => {
    // Es lo que impide que lo nuevo se aplique hacia atras.
    localStorage.clear();
    addWorkerSchedulePeriod(ANA, {
        from: "2026-01-01",
        diurno: { entry: "08:00", exit: "17:00" }
    });
    addWorkerSchedulePeriod(ANA, {
        from: "2026-09-01",
        diurno: { entry: "08:40", exit: "17:40" }
    });

    const periodos = getWorkerSchedulePeriods(ANA);

    assert.equal(periodos.length, 2);
    assert.equal(periodos[0].to, "2026-08-31");
    assert.equal(periodos[1].to, "");
});

test("cada fecha usa el horario que regia entonces", () => {
    localStorage.clear();
    addWorkerSchedulePeriod(ANA, {
        from: "2026-01-01",
        diurno: { entry: "08:00", exit: "17:00" }
    });
    addWorkerSchedulePeriod(ANA, {
        from: "2026-09-01",
        diurno: { entry: "08:40", exit: "17:40" }
    });

    assert.equal(
        workerEntryTime(getWorkerScheduleAt(ANA, new Date(2026, 7, 31)), TURNO.DIURNO),
        "08:00"
    );
    assert.equal(
        workerEntryTime(getWorkerScheduleAt(ANA, new Date(2026, 8, 1)), TURNO.DIURNO),
        "08:40"
    );
});

test("un periodo con termino deja de aplicar despues", () => {
    sembrar({
        from: "2026-08-01",
        to: "2026-08-15",
        diurno: { entry: "08:40", exit: "17:40" }
    });

    assert.notEqual(getWorkerScheduleAt(ANA, new Date(2026, 7, 15)).diurno, undefined);
    assert.deepEqual(getWorkerScheduleAt(ANA, new Date(2026, 7, 16)), {});
});

test("sin fecha de termino rige indefinidamente", () => {
    sembrar({
        from: "2026-08-01",
        diurno: { entry: "08:40", exit: "17:40" }
    });

    assert.notEqual(
        getWorkerScheduleAt(ANA, new Date(2030, 0, 1)).diurno,
        undefined
    );
});

test("volver a agregar la misma fecha reemplaza, no duplica", () => {
    localStorage.clear();
    addWorkerSchedulePeriod(ANA, {
        from: "2026-09-01",
        diurno: { entry: "08:40", exit: "17:40" }
    });
    addWorkerSchedulePeriod(ANA, {
        from: "2026-09-01",
        diurno: { entry: "09:00", exit: "18:00" }
    });

    const periodos = getWorkerSchedulePeriods(ANA);

    assert.equal(periodos.length, 1);
    assert.equal(periodos[0].diurno.entry, "09:00");
});

test("un periodo sin fecha de inicio no se acepta", () => {
    // Sin "desde" no se sabe a partir de cuando rige, y aplicarlo a todo el
    // historial es justamente lo que se quiere evitar.
    localStorage.clear();

    assert.equal(
        addWorkerSchedulePeriod(ANA, {
            diurno: { entry: "08:40", exit: "17:40" }
        }),
        false
    );
    assert.deepEqual(getWorkerSchedulePeriods(ANA), []);
});

test("se puede quitar un periodo", () => {
    localStorage.clear();
    addWorkerSchedulePeriod(ANA, {
        from: "2026-09-01",
        diurno: { entry: "08:40", exit: "17:40" }
    });
    removeWorkerSchedulePeriod(ANA, "2026-09-01");

    assert.deepEqual(getWorkerSchedulePeriods(ANA), []);
});

/* =========================================================
   Lo que se guarda
========================================================= */

test("una hora a medio escribir no se guarda", () => {
    // Un campo incompleto no puede convertirse en un horario que despues mida
    // atrasos contra una hora inventada.
    assert.deepEqual(
        normalizeWorkerSchedule({
            periods: [{
                from: "2026-01-01",
                diurno: { entry: "8:4", exit: "25:00", exitFriday: "" }
            }]
        }),
        {}
    );
});

test("un horario guardado con la forma vieja se sigue leyendo", () => {
    // Antes no habia periodos. Lo ya configurado se lee como un periodo sin
    // inicio, o sea vale igual que antes.
    localStorage.clear();
    localStorage.setItem("workerSchedules", JSON.stringify({
        [ANA]: { diurno: { entry: "08:40", exit: "17:40" } }
    }));

    assert.equal(
        workerEntryTime(getWorkerScheduleAt(ANA, LUNES), TURNO.DIURNO),
        "08:40"
    );
});

test("se guarda por trabajador y no se le pega a otro", () => {
    sembrar({ from: "2026-01-01", diurno: { entry: "08:40", exit: "17:40" } });

    assert.equal(getWorkerSchedulePeriods(ANA).length, 1);
    assert.deepEqual(getWorkerSchedulePeriods("BEATRIZ"), []);
});

/* =========================================================
   Como lo usa el motor
========================================================= */

test("la hora del dia manda sobre el horario propio", () => {
    // Y el horario propio sobre el del turno. De lo mas especifico a lo mas
    // general: una autorizacion puntual gana sobre un acuerdo permanente.
    assert.match(
        reporte,
        /return authorized\s*\n\s*\|\| workerEntryTime\(getWorkerScheduleAt\(profileName, date\), state\)\s*\n\s*\|\| formatClockTime\(first\.start\);/
    );
    assert.match(
        reporte,
        /return authorized\s*\n\s*\|\| workerExitTime\(getWorkerScheduleAt\(profileName, date\), state, date\)\s*\n\s*\|\| formatClockTime\(last\.end\);/
    );
});

test("el motor resuelve el horario POR FECHA", () => {
    // Si tomara el horario sin mirar la fecha, cambiarlo recalcularia todo el
    // historial con el nuevo.
    assert.match(reporte, /getWorkerScheduleAt\(profileName, date\)/);
    assert.doesNotMatch(reporte, /getWorkerSchedule\(profileName\)/);
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
