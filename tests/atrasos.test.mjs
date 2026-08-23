// Atrasos: minutos entre la hora de ingreso del turno y la marca de entrada.
//
// Las reglas, en las palabras del usuario:
//   - el atraso empieza a contar DESDE EL MINUTO 6, y cuando empieza se cuentan
//     TODOS los minutos, no solo los que exceden el margen: con entrada a las
//     8:00, marcar 8:06 son 6 minutos de atraso, no 1;
//   - diurno y larga entran a las 8:00, noche a las 20:00;
//   - solo cuentan los turnos BASE. Un turno extra no genera atraso aunque se
//     llegue tarde;
//   - un turno cambiado se mide en la fecha a la que se movio;
//   - sin marca de entrada, la celda Entrada muestra una cruz.
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

const { TURNO } = await import("../js/constants.js");
const {
    DELAY_GRACE_MINUTES,
    delayMinutes,
    entryDelayForDay,
    formatDelayCell,
    minutesFromTime,
    scheduledEntryTime
} = await import("../js/attendanceDelay.js");
const { getEntryMarkTime } = await import("../js/attendanceImport.js");

async function leer(ruta) {
    const fuente = await readFile(new URL(ruta, import.meta.url), "utf8");

    return fuente.replace(/\r\n/g, "\n");
}

const motor = await leer("../js/attendanceDelay.js");
const reporte = await leer("../js/hoursReport.js");
const estilos = await leer("../styles.css");

/* =========================================================
   El margen de cortesia
========================================================= */

test("hasta el minuto 5 no hay atraso", () => {
    assert.equal(DELAY_GRACE_MINUTES, 5);
    assert.equal(delayMinutes("08:00", "08:00"), 0);
    assert.equal(delayMinutes("08:01", "08:00"), 0);
    assert.equal(delayMinutes("08:05", "08:00"), 0);
});

test("desde el minuto 6 se cuentan TODOS los minutos, no solo el exceso", () => {
    // Es el detalle que el usuario subrayo: 8:06 son 6 minutos, no 1.
    assert.equal(delayMinutes("08:06", "08:00"), 6);
    assert.equal(delayMinutes("08:20", "08:00"), 20);
});

test("llegar antes no resta", () => {
    assert.equal(delayMinutes("07:50", "08:00"), 0);
    assert.equal(delayMinutes("06:00", "08:00"), 0);
});

test("los ejemplos exactos del turno de noche", () => {
    assert.equal(delayMinutes("20:05", "20:00"), 0);
    assert.equal(delayMinutes("20:40", "20:00"), 40);
});

/* =========================================================
   A que hora entra cada turno
========================================================= */

test("diurno y larga a las 8, noche a las 20", () => {
    assert.equal(scheduledEntryTime(TURNO.DIURNO), "08:00");
    assert.equal(scheduledEntryTime(TURNO.LARGA), "08:00");
    assert.equal(scheduledEntryTime(TURNO.NOCHE), "20:00");
});

test("un dia libre no tiene hora de entrada", () => {
    assert.equal(scheduledEntryTime(TURNO.LIBRE), "");
});

test("los turnos sin horario definido no miden atraso", () => {
    // 24h, D+N, 1/2M, Extension horaria y 18 horas todavia no tienen hora de
    // ingreso acordada. Inventarsela en un reporte que puede afectar el
    // registro de una persona es peor que dejar la celda vacia.
    [
        TURNO.TURNO24,
        TURNO.DIURNO_NOCHE,
        TURNO.MEDIA_MANANA,
        TURNO.MEDIA_TARDE,
        TURNO.TURNO18
    ].forEach(turno => {
        assert.equal(scheduledEntryTime(turno), "", `turno ${turno}`);
    });
});

test("el horario personalizado manda cuando exista", () => {
    // Todavia no se configura en ninguna parte; el parametro ya esta para que
    // habilitarlo despues sea cambiar quien llama y nada mas.
    assert.equal(scheduledEntryTime(TURNO.DIURNO, "09:30"), "09:30");
    // Una hora ilegible no puede dejar sin medir: se cae al horario por defecto.
    assert.equal(scheduledEntryTime(TURNO.DIURNO, "tarde"), "08:00");
});

test("una hora ilegible no inventa un atraso", () => {
    assert.equal(minutesFromTime("08:00"), 480);
    assert.equal(minutesFromTime("8:05"), 485);
    assert.equal(minutesFromTime(""), null);
    assert.equal(minutesFromTime("25:00"), null);
    assert.equal(minutesFromTime("08:70"), null);
    assert.equal(delayMinutes("", "08:00"), 0);
});

/* =========================================================
   El dia completo
========================================================= */

test("un turno base con atraso lo registra", () => {
    const dia = entryDelayForDay({
        baseShift: TURNO.DIURNO,
        workedShift: TURNO.DIURNO,
        entryTime: "08:18"
    });

    assert.equal(dia.minutes, 18);
    assert.equal(dia.scheduled, "08:00");
    assert.equal(dia.missingEntry, false);
});

test("un turno EXTRA no genera atraso aunque llegue tarde", () => {
    // La base es libre: ese dia no le tocaba. Es la regla que el usuario pidio.
    const dia = entryDelayForDay({
        baseShift: TURNO.LIBRE,
        workedShift: TURNO.DIURNO,
        entryTime: "09:30"
    });

    assert.equal(dia.minutes, 0);
});

test("un cambio de turno se mide en la fecha a la que se movio", () => {
    // El turno viajo a otro dia: alli la base es Noche y el atraso se mide
    // contra las 20:00. En la fecha original la base quedo libre y no mide.
    const donde = entryDelayForDay({
        baseShift: TURNO.NOCHE,
        workedShift: TURNO.NOCHE,
        entryTime: "20:25"
    });
    const original = entryDelayForDay({
        baseShift: TURNO.LIBRE,
        workedShift: TURNO.LIBRE,
        entryTime: ""
    });

    assert.equal(donde.minutes, 25);
    assert.equal(original.minutes, 0);
    assert.equal(original.missingEntry, false);
});

