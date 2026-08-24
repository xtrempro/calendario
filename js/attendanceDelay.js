/**
 * Horarios de turno frente a las marcas del reloj: a que hora se entra, cuando
 * hay atraso y que turnos terminan a la manana siguiente.
 *
 * Modulo sin estado, sin DOM y sin Firebase, para que el calculo se pueda
 * probar solo y no dependa de donde se muestre.
 */
import { TURNO } from "./constants.js";
import { getTurnoComponentes } from "./rulesEngine.js";

/**
 * Margen de cortesia.
 *
 * El atraso NO empieza a contar en el minuto 1 sino en el 6: con entrada a las
 * 8:00 se puede marcar hasta las 8:05 sin atraso. Pasado el margen se cuentan
 * TODOS los minutos transcurridos, no solo los que exceden el margen: marcar a
 * las 8:06 son 6 minutos de atraso, no 1.
 */
export const DELAY_GRACE_MINUTES = 5;

/**
 * Hora de ingreso por turno.
 *
 * Solo estan los tres turnos definidos. Para el resto (24h, D+N, 1/2M,
 * Extension horaria, 18 horas) no se mide atraso: inventarles una hora de
 * entrada en un reporte que puede afectar el registro de una persona es peor
 * que dejar la celda vacia.
 */
const DEFAULT_ENTRY_TIME_BY_SHIFT = {
    [TURNO.DIURNO]: "08:00",
    [TURNO.LARGA]: "08:00",
    [TURNO.NOCHE]: "20:00"
};

/**
 * .Termina este turno a la manana siguiente?
 *
 * No se guarda una lista aparte de turnos nocturnos: se pregunta por el
 * segmento de noche, que es el que cruza la medianoche. Asi Noche, 24h, D+N y
 * 18 horas quedan cubiertos por su composicion, y un turno nuevo que lleve
 * noche se reconoce solo.
 *
 * @param {number} shift
 * @returns {boolean}
 */
export function shiftEndsNextMorning(shift) {
    return getTurnoComponentes(shift).includes("N");
}

// Un turno que empieza por la manana: Larga, Diurno, 24h, D+N y 1/2M. Los que
// arrancan de tarde (Extension horaria, 18 horas) o de noche, no.
const MORNING_SEGMENTS = ["L", "D", "HM"];

/**
 * .Empieza este turno por la manana?
 *
 * Es lo que permite saber si el trabajador sigue de largo desde su turno de
 * noche: la noche termina a las 8 y el turno de la manana empieza a las 8, asi
 * que entre los dos no hay nada que marcar.
 */
export function shiftStartsInTheMorning(shift) {
    const [first] = getTurnoComponentes(shift);

    return MORNING_SEGMENTS.includes(first);
}

/**
 * .Son los dos tramos de este turno presencias separadas?
 *
 * Solo D+N. Un 24 (Larga + Noche) es continuo: la Larga termina a las 20 y la
 * Noche empieza a las 20, el trabajador nunca se va. En cambio en un D+N el
 * diurno termina a las 17 y la noche empieza a las 20: se va y vuelve, son dos
 * llegadas y dos salidas y por eso la fila muestra dos lineas.
 */
export function shiftHasSeparateSegments(shift) {
    return Number(shift) === TURNO.DIURNO_NOCHE;
}

/**
 * .Esta hecho este turno de dos tramos?
 *
 * Un 24 es Larga + Noche y un 18 horas es Extension + Noche. Son continuos -no
 * hace falta marcar al pasar de uno al otro-, pero si el trabajador marca ese
 * traspaso, sus dos tramos se pueden mostrar por separado igual que un D+N.
 * Sin esas marcas intermedias no hay nada que separar y se resume en una linea.
 */
export function shiftHasTwoParts(shift) {
    return getTurnoComponentes(shift).length >= 2;
}

/**
 * Convierte "HH:MM" en minutos desde medianoche.
 * @param {string} time
 * @returns {number|null} null si no es una hora legible
 */
export function minutesFromTime(time) {
    const match = /^\s*(\d{1,2}):(\d{2})/.exec(String(time ?? ""));

    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (hours > 23 || minutes > 59) return null;

    return hours * 60 + minutes;
}

/**
 * Hora a la que le corresponde entrar ese dia.
 *
 * `override` es el horario personalizado del trabajador. Todavia no se
 * configura en ninguna parte; el parametro existe para que habilitarlo despues
 * sea cambiar quien llama a esta funcion y nada mas.
 *
 * @param {number} shift turno base del dia (ya con cambios aplicados)
 * @param {string} [override] hora "HH:MM" propia del trabajador
 * @returns {string} "HH:MM", o "" si a ese turno no se le mide atraso
 */
export function scheduledEntryTime(shift, override = "") {
    if (Number(shift) === TURNO.LIBRE) return "";
    if (override && minutesFromTime(override) !== null) return override;

    return DEFAULT_ENTRY_TIME_BY_SHIFT[Number(shift)] || "";
}

