import { getJSON, setJSON } from "./persistence.js";
import { getCurrentProfile } from "./storage.js";

const KEY = "auditLog";
const MAX_LOGS = 1500;

export const AUDIT_CATEGORY = {
    TURN_CHANGES: "turn_changes",
    OVERTIME: "overtime",
    LEAVE_ABSENCE: "leave_absence",
    CALENDAR: "calendar",
    COLLABORATOR_CREATED: "collaborator_created",
    COLLABORATOR_UPDATED: "collaborator_updated",
    PROFILE_STATUS: "profile_status",
    STAFFING: "staffing"
};

const CATEGORY_DEFS = [
    {
        key: AUDIT_CATEGORY.TURN_CHANGES,
        title: "Cambios de Turno",
        tone: "orange"
    },
    {
        key: AUDIT_CATEGORY.OVERTIME,
        title: "Horas Extras",
        tone: "green"
    },
    {
        key: AUDIT_CATEGORY.LEAVE_ABSENCE,
        title: "Aplicacion de Vacaciones/Ausencias",
        tone: "cyan"
    },
    {
        key: AUDIT_CATEGORY.CALENDAR,
        title: "Modificaciones del Calendario",
        tone: "blue"
    },
    {
        key: AUDIT_CATEGORY.COLLABORATOR_CREATED,
        title: "Creacion de Nuevos Colaboradores",
        tone: "violet"
    },
    {
        key: AUDIT_CATEGORY.COLLABORATOR_UPDATED,
        title: "Modificacion de Datos de los Colaboradores",
        tone: "yellow"
    },
    {
        key: AUDIT_CATEGORY.PROFILE_STATUS,
        title: "Inactivacion y Reactivacion de Perfiles",
        tone: "red"
    },
    {
        key: AUDIT_CATEGORY.STAFFING,
        title: "Modificacion de Dotacion Requerida",
        tone: "muted"
    }
];

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function categoryDef(category) {
    return CATEGORY_DEFS.find(item => item.key === category) ||
        CATEGORY_DEFS[0];
}

function normalizeLogs(logs) {
    return Array.isArray(logs)
        ? logs.filter(log => log && log.createdAt)
        : [];
}

function formatTimestamp(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Sin fecha";

    return date.toLocaleString("es-CL", {
        dateStyle: "short",
        timeStyle: "medium"
    });
}

function sortedLogs() {
    return getAuditLogs()
        .slice()
        .sort((a, b) =>
            String(b.createdAt).localeCompare(String(a.createdAt))
        );
}

function latestForCategory(logs, category) {
    return logs.find(log => log.category === category) || null;
}

function summaryCardHTML(logs, def) {
    const count =
        logs.filter(log => log.category === def.key).length;
    const latest = latestForCategory(logs, def.key);

    return `
        <article class="audit-summary-card audit-summary-card--${def.tone}">
            <span>${escapeHTML(def.title)}</span>
            <strong>${count}</strong>
            <small>
                ${latest
                    ? `Ultimo: ${escapeHTML(formatTimestamp(latest.createdAt))}`
                    : "Sin registros"}
            </small>
        </article>
    `;
}

function entryHTML(log) {
    const def = categoryDef(log.category);

    return `
        <article class="audit-entry">
            <div class="audit-entry__head">
                <span class="audit-chip audit-chip--${def.tone}">
                    ${escapeHTML(def.title)}
                </span>
                <time>${escapeHTML(formatTimestamp(log.createdAt))}</time>
            </div>
            <strong>${escapeHTML(log.action)}</strong>
            ${log.details ? `<p>${escapeHTML(log.details)}</p>` : ""}
            ${log.profile ? `<small>Perfil: ${escapeHTML(log.profile)}</small>` : ""}
        </article>
    `;
}

export function getAuditCategories() {
    return CATEGORY_DEFS.map(item => ({ ...item }));
}

export function getAuditLogs() {
    return normalizeLogs(getJSON(KEY, []));
}

export function addAuditLog(category, action, details = "", meta = {}) {
    const def = categoryDef(category);
    const logs = getAuditLogs();
    const entry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        category: def.key,
        action: String(action || def.title),
        details: String(details || ""),
        profile:
            meta.profile !== undefined
                ? String(meta.profile || "")
                : (getCurrentProfile() || ""),
        createdAt: new Date().toISOString(),
        meta: {
            ...meta
        }
    };

    logs.push(entry);
    setJSON(KEY, logs.slice(-MAX_LOGS));

    if (document.body.dataset.activeView === "log") {
        renderAuditLogPanel();
    }
}

export function renderAuditLogPanel() {
    const box = document.getElementById("auditLogPanel");
    if (!box) return;

    const logs = sortedLogs();

    box.innerHTML = `
        <div class="section-head">
            <h3>LOG / Bitacora de Modificaciones</h3>
        </div>

        <div class="audit-summary-grid">
            ${CATEGORY_DEFS.map(def =>
                summaryCardHTML(logs, def)
            ).join("")}
        </div>

        <div class="audit-feed">
            <div class="audit-feed__head">
                <h4>Detalle de registros</h4>
                <span>${logs.length} registros guardados</span>
            </div>
            ${logs.length
                ? logs.map(entryHTML).join("")
                : `
                    <div class="empty-state empty-state--compact">
                        Aun no hay modificaciones registradas.
                    </div>
                `}
        </div>
    `;
}

window.renderAuditLogPanel = renderAuditLogPanel;
