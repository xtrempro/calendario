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
    isMarkMissing,
    minutesFromTime,
    scheduledEntryTime,
    shiftEndsNextMorning,
    shiftHasSeparateSegments,
    shiftStartsInTheMorning
} = await import("../js/attendanceDelay.js");
const { CONTINUES_MARK, getAttendanceCells, getEntryMarkTime } =
    await import("../js/attendanceImport.js");

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

/* =========================================================
   Base y extra el mismo dia

   Los cuatro casos, tal como los planteo el usuario. Lo que decide no es que
   haya un extra, sino CUAL empieza primero: el que empieza antes se lleva la
   llegada del dia.
========================================================= */

test("base Larga sola: se mide a las 8:00", () => {
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.LARGA,
            extraShift: TURNO.LIBRE,
            workedShift: TURNO.LARGA,
            entryTime: "08:12"
        }).minutes,
        12
    );
});

test("base Noche + extra Larga (hace un 24): NO se mide", () => {
    // Entro a las 8 por la Larga extra y siguio de largo hasta su Noche. Su
    // base empieza a las 20:00, pero a esa hora ya estaba adentro.
    const dia = entryDelayForDay({
        baseShift: TURNO.NOCHE,
        extraShift: TURNO.LARGA,
        workedShift: TURNO.TURNO24,
        entryTime: "08:40"
    });

    assert.equal(dia.minutes, 0);
    assert.equal(dia.missingEntry, false);
});

test("base Larga + extra Noche (tambien un 24): SI se mide, a las 8:05", () => {
    // El mismo 24 horas, pero al reves: la llegada de la manana es la de su
    // turno base, asi que el margen corre sobre las 8:00.
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.LARGA,
            extraShift: TURNO.NOCHE,
            workedShift: TURNO.TURNO24,
            entryTime: "08:05"
        }).minutes,
        0
    );
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.LARGA,
            extraShift: TURNO.NOCHE,
            workedShift: TURNO.TURNO24,
            entryTime: "08:06"
        }).minutes,
        6
    );
});

test("base Noche + extra Diurno tampoco se mide", () => {
    // Mismo principio que el 24: el extra de la manana se lleva la llegada.
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.NOCHE,
            extraShift: TURNO.DIURNO,
            workedShift: TURNO.DIURNO_NOCHE,
            entryTime: "08:30"
        }).minutes,
        0
    );
});

test("base Diurno + extra Noche si se mide", () => {
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.DIURNO,
            extraShift: TURNO.NOCHE,
            workedShift: TURNO.DIURNO_NOCHE,
            entryTime: "08:20"
        }).minutes,
        20
    );
});

test("una extension horaria no se lleva la llegada", () => {
    // Extension horaria alarga el turno por el otro extremo: la entrada sigue
    // siendo la del turno base.
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.DIURNO,
            extraShift: TURNO.MEDIA_TARDE,
            workedShift: TURNO.LARGA,
            entryTime: "08:15"
        }).minutes,
        15
    );
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

test("la salida sin registro lleva la misma cruz que la entrada", () => {
    // Misma regla, otra columna: se trabajo y no hay marca.
    assert.equal(
        isMarkMissing({ mark: "", workedShift: TURNO.NOCHE }),
        true
    );
    assert.equal(
        isMarkMissing({ mark: "08:08", workedShift: TURNO.NOCHE }),
        false
    );
});

test("un dia que TODAVIA no ocurre no tiene marcas que falten", () => {
    // Sin esto, el reporte del mes en curso salia lleno de cruces de manana en
    // adelante: turnos programados que nadie podia haber marcado aun.
    assert.equal(
        isMarkMissing({
            mark: "",
            workedShift: TURNO.LARGA,
            hasPassed: false
        }),
        false
    );
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.LARGA,
            workedShift: TURNO.LARGA,
            entryTime: "",
            hasPassed: false
        }).missingEntry,
        false
    );
});

test("con ausencia tampoco falta ninguna marca", () => {
    assert.equal(
        isMarkMissing({ mark: "", workedShift: TURNO.LARGA, absent: true }),
        false
    );
});

