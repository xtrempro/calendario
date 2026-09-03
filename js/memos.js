import { escapeHTML } from "./htmlUtils.js";
import { addAuditLog, AUDIT_CATEGORY } from "./auditLog.js";
import { showConfirm } from "./dialogs.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    ATTACHMENT_ACCEPT,
    deleteStoredAttachment,
    hasAttachmentContent,
    openAttachmentFile,
    readAttachmentFile
} from "./attachmentUtils.js";

const MEMOS_KEY = "memos";
const DAY_KEY_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const STATUS_PENDING = "pending";
const STATUS_COMPLETED = "completed";

// El mismo juego de formatos que acepta el resto del app: el documento del
// memorandum se abre despues desde el calendario, asi que no hay razon para
// restringirlo mas aca.
export const MEMO_ATTACHMENT_ACCEPT = ATTACHMENT_ACCEPT;

let selectedStatus = STATUS_PENDING;
let selectedMonth = monthValue();

function makeId(prefix = "memo") {
    return `${prefix}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 9)}`;
}

function normalizeStatus(status) {
    return status === STATUS_COMPLETED
        ? STATUS_COMPLETED
        : STATUS_PENDING;
}

function normalizeDocument(doc = {}) {
    const name = String(doc.name || "").trim();
    const dataUrl = String(doc.dataUrl || "");
    const storagePath = String(doc.storagePath || "");

    if (!name || (!dataUrl && !storagePath)) return null;

    return {
        id: String(doc.id || makeId("memo_doc")),
        name,
        type: String(doc.type || "application/octet-stream"),
        size: Number(doc.size) || 0,
        dataUrl,
        storagePath,
        uploadedByUid: String(doc.uploadedByUid || ""),
        attachedAt: doc.attachedAt || new Date().toISOString()
    };
}

function normalizeKeyList(value) {
    return (Array.isArray(value) ? value : [])
        .map(key => String(key || "").trim())
        .filter(key => DAY_KEY_PATTERN.test(key));
}

function normalizeMemo(memo = {}) {
    const sourceId = String(memo.sourceId || "");
    const createdAt = memo.createdAt || new Date().toISOString();
    const documents = Array.isArray(memo.documents)
        ? memo.documents.map(normalizeDocument).filter(Boolean)
        : [];
    const status = normalizeStatus(memo.status);

    return {
        id: String(memo.id || sourceId || makeId()),
        sourceId,
        title: String(memo.title || "Memor\u00e1ndum pendiente"),
        profile: String(memo.profile || ""),
        typeLabel: String(memo.typeLabel || "MEMO"),
        detail: String(memo.detail || ""),
        startKey: String(memo.startKey || ""),
        endKey: String(memo.endKey || ""),
        dateKey: String(memo.dateKey || ""),
        // Que permiso lo origino y que dias abarca. Es lo que deja llegar desde
        // una casilla del calendario al memorandum que le corresponde. Los
        // memorandum viejos no lo traen: la busqueda cae al sourceId y al rango
        // startKey/endKey (ver memoLeaveType y memoCoversDay).
        leaveType: String(memo.leaveType || ""),
        keys: normalizeKeyList(memo.keys),
        status,
        createdAt,
        completedAt:
            status === STATUS_COMPLETED
                ? memo.completedAt || createdAt
                : "",
        documents
    };
}

function parseKey(key) {
    const match = String(key || "").match(DAY_KEY_PATTERN);

    if (!match) return null;

    return new Date(
        Number(match[1]),
        Number(match[2]),
        Number(match[3])
    );
}

function formatKey(key) {
    const date = parseKey(key);

    if (!date || Number.isNaN(date.getTime())) return "Sin fecha";

    return date.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).replace(/\//g, "-");
}

function formatTimestamp(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Sin fecha";

    return date.toLocaleString("es-CL", {
        dateStyle: "short",
        timeStyle: "short"
    });
}

function monthValue(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0")
    ].join("-");
}

function keyMonthValue(key) {
    const date = parseKey(key);

    if (!date || Number.isNaN(date.getTime())) return "";

    return monthValue(date);
}

function memoMonthValue(memo = {}) {
    const date = new Date(memo.createdAt);

    if (!Number.isNaN(date.getTime())) {
        return monthValue(date);
    }

    return keyMonthValue(memo.startKey || memo.dateKey || memo.endKey);
}

