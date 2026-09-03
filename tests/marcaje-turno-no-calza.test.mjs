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

test("sin las marcas del medio, el D+N lleva su cruz", async () => {
    // Entra a las 07:55 y no vuelve a marcar hasta las 08:03 del dia
    // siguiente. Le faltan las DOS del medio: la salida del diurno y la
    // entrada de la noche.
    sembrar(
        { [dia(13)]: TURNO.DIURNO_NOCHE },
        {
            [iso(13)]: [{ time: "07:55", type: "in" }],
            [iso(14)]: [{ time: "08:03", type: "out" }]
        },
        { [dia(13)]: TURNO.DIURNO }
    );

    const filas = await attendanceIncidentContext({ name: NOMBRE, rut: RUT },
        iso(13));
    const fila = filas.find(item => item.iso === iso(13));

    // La cruz va en la LINEA del tramo, no en la celda entera: la hora del
    // otro tramo se sigue viendo, que es la mitad del dato.
    assert.equal(fila.entrada, "07:55\n✕");
    assert.equal(fila.salida, `✕\n08:03${NBSP}*`);
});

test("y esa cruz tambien se cuenta en el inicio, diciendo que tramo", async () => {
    sembrar(
        { [dia(13)]: TURNO.DIURNO_NOCHE },
        {
            [iso(13)]: [{ time: "07:55", type: "in" }],
            [iso(14)]: [{ time: "08:03", type: "out" }]
        },
        { [dia(13)]: TURNO.DIURNO }
    );

    const delDia = await incidenciasDe(13);
    const sinEntrada = delDia.find(evento => evento.kind === "missingEntry");
    const sinSalida = delDia.find(evento => evento.kind === "missingExit");

    // Antes el dia se daba por completo: la celda de salida traia "\n08:03" y
    // como no estaba vacia, no habia cruz ni incidencia.
    assert.ok(sinEntrada, "falta la entrada de la noche");
    assert.match(sinEntrada.detail, /entrada de Noche/);
    assert.ok(sinSalida, "falta la salida del diurno");
    assert.match(sinSalida.detail, /salida de Diurno/);
});

test("un D+N con las cuatro marcas no lleva ninguna cruz", async () => {
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

    const filas = await attendanceIncidentContext({ name: NOMBRE, rut: RUT },
        iso(13));
    const fila = filas.find(item => item.iso === iso(13));

    assert.equal(fila.entrada, "07:55\n19:58");
    assert.equal(fila.salida, `17:02\n08:03${NBSP}*`);
});

