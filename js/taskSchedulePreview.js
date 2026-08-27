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

const PRINT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><path d="M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/></svg>`;
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

// ---------------------------------------------------------------------------
// Impresion en hoja carta.
//
// Se arma un documento aparte en vez de imprimir el modal: la tabla del visor
// vive dentro de un backdrop con scroll y sombras, y lo que se necesita en
// papel es otra cosa -tinta minima, letra chica, la hoja entera aprovechada-.
//
// `@page { margin: 0 }` quita el margen de pagina del navegador. El aire de
// 5 mm del body NO es un margen de adorno: casi ninguna impresora imprime al
// borde fisico, y sin ese colchon la primera y la ultima columna salen
// cortadas.
//
// Si la tabla no cabe, `thead { display: table-header-group }` hace que el
// navegador repita los titulos de las columnas en cada hoja.
// ---------------------------------------------------------------------------

const PRINT_STYLES = `
    @page { size: letter landscape; margin: 0; }

    * { box-sizing: border-box; }

    *,
    *::before,
    *::after {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    html, body { margin: 0; padding: 0; background: #fff; }

    body {
        padding: 5mm;
        color: #111827;
        font-family: "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif;
        font-size: 8pt;
        line-height: 1.25;
    }

    h1 {
        margin: 0 0 3mm;
        font-size: 12pt;
        font-weight: 800;
        letter-spacing: -0.01em;
    }

    .tsp-print-section { margin-bottom: 4mm; }

    h2 {
        margin: 0 0 1.5mm;
        font-size: 8pt;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #334155;
        break-after: avoid;
        page-break-after: avoid;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
    }

    /* Repite los titulos de las columnas en cada hoja. */
    thead { display: table-header-group; }

    tr {
        break-inside: avoid;
        page-break-inside: avoid;
    }

    th, td {
        border: 0.5pt solid #94a3b8;
        padding: 2.5pt 3pt;
        vertical-align: top;
        overflow-wrap: anywhere;
    }

    thead th {
        background: #0f172a;
        color: #fff;
        font-size: 7pt;
        font-weight: 800;
        letter-spacing: 0.03em;
        text-align: left;
        text-transform: uppercase;
    }

    tbody th {
        text-align: left;
        font-size: 7.5pt;
        font-weight: 800;
        background: #f1f5f9;
    }

    tbody th span {
        display: block;
        font-size: 6.5pt;
        font-weight: 600;
        color: #475569;
    }

    col.tsp-print-col--task { width: 14%; }
    col.tsp-print-col--day { width: 12.28%; }

    .tsp-print-empty { color: #64748b; font-style: italic; }
`;

function printTableHTML(section, days) {
    const rows = section.rows.map(row => `
        <tr>
            <th scope="row">
                ${escapeHTML(row.title)}
                ${row.detail ? `<span>${escapeHTML(row.detail)}</span>` : ""}
            </th>
            ${rowCellsHTML(row)}
        </tr>`).join("");

    return `
        <section class="tsp-print-section">
            <h2>${escapeHTML(section.label)}</h2>
            <table>
                <colgroup>
                    <col class="tsp-print-col--task">
                    ${days.map(() => `<col class="tsp-print-col--day">`).join("")}
                </colgroup>
                <thead>
                    <tr>
                        <th>Tarea</th>
                        ${days.map(day => `<th>${escapeHTML(day.weekday.toUpperCase())} ${escapeHTML(String(day.dayNumber))}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </section>`;
}

function printDocumentHTML(week) {
    const title = `Programación · ${weekHeading(week.weekStart)}`;
    const body = week.sections.length
        ? week.sections
            .map(section => printTableHTML(section, week.days))
            .join("")
        : `<p class="tsp-print-empty">Todavía no hay trabajadores asignados en esta semana.</p>`;

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHTML(title)}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
<h1>${escapeHTML(title)}</h1>
${body}
</body>
</html>`;
}

// Se imprime desde un iframe oculto y no desde `window.open`: una ventana
// emergente la bloquea el navegador por defecto y obligaria a explicarle al
// supervisor como habilitarla.
function printSchedule() {
    const frame = document.createElement("iframe");

    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("title", "Programación para imprimir");
    frame.style.cssText =
        "position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;";

    document.body.appendChild(frame);

    const view = frame.contentWindow;
    const doc = view?.document;

    let removed = false;
    const remove = () => {
        if (removed) return;
        removed = true;
        frame.remove();
    };

    if (!doc) {
        remove();
        return;
    }

    doc.open();
    doc.write(printDocumentHTML(getTaskScheduleWeek()));
    doc.close();

    // Se retira despues de imprimir, no de inmediato: quitar el iframe
    // mientras el dialogo sigue abierto cancela la impresion. El plazo largo
    // es la red de seguridad para cuando el navegador no dispara afterprint.
    view.onafterprint = remove;

    // NO se usa `frame.onload`: al insertar el iframe el navegador dispara un
    // `load` por el about:blank inicial, y ahi todavia no hay nada escrito, asi
    // que se imprimiria una hoja en blanco. El documento se escribe entero de
    // una vez y no carga nada externo, de modo que basta con ceder un turno del
    // event loop tras `close()`.
    setTimeout(() => {
        view.focus();
        view.print();
        setTimeout(remove, 60000);
    }, 0);
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
                <button class="hm-btn-secondary tsp-print" type="button" data-preview-print>${PRINT_ICON}Imprimir</button>
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
        .querySelector("[data-preview-print]")
        .addEventListener("click", printSchedule);
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