function filterMemosBySelectedMonth(memos) {
    if (!selectedMonth) {
        selectedMonth = monthValue();
    }

    return memos.filter(memo =>
        memoMonthValue(memo) === selectedMonth
    );
}

function formatISODate(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

    if (!match) return "Sin fecha";

    return [
        String(Number(match[3])).padStart(2, "0"),
        String(Number(match[2])).padStart(2, "0"),
        match[1]
    ].join("-");
}

function sortMemos(a, b) {
    const statusWeight = status =>
        status === STATUS_PENDING ? 0 : 1;
    const statusDiff =
        statusWeight(a.status) - statusWeight(b.status);

    if (statusDiff) return statusDiff;

    return new Date(b.createdAt) - new Date(a.createdAt);
}

function memoStatusLabel(status) {
    return status === STATUS_COMPLETED
        ? "Realizado"
        : "Pendiente";
}

function dispatchMemosChanged() {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
        new CustomEvent("proturnos:memosChanged")
    );
}

export function getMemos() {
    return Array.isArray(getJSON(MEMOS_KEY, []))
        ? getJSON(MEMOS_KEY, []).map(normalizeMemo).sort(sortMemos)
        : [];
}

function persistMemos(memos, { emit = true } = {}) {
    setJSON(MEMOS_KEY, memos.map(normalizeMemo));
    updateMemosNavBadge();

    if (emit) dispatchMemosChanged();
}

export function pendingMemosCount() {
    return getMemos().filter(memo =>
        memo.status === STATUS_PENDING
    ).length;
}

export function updateMemosNavBadge(count = pendingMemosCount()) {
    if (typeof document === "undefined") return;

    const tile = document.querySelector(
        ".nav-tile[data-target='memosPanel']"
    );

    if (!tile) return;

    let badge = tile.querySelector(".nav-alert-badge");

    if (!count) {
        badge?.remove();
        tile.removeAttribute("data-alert-count");
        return;
    }

    if (!badge) {
        badge = document.createElement("span");
        badge.className = "nav-alert-badge";
        tile.appendChild(badge);
    }

    badge.textContent = count > 99 ? "99+" : String(count);
    tile.dataset.alertCount = String(count);
}

export function createMemoTask(task = {}) {
    const memo = normalizeMemo({
        ...task,
        status: task.status || STATUS_PENDING,
        title: task.title || "Memor\u00e1ndum pendiente",
        sourceId:
            task.sourceId ||
            `${task.profile || "sin_perfil"}:${task.typeLabel || "memo"}:${task.startKey || task.dateKey || Date.now()}`
    });
    const memos = getMemos();
    const existingIndex = memos.findIndex(item =>
        item.sourceId && item.sourceId === memo.sourceId
    );

    if (existingIndex >= 0) {
        const existing = memos[existingIndex];

        memos[existingIndex] = normalizeMemo({
            ...existing,
            ...memo,
            id: existing.id,
            status: existing.status,
            completedAt: existing.completedAt,
            documents: existing.documents
        });
    } else {
        memos.unshift(memo);
    }

    persistMemos(memos);

    return memo;
}

function amountText(amount, typeLabel) {
    if (String(typeLabel).startsWith("1/2")) {
        return typeLabel;
    }

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
        return typeLabel;
    }

    if (value === 1) return `1 ${typeLabel}`;

    return `${value} ${typeLabel}`;
}

export function createLeaveMemoTask({
    profile,
    typeLabel,
    amount = 1,
    startKey,
    endKey,
    sourceType,
    // Los dias exactos del permiso. Un feriado legal de 10 dias no ocupa 10
    // casillas seguidas -salta fines de semana y festivos-, asi que el rango
    // startKey..endKey no alcanza para saber que casilla pertenece a este
    // memorandum. Cuando no llega, la busqueda cae al rango.
    keys = []
} = {}) {
    if (!profile || !typeLabel || !startKey) return null;

    const finalEndKey = endKey || startKey;
    const detail = [
        `Nombre: ${profile}`,
        `Permiso: ${amountText(amount, typeLabel)}`,
        `Fecha inicio: ${formatKey(startKey)}`,
        `Fecha termino: ${formatKey(finalEndKey)}`
    ].join(" | ");

    return createMemoTask({
        sourceId: [
            "leave",
            sourceType || typeLabel,
            profile,
            startKey,
            finalEndKey,
            amount
        ].join(":"),
        profile,
        typeLabel,
        detail,
        startKey,
        endKey: finalEndKey,
        leaveType: sourceType || "",
        keys
    });
}