test("el reporte corta las cruces en el dia de hoy", () => {
    assert.match(reporte, /function startOfToday\(\)/);
    assert.match(reporte, /hasPassed: date < today,/);

    const usos = reporte.match(/const today = startOfToday\(\);/g) || [];

    assert.equal(usos.length, 3, "algun constructor no sabe que dia es hoy");
});

test("la cruz de salida usa el mismo estilo que la de entrada", () => {
    assert.match(
        reporte,
        /title: MISSING_EXIT_TITLE,\s*\n\s*className: "report-cell--missing-entry"/
    );
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
   La salida del turno de noche viaja al dia del turno

   El reloj deja la salida de un turno con noche en el dia SIGUIENTE, que suele
   ser un libre. Es correcto pero se lee mal: la fila del turno queda sin
   salida y un dia libre aparece con una. Se la trae al dia en que se entro.
========================================================= */

function marcasDelEjemplo() {
    // Las tres filas de la imagen del usuario.
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            // 03-08: hizo un 24 (Larga + Noche). Entra y no sale ese dia.
            "2026-08-03": [{ time: "07:57", type: "in" }],
            // 04-08: la salida de las 08:10 cierra el 24 del dia 3. A las
            // 19:40 entra a SU turno de noche.
            "2026-08-04": [
                { time: "08:10", type: "out" },
                { time: "19:40", type: "in" }
            ],
            // 05-08 es libre: esta salida cierra la noche del dia 4.
            "2026-08-05": [{ time: "08:08", type: "out" }]
        }
    }));
}

test("el 24 muestra su salida del dia siguiente, con la fecha original", () => {
    marcasDelEjemplo();

    const dia = getAttendanceCells("1-9", "2026-08-03", {
        endsNextMorning: true
    });

    assert.equal(dia.entrada, "07:57");
    assert.equal(dia.salida, "08:10");
    assert.equal(dia.salidaFrom, "2026-08-04");
});

test("la noche del dia 4 toma la salida del 5, no la del 4", () => {
    // La del 4 a las 08:10 es del turno de anoche; la suya es la del 5.
    marcasDelEjemplo();

    const dia = getAttendanceCells("1-9", "2026-08-04", {
        endsNextMorning: true,
        previousEndsNextMorning: true
    });

    assert.equal(dia.entrada, "19:40");
    assert.equal(dia.salida, "08:08");
    assert.equal(dia.salidaFrom, "2026-08-05");
});

test("el libre siguiente queda SIN salida: ya se mostro en su turno", () => {
    // Sin esto la misma marca apareceria dos veces en el reporte.
    marcasDelEjemplo();

    const dia = getAttendanceCells("1-9", "2026-08-05", {
        previousEndsNextMorning: true
    });

    assert.equal(dia.entrada, "");
    assert.equal(dia.salida, "");
});

test("un turno de dia no mueve nada", () => {
    marcasDelEjemplo();

    const dia = getAttendanceCells("1-9", "2026-08-04");

    // Comportamiento de siempre: lo que se marco ese dia, tal cual.
    assert.equal(dia.salida, "08:10");
    assert.equal(dia.salidaFrom, undefined);
});

test("sin salida al dia siguiente la celda queda vacia", () => {
    // Entro a su Noche y nunca marco el termino. La celda queda vacia -y con
    // cruz en el reporte-: una marca de mitad de turno no es el termino, y
    // mostrarla como tal seria peor que dejarla en blanco.
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": { "2026-08-10": [{ time: "19:55", type: "in" }] }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-10", {
        endsNextMorning: true,
        workedShift: TURNO.NOCHE,
        scheduledEntry: "20:00"
    });

    assert.equal(dia.entrada, "19:55");
    assert.equal(dia.salida, "");
    assert.equal(dia.salidaFrom, undefined);
});

test("el traslado cruza el fin de mes", () => {
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-31": [{ time: "19:50", type: "in" }],
            "2026-09-01": [{ time: "08:05", type: "out" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-31", {
        endsNextMorning: true
    });

    assert.equal(dia.salida, "08:05");
    assert.equal(dia.salidaFrom, "2026-09-01");
});

