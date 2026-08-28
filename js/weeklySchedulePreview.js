// Visor de la programacion semanal, para el supervisor.
//
// La fuente es la ASIGNACION DE TAREAS: lo que se ve aca es la misma tabla de
// "Ver programación" del menu de tareas. Antes se dibujaba el Excel que subia
// el supervisor, que obligaba a mantener dos verdades -lo repartido en el
// tablero y lo subido a mano- y a que no coincidieran.
//
// El Excel se sigue pudiendo adjuntar; simplemente ya no es lo que se muestra.
//
// Solo LEE. Repartir tareas sigue siendo del menu de Asignacion de Tareas.

import { escapeHTML } from "./htmlUtils.js";
import {
    getScheduleAttachment,
    getScheduleAttachments,
    scheduleWeekStartISO,
    taskScheduleGrid
} from "./taskAssignments.js";

const DIAS_POR_DEFECTO = [
    "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO"
];
const MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

function parseISO(iso) {
    const [year, month, day] = String(iso || "").split("-").map(Number);

    if (!year || !month || !day) return null;

    const date = new Date(year, month - 1, day);

    return Number.isNaN(date.getTime()) ? null : date;
}

export function weekStartMonday(date = new Date()) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    // getDay() da 0 en domingo; la semana parte el lunes.
    day.setDate(day.getDate() - ((day.getDay() + 6) % 7));

    return day;
}

export function addDays(date, days) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    next.setDate(next.getDate() + days);

    return next;
}

/**
 * Rotulo de la semana, con el mes escrito: es lo que permite saber en que mes
 * se esta parado mientras se avanza semana a semana.
 */
export function weekHeading(weekStart) {
    const end = addDays(weekStart, 6);
    const mismoMes = weekStart.getMonth() === end.getMonth();
    const inicio = mismoMes
        ? `${weekStart.getDate()}`
        : `${weekStart.getDate()} de ${MESES[weekStart.getMonth()]}`;

    return `${inicio} al ${end.getDate()} de ${MESES[end.getMonth()]} ` +
        `de ${end.getFullYear()}`;
}

/**
 * Semanas del mes que tienen programacion publicada. Sirve para no obligar a
 * recorrer semana por semana buscando cual tiene algo.
 */
export function publishedWeeksOfMonth(reference = new Date()) {
    const attachments = getScheduleAttachments();
    const year = reference.getFullYear();
    const month = reference.getMonth();

    return Object.keys(attachments)
        .map(parseISO)
        .filter(Boolean)
        .filter(date => {
            // Una semana pertenece al mes si CUALQUIERA de sus dias cae en el:
            // la que cruza el cambio de mes tiene que aparecer en los dos.
            const end = addDays(date, 6);

            return (date.getFullYear() === year && date.getMonth() === month) ||
                (end.getFullYear() === year && end.getMonth() === month);
        })
        .sort((a, b) => a - b);
}

function cellHTML(text) {
    return text
        ? String(text).split("\n").map(line => escapeHTML(line)).join("<br>")
        : "&nbsp;";
}

// Se dibuja siguiendo la ocupacion de cada columna: los bloques de fin de
// semana son celdas combinadas verticalmente (rowSpan), asi que las filas de
// abajo no vuelven a emitir esa columna. Es la misma logica que usa la PWA; si
// se simplificara, las columnas se correrian de lugar.
function gridTableHTML(grid) {
    const days = grid.days?.length ? grid.days : DIAS_POR_DEFECTO;
    const dayCount = days.length;
    const active = new Array(dayCount).fill(0);

    const rows = (grid.rows || []).map(row => {
        const roleTh = `
            <th scope="row" class="ws-role">
                <strong>${escapeHTML(row.title || "")}</strong>
                ${row.detail ? `<span>${escapeHTML(row.detail)}</span>` : ""}
            </th>`;

        if (row.fullWidth) {
            const libres = active.reduce(
                (total, busy) => total + (busy === 0 ? 1 : 0),
                0
            ) || dayCount;

            for (let i = 0; i < dayCount; i += 1) {
                if (active[i] > 0) active[i] -= 1;
            }

            return `
                <tr data-tone="${escapeHTML(String(row.tone || ""))}">
                    ${roleTh}
                    <td class="ws-cell ws-cell--full" colspan="${libres}">${cellHTML(row.fullText)}</td>
                </tr>`;
        }

        let index = 0;
        let cells = "";

        for (let col = 0; col < dayCount; col += 1) {
            if (active[col] > 0) {
                active[col] -= 1;
                continue;
            }

            const cell = row.cells?.[index];

            index += 1;

            const isObject = cell && typeof cell === "object";
            const text = isObject ? cell.text : cell;
            const rowSpan = isObject
                ? Math.max(1, Math.round(Number(cell.rowSpan) || 1))
                : 1;

            if (rowSpan > 1) {
                active[col] = rowSpan - 1;
                cells += `<td class="ws-cell ws-cell--weekend" rowspan="${rowSpan}">${cellHTML(text)}</td>`;
            } else {
                cells += `<td class="ws-cell">${cellHTML(text)}</td>`;
            }
        }

        return `
            <tr data-tone="${escapeHTML(String(row.tone || ""))}">
                ${roleTh}
                ${cells}
            </tr>`;
    }).join("");

    return `
        <div class="ws-table-scroll" role="region" aria-label="Programación semanal" tabindex="0">
            <table class="ws-table">
                <thead>
                    <tr>
                        <th class="ws-role"></th>
                        ${days.map(day => `<th>${escapeHTML(day)}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

/**
 * Fecha y hora de la ultima edicion, para saber si lo que se esta mirando es
 * reciente. Sin esto, una programacion vieja y una recien tocada se ven igual.
 */
export function scheduleUpdatedHTML(updatedAtISO) {
    if (!updatedAtISO) return "";

    const date = new Date(updatedAtISO);

    if (Number.isNaN(date.getTime())) return "";

    return `
        <p class="ws-updated">Última modificación: ${escapeHTML(
            date.toLocaleString("es-CL", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            })
        )}</p>`;
}

/**
 * El cuerpo del visor sale de la ASIGNACION DE TAREAS, no del Excel que sube el
 * supervisor: es la misma tabla que se ve en "Ver programación" del menu de
 * tareas. El Excel se sigue pudiendo adjuntar, pero ya no es lo que se muestra.
 */
export function weeklyScheduleBody(weekStart) {
    const grid = taskScheduleGrid(weekStart);

    if (!grid.rows.length) {
        return `<div class="ws-empty">Todavía no hay tareas asignadas en esta semana.</div>`;
    }

    return `${gridTableHTML(grid)}${scheduleUpdatedHTML(grid.updatedAtISO)}`;
}

/**
 * Indica si esa semana se publico como imagen (y por lo tanto hay que ir a
 * buscar su URL a Storage antes de poder mostrarla).
 */
export function weekNeedsImage() {
    // El visor ya no dibuja la imagen del Excel, sino la asignacion de tareas,
    // asi que no hay nada que ir a buscar a Storage.
    return false;
}

export function weekAttachment(weekStart) {
    return getScheduleAttachment(weekStart);
}

export function weekISO(weekStart) {
    return scheduleWeekStartISO(weekStart);
}
