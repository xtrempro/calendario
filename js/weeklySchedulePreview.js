// Visor de la programacion semanal publicada, para el supervisor.
//
// Hasta ahora la programacion solo se VEIA en la PWA del trabajador: el menu de
// Asignacion de Tareas la sube y dice "Tabla leida del Excel · 34 filas", pero
// no la muestra. Este modulo la dibuja igual que la ve el trabajador, para que
// el supervisor pueda revisar lo que publico sin pedirle el telefono a nadie.
//
// Solo LEE. Publicar, corregir o borrar sigue siendo del menu de tareas.

import { escapeHTML } from "./htmlUtils.js";
import {
    getScheduleAttachment,
    getScheduleAttachments,
    scheduleWeekStartISO
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
 * Cuerpo del visor para una semana. Devuelve HTML.
 *
 * Si la programacion de esa semana se publico como Excel, se dibuja la tabla.
 * Si se publico como imagen, el llamador tiene que resolver su URL de descarga
 * y pasarla en imageUrl: leerla de Storage es asincrono y este modulo se
 * mantiene sincrono para poder repintarse sin esperas.
 */
export function weeklyScheduleBody(weekStart, { imageUrl = "", loading = false } = {}) {
    const attachment = getScheduleAttachment(weekStart);

    if (!attachment) {
        return `<div class="ws-empty">No hay programación publicada para esta semana.</div>`;
    }

    if (attachment.grid?.rows?.length) {
        return gridTableHTML(attachment.grid);
    }

    if (imageUrl) {
        return `
            <div class="ws-image-scroll" role="region" aria-label="Programación semanal" tabindex="0">
                <img src="${escapeHTML(imageUrl)}" alt="${escapeHTML(attachment.name || "Programación")}">
            </div>`;
    }

    return `
        <div class="ws-empty">${
            loading
                ? "Cargando la programación publicada..."
                : "No se pudo cargar la imagen de la programación."
        }</div>`;
}

/**
 * Indica si esa semana se publico como imagen (y por lo tanto hay que ir a
 * buscar su URL a Storage antes de poder mostrarla).
 */
export function weekNeedsImage(weekStart) {
    const attachment = getScheduleAttachment(weekStart);

    return Boolean(
        attachment &&
        !attachment.grid?.rows?.length &&
        (attachment.storagePath || attachment.dataUrl || attachment.downloadURL)
    );
}

export function weekAttachment(weekStart) {
    return getScheduleAttachment(weekStart);
}

export function weekISO(weekStart) {
    return scheduleWeekStartISO(weekStart);
}