test("una licencia no genera atraso ni cruz", () => {
    const dia = entryDelayForDay({
        baseShift: TURNO.DIURNO,
        workedShift: TURNO.LIBRE,
        entryTime: "",
        absent: true
    });

    assert.equal(dia.minutes, 0);
    assert.equal(dia.missingEntry, false);
});

/* =========================================================
   La cruz de "sin registro de entrada"
========================================================= */

test("trabajo y no marco: cruz", () => {
    const dia = entryDelayForDay({
        baseShift: TURNO.DIURNO,
        workedShift: TURNO.DIURNO,
        entryTime: ""
    });

    assert.equal(dia.missingEntry, true);
    // Sin marca no se puede saber cuanto se atraso: no se inventa un numero.
    assert.equal(dia.minutes, 0);
});

test("un turno extra sin marca tambien lleva cruz", () => {
    // No genera atraso, pero que falte el registro igual hay que verlo.
    const dia = entryDelayForDay({
        baseShift: TURNO.LIBRE,
        workedShift: TURNO.NOCHE,
        entryTime: ""
    });

    assert.equal(dia.missingEntry, true);
    assert.equal(dia.minutes, 0);
});

test("un dia libre sin marca NO lleva cruz", () => {
    // No habia nada que marcar; una cruz ahi seria ruido en todo el mes.
    const dia = entryDelayForDay({
        baseShift: TURNO.LIBRE,
        workedShift: TURNO.LIBRE,
        entryTime: ""
    });

    assert.equal(dia.missingEntry, false);
});

/* =========================================================
   Que marca se toma como entrada
========================================================= */

test("se toma la entrada mas temprana, nunca una salida", () => {
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "17816632-8": {
            // Caso real del reloj: sale de la noche anterior y entra a la suya.
            "2026-08-13": [
                { time: "08:08", type: "out" },
                { time: "19:54", type: "in" }
            ],
            "2026-08-15": [
                { time: "07:57", type: "in" },
                { time: "20:06", type: "out" }
            ],
            // Solo salida: para el atraso es como no tener entrada.
            "2026-08-17": [{ time: "08:18", type: "out" }]
        }
    }));

    assert.equal(getEntryMarkTime("17816632-8", "2026-08-13"), "19:54");
    assert.equal(getEntryMarkTime("17816632-8", "2026-08-15"), "07:57");
    assert.equal(getEntryMarkTime("17816632-8", "2026-08-17"), "");
    assert.equal(getEntryMarkTime("17816632-8", "2026-08-20"), "");
});

test("la noche del 13 de agosto: entro 19:54, sin atraso", () => {
    // Cierra el circuito con datos reales de produccion.
    const dia = entryDelayForDay({
        baseShift: TURNO.NOCHE,
        workedShift: TURNO.NOCHE,
        entryTime: getEntryMarkTime("17816632-8", "2026-08-13")
    });

    assert.equal(dia.minutes, 0);
});

/* =========================================================
   La celda
========================================================= */

test("sin atraso la celda queda vacia", () => {
    // Asi la columna se lee de un vistazo y solo saltan los dias con problema.
    assert.equal(formatDelayCell(0), "");
    assert.equal(formatDelayCell(-3), "");
    assert.equal(formatDelayCell(6), "6 min");
    assert.equal(formatDelayCell(40), "40 min");
});

/* =========================================================
   Como queda en el reporte
========================================================= */

test("la columna va entre Salida y las horas, en las dos variantes", () => {
    assert.match(
        reporte,
        /\{ key: "salida", label: "Salida" \},\s*\n\s*\{ key: "atrasos", label: "Atrasos" \},\s*\n\s*\{ key: "horasDiurnas"/
    );
    assert.match(
        reporte,
        /\{ key: "salida", label: "Salida" \},\s*\n\s*\{ key: "atrasos", label: "Atrasos" \},\s*\n\s*\{ key: "hheeDiurnas"/
    );
});

test("los tres constructores miden contra el turno base CON cambios", () => {
    // Si pasaran "actual", un turno extra generaria atraso y un turno cambiado
    // se mediria en la fecha equivocada: las dos reglas del usuario, rotas.
    const usos = reporte.match(/baseShift: baseWithSwaps,/g) || [];

    assert.equal(usos.length, 3);
    assert.doesNotMatch(reporte, /baseShift: actual/);
});

test("la cruz viaja con su explicacion", () => {
    assert.match(reporte, /const MISSING_ENTRY_MARK = "\\u2715";/);
    assert.match(
        reporte,
        /const MISSING_ENTRY_TITLE = "No existe registro de entrada";/
    );
    // El renderizador escapa el texto de la celda, asi que el tooltip necesita
    // su propio soporte: sin esto el hover no existiria.
    assert.match(reporte, /title="\$\{escapeHTML\(meta\.title\)\}"/);
    assert.match(estilos, /\.report-table td\.report-cell--missing-entry \{/);
    assert.match(estilos, /cursor: help;/);
});

test("el motor de atrasos no depende de nada del navegador", () => {
    // Igual que el motor de horas extras: sin DOM, sin Firebase y sin estado,
    // para que el calculo se pueda probar solo y no cambie segun donde corra.
    const importes = motor.match(/^import .*$/gm) || [];

    assert.deepEqual(importes, ['import { TURNO } from "./constants.js";']);
    assert.doesNotMatch(motor, /document|window|localStorage|firebase/);
});
