// El turno anotado no calza con lo que el trabajador marco.
//
// El caso que origino esto, tal cual ocurrio: un trabajador con Noche anotada
// el 26 de agosto. Su reporte mostraba entrada 08:01 y salida 08:11*, que para
// una noche deberian ser 20:00 y 08:00*. En realidad habia hecho un 24, y lo
// habia marcado entero: entro a las 8, marco el traspaso a las 20 y cerro a
// las 8 de la manana siguiente.
//
// No salto NINGUNA alerta. El recuadro del inicio lo daba por correcto porque
// el atraso solo mira hacia adelante -entrar doce horas antes daba cero- y
// porque ningun tipo de incidencia miraba las marcas que la fila no muestra.
// Las doce horas trabajadas no aparecian en el reporte y no se pagaban.
//
// Lo que se cubre aqui son las tres reglas que cierran ese hueco:
//   - entrada anticipada: llego una hora o mas antes de su turno;
//   - salida posterior: se quedo una hora o mas despues;
//   - marcas sin justificar: marco momentos que el turno no explica.
//
// Y la propiedad que las hace usables: se apagan solas cuando el supervisor
// registra lo que faltaba.
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
    earlyEntryMinutes,
    SHIFT_DRIFT_ALERT_MINUTES,
    unexplainedMarkEvents
} = await import("../js/attendanceDelay.js");
const {
    ATTENDANCE_INCIDENT_KINDS,
    attendanceIncidentContext,
    buildAttendanceIncidents
} = await import("../js/hoursReport.js");