/**
 * Minutos de atraso de una marca respecto de su hora de ingreso.
 * @param {string} entryTime hora marcada, "HH:MM"
 * @param {string} scheduledTime hora de ingreso, "HH:MM"
 * @returns {number} 0 si llego dentro del margen o antes
 */
export function delayMinutes(entryTime, scheduledTime) {
    const marked = minutesFromTime(entryTime);
    const scheduled = minutesFromTime(scheduledTime);

    if (marked === null || scheduled === null) return 0;

    const difference = marked - scheduled;

    return difference > DELAY_GRACE_MINUTES ? difference : 0;
}

/**
 * .Se llevo el turno extra la llegada del dia?
 *
 * Un extra que empieza ANTES que el base se lleva la marca de entrada: el
 * trabajador entro por el extra y siguio de largo. Es el caso de quien tiene
 * Noche de base y toma una Larga extra: hace un 24 y marca a las 8 para la
 * Larga, no a las 20 para su Noche, asi que ahi no hay atraso que medir.
 *
 * Al reves si se mide: con Larga de base y Noche extra, la llegada de las 8 es
 * la de su turno base.
 *
 * El horario personalizado del trabajador NO se le aplica al extra: rige para
 * su turno, no para uno que tomo encima.
 */
function extraTakesTheEntry(extraShift, baseEntryTime) {
    const extra = minutesFromTime(scheduledEntryTime(extraShift));
    const base = minutesFromTime(baseEntryTime);

    return extra !== null && base !== null && extra < base;
}

// Dos marcas separadas por menos de esto son el mismo momento. Quien se da
// cuenta de que apreto el boton equivocado vuelve a marcar en el acto, y eso
// son dos marcas de una sola llegada. Ningun par de momentos distintos de un
// turno queda tan cerca: lo mas ajustado es el D+N, con casi tres horas entre
// la salida del diurno y la entrada de la noche.
const EVENT_WINDOW_MINUTES = 30;

function absoluteMinutes(mark) {
    const minutes = minutesFromTime(mark?.time);

    if (minutes === null) return null;

    // La marca traida del dia siguiente ocurre 24 horas mas tarde: sin esto,
    // un cierre a las 08:01 pareceria anterior a una entrada de las 19:57.
    return mark.iso ? minutes + 24 * 60 : minutes;
}

/**
 * Agrupa en un mismo evento las marcas que son el mismo momento.
 *
 * De cada evento vale la PRIMERA marca, tanto al entrar como al salir: es la
 * hora en que efectivamente llego o se fue. Las demas quedan para el hover.
 *
 * @param {Array<{time: string, iso?: string}>} marks en orden
 * @returns {Array<Array<object>>}
 */
export function groupMarkEvents(marks = []) {
    const events = [];
    let previous = null;

    (marks || []).forEach(mark => {
        const at = absoluteMinutes(mark);

        if (at === null) return;

        if (previous !== null && at - previous < EVENT_WINDOW_MINUTES) {
            events[events.length - 1].push(mark);
        } else {
            events.push([mark]);
        }

        previous = at;
    });

    return events;
}

/**
 * .Parece esta marca la entrada al turno?
 *
 * Solo hace falta cuando hay UNA sola marca: sin otra al lado, el orden no
 * dice nada y hay que compararla con la hora de ingreso. De una hora antes a
 * cuatro despues se toma como entrada; mas alla es la salida.
 *
 * Sin horario de ingreso conocido se respeta lo que anoto el reloj: adivinar
 * seria peor que el dato original.
 */
function looksLikeEntry(mark, scheduledEntry) {
    const marked = minutesFromTime(mark.time);
    const scheduled = minutesFromTime(scheduledEntry);

    if (marked === null || scheduled === null) return mark.type !== "out";

    const difference = marked - scheduled;

    return difference >= -60 && difference <= 240;
}

/**
 * Decide cual marca fue la entrada y cual la salida.
 *
 * El reloj guarda lo que el trabajador aprieta, y a veces aprieta el boton
 * equivocado: marca "salida" al llegar, o "entrada" al irse. Lo que manda es
 * que ese dia tenia turno programado: si hay turno, la primera marca es la
 * llegada y la ultima es la salida, diga lo que diga la etiqueta. La etiqueta
 * equivocada no se corrige en silencio: se devuelve como incidencia.
 *
 * Sin turno ese dia no hay contra que corregir y se respeta el reloj.
 *
 * @param {Array<{time: string, type: string, iso?: string}>} marks en orden
 * @param {object} [context]
 * @param {number} [context.workedShift] turno realmente realizado
 * @param {string} [context.scheduledEntry] hora de ingreso, "HH:MM"
 * @param {boolean} [context.endsNextMorning] turno que cierra al dia siguiente
 * @returns {{entry: object|null, exit: object|null,
 *            entryIncident: boolean, exitIncident: boolean}}
 */
