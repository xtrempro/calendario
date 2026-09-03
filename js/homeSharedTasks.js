// Tareas diarias del inicio COMPARTIDAS con la unidad.
//
// Modulo puro (solo persistencia + texto) a proposito: lo importan las dos
// copias del motor de proyeccion -js/serverEngine.js, que es la que corre en la
// Cloud Function, y la copia de js/workerAppDataSync.js- ademas de
// js/homeTasks.js. Ahi no puede entrar nada del navegador (Firebase, DOM), y
// una regla de visibilidad duplicada a mano en tres archivos es exactamente
// como una tarea termina llegandole a quien no debia.
//
// La clave vive en el modulo de estado "home" (js/firebaseStateModules.js), que
// puede leer y escribir cualquier administrador del entorno.

import { getJSON } from "./persistence.js";
import { normalizeText } from "./stringUtils.js";
import { ESTAMENTO } from "./constants.js";

export const HOME_SHARED_TASKS_KEY = "home_shared_tasks";
export const HOME_TASK_ESTAMENTO_PREFIX = "estamento:";

// Visibilidad de una tarea diaria:
//   "private"        -> solo quien la crea (NO viaja por aca: se queda en el
//                       documento del usuario)
//   "all"            -> todos los administradores de la unidad
//   "workers"        -> ademas, todos los trabajadores (PWA)
//   "estamento:<X>"  -> ademas, los trabajadores de ese estamento
export function isValidHomeTaskVisibility(value) {
    if (value === "private" || value === "all" || value === "workers") {
        return true;
    }

    return typeof value === "string" &&
        value.startsWith(HOME_TASK_ESTAMENTO_PREFIX) &&
        ESTAMENTO.includes(value.slice(HOME_TASK_ESTAMENTO_PREFIX.length));
}

export function homeTaskVisibilityLabel(visibility) {
    if (visibility === "all") {
        return "Todos los usuarios administradores de la unidad";
    }

    if (visibility === "workers") return "Todos los trabajadores";

    if (
        typeof visibility === "string" &&
        visibility.startsWith(HOME_TASK_ESTAMENTO_PREFIX)
    ) {
        return `Trabajadores: ${visibility.slice(HOME_TASK_ESTAMENTO_PREFIX.length)}`;
    }

    return "Sólo quien lo crea";
}

// Etiqueta corta para la insignia de la fila (no cabe la frase completa).
export function homeTaskVisibilityBadge(visibility) {
    if (visibility === "all") return "Unidad";
    if (visibility === "workers") return "Trabajadores";

    if (
        typeof visibility === "string" &&
        visibility.startsWith(HOME_TASK_ESTAMENTO_PREFIX)
    ) {
        return visibility.slice(HOME_TASK_ESTAMENTO_PREFIX.length);
    }

    return "";
}

export function isSharedHomeTask(task) {
    return Boolean(task?.visibility) && task.visibility !== "private";
}

/**
 * Si una tarea compartida va dirigida a ESTE trabajador. "all" no lo esta: es
 * para los administradores del entorno, igual que en los recordatorios.
 */
export function homeTaskTargetsProfile(task, profileRole) {
    const visibility = String(task?.visibility || "");

    if (visibility === "workers") return true;

    if (visibility.startsWith(HOME_TASK_ESTAMENTO_PREFIX)) {
        const target = normalizeText(
            visibility.slice(HOME_TASK_ESTAMENTO_PREFIX.length)
        );

        return Boolean(target) && normalizeText(profileRole) === target;
    }

    return false;
}

// La PWA solo entiende estas periodicidades. Las del inicio que si tienen
// equivalente se traducen; "Diario Hábil" cae en "Diaria" porque el calendario
// del trabajador no conoce los feriados de la unidad (es lo mas cercano: avisar
// de mas es preferible a callar la tarea).
const RECURRENCE_TO_WORKER = {
    "Una sola vez": "Una sola vez",
    "Diario": "Diaria",
    "Diario Hábil": "Diaria",
    "Semanal": "Semanal",
    "Mensual": "Mensual",
    "Anual": "Anual"
};

// Trimestral y cuatrimestral no existen en la PWA. En vez de mandarlas mensuales
// (avisaria tres veces de mas) se mandan como fechas sueltas del proximo año.
const EXPANDED_RECURRENCE_MONTHS = {
    "Trimestral": 3,
    "Cuatrimestral": 4
};
const EXPANSION_MONTHS_AHEAD = 12;

function taskDateParts(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month ||
        date.getDate() !== day
    ) {
        return null;
    }

    return { year, month, day };
}

function isoFromParts(year, month, day) {
    return [
        year,
        String(month + 1).padStart(2, "0"),
        String(day).padStart(2, "0")
    ].join("-");
}

// Las fechas de una tarea trimestral/cuatrimestral dentro del año que viene,
// contadas desde su fecha de inicio. El dia se recorta al ultimo del mes (un
// 31 de enero cada tres meses cae en un 30 de abril).
function expandedOccurrences(task, today) {
    const step = EXPANDED_RECURRENCE_MONTHS[String(task?.repeat || "")];
    const start = taskDateParts(task?.date);

    if (!step || !start) return [];

    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const until = new Date(
        today.getFullYear(), today.getMonth() + EXPANSION_MONTHS_AHEAD, today.getDate()
    );
    const dates = [];

    for (let index = 0; index < 200; index += 1) {
        const monthIndex = start.month + index * step;
        const year = start.year + Math.floor(monthIndex / 12);
        const month = ((monthIndex % 12) + 12) % 12;
        const day = Math.min(start.day, new Date(year, month + 1, 0).getDate());
        const date = new Date(year, month, day);

        if (date > until) break;
        if (date >= from) dates.push(isoFromParts(year, month, day));
    }

    return dates;
}

/**
 * Las tareas compartidas que le tocan a un trabajador, con la forma que ya usa
 * la PWA para los recordatorios del supervisor (workerAppData.supervisorReminders).
 */
export function buildSharedHomeTaskReminders(profile, today = new Date()) {
    const tasks = getJSON(HOME_SHARED_TASKS_KEY, []);

    if (!Array.isArray(tasks)) return [];

    const role = profile?.estamento || "";

    return tasks
        .filter(task => task?.date && String(task?.name || "").trim())
        .filter(task => homeTaskTargetsProfile(task, role))
        .flatMap(task => {
            const title = String(task.name).trim();
            const base = {
                title,
                description: "Tarea compartida por el supervisor.",
                source: "Supervisor"
            };
            const periodicity = RECURRENCE_TO_WORKER[String(task.repeat || "")];

            if (periodicity) {
                return [{
                    ...base,
                    id: String(task.id || ""),
                    date: String(task.date),
                    periodicity
                }];
            }

            return expandedOccurrences(task, today).map(date => ({
                ...base,
                id: `${String(task.id || "")}_${date}`,
                date,
                periodicity: "Una sola vez"
            }));
        });
}
