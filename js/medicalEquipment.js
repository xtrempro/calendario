import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    ATTACHMENT_ACCEPT,
    attachmentStorageErrorMessage,
    deleteStoredAttachment,
    hasAttachmentContent,
    openAttachmentFile,
    readAttachmentFiles
} from "./attachmentUtils.js";
import {
    getCurrentFirebaseUser,
    getFirebaseServices,
    isFirebaseConfigured
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import { canEditMenu } from "./workspacePermissions.js";
import { showAlert, showConfirm } from "./dialogs.js";

export const MEDICAL_EQUIPMENT_KEY = "medicalEquipment";
const PUBLISHED_DOC_ID = "medicalEquipment";
const TASKS_KEY = "weekly_task_assignment_tasks";
const REPORTS_COLLECTION = "medicalEquipmentReports";
const MAX_EQUIPMENT = 300;
const MAX_TEXT = 240;
const MAX_LONG_TEXT = 3000;
const ALERT_DAYS = 30;

const STATUS_OPTIONS = [
    { id: "operational", label: "Operativo" },
    { id: "limited", label: "Operativo con observacion" },
    { id: "maintenance", label: "En mantenimiento" },
    { id: "inactive", label: "Inactivo" }
];

const MAINTENANCE_TYPES = [
    { id: "preventive", label: "Preventivo" },
    { id: "corrective", label: "Correctivo" },
    { id: "calibration", label: "Calibracion" },
    { id: "inspection", label: "Revision tecnica" }
];

const ERROR_STATUSES = [
    { id: "open", label: "Pendiente" },
    { id: "review", label: "En revision" },
    { id: "resolved", label: "Resuelto" },
    { id: "dismissed", label: "Descartado" }
];

const SEVERITIES = [
    { id: "low", label: "Baja" },
    { id: "medium", label: "Media" },
    { id: "high", label: "Alta" },
    { id: "critical", label: "Critica" }
];

let selectedEquipmentId = "";
let searchText = "";
let statusFilter = "all";
let reportFilter = "open";
let saving = false;
let reports = [];
let reportsLoading = false;
let reportsError = "";
let unsubscribeReports = null;
let currentReportWorkspaceId = "";

function clampText(value, maxLength = MAX_TEXT) {
    return String(value || "").trim().slice(0, maxLength);
}

function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
}