export function resolveShiftMarks(marks = [], context = {}) {
    const {
        workedShift = TURNO.LIBRE,
        scheduledEntry = "",
        endsNextMorning = false
    } = context;
    const list = (marks || []).filter(mark => mark?.time);
    const vacio = {
        entry: null,
        exit: null,
        entryIncident: false,
        exitIncident: false
    };

    if (!list.length) return vacio;

    // Sin turno no hay error involuntario que deducir: lo que dice el reloj.
    if (!(Number(workedShift) > TURNO.LIBRE)) {
        const entradas = list.filter(mark => mark.type !== "out");
        const salidas = list.filter(mark => mark.type === "out");

        return {
            ...vacio,
            entry: entradas[0] || null,
            exit: salidas[salidas.length - 1] || null
        };
    }

    // De cada momento vale la primera marca: si marco dos veces al llegar o dos
    // veces al salir, la hora buena es la primera de cada tanda.
    const events = groupMarkEvents(list);

    if (events.length === 1 && !endsNextMorning) {
        const only = events[0][0];

        return looksLikeEntry(only, scheduledEntry)
            ? { ...vacio, entry: only, entryIncident: only.type === "out" }
            : { ...vacio, exit: only, exitIncident: only.type !== "out" };
    }

    // Un turno con noche se cierra con la marca traida del dia siguiente. Si no
    // la marco, la celda queda vacia: una marca de mitad de turno no es el
    // termino, y mostrarla como tal seria peor que dejarla en blanco.
    const exit = endsNextMorning
        ? list.find(mark => mark.iso) || null
        : events[events.length - 1][0];
    // La marca traida del dia siguiente nunca es la llegada de este turno.
    const first = events[0][0];
    const entry = first?.iso ? null : first;

    return {
        entry,
        exit: exit === entry ? null : exit,
        entryIncident: Boolean(entry) && entry.type === "out",
        exitIncident: Boolean(exit) && exit.type !== "out"
    };
}

/**
 * .Falta el registro de una marca?
 *
 * Falta cuando ese dia se trabajo y no hay marca. No falta si el dia esta
 * cubierto por una ausencia -no se esperaba que marcara- ni si el dia todavia
 * no ocurre: en el reporte del mes en curso, los dias que quedan por delante
 * no tienen nada pendiente todavia.
 *
 * @param {object} day
 * @param {string} day.mark hora marcada, "" si no hay
 * @param {number} day.workedShift turno realmente realizado
 * @param {boolean} [day.absent]
 * @param {boolean} [day.hasPassed] false si el dia aun no llega
 * @returns {boolean}
 */
export function isMarkMissing({
    mark,
    workedShift,
    absent = false,
    hasPassed = true
}) {
    if (absent || !hasPassed) return false;

    return !mark && Number(workedShift) > TURNO.LIBRE;
}

/**
 * Atraso de un dia del reporte.
 *
 * El turno que manda es el BASE con cambios ya aplicados: por eso un turno
 * cambiado se mide en la fecha a la que se movio, y un turno extra no genera
 * atraso aunque se llegue tarde.
 *
 * @param {object} day
 * @param {number} day.baseShift turno base con cambios (baseWithSwaps)
 * @param {number} [day.extraShift] turno extra agregado ese mismo dia
 * @param {number} day.workedShift turno realmente realizado
 * @param {string} day.entryTime hora de la marca de entrada, "" si no hay
 * @param {boolean} day.absent true si el dia esta cubierto por una ausencia
 * @param {string} [day.entryOverride] horario personalizado del trabajador
 * @returns {{minutes: number, scheduled: string, missingEntry: boolean}}
 */
export function entryDelayForDay({
    baseShift,
    extraShift = TURNO.LIBRE,
    workedShift,
    entryTime = "",
    absent = false,
    hasPassed = true,
    entryOverride = ""
} = {}) {
    const vacio = { minutes: 0, scheduled: "", missingEntry: false };

    // Con licencia, permiso o feriado no se esperaba que marcara.
    if (absent) return vacio;

    const scheduled = scheduledEntryTime(baseShift, entryOverride);
    // La cruz avisa que falta el registro de un turno que SI se trabajo, sea
    // base o extra. En un dia libre no hay nada que marcar.
    const missingEntry = isMarkMissing({
        mark: entryTime,
        workedShift,
        absent,
        hasPassed
    });

    if (!scheduled) return { ...vacio, missingEntry };
    if (extraTakesTheEntry(extraShift, scheduled)) {
        return { minutes: 0, scheduled, missingEntry };
    }
    if (!entryTime) return { minutes: 0, scheduled, missingEntry };

    return {
        minutes: delayMinutes(entryTime, scheduled),
        scheduled,
        missingEntry: false
    };
}

/**
 * Texto de la celda "Atrasos". Vacio cuando no hay atraso, para que la columna
 * se lea de un vistazo y solo salten los dias con problema.
 * @param {number} minutes
 * @returns {string}
 */
export function formatDelayCell(minutes) {
    const value = Math.max(0, Math.round(Number(minutes) || 0));

    return value ? `${value} min` : "";
}