test("un turno corrido NO exige marcas del medio", async () => {
    // Un 24 sin el traspaso marcado es un turno cumplido: el trabajador nunca
    // se fue, no habia nada que marcar. Exigirle cuatro marcas le inventaria
    // dos faltas a quien hizo todo bien.
    sembrar({ [dia(26)]: TURNO.TURNO24 }, {
        [iso(26)]: [{ time: "07:58", type: "in" }],
        [iso(27)]: [{ time: "08:05", type: "out" }]
    });

    const filas = await attendanceIncidentContext({ name: NOMBRE, rut: RUT },
        iso(26));
    const fila = filas.find(item => item.iso === iso(26));

    assert.equal(fila.entrada, "07:58");
    assert.equal(fila.salida, `08:05${NBSP}*`);
    assert.deepEqual(await incidenciasDe(26), []);
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
   El traspaso de un turno continuo no es una anomalia

   Tercer caso real: varios 24 aparecian como "marcas sin justificar" por la
   marca de las 20:0x. Un 24 es continuo -el trabajador nunca se va- asi que
   marcar el traspaso no es obligatorio, pero tampoco es raro.

   Lo que lo delataba era un detalle sin significado: si aprieta DOS veces
   -salida y entrada- la fila se parte en dos tramos y las cuatro horas quedan
   a la vista; si aprieta UNA sola, la fila no se parte y esa marca sobra. Una
   pulsacion de diferencia separaba un turno impecable de una incidencia.
========================================================= */

// El caso de REINALDO el 13/08: base Larga, realizo un 24, y marco el traspaso
// una sola vez a las 20:02.
const MARCAS_DEL_24_UN_TOQUE = {
    [iso(13)]: [
        { time: "08:11", type: "in" },
        { time: "20:02", type: "out" }
    ],
    [iso(14)]: [{ time: "08:04", type: "out" }]
};

test("marcar el traspaso de un 24 una sola vez no es una incidencia", async () => {
    sembrar(
        { [dia(13)]: TURNO.TURNO24 },
        MARCAS_DEL_24_UN_TOQUE,
        { [dia(13)]: TURNO.LARGA }
    );

    const delDia = await incidenciasDe(13);

    assert.equal(
        delDia.filter(evento => evento.kind === "unexplainedMarks").length,
        0,
        "las 20:02 son el traspaso del 24, no una marca sin justificar"
    );
});

test("apretar una vez o dos da lo mismo", async () => {
    // La diferencia entre las dos formas de marcar el mismo traspaso no puede
    // ser la diferencia entre una incidencia y ninguna.
    sembrar({ [dia(26)]: TURNO.TURNO24 }, MARCAS_DEL_24);
    const dosToques = await incidenciasDe(26);

    sembrar(
        { [dia(13)]: TURNO.TURNO24 },
        MARCAS_DEL_24_UN_TOQUE,
        { [dia(13)]: TURNO.LARGA }
    );
    const unToque = await incidenciasDe(13);

    assert.deepEqual(
        tipos(dosToques).filter(kind => kind === "unexplainedMarks"),
        tipos(unToque).filter(kind => kind === "unexplainedMarks")
    );
});

test("pero la marca se sigue viendo: la celda la cuenta y el hover la nombra", async () => {
    // Dejarla pasar como incidencia no es esconderla. Sigue estando ahi para
    // quien vaya a mirar ese dia.
    sembrar(
        { [dia(13)]: TURNO.TURNO24 },
        MARCAS_DEL_24_UN_TOQUE,
        { [dia(13)]: TURNO.LARGA }
    );

    const filas = await attendanceIncidentContext({ name: NOMBRE, rut: RUT },
        iso(13));
    const fila = filas.find(item => item.iso === iso(13));

    assert.match(fila.entrada, /⋯1/, "la celda avisa que esconde una marca");
});

/* =========================================================
   La extension horaria pegada al turno

   Cuarto caso real, del 21/08: turno de Noche con una extension aplicada sobre
   la MARCACION -no como turno extra-. Le tocaba llegar a las 12:00 y seguir de
   largo con su noche, y marco el traspaso de las 20:00.

   Son ocho horas de extension pegadas a una noche: exactamente la misma forma
   que un 24, aunque el turno siga diciendo Noche. La fila lo mostraba en una
   sola linea -11:58 ⋯2- y contaba las 20:00 como marca sin justificar.
========================================================= */

// La extension se aplica autorizando la hora de entrada del tramo.
function conExtension(nombreSegmento, hora, keyDay) {
    set(`clockMarks_${NOMBRE}`, {
        [keyDay]: { segments: { [nombreSegmento]: { entryTime: hora } } }
    });
}

const MARCAS_CON_EXTENSION = {
    [iso(21)]: [
        { time: "11:58", type: "in" },
        { time: "20:00", type: "out" },
        { time: "20:00", type: "in" }
    ],
    [iso(22)]: [{ time: "08:05", type: "out" }]
};

test("una Noche con extension se lee como un 24, en dos lineas", async () => {
    sembrar({ [dia(21)]: TURNO.NOCHE }, MARCAS_CON_EXTENSION);
    conExtension("noche", "12:00", dia(21));

    const filas = await attendanceIncidentContext({ name: NOMBRE, rut: RUT },
        iso(21));
    const fila = filas.find(item => item.iso === iso(21));

    // Una entrada sobre la otra y una salida sobre la otra, igual que un 24
    // con el traspaso marcado.
    assert.equal(fila.entrada, "11:58\n20:00");
    assert.equal(fila.salida, `20:00\n08:05${NBSP}*`);
    // Y ya no esconde nada: las cuatro marcas estan a la vista.
    assert.doesNotMatch(fila.entrada, /⋯/);
});

test("y el traspaso de las 20:00 deja de ser una incidencia", async () => {
    sembrar({ [dia(21)]: TURNO.NOCHE }, MARCAS_CON_EXTENSION);
    conExtension("noche", "12:00", dia(21));

    assert.deepEqual(await incidenciasDe(21), []);
});

test("sin la extension, esas mismas marcas SI son una incidencia", async () => {
    // Es el punto: lo que cambia el caso es que el supervisor haya registrado
    // la extension. Sin ella, una Noche que marca a las 11:58 es un turno que
    // nadie anoto, que es el caso del 26/08.
    sembrar({ [dia(21)]: TURNO.NOCHE }, MARCAS_CON_EXTENSION);

    const delDia = await incidenciasDe(21);

    assert.ok(delDia.some(evento => evento.kind === "unexplainedMarks"));
    assert.ok(delDia.some(evento => evento.kind === "earlyEntry"));
});

test("una Noche con marcas por dentro SIGUE siendo incidencia", async () => {
    // La excepcion es solo para los turnos continuos de dos tramos. Una Noche
    // es de uno solo: no tiene traspaso que marcar, y una marca a las 20:00
    // entre su llegada y su salida es justamente el 24 que nadie registro.
    sembrar({ [dia(26)]: TURNO.NOCHE }, MARCAS_DEL_24);

    const delDia = await incidenciasDe(26);

    assert.ok(delDia.some(evento => evento.kind === "unexplainedMarks"));
});

/* =========================================================
   Marcar dos veces al salir de una noche

   Quinto caso real, del 11/08: un dia LIBRE que aparecia como "marcaje en dia
   libre". Lo que habia pasado es que al salir de la noche del 10 apreto dos
   veces a las 08:06. La fila de la noche se llevaba UNA de las dos y la gemela
   quedaba suelta en el dia siguiente, donde se leia como si hubiera venido a
   trabajar en su dia libre.

   Son el mismo momento y van juntas a la fila de la noche.
========================================================= */

const MARCAS_DOBLE_SALIDA = {
    [iso(10)]: [{ time: "20:04", type: "in" }],
    [iso(11)]: [
        { time: "08:06", type: "out" },
        { time: "08:06", type: "in" }
    ],
    [iso(12)]: [
        { time: "08:00", type: "in" },
        { time: "20:03", type: "out" }
    ]
};

test("apretar dos veces al salir no es marcaje en dia libre", async () => {
    sembrar(
        { [dia(10)]: TURNO.NOCHE, [dia(11)]: 0, [dia(12)]: TURNO.LARGA },
        MARCAS_DOBLE_SALIDA
    );

    const delDia = await incidenciasDe(11);

    assert.deepEqual(tipos(delDia), [], "el 11 es libre y no vino a trabajar");
});

test("las dos van a la fila de la noche, agrupadas en el ⋯", async () => {
    sembrar(
        { [dia(10)]: TURNO.NOCHE, [dia(11)]: 0, [dia(12)]: TURNO.LARGA },
        MARCAS_DOBLE_SALIDA
    );

    const filas = await attendanceIncidentContext({ name: NOMBRE, rut: RUT },
        iso(10));
    const noche = filas.find(item => item.iso === iso(10));
    const libre = filas.find(item => item.iso === iso(11));

    // El ⋯ va siempre en la entrada, que es donde empieza a leerse la fila; el
    // hover de las dos celdas nombra las tres marcas.
    assert.equal(noche.entrada, `20:04${NBSP}⋯1`);
    assert.equal(noche.salida, `08:06${NBSP}*`);
    // Y el dia libre queda con su guion, sin marcas propias.
    assert.equal(libre.entrada, "-");
    assert.equal(libre.salida, "-");
});

test("la noche tampoco se queda con la llegada del dia siguiente", async () => {
    // El limite: si al dia siguiente SI empieza turno de manana, una entrada
    // temprana es su llegada y no el cierre de la noche, aunque caigan dentro
    // del mismo momento -la noche termina a las 8 y la manana empieza a las 8-.
    // Ahi la etiqueta es lo unico que las distingue.
    sembrar(
        { [dia(10)]: TURNO.NOCHE, [dia(11)]: TURNO.LARGA },
        {
            [iso(10)]: [{ time: "20:04", type: "in" }],
            [iso(11)]: [
                { time: "08:06", type: "out" },
                { time: "08:09", type: "in" },
                { time: "20:03", type: "out" }
            ]
        }
    );

    const filas = await attendanceIncidentContext({ name: NOMBRE, rut: RUT },
        iso(11));
    const larga = filas.find(item => item.iso === iso(11));

    assert.equal(larga.entrada, "08:09");
    assert.equal(larga.salida, "20:03");
});

test("y una marca de OTRO momento en el dia libre si se reporta", async () => {
    // Lo que se agrupa es el mismo momento. Venir a las 14:00 en un dia libre
    // sigue siendo lo que era.
    sembrar(
        { [dia(10)]: TURNO.NOCHE, [dia(11)]: 0 },
        {
            [iso(10)]: [{ time: "20:04", type: "in" }],
            [iso(11)]: [
                { time: "08:06", type: "out" },
                { time: "08:06", type: "in" },
                { time: "14:00", type: "in" }
            ],
            [iso(12)]: [{ time: "08:00", type: "in" }]
        }
    );

    const delDia = await incidenciasDe(11);

    assert.ok(delDia.some(evento => evento.kind === "markOnFreeDay"));
    assert.match(
        delDia.find(evento => evento.kind === "markOnFreeDay").detail,
        /14:00/
    );
});

/* =========================================================
   Cerrar el turno pasado el mediodia

   Sexto caso real, del 24-25/08. Hizo un 24 el 24, se quedo de mas y cerro a
   las 12:58 del 25. Esa noche tenia turno de Noche y entro a las 19:49.

   El corte de "una salida antes del mediodia cierra lo de anoche" daba por
   hecho que el turno se cierra a su hora. Las 12:58 quedaban fuera, asi que la
   marca se quedaba en el dia 25 y lo desordenaba entero: pasaba por ser la
   llegada a la Noche -"marco salida en vez de entrada" y "llego siete horas
   antes de las 20:00"- mientras el 24 de la vispera quedaba SIN salida.

   Lo que la delata es lo que apreto: una marca de SALIDA no puede ser una
   llegada, y si ocurre antes de que empiece el turno de hoy, hoy todavia no
   habia empezado.
========================================================= */

const MARCAS_CIERRE_TARDE = {
    [iso(24)]: [
        { time: "07:56", type: "in" },
        { time: "20:01", type: "out" },
        { time: "20:01", type: "in" }
    ],
    [iso(25)]: [
        { time: "12:58", type: "out" },
        { time: "19:49", type: "in" }
    ],
    [iso(26)]: [{ time: "08:23", type: "out" }]
};

const TURNOS_CIERRE_TARDE = {
    [dia(24)]: TURNO.TURNO24,
    [dia(25)]: TURNO.NOCHE
};

test("la salida de las 12:58 vuelve al 24 que cerraba", async () => {
    sembrar(TURNOS_CIERRE_TARDE, MARCAS_CIERRE_TARDE, {
        [dia(24)]: TURNO.NOCHE,
        [dia(25)]: 0
    });

    const filas = await attendanceIncidentContext({ name: NOMBRE, rut: RUT },
        iso(24));
    const veinticuatro = filas.find(item => item.iso === iso(24));

    // Antes esta fila quedaba sin salida: su cierre estaba atrapado en el 25.
    // El ⚠ es de la salida posterior: cerro casi cinco horas pasado de hora, y
    // eso si es algo que revisar.
    assert.equal(veinticuatro.entrada, "07:56\n20:01");
    assert.equal(veinticuatro.salida, `20:01\n12:58${NBSP}*${NBSP}⚠`);
});

test("y se cuenta como lo que es: una salida muy posterior", async () => {
    sembrar(TURNOS_CIERRE_TARDE, MARCAS_CIERRE_TARDE, {
        [dia(24)]: TURNO.NOCHE,
        [dia(25)]: 0
    });

    const delDia = await incidenciasDe(24);
    const posterior = delDia.find(evento => evento.kind === "lateExit");

    assert.ok(posterior, "el 24 cerraba a las 08:00 y cerro a las 12:58");
    assert.match(posterior.detail, /4 h 58 min después de las 08:00/);
});

test("la Noche del 25 recupera su llegada de las 19:49", async () => {
    sembrar(TURNOS_CIERRE_TARDE, MARCAS_CIERRE_TARDE, {
        [dia(24)]: TURNO.NOCHE,
        [dia(25)]: 0
    });

    const filas = await attendanceIncidentContext({ name: NOMBRE, rut: RUT },
        iso(25));
    const noche = filas.find(item => item.iso === iso(25));

    // Sin ⚠ de "marco salida en vez de entrada" y sin la entrada anticipada.
    assert.equal(noche.entrada, "19:49");
    assert.equal(noche.salida, `08:23${NBSP}*`);

    const delDia = await incidenciasDe(25);

    assert.deepEqual(tipos(delDia), []);
});

test("una entrada temprana NO se la lleva el turno de anoche", async () => {
    // El limite de la regla: lo que la delata es la etiqueta. Si la unica
    // marca del dia dice ENTRADA, es la llegada de hoy aunque sea temprana, y
    // llevarsela dejaria a este turno sin su entrada.
    sembrar(
        { [dia(24)]: TURNO.TURNO24, [dia(25)]: TURNO.NOCHE },
        {
            [iso(24)]: [{ time: "07:56", type: "in" }],
            [iso(25)]: [{ time: "19:49", type: "in" }],
            [iso(26)]: [{ time: "08:23", type: "out" }]
        },
        { [dia(24)]: TURNO.NOCHE, [dia(25)]: 0 }
    );

    const filas = await attendanceIncidentContext({ name: NOMBRE, rut: RUT },
        iso(25));
    const noche = filas.find(item => item.iso === iso(25));

    assert.equal(noche.entrada, "19:49");
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