function makeId(prefix = "equipment") {
    return globalThis.crypto?.randomUUID?.() ||
        `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeId(value, fallbackPrefix = "item") {
    return String(value || "")
        .trim()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 90) || makeId(fallbackPrefix);
}

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function dateFromISO(iso) {
    const [year, month, day] = String(iso || "").split("-").map(Number);

    if (!year || !month || !day) return null;

    return new Date(year, month - 1, day);
}

function addDaysISO(iso, days) {
    const date = dateFromISO(iso);

    if (!date) return "";

    date.setDate(date.getDate() + days);

    return date.toISOString().slice(0, 10);
}

function addMonthsISO(iso, months) {
    const date = dateFromISO(iso);

    if (!date) return "";

    const originalDay = date.getDate();

    date.setDate(1);
    date.setMonth(date.getMonth() + months);

    const lastDay = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0
    ).getDate();

    date.setDate(Math.min(originalDay, lastDay));

    return date.toISOString().slice(0, 10);
}

function isoDate(value) {
    const clean = clampText(value, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : "";
}

function isoDateTime(value) {
    const clean = clampText(value, 30);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(clean) ? clean : "";
}

function timeFromISODateTime(value) {
    const clean = isoDateTime(value);

    return clean ? clean.slice(11, 16) : "";
}

function formatDateForSentence(iso) {
    const date = dateFromISO(iso);

    if (!date) return String(iso || "");

    return [
        String(date.getDate()).padStart(2, "0"),
        String(date.getMonth() + 1).padStart(2, "0"),
        date.getFullYear()
    ].join("/");
}

function optionLabel(options, value, fallback = "") {
    return options.find(item => item.id === value)?.label || fallback || value;
}

function normalizeStatus(value) {
    const clean = String(value || "").trim();
    return STATUS_OPTIONS.some(item => item.id === clean)
        ? clean
        : "operational";
}

function normalizeMaintenanceType(value) {
    const clean = String(value || "").trim();
    return MAINTENANCE_TYPES.some(item => item.id === clean)
        ? clean
        : "preventive";
}

function normalizeErrorStatus(value) {
    const clean = String(value || "").trim();
    return ERROR_STATUSES.some(item => item.id === clean)
        ? clean
        : "open";
}

function normalizeSeverity(value) {
    const clean = String(value || "").trim();
    return SEVERITIES.some(item => item.id === clean)
        ? clean
        : "medium";
}

function normalizeTaskIds(value = []) {
    return [...new Set(
        (Array.isArray(value) ? value : [])
            .map(item => String(item || "").trim())
            .filter(Boolean)
    )].slice(0, 80);
}

function normalizeAttachment(attachment = {}) {
    const name = clampText(attachment.name, 240);
    const dataUrl = String(attachment.dataUrl || "");
    const storagePath = String(attachment.storagePath || "");
    const downloadURL = String(attachment.downloadURL || "");

    if (!name || (!dataUrl && !storagePath && !downloadURL)) return null;

    return {
        id: String(attachment.id || makeId("equipment_file")),
        name,
        type: String(attachment.type || "application/octet-stream").toLowerCase(),
        size: Number(attachment.size) || 0,
        addedAt: String(attachment.addedAt || new Date().toISOString()),
        storagePath,
        downloadURL,
        dataUrl,
        uploadedByUid: String(attachment.uploadedByUid || "")
    };
}

function normalizeAttachments(value = []) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeAttachment)
        .filter(Boolean)
        .slice(0, 80);
}

function normalizeContact(contact = {}) {
    const name = clampText(contact.name);
    const phone = clampText(contact.phone, 80);
    const email = clampText(contact.email, 180);

    if (!name && !phone && !email) return null;

    return {
        id: String(contact.id || makeId("equipment_contact")),
        name: name || "Contacto",
        role: clampText(contact.role, 120),
        phone,
        email,
        notes: clampText(contact.notes, 800)
    };
}

function normalizeMaintenance(item = {}) {
    const date = isoDate(item.date) || todayISO();
    const id = String(item.id || makeId("equipment_maintenance"));
    const taskIds = normalizeTaskIds(item.taskIds);

    return {
        id,
        type: normalizeMaintenanceType(item.type),
        date,
        nextDate: isoDate(item.nextDate),
        startAt: isoDateTime(item.startAt),
        endAt: isoDateTime(item.endAt),
        provider: clampText(item.provider, 180),
        technician: clampText(item.technician, 180),
        summary: clampText(item.summary, MAX_LONG_TEXT),
        recommendations: clampText(item.recommendations, MAX_LONG_TEXT),
        taskIds,
        downtime: Boolean(item.downtime || taskIds.length || item.startAt || item.endAt),
        attachments: normalizeAttachments(item.attachments),
        createdAt: String(item.createdAt || new Date().toISOString())
    };
}

function normalizeManualError(item = {}) {
    const title = clampText(item.title || "Error informado", 160);
    const detail = clampText(item.detail || item.summary, MAX_LONG_TEXT);

    if (!title && !detail) return null;

    return {
        id: String(item.id || makeId("equipment_error")),
        firestore: false,
        title,
        detail,
        status: normalizeErrorStatus(item.status),
        severity: normalizeSeverity(item.severity),
        date: isoDate(item.date) || todayISO(),
        reportedByName: clampText(item.reportedByName || "Supervisor", 180),
        source: String(item.source || "supervisor"),
        attachments: normalizeAttachments(item.attachments),
        createdAt: String(item.createdAt || new Date().toISOString()),
        resolvedAt: String(item.resolvedAt || "")
    };
}

export function normalizeMedicalEquipmentItem(item = {}) {
    const id = normalizeId(item.id || item.code, "equipment");
    const createdAt = String(item.createdAt || new Date().toISOString());
    const maintenances = (Array.isArray(item.maintenances) ? item.maintenances : [])
        .map(normalizeMaintenance)
        .filter(Boolean)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const errors = (Array.isArray(item.errors) ? item.errors : [])
        .map(normalizeManualError)
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return {
        id,
        name: clampText(item.name || "Equipo medico", 180),
        code: clampText(item.code, 120),
        brand: clampText(item.brand, 120),
        model: clampText(item.model, 120),
        serialNumber: clampText(item.serialNumber, 120),
        location: clampText(item.location, 180),
        details: clampText(item.details, MAX_LONG_TEXT),
        status: normalizeStatus(item.status),
        serviceActive: Boolean(item.serviceActive),
        serviceProvider: clampText(item.serviceProvider, 180),
        serviceUntil: isoDate(item.serviceUntil),
        purchaseDate: isoDate(item.purchaseDate),
        installedAt: isoDate(item.installedAt),
        nextMaintenanceAt: isoDate(item.nextMaintenanceAt),
        maintenanceFrequencyDays: Math.max(
            0,
            Math.min(3650, Number(item.maintenanceFrequencyDays) || 0)
        ),
        manufacturerRecommendations: clampText(
            item.manufacturerRecommendations,
            MAX_LONG_TEXT
        ),
        taskIds: normalizeTaskIds(item.taskIds),
        contacts: (Array.isArray(item.contacts) ? item.contacts : [])
            .map(normalizeContact)
            .filter(Boolean)
            .slice(0, 60),
        documents: normalizeAttachments(item.documents),
        contractAttachments: normalizeAttachments(item.contractAttachments),
        maintenances,
        errors,
        createdAt,
        updatedAt: String(item.updatedAt || createdAt),
        createdByUid: String(item.createdByUid || ""),
        updatedByUid: String(item.updatedByUid || "")
    };
}

export function normalizeMedicalEquipment(value = []) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeMedicalEquipmentItem)
        .filter(item => item.name || item.code)
        .sort((a, b) => a.name.localeCompare(b.name, "es"))
        .slice(0, MAX_EQUIPMENT);
}

export function getMedicalEquipment() {
    return normalizeMedicalEquipment(getJSON(MEDICAL_EQUIPMENT_KEY, []));
}

export function selectMedicalEquipment(id) {
    selectedEquipmentId = String(id || "");
}

function getTaskCatalog() {
    const tasks = getJSON(TASKS_KEY, []);

    return (Array.isArray(tasks) ? tasks : [])
        .map(task => ({
            id: String(task?.id || "").trim(),
            title: clampText(task?.title, 160)
        }))
        .filter(task => task.id && task.title)
        .sort((a, b) => a.title.localeCompare(b.title, "es"));
}

function taskTitle(taskId, tasks = getTaskCatalog()) {
    return tasks.find(task => task.id === taskId)?.title || taskId;
}

function publicEquipmentPayload(items = getMedicalEquipment()) {
    const tasks = getTaskCatalog();

    return normalizeMedicalEquipment(items)
        .filter(item => item.status !== "inactive")
        .map(item => ({
            id: item.id,
            name: item.name,
            code: item.code,
            brand: item.brand,
            model: item.model,
            location: item.location,
            status: item.status,
            nextMaintenanceAt: item.nextMaintenanceAt,
            taskIds: item.taskIds,
            taskTitles: item.taskIds
                .map(taskId => taskTitle(taskId, tasks))
                .filter(Boolean)
        }));
}

export async function publishMedicalEquipmentToWorkers(items = getMedicalEquipment()) {
    const workspace = getActiveWorkspace();

    if (!isFirebaseConfigured() || !workspace?.id) return false;

    const { db, firestoreModule } = await getFirebaseServices();
    const now = new Date().toISOString();
    const ref = firestoreModule.doc(
        db,
        "workspaces",
        workspace.id,
        "published",
        PUBLISHED_DOC_ID
    );

    await firestoreModule.setDoc(ref, {
        workspaceId: workspace.id,
        workspaceName: workspace.name || "",
        items: publicEquipmentPayload(items),
        updatedAt: typeof firestoreModule.serverTimestamp === "function"
            ? firestoreModule.serverTimestamp()
            : now,
        updatedAtISO: now,
        updatedByUid: getCurrentFirebaseUser()?.uid || ""
    }, { merge: true });

    return true;
}

function dispatchMedicalEquipmentChanged() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("proturnos:medicalEquipmentChanged"));
}

async function saveMedicalEquipment(items, options = {}) {
    const normalized = normalizeMedicalEquipment(items);

    setJSON(MEDICAL_EQUIPMENT_KEY, normalized);
    dispatchMedicalEquipmentChanged();

    if (options.publish !== false) {
        publishMedicalEquipmentToWorkers(normalized).catch(error => {
            console.warn("No se pudo publicar equipos medicos a la PWA.", error);
        });
    }

    return normalized;
}

function upsertEquipment(item) {
    const current = getMedicalEquipment();
    const normalized = normalizeMedicalEquipmentItem({
        ...item,
        updatedAt: new Date().toISOString(),
        updatedByUid: getCurrentFirebaseUser()?.uid || ""
    });
    const exists = current.some(entry => entry.id === normalized.id);
    const next = exists
        ? current.map(entry => entry.id === normalized.id ? normalized : entry)
        : [...current, normalized];

    return saveMedicalEquipment(next);
}

function removeEquipment(id) {
    return saveMedicalEquipment(
        getMedicalEquipment().filter(item => item.id !== id)
    );
}

function ageLabel(item) {
    const origin = item.installedAt || item.purchaseDate;
    if (!origin) return "Sin fecha";

    const start = new Date(`${origin}T12:00:00`);
    if (Number.isNaN(start.getTime())) return "Sin fecha";

    const days = Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);

    if (years > 0) return `${years} a\u00f1o${years === 1 ? "" : "s"} ${months} m`;
    if (months > 0) return `${months} mes${months === 1 ? "" : "es"}`;
    return `${days} d\u00edas`;
}

function daysUntil(iso) {
    if (!iso) return null;

    const target = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(target.getTime())) return null;

    const today = new Date();
    const base = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        12
    );

    return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function maintenanceTone(item) {
    const days = daysUntil(item.nextMaintenanceAt);

    if (days === null) return "muted";
    if (days < 0) return "danger";
    if (days <= 7) return "warning";
    if (days <= ALERT_DAYS) return "notice";
    return "ok";
}

function maintenanceDueText(item) {
    const days = daysUntil(item.nextMaintenanceAt);

    if (days === null) return "Sin proximo mantenimiento";
    if (days < 0) return `Vencido hace ${Math.abs(days)} d`;
    if (days === 0) return "Vence hoy";
    return `En ${days} d`;
}

function reportIsOpen(report) {
    return !["resolved", "dismissed"].includes(report.status);
}

function reportsForEquipment(equipmentId) {
    return reports.filter(report => report.equipmentId === equipmentId);
}

function filteredEquipment() {
    const query = searchText.trim().toLowerCase();

    return getMedicalEquipment().filter(item => {
        if (statusFilter !== "all" && item.status !== statusFilter) return false;
        if (!query) return true;

        return [
            item.name,
            item.code,
            item.brand,
            item.model,
            item.location
        ].join(" ").toLowerCase().includes(query);
    });
}

function ensureSelectedEquipment() {
    const items = getMedicalEquipment();
    if (selectedEquipmentId && items.some(item => item.id === selectedEquipmentId)) {
        return selectedEquipmentId;
    }

    selectedEquipmentId = items[0]?.id || "";
    return selectedEquipmentId;
}

function formatDate(value) {
    const clean = isoDate(value);
    if (!clean) return "Sin fecha";

    const [year, month, day] = clean.split("-");
    return `${day}-${month}-${year}`;
}

function formatDateTime(value) {
    const date = new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function datetimeLocalValue(value) {
    const clean = String(value || "");
    return clean.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)?.[0] || "";
}

function attachmentSize(size) {
    const bytes = Number(size) || 0;
    if (!bytes) return "";
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function renderIcon(path) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
}

function renderEmpty(title, detail = "") {
    return `
        <div class="medical-equipment-empty">
            <strong>${escapeHTML(title)}</strong>
            ${detail ? `<span>${escapeHTML(detail)}</span>` : ""}
        </div>
    `;
}

function renderStats(items) {
    const openReports = reports.filter(reportIsOpen).length;
    const dueSoon = items.filter(item => {
        const days = daysUntil(item.nextMaintenanceAt);
        return days !== null && days <= ALERT_DAYS;
    }).length;
    const activeService = items.filter(item => item.serviceActive).length;

    return `
        <div class="medeq-stats">
            <span><strong>${items.length}</strong><small>Equipos</small></span>
            <span><strong>${dueSoon}</strong><small>Mantenciones</small></span>
            <span><strong>${openReports}</strong><small>Fallas abiertas</small></span>
            <span><strong>${activeService}</strong><small>Servicio vigente</small></span>
        </div>
    `;
}

function renderEquipmentList(items) {
    if (!items.length) {
        return renderEmpty(
            "No hay equipos para mostrar",
            "Crea un equipo o ajusta los filtros."
        );
    }

    return items.map(item => {
        const openCount = reportsForEquipment(item.id).filter(reportIsOpen).length;

        return `
            <button class="medeq-list-item ${item.id === selectedEquipmentId ? "is-active" : ""}" type="button" data-medeq-select="${escapeAttribute(item.id)}">
                <span class="medeq-list-item__main">
                    <strong>${escapeHTML(item.name)}</strong>
                    <small>${escapeHTML(item.code || item.brand || "Sin codigo")}</small>
                </span>
                <span class="medeq-pill medeq-pill--${maintenanceTone(item)}">${escapeHTML(maintenanceDueText(item))}</span>
                ${openCount ? `<span class="medeq-count">${openCount}</span>` : ""}
            </button>
        `;
    }).join("");
}

function renderTaskSelector(selectedIds, disabled = false) {
    const tasks = getTaskCatalog();
    if (!tasks.length) {
        return `<div class="medeq-muted">No hay tareas creadas en Asignacion de Tareas.</div>`;
    }

    const selected = new Set(selectedIds);

    return `
        <div class="medeq-task-grid">
            ${tasks.map(task => `
                <label class="medeq-check">
                    <input type="checkbox" data-medeq-task value="${escapeAttribute(task.id)}" ${selected.has(task.id) ? "checked" : ""} ${disabled ? "disabled" : ""}>
                    <span>${escapeHTML(task.title)}</span>
                </label>
            `).join("")}
        </div>
    `;
}

function renderAttachments(equipment, attachments, group, canEdit) {
    const list = normalizeAttachments(attachments);

    return `
        <div class="medeq-attachments" data-medeq-attachment-group="${escapeAttribute(group)}">
            ${list.length ? list.map(file => `
                <div class="medeq-file">
                    <button type="button" data-medeq-open-file="${escapeAttribute(file.id)}" data-medeq-file-group="${escapeAttribute(group)}" ${hasAttachmentContent(file) ? "" : "disabled"}>
                        ${renderIcon('<path d="M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"></path><path d="M14 3v5h5"></path>')}
                        <span><strong>${escapeHTML(file.name)}</strong><small>${escapeHTML(attachmentSize(file.size))}</small></span>
                    </button>
                    ${canEdit ? `<button class="medeq-mini medeq-mini--danger" type="button" data-medeq-delete-file="${escapeAttribute(file.id)}" data-medeq-file-group="${escapeAttribute(group)}" title="Eliminar adjunto">&times;</button>` : ""}
                </div>
            `).join("") : `<span class="medeq-muted">Sin adjuntos.</span>`}
            ${canEdit ? `
                <label class="medeq-upload">
                    <input type="file" multiple accept="${ATTACHMENT_ACCEPT}" data-medeq-upload="${escapeAttribute(group)}">
                    <span>${renderIcon('<path d="M12 5v14"></path><path d="M5 12h14"></path>')} Adjuntar</span>
                </label>
            ` : ""}
        </div>
    `;
}

function renderContacts(contacts, canEdit) {
    if (!contacts.length) return renderEmpty("Sin contactos", "Agrega proveedor, mesa de ayuda o tecnico.");

    return contacts.map(contact => `
        <article class="medeq-contact">
            <div>
                <strong>${escapeHTML(contact.name)}</strong>
                <span>${escapeHTML(contact.role || "Contacto tecnico")}</span>
                ${contact.phone ? `<a href="tel:${escapeAttribute(contact.phone)}">${escapeHTML(contact.phone)}</a>` : ""}
                ${contact.email ? `<a href="mailto:${escapeAttribute(contact.email)}">${escapeHTML(contact.email)}</a>` : ""}
                ${contact.notes ? `<small>${escapeHTML(contact.notes)}</small>` : ""}
            </div>
            ${canEdit ? `<button class="medeq-mini medeq-mini--danger" type="button" data-medeq-remove-contact="${escapeAttribute(contact.id)}">&times;</button>` : ""}
        </article>
    `).join("");
}

function renderMaintenances(equipment, canEdit) {
    const items = equipment.maintenances || [];
    if (!items.length) {
        return renderEmpty("Sin historial", "Registra preventivos, correctivos, calibraciones o visitas tecnicas.");
    }

    return items.map(item => `
        <article class="medeq-timeline-item">
            <div class="medeq-timeline-item__head">
                <strong>${escapeHTML(optionLabel(MAINTENANCE_TYPES, item.type))}</strong>
                <span>${escapeHTML(formatDate(item.date))}</span>
            </div>
            <p>${escapeHTML(item.summary || "Sin resumen.")}</p>
            <div class="medeq-line">
                ${item.provider ? `<span>Proveedor: ${escapeHTML(item.provider)}</span>` : ""}
                ${item.technician ? `<span>Tecnico: ${escapeHTML(item.technician)}</span>` : ""}
                ${item.nextDate ? `<span>Proxima: ${escapeHTML(formatDate(item.nextDate))}</span>` : ""}
            </div>
            ${item.downtime ? `
                <div class="medeq-downtime">
                    ${item.startAt || item.endAt ? `<span>${escapeHTML(datetimeLocalValue(item.startAt) || "Inicio abierto")} a ${escapeHTML(datetimeLocalValue(item.endAt) || "fin abierto")}</span>` : ""}
                    ${item.taskIds.length ? `<span>${escapeHTML(item.taskIds.map(id => taskTitle(id)).join(", "))}</span>` : ""}
                </div>
            ` : ""}
            ${renderAttachments(equipment, item.attachments, `maintenance:${item.id}`, canEdit)}
            ${canEdit ? `<button class="medeq-link-danger" type="button" data-medeq-remove-maintenance="${escapeAttribute(item.id)}">Eliminar mantenimiento</button>` : ""}
        </article>
    `).join("");
}

function reportStatusOptions(status) {
    return ERROR_STATUSES.map(item =>
        `<option value="${escapeAttribute(item.id)}" ${item.id === status ? "selected" : ""}>${escapeHTML(item.label)}</option>`
    ).join("");
}

function renderReport(report, canEdit) {
    const attachments = normalizeAttachments(report.attachments);
    const editableStatus = canEdit && report.firestore !== false;

    return `
        <article class="medeq-report medeq-report--${escapeAttribute(report.severity)}">
            <div class="medeq-report__head">
                <span>
                    <strong>${escapeHTML(report.title)}</strong>
                    <small>${escapeHTML(report.reportedByName || "Trabajador")} | ${escapeHTML(formatDateTime(report.createdAt) || formatDate(report.date))}</small>
                </span>
                ${editableStatus ? `
                    <select data-medeq-report-status="${escapeAttribute(report.id)}">
                        ${reportStatusOptions(report.status)}
                    </select>
                ` : `<em>${escapeHTML(optionLabel(ERROR_STATUSES, report.status))}</em>`}
            </div>
            <p>${escapeHTML(report.detail || "Sin detalle.")}</p>
            <div class="medeq-line">
                <span>${escapeHTML(optionLabel(SEVERITIES, report.severity, "Media"))}</span>
                ${report.workerRut ? `<span>RUT ${escapeHTML(report.workerRut)}</span>` : ""}
                ${report.equipmentCode ? `<span>${escapeHTML(report.equipmentCode)}</span>` : ""}
            </div>
            ${renderAttachments({ id: report.equipmentId }, attachments, `report:${report.id}`, false)}
        </article>
    `;
}

function renderReports(equipment, canEdit) {
    const all = [
        ...reportsForEquipment(equipment.id),
        ...(equipment.errors || []).map(item => ({
            ...item,
            firestore: false,
            equipmentId: equipment.id,
            attachments: item.attachments || []
        }))
    ].sort((a, b) =>
        String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date))
    );
    const visible = all.filter(report =>
        reportFilter === "all" ||
        (reportFilter === "open" && reportIsOpen(report)) ||
        report.status === reportFilter
    );

    if (reportsLoading) return renderEmpty("Cargando reportes", "Leyendo fallas informadas por trabajadores.");
    if (reportsError) return renderEmpty("No se pudieron cargar reportes", reportsError);
    if (!visible.length) return renderEmpty("Sin reportes de error", "Las fallas enviadas desde la PWA apareceran aqui.");

    return visible.map(report => renderReport(report, canEdit)).join("");
}

function renderMaintenanceForm(equipment, canEdit) {
    if (!canEdit) return "";

    return `
        <details class="medeq-form-section" data-medeq-maintenance-form>
            <summary>Registrar mantenimiento</summary>
            <div class="medeq-grid medeq-grid--four">
                <label><span>Tipo</span><select data-maint-type>${MAINTENANCE_TYPES.map(item => `<option value="${item.id}">${escapeHTML(item.label)}</option>`).join("")}</select></label>
                <label><span>Fecha</span><input type="date" data-maint-date value="${todayISO()}"></label>
                <label><span>Inicio indisponibilidad</span><input type="datetime-local" data-maint-start></label>
                <label><span>Fin indisponibilidad</span><input type="datetime-local" data-maint-end></label>
                <label><span>Proveedor</span><input type="text" data-maint-provider value="${escapeAttribute(equipment.serviceProvider)}"></label>
                <label><span>Tecnico</span><input type="text" data-maint-technician></label>
                <label><span>Siguiente mantenimiento</span><input type="date" data-maint-next value="${escapeAttribute(equipment.nextMaintenanceAt)}"></label>
                <label><span>Guia o respaldo</span><input type="file" multiple accept="${ATTACHMENT_ACCEPT}" data-maint-files></label>
            </div>
            <label class="medeq-field-wide"><span>Resumen del trabajo realizado</span><textarea data-maint-summary rows="3"></textarea></label>
            <label class="medeq-field-wide"><span>Recomendaciones del tecnico</span><textarea data-maint-recommendations rows="3"></textarea></label>
            <div class="medeq-section-title">Tareas inactivas durante la mantencion</div>
            ${renderTaskSelector(equipment.taskIds, false)}
            <button class="primary-button" type="button" data-medeq-add-maintenance>Agregar mantenimiento</button>
        </details>
    `;
}

function renderContactForm(canEdit) {
    if (!canEdit) return "";

    return `
        <details class="medeq-form-section">
            <summary>Agregar contacto tecnico</summary>
            <div class="medeq-grid medeq-grid--four">
                <label><span>Nombre</span><input type="text" data-contact-name></label>
                <label><span>Cargo / area</span><input type="text" data-contact-role></label>
                <label><span>Telefono</span><input type="tel" data-contact-phone></label>
                <label><span>Correo</span><input type="email" data-contact-email></label>
            </div>
            <label class="medeq-field-wide"><span>Notas</span><textarea data-contact-notes rows="2"></textarea></label>
            <button class="secondary-button" type="button" data-medeq-add-contact>Agregar contacto</button>
        </details>
    `;
}

function renderManualErrorForm(canEdit) {
    if (!canEdit) return "";

    return `
        <details class="medeq-form-section">
            <summary>Registrar error manual</summary>
            <div class="medeq-grid medeq-grid--four">
                <label><span>Titulo</span><input type="text" data-error-title></label>
                <label><span>Fecha</span><input type="date" data-error-date value="${todayISO()}"></label>
                <label><span>Severidad</span><select data-error-severity>${SEVERITIES.map(item => `<option value="${item.id}">${escapeHTML(item.label)}</option>`).join("")}</select></label>
                <label><span>Fotos / respaldos</span><input type="file" multiple accept="${ATTACHMENT_ACCEPT}" data-error-files></label>
            </div>
            <label class="medeq-field-wide"><span>Detalle</span><textarea data-error-detail rows="3"></textarea></label>
            <button class="secondary-button" type="button" data-medeq-add-error>Agregar error</button>
        </details>
    `;
}

function renderEquipmentForm(equipment, canEdit) {
    const disabled = canEdit ? "" : "disabled";

    return `
        <form class="medeq-detail" data-medeq-form>
            <div class="medeq-detail-head">
                <div>
                    <span class="medeq-kicker">Equipos Medicos</span>
                    <h3>${escapeHTML(equipment.name)}</h3>
                    <small>${escapeHTML(equipment.code || "Sin codigo")} | ${escapeHTML(optionLabel(STATUS_OPTIONS, equipment.status))}</small>
                </div>
                <div class="medeq-actions">
                    ${canEdit ? `
                        <button class="secondary-button" type="button" data-medeq-new>Nuevo</button>
                        <button class="primary-button" type="submit" ${saving ? "disabled" : ""}>${saving ? "Guardando..." : "Guardar ficha"}</button>
                        <button class="danger-button" type="button" data-medeq-delete>Eliminar</button>
                    ` : ""}
                </div>
            </div>

            <input type="hidden" name="id" value="${escapeAttribute(equipment.id)}">

            <div class="medeq-summary-row">
                <span><strong>${escapeHTML(ageLabel(equipment))}</strong><small>Antiguedad</small></span>
                <span><strong>${escapeHTML(maintenanceDueText(equipment))}</strong><small>Proxima mantencion</small></span>
                <span><strong>${equipment.serviceActive ? "Si" : "No"}</strong><small>Servicio tecnico</small></span>
                <span><strong>${reportsForEquipment(equipment.id).filter(reportIsOpen).length}</strong><small>Fallas abiertas</small></span>
            </div>

            <section class="medeq-section">
                <h4>Ficha tecnica</h4>
                <div class="medeq-grid medeq-grid--four">
                    <label><span>Nombre del equipo</span><input name="name" type="text" required value="${escapeAttribute(equipment.name)}" ${disabled}></label>
                    <label><span>Codigo</span><input name="code" type="text" value="${escapeAttribute(equipment.code)}" ${disabled}></label>
                    <label><span>Marca</span><input name="brand" type="text" value="${escapeAttribute(equipment.brand)}" ${disabled}></label>
                    <label><span>Modelo</span><input name="model" type="text" value="${escapeAttribute(equipment.model)}" ${disabled}></label>
                    <label><span>Serie</span><input name="serialNumber" type="text" value="${escapeAttribute(equipment.serialNumber)}" ${disabled}></label>
                    <label><span>Ubicacion</span><input name="location" type="text" value="${escapeAttribute(equipment.location)}" ${disabled}></label>
                    <label><span>Estado</span><select name="status" ${disabled}>${STATUS_OPTIONS.map(item => `<option value="${item.id}" ${item.id === equipment.status ? "selected" : ""}>${escapeHTML(item.label)}</option>`).join("")}</select></label>
                    <label><span>Frecuencia mantencion (dias)</span><input name="maintenanceFrequencyDays" type="number" min="0" max="3650" value="${Number(equipment.maintenanceFrequencyDays) || ""}" ${disabled}></label>
                    <label><span>Fecha compra</span><input name="purchaseDate" type="date" value="${escapeAttribute(equipment.purchaseDate)}" ${disabled}></label>
                    <label><span>Instalacion</span><input name="installedAt" type="date" value="${escapeAttribute(equipment.installedAt)}" ${disabled}></label>
                    <label><span>Proxima mantencion</span><input name="nextMaintenanceAt" type="date" value="${escapeAttribute(equipment.nextMaintenanceAt)}" ${disabled}></label>
                    <label class="medeq-check medeq-check--field"><input name="serviceActive" type="checkbox" ${equipment.serviceActive ? "checked" : ""} ${disabled}><span>Servicio tecnico vigente</span></label>
                    <label><span>Proveedor servicio</span><input name="serviceProvider" type="text" value="${escapeAttribute(equipment.serviceProvider)}" ${disabled}></label>
                    <label><span>Vigencia servicio</span><input name="serviceUntil" type="date" value="${escapeAttribute(equipment.serviceUntil)}" ${disabled}></label>
                </div>
                <label class="medeq-field-wide"><span>Detalles del equipo</span><textarea name="details" rows="4" ${disabled}>${escapeHTML(equipment.details)}</textarea></label>
                <label class="medeq-field-wide"><span>Recomendaciones del fabricante</span><textarea name="manufacturerRecommendations" rows="4" ${disabled}>${escapeHTML(equipment.manufacturerRecommendations)}</textarea></label>
            </section>

            <section class="medeq-section">
                <h4>Tareas asociadas</h4>
                ${renderTaskSelector(equipment.taskIds, !canEdit)}
            </section>

            <section class="medeq-section medeq-section--split">
                <div>
                    <h4>Documentos del equipo</h4>
                    ${renderAttachments(equipment, equipment.documents, "documents", canEdit)}
                </div>
                <div>
                    <h4>Contrato de mantenimiento</h4>
                    ${renderAttachments(equipment, equipment.contractAttachments, "contract", canEdit)}
                </div>
            </section>

            <section class="medeq-section">
                <h4>Contactos</h4>
                ${renderContacts(equipment.contacts, canEdit)}
                ${renderContactForm(canEdit)}
            </section>

            <section class="medeq-section">
                <h4>Historial de mantenimientos</h4>
                ${renderMaintenanceForm(equipment, canEdit)}
                <div class="medeq-timeline">${renderMaintenances(equipment, canEdit)}</div>
            </section>

            <section class="medeq-section">
                <div class="medeq-section-title-row">
                    <h4>Historial de errores</h4>
                    <select data-medeq-report-filter>
                        <option value="open" ${reportFilter === "open" ? "selected" : ""}>Abiertos</option>
                        <option value="all" ${reportFilter === "all" ? "selected" : ""}>Todos</option>
                        ${ERROR_STATUSES.map(item => `<option value="${item.id}" ${reportFilter === item.id ? "selected" : ""}>${escapeHTML(item.label)}</option>`).join("")}
                    </select>
                </div>
                ${renderManualErrorForm(canEdit)}
                <div class="medeq-report-list">${renderReports(equipment, canEdit)}</div>
            </section>
        </form>
    `;
}

function renderPanel(canEdit) {
    const panel = document.getElementById("medicalEquipmentPanel");
    if (!panel) return;

    const all = getMedicalEquipment();
    ensureSelectedEquipment();
    const visible = filteredEquipment();
    const selected = all.find(item => item.id === selectedEquipmentId);

    panel.innerHTML = `
        <div class="medical-equipment-shell">
            <section class="medeq-head">
                <div>
                    <span class="medeq-kicker">Inventario clinico</span>
                    <h2>Equipos M&eacute;dicos</h2>
                    <p>Ficha, contratos, mantenciones, tareas asociadas y fallas informadas desde la PWA.</p>
                </div>
                ${renderStats(all)}
            </section>

            <section class="medeq-layout">
                <aside class="medeq-sidebar">
                    <div class="medeq-toolbar">
                        <input type="search" data-medeq-search placeholder="Buscar equipo" value="${escapeAttribute(searchText)}">
                        <select data-medeq-status>
                            <option value="all" ${statusFilter === "all" ? "selected" : ""}>Todos</option>
                            ${STATUS_OPTIONS.map(item => `<option value="${item.id}" ${statusFilter === item.id ? "selected" : ""}>${escapeHTML(item.label)}</option>`).join("")}
                        </select>
                        ${canEdit ? `<button class="primary-button" type="button" data-medeq-new>Nuevo equipo</button>` : ""}
                    </div>
                    <div class="medeq-list">${renderEquipmentList(visible)}</div>
                </aside>
                <main class="medeq-main">
                    ${selected
                        ? renderEquipmentForm(selected, canEdit)
                        : canEdit
                            ? renderEmpty("Aun no hay equipos", "Crea el primer equipo medico de la unidad.")
                            : renderEmpty("Sin equipos visibles", "No hay equipos registrados para esta unidad.")}
                    ${!canEdit ? `<div class="medeq-readonly">Tu usuario puede revisar este menu, pero no editarlo.</div>` : ""}
                </main>
            </section>
        </div>
    `;
}

function formTaskIds(root) {
    return [...root.querySelectorAll("[data-medeq-task]")]
        .filter(input => input.checked)
        .map(input => input.value);
}

function readFormEquipment(form) {
    const formData = new FormData(form);
    const current = getMedicalEquipment()
        .find(item => item.id === formData.get("id")) ||
        normalizeMedicalEquipmentItem({ id: formData.get("id") });

    return normalizeMedicalEquipmentItem({
        ...current,
        name: formData.get("name"),
        code: formData.get("code"),
        brand: formData.get("brand"),
        model: formData.get("model"),
        serialNumber: formData.get("serialNumber"),
        location: formData.get("location"),
        details: formData.get("details"),
        status: formData.get("status"),
        serviceActive: formData.get("serviceActive") === "on",
        serviceProvider: formData.get("serviceProvider"),
        serviceUntil: formData.get("serviceUntil"),
        purchaseDate: formData.get("purchaseDate"),
        installedAt: formData.get("installedAt"),
        nextMaintenanceAt: formData.get("nextMaintenanceAt"),
        maintenanceFrequencyDays: formData.get("maintenanceFrequencyDays"),
        manufacturerRecommendations: formData.get("manufacturerRecommendations"),
        taskIds: formTaskIds(form)
    });
}

function withSelectedEquipment(updater) {
    const items = getMedicalEquipment();
    const index = items.findIndex(item => item.id === selectedEquipmentId);

    if (index < 0) return Promise.resolve(items);

    const next = [...items];
    next[index] = normalizeMedicalEquipmentItem(updater(next[index]));
    return saveMedicalEquipment(next);
}

async function uploadForSelected(group, fileList) {
    const equipment = getMedicalEquipment()
        .find(item => item.id === selectedEquipmentId);
    if (!equipment) return [];

    try {
        return await readAttachmentFiles(fileList, {
            moduleId: "medicalEquipment",
            ownerId: equipment.id,
            recordId: group.replace(/[^a-zA-Z0-9_-]+/g, "_")
        });
    } catch (error) {
        throw new Error(attachmentStorageErrorMessage(error, "subir"));
    }
}

function attachmentListForGroup(equipment, group) {
    if (group === "documents") return equipment.documents || [];
    if (group === "contract") return equipment.contractAttachments || [];
    if (group.startsWith("maintenance:")) {
        const id = group.slice("maintenance:".length);
        return equipment.maintenances.find(item => item.id === id)?.attachments || [];
    }
    if (group.startsWith("report:")) {
        const id = group.slice("report:".length);
        const report = reports.find(item => item.id === id);
        return report?.attachments || [];
    }
    if (group.startsWith("error:")) {
        const id = group.slice("error:".length);
        return equipment.errors.find(item => item.id === id)?.attachments || [];
    }
    return [];
}

function findAttachment(equipment, group, fileId) {
    return attachmentListForGroup(equipment, group)
        .find(file => file.id === fileId) || null;
}

function replaceAttachments(equipment, group, attachments) {
    if (group === "documents") return { ...equipment, documents: attachments };
    if (group === "contract") {
        return { ...equipment, contractAttachments: attachments };
    }
    if (group.startsWith("maintenance:")) {
        const id = group.slice("maintenance:".length);
        return {
            ...equipment,
            maintenances: equipment.maintenances.map(item =>
                item.id === id ? { ...item, attachments } : item
            )
        };
    }
    if (group.startsWith("error:")) {
        const id = group.slice("error:".length);
        return {
            ...equipment,
            errors: equipment.errors.map(item =>
                item.id === id ? { ...item, attachments } : item
            )
        };
    }
    return equipment;
}

async function updateReportStatus(reportId, status) {
    const workspace = getActiveWorkspace();

    if (!isFirebaseConfigured() || !workspace?.id || !reportId) return;

    const { db, firestoreModule } = await getFirebaseServices();

    await firestoreModule.updateDoc(
        firestoreModule.doc(
            db,
            "workspaces",
            workspace.id,
            REPORTS_COLLECTION,
            reportId
        ),
        {
            status: normalizeErrorStatus(status),
            updatedAt: firestoreModule.serverTimestamp(),
            updatedAtISO: new Date().toISOString(),
            resolvedAt: ["resolved", "dismissed"].includes(status)
                ? new Date().toISOString()
                : ""
        }
    );
}

function normalizeWorkerReport(id, data = {}) {
    const equipmentId = String(data.equipmentId || "");
    const title = clampText(data.title || "Falla informada", 160);

    if (!equipmentId || !title) return null;

    return {
        id: String(data.id || id),
        firestore: true,
        equipmentId,
        equipmentName: clampText(data.equipmentName, 180),
        equipmentCode: clampText(data.equipmentCode, 120),
        title,
        detail: clampText(data.detail || data.note, MAX_LONG_TEXT),
        status: normalizeErrorStatus(data.status),
        severity: normalizeSeverity(data.severity),
        date: isoDate(data.date) || String(data.createdAtISO || "").slice(0, 10),
        reportedByName: clampText(data.reportedByName || data.worker || data.profileName, 180),
        workerRut: clampText(data.workerRut || data.profileRut, 80),
        createdByUid: String(data.createdByUid || ""),
        createdAt: String(data.createdAtISO || data.createdAt || new Date().toISOString()),
        updatedAt: String(data.updatedAtISO || ""),
        attachments: normalizeAttachments(data.attachments || data.documents)
    };
}

export async function startMedicalEquipmentReportSync(workspace = getActiveWorkspace(), options = {}) {
    if (
        workspace?.id &&
        currentReportWorkspaceId === workspace.id &&
        typeof unsubscribeReports === "function"
    ) {
        return unsubscribeReports;
    }

    stopMedicalEquipmentReportSync();

    if (!isFirebaseConfigured() || !workspace?.id) {
        reports = [];
        currentReportWorkspaceId = "";
        options.onChange?.();
        return () => {};
    }

    currentReportWorkspaceId = workspace.id;
    reportsLoading = true;
    reportsError = "";
    options.onChange?.();

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const collectionRef = firestoreModule.collection(
            db,
            "workspaces",
            workspace.id,
            REPORTS_COLLECTION
        );

        unsubscribeReports = firestoreModule.onSnapshot(
            collectionRef,
            snap => {
                if (currentReportWorkspaceId !== workspace.id) return;

                reports = snap.docs
                    .map(docSnap => normalizeWorkerReport(docSnap.id, docSnap.data()))
                    .filter(Boolean)
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
                reportsLoading = false;
                reportsError = "";
                options.onChange?.();
            },
            error => {
                if (currentReportWorkspaceId !== workspace.id) return;

                reports = [];
                reportsLoading = false;
                reportsError = error?.message || "No se pudieron leer reportes.";
                options.onChange?.();
            }
        );
    } catch (error) {
        reports = [];
        reportsLoading = false;
        reportsError = error?.message || "No se pudo iniciar la escucha.";
        options.onChange?.();
    }

    return unsubscribeReports;
}

export function stopMedicalEquipmentReportSync() {
    if (typeof unsubscribeReports === "function") {
        unsubscribeReports();
    }

    unsubscribeReports = null;
    currentReportWorkspaceId = "";
    reportsLoading = false;
}

export function medicalEquipmentOutagesForRange(startISO, endISO) {
    const start = String(startISO || "");
    const end = String(endISO || start);
    const items = [];

    getMedicalEquipment().forEach(equipment => {
        equipment.maintenances.forEach(record => {
            const from = String(record.startAt || record.date || "").slice(0, 10);
            const to = String(record.endAt || record.date || from).slice(0, 10);

            if (!from || !to || to < start || from > end) return;
            if (!record.taskIds.length && !equipment.taskIds.length) return;

            items.push({
                id: `${equipment.id}:${record.id}`,
                equipmentId: equipment.id,
                equipmentName: equipment.name,
                maintenanceId: record.id,
                type: record.type,
                date: record.date,
                startAt: record.startAt,
                endAt: record.endAt,
                taskIds: record.taskIds.length ? record.taskIds : equipment.taskIds,
                summary: record.summary
            });
        });
    });

    return items;
}

function equipmentCalendarDetail(equipment, extra = "") {
    const details = [
        equipment.code ? `Código ${equipment.code}` : "",
        equipment.location || "",
        extra
    ].filter(Boolean);

    return details.join(" · ");
}

function dateRangeBetween(fromISO, toISO, startISO, endISO) {
    const from = fromISO < startISO ? startISO : fromISO;
    const to = toISO > endISO ? endISO : toISO;
    const dates = [];

    if (!from || !to || to < from) return dates;

    let cursor = from;
    let guard = 0;

    while (cursor && cursor <= to && guard < 370) {
        dates.push(cursor);
        cursor = addDaysISO(cursor, 1);
        guard += 1;
    }

    return dates;
}

function maintenanceTimeLabel(record) {
    const start = timeFromISODateTime(record.startAt);
    const end = timeFromISODateTime(record.endAt);

    if (start && end && start !== end) return `${start}-${end}`;
    if (start) return start;

    return "Mant.";
}

function pushMedicalCalendarEvent(events, event) {
    if (!event.date) return;

    events.push({
        source: "medicalEquipment",
        readOnly: true,
        repeat: "Equipos Médicos",
        alert: "Sin alerta",
        visibility: "medicalEquipment",
        ...event
    });
}

export function medicalEquipmentCalendarEventsForRange(
    startISO,
    endISO,
    equipmentItems = getMedicalEquipment()
) {
    const start = isoDate(startISO);
    const end = isoDate(endISO) || start;
    const events = [];

    if (!start || !end) return events;

    normalizeMedicalEquipment(equipmentItems).forEach(equipment => {
        const maintenanceDates = new Set();

        equipment.maintenances.forEach(record => {
            const from =
                isoDate(String(record.startAt || "").slice(0, 10)) ||
                record.date;
            const to =
                isoDate(String(record.endAt || "").slice(0, 10)) ||
                from;
            const typeLabel = optionLabel(
                MAINTENANCE_TYPES,
                record.type,
                "Mantenimiento"
            );
            const dates = dateRangeBetween(from, to, start, end);

            dateRangeBetween(from, to, from, to).forEach(date => {
                maintenanceDates.add(date);
            });

            dates.forEach(date => {
                pushMedicalCalendarEvent(events, {
                    id: `${equipment.id}:${record.id}:${date}`,
                    kind: "maintenance",
                    tone: "maintenance",
                    equipmentId: equipment.id,
                    maintenanceId: record.id,
                    date,
                    time: maintenanceTimeLabel(record),
                    sortTime: timeFromISODateTime(record.startAt) || "08:00",
                    name: `${typeLabel} · ${equipment.name}`,
                    detail: equipmentCalendarDetail(
                        equipment,
                        record.provider || record.summary
                    )
                });
            });
        });

        if (
            equipment.nextMaintenanceAt &&
            !maintenanceDates.has(equipment.nextMaintenanceAt) &&
            equipment.nextMaintenanceAt >= start &&
            equipment.nextMaintenanceAt <= end
        ) {
            pushMedicalCalendarEvent(events, {
                id: `${equipment.id}:next-maintenance:${equipment.nextMaintenanceAt}`,
                kind: "nextMaintenance",
                tone: "next",
                equipmentId: equipment.id,
                date: equipment.nextMaintenanceAt,
                time: "Prox.",
                sortTime: "08:00",
                name: `Próximo mantenimiento · ${equipment.name}`,
                detail: equipmentCalendarDetail(
                    equipment,
                    equipment.serviceProvider
                )
            });
        }

        if (
            equipment.serviceUntil &&
            equipment.serviceUntil >= start &&
            equipment.serviceUntil <= end
        ) {
            pushMedicalCalendarEvent(events, {
                id: `${equipment.id}:service-until:${equipment.serviceUntil}`,
                kind: "serviceUntil",
                tone: "service",
                equipmentId: equipment.id,
                date: equipment.serviceUntil,
                time: "Vig.",
                sortTime: "17:00",
                name: `Vence servicio técnico · ${equipment.name}`,
                detail: equipmentCalendarDetail(
                    equipment,
                    equipment.serviceProvider
                )
            });
        }
    });

    return events.sort((a, b) =>
        a.date.localeCompare(b.date) ||
        String(a.sortTime || a.time).localeCompare(String(b.sortTime || b.time)) ||
        a.name.localeCompare(b.name, "es")
    );
}

export function medicalEquipmentContractRenewalKanbanCards(
    today = todayISO(),
    equipmentItems = getMedicalEquipment()
) {
    const baseDate = isoDate(today) || todayISO();
    const warningLimit = addMonthsISO(baseDate, 3);

    if (!warningLimit) return [];

    return normalizeMedicalEquipment(equipmentItems)
        .filter(equipment =>
            equipment.status !== "inactive" &&
            equipment.serviceUntil &&
            equipment.serviceUntil <= warningLimit
        )
        .sort((a, b) =>
            a.serviceUntil.localeCompare(b.serviceUntil) ||
            a.name.localeCompare(b.name, "es")
        )
        .map(equipment => ({
            id: `medical_contract_${equipment.id}_${equipment.serviceUntil}`,
            source: "medicalEquipmentRenewal",
            auto: true,
            readOnly: true,
            status: "pending",
            color: "coral",
            equipmentId: equipment.id,
            dueDate: equipment.serviceUntil,
            title: `Renovar contrato de mantenimiento del equipo ${equipment.name}, la vigencia del contrato dura hasta ${formatDateForSentence(equipment.serviceUntil)}`,
            detail: [
                equipment.serviceProvider ? `Servicio técnico: ${equipment.serviceProvider}` : "",
                equipment.code ? `Código: ${equipment.code}` : "",
                equipment.location ? `Ubicación: ${equipment.location}` : ""
            ].filter(Boolean).join("\n"),
            createdAt: `${baseDate}T00:00:00.000Z`,
            updatedAt: `${equipment.serviceUntil}T12:00:00.000Z`
        }));
}

async function handleUpload(group, fileList) {
    const attachments = await uploadForSelected(group, fileList);
    if (!attachments.length) return;

    await withSelectedEquipment(equipment => {
        const current = attachmentListForGroup(equipment, group);
        return replaceAttachments(
            equipment,
            group,
            normalizeAttachments([...current, ...attachments])
        );
    });
}

async function addMaintenance(root) {
    const id = makeId("equipment_maintenance");
    const section =
        root.querySelector("[data-medeq-maintenance-form]") ||
        root.querySelector("[data-maint-files]")?.closest(".medeq-form-section") ||
        root;
    const files = section.querySelector("[data-maint-files]")?.files || [];
    const attachments = files.length
        ? await uploadForSelected(`maintenance:${id}`, files)
        : [];
    const taskIds = [...section.querySelectorAll("[data-medeq-task]")]
        .filter(input => input.checked)
        .map(input => input.value);
    const maintenance = normalizeMaintenance({
        id,
        type: section.querySelector("[data-maint-type]")?.value,
        date: section.querySelector("[data-maint-date]")?.value,
        startAt: section.querySelector("[data-maint-start]")?.value,
        endAt: section.querySelector("[data-maint-end]")?.value,
        provider: section.querySelector("[data-maint-provider]")?.value,
        technician: section.querySelector("[data-maint-technician]")?.value,
        nextDate: section.querySelector("[data-maint-next]")?.value,
        summary: section.querySelector("[data-maint-summary]")?.value,
        recommendations: section.querySelector("[data-maint-recommendations]")?.value,
        taskIds,
        attachments
    });

    await withSelectedEquipment(equipment => ({
        ...equipment,
        nextMaintenanceAt: maintenance.nextDate || equipment.nextMaintenanceAt,
        maintenances: [maintenance, ...equipment.maintenances]
    }));
}

async function addManualError(root) {
    const id = makeId("equipment_error");
    const files = root.querySelector("[data-error-files]")?.files || [];
    const attachments = files.length
        ? await uploadForSelected(`error:${id}`, files)
        : [];
    const error = normalizeManualError({
        id,
        title: root.querySelector("[data-error-title]")?.value,
        date: root.querySelector("[data-error-date]")?.value,
        severity: root.querySelector("[data-error-severity]")?.value,
        detail: root.querySelector("[data-error-detail]")?.value,
        attachments
    });

    if (!error) {
        await showAlert("Ingresa titulo o detalle del error.", {
            title: "Equipos Medicos",
            tone: "warning"
        });
        return;
    }

    await withSelectedEquipment(equipment => ({
        ...equipment,
        errors: [error, ...equipment.errors]
    }));
}

async function addContact(root) {
    const contact = normalizeContact({
        name: root.querySelector("[data-contact-name]")?.value,
        role: root.querySelector("[data-contact-role]")?.value,
        phone: root.querySelector("[data-contact-phone]")?.value,
        email: root.querySelector("[data-contact-email]")?.value,
        notes: root.querySelector("[data-contact-notes]")?.value
    });

    if (!contact) {
        await showAlert("Ingresa al menos un dato de contacto.", {
            title: "Equipos Medicos",
            tone: "warning"
        });
        return;
    }

    await withSelectedEquipment(equipment => ({
        ...equipment,
        contacts: [...equipment.contacts, contact]
    }));
}

async function deleteAttachment(equipment, group, fileId) {
    const attachment = findAttachment(equipment, group, fileId);
    if (!attachment) return;

    const confirmed = await showConfirm(
        `Se eliminara el adjunto ${attachment.name}.`,
        {
            title: "Eliminar adjunto",
            tone: "danger",
            confirmText: "Eliminar",
            destructive: true
        }
    );

    if (!confirmed) return;

    try {
        await deleteStoredAttachment(attachment);
    } catch (error) {
        await showAlert(attachmentStorageErrorMessage(error, "eliminar"), {
            title: "Equipos Medicos",
            tone: "danger"
        });
        return;
    }

    await withSelectedEquipment(item => {
        const next = attachmentListForGroup(item, group)
            .filter(file => file.id !== fileId);
        return replaceAttachments(item, group, next);
    });
}

async function bindPanelEvents(panel) {
    panel.querySelector("[data-medeq-search]")?.addEventListener("input", event => {
        searchText = event.target.value || "";
        renderMedicalEquipmentPanel();
    });

    panel.querySelector("[data-medeq-status]")?.addEventListener("change", event => {
        statusFilter = event.target.value || "all";
        renderMedicalEquipmentPanel();
    });

    panel.querySelector("[data-medeq-report-filter]")?.addEventListener("change", event => {
        reportFilter = event.target.value || "open";
        renderMedicalEquipmentPanel();
    });

    panel.querySelectorAll("[data-medeq-select]").forEach(button => {
        button.addEventListener("click", () => {
            selectedEquipmentId = button.dataset.medeqSelect || "";
            renderMedicalEquipmentPanel();
        });
    });

    panel.querySelectorAll("[data-medeq-new]").forEach(button => {
        button.addEventListener("click", async () => {
            const item = normalizeMedicalEquipmentItem({
                id: makeId("equipment"),
                name: "Nuevo equipo",
                createdByUid: getCurrentFirebaseUser()?.uid || ""
            });
            selectedEquipmentId = item.id;
            await upsertEquipment(item);
            renderMedicalEquipmentPanel();
        });
    });

    panel.querySelector("[data-medeq-form]")?.addEventListener("submit", async event => {
        event.preventDefault();
        if (!canEditMenu("medicalEquipment")) return;

        saving = true;
        renderMedicalEquipmentPanel();

        try {
            await upsertEquipment(readFormEquipment(event.target));
        } catch (error) {
            await showAlert(error?.message || "No se pudo guardar el equipo.", {
                title: "Equipos Medicos",
                tone: "danger"
            });
        } finally {
            saving = false;
            renderMedicalEquipmentPanel();
        }
    });

    panel.querySelector("[data-medeq-delete]")?.addEventListener("click", async () => {
        const equipment = getMedicalEquipment().find(item => item.id === selectedEquipmentId);
        if (!equipment) return;

        const confirmed = await showConfirm(
            `${equipment.name} saldra del inventario de la unidad.`,
            {
                title: "Eliminar equipo",
                tone: "danger",
                confirmText: "Eliminar",
                destructive: true
            }
        );

        if (!confirmed) return;

        await removeEquipment(equipment.id);
        selectedEquipmentId = "";
        renderMedicalEquipmentPanel();
    });

    panel.querySelectorAll("[data-medeq-upload]").forEach(input => {
        input.addEventListener("change", async () => {
            try {
                await handleUpload(input.dataset.medeqUpload, input.files);
                renderMedicalEquipmentPanel();
            } catch (error) {
                await showAlert(error?.message || String(error), {
                    title: "Equipos Medicos",
                    tone: "danger"
                });
            } finally {
                input.value = "";
            }
        });
    });

    panel.querySelectorAll("[data-medeq-open-file]").forEach(button => {
        button.addEventListener("click", async () => {
            const equipment = getMedicalEquipment().find(item => item.id === selectedEquipmentId);
            const attachment = equipment
                ? findAttachment(
                    equipment,
                    button.dataset.medeqFileGroup || "",
                    button.dataset.medeqOpenFile || ""
                )
                : null;

            if (!attachment) return;

            try {
                await openAttachmentFile(attachment, { newTab: true });
            } catch (error) {
                await showAlert(attachmentStorageErrorMessage(error, "abrir"), {
                    title: "Equipos Medicos",
                    tone: "danger"
                });
            }
        });
    });

    panel.querySelectorAll("[data-medeq-delete-file]").forEach(button => {
        button.addEventListener("click", async () => {
            const equipment = getMedicalEquipment().find(item => item.id === selectedEquipmentId);
            if (!equipment) return;

            await deleteAttachment(
                equipment,
                button.dataset.medeqFileGroup || "",
                button.dataset.medeqDeleteFile || ""
            );
            renderMedicalEquipmentPanel();
        });
    });

    panel.querySelector("[data-medeq-add-maintenance]")?.addEventListener("click", async () => {
        try {
            await addMaintenance(panel);
            renderMedicalEquipmentPanel();
        } catch (error) {
            await showAlert(error?.message || "No se pudo agregar mantenimiento.", {
                title: "Equipos Medicos",
                tone: "danger"
            });
        }
    });

    panel.querySelector("[data-medeq-add-error]")?.addEventListener("click", async () => {
        try {
            await addManualError(panel);
            renderMedicalEquipmentPanel();
        } catch (error) {
            await showAlert(error?.message || "No se pudo agregar el error.", {
                title: "Equipos Medicos",
                tone: "danger"
            });
        }
    });

    panel.querySelector("[data-medeq-add-contact]")?.addEventListener("click", async () => {
        await addContact(panel);
        renderMedicalEquipmentPanel();
    });

    panel.querySelectorAll("[data-medeq-remove-contact]").forEach(button => {
        button.addEventListener("click", async () => {
            await withSelectedEquipment(equipment => ({
                ...equipment,
                contacts: equipment.contacts.filter(contact =>
                    contact.id !== button.dataset.medeqRemoveContact
                )
            }));
            renderMedicalEquipmentPanel();
        });
    });

    panel.querySelectorAll("[data-medeq-remove-maintenance]").forEach(button => {
        button.addEventListener("click", async () => {
            await withSelectedEquipment(equipment => ({
                ...equipment,
                maintenances: equipment.maintenances.filter(item =>
                    item.id !== button.dataset.medeqRemoveMaintenance
                )
            }));
            renderMedicalEquipmentPanel();
        });
    });

    panel.querySelectorAll("[data-medeq-report-status]").forEach(select => {
        select.addEventListener("change", async () => {
            try {
                await updateReportStatus(
                    select.dataset.medeqReportStatus,
                    select.value
                );
            } catch (error) {
                await showAlert(
                    error?.message || "No se pudo actualizar el reporte.",
                    {
                        title: "Equipos Medicos",
                        tone: "danger"
                    }
                );
            }
        });
    });
}

export function renderMedicalEquipmentPanel() {
    const panel = document.getElementById("medicalEquipmentPanel");
    if (!panel) return;

    const canEdit = canEditMenu("medicalEquipment");

    renderPanel(canEdit);
    void bindPanelEvents(panel);
}

export function initMedicalEquipmentPanel() {
    if (typeof window === "undefined") return;

    window.addEventListener("proturnos:medicalEquipmentChanged", () => {
        if (document.body.dataset.activeView === "medicalEquipment") {
            renderMedicalEquipmentPanel();
        }
    });
}