test("el reporte marca la salida movida y dice de que dia viene", () => {
    assert.match(reporte, /const MOVED_EXIT_MARK = "\*";/);
    assert.match(reporte, /const MOVED_EXIT_TITLE = "Marcado el";/);
    assert.match(
        reporte,
        /`\$\{MOVED_EXIT_TITLE\} \$\{formatDate\(cells\.salidaFrom\)\}`/
    );
    assert.match(estilos, /\.report-table td\.report-cell--moved-exit,/);
});

test("los tres constructores informan el turno de anoche", () => {
    // Sin el, la salida de un turno de noche saldria dos veces: en la fila del
    // turno y otra vez en el libre del dia siguiente.
    const usos = reporte.match(/previousWorkedShift: actualStateForReport\(/g) || [];

    assert.equal(usos.length, 3);
    assert.match(reporte, /previousDayKey\(keyDay\)/);
});

test("los tres constructores informan tambien el turno de manana", () => {
    // Sin el no se puede saber si la noche continua en el turno siguiente, que
    // es lo que decide entre poner una flecha o una cruz.
    const usos = reporte.match(/nextWorkedShift: actualStateForReport\(/g) || [];

    assert.equal(usos.length, 3);
    assert.match(reporte, /nextDayKey\(keyDay\)/);
});

test("los dias vecinos se calculan cruzando meses", () => {
    // parseKey/setDate cruzan mes y anio solos; construir la clave a mano
    // fallaria el dia 1 y el ultimo de cada mes.
    assert.match(
        reporte,
        /function previousDayKey\(keyDay\) \{\s*\n\s*const date = parseKey\(keyDay\);\s*\n\s*\n\s*date\.setDate\(date\.getDate\(\) - 1\);/
    );
});

/* =========================================================
   El 24 con marcaje entre los dos tramos

   Hay quien marca al pasar de la Larga a la Noche: sale 20:00 y vuelve a
   entrar 20:00. Son cuatro marcas para un solo turno. En la tabla quedan la
   primera entrada y la ultima salida; las otras, en el hover.
========================================================= */

function marcasDelVeinticuatro() {
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-20": [
                { time: "08:00", type: "in" },
                { time: "20:00", type: "out" },
                { time: "20:00", type: "in" }
            ],
            "2026-08-21": [{ time: "08:00", type: "out" }]
        }
    }));
}

test("el 24 con marcaje intermedio muestra 08:00 y 08:00", () => {
    marcasDelVeinticuatro();

    const dia = getAttendanceCells("1-9", "2026-08-20", {
        endsNextMorning: true
    });

    assert.equal(dia.entrada, "08:00");
    assert.equal(dia.salida, "08:00");
    assert.equal(dia.salidaFrom, "2026-08-21");
});

test("las cuatro marcas del 24 quedan disponibles, en orden", () => {
    // La del dia siguiente va al final aunque su hora sea menor: cierra el
    // turno. Ordenarlas por hora la pondria primera y mentiria.
    marcasDelVeinticuatro();

    const dia = getAttendanceCells("1-9", "2026-08-20", {
        endsNextMorning: true
    });

    assert.deepEqual(
        dia.marks.map(marca => `${marca.time} ${marca.type}`),
        ["08:00 in", "20:00 out", "20:00 in", "08:00 out"]
    );
});

test("el atraso del 24 se mide con la PRIMERA entrada", () => {
    // Si tomara la de las 20:00 -la del segundo tramo- un turno puntual
    // apareceria con doce horas de atraso.
    marcasDelVeinticuatro();

    assert.equal(getEntryMarkTime("1-9", "2026-08-20"), "08:00");
});

test("un turno normal sin marcas intermedias no arma hover", () => {
    // Solo se esconde algo cuando hay algo que esconder.
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-20": [
                { time: "07:58", type: "in" },
                { time: "20:04", type: "out" }
            ]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-20");

    assert.equal(dia.marks.length, 2);
    assert.equal(dia.entrada, "07:58");
    assert.equal(dia.salida, "20:04");
});

