/**
 * Horario propio de un trabajador.
 *
 * Algunos entran y salen a horas distintas de las del turno: un diurno que
 * entra 8:40 y sale 17:40, o alguien de tercer turno con la Larga de 7:30 a
 * 19:30. Sus atrasos y sus incidencias se miden contra ESE horario, no contra
 * el general, porque si no aparecerian llegando tarde todos los dias.
 *
 * Es un acuerdo permanente, distinto de la modificacion de marcaje de un dia
 * suelto. Cuando ambos existen manda la del dia, que es la mas especifica.
 */
import { getJSON, setJSON } from "./persistence.js";
import { TURNO } from "./constants.js";
import { getTurnoComponentes } from "./rulesEngine.js";

const STORAGE_KEY = "workerSchedules";

// Que horario le corresponde a cada tramo de turno. Los medios turnos no
// entran: un 1/2 ADM ya tiene su propia regla, que depende de la rotativa.
const SEGMENT_KEYS = {
    L: "larga",
    N: "noche",
    D: "diurno"
};

/**
 * Los tramos que se pueden configurar, por tipo de rotativa.
 *
 * Un diurno solo hace turnos diurnos; el de tercer y cuarto turno hace Largas
 * y Noches. Mostrarle a cada uno solo lo suyo evita configurar horarios que
 * nunca se van a usar.
 */
export function scheduleSegmentsForRotativa(rotativaType) {
    if (rotativaType === "diurno") {
        return [{
            key: "diurno",
            label: "Turno diurno",
            hasFriday: true,
            fridayNote: "Los viernes la jornada termina antes"
        }];
    }

    if (rotativaType === "3turno" || rotativaType === "4turno") {
        return [
            { key: "larga", label: "Turno largo", hasFriday: false },
            { key: "noche", label: "Turno de noche", hasFriday: false }
        ];
    }

    return [];
}

function isTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

/**
 * Deja solo horas validas: un campo a medio escribir no puede convertirse en
 * un horario que despues mida atrasos.
 */
function normalizeSegment(value) {
    if (!value || typeof value !== "object") return null;

    const entry = isTime(value.entry) ? value.entry : "";
    const exit = isTime(value.exit) ? value.exit : "";
    const exitFriday = isTime(value.exitFriday) ? value.exitFriday : "";

    if (!entry && !exit && !exitFriday) return null;

    return { entry, exit, exitFriday };
}

export function normalizeWorkerSchedule(value) {
    const schedule = {};

    Object.values(SEGMENT_KEYS).forEach(key => {
        const segment = normalizeSegment(value?.[key]);

        if (segment) schedule[key] = segment;
    });

    return schedule;
}

function allSchedules() {
    const stored = getJSON(STORAGE_KEY, {});

    return stored && typeof stored === "object" ? stored : {};
}

/**
 * Horario propio de un trabajador. {} si no tiene nada configurado.
 */
export function getWorkerSchedule(profile) {
    if (!profile) return {};

    return normalizeWorkerSchedule(allSchedules()[profile]);
}

export function saveWorkerSchedule(profile, schedule) {
    if (!profile) return;

    const all = allSchedules();
    const normalized = normalizeWorkerSchedule(schedule);

    if (Object.keys(normalized).length) {
        all[profile] = normalized;
    } else {
        delete all[profile];
    }

    setJSON(STORAGE_KEY, all);
}

export function hasWorkerSchedule(profile) {
    return Object.keys(getWorkerSchedule(profile)).length > 0;
}

/**
 * Hora de ingreso propia para ese turno, si la tiene.
 *
 * La entrada la fija el PRIMER tramo del turno: en un 24 (Larga + Noche) se
 * entra por la Larga.
 *
 * @param {object} schedule
 * @param {number} shift
 * @returns {string} "HH:MM", o "" si no hay nada configurado
 */
export function workerEntryTime(schedule, shift) {
    const [first] = getTurnoComponentes(shift);

    return schedule?.[SEGMENT_KEYS[first]]?.entry || "";
}

/**
 * Hora de salida propia para ese turno, si la tiene.
 *
 * La salida la fija el ULTIMO tramo: en un 24 se sale por la Noche. Y el
 * diurno puede tener una hora distinta los viernes, que es cuando la jornada
 * termina antes.
 *
 * @param {object} schedule
 * @param {number} shift
 * @param {Date} [date] para saber si es viernes
 * @returns {string}
 */
export function workerExitTime(schedule, shift, date = null) {
    const components = getTurnoComponentes(shift);
    const last = components[components.length - 1];
    const segment = schedule?.[SEGMENT_KEYS[last]];

    if (!segment) return "";

    const isFriday = date instanceof Date && date.getDay() === 5;

    return (isFriday && segment.exitFriday) || segment.exit || "";
}

export const WORKER_SCHEDULE_STORAGE_KEY = STORAGE_KEY;
export const WORKER_SCHEDULE_SEGMENT_KEYS = SEGMENT_KEYS;
export { TURNO };