function missingClockTypeLabel(missingEntry, missingExit) {
    if (missingEntry && missingExit) return "Marcaje incompleto";
    if (missingEntry) return "Marcaje sin entrada";

    return "Marcaje sin salida";
}

export function createClockMemoTask({
    profile,
    dateKey,
    segmentId = "turno",
    segmentLabel = "",
    missingEntry = false,
    missingExit = false
} = {}) {
    if (!profile || !dateKey || (!missingEntry && !missingExit)) {
        return null;
    }

    const missingParts = [
        missingEntry ? "entrada" : "",
        missingExit ? "salida" : ""
    ].filter(Boolean);
    const typeLabel = missingClockTypeLabel(
        missingEntry,
        missingExit
    );
    const detail = [
        `Nombre: ${profile}`,
        `Fecha: ${formatKey(dateKey)}`,
        `Falta de marcaje: ${missingParts.join(" y ")}`,
        segmentLabel ? `Turno: ${segmentLabel}` : ""
    ].filter(Boolean).join(" | ");

    return createMemoTask({
        sourceId: [
            "clock",
            profile,
            dateKey,
            segmentId
        ].join(":"),
        profile,
        typeLabel,
        detail,
        dateKey
    });
}

export function createReplacementContractMemoTask({
    profile,
    contract
} = {}) {
    const start = String(contract?.start || "");
    const end = String(contract?.end || "");
    const replaces = String(contract?.replaces || "").trim();
    const reason = String(contract?.reason || "").trim();

    if (!profile || !start || !end || !replaces) return null;

    const detail = [
        `Nombre: ${profile}`,
        `Inicio contrato: ${formatISODate(start)}`,
        `T\u00e9rmino contrato: ${formatISODate(end)}`,
        reason ? `Motivo del reemplazo: ${reason}` : "",
        `Reemplaza a: ${replaces}`
    ].filter(Boolean).join(" | ");

    return createMemoTask({
        sourceId: [
            "replacement_contract",
            profile,
            contract.id || start,
            end,
            replaces,
            reason
        ].join(":"),
        title: "Memor\u00e1ndum pendiente",
        profile,
        typeLabel: "Contrato de reemplazo",
        detail
    });
}

/* =========================================================
   Desde el calendario hasta el memorandum

   El documento del memorandum tiene que poder abrirse desde cualquiera de las
   casillas que lo originaron: si a alguien se le aplican 10 feriados legales,
   el respaldo es uno solo y vale para los 10 dias. Por eso el memorandum no se
   busca por su id sino por (trabajador, tipo de permiso, dia).
========================================================= */

function sameProfileName(a, b) {
    return String(a || "").trim() === String(b || "").trim();
}

// Los memorandum creados antes de que existiera el campo leaveType lo llevan
// dentro del sourceId: "leave:<tipo>:<perfil>:<inicio>:<fin>:<cantidad>".
function memoLeaveType(memo = {}) {
    if (memo.leaveType) return memo.leaveType;

    const parts = String(memo.sourceId || "").split(":");

    return parts[0] === "leave" ? String(parts[1] || "") : "";
}

function keyOrder(key) {
    const match = String(key || "").match(DAY_KEY_PATTERN);

    if (!match) return NaN;

    return Number(match[1]) * 10000 +
        Number(match[2]) * 100 +
        Number(match[3]);
}

function memoCoversDay(memo, keyDay) {
    if (!keyDay) return false;
    if (memo.keys.length) return memo.keys.includes(keyDay);
    if (memo.dateKey) return memo.dateKey === keyDay;

    const day = keyOrder(keyDay);
    const start = keyOrder(memo.startKey);
    const end = keyOrder(memo.endKey || memo.startKey);

    if (!Number.isFinite(day) || !Number.isFinite(start)) return false;

    return day >= start && day <= (Number.isFinite(end) ? end : start);
}