test("el hover se arma solo cuando la fila esconde marcas", () => {
    assert.match(reporte, /const ALL_MARKS_TITLE = "Marcas del turno:";/);
    assert.match(reporte, /function hiddenMarksTitle\(cells\)/);
    // La cuenta es contra lo que SE MUESTRA, no contra un numero fijo: un dia
    // sin salida muestra una sola celda y con dos marcas ya esconde una.
    assert.match(
        reporte,
        /const shown = \(cells\.entrada \? 1 : 0\) \+ \(cells\.salida \? 1 : 0\);/
    );
    assert.match(reporte, /if \(marks\.length <= shown\) return "";/);
    assert.match(estilos, /\.report-table td\.report-cell--more-marks \{/);
});

/* =========================================================
   Cuando el trabajador aprieta el boton equivocado

   El reloj guarda lo que apretaron, no lo que hicieron. Si ese dia tenia turno
   programado, una "salida" a la hora de llegar fue un error involuntario: lo
   importante es que marco. La hora vale y la etiqueta equivocada se reporta
   como incidencia.
========================================================= */

const larga = { workedShift: TURNO.LARGA, scheduledEntry: "08:00" };

function marcar(dia, marcas) {
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": { [dia]: marcas }
    }));
}

test("marco salida al llegar y volvio a marcar: vale la PRIMERA", () => {
    // El usuario fue explicito: se muestra el primer marcaje, el segundo al
    // hover. Aunque la segunda sea la que dice "entrada".
    marcar("2026-08-10", [
        { time: "08:00", type: "out" },
        { time: "08:02", type: "in" },
        { time: "20:05", type: "out" }
    ]);

    const dia = getAttendanceCells("1-9", "2026-08-10", larga);

    assert.equal(dia.entrada, "08:00");
    assert.equal(dia.entryIncident, true);
    assert.equal(dia.salida, "20:05");
    assert.equal(dia.exitIncident, false);
    // La segunda no se pierde: queda en marks, que alimenta el hover.
    assert.equal(dia.marks.length, 3);
});

test("marco salida al llegar y NO volvio a marcar: vale igual", () => {
    marcar("2026-08-10", [
        { time: "08:00", type: "out" },
        { time: "20:05", type: "out" }
    ]);

    const dia = getAttendanceCells("1-9", "2026-08-10", larga);

    assert.equal(dia.entrada, "08:00");
    assert.equal(dia.entryIncident, true);
    assert.equal(dia.salida, "20:05");
});

test("marco entrada al irse: se registra como salida", () => {
    marcar("2026-08-10", [
        { time: "07:58", type: "in" },
        { time: "20:05", type: "in" }
    ]);

    const dia = getAttendanceCells("1-9", "2026-08-10", larga);

    assert.equal(dia.entrada, "07:58");
    assert.equal(dia.entryIncident, false);
    assert.equal(dia.salida, "20:05");
    assert.equal(dia.exitIncident, true);
});

test("con una sola marca decide la hora, no la etiqueta", () => {
    // A la hora de entrar es la entrada, aunque diga salida.
    marcar("2026-08-10", [{ time: "08:03", type: "out" }]);
    let dia = getAttendanceCells("1-9", "2026-08-10", larga);

    assert.equal(dia.entrada, "08:03");
    assert.equal(dia.entryIncident, true);
    assert.equal(dia.salida, "");

    // Doce horas despues es la salida, y ahi la etiqueta "salida" esta bien:
    // lo que falta es la entrada.
    marcar("2026-08-10", [{ time: "20:05", type: "out" }]);
    dia = getAttendanceCells("1-9", "2026-08-10", larga);

    assert.equal(dia.entrada, "");
    assert.equal(dia.salida, "20:05");
    assert.equal(dia.exitIncident, false);
});

