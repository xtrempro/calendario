// Franja parcial de un trabajador en un dia: la media jornada que deja un
// 1/2 ADM y el tramo diurno que agrega una extension horaria sobre la noche.
//
// Vive aparte porque lo usan las dos caras de la asignacion de tareas: el
// tablero del supervisor (js/taskAssignments.js) y la proyeccion que ve el
// trabajador en su PWA (js/taskAssignmentProjection.js, que ademas se bundlea
// al motor del servidor). Antes cada una decidia por su cuenta que un permiso
// parcial era una ausencia, y el trabajador desaparecia de la programacion
// entera por venir media jornada.

import { keyToDate } from "./dateUtils.js";
import { getJSON } from "./persistence.js";
import { getRotativa } from "./storage.js";
import { getTurnoReal } from "./turnEngine.js";
import { TURNO } from "./constants.js";

// Rotativas cuya base es Larga (08:00 a 20:00): la mitad de la jornada cae a
// las 14:00. El resto se mide contra el diurno, que termina a las 17:00 (16:00
// el viernes) y parte a las 12:30 (12:00 el viernes). Es el MISMO criterio que
// usa el reloj de marcaje en js/clockMarks.js.
const LONG_BASE_ROTATIONS = ["3turno", "4turno"];
// La extension horaria es el tramo HT: 14:00 a 20:00. Un turno de 18 horas es
// esa extension pegada a la noche.
const EXTENSION_START = "14:00";

/**
 * El medio permiso administrativo de ese dia, o "" si no tiene.
 *
 * Solo se reconocen los valores actuales, que dicen QUE mitad se pide. El 0.5
 * antiguo -guardado antes de distinguir manana de tarde- no permite rotular la
 * franja, asi que se sigue tratando como ausencia del dia completo.
 *
 * @param {string} profileName
 * @param {string} keyDay clave interna `YYYY-M-D`
 * @returns {"0.5M"|"0.5T"|""}
 */
export function getHalfAdminHalf(profileName, keyDay) {
    const value = getJSON(`admin_${profileName}`, {})[keyDay];

    if (value === "0.5M" || value === "0.5T") return value;

    return "";
}

function halfAdminCutTime(profileName, keyDay) {
    if (LONG_BASE_ROTATIONS.includes(getRotativa(profileName).type)) {
        return "14:00";
    }

    const date = keyToDate(keyDay);
    const friday = date instanceof Date &&
        !Number.isNaN(date.getTime()) &&
        date.getDay() === 5;

    return friday ? "12:00" : "12:30";
}

/**
 * La franja parcial del trabajador en ese turno, o null si viene la jornada
 * completa (o si no viene en absoluto).
 *
 * Solo el turno diurno se parte: la noche es un bloque, y ni el 1/2 ADM ni la
 * extension horaria la tocan.
 *
 * @param {string} profileName
 * @param {string} keyDay clave interna `YYYY-M-D`
 * @param {"day"|"night"} shift
 * @param {number} [turn] turno real del dia; se calcula si no se pasa
 * @returns {{boundary: "from"|"until", time: string}|null}
 */
export function getPartialShiftWindow(profileName, keyDay, shift, turn) {
    if (shift !== "day") return null;

    const half = getHalfAdminHalf(profileName, keyDay);

    // 1/2 ADM Manana: la manana es el permiso, asi que entra al corte.
    if (half === "0.5M") {
        return {
            boundary: "from",
            time: halfAdminCutTime(profileName, keyDay)
        };
    }

    // 1/2 ADM Tarde: trabaja la manana y se retira en el corte.
    if (half === "0.5T") {
        return {
            boundary: "until",
            time: halfAdminCutTime(profileName, keyDay)
        };
    }

    const state = Number(
        turn === undefined ? getTurnoReal(profileName, keyDay) : turn
    ) || TURNO.LIBRE;

    if (state === TURNO.MEDIA_MANANA) {
        return { boundary: "until", time: EXTENSION_START };
    }

    // Extension horaria suelta, o pegada a la noche en un turno de 18 horas.
    if (state === TURNO.MEDIA_TARDE || state === TURNO.TURNO18) {
        return { boundary: "from", time: EXTENSION_START };
    }

    return null;
}

/**
 * Rotulo de la franja: "desde las 14:00" / "hasta las 12:30". La forma
 * compacta -"desde 14:00"- es para la programacion publicada, donde el nombre
 * y la franja comparten una celda angosta.
 *
 * @param {{boundary: string, time: string}|null} window
 * @param {{compact?: boolean}} [options]
 * @returns {string}
 */
export function partialShiftLabel(window, { compact = false } = {}) {
    if (!window?.time) return "";

    const prefix = window.boundary === "from" ? "desde" : "hasta";

    return compact
        ? `${prefix} ${window.time}`
        : `${prefix} las ${window.time}`;
}
