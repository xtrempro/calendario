// Constructores de HTML para los registros de recursos humanos del perfil
// (campos del formulario y tarjetas de cada entrada). Son funciones puras de
// presentacion: reciben config/entry y devuelven HTML.

import { formatDisplayDate } from "./dateUtils.js";
import { escapeHTML } from "./htmlUtils.js";

/**
 * Anio (YYYY) de una entrada de registro, tomado de su fecha de inicio.
 * @param {{date?: string, start?: string}} entry
 * @returns {string}
 */
export function getRecordYear(entry) {
    const source = entry.date || entry.start || "";

    return source ? String(source).slice(0, 4) : "";
}

/**
 * Etiqueta del archivo adjunto de una entrada, si tiene.
 * @param {{file?: {name?: string}}} entry
 * @returns {string}
 */
function renderAttachmentName(entry) {
    return entry?.file?.name
        ? `<small>Clip: ${escapeHTML(entry.file.name)}</small>`
        : "";
}

/**
 * Campo de formulario (input o textarea) para una entrada de registro.
 * @param {{name: string, label: string, type?: string}} field
 * @param {string} recordKey
 * @returns {string}
 */
export function renderRecordField(field, recordKey) {
    const id = `${recordKey}_${field.name}`;

    if (field.type === "textarea") {
        return `
            <label class="record-field record-field--wide">
                <span>${field.label}</span>
                <textarea id="${id}" data-field="${field.name}" rows="3"></textarea>
            </label>
        `;
    }

    return `
        <label class="record-field">
            <span>${field.label}</span>
            <input id="${id}" data-field="${field.name}" type="${field.type || "text"}">
        </label>
    `;
}

// Campo "principal" (titulo) y campos "secundarios" (subtexto) por tipo de
// registro, para mostrar cada entrada como fila limpia (fecha | titulo | sub).
const PF_PRIMARY_FIELD = {
    academic: "degree",
    training: "name",
    diplomas: "name",
    experience: "institution",
    events: "detail",
    merit: "title",
    demerit: "title",
    performance: "detail"
};
const PF_SECONDARY_FIELDS = {
    academic: ["institution", "level"],
    training: ["hours", "grade"],
    diplomas: ["hours", "grade"],
    experience: ["role", "functions"],
    events: [],
    merit: [],
    demerit: [],
    performance: []
};

/**
 * Fila de una entrada de registro (estilo mockup: fecha + titulo + subtexto).
 * @param {{key: string, fields: Array<{name: string, label: string, type?: string}>}} config
 * @param {Object} entry
 * @returns {string}
 */
export function renderRecordEntry(config, entry) {
    const typeByName = {};
    config.fields.forEach(field => {
        typeByName[field.name] = field.type;
    });

    const fmt = name => {
        let value = entry[name];
        if (!value) return "";
        if (typeByName[name] === "date") value = formatDisplayDate(value);
        if (name === "hours") value = `${value} h`;
        return String(value);
    };

    const primaryName =
        PF_PRIMARY_FIELD[config.key] ||
        config.fields.find(field => field.type !== "date")?.name ||
        config.fields[0]?.name;
    const primary = fmt(primaryName) || "Sin dato";
    const secondary = (PF_SECONDARY_FIELDS[config.key] || [])
        .map(fmt)
        .filter(Boolean)
        .join(" · ");

    const startYear = String(entry.start || entry.date || "").slice(0, 4);
    let dateHTML;
    if (config.key === "experience" && entry.start && entry.end) {
        dateHTML =
            `${escapeHTML(startYear)}<br>${escapeHTML(String(entry.end).slice(0, 4))}`;
    } else {
        dateHTML = escapeHTML(startYear || "—");
    }

    const tag = config.key === "merit"
        ? `<span class="pf-tag g">+ Mérito</span>`
        : config.key === "demerit"
            ? `<span class="pf-tag r">− Demérito</span>`
            : "";
    const rowClass = config.key === "merit"
        ? " merit"
        : config.key === "demerit"
            ? " demerit"
            : "";

    return `
        <article class="pf-rec-item${rowClass}">
            <span class="pf-rec-date">${dateHTML}</span>
            <div class="pf-rec-body">
                <b>${escapeHTML(primary)}</b>
                ${secondary ? `<small>${escapeHTML(secondary)}</small>` : ""}
                ${renderAttachmentName(entry)}
            </div>
            ${tag}
        </article>
    `;
}
