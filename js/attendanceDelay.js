/**
 * Atrasos: minutos entre la hora de ingreso del turno y la marca de entrada.
 *
 * Modulo sin estado, sin DOM y sin Firebase, para que el calculo se pueda
 * probar solo y no dependa de donde se muestre.
 */
import { TURNO } from "./constants.js";

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
 * Atraso de un dia del reporte.
 *
 * El turno que manda es el BASE con cambios ya aplicados: por eso un turno
 * cambiado se mide en la fecha a la que se movio, y un turno extra no genera
 * atraso aunque se llegue tarde.
 *
 * @param {object} day
 * @param {number} day.baseShift turno base con cambios (baseWithSwaps)
 * @param {number} day.workedShift turno realmente realizado
 * @param {string} day.entryTime hora de la marca de entrada, "" si no hay
 * @param {boolean} day.absent true si el dia esta cubierto por una ausencia
 * @param {string} [day.entryOverride] horario personalizado del trabajador
 * @returns {{minutes: number, scheduled: string, missingEntry: boolean}}
 */
export function entryDelayForDay({
    baseShift,
    workedShift,
    entryTime = "",
    absent = false,
    entryOverride = ""
} = {}) {
    const vacio = { minutes: 0, scheduled: "", missingEntry: false };

    // Con licencia, permiso o feriado no se esperaba que marcara.
    if (absent) return vacio;

    const scheduled = scheduledEntryTime(baseShift, entryOverride);
    // La cruz avisa que falta el registro de un turno que SI se trabajo, sea
    // base o extra. En un dia libre no hay nada que marcar.
    const missingEntry =
        !entryTime && Number(workedShift) > TURNO.LIBRE;

    if (!scheduled) return { ...vacio, missingEntry };
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