// Los medios dias comparten memorandum con el legado "half_admin", que no
// distingue ma\u00f1ana de tarde.
function leaveTypeMatches(memoType, leaveType) {
    if (!memoType || !leaveType) return false;
    if (memoType === leaveType) return true;

    const halfAdmin = new Set([
        "half_admin",
        "half_admin_morning",
        "half_admin_afternoon"
    ]);

    return halfAdmin.has(memoType) && halfAdmin.has(leaveType);
}

export function getMemoById(id) {
    const memoId = String(id || "");

    return memoId
        ? getMemos().find(memo => memo.id === memoId) || null
        : null;
}

/**
 * Memorandum de permiso al que pertenece una casilla del calendario.
 *
 * @param {{profile: string, leaveType: string, keyDay: string}} options
 * @returns {Object|null}
 */
export function findLeaveMemoForDay({ profile, leaveType, keyDay } = {}) {
    if (!profile || !leaveType || !keyDay) return null;

    // getMemos() ya viene ordenado: pendientes primero y, dentro de cada grupo,
    // del mas nuevo al mas viejo. Si dos aplicaciones del mismo permiso pisan el
    // mismo dia, gana la mas reciente, que es la que sigue vigente.
    return getMemos().find(memo =>
        sameProfileName(memo.profile, profile) &&
        leaveTypeMatches(memoLeaveType(memo), leaveType) &&
        memoCoversDay(memo, keyDay)
    ) || null;
}

/**
 * Memorandum de marcaje incompleto de un dia.
 *
 * @param {{profile: string, keyDay: string}} options
 * @returns {Object|null}
 */
export function findClockMemoForDay({ profile, keyDay } = {}) {
    if (!profile || !keyDay) return null;

    return getMemos().find(memo =>
        String(memo.sourceId || "").startsWith("clock:") &&
        sameProfileName(memo.profile, profile) &&
        memo.dateKey === keyDay
    ) || null;
}

export function getMemoDocuments(memoId) {
    return getMemoById(memoId)?.documents || [];
}

function setMemoDocuments(memoId, documents) {
    const memos = getMemos();
    const updated = memos.map(memo =>
        memo.id === memoId
            ? normalizeMemo({ ...memo, documents })
            : memo
    );

    persistMemos(updated);

    return updated.find(memo => memo.id === memoId) || null;
}

function setMemoCompleted(id, completed) {
    const memos = getMemos();
    const updated = memos.map(memo => {
        if (memo.id !== id) return memo;

        return normalizeMemo({
            ...memo,
            status: completed
                ? STATUS_COMPLETED
                : STATUS_PENDING,
            completedAt: completed
                ? new Date().toISOString()
                : ""
        });
    });
    const memo = updated.find(item => item.id === id);

    persistMemos(updated);

    if (memo) {
        addAuditLog(
            AUDIT_CATEGORY.WORKER_REQUESTS,
            completed
                ? "Marco memorandum como realizado"
                : "Reabrio memorandum pendiente",
            `${memo.profile || "Sin trabajador"}: ${memo.typeLabel}.`,
            {
                profile: memo.profile,
                memoId: memo.id,
                memoType: memo.typeLabel
            }
        );
    }
}

function attachMemoDocument(id, document) {
    const memos = getMemos();
    const updated = memos.map(memo => {
        if (memo.id !== id) return memo;

        return normalizeMemo({
            ...memo,
            documents: [
                ...(memo.documents || []),
                document
            ]
        });
    });
    const memo = updated.find(item => item.id === id);

    persistMemos(updated);

    if (memo) {
        addAuditLog(
            AUDIT_CATEGORY.WORKER_REQUESTS,
            "Adjunto documento a memorandum",
            `${memo.profile || "Sin trabajador"}: ${document.name}.`,
            {
                profile: memo.profile,
                memoId: memo.id,
                memoType: memo.typeLabel
            }
        );
    }
}

async function fileToMemoDocument(file, memoId) {
    const document = await readAttachmentFile(file, {
        moduleId: "memos",
        ownerId: memoId,
        recordId: "memo-documents"
    });

    return {
        ...document,
        attachedAt:
            document?.addedAt ||
            new Date().toISOString()
    };
}

/**
 * Sube un archivo y lo deja adjunto al memorandum.
 *
 * Es el mismo camino que usa el panel de memos, expuesto para que el calendario
 * pueda adjuntar desde la casilla del permiso.
 *
 * @param {string} memoId
 * @param {File} file
 * @returns {Promise<Object>} el documento guardado
 */