const estilos = (await readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const NOMBRE = "TRABAJADOR DE PRUEBA";
const RUT = "17816632-8";
const A = 2026;
const M = 7; // agosto, el mes del caso real
const PERFIL = [{ name: NOMBRE, rut: RUT }];
const NBSP = " ";

const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const dia = (n) => `${A}-${M}-${n}`;
const iso = (n) => `2026-08-${String(n).padStart(2, "0")}`;

/**
 * Siembra un trabajador con los turnos y las marcas que se le indiquen.
 *
 * `turnos` son los realizados; los base van iguales salvo que se diga otra
 * cosa, que es lo que distingue un turno extra de un turno propio.
 */
function sembrar(turnos, marcas, base = turnos) {
    localStorage.clear();
    set(`rotativa_${NOMBRE}`, {
        type: "4turno", start: "2026-08-01", firstTurn: "larga"
    });
    set(`shift_${NOMBRE}`, true);
    set(`baseData_${NOMBRE}`, base);
    set(`data_${NOMBRE}`, turnos);
    set("attendanceMarks", { [RUT]: marcas });
}

async function incidenciasDe(numeroDeDia) {
    const { events } = await buildAttendanceIncidents(PERFIL, new Date(A, M, 1));

    return events.filter(evento => evento.iso === iso(numeroDeDia));
}

const tipos = (eventos) => eventos.map(evento => evento.kind).sort();

// Las marcas del caso real: entro a las 8, marco el traspaso a las 20 -salida
// de la larga y entrada de la noche, en el mismo minuto- y cerro a las 8:11
// del dia siguiente.
const MARCAS_DEL_24 = {
    [iso(26)]: [
        { time: "08:01", type: "in" },
        { time: "20:00", type: "out" },
        { time: "20:00", type: "in" }
    ],
    [iso(27)]: [{ time: "08:11", type: "out" }]
};

/* =========================================================
   Los tipos nuevos
========================================================= */

test("el recuadro del inicio tiene las tres reglas nuevas", () => {
    const claves = ATTENDANCE_INCIDENT_KINDS.map(kind => kind.key);

    assert.ok(claves.includes("earlyEntry"), "entrada anticipada");
    assert.ok(claves.includes("lateExit"), "salida posterior");
    assert.ok(claves.includes("unexplainedMarks"), "marcas sin justificar");
});

/* =========================================================
   El caso del 26 de agosto
========================================================= */

test("una Noche marcada como un 24 deja de pasar en silencio", async () => {
    sembrar({ [dia(26)]: TURNO.NOCHE }, MARCAS_DEL_24);

    const delDia = await incidenciasDe(26);

    // Antes de esto la lista de ese dia venia vacia.
    assert.notDeepEqual(tipos(delDia), []);
    assert.deepEqual(tipos(delDia), ["earlyEntry", "unexplainedMarks"]);
});

test("y el aviso dice lo que el supervisor tiene que ir a revisar", async () => {
    sembrar({ [dia(26)]: TURNO.NOCHE }, MARCAS_DEL_24);

    const delDia = await incidenciasDe(26);
    const anticipada = delDia.find(evento => evento.kind === "earlyEntry");
    const sinJustificar = delDia
        .find(evento => evento.kind === "unexplainedMarks");

    // La diferencia se dice en horas: "719 min" no se lee, y son justo las
    // doce horas que no estaban registradas.
    assert.match(anticipada.detail, /11 h 59 min antes de las 20:00/);
    assert.match(anticipada.detail, /turno extra o una extensión horaria/);
    // El traspaso de las 20:00 es lo que delata que el turno fue otro.
    assert.match(sinJustificar.detail, /20:00/);
    assert.match(sinJustificar.detail, /el turno realizado fue otro/);
});

test("el atraso seguia dando cero, que es por lo que no saltaba nada", async () => {
    // Se deja escrito a proposito: la regla del atraso NO cambio. Entrar a las
    // 08:01 cuando le tocaba a las 20:00 sigue sin ser un atraso -no llego
    // tarde, llego antes-, y por eso hacia falta una regla aparte.
    sembrar({ [dia(26)]: TURNO.NOCHE }, MARCAS_DEL_24);

    const delDia = await incidenciasDe(26);

    assert.equal(delDia.filter(evento => evento.kind === "atraso").length, 0);
    assert.equal(
        delDia.filter(evento => evento.kind === "lateOnExtra").length,
        0
    );
});

test("la celda del reporte avisa que esconde marcas", async () => {
    sembrar({ [dia(26)]: TURNO.NOCHE }, MARCAS_DEL_24);

    const filas = await attendanceIncidentContext({ name: NOMBRE, rut: RUT },
        iso(26));
    const fila = filas.find(item => item.iso === iso(26));

    // Las dos marcas del traspaso quedaban fuera de la fila y la unica senal
    // era el cursor de ayuda, que hay que descubrir sabiendo que esta.
    assert.equal(fila.entrada, `08:01${NBSP}⚠${NBSP}⋯2`);
    assert.match(estilos, /text-decoration: underline dotted currentColor 1px;/);
});

/* =========================================================
   Se apagan solas

   Es la propiedad que hace que la lista se pueda trabajar: la incidencia vive
   mientras el registro este incompleto y desaparece cuando se completa. Si no,
   el recuadro acumularia avisos ya revisados para siempre.
========================================================= */

test("al corregir el turno a 24h no queda ninguna incidencia", async () => {
    sembrar({ [dia(26)]: TURNO.TURNO24 }, MARCAS_DEL_24);

    assert.deepEqual(await incidenciasDe(26), []);
});

test("y la fila pasa a mostrar las cuatro marcas, sin nada escondido", async () => {
    sembrar({ [dia(26)]: TURNO.TURNO24 }, MARCAS_DEL_24);

    const filas = await attendanceIncidentContext({ name: NOMBRE, rut: RUT },
        iso(26));
    const fila = filas.find(item => item.iso === iso(26));

    assert.equal(fila.entrada, "08:01\n20:00");
    assert.equal(fila.salida, `20:00\n08:11${NBSP}*`);
});

test("autorizarle la entrada a mano tambien la apaga", async () => {
    // El supervisor que revisa y concluye "asi estaba acordado" tiene donde
    // decirlo: la hora autorizada del boton de marcajes.
    sembrar({ [dia(26)]: TURNO.NOCHE }, MARCAS_DEL_24);
    set(`clockMarks_${NOMBRE}`, {
        [dia(26)]: { segments: { noche: { entryTime: "08:00" } } }
    });

    const delDia = await incidenciasDe(26);

    assert.equal(
        delDia.filter(evento => evento.kind === "earlyEntry").length,
        0
    );
});

/* =========================================================
   Lo que NO tiene que sonar

   Una alerta que suena todos los dias no se lee. Estos son los dias normales
   de las mismas imagenes del caso: se entra unos minutos antes y se sale unos
   minutos despues, siempre.
========================================================= */

test("una Larga normal no genera nada", async () => {
    // 24 de agosto: entro 07:49, salio 20:10.
    sembrar({ [dia(24)]: TURNO.LARGA }, {
        [iso(24)]: [
            { time: "07:49", type: "in" },
            { time: "20:10", type: "out" }
        ]
    });

    assert.deepEqual(await incidenciasDe(24), []);
});

test("una Noche normal tampoco", async () => {
    // 27 de agosto: entro 19:40, cerro 08:10 del dia siguiente.
    sembrar({ [dia(27)]: TURNO.NOCHE }, {
        [iso(27)]: [{ time: "19:40", type: "in" }],
        [iso(28)]: [{ time: "08:10", type: "out" }]
    });

    assert.deepEqual(await incidenciasDe(27), []);
});

test("un 24 con el traspaso marcado y registrado como 24 tampoco", async () => {
    sembrar({ [dia(26)]: TURNO.TURNO24 }, MARCAS_DEL_24);

    assert.deepEqual(await incidenciasDe(26), []);
});

test("el doble apreton no es una marca sin justificar", async () => {
    // Quien se da cuenta de que apreto el boton equivocado vuelve a marcar en
    // el acto. Son dos marcas de una sola llegada, no dos momentos.
    sembrar({ [dia(24)]: TURNO.LARGA }, {
        [iso(24)]: [
            { time: "07:49", type: "out" },
            { time: "07:50", type: "in" },
            { time: "20:10", type: "out" }
        ]
    });

    const delDia = await incidenciasDe(24);

    assert.equal(
        delDia.filter(evento => evento.kind === "unexplainedMarks").length,
        0
    );
});

test("un dia cubierto por una ausencia no se mide contra ningun horario", async () => {
    // Es la misma regla que ya aplicaba el atraso: con licencia, permiso o
    // feriado no se esperaba que marcara, asi que lo que haya marcado no se
    // compara con la hora del turno.
    sembrar({ [dia(26)]: TURNO.NOCHE }, MARCAS_DEL_24);
    set(`admin_${NOMBRE}`, { [dia(26)]: 1 });

    assert.deepEqual(await incidenciasDe(26), []);
});

test("el margen es de una hora, no de un minuto", () => {
    assert.equal(SHIFT_DRIFT_ALERT_MINUTES, 60);
    // Los diez minutos de siempre no son nada.
    assert.ok(earlyEntryMinutes("07:49", "08:00") < SHIFT_DRIFT_ALERT_MINUTES);
    // Una hora justa ya lo es.
    assert.ok(earlyEntryMinutes("07:00", "08:00") >= SHIFT_DRIFT_ALERT_MINUTES);
    // Y llegar tarde no es llegar antes: eso lo mide el atraso.
    assert.equal(earlyEntryMinutes("08:30", "08:00"), 0);
});

/* =========================================================
   El espejo: el que se queda de mas
========================================================= */

test("quedarse mucho despues de la hora tambien avisa", async () => {
    // Larga que cierra a las 20:00 y se fue a las 23:30: tres horas y media
    // que no estan registradas en ninguna parte.
    sembrar({ [dia(24)]: TURNO.LARGA }, {
        [iso(24)]: [
            { time: "08:00", type: "in" },
            { time: "23:30", type: "out" }
        ]
    });

    const delDia = await incidenciasDe(24);
    const posterior = delDia.find(evento => evento.kind === "lateExit");

    assert.ok(posterior, "deberia haber una salida posterior");
    assert.match(posterior.detail, /3 h 30 min después de las 20:00/);
});

test("cerrar la Noche a las 08:11 no es quedarse de mas", async () => {
    // La trampa de comparar horas como texto: "08:11" parece menor que
    // "20:00", pero es a la manana siguiente y son 11 minutos, no 12 horas.
    sembrar({ [dia(27)]: TURNO.NOCHE }, {
        [iso(27)]: [{ time: "19:40", type: "in" }],
        [iso(28)]: [{ time: "08:11", type: "out" }]
    });

    const delDia = await incidenciasDe(27);

    assert.deepEqual(tipos(delDia), []);
});

/* =========================================================
   El D+N y su frontera del medio

   Un D+N no es un turno corrido: se entra a las 8, se sale a las 17 -16 los
   viernes-, se vuelve a las 20 y se cierra a las 8 de la manana siguiente. Son
   cuatro fronteras, no dos.

   Segundo caso real, del 13/08/2026: base Diurno, realizado D+N, y el
   trabajador marco 07:53, 20:01 y 20:01, o sea que en vez de irse a las 17:00
   siguio de largo hasta la noche. La fila se veia como un 24 impecable porque
   solo se miraban las dos puntas del turno: la entrada de las 07:53 contra las
   08:00 y el cierre de las 08:04 contra las 08:00. La salida del diurno, tres
   horas pasada, no la miraba nadie.
========================================================= */

const MARCAS_DEL_DN_CORRIDO = {
    [iso(13)]: [
        { time: "07:53", type: "in" },
        { time: "20:01", type: "out" },
        { time: "20:01", type: "in" }
    ],
    [iso(14)]: [{ time: "08:04", type: "out" }]
};

test("no irse a las 17:00 en un D+N levanta la salida posterior", async () => {
    sembrar(
        { [dia(13)]: TURNO.DIURNO_NOCHE },
        MARCAS_DEL_DN_CORRIDO,
        { [dia(13)]: TURNO.DIURNO }
    );

    const delDia = await incidenciasDe(13);
    const posterior = delDia.find(evento => evento.kind === "lateExit");

    assert.ok(posterior, "el diurno cerro a las 20:01 y le tocaba 17:00");
    // Contra las 17:00 del DIURNO, no contra las 08:00 de la noche.
    assert.match(posterior.detail, /3 h 1 min después de las 17:00/);
});

test("los viernes la frontera del diurno son las 16:00", async () => {
    // 14-08-2026 es viernes. El mismo retraso se mide contra una hora distinta.
    assert.equal(new Date(A, M, 14).getDay(), 5);

    sembrar(
        { [dia(14)]: TURNO.DIURNO_NOCHE },
        {
            [iso(14)]: [
                { time: "07:53", type: "in" },
                { time: "20:01", type: "out" },
                { time: "20:01", type: "in" }
            ],
            [iso(15)]: [{ time: "08:04", type: "out" }]
        },
        { [dia(14)]: TURNO.DIURNO }
    );

    const delDia = await incidenciasDe(14);
    const posterior = delDia.find(evento => evento.kind === "lateExit");

    assert.ok(posterior);
    assert.match(posterior.detail, /después de las 16:00/);
});

test("un D+N marcado como corresponde no genera nada", async () => {
    // Entra 07:55, se va 17:02, vuelve 19:58 y cierra 08:03 al dia siguiente.
    sembrar(
        { [dia(13)]: TURNO.DIURNO_NOCHE },
        {
            [iso(13)]: [
                { time: "07:55", type: "in" },
                { time: "17:02", type: "out" },
                { time: "19:58", type: "in" }
            ],
            [iso(14)]: [{ time: "08:03", type: "out" }]
        },
        { [dia(13)]: TURNO.DIURNO }
    );

    assert.deepEqual(await incidenciasDe(13), []);
});

test("y llegar tarde a la noche del D+N tambien se ve", async () => {
    // Cumple el diurno, pero vuelve a las 22:10 en vez de a las 20:00. La
    // entrada del segundo tramo antes no se comparaba con nada.
    sembrar(
        { [dia(13)]: TURNO.DIURNO_NOCHE },
        {
            [iso(13)]: [
                { time: "07:55", type: "in" },
                { time: "17:02", type: "out" },
                { time: "22:10", type: "in" }
            ],
            [iso(14)]: [{ time: "08:03", type: "out" }]
        },
        { [dia(13)]: TURNO.DIURNO }
    );

    const delDia = await incidenciasDe(13);

    assert.ok(
        delDia.some(evento => evento.kind === "lateOnExtra"),
        "volver a las 22:10 cuando la noche empieza a las 20:00"
    );
});

test("el 24 sigue siendo corrido: marcar el traspaso no crea una frontera", async () => {
    // Un 24 es Larga + Noche, pero el trabajador nunca se va. Si se midiera
    // por tramos, el traspaso de las 20:00 se compararia contra las 20:00 de
    // la Larga y contra las 20:00 de la Noche, y cualquier minuto de
    // diferencia seria una incidencia de un turno que se cumplio entero.
    sembrar({ [dia(26)]: TURNO.TURNO24 }, MARCAS_DEL_24);

    assert.deepEqual(await incidenciasDe(26), []);
});

/* =========================================================
   El motor, suelto
========================================================= */

test("un momento se explica por identidad, no por su hora", () => {
    // En un 24 se sale y se vuelve a entrar en el mismo minuto: dos marcas
    // distintas con la misma hora. Comparar por hora daria por explicada la
    // que no lo esta.
    const salida = { time: "20:00", type: "out" };
    const entrada = { time: "20:00", type: "in" };
    const llegada = { time: "08:01", type: "in" };
    const cierre = { time: "08:11", type: "out", iso: "2026-08-27" };
    const marcas = [llegada, salida, entrada, cierre];

    // Lo que muestra la fila de una Noche: las dos puntas.
    const sinExplicar = unexplainedMarkEvents(marcas, [llegada, cierre]);

    assert.equal(sinExplicar.length, 1);
    assert.deepEqual(sinExplicar[0], [salida, entrada]);

    // Lo que muestra la fila de un 24 con el traspaso: las cuatro.
    assert.deepEqual(
        unexplainedMarkEvents(marcas, [llegada, salida, entrada, cierre]),
        []
    );
});

test("sin marcas no hay nada que explicar", () => {
    assert.deepEqual(unexplainedMarkEvents([], []), []);
    assert.deepEqual(unexplainedMarkEvents(undefined, undefined), []);
});