test("un dia SIN turno no se corrige: manda el reloj", () => {
    // La correccion se apoya en que habia turno programado. Sin turno no hay
    // nada contra que contrastar y reinterpretar seria inventar.
    marcar("2026-08-10", [{ time: "08:00", type: "out" }]);

    const dia = getAttendanceCells("1-9", "2026-08-10");

    assert.equal(dia.entrada, "");
    assert.equal(dia.salida, "08:00");
    assert.equal(dia.entryIncident, false);
});

test("sin horario de ingreso conocido y una sola marca, manda el reloj", () => {
    // Turnos como 24h o D+N todavia no tienen hora de ingreso acordada.
    marcar("2026-08-10", [{ time: "08:00", type: "out" }]);

    const dia = getAttendanceCells("1-9", "2026-08-10", {
        workedShift: TURNO.TURNO24
    });

    assert.equal(dia.entrada, "");
    assert.equal(dia.salida, "08:00");
});

test("el atraso se mide con la entrada corregida", () => {
    // Es la consecuencia que importa: si tomara solo las marcas con etiqueta
    // "entrada", quien se equivoco al llegar apareceria sin marca y con cruz,
    // en vez de con sus minutos de atraso.
    marcar("2026-08-10", [
        { time: "08:20", type: "out" },
        { time: "20:05", type: "out" }
    ]);

    const dia = getAttendanceCells("1-9", "2026-08-10", larga);
    const atraso = entryDelayForDay({
        baseShift: TURNO.LARGA,
        workedShift: TURNO.LARGA,
        entryTime: dia.entrada
    });

    assert.equal(atraso.minutes, 20);
    assert.equal(atraso.missingEntry, false);
});

test("si anoche hubo Noche, la salida temprana NO es una incidencia", () => {
    // Encontrado al probar el reporte completo: con turno de noche el dia
    // anterior, una "salida" a las 08:00 es su cierre, no un boton mal
    // apretado. Gana el cierre del turno de anoche, que es lo unico que
    // explica una salida a esa hora.
    marcar("2026-08-10", [
        { time: "08:00", type: "out" },
        { time: "08:02", type: "in" },
        { time: "20:05", type: "out" }
    ]);

    const dia = getAttendanceCells("1-9", "2026-08-10", {
        ...larga,
        previousEndsNextMorning: true
    });

    assert.equal(dia.entrada, "08:02");
    assert.equal(dia.entryIncident, false);
    // Y la de las 08:00 no aparece: se muestra en la fila del turno de anoche.
    assert.equal(dia.marks.length, 2);
});

test("el reporte usa la entrada resuelta para el atraso", () => {
    assert.match(reporte, /entryTime: cells\.entrada,/);
    assert.doesNotMatch(reporte, /entryTime: getEntryMarkTime\(/);
});

test("la incidencia tiene simbolo, explicacion y estilo propios", () => {
    assert.match(reporte, /const INCIDENT_MARK = "⚠";/);
    assert.match(
        reporte,
        /const ENTRY_INCIDENT_TITLE =\s*\n?\s*"Incidencia: marco salida en vez de entrada";/
    );
    assert.match(
        reporte,
        /const EXIT_INCIDENT_TITLE =\s*\n?\s*"Incidencia: marco entrada en vez de salida";/
    );
    assert.match(estilos, /\.report-table td\.report-cell--mark-incident \{/);
});

/* =========================================================
   El turno que continua sin marcaje

   Una noche termina a las 8 y el turno de la manana empieza a las 8: el
   trabajador no sale, asi que no hay nada que marcar. La celda lleva una
   flecha, no una cruz, y no se mide atraso.
========================================================= */

const noche = {
    workedShift: TURNO.NOCHE,
    scheduledEntry: "20:00",
    endsNextMorning: true
};

test("caso 1: no marca la salida de la noche ni la entrada de la Larga", () => {
    marcar("2026-08-15", [{ time: "20:08", type: "in" }]);
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-15": [{ time: "20:08", type: "in" }],
            "2026-08-16": [{ time: "20:00", type: "out" }]
        }
    }));

    const laNoche = getAttendanceCells("1-9", "2026-08-15", {
        ...noche,
        nextStartsInTheMorning: true
    });

    assert.equal(laNoche.entrada, "20:08");
    assert.equal(laNoche.salida, CONTINUES_MARK);
    assert.equal(laNoche.exitArrow, true);

    const laLarga = getAttendanceCells("1-9", "2026-08-16", {
        workedShift: TURNO.LARGA,
        scheduledEntry: "08:00",
        previousEndsNextMorning: true,
        startsInTheMorning: true
    });

    assert.equal(laLarga.entrada, CONTINUES_MARK);
    assert.equal(laLarga.entryArrow, true);
    // Y su salida de las 20:00 NO se la lleva el turno de anoche.
    assert.equal(laLarga.salida, "20:00");
});