export async function addMemoDocument(memoId, file) {
    if (!getMemoById(memoId)) {
        throw new Error(
            "No se pudo identificar el memorandum al que pertenece el documento."
        );
    }

    const document = await fileToMemoDocument(file, memoId);

    if (!hasAttachmentContent(document)) {
        throw new Error("El documento no se pudo guardar. Intenta nuevamente.");
    }

    attachMemoDocument(memoId, document);

    return document;
}

/**
 * Quita un documento del memorandum.
 *
 * Primero se borra el archivo y despues la referencia, igual que en las
 * licencias: al reves, un fallo al eliminar dejaria el archivo en Storage sin
 * nada que lo alcance.
 *
 * @param {string} memoId
 * @param {string} documentId
 * @returns {Promise<boolean>}
 */
export async function removeMemoDocument(memoId, documentId) {
    const documents = getMemoDocuments(memoId);
    const document = documents.find(item =>
        String(item.id) === String(documentId)
    );

    if (!document) return false;

    await deleteStoredAttachment(document);

    const memo = setMemoDocuments(
        memoId,
        documents.filter(item => item !== document)
    );

    if (memo) {
        addAuditLog(
            AUDIT_CATEGORY.WORKER_REQUESTS,
            "Elimino documento de memorandum",
            `${memo.profile || "Sin trabajador"}: ${document.name}.`,
            {
                profile: memo.profile,
                memoId: memo.id,
                memoType: memo.typeLabel
            }
        );
    }

    return true;
}

export async function openMemoDocument(memoId, documentId) {
    if (typeof window === "undefined") return;

    const document = getMemoDocuments(memoId).find(item =>
        item.id === documentId
    );

    if (!hasAttachmentContent(document)) return;

    await openAttachmentFile(document, { newTab: true });
}

function statusButtonHTML(status, label, count) {
    return `
        <button class="worker-request-filter ${selectedStatus === status ? "is-active" : ""}" type="button" data-memo-status="${status}">
            ${label} <span>${count}</span>
        </button>
    `;
}

function documentsHTML(memo) {
    const documents = memo.documents || [];

    return `
        <div class="memo-documents">
            ${documents.length
                ? `
                    <div class="memo-document-list">
                        ${documents.map(document => `
                            <span class="memo-document-item">
                                <button class="memo-document-button" type="button" data-memo-doc="${escapeHTML(document.id)}" data-memo-id="${escapeHTML(memo.id)}">
                                    ${escapeHTML(document.name)}
                                </button>
                                <button class="memo-document-remove" type="button" data-memo-doc-remove="${escapeHTML(document.id)}" data-memo-id="${escapeHTML(memo.id)}" title="Eliminar documento" aria-label="Eliminar ${escapeHTML(document.name)}">&times;</button>
                            </span>
                        `).join("")}
                    </div>
                `
                : `<small>Sin documentos adjuntos.</small>`}
            <label class="memo-file-button">
                Adjuntar documento
                <input type="file" accept="${MEMO_ATTACHMENT_ACCEPT}" data-memo-file="${escapeHTML(memo.id)}">
            </label>
        </div>
    `;
}

function memoCardHTML(memo) {
    const completed = memo.status === STATUS_COMPLETED;

    return `
        <article class="worker-request-card memo-card ${completed ? "is-completed" : ""}">
            <div class="worker-request-card__main">
                <div>
                    <span class="worker-request-type">${escapeHTML(memo.typeLabel)}</span>
                    <p class="memo-detail">${escapeHTML(memo.detail || "Sin detalle adicional.")}</p>
                    <small>Creado: ${escapeHTML(formatTimestamp(memo.createdAt))}</small>
                </div>

                <div class="worker-request-card__meta">
                    <span class="worker-request-status worker-request-status--${escapeHTML(memo.status)}">
                        ${escapeHTML(memoStatusLabel(memo.status))}
                    </span>
                    <label class="memo-check">
                        <input type="checkbox" data-memo-complete="${escapeHTML(memo.id)}" ${completed ? "checked" : ""}>
                        <span>Realizado</span>
                    </label>
                </div>
            </div>
            ${documentsHTML(memo)}
        </article>
    `;
}

