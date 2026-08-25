// Visor de la asignacion de tareas con el formato de la programacion publicada.
//
// El supervisor arma las tareas en un tablero de tarjetas, pero lo que la gente
// termina leyendo -y lo que ve el trabajador cuando se sube el Excel de la
// programacion- es una tabla de una fila por tarea y una columna por dia. Este
// modulo dibuja esa misma tabla con los datos del tablero, para poder revisar
// como va a quedar sin tener que exportar nada.
//
// Solo LEE. Se reusan las clases del visor de programacion publicada
// (.ws-table, .ws-role, .ws-cell) a proposito: el ensayo y el resultado final
// tienen que verse iguales, y asi hay una sola hoja de estilos que mantener.

import { escapeHTML } from "./htmlUtils.js";
import {
    getTaskScheduleWeek,
    goToTaskScheduleToday,
    moveTaskScheduleWeek
} from "./taskAssignments.js";
import { weekHeading } from "./weeklySchedulePreview.js";

const TABLE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14.5h18M9 9v11M15 9v11"/></svg>`;

let backdrop = null;

// Los nombres van pegados con guion, igual que en la programacion que publica
// el supervisor: "J.CORNEJO-B.ESCOBAR-A.SALGADO". El comentario de la celda,
// si lo hay, baja a su propia linea.
function cellHTML(cell) {
    const lines = [];

    if (cell.workers.length) lines.push(cell.workers.join("-"));
    if (cell.note) lines.push(cell.note);

    return lines.length
        ? lines.map(line => escapeHTML(line)).join("<br>")
        : "&nbsp;";
}

// Una casilla fusionada se emite UNA vez, en la fila de su tarea de arriba,
// con el rowspan de todo el grupo; las filas que quedan tapadas no vuelven a
// emitir esa columna o se correrian todas de lugar.
function rowCellsHTML(row) {
    return row.cells.map(cell => {
        if (cell.covered) return "";

        if (cell.rowSpan > 1) {
            return `<td class="ws-cell tsp-cell--merged" rowspan="${cell.rowSpan}">${cellHTML(cell)}</td>`;
        }

        return `<td class="ws-cell">${cellHTML(cell)}</td>`;
    }).join("");
}

function sectionHTML(section, days) {
    const rows = section.rows.map(row => `
        <tr>
            <th scope="row" class="ws-role">
                <strong>${escapeHTML(row.title)}</strong>
                ${row.detail ? `<span>${escapeHTML(row.detail)}</span>` : ""}
            </th>
            ${rowCellsHTML(row)}
        </tr>`).join("");

    return `
        <section class="tsp-section">
            <h4 class="tsp-section-title">${escapeHTML(section.label)}</h4>
            <div class="ws-table-scroll" role="region" aria-label="${escapeHTML(section.label)}" tabindex="0">
                <table class="ws-table">
                    <thead>
                        <tr>
                            <th class="ws-role"></th>
                            ${days.map(day => `<th>${escapeHTML(day.weekday.toUpperCase())} ${escapeHTML(String(day.dayNumber))}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>`;
}

function bodyHTML(week) {
    if (!week.sections.length) {
        return `<div class="ws-empty">Todavía no hay trabajadores asignados en esta semana.</div>`;
    }

    return week.sections
        .map(section => sectionHTML(section, week.days))
        .join("");
}

function render() {
    if (!backdrop) return;

    const week = getTaskScheduleWeek();

    backdrop.querySelector("[data-preview-heading]").textContent =
        weekHeading(week.weekStart);
    backdrop.querySelector("[data-preview-body]").innerHTML = bodyHTML(week);
}

function close() {
    if (!backdrop) return;

    document.removeEventListener("keydown", onKeyDown);
    backdrop.remove();
    backdrop = null;
}

function onKeyDown(event) {
    if (event.key === "Escape") close();
}

// La semana se mueve en el tablero, no solo en el visor: asi lo que se esta
// mirando aca y lo que queda abierto detras son siempre la misma semana.
function navigate(action) {
    if (action === "today") {
        goToTaskScheduleToday();
    } else {
        moveTaskScheduleWeek(action === "prev" ? -7 : 7);
    }

    render();
}

export function openTaskSchedulePreview() {
    close();

    backdrop = document.createElement("div");
    backdrop.className = "hm-modal-backdrop tsp-backdrop";
    backdrop.innerHTML = `
        <div class="hm-modal hm-modal--weekly" role="dialog" aria-modal="true" aria-label="Programación de tareas">
            <div class="hm-modal-head">
                <span class="hm-modal-ico">${TABLE_ICON}</span>
                <h3>Programación · <span data-preview-heading></span></h3>
                <div class="hm-bday-nav">
                    <button type="button" data-preview-nav="prev" aria-label="Semana anterior">&#8249;</button>
                    <button type="button" data-preview-nav="next" aria-label="Semana siguiente">&#8250;</button>
                </div>
                <button class="hm-btn-secondary hm-ws-today" type="button" data-preview-nav="today">Hoy</button>
                <button class="hm-modal-close" type="button" data-preview-close aria-label="Cerrar">&times;</button>
            </div>
            <div class="hm-modal-body" data-preview-body></div>
        </div>`;

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-preview-close]")
        .addEventListener("click", close);
    backdrop
        .querySelectorAll("[data-preview-nav]")
        .forEach(button => {
            button.addEventListener("click", () => {
                navigate(button.dataset.previewNav);
            });
        });

    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKeyDown);
    render();
}