test("caso 2: no marca la salida pero si la entrada del diurno", () => {
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-18": [{ time: "20:00", type: "in" }],
            "2026-08-19": [
                { time: "08:00", type: "in" },
                { time: "17:00", type: "out" }
            ]
        }
    }));

    const laNoche = getAttendanceCells("1-9", "2026-08-18", {
        ...noche,
        nextStartsInTheMorning: true
    });

    // La entrada del diurno no se confunde con el cierre de la noche: ese dia
    // empieza turno por la manana, asi que la etiqueta manda.
    assert.equal(laNoche.salida, CONTINUES_MARK);

    const elDiurno = getAttendanceCells("1-9", "2026-08-19", {
        workedShift: TURNO.DIURNO,
        scheduledEntry: "08:00",
        previousEndsNextMorning: true,
        startsInTheMorning: true
    });

    // Aqui NO va flecha: si marco su entrada.
    assert.equal(elDiurno.entrada, "08:00");
    assert.equal(elDiurno.entryArrow, false);
    assert.equal(elDiurno.salida, "17:00");
});

test("si el dia siguiente es libre, la salida sin marcar es una falta", () => {
    // La flecha significa que el turno continua. Sin turno al que continuar,
    // lo que hay es un registro que falta.
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": { "2026-08-18": [{ time: "20:00", type: "in" }] }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-18", {
        ...noche,
        nextStartsInTheMorning: false
    });

    assert.equal(dia.salida, "");
    assert.equal(dia.exitArrow, false);
});

test("con el dia siguiente libre, la etiqueta equivocada no estorba", () => {
    // Es la pregunta del usuario: si se equivoca al cerrar la noche, se mira
    // su programacion. Ese dia no empieza turno, asi que una marca temprana
    // solo puede ser el cierre, diga entrada o salida.
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-18": [{ time: "20:00", type: "in" }],
            "2026-08-19": [{ time: "08:05", type: "in" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-18", {
        ...noche,
        nextStartsInTheMorning: false
    });

    assert.equal(dia.salida, "08:05");
    assert.equal(dia.salidaFrom, "2026-08-19");
    assert.equal(dia.exitIncident, true);
});

/* =========================================================
   D+N: dos tramos, dos lineas

   Un 24 es continuo -la Larga termina a las 20 y la Noche empieza a las 20- y
   por eso se resume en una linea. Un D+N no: el diurno termina a las 17 y la
   noche empieza a las 20. Son dos llegadas y dos salidas.
========================================================= */

test("caso 3: el D+N muestra el diurno arriba y la noche abajo", () => {
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-21": [
                { time: "08:00", type: "in" },
                { time: "17:00", type: "out" },
                { time: "19:57", type: "in" }
            ],
            "2026-08-22": [{ time: "08:01", type: "out" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-21", {
        workedShift: TURNO.DIURNO_NOCHE,
        endsNextMorning: true,
        splitSegments: true,
        nextStartsInTheMorning: true
    });

    assert.equal(dia.multiline, true);
    assert.equal(dia.entrada, "08:00\n19:57");
    assert.equal(dia.salida, "17:00\n08:01");
    assert.equal(dia.salidaFrom, "2026-08-22");
});