export function renderMemosPanel() {
    if (typeof document === "undefined") return;

    const panel = document.getElementById("memosPanel");

    updateMemosNavBadge();

    if (!panel) return;

    if (!selectedMonth) {
        selectedMonth = monthValue();
    }

    const allMemos = getMemos();
    const memos = filterMemosBySelectedMonth(allMemos);
    const pending = memos.filter(memo =>
        memo.status === STATUS_PENDING
    );
    const completed = memos.filter(memo =>
        memo.status === STATUS_COMPLETED
    );
    const visible = selectedStatus === "all"
        ? memos
        : memos.filter(memo => memo.status === selectedStatus);

    panel.innerHTML = `
        <div class="section-head section-head--with-action">
            <span class="section-head__title">
                <h3>MEMOS</h3>
                <small>
                    Revisa los memorandum pendientes asociados a permisos y marcajes incompletos.
                </small>
            </span>
            <div class="worker-request-head-actions">
                <label class="audit-month-filter">
                    <span>Mes</span>
                    <input id="memoMonthFilter" type="month" value="${escapeHTML(selectedMonth)}">
                </label>
                <span class="worker-request-counter">
                    ${pending.length} pendiente(s) del mes
                </span>
            </div>
        </div>

        <div class="worker-request-filters">
            ${statusButtonHTML(STATUS_PENDING, "Pendientes", pending.length)}
            ${statusButtonHTML(STATUS_COMPLETED, "Realizados", completed.length)}
            ${statusButtonHTML("all", "Todos", memos.length)}
        </div>

        <div class="worker-request-list memo-list">
            ${visible.length
                ? visible.map(memoCardHTML).join("")
                : `
                    <div class="empty-state empty-state--compact">
                        ${selectedStatus === STATUS_PENDING
                            ? "No hay memorandum pendientes en este mes."
                            : "No hay memorandum para este filtro en este mes."}
                    </div>
                `}
        </div>
    `;

    const monthFilter = document.getElementById("memoMonthFilter");

    if (monthFilter) {
        monthFilter.onchange = () => {
            selectedMonth = monthFilter.value || monthValue();
            renderMemosPanel();
        };
    }

    panel.querySelectorAll("[data-memo-status]").forEach(button => {
        button.onclick = () => {
            selectedStatus = button.dataset.memoStatus || STATUS_PENDING;
            renderMemosPanel();
        };
    });

    panel.querySelectorAll("[data-memo-complete]").forEach(input => {
        input.onchange = () => {
            setMemoCompleted(
                input.dataset.memoComplete,
                input.checked
            );
        };
    });

    panel.querySelectorAll("[data-memo-file]").forEach(input => {
        input.onchange = async () => {
            const file = input.files?.[0];

            // Se limpia siempre: elegir DOS VECES el mismo archivo no dispara
            // "change" y parece que no pasa nada.
            const memoId = input.dataset.memoFile;

            input.value = "";

            if (!file) return;

            try {
                await addMemoDocument(memoId, file);
            } catch (error) {
                alert(error?.message || "No se pudo adjuntar el documento.");
                console.error(error);
            }
        };
    });

    panel.querySelectorAll("[data-memo-doc]").forEach(button => {
        button.onclick = async () => {
            button.disabled = true;

            try {
                await openMemoDocument(
                    button.dataset.memoId,
                    button.dataset.memoDoc
                );
            } catch (error) {
                alert(error?.message || "No se pudo abrir el documento.");
            } finally {
                button.disabled = false;
            }
        };
    });

    panel.querySelectorAll("[data-memo-doc-remove]").forEach(button => {
        button.onclick = async () => {
            const confirmed = await showConfirm(
                "¿Eliminar este documento del memorandum? " +
                "Tambien dejara de verse en las casillas del calendario.",
                {
                    title: "Eliminar documento",
                    confirmText: "Eliminar",
                    destructive: true
                }
            );

            if (!confirmed) return;

            button.disabled = true;

            try {
                await removeMemoDocument(
                    button.dataset.memoId,
                    button.dataset.memoDocRemove
                );
            } catch (error) {
                alert(error?.message || "No se pudo eliminar el documento.");
                console.error(error);
            } finally {
                button.disabled = false;
            }
        };
    });
}