test("caso 4: el D+N que continua deja flecha en la noche", () => {
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-24": [
                { time: "08:01", type: "in" },
                { time: "17:00", type: "out" },
                { time: "19:54", type: "in" }
            ],
            "2026-08-25": [{ time: "17:00", type: "out" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-24", {
        workedShift: TURNO.DIURNO_NOCHE,
        endsNextMorning: true,
        splitSegments: true,
        nextStartsInTheMorning: true
    });

    assert.equal(dia.entrada, "08:01\n19:54");
    assert.equal(dia.salida, `17:00\n${CONTINUES_MARK}`);
    assert.equal(dia.exitArrow, true);
});

test("un 24 NO se parte en dos lineas: es continuo", () => {
    // La diferencia con el D+N no es capricho: en un 24 el trabajador nunca se
    // va, en un D+N si.
    assert.equal(shiftHasSeparateSegments(TURNO.TURNO24), false);
    assert.equal(shiftHasSeparateSegments(TURNO.DIURNO_NOCHE), true);
    assert.equal(shiftHasSeparateSegments(TURNO.NOCHE), false);
});

test("que turnos empiezan por la manana sale del modelo", () => {
    [TURNO.LARGA, TURNO.DIURNO, TURNO.TURNO24, TURNO.DIURNO_NOCHE,
        TURNO.MEDIA_MANANA]
        .forEach(turno => {
            assert.equal(shiftStartsInTheMorning(turno), true, `turno ${turno}`);
        });
    [TURNO.LIBRE, TURNO.NOCHE, TURNO.MEDIA_TARDE, TURNO.TURNO18]
        .forEach(turno => {
            assert.equal(shiftStartsInTheMorning(turno), false, `turno ${turno}`);
        });
});

test("la flecha no cuenta como marca que falta ni genera atraso", () => {
    assert.match(reporte, /hasPassed: day\.hasPassed && !cells\.entryArrow/);
    assert.match(reporte, /hasPassed: day\.hasPassed && !cells\.exitArrow/);
    assert.match(estilos, /\.report-table td\.report-cell--stacked \{/);
    assert.match(estilos, /white-space: pre-line;/);
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

test("los tres constructores informan tambien el turno extra del dia", () => {
    // Sin esto, quien tiene Noche de base y toma una Larga extra apareceria
    // con horas de atraso: su base empieza a las 20:00 pero entro a las 8.
    const usos = reporte.match(/extraShift: extraState,/g) || [];

    assert.equal(usos.length, 3);
    assert.match(reporte, /extraShift: day\.extraShift,/);
});

test("la cruz viaja con su explicacion", () => {
    assert.match(reporte, /const MISSING_MARK = "\\u2715";/);
    assert.match(
        reporte,
        /const MISSING_ENTRY_TITLE = "No existe registro de entrada";/
    );
    assert.match(
        reporte,
        /const MISSING_EXIT_TITLE = "No existe registro de salida";/
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
    // Solo puede apoyarse en otros modulos igual de puros.
    const permitidos = ["./constants.js", "./rulesEngine.js"];
    const origenes = [...motor.matchAll(/^import .*? from "(.+?)";$/gm)]
        .map(coincidencia => coincidencia[1]);

    assert.ok(origenes.length, "no se detectaron los imports");
    origenes.forEach(origen => {
        assert.ok(permitidos.includes(origen), `import no permitido: ${origen}`);
    });
    assert.doesNotMatch(motor, /document|window|localStorage|firebase/);
});

test("que turnos terminan a la manana siguiente sale del modelo", () => {
    // No hay una lista aparte de turnos nocturnos: se pregunta por el segmento
    // "N". Si manana se agrega un turno con noche, esto lo reconoce solo.
    assert.match(motor, /getTurnoComponentes\(shift\)\.includes\("N"\)/);

    [TURNO.NOCHE, TURNO.TURNO24, TURNO.DIURNO_NOCHE, TURNO.TURNO18]
        .forEach(turno => {
            assert.equal(shiftEndsNextMorning(turno), true, `turno ${turno}`);
        });
    [TURNO.LIBRE, TURNO.LARGA, TURNO.DIURNO, TURNO.MEDIA_MANANA, TURNO.MEDIA_TARDE]
        .forEach(turno => {
            assert.equal(shiftEndsNextMorning(turno), false, `turno ${turno}`);
        });
});
