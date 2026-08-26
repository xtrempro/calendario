import { keyFromDate, keyToDate as parseKey } from "./dateUtils.js";
import { IS_TEST_ENVIRONMENT } from "./firebaseConfig.js";
import {
    getCurrentFirebaseUser,
    getFirebaseServices
} from "./firebaseClient.js";
import { stripAccents } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    deleteStoredAttachment,
    readFileAsDataURL
} from "./attachmentUtils.js";
import {
    getProfiles,
    isProfileActive
} from "./storage.js";
import {
    getCalendarProfileSearchOptionValues,
    getCalendarProfileSearchValue,
    normalizeProfileSearch
} from "./profileSearchUtils.js";
import { getTurnoBase, getTurnoReal } from "./turnEngine.js";
import { getAbsenceType } from "./rulesEngine.js";
import { getHourReturn } from "./hourReturns.js";
import { TURNO, TURNO_LABEL } from "./constants.js";
import { fetchHolidays, getCachedHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
import { showConfirm } from "./dialogs.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    getWorkerAppLinks,
    publishWorkerScheduleAttachmentNow,
    scheduleWorkerAppDataPublish
} from "./workerAppDataSync.js";

const TASKS_KEY = "weekly_task_assignment_tasks";
const ASSIGNMENTS_KEY = "weekly_task_assignment_entries";
const SCHEDULE_ATTACHMENT_KEY = "weekly_task_schedule_attachment";
const SCHEDULE_ATTACHMENTS_KEY = "weekly_task_schedule_attachments";
const TASK_ASSIGNMENT_PUBLISH_DELAY_MS = 3000;
const TASK_DETAIL_MAX_LENGTH = 240;
const SCHEDULE_IMAGE_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.bmp,.heic,.heif";
const SCHEDULE_WORKBOOK_ACCEPT = ".xlsx";
const SCHEDULE_WORKBOOK_EXTENSIONS = new Set(["xlsx"]);
const SCHEDULE_WORKBOOK_TYPES = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream"
]);
const SCHEDULE_UPLOAD_MAX_DATA_URL_CHARS = 1400 * 1024;
const SCHEDULE_UPLOAD_MAX_WIDTHS = [1800, 1600, 1400, 1200, 1000];
const SCHEDULE_UPLOAD_JPEG_QUALITIES = [0.9, 0.82, 0.72, 0.62];
const SCHEDULE_IMAGE_EXTENSIONS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "heic",
    "heif"
]);
const SCHEDULE_IMAGE_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/pjpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/heic",
    "image/heif"
]);

const SHIFT_CONFIG = {
    day: {
        label: "Tareas diurnas",
        shortLabel: "Diurno",
        className: "day"
    },
    night: {
        label: "Tareas de noche",
        shortLabel: "Noche",
        className: "night"
    }
};
const SHIFT_TYPES = Object.keys(SHIFT_CONFIG);
const GENERIC_TASK_SHIFT = "both";

let currentWeekStart = weekStartMonday(new Date());
let selectedRoles = null;
let selectedProfessions = null;
let openTaskFilterGroup = "";
let unbindTaskFilterOutside = null;
let draggedTask = null;
let draggedWorker = null;
let draggedMergePort = null;
let renderToken = 0;
// Cada tablero de turno se puede plegar para dejar el otro a pantalla completa.
let collapsedShifts = { day: false, night: false };
// Filtro de foco: deja visibles solo las casillas sin nadie asignado.
let onlyUncovered = false;
// Casilla con el selector rapido abierto: { shift, taskId, keyDay }. El nodo
// vive colgado del body -no de la casilla- porque el tablero recorta.
let openCellPicker = null;
let cellPickerNode = null;
let unbindCellPicker = null;

function fileExtension(name) {
    return String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
}

function normalizeScheduleOcrWords(value) {
    if (!Array.isArray(value)) return [];

    const out = [];
    for (const word of value) {
        if (!word || typeof word !== "object") continue;
        const t = String(word.t || "").slice(0, 60);
        if (!t) continue;
        out.push({
            t,
            x: Number(word.x) || 0,
            y: Number(word.y) || 0,
            w: Number(word.w) || 0,
            h: Number(word.h) || 0
        });
        if (out.length >= 1500) break;
    }
    return out;
}

function normalizeScheduleOcr(value) {
    if (!value || typeof value !== "object") return null;

    const status = String(value.status || "").trim() || "failed";
    const text = String(value.text || "").trim();
    const error = String(value.error || "").trim();

    return {
        status,
        engine: String(value.engine || "").trim(),
        source: String(value.source || "automatic_upload").trim(),
        reviewRequired: value.reviewRequired === true,
        requestedAtISO: String(value.requestedAtISO || "").trim(),
        extractedAtISO: String(value.extractedAtISO || "").trim(),
        // OCR obsoleto: el grid del Excel reemplaza la reconstrucción. No persistir
        // el texto (hasta 30 KB/semana) ni la geometría evita inflar el estado y
        // exceder el límite de commit de Firestore.
        text: "",
        textLength: 0,
        truncated: value.truncated === true,
        error,
        words: []
    };
}

export function scheduleWeekStartISO(start = currentWeekStart) {
    return isoFromDate(weekStartMonday(start));
}

function scheduleWeekEndISO(start = currentWeekStart) {
    return isoFromDate(addDays(weekStartMonday(start), 6));
}

export function scheduleWeekLabel(start = currentWeekStart) {
    const weekStart = weekStartMonday(start);
    const weekEnd = addDays(weekStart, 6);

    return `Semana ${formatShortDate(weekStart)} al ${formatShortDate(weekEnd)}`;
}

// Sanea una celda del grid: string simple o { text, rowSpan } (bloques de fin
// de semana combinados verticalmente).
function normalizeScheduleGridCell(cell) {
    if (cell && typeof cell === "object") {
        const text = String(cell.text || "").slice(0, 600);
        const rowSpan = Math.max(1, Math.min(80, Math.round(Number(cell.rowSpan) || 1)));
        return rowSpan > 1 ? { text, rowSpan } : text;
    }
    return String(cell == null ? "" : cell).slice(0, 600);
}

function normalizeScheduleGridRow(row) {
    if (!row || typeof row !== "object") return null;
    const title = String(row.title || "").trim().slice(0, 200);
    const detail = String(row.detail || "").trim().slice(0, 200);

    if (row.fullWidth) {
        const fullText = String(row.fullText || "").slice(0, 3000);
        if (!title && !fullText) return null;
        return { title, detail, fullWidth: true, fullText };
    }

    const cells = Array.isArray(row.cells)
        ? row.cells.map(normalizeScheduleGridCell).slice(0, 12)
        : [];
    const hasText = cells.some((c) => (typeof c === "string" ? c : c.text));
    if (!title && !hasText) return null;
    return { title, detail, cells };
}

// Grilla estructurada de la programación (Excel -> grid). Es el reemplazo
// determinista del OCR: title/días/filas listas para renderizar.
function normalizeScheduleGrid(value) {
    if (!value || typeof value !== "object") return null;
    const days = Array.isArray(value.days)
        ? value.days.map((d) => String(d || "").trim()).slice(0, 12)
        : [];
    const rows = Array.isArray(value.rows)
        ? value.rows.map(normalizeScheduleGridRow).filter(Boolean).slice(0, 80)
        : [];
    if (!rows.length) return null;
    return {
        title: String(value.title || "").trim().slice(0, 240),
        weekLabel: String(value.weekLabel || "").trim().slice(0, 160),
        days,
        rows
    };
}

function normalizeScheduleAttachment(value, weekStart = null) {
    if (!value || typeof value !== "object") return null;

    const storagePath = String(value.storagePath || "").trim();
    const dataUrl = String(value.dataUrl || "").trim();
    const downloadURL = String(value.downloadURL || value.downloadUrl || "").trim();
    const type = String(value.type || "").toLowerCase();
    const normalizedWeekStart = weekStart
        ? weekStartMonday(weekStart)
        : null;
    const weekStartISO = String(
        value.weekStartISO ||
        (normalizedWeekStart ? scheduleWeekStartISO(normalizedWeekStart) : "")
    ).trim();
    const weekEndISO = String(
        value.weekEndISO ||
        (normalizedWeekStart ? scheduleWeekEndISO(normalizedWeekStart) : "")
    ).trim();

    const grid = normalizeScheduleGrid(value.grid);

    if (!storagePath && !dataUrl && !downloadURL && !grid) return null;

    return {
        id: String(value.id || "").trim(),
        name: String(value.name || "programacion").trim(),
        type,
        size: Number(value.size || 0),
        addedAt: String(value.addedAt || "").trim(),
        updatedAtISO: String(value.updatedAtISO || value.addedAt || "").trim(),
        storagePath,
        // La imagen vive en Storage (storagePath/downloadURL); no persistimos el
        // base64 porque infla el estado y hace exceder el limite de escritura de
        // Firestore (~11 MB). Solo se conserva para adjuntos legacy sin Storage.
        dataUrl: (storagePath || downloadURL || dataUrl.length > 800 * 1024)
            ? ""
            : dataUrl,
        downloadURL,
        uploadedByUid: String(value.uploadedByUid || "").trim(),
        mode: grid ? "grid" : "image",
        source: grid ? "supervisor_xlsx" : "supervisor_image",
        weekStartISO,
        weekEndISO,
        weekLabel: String(
            value.weekLabel ||
            grid?.weekLabel ||
            (normalizedWeekStart ? scheduleWeekLabel(normalizedWeekStart) : "")
        ).trim(),
        ocr: normalizeScheduleOcr(value.ocr),
        grid
    };
}

function normalizeScheduleAttachmentMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};

    return Object.fromEntries(
        Object.entries(value)
            .map(([weekStartISO, attachment]) => {
                const start = /^\d{4}-\d{2}-\d{2}$/.test(weekStartISO)
                    ? new Date(`${weekStartISO}T00:00:00`)
                    : null;
                const normalized = normalizeScheduleAttachment(attachment, start);
                const key = normalized?.weekStartISO || weekStartISO;

                return normalized && key ? [key, normalized] : null;
            })
            .filter(Boolean)
            .sort(([a], [b]) => a.localeCompare(b))
    );
}

export function getScheduleAttachments() {
    const attachments = normalizeScheduleAttachmentMap(
        getJSON(SCHEDULE_ATTACHMENTS_KEY, {})
    );
    const legacy = normalizeScheduleAttachment(
        getJSON(SCHEDULE_ATTACHMENT_KEY, null),
        weekStartMonday(new Date())
    );

    if (legacy && !attachments[legacy.weekStartISO]) {
        attachments[legacy.weekStartISO] = legacy;
    }

    return attachments;
}

function syncLegacyScheduleAttachment(attachments) {
    const currentWeek = scheduleWeekStartISO(new Date());

    setJSON(SCHEDULE_ATTACHMENT_KEY, attachments[currentWeek] || null);
}

function saveScheduleAttachments(attachments) {
    const normalized = normalizeScheduleAttachmentMap(attachments);

    setJSON(SCHEDULE_ATTACHMENTS_KEY, normalized);
    syncLegacyScheduleAttachment(normalized);
}

export function getScheduleAttachment(start = currentWeekStart) {
    return getScheduleAttachments()[scheduleWeekStartISO(start)] || null;
}

function saveScheduleAttachment(attachment, start = currentWeekStart) {
    const attachments = getScheduleAttachments();
    const normalized = normalizeScheduleAttachment(attachment, start);

    if (!normalized) return;

    attachments[normalized.weekStartISO] = normalized;
    saveScheduleAttachments(attachments);
}

function clearScheduleAttachment(start = currentWeekStart) {
    const attachments = getScheduleAttachments();

    delete attachments[scheduleWeekStartISO(start)];
    saveScheduleAttachments(attachments);
}

function validateScheduleImage(file) {
    if (!(file instanceof File)) {
        throw new Error("Selecciona una imagen valida.");
    }

    const type = String(file.type || "").toLowerCase();
    const extension = fileExtension(file.name);

    if (
        !SCHEDULE_IMAGE_TYPES.has(type) &&
        !SCHEDULE_IMAGE_EXTENSIONS.has(extension)
    ) {
        throw new Error("La programacion debe adjuntarse como imagen.");
    }

    return file;
}

function validateScheduleWorkbook(file) {
    if (!(file instanceof File)) {
        throw new Error("Selecciona un archivo Excel (.xlsx).");
    }

    const type = String(file.type || "").toLowerCase();
    const extension = fileExtension(file.name);

    if (
        !SCHEDULE_WORKBOOK_TYPES.has(type) &&
        !SCHEDULE_WORKBOOK_EXTENSIONS.has(extension)
    ) {
        throw new Error("La programacion debe adjuntarse como Excel (.xlsx).");
    }

    return file;
}

function scheduleUploadDebugContext() {
    const user = getCurrentFirebaseUser();
    const workspace = getActiveWorkspace();
    const email = String(user?.email || "").trim();

    return {
        user,
        workspace,
        email: email || "sin correo",
        uid: String(user?.uid || "").trim() || "sin UID",
        workspaceId: String(workspace?.id || "").trim() || "sin unidad"
    };
}

function scheduleUploadErrorCode(error) {
    const code = String(error?.code || error?.cause?.code || "").trim();

    return code.startsWith("functions/") ? code.slice("functions/".length) : code;
}

function imageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(
            "No se pudo procesar la imagen adjunta. Prueba con JPG o PNG."
        ));
        image.src = dataUrl;
    });
}

async function compressedScheduleDataUrl(file) {
    const original = await readFileAsDataURL(file);

    if (original.length <= SCHEDULE_UPLOAD_MAX_DATA_URL_CHARS) {
        return original;
    }

    const image = await imageFromDataUrl(original);
    let best = original;

    for (const maxWidth of SCHEDULE_UPLOAD_MAX_WIDTHS) {
        const ratio = Math.min(1, maxWidth / image.naturalWidth);
        const width = Math.max(1, Math.round(image.naturalWidth * ratio));
        const height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) break;

        canvas.width = width;
        canvas.height = height;
        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);

        for (const quality of SCHEDULE_UPLOAD_JPEG_QUALITIES) {
            const candidate = canvas.toDataURL("image/jpeg", quality);

            if (candidate.length < best.length) {
                best = candidate;
            }

            if (candidate.length <= SCHEDULE_UPLOAD_MAX_DATA_URL_CHARS) {
                return candidate;
            }
        }
    }

    if (best.length > SCHEDULE_UPLOAD_MAX_DATA_URL_CHARS) {
        throw new Error(
            "La imagen es muy grande para publicarla. " +
            "Intenta con un JPG/PNG mas liviano."
        );
    }

    return best;
}

async function createScheduleAttachment(file) {
    const workspace = getActiveWorkspace();
    const dataUrl = await compressedScheduleDataUrl(file);
    const { functions, functionsModule } = await getFirebaseServices();
    const upload = functionsModule.httpsCallable(
        functions,
        "uploadScheduleAttachment"
    );
    const result = await upload({
        workspaceId: workspace?.id || "",
        name: file.name || "programacion.jpg",
        type: file.type || "",
        dataUrl
    });
    const attachment = normalizeScheduleAttachment(result.data);

    if (!attachment) {
        throw new Error("No se recibio la URL de la programacion publicada.");
    }

    return attachment;
}

// Publica la programación desde un EXCEL: manda el .xlsx a la Cloud Function
// uploadScheduleWorkbook, que lo convierte al grid estructurado (sin OCR). El
// attachment resultante lleva `grid` embebido; la PWA lo renderiza tal cual.
/**
 * Pregunta en que hoja esta la programacion.
 *
 * Solo aparece cuando el servidor no pudo decidirla por el nombre. Devuelve la
 * hoja elegida, o "" si el supervisor cancela.
 *
 * @param {string[]} sheets
 * @param {string} weekLabel
 * @returns {Promise<string>}
 */
function askScheduleSheet(sheets, weekLabel) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");

        backdrop.className = "task-assignment-dialog-backdrop";
        backdrop.innerHTML = `
            <section class="task-assignment-dialog task-schedule-sheet-dialog">
                <div class="task-assignment-dialog__head">
                    <h3>¿En qué hoja está la programación?</h3>
                </div>
                <p class="task-schedule-sheet-hint">
                    El archivo trae varias hojas y ninguna coincide con
                    ${escapeHTML(weekLabel)}. Elige cuál publicar.
                </p>
                <div class="task-schedule-sheet-list">
                    ${sheets.map((name, index) => `
                        <label class="task-schedule-sheet-option">
                            <input type="radio" name="scheduleSheet"
                                value="${escapeHTML(name)}"
                                ${index === 0 ? "checked" : ""}>
                            <span>${escapeHTML(name)}</span>
                        </label>`).join("")}
                </div>
                <div class="task-assignment-dialog__actions">
                    <button class="ghost-button" type="button" data-sheet-cancel>
                        Cancelar
                    </button>
                    <button class="primary-button" type="button" data-sheet-confirm>
                        Publicar esta hoja
                    </button>
                </div>
            </section>`;

        document.body.appendChild(backdrop);

        const finish = (value) => {
            backdrop.remove();
            resolve(value);
        };

        backdrop.querySelector("[data-sheet-confirm]").addEventListener(
            "click",
            () => finish(
                backdrop.querySelector("input[name='scheduleSheet']:checked")
                    ?.value || ""
            )
        );
        backdrop.querySelector("[data-sheet-cancel]").addEventListener(
            "click",
            () => finish("")
        );
        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) finish("");
        });
    });
}

/**
 * Publica la programacion de una semana desde un Excel.
 *
 * El servidor elige la hoja por su nombre. Cuando el libro trae varias y
 * ninguna calza con la semana, en vez de publicar una por descarte devuelve
 * `needsSheet` con la lista: ahi se le pregunta al supervisor y se reintenta
 * con su eleccion. Preguntar solo en ese caso evita molestarlo cuando la hoja
 * es evidente, que es casi siempre.
 */
async function createScheduleWorkbookAttachment(
    file,
    weekStart = currentWeekStart,
    { onAskSheet = null } = {}
) {
    const workspace = getActiveWorkspace();
    const dataUrl = await readFileAsDataURL(file);
    const normalizedWeekStart = weekStartMonday(weekStart);
    const { functions, functionsModule } = await getFirebaseServices();
    const upload = functionsModule.httpsCallable(
        functions,
        "uploadScheduleWorkbook"
    );
    const payload = {
        workspaceId: workspace?.id || "",
        name: file.name || "programacion.xlsx",
        type: file.type || "",
        weekStartISO: normalizedWeekStart
            ? scheduleWeekStartISO(normalizedWeekStart)
            : "",
        dataUrl
    };

    let result = await upload(payload);

    if (result?.data?.needsSheet) {
        const sheetName = onAskSheet
            ? await onAskSheet(result.data.sheets || [])
            : "";

        if (!sheetName) return null;

        result = await upload({ ...payload, sheetName });
    }

    const attachment = normalizeScheduleAttachment(result.data, weekStart);

    if (!attachment || !attachment.grid) {
        throw new Error("No se pudo leer la programacion del Excel.");
    }

    return { ...attachment, sheetName: result.data?.sheetName || "" };
}

// Reintenta el OCR de una programacion ya publicada (sin re-subir la imagen):
// el servidor la lee desde Storage y corre Vision otra vez; aqui actualizamos
// el adjunto con el resultado y re-publicamos para que la PWA quede en modo texto.
async function reprocessScheduleAttachmentOcr(start = currentWeekStart) {
    const weekStart = weekStartMonday(start);
    const attachment = getScheduleAttachment(weekStart);
    const workspace = getActiveWorkspace();

    if (!attachment?.storagePath || !workspace?.id) {
        throw new Error(
            "No hay una programacion publicada para reintentar el OCR."
        );
    }

    const { functions, functionsModule } = await getFirebaseServices();
    const reprocess = functionsModule.httpsCallable(
        functions,
        "reprocessScheduleOcr"
    );
    const result = await reprocess({
        workspaceId: workspace.id,
        storagePath: attachment.storagePath
    });
    const ocr = normalizeScheduleOcr(result?.data?.ocr);

    saveScheduleAttachment(
        { ...attachment, ocr, updatedAtISO: new Date().toISOString() },
        weekStart
    );
    await publishScheduleAttachmentChanges(weekStart);

    return ocr;
}

function scheduleUploadPermissionMessage(error) {
    const code = scheduleUploadErrorCode(error);
    const context = scheduleUploadDebugContext();
    const base = String(
        error?.message ||
        "No se pudo publicar la programacion."
    );

    if (
        code !== "permission-denied" &&
        code !== "unauthenticated" &&
        code !== "storage/unauthorized" &&
        code !== "storage/unauthenticated" &&
        code !== "schedule/workspace-access-denied"
    ) {
        return base;
    }

    const hint = (
        "Verifica que la cuenta actual tenga acceso de supervisor " +
        "a la unidad activa."
    );

    if (!IS_TEST_ENVIRONMENT) {
        return `${base}\n\n${hint}`;
    }

    return [
        base,
        "",
        hint,
        "",
        `Cuenta Test: ${context.email}`,
        `UID: ${context.uid}`,
        `Unidad activa: ${context.workspaceId}`,
        code ? `Codigo Firebase: ${code}` : ""
    ].filter(Boolean).join("\n");
}

async function assertScheduleAttachmentUploadAccess() {
    const context = scheduleUploadDebugContext();

    if (!context.user?.uid) {
        throw new Error("Debes iniciar sesion para adjuntar la programacion.");
    }

    if (!context.workspace?.id) {
        throw new Error("Selecciona una unidad antes de adjuntar la programacion.");
    }

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const userWorkspaceRef = firestoreModule.doc(
            db,
            "users",
            context.user.uid,
            "workspaces",
            context.workspace.id
        );
        const userWorkspaceSnap = await firestoreModule.getDoc(userWorkspaceRef);

        if (!userWorkspaceSnap.exists()) {
            console.warn(
                "La unidad activa no aparece vinculada al usuario actual.",
                {
                    uid: context.uid,
                    email: context.email,
                    workspaceId: context.workspaceId
                }
            );
        }
    } catch (error) {
        if (scheduleUploadErrorCode(error) !== "permission-denied") {
            throw error;
        }

        console.warn(
            "No se pudo verificar la unidad activa antes de subir.",
            error
        );
    }
}

function normalizeText(value) {
    return stripAccents(String(value || "")).toLowerCase();
}

function isoFromDate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function formatShortDate(date) {
    return date.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit"
    });
}

function formatWeekday(date) {
    return date.toLocaleDateString("es-CL", {
        weekday: "long"
    });
}

// En las grillas el dia va abreviado ("mie"): con el nombre completo la columna
// no baja de 155 px y el tablero de 8 columnas ya no cabe en pantalla. Los
// dialogos y el Excel siguen usando el nombre largo, donde sobra el ancho.
function formatWeekdayShort(date) {
    return date.toLocaleDateString("es-CL", {
        weekday: "short"
    }).replace(".", "");
}

function weekStartMonday(date) {
    const base = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    const day = base.getDay();
    const diff = day === 0 ? -6 : 1 - day;

    base.setDate(base.getDate() + diff);
    return base;
}

function weekDays(start = currentWeekStart) {
    return Array.from({ length: 7 }, (_item, index) => {
        const day = new Date(start);

        day.setDate(start.getDate() + index);
        return day;
    });
}

function weekKey(start = currentWeekStart) {
    return isoFromDate(start);
}

async function holidayMapForDays(days) {
    const years = [...new Set(
        days.map(day => day.getFullYear())
    )];
    const maps = await Promise.all(
        years.map(year => fetchHolidays(year))
    );

    return Object.assign({}, ...maps);
}

function isInhabilDay(day, holidays = {}) {
    return !isBusinessDay(day, holidays);
}

function inhabilClass(day, holidays, className) {
    return isInhabilDay(day, holidays)
        ? ` ${className}`
        : "";
}

function addDays(date, amount) {
    const next = new Date(date);

    next.setDate(date.getDate() + amount);
    return next;
}

function normalizeTaskShift(value) {
    if (value === "night") return "night";
    if (value === GENERIC_TASK_SHIFT) return GENERIC_TASK_SHIFT;
    return "day";
}

// El catalogo de tareas es unico para los dos tableros, pero el detalle es
// propio de cada turno: lo que se anota en diurna no debe aparecer en noche.
// `detail` (plano) es el formato viejo; se sigue escribiendo con el valor
// diurno para que un cliente sin actualizar no lea el campo vacio.
function normalizeTaskDetails(task) {
    const legacy = cleanTaskDetail(task?.detail);
    const stored = task?.details && typeof task.details === "object"
        ? task.details
        : null;

    return {
        day: stored ? cleanTaskDetail(stored.day) : legacy,
        night: stored ? cleanTaskDetail(stored.night) : ""
    };
}

function cleanTaskDetail(value) {
    return String(value || "").trim().slice(0, TASK_DETAIL_MAX_LENGTH);
}

function taskDetailForShift(task, shift) {
    const details = normalizeTaskDetails(task);

    return shift === "night"
        ? details.night
        : details.day;
}

function normalizeStoredTask(task, index) {
    const defaultWorkerRules = normalizeTaskDefaultRules(task);
    const details = normalizeTaskDetails(task);

    return {
        id: String(task?.id || `task_${Date.now()}_${index}`),
        shift: normalizeTaskShift(task?.shift),
        title: String(task?.title || "").trim(),
        details,
        detail: details.day,
        order: Number.isFinite(Number(task?.order))
            ? Number(task.order)
            : index,
        defaultWorkers: uniqueValues(
            defaultWorkerRules.map(rule => rule.workerName)
        ),
        defaultWorkerRules,
        createdAt: task?.createdAt || new Date().toISOString()
    };
}

function taskTitleKey(title) {
    return normalizeText(title).replace(/\s+/g, " ").trim();
}

function mergeAssignmentEntries(current = {}, next = {}) {
    const currentNote = String(current?.note || "").trim();
    const nextNote = String(next?.note || "").trim();
    const notes = uniqueValues([currentNote, nextNote]);

    return {
        workers: uniqueValues([
            ...assignmentWorkers(current),
            ...assignmentWorkers(next)
        ]),
        note: notes.join(" | "),
        removedDefaults: uniqueValues([
            ...assignmentRemovedDefaults(current),
            ...assignmentRemovedDefaults(next)
        ])
    };
}

function migrateAssignmentsToGenericTasks(taskIdMap) {
    if (![...taskIdMap.entries()].some(([from, to]) => from !== to)) return;

    const all = getAllAssignments();
    let changed = false;

    Object.entries(all).forEach(([week, assignments]) => {
        if (!assignments || typeof assignments !== "object") return;

        const nextAssignments = {};

        Object.entries(assignments).forEach(([cellKey, entry]) => {
            const { shift, taskId, keyDay } = splitAssignmentKey(cellKey);
            const nextTaskId = taskIdMap.get(taskId) || taskId;
            const nextKey = assignmentKey(shift, nextTaskId, keyDay);

            nextAssignments[nextKey] = mergeAssignmentEntries(
                nextAssignments[nextKey],
                entry
            );

            if (nextKey !== cellKey) changed = true;
        });

        all[week] = nextAssignments;
    });

    if (changed) setJSON(ASSIGNMENTS_KEY, all);
}

function migrateTaskCatalogIfNeeded(tasks) {
    const byTitle = new Map();

    tasks.forEach(task => {
        const key = taskTitleKey(task.title) || task.id;
        const items = byTitle.get(key) || [];

        items.push(task);
        byTitle.set(key, items);
    });

    const groups = [];

    byTitle.forEach(items => {
        const shifts = new Set(items.map(task => task.shift));

        if (items.length > 1 && shifts.size > 1) {
            groups.push(items);
            return;
        }

        items.forEach(task => groups.push([task]));
    });

    const needsMigration = tasks.some(task =>
        task.shift !== GENERIC_TASK_SHIFT
    ) || groups.some(group => group.length > 1);

    if (!needsMigration) return tasks;

    const taskIdMap = new Map();
    const migrated = groups.map(group => {
        const canonical = group.find(task => task.shift === GENERIC_TASK_SHIFT) ||
            group.find(task => task.shift === "day") ||
            group[0];
        const defaultWorkerRules = normalizeTaskDefaultRules({
            defaultWorkers: group.flatMap(task => task.defaultWorkers),
            defaultWorkerRules: group.flatMap(task =>
                taskDefaultRules(task)
            )
        });

        group.forEach(task => {
            taskIdMap.set(task.id, canonical.id);
        });

        return {
            ...canonical,
            shift: GENERIC_TASK_SHIFT,
            order: Math.min(...group.map(task => task.order)),
            defaultWorkers: uniqueValues(
                defaultWorkerRules.map(rule => rule.workerName)
            ),
            defaultWorkerRules,
            createdAt: group
                .map(task => task.createdAt)
                .sort()[0] || canonical.createdAt
        };
    }).sort((a, b) =>
        a.order - b.order ||
        a.title.localeCompare(b.title, "es")
    );

    saveTasks(migrated);
    migrateAssignmentsToGenericTasks(taskIdMap);
    return migrated.map((task, index) => ({
        ...task,
        order: index
    }));
}

function getTasks() {
    const raw = getJSON(TASKS_KEY, []);
    const tasks = (Array.isArray(raw) ? raw : [])
        .map(normalizeStoredTask)
        .filter(task => task.title);
    const migrated = migrateTaskCatalogIfNeeded(tasks);

    return migrated.sort((a, b) =>
        a.order - b.order ||
        a.title.localeCompare(b.title, "es")
    );
}

function saveTasks(tasks) {
    setJSON(
        TASKS_KEY,
        tasks.map((task, index) => ({
            ...task,
            shift: GENERIC_TASK_SHIFT,
            order: index
        }))
    );
}

function getAllAssignments() {
    const raw = getJSON(ASSIGNMENTS_KEY, {});

    return raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw
        : {};
}

function taskAssignmentWorkerNamesForTask(taskId, allAssignments = getAllAssignments()) {
    const names = new Set();

    Object.values(allAssignments || {}).forEach(assignments => {
        if (!assignments || typeof assignments !== "object") return;

        Object.entries(assignments).forEach(([cellKey, entry]) => {
            if (splitAssignmentKey(cellKey).taskId !== taskId) return;

            assignmentWorkers(entry).forEach(name => names.add(name));
            assignmentRemovedDefaults(entry).forEach(name => names.add(name));
        });
    });

    return names;
}

function taskWorkerNames(task, allAssignments = getAllAssignments()) {
    const names = taskAssignmentWorkerNamesForTask(task?.id, allAssignments);

    taskDefaultRules(task).forEach(rule => {
        if (rule.workerName) names.add(rule.workerName);
    });

    return names;
}

function allTaskWorkerNames() {
    const allAssignments = getAllAssignments();
    const names = new Set();

    getTasks().forEach(task => {
        taskWorkerNames(task, allAssignments)
            .forEach(name => names.add(name));
    });

    return [...names];
}

function publishTaskAssignmentChanges(workerNames = null) {
    const names = Array.isArray(workerNames)
        ? workerNames
        : allTaskWorkerNames();

    if (!names.length) return;

    scheduleWorkerAppDataPublish(
        TASK_ASSIGNMENT_PUBLISH_DELAY_MS,
        names,
        null,
        { requiresLocalStateFlush: true }
    );
}

async function publishScheduleAttachmentChanges(start = currentWeekStart) {
    const weekStart = weekStartMonday(start);
    const weekStartISO = scheduleWeekStartISO(weekStart);
    const attachment = getScheduleAttachment(weekStart);
    const publication = await publishWorkerScheduleAttachmentNow(
        getScheduleAttachments()
    );

    await notifyScheduleAttachmentPublication(attachment, publication, {
        weekStartISO,
        weekEndISO: scheduleWeekEndISO(weekStart),
        weekLabel: scheduleWeekLabel(weekStart)
    });
}

async function notifyScheduleAttachmentPublication(
    attachment,
    publication,
    week = {}
) {
    const workspace = getActiveWorkspace();
    const publishedCount = Number(publication?.count ?? publication ?? 0);
    const recipientUids = Array.isArray(publication?.uids)
        ? publication.uids
        : [];

    if (!workspace?.id || !publishedCount) return;

    try {
        const { functions, functionsModule } = await getFirebaseServices();
        const notify = functionsModule.httpsCallable(
            functions,
            "notifyScheduleAttachmentUpdated"
        );
        const eventId = [
            "schedule_attachment",
            attachment?.id || (attachment ? "published" : "removed"),
            Date.now().toString(36)
        ].join("_");

        await notify({
            workspaceId: workspace.id,
            eventId,
            action: attachment ? "published" : "removed",
            attachment: attachment
                ? {
                    id: attachment.id || "",
                    name: attachment.name || "",
                    storagePath: attachment.storagePath || "",
                    updatedAtISO: attachment.updatedAtISO || attachment.addedAt || "",
                    mode: attachment.mode || "",
                    ocrStatus: attachment.ocr?.status || "",
                    weekStartISO: attachment.weekStartISO || week.weekStartISO || "",
                    weekEndISO: attachment.weekEndISO || week.weekEndISO || "",
                    weekLabel: attachment.weekLabel || week.weekLabel || ""
                }
                : {
                    weekStartISO: week.weekStartISO || "",
                    weekEndISO: week.weekEndISO || "",
                    weekLabel: week.weekLabel || ""
                },
            publishedCount,
            recipientUids
        });
    } catch (error) {
        console.warn(
            "La programacion se publico, pero no se pudo notificar a la PWA.",
            error
        );
    }
}

function scheduleOcrStatusLabel(ocr) {
    const status = String(ocr?.status || "").trim();

    if (status === "completed") {
        const count = Number(ocr?.textLength || ocr?.text?.length || 0);
        const words = Array.isArray(ocr?.words) ? ocr.words.length : 0;
        const wordsPart = words ? ` · ${words} palabras` : " · sin coordenadas";

        return count
            ? `OCR listo (${count}${wordsPart})`
            : `OCR listo${wordsPart}`;
    }

    if (status === "empty") return "OCR sin texto";
    if (status === "failed") return "OCR con error";
    if (status === "processing" || status === "pending") return "OCR pendiente";
    if (status) return `OCR ${status}`;

    return "OCR pendiente";
}

function getWeekAssignments(start = currentWeekStart) {
    const all = getAllAssignments();
    const value = all[weekKey(start)];

    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}

function saveWeekAssignments(assignments, start = currentWeekStart) {
    const all = getAllAssignments();

    all[weekKey(start)] = assignments;
    setJSON(ASSIGNMENTS_KEY, all);
}

function assignmentKey(shift, taskId, keyDay) {
    return `${shift}|${taskId}|${keyDay}`;
}

function splitAssignmentKey(value) {
    const [shift, taskId, keyDay] = String(value || "").split("|");

    return { shift, taskId, keyDay };
}

function profileProfession(profile) {
    return String(profile?.profession || "Sin informacion");
}

function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "es"));
}

function normalizeDefaultInterval(value) {
    const numberValue = Math.floor(Number(value));

    return Number.isFinite(numberValue) &&
        numberValue >= 1 &&
        numberValue <= 10
        ? numberValue
        : 1;
}

// Tope de las periodicidades "Cada N turnos diurno habil".
const MAX_HABIL_INTERVAL = 5;

function normalizeHabilInterval(value) {
    const numberValue = Math.floor(Number(value));

    return Number.isFinite(numberValue) &&
        numberValue >= 1 &&
        numberValue <= MAX_HABIL_INTERVAL
        ? numberValue
        : 1;
}

// La periodicidad se guarda como { interval, habilOnly }. En el <select> se
// codifica como "h<N>" para "Cada N turnos diurno habil" (la secuencia cuenta
// solo turnos diurnos en dias habiles) y "<N>" para las normales (todos los
// componentes de turno programados, diurnos y nocturnos).
function encodeIntervalValue(interval, habilOnly) {
    return habilOnly
        ? `h${normalizeHabilInterval(interval)}`
        : String(normalizeDefaultInterval(interval));
}

function parseIntervalValue(value) {
    const raw = String(value || "").trim().toLowerCase();

    if (raw.startsWith("h")) {
        return {
            interval: normalizeHabilInterval(raw.slice(1)),
            habilOnly: true
        };
    }

    return {
        interval: normalizeDefaultInterval(raw),
        habilOnly: false
    };
}

function isBusinessKeyDay(keyDay) {
    const date = parseKey(keyDay);

    if (!isValidDate(date)) return false;

    return isBusinessDay(date, getCachedHolidays(date.getFullYear()));
}

function normalizeTaskDefaultRules(task) {
    const rules = new Map();
    const defaultWorkers = Array.isArray(task?.defaultWorkers)
        ? task.defaultWorkers
        : [task?.defaultWorker];
    const addRule = (workerName, interval = 1, anchorKeyDay = "", habilOnly = false) => {
        const cleanWorker = String(workerName || "").trim();

        if (!cleanWorker) return;

        rules.set(cleanWorker, {
            workerName: cleanWorker,
            interval: habilOnly
                ? normalizeHabilInterval(interval)
                : normalizeDefaultInterval(interval),
            anchorKeyDay: String(anchorKeyDay || ""),
            habilOnly: Boolean(habilOnly)
        });
    };

    defaultWorkers.forEach(worker => addRule(worker));

    if (Array.isArray(task?.defaultWorkerRules)) {
        task.defaultWorkerRules.forEach(rule => {
            addRule(
                rule?.workerName || rule?.worker || rule?.name,
                rule?.interval,
                rule?.anchorKeyDay || rule?.anchor || rule?.startKeyDay,
                rule?.habilOnly === true || rule?.habil === true
            );
        });
    }

    return [...rules.values()].sort((a, b) =>
        a.workerName.localeCompare(b.workerName, "es")
    );
}

function availableRoles() {
    return uniqueValues(
        getProfiles()
            .filter(isProfileActive)
            .map(profile => profile.estamento || "Sin estamento")
    );
}

function availableProfessions() {
    return uniqueValues(
        getProfiles()
            .filter(isProfileActive)
            .map(profileProfession)
    );
}

function selectionMatches(value, selected) {
    return !selected || selected.includes(value);
}

function profileMatchesFilters(profile, roles, professions) {
    return selectionMatches(
        profile.estamento || "Sin estamento",
        roles
    ) &&
        selectionMatches(profileProfession(profile), professions);
}

function profileByName(name) {
    return getProfiles().find(profile => profile.name === name) || null;
}

function getProfileShift(profile, keyDay) {
    return getTurnoReal(profile.name, keyDay);
}

function readMap(prefix, profileName) {
    return getJSON(`${prefix}_${profileName}`, {});
}

function absenceLabelForType(type) {
    if (type === "license") return "Licencia M\u00e9dica";
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    if (type === "training") return "Capacitaci\u00f3n";
    if (type === "unjustified_absence") return "Ausencia injustificada";

    return "Ausencia";
}

function absenceDetail(profileName, keyDay) {
    const admin = readMap("admin", profileName);
    const legal = readMap("legal", profileName);
    const comp = readMap("comp", profileName);
    const absences = readMap("absences", profileName);

    if (admin[keyDay] === 1) return "P. Administrativo";
    if (admin[keyDay] === "0.5M") return "1/2 ADM Ma\u00f1ana";
    if (admin[keyDay] === "0.5T") return "1/2 ADM Tarde";
    if (admin[keyDay] === 0.5) return "1/2 ADM";
    if (legal[keyDay]) return "F. Legal";
    if (comp[keyDay]) return "F. Compensatorio";
    if (absences[keyDay]) {
        return absenceLabelForType(getAbsenceType(absences[keyDay]));
    }
    if (getHourReturn(profileName, keyDay)) {
        return "Devolucion de Hora";
    }

    return "";
}

function hasBlockingAbsence(profileName, keyDay) {
    return Boolean(absenceDetail(profileName, keyDay));
}

function turnScheduledForShift(turn, shift) {
    const state = Number(turn) || TURNO.LIBRE;

    if (shift === "day") {
        return [
            TURNO.LARGA,
            TURNO.DIURNO,
            TURNO.TURNO24,
            TURNO.DIURNO_NOCHE
        ].includes(state);
    }

    return [
        TURNO.NOCHE,
        TURNO.TURNO24,
        TURNO.DIURNO_NOCHE,
        TURNO.TURNO18
    ].includes(state);
}

function isScheduledForShift(profile, keyDay, shift) {
    if (!profile || !isProfileActive(profile)) return false;

    return turnScheduledForShift(getProfileShift(profile, keyDay), shift);
}

function isBaseScheduledForShift(profile, keyDay, shift) {
    if (!profile || !isProfileActive(profile)) return false;

    return turnScheduledForShift(getTurnoBase(profile.name, keyDay), shift);
}

function isAvailableForShift(profile, keyDay, shift) {
    if (!isScheduledForShift(profile, keyDay, shift)) return false;
    return !hasBlockingAbsence(profile.name, keyDay);
}

function assignmentWorkers(entry) {
    return Array.isArray(entry?.workers)
        ? entry.workers.filter(Boolean)
        : [];
}

function assignmentRemovedDefaults(entry) {
    return uniqueValues(
        Array.isArray(entry?.removedDefaults)
            ? entry.removedDefaults.map(worker =>
                String(worker || "").trim()
            )
            : []
    );
}

function taskDefaultWorkers(task) {
    return taskDefaultRules(task).map(rule => rule.workerName);
}

function taskDefaultRules(task) {
    return Array.isArray(task?.defaultWorkerRules)
        ? task.defaultWorkerRules
        : normalizeTaskDefaultRules(task);
}

function isValidDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime());
}

function shiftOrderForRule(habilOnly) {
    return habilOnly ? ["day"] : SHIFT_TYPES;
}

function countBaseScheduledTurns(
    profile,
    targetShift,
    startDate,
    endDate,
    habilOnly = false
) {
    if (!isValidDate(startDate) || !isValidDate(endDate)) return 0;
    if (endDate < startDate) return 0;
    if (habilOnly && targetShift !== "day") return 0;

    const cursor = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate()
    );
    const end = new Date(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate()
    );
    const targetKey = keyFromDate(end);
    const shifts = shiftOrderForRule(habilOnly);
    let count = 0;

    while (cursor <= end) {
        const keyDay = keyFromDate(cursor);
        const isTargetDay = keyDay === targetKey;

        for (const shift of shifts) {
            if (
                isBaseScheduledForShift(profile, keyDay, shift) &&
                (
                    !habilOnly ||
                    isBusinessDay(
                        cursor,
                        getCachedHolidays(cursor.getFullYear())
                    )
                )
            ) {
                count += 1;
            }

            if (isTargetDay && shift === targetShift) {
                return count;
            }
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    return count;
}

function shouldApplyDefaultRule(rule, profile, keyDay, shift) {
    if (!isBaseScheduledForShift(profile, keyDay, shift)) return false;
    if (hasBlockingAbsence(profile.name, keyDay)) return false;

    const habilOnly = rule?.habilOnly === true;

    // "Cada N turnos diurno habil": solo aplica al tablero diurno y la
    // secuencia ignora noches, dias libres e inhabiles.
    if (habilOnly && shift !== "day") return false;
    if (habilOnly && !isBusinessKeyDay(keyDay)) return false;

    const interval = habilOnly
        ? normalizeHabilInterval(rule?.interval)
        : normalizeDefaultInterval(rule?.interval);

    if (interval <= 1) return true;

    const anchor = parseKey(rule?.anchorKeyDay);
    const target = parseKey(keyDay);

    if (!isValidDate(anchor) || !isValidDate(target)) return false;

    const scheduledCount = countBaseScheduledTurns(
        profile,
        shift,
        anchor,
        target,
        habilOnly
    );

    return scheduledCount > 0 && (scheduledCount - 1) % interval === 0;
}

function defaultWorkersForCell(task, keyDay, shift = task.shift) {
    return taskDefaultRules(task)
        .filter(rule => {
            const profile = profileByName(rule.workerName);

            return shouldApplyDefaultRule(
                rule,
                profile,
                keyDay,
                shift
            ) && isAvailableForShift(profile, keyDay, shift);
        })
        .map(rule => rule.workerName);
}

function applyDefaultAssignments(days, tasks, assignments) {
    let changed = false;

    tasks.forEach(task => {
        SHIFT_TYPES.forEach(shift => {
            taskDefaultRules(task).forEach(rule => {
                const profile = profileByName(rule.workerName);

                if (!profile) return;

                days.forEach(day => {
                    const keyDay = keyFromDate(day);

                    if (
                        !shouldApplyDefaultRule(
                            rule,
                            profile,
                            keyDay,
                            shift
                        ) ||
                        !isAvailableForShift(profile, keyDay, shift)
                    ) return;

                    // Si la casilla esta fusionada, el predefinido entra en
                    // la de arriba del grupo: es la unica que se dibuja.
                    const group = groupForTask(
                        assignments,
                        shift,
                        tasks,
                        task.id,
                        keyDay
                    );
                    const ownerId = group?.taskIds[0] || task.id;
                    const cellKey = assignmentKey(shift, ownerId, keyDay);
                    const entry = getCellEntry(
                        assignments,
                        shift,
                        ownerId,
                        keyDay
                    );
                    const workers = assignmentWorkers(entry);
                    const removedDefaults = assignmentRemovedDefaults(entry);

                    if (
                        workers.includes(rule.workerName) ||
                        removedDefaults.includes(rule.workerName)
                    ) return;

                    assignments[cellKey] = {
                        ...entry,
                        workers: [...workers, rule.workerName]
                    };
                    changed = true;
                });
            });
        });
    });

    return changed;
}

function cleanAssignmentsForWeek(days, tasks) {
    const assignments = getWeekAssignments();
    const taskIds = new Set(tasks.map(task => task.id));
    let changed = false;

    Object.entries(assignments).forEach(([cellKey, entry]) => {
        const { shift, taskId, keyDay } = splitAssignmentKey(cellKey);

        if (!taskIds.has(taskId)) {
            delete assignments[cellKey];
            changed = true;
            return;
        }

        // El enlace apunta por id: si la tarea de abajo ya no es esa -se
        // reordeno o se borro- la fusion deja de tener sentido.
        if (entry?.mergedNextTaskId) {
            const index = tasks.findIndex(task => task.id === taskId);
            const next = tasks[index + 1];

            if (!next || next.id !== entry.mergedNextTaskId) {
                changed = true;
                persistEntryOrDelete(assignments, cellKey, {
                    ...entry,
                    mergedNextTaskId: ""
                });
            }
        }

        if (!days.some(day => keyFromDate(day) === keyDay)) return;

        // Aqui solo se quita a quien ese dia NO PUEDE trabajar: licencia,
        // permiso, ausencia, o un perfil que ya no existe o quedo inactivo.
        //
        // Estar libre del turno NO basta para quitarlo. El modal ofrece
        // deliberadamente "Todos" para asignar a alguien fuera de su turno
        // (`includeWorkersWithoutShift`), y este saneado corre en cada
        // pintado: si tambien filtrara por turno, guardar a esa persona y
        // perderla serian el mismo gesto, sin aviso ninguno. Se queda
        // asignada y el chip se marca como fuera de turno.
        const availableWorkers = assignmentWorkers(entry)
            .filter(name => {
                const profile = profileByName(name);

                return Boolean(profile) &&
                    isProfileActive(profile) &&
                    !hasBlockingAbsence(name, keyDay);
            });

        if (
            availableWorkers.length !== assignmentWorkers(entry).length
        ) {
            changed = true;
            persistEntryOrDelete(assignments, cellKey, {
                ...entry,
                workers: availableWorkers
            });
        }
    });

    if (applyDefaultAssignments(days, tasks, assignments)) {
        changed = true;
    }

    if (changed) saveWeekAssignments(assignments);
    return assignments;
}

function getCellEntry(assignments, shift, taskId, keyDay) {
    return assignments[assignmentKey(shift, taskId, keyDay)] || {
        workers: [],
        note: "",
        removedDefaults: [],
        mergedNextTaskId: ""
    };
}

// ---------------------------------------------------------------------------
// Fusion de casillas dentro de una columna (mismo turno y mismo dia).
//
// El enlace se guarda en la casilla de ARRIBA y apunta POR ID a la tarea de
// abajo. Guardar el id -y no un simple "va unida con la siguiente"- es lo que
// deja que la fusion se invalide sola cuando el supervisor reordena o borra
// tareas: si la de abajo ya no es esa, el enlace se ignora y despues se limpia.
//
// Un grupo es una cadena maxima de enlaces. Los trabajadores viven todos en la
// casilla de arriba del grupo, que es la unica que se dibuja; las de abajo no
// se emiten y su fila la ocupa la de arriba.
// ---------------------------------------------------------------------------

function mergedNextIdOf(assignments, shift, taskId, keyDay) {
    return String(
        getCellEntry(assignments, shift, taskId, keyDay).mergedNextTaskId || ""
    );
}

function isMergedWithNext(assignments, shift, tasks, index, keyDay) {
    const current = tasks[index];
    const next = tasks[index + 1];

    if (!current || !next) return false;

    return mergedNextIdOf(assignments, shift, current.id, keyDay) === next.id;
}

function columnGroups(assignments, shift, tasks, keyDay) {
    const groups = [];
    let current = null;

    tasks.forEach((task, index) => {
        if (!current) current = { start: index, taskIds: [task.id] };

        if (isMergedWithNext(assignments, shift, tasks, index, keyDay)) {
            current.taskIds.push(tasks[index + 1].id);
            return;
        }

        groups.push(current);
        current = null;
    });

    if (current) groups.push(current);

    return groups;
}

function groupForTask(assignments, shift, tasks, taskId, keyDay) {
    return columnGroups(assignments, shift, tasks, keyDay)
        .find(group => group.taskIds.includes(taskId)) || null;
}

// Al fusionar, los trabajadores de las casillas de abajo suben a la de arriba,
// que pasa a ser la unica visible. Si se quedaran donde estan desaparecerian de
// la vista sin haberse borrado.
function collapseGroupWorkers(assignments, shift, tasks, taskId, keyDay) {
    const group = groupForTask(assignments, shift, tasks, taskId, keyDay);

    if (!group || group.taskIds.length < 2) return;

    const [ownerId, ...others] = group.taskIds;
    const owner = getCellEntry(assignments, shift, ownerId, keyDay);
    const workers = [...assignmentWorkers(owner)];
    const notes = [String(owner.note || "").trim()];
    const removed = [...assignmentRemovedDefaults(owner)];

    others.forEach(id => {
        const entry = getCellEntry(assignments, shift, id, keyDay);

        workers.push(...assignmentWorkers(entry));
        notes.push(String(entry.note || "").trim());
        removed.push(...assignmentRemovedDefaults(entry));

        persistEntryOrDelete(assignments, assignmentKey(shift, id, keyDay), {
            workers: [],
            note: "",
            removedDefaults: [],
            mergedNextTaskId: entry.mergedNextTaskId
        });
    });

    persistEntryOrDelete(assignments, assignmentKey(shift, ownerId, keyDay), {
        ...owner,
        workers: uniqueValues(workers),
        note: uniqueValues(notes).join(" | "),
        removedDefaults: uniqueValues(removed)
    });
}

function groupOwnerEntry(assignments, shift, tasks, taskId, keyDay) {
    const group = groupForTask(assignments, shift, tasks, taskId, keyDay);

    return getCellEntry(assignments, shift, group?.taskIds[0] || taskId, keyDay);
}

function mergeCellWithNext(shift, keyDay, upperTaskId) {
    const assignments = getWeekAssignments();
    const tasks = getTasks();
    const index = tasks.findIndex(task => task.id === upperTaskId);
    const next = tasks[index + 1];

    if (index === -1 || !next) return false;

    persistEntryOrDelete(
        assignments,
        assignmentKey(shift, upperTaskId, keyDay),
        {
            ...getCellEntry(assignments, shift, upperTaskId, keyDay),
            mergedNextTaskId: next.id
        }
    );
    collapseGroupWorkers(assignments, shift, tasks, upperTaskId, keyDay);
    saveWeekAssignments(assignments);
    publishTaskAssignmentChanges();
    return true;
}

// Al separar, los trabajadores no se mueven: ya estaban todos en la casilla de
// arriba, que es justo donde el supervisor los espera para repartirlos a mano.
function splitCellGroup(shift, keyDay, taskId) {
    const assignments = getWeekAssignments();
    const tasks = getTasks();
    const group = groupForTask(assignments, shift, tasks, taskId, keyDay);

    if (!group || group.taskIds.length < 2) return false;

    group.taskIds.forEach(id => {
        persistEntryOrDelete(assignments, assignmentKey(shift, id, keyDay), {
            ...getCellEntry(assignments, shift, id, keyDay),
            mergedNextTaskId: ""
        });
    });
    saveWeekAssignments(assignments);
    publishTaskAssignmentChanges();
    return true;
}

function workerHasOtherTask(
    assignments,
    workerName,
    shift,
    keyDay,
    taskId
) {
    return Object.entries(assignments).some(([cellKey, entry]) => {
        const parts = splitAssignmentKey(cellKey);

        return parts.shift === shift &&
            parts.keyDay === keyDay &&
            parts.taskId !== taskId &&
            assignmentWorkers(entry).includes(workerName);
    });
}

function profileShiftLabel(profile, keyDay) {
    return TURNO_LABEL[getProfileShift(profile, keyDay)] || "Libre";
}

function profileMatchesWorkerSearch(profile, keyDay, query) {
    const normalizedQuery = normalizeProfileSearch(query);

    if (!normalizedQuery) return true;

    return [
        profile.name,
        profile.estamento,
        profileProfession(profile),
        profileShiftLabel(profile, keyDay),
        getCalendarProfileSearchValue(profile)
    ]
        .map(normalizeProfileSearch)
        .some(value => value.includes(normalizedQuery));
}

function isAssignableCandidate(profile, keyDay, shift, includeWorkersWithoutShift) {
    if (!profile || !isProfileActive(profile)) return false;
    if (hasBlockingAbsence(profile.name, keyDay)) return false;

    return includeWorkersWithoutShift ||
        turnScheduledForShift(getProfileShift(profile, keyDay), shift);
}

function candidateProfiles(
    shift,
    keyDay,
    roles,
    professions,
    {
        includeWorkersWithoutShift = false,
        query = ""
    } = {}
) {
    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => profileMatchesFilters(
            profile,
            roles,
            professions
        ))
        .filter(profile => isAssignableCandidate(
            profile,
            keyDay,
            shift,
            includeWorkersWithoutShift
        ))
        .filter(profile => profileMatchesWorkerSearch(
            profile,
            keyDay,
            query
        ))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function renderDialogWorkerOptions(candidates) {
    const used = new Set();

    return candidates
        .flatMap(profile =>
            getCalendarProfileSearchOptionValues(profile)
                .map(value => {
                    if (!value || used.has(value)) return "";

                    used.add(value);

                    const searchValue =
                        getCalendarProfileSearchValue(profile);
                    const label = value !== searchValue
                        ? ` label="${escapeHTML(searchValue)}"`
                        : "";

                    return `<option value="${escapeHTML(value)}"${label}></option>`;
                })
        )
        .join("");
}

function filterSummaryLabel(options, selected) {
    if (!selected || selected.length === options.length) {
        return "Todos";
    }

    if (!selected.length) {
        return "Sin selecci\u00f3n";
    }

    if (selected.length === 1) {
        return selected[0];
    }

    return `${selected.length} seleccionados`;
}

function renderMultiSelectFilter(
    name,
    options,
    selected,
    action,
    openAction = openTaskFilterGroup,
    prefix = ""
) {
    const normalizedSelected = selected || options;
    const isOpen = openAction === action;
    const isFiltered = Boolean(selected);

    return `
        <details class="task-assignment-multiselect${isFiltered ? " is-filtered" : ""}" data-filter-group="${escapeHTML(action)}" ${isOpen ? "open" : ""}>
            <summary>
                <span>${prefix ? `${escapeHTML(prefix)} &middot; ` : ""}${escapeHTML(filterSummaryLabel(options, selected))}</span>
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path d="M5 7.5 10 12.5 15 7.5"></path>
                </svg>
            </summary>
            <div class="task-assignment-multiselect__menu">
                <label class="task-assignment-multiselect__option task-assignment-multiselect__option--all">
                    <input type="checkbox" data-multiselect-select-all data-multiselect-name="${escapeHTML(name)}" ${normalizedSelected.length === options.length ? "checked" : ""}>
                    <span>Seleccionar todo</span>
                </label>
                ${options.map(option => `
                    <label class="task-assignment-multiselect__option">
                        <input type="checkbox" name="${escapeHTML(name)}" value="${escapeHTML(option)}" ${normalizedSelected.includes(option) ? "checked" : ""}>
                        <span>${escapeHTML(option)}</span>
                    </label>
                `).join("")}
            </div>
        </details>
    `;
}

function selectedValues(root, selector, options) {
    const values = [...root.querySelectorAll(selector)]
        .filter(input => input.checked)
        .map(input => input.value);

    return values.length === options.length ? null : values;
}

function syncMultiSelectSelectAll(control) {
    const selectAll =
        control?.querySelector("[data-multiselect-select-all]");
    const options = [...(
        control?.querySelectorAll(
            "input[type='checkbox']:not([data-multiselect-select-all])"
        ) || []
    )];

    if (!selectAll) return;

    const checkedCount =
        options.filter(input => input.checked).length;

    selectAll.checked =
        options.length > 0 && checkedCount === options.length;
    selectAll.indeterminate =
        checkedCount > 0 && checkedCount < options.length;
}

function handleMultiSelectSelectAllChange(event) {
    const target = event?.target;
    const control = target instanceof Element
        ? target.closest(".task-assignment-multiselect")
        : null;

    if (!control) return;

    if (target?.matches?.("[data-multiselect-select-all]")) {
        const nextChecked = Boolean(target.checked);

        control
            .querySelectorAll(
                "input[type='checkbox']:not([data-multiselect-select-all])"
            )
            .forEach(input => {
                input.checked = nextChecked;
            });
    }

    syncMultiSelectSelectAll(control);
}

function closeMultiSelectsOutside(root, event, clearOpenGroup) {
    const target = event?.target;

    root
        .querySelectorAll(".task-assignment-multiselect[open]")
        .forEach(control => {
            if (target && control.contains(target)) return;
            control.open = false;
        });

    if (
        root.querySelector(".task-assignment-multiselect[open]")
    ) {
        return;
    }

    clearOpenGroup();
}

function bindMultiSelectOutsideClose(root, clearOpenGroup) {
    const handlePointerDown = event => {
        closeMultiSelectsOutside(root, event, clearOpenGroup);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
        document.removeEventListener(
            "pointerdown",
            handlePointerDown,
            true
        );
    };
}

function birthdayProfiles(date) {
    const month = date.getMonth();
    const day = date.getDate();

    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => profileMatchesFilters(
            profile,
            selectedRoles,
            selectedProfessions
        ))
        .filter(profile => {
            const raw = String(profile.birthDate || "");
            const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

            return match &&
                Number(match[2]) - 1 === month &&
                Number(match[3]) === day;
        })
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function absenceProfiles(date) {
    const keyDay = keyFromDate(date);

    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => profileMatchesFilters(
            profile,
            selectedRoles,
            selectedProfessions
        ))
        .map(profile => ({
            profile,
            label: absenceDetail(profile.name, keyDay)
        }))
        .filter(item => item.label)
        .sort((a, b) =>
            a.profile.name.localeCompare(b.profile.name, "es")
        );
}

// En el tablero el chip muestra el nombre abreviado para que quepan mas
// trabajadores por celda: inicial del primer nombre + primer apellido. En los
// nombres de los perfiles el primer apellido es la penultima palabra (3
// palabras -> la 2a, 4 -> la 3a, 5 -> la 4a, 6 -> la 5a). El nombre completo
// se conserva en los data-* y en el title del chip.
function workerNameParts(fullName) {
    const words = String(fullName || "").trim().split(/\s+/).filter(Boolean);

    if (!words.length) return null;
    if (words.length === 1) return { first: words[0], surname: "" };

    return {
        first: words[0],
        surname: words.length >= 3 ? words[words.length - 2] : words[1]
    };
}

function shortWorkerName(fullName, { compact = false } = {}) {
    const parts = workerNameParts(fullName);

    if (!parts) return "";
    if (!parts.surname) return parts.first;

    // La tabla publicada encadena los nombres con guion ("J.CORNEJO-B.ESCOBAR")
    // y ahi el espacio despues del punto se lee como separacion entre personas.
    return `${parts.first.charAt(0)}.${compact ? "" : " "}${parts.surname}`;
}

// Iniciales del avatar del chip: inicial del nombre + inicial del primer
// apellido, las mismas dos letras que se leen en el chip abreviado.
function workerInitials(fullName) {
    const parts = workerNameParts(fullName);

    if (!parts) return "";
    if (!parts.surname) return parts.first.charAt(0).toUpperCase();

    return `${parts.first.charAt(0)}${parts.surname.charAt(0)}`.toUpperCase();
}

// El tono del avatar se deriva del nombre, no de la posicion en la lista: asi
// una misma persona conserva su color entre semanas, turnos y tableros. Todos
// comparten luminosidad y croma y solo cambian de matiz, para que ninguno pese
// mas que otro ni compita con el color de marca.
function workerAvatarTone(fullName) {
    const name = stripAccents(String(fullName || "")).toUpperCase();
    let hash = 0;

    for (let index = 0; index < name.length; index += 1) {
        hash = (hash * 31 + name.charCodeAt(index)) % 360;
    }

    return `oklch(0.58 0.10 ${hash})`;
}

function renderWorkerAvatar(profileName) {
    return `<span class="task-assignment-worker-avatar" style="background: ${workerAvatarTone(profileName)};" aria-hidden="true">${escapeHTML(workerInitials(profileName))}</span>`;
}

function renderWorkerChip(profileName, task, keyDay) {
    const profile = profileByName(profileName);
    const configuredClass = taskDefaultWorkers(task).includes(profileName)
        ? " is-configured"
        : "";

    if (
        profile &&
        !profileMatchesFilters(
            profile,
            selectedRoles,
            selectedProfessions
        )
    ) {
        return "";
    }

    // Asignado aunque ese dia no le toca el turno: se hace a proposito desde
    // "Todos" del modal, asi que no se oculta ni se borra, pero tampoco puede
    // pasar por una asignacion normal.
    const offShift = Boolean(profile) &&
        !isScheduledForShift(profile, keyDay, task.shift);
    const offShiftClass = offShift
        ? " task-assignment-worker-chip--off-shift"
        : "";
    const offShiftHint = offShift
        ? " | Fuera de su turno este d&iacute;a"
        : "";

    return `
        <span class="task-assignment-worker-chip${configuredClass}${offShiftClass}" draggable="true" data-worker-drag="${escapeHTML(profileName)}" data-worker-task="${escapeHTML(task.id)}" data-worker-shift="${escapeHTML(task.shift)}" data-worker-day="${escapeHTML(keyDay)}" title="${escapeHTML(profileName)}${offShiftHint} | Arrastrar a otra tarea del mismo turno y d&iacute;a">
            ${renderWorkerAvatar(profileName)}
            <span class="task-assignment-worker-chip__name">${escapeHTML(shortWorkerName(profileName))}</span>
            <button class="task-assignment-worker-edit${configuredClass}" type="button" data-worker-default-config="${escapeHTML(profileName)}" data-worker-task="${escapeHTML(task.id)}" data-worker-shift="${escapeHTML(task.shift)}" data-worker-day="${escapeHTML(keyDay)}" title="Editar trabajador predefinido" aria-label="Editar trabajador predefinido">
                &#9998;
            </button>
        </span>
    `;
}

// Los puntos del borde izquierdo son el gesto para fusionar: se arrastra el de
// abajo de una casilla hasta el de arriba de la siguiente (o al reves). Cuando
// el grupo ya esta fusionado, el punto de arriba y el de abajo quedan unidos por
// una linea, y esa linea es el boton para separarlo.
function renderMergePorts(task, keyDay, { taskIndex, size, taskCount }) {
    const shift = escapeHTML(task.shift);
    const day = escapeHTML(keyDay);
    const hasAbove = taskIndex > 0;
    const hasBelow = taskIndex + size < taskCount;
    const merged = size > 1;

    return `
        ${merged ? `
            <button class="task-assignment-merge-line" type="button" data-merge-split="${escapeHTML(task.id)}" data-shift="${shift}" data-day="${day}" title="Separar las casillas" aria-label="Separar las casillas"></button>
        ` : ""}
        ${hasAbove ? `
            <span class="task-assignment-merge-port task-assignment-merge-port--top" draggable="true" data-merge-port="top" data-merge-task="${escapeHTML(task.id)}" data-shift="${shift}" data-day="${day}" title="Unir con la casilla de arriba"></span>
        ` : ""}
        ${hasBelow ? `
            <span class="task-assignment-merge-port task-assignment-merge-port--bottom" draggable="true" data-merge-port="bottom" data-merge-task="${escapeHTML(task.lastTaskId || task.id)}" data-shift="${shift}" data-day="${day}" title="Unir con la casilla de abajo"></span>
        ` : ""}
    `;
}

// ---------------------------------------------------------------------------
// Selector rapido de la casilla.
//
// El caso normal -sumar o sacar a una persona- no merece un modal: se resuelve
// en un panel flotante anclado a la casilla. El modal completo sigue existiendo
// para lo demas (buscador, libres del dia, comentario) y se alcanza desde aqui.
//
// El nodo cuelga del BODY y no de la casilla porque el tablero scrollea en
// horizontal, y un `overflow-x: auto` recorta tambien en vertical: dentro de la
// grilla el panel quedaria cortado por el borde del tablero.
// ---------------------------------------------------------------------------

function isCellPickerOpen(shift, taskId, keyDay) {
    return Boolean(openCellPicker) &&
        openCellPicker.shift === shift &&
        openCellPicker.taskId === taskId &&
        openCellPicker.keyDay === keyDay;
}

function destroyCellPickerNode() {
    if (unbindCellPicker) {
        unbindCellPicker();
        unbindCellPicker = null;
    }

    if (cellPickerNode) {
        cellPickerNode.remove();
        cellPickerNode = null;
    }
}

function closeCellPicker() {
    openCellPicker = null;
    destroyCellPickerNode();
}

function setCellWorkers(shift, taskId, keyDay, nextWorkers) {
    const assignments = getWeekAssignments();
    const tasks = getTasks();
    const task = tasks.find(item => item.id === taskId);

    if (!task) return;

    const cellKey = assignmentKey(shift, taskId, keyDay);
    const entry = assignments[cellKey] || {};
    const previousWorkers = assignmentWorkers(entry);
    // Sacar a alguien que venia de una regla predefinida no basta con quitarlo
    // de la lista: hay que anotarlo como quitado o la regla lo repone sola.
    const removedDefaults = defaultWorkersForCell(task, keyDay, shift)
        .filter(worker => !nextWorkers.includes(worker));

    persistEntryOrDelete(assignments, cellKey, {
        workers: nextWorkers,
        note: entry.note || "",
        removedDefaults,
        mergedNextTaskId: entry.mergedNextTaskId
    });

    saveWeekAssignments(assignments);
    publishTaskAssignmentChanges(uniqueValues([
        ...previousWorkers,
        ...nextWorkers,
        ...removedDefaults
    ]));
}

function renderCellPickerMarkup(shift, taskId, keyDay) {
    const assignments = getWeekAssignments();
    const tasks = getTasks();
    const task = tasks.find(item => item.id === taskId);

    if (!task) return "";

    const title = mergedGroupTitle(assignments, shift, tasks, taskId, keyDay) ||
        task.title;
    const date = parseKey(keyDay);
    const entry = getCellEntry(assignments, shift, taskId, keyDay);
    const assigned = assignmentWorkers(entry);
    const candidates = candidateProfiles(
        shift,
        keyDay,
        selectedRoles,
        selectedProfessions
    ).filter(profile => !assigned.includes(profile.name));

    return `
        <div class="task-assignment-picker__head">
            <div>
                <strong>${escapeHTML(title)}</strong>
                <span>${escapeHTML(SHIFT_CONFIG[shift].shortLabel)} | ${escapeHTML(formatWeekday(date))} ${escapeHTML(formatShortDate(date))}</span>
            </div>
            <button class="task-assignment-picker__close" type="button" data-picker-close aria-label="Cerrar">&times;</button>
        </div>
        ${
            assigned.length
                ? `
                    <div class="task-assignment-picker__assigned">
                        ${assigned.map(name => `
                            <div class="task-assignment-picker__row">
                                ${renderWorkerAvatar(name)}
                                <span class="task-assignment-picker__name">${escapeHTML(name)}</span>
                                <button class="task-assignment-picker__remove" type="button" data-picker-remove="${escapeHTML(name)}" title="Quitar de la tarea" aria-label="Quitar de la tarea">&times;</button>
                            </div>
                        `).join("")}
                    </div>
                `
                : ""
        }
        <div class="task-assignment-picker__label">Disponibles</div>
        <div class="task-assignment-picker__list">
            ${
                candidates.length
                    ? candidates.map(profile => `
                        <button class="task-assignment-picker__option" type="button" data-picker-add="${escapeHTML(profile.name)}">
                            ${renderWorkerAvatar(profile.name)}
                            <span>
                                <strong>${escapeHTML(profile.name)}</strong>
                                <small>${escapeHTML(profileProfession(profile))} | ${escapeHTML(profileShiftLabel(profile, keyDay))}</small>
                            </span>
                        </button>
                    `).join("")
                    : `<p class="task-assignment-picker__empty">Sin personal disponible para este turno.</p>`
            }
        </div>
        <button class="task-assignment-picker__more" type="button" data-picker-more>M&aacute;s opciones</button>
    `;
}

function positionCellPicker(cell, node) {
    const rect = cell.getBoundingClientRect();
    const margin = 8;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    let left = rect.left;

    if (left + width > window.innerWidth - margin) {
        left = rect.right - width;
    }
    if (left < margin) left = margin;

    let top = rect.bottom + 6;

    // Si abajo no cabe, se abre hacia arriba antes que salirse de la pantalla.
    if (top + height > window.innerHeight - margin) {
        const above = rect.top - height - 6;

        top = above >= margin
            ? above
            : Math.max(margin, window.innerHeight - height - margin);
    }

    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
}

function bindCellPickerEvents(node, { shift, taskId, keyDay }) {
    const dismiss = () => {
        closeCellPicker();
        renderTaskAssignmentsPanel();
    };
    const workersNow = () => assignmentWorkers(
        getCellEntry(getWeekAssignments(), shift, taskId, keyDay)
    );

    node
        .querySelector("[data-picker-close]")
        ?.addEventListener("click", dismiss);

    node
        .querySelectorAll("[data-picker-add]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const name = button.dataset.pickerAdd;
                const current = workersNow();

                if (current.includes(name)) return;

                setCellWorkers(shift, taskId, keyDay, [...current, name]);
                renderTaskAssignmentsPanel();
            });
        });

    node
        .querySelectorAll("[data-picker-remove]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const name = button.dataset.pickerRemove;

                setCellWorkers(
                    shift,
                    taskId,
                    keyDay,
                    workersNow().filter(worker => worker !== name)
                );
                renderTaskAssignmentsPanel();
            });
        });

    node
        .querySelector("[data-picker-more]")
        ?.addEventListener("click", () => {
            closeCellPicker();
            openAssignmentDialog({ shift, taskId, keyDay });
            renderTaskAssignmentsPanel();
        });

    const onPointerDown = event => {
        if (node.contains(event.target)) return;

        // El boton de la casilla alterna el panel por su cuenta. Si lo
        // cerraramos aqui, su click posterior lo volveria a abrir y nunca se
        // podria cerrar con el mismo boton que lo abrio.
        if (
            event.target instanceof Element &&
            event.target.closest("[data-cell-assign]")
        ) {
            return;
        }

        dismiss();
    };
    const onKeyDown = event => {
        if (event.key !== "Escape") return;
        dismiss();
    };
    // Al scrollear el tablero el panel dejaria de apuntar a su casilla, asi que
    // se cierra antes de quedar descolgado. El scroll de su PROPIA lista no
    // cuenta: en fase de captura tambien llega aqui, y cerraria el panel al
    // recorrer los candidatos.
    const onScroll = event => {
        if (event.target instanceof Node && node.contains(event.target)) return;
        dismiss();
    };

    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", onScroll, true);

    unbindCellPicker = () => {
        document.removeEventListener("mousedown", onPointerDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("resize", dismiss);
        window.removeEventListener("scroll", onScroll, true);
    };
}

function syncCellPicker(root) {
    destroyCellPickerNode();

    if (!openCellPicker) return;

    const { shift, taskId, keyDay } = openCellPicker;
    const cell = root.querySelector(
        `[data-task-cell="${taskId}"][data-shift="${shift}"][data-day="${keyDay}"]`
    );

    // Sin casilla -tarea borrada, semana cambiada- o con el panel oculto tras
    // un cambio de vista, el panel flotante no tiene a que anclarse.
    if (!cell || !cell.getBoundingClientRect().width) {
        openCellPicker = null;
        return;
    }

    const markup = renderCellPickerMarkup(shift, taskId, keyDay);

    if (!markup) {
        openCellPicker = null;
        return;
    }

    const node = document.createElement("div");

    node.className = "task-assignment-picker";
    node.innerHTML = markup;
    document.body.appendChild(node);
    cellPickerNode = node;
    positionCellPicker(cell, node);
    bindCellPickerEvents(node, { shift, taskId, keyDay });
}

function renderAssignmentCell(assignments, task, day, holidays, placement) {
    const keyDay = keyFromDate(day);
    const entry = getCellEntry(
        assignments,
        task.shift,
        task.id,
        keyDay
    );
    const assigned = assignmentWorkers(entry);
    const workers = assigned
        .map(profileName => renderWorkerChip(profileName, task, keyDay))
        .filter(Boolean);
    const { dayIndex, taskIndex, size } = placement;
    // Fila y columna explicitas: con una casilla que ocupa varias filas, dejar
    // que la grilla las acomode sola correria las de abajo de lugar.
    const area = `grid-column: ${dayIndex + 2}; grid-row: ${taskIndex + 2} / span ${size};`;
    // "Sin cubrir" mira la asignacion real, no la filtrada: los filtros de
    // estamento y profesion son de vista y no deben inventar huecos.
    const uncovered = !assigned.length;
    const picking = isCellPickerOpen(task.shift, task.id, keyDay);
    const classes = [
        "task-assignment-cell",
        size > 1 ? " task-assignment-cell--merged" : "",
        inhabilClass(day, holidays, "task-assignment-cell--inhabil"),
        uncovered ? " task-assignment-cell--uncovered" : "",
        picking ? " task-assignment-cell--picking" : "",
        onlyUncovered && !uncovered && !picking
            ? " task-assignment-cell--dimmed"
            : ""
    ].join("");

    return `
        <div class="${classes}" style="${area}" data-task-cell="${escapeHTML(task.id)}" data-shift="${escapeHTML(task.shift)}" data-day="${escapeHTML(keyDay)}" data-merge-size="${size}">
            ${size > 1 ? `
                <span class="task-assignment-cell-tag">
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M9.5 14.5 14.5 9.5"></path>
                        <path d="M7 11 5 13a3.5 3.5 0 0 0 5 5l2-2"></path>
                        <path d="M17 13l2-2a3.5 3.5 0 0 0-5-5l-2 2"></path>
                    </svg>
                    Casillas unidas
                </span>
            ` : ""}
            <div class="task-assignment-cell-workers">
                ${workers.join("")}
            </div>
            <button class="task-assignment-add" type="button" data-cell-assign title="${assigned.length ? "Agregar trabajadores" : "Asignar trabajadores"}">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 5.5v13"></path>
                    <path d="M5.5 12h13"></path>
                </svg>
                <span>${assigned.length ? "Agregar" : "Asignar"}</span>
            </button>
            ${entry.note ? `<p>${escapeHTML(entry.note)}</p>` : ""}
            ${renderMergePorts(task, keyDay, placement)}
        </div>
    `;
}

function renderTaskControl(task) {
    return `
        <div class="task-assignment-task-card" draggable="true" data-task-drag="${escapeHTML(task.id)}" data-shift="${escapeHTML(task.shift)}">
            <div class="task-assignment-task-card__top">
                <span class="task-assignment-drag" aria-hidden="true">::</span>
                <span class="task-assignment-task-actions">
                    <button class="ghost-button task-assignment-delete" type="button" data-task-delete="${escapeHTML(task.id)}" title="Eliminar tarea">
                        &times;
                    </button>
                </span>
            </div>
            <input type="text" value="${escapeHTML(task.title)}" data-task-title="${escapeHTML(task.id)}" aria-label="Nombre de tarea">
            <input class="task-assignment-task-detail" type="text" maxlength="${TASK_DETAIL_MAX_LENGTH}" value="${escapeHTML(taskDetailForShift(task, task.shift))}" data-task-detail="${escapeHTML(task.id)}" data-task-detail-shift="${escapeHTML(task.shift)}" placeholder="Detalle" aria-label="Detalle de tarea">
        </div>
    `;
}

function taskForShift(task, shift) {
    return {
        ...task,
        shift
    };
}

function renderTaskAddForm() {
    return `
        <form class="task-assignment-global-task-form" data-task-add-form autocomplete="off">
            <div class="task-assignment-task-form">
                <svg class="task-assignment-task-form__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 5.5v13"></path>
                    <path d="M5.5 12h13"></path>
                </svg>
                <input name="title" type="text" maxlength="80" placeholder="Nueva tarea (ej: Revisar insumos)" aria-label="Nueva tarea">
                <button class="task-assignment-task-add" type="submit">Agregar</button>
            </div>
        </form>
    `;
}

function renderScheduleAttachmentStatus() {
    const attachment = getScheduleAttachment();
    const label = scheduleWeekLabel();

    if (!attachment) return "";

    const updated = attachment.updatedAtISO || attachment.addedAt;
    const detail = updated
        ? new Date(updated).toLocaleString("es-CL", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        })
        : "publicada";
    const ocrLabel = scheduleOcrStatusLabel(attachment.ocr);

    return `
        <span class="task-schedule-attachment-status" title="${escapeHTML(attachment.name)}">
            Programaci&oacute;n ${escapeHTML(label)}: ${escapeHTML(attachment.name)} | ${escapeHTML(detail)} | ${escapeHTML(ocrLabel)}
        </span>
    `;
}

// Permisos, ausencias y cumpleanos del dia, agrupados por motivo. En el
// encabezado interesa el motivo y cuanta gente, no la lista de nombres: los
// nombres siguen completos en la fila de Novedades.
function dayFlags(day) {
    const absences = new Map();

    absenceProfiles(day).forEach(item => {
        absences.set(item.label, (absences.get(item.label) || 0) + 1);
    });

    const flags = [...absences.entries()].map(([label, count]) => ({
        kind: "absence",
        label,
        count
    }));
    const birthdays = birthdayProfiles(day).length;

    if (birthdays) {
        flags.push({
            kind: "birthday",
            label: "Cumpleaños",
            count: birthdays
        });
    }

    return flags;
}

function renderDayFlags(day) {
    const flags = dayFlags(day);

    if (!flags.length) return "";

    const shown = flags.slice(0, 2);
    const rest = flags.length - shown.length;

    return `
        <div class="task-assignment-day-flags">
            ${shown.map(flag => `
                <span class="task-assignment-day-flag task-assignment-day-flag--${escapeHTML(flag.kind)}" title="${escapeHTML(flag.label)}">
                    ${escapeHTML(flag.label)}${flag.count > 1 ? ` ${flag.count}` : ""}
                </span>
            `).join("")}
            ${rest > 0 ? `<span class="task-assignment-day-flag task-assignment-day-flag--rest">+${rest}</span>` : ""}
        </div>
    `;
}

// La barra fina bajo la fecha es la cobertura del turno ese dia: cuantas
// casillas de la columna tienen a alguien. Es lo que el supervisor busca de un
// vistazo antes de mirar casilla por casilla.
function renderDayHead(day, column, holidays, dayIndex, withFlags) {
    const percent = column.total
        ? Math.round((column.done / column.total) * 100)
        : 0;
    const level = percent >= 100
        ? "full"
        : (percent >= 60 ? "mid" : "low");

    return `
        <div class="task-assignment-day-head${inhabilClass(day, holidays, "task-assignment-day-head--inhabil")}" style="grid-column: ${dayIndex + 2}; grid-row: 1;">
            <div class="task-assignment-day-head__top">
                <strong>${escapeHTML(formatWeekdayShort(day))}</strong>
                <span>${escapeHTML(formatShortDate(day))}</span>
                <em class="task-assignment-day-percent task-assignment-day-percent--${level}">${percent}%</em>
            </div>
            <div class="task-assignment-day-meter task-assignment-day-meter--${level}">
                <span style="width: ${percent}%;"></span>
            </div>
            ${withFlags ? renderDayFlags(day) : ""}
        </div>
    `;
}

function renderShiftIcon(shift) {
    if (shift === "night") {
        return `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.4 8.4 0 1 0 20 14.5Z"></path>
            </svg>
        `;
    }

    return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="4"></circle>
            <path d="M12 2.5v2"></path>
            <path d="M12 19.5v2"></path>
            <path d="M4.2 4.2l1.4 1.4"></path>
            <path d="M18.4 18.4l1.4 1.4"></path>
            <path d="M2.5 12h2"></path>
            <path d="M19.5 12h2"></path>
            <path d="M4.2 19.8l1.4-1.4"></path>
            <path d="M18.4 5.6l1.4-1.4"></path>
        </svg>
    `;
}

function renderBoard(shift, tasks, days, assignments, holidays = {}) {
    const config = SHIFT_CONFIG[shift];
    const sectionTasks = tasks.map(task => taskForShift(task, shift));
    // Cada dia se agrupa por su cuenta: la misma tarea puede ir fusionada el
    // sabado y suelta el lunes.
    const columns = days.map(day => {
        const keyDay = keyFromDate(day);
        const groups = columnGroups(assignments, shift, tasks, keyDay);
        const owner = new Map();
        const covered = new Set();
        let done = 0;
        let total = 0;
        let people = 0;
        let uncovered = 0;

        groups.forEach(group => {
            owner.set(group.start, group);

            for (let offset = 1; offset < group.taskIds.length; offset += 1) {
                covered.add(group.start + offset);
            }

            // La casilla fusionada cuenta por las filas que ocupa: si cubre dos
            // tareas, cubrir la casilla cubre las dos.
            const size = group.taskIds.length;
            const workers = assignmentWorkers(
                getCellEntry(assignments, shift, group.taskIds[0], keyDay)
            );

            total += size;
            people += workers.length;

            if (workers.length) {
                done += size;
            } else {
                uncovered += 1;
            }
        });

        return { day, owner, covered, done, total, people, uncovered };
    });
    const totals = columns.reduce(
        (sum, column) => ({
            people: sum.people + column.people,
            uncovered: sum.uncovered + column.uncovered
        }),
        { people: 0, uncovered: 0 }
    );
    const collapsed = Boolean(collapsedShifts[shift]);

    return `
        <section class="task-assignment-section task-assignment-section--${escapeHTML(config.className)}${collapsed ? " is-collapsed" : ""}">
            <div class="task-assignment-section-head">
                <button class="task-assignment-section-toggle" type="button" data-shift-toggle="${escapeHTML(shift)}" aria-expanded="${collapsed ? "false" : "true"}" title="${collapsed ? "Mostrar" : "Ocultar"} ${escapeHTML(config.label)}">
                    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                        <path d="M5 7.5 10 12.5 15 7.5"></path>
                    </svg>
                </button>
                <span class="task-assignment-section-icon">${renderShiftIcon(shift)}</span>
                <strong class="task-assignment-section-title">${escapeHTML(config.label)}</strong>
                <span class="task-assignment-section-metric">
                    ${sectionTasks.length} ${sectionTasks.length === 1 ? "tarea" : "tareas"} &middot; ${totals.people} ${totals.people === 1 ? "asignaci&oacute;n" : "asignaciones"}
                </span>
                ${
                    totals.uncovered
                        ? `
                            <button class="task-assignment-section-gap${onlyUncovered ? " is-on" : ""}" type="button" data-only-uncovered title="Ver solo las casillas sin cubrir">
                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <circle cx="12" cy="12" r="9"></circle>
                                    <path d="M12 8v5"></path>
                                    <path d="M12 16.4h.01"></path>
                                </svg>
                                ${totals.uncovered} sin cubrir
                            </button>
                        `
                        : ""
                }
            </div>
            <div class="task-assignment-board"${collapsed ? " hidden" : ""}>
                <div class="task-assignment-task-head task-assignment-task-head--label" style="grid-column: 1; grid-row: 1;">
                    Tareas
                </div>
                ${columns.map((column, dayIndex) => renderDayHead(
                    column.day,
                    column,
                    holidays,
                    dayIndex,
                    shift === "day"
                )).join("")}
                ${
                    sectionTasks.length
                        ? sectionTasks.map((task, taskIndex) => `
                            <div class="task-assignment-task-cell" style="grid-column: 1; grid-row: ${taskIndex + 2};" data-task-drop="${escapeHTML(task.id)}" data-shift="${escapeHTML(shift)}">
                                ${renderTaskControl(task)}
                            </div>
                            ${columns.map((column, dayIndex) => {
                                if (column.covered.has(taskIndex)) return "";

                                const group = column.owner.get(taskIndex);
                                const size = group?.taskIds.length || 1;

                                return renderAssignmentCell(
                                    assignments,
                                    {
                                        ...task,
                                        lastTaskId: group
                                            ? group.taskIds[size - 1]
                                            : task.id
                                    },
                                    column.day,
                                    holidays,
                                    {
                                        dayIndex,
                                        taskIndex,
                                        size,
                                        taskCount: sectionTasks.length
                                    }
                                );
                            }).join("")}
                        `).join("")
                        : `
                            <div class="task-assignment-empty-row" style="grid-column: 1 / -1; grid-row: 2;">
                                Sin tareas registradas.
                            </div>
                        `
                }
            </div>
        </section>
    `;
}

function renderEventsBoard(days, holidays = {}) {
    return `
        <section class="task-assignment-events">
            <div class="task-assignment-section-head">
                <span class="task-assignment-section-icon task-assignment-section-icon--events">
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M12 3v3"></path>
                        <path d="M6 21h12a1 1 0 0 0 1-1v-6a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v6a1 1 0 0 0 1 1Z"></path>
                        <path d="M5 16c1.6 0 1.6 1.4 3.2 1.4S9.8 16 11.4 16s1.6 1.4 3.2 1.4S16.2 16 17.8 16"></path>
                    </svg>
                </span>
                <strong class="task-assignment-section-title">Novedades de la semana</strong>
                <span class="task-assignment-section-metric">Permisos &middot; Ausencias &middot; Cumplea&ntilde;os</span>
            </div>
            <div class="task-assignment-events-grid">
                <div class="task-assignment-events-head">
                    Registros
                </div>
                ${days.map(day => {
                    const absences = absenceProfiles(day);
                    const birthdays = birthdayProfiles(day);

                    return `
                        <div class="task-assignment-event-day${inhabilClass(day, holidays, "task-assignment-event-day--inhabil")}">
                            <div class="task-assignment-event-date">
                                <strong>${escapeHTML(formatWeekdayShort(day))}</strong>
                                <span>${escapeHTML(formatShortDate(day))}</span>
                            </div>
                            <div class="task-assignment-event-list">
                                ${absences.map(item => `
                                    <span class="task-assignment-event task-assignment-event--absence">
                                        ${escapeHTML(item.profile.name)} | ${escapeHTML(item.label)}
                                    </span>
                                `).join("")}
                                ${birthdays.map(profile => `
                                    <span class="task-assignment-event task-assignment-event--birthday">
                                        ${escapeHTML(profile.name)} | Cumplea&ntilde;os
                                    </span>
                                `).join("")}
                                ${!absences.length && !birthdays.length ? `<span class="task-assignment-event-empty">Sin registros</span>` : ""}
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
        </section>
    `;
}

const MONTH_LABELS = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic"
];

// El rango de la semana es el dato que ordena todo el panel, asi que se escribe
// entero: "24 - 30 ago 2026", y con los dos meses cuando la semana los cruza.
function weekRangeLabel(days) {
    const first = days[0];
    const last = days[days.length - 1];

    if (first.getMonth() === last.getMonth()) {
        return `${first.getDate()} - ${last.getDate()} ${MONTH_LABELS[first.getMonth()]} ${first.getFullYear()}`;
    }

    return `${first.getDate()} ${MONTH_LABELS[first.getMonth()]} - ${last.getDate()} ${MONTH_LABELS[last.getMonth()]} ${last.getFullYear()}`;
}

function isCurrentWeek() {
    return weekKey(currentWeekStart) === weekKey(weekStartMonday(new Date()));
}

// Numero de semana ISO: la semana 1 es la que contiene el primer jueves del
// anio. Va sobre el rango de fechas para no repetirlo con otras palabras.
function isoWeekNumber(date) {
    const thursdayOf = value => {
        const day = new Date(
            value.getFullYear(),
            value.getMonth(),
            value.getDate()
        );

        day.setDate(day.getDate() + 3 - ((day.getDay() + 6) % 7));
        return day;
    };
    const target = thursdayOf(date);
    const firstThursday = thursdayOf(new Date(target.getFullYear(), 0, 4));

    return 1 + Math.round(
        (target.getTime() - firstThursday.getTime()) / (7 * 86400000)
    );
}

function renderShell(holidays = {}) {
    const days = weekDays();
    const tasks = getTasks();
    const assignments = cleanAssignmentsForWeek(days, tasks);
    const roles = availableRoles();
    const professions = availableProfessions();
    const current = isCurrentWeek();

    return `
        <div class="task-assignment-shell">
            <section class="task-assignment-topbar">
                <div class="task-assignment-identity">
                    <span class="task-assignment-identity__icon">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <rect x="3" y="4" width="18" height="17" rx="3"></rect>
                            <path d="M8 2.5v4"></path>
                            <path d="M16 2.5v4"></path>
                            <path d="M3 9h18"></path>
                            <path d="m7 14 1.5 1.5L11 13"></path>
                            <path d="M13.5 14h3.5"></path>
                            <path d="M13.5 17h3.5"></path>
                        </svg>
                    </span>
                    <div>
                        <strong>Asignaci&oacute;n de Tareas</strong>
                        <span>${tasks.length} ${tasks.length === 1 ? "tarea" : "tareas"} &middot; 7 d&iacute;as</span>
                    </div>
                </div>

                <div class="task-assignment-weeknav">
                    <button class="task-assignment-weeknav__step" type="button" data-task-week-prev title="Semana anterior" aria-label="Semana anterior">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="m14 6-6 6 6 6"></path>
                        </svg>
                    </button>
                    <div class="task-assignment-weeknav__label">
                        <span>Semana ${isoWeekNumber(days[0])}</span>
                        <strong>${escapeHTML(weekRangeLabel(days))}</strong>
                    </div>
                    <button class="task-assignment-weeknav__step" type="button" data-task-week-next title="Semana siguiente" aria-label="Semana siguiente">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="m10 6 6 6-6 6"></path>
                        </svg>
                    </button>
                    <button class="task-assignment-weeknav__today${current ? " is-on" : ""}" type="button" data-task-week-current>Hoy</button>
                </div>

                <div class="task-assignment-topbar__actions">
                    <button class="task-assignment-action" type="button" data-task-schedule-preview>Ver programaci&oacute;n</button>
                    <button class="task-assignment-action" type="button" data-task-schedule-attach title="Adjuntar la programaci&oacute;n de la semana">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 1 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 0 1-2.59-2.6l8.49-8.48"></path>
                        </svg>
                        Adjuntar
                    </button>
                    <button class="task-assignment-action task-assignment-action--primary" type="button" data-task-export>
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M12 3v12"></path>
                            <path d="m7.5 10.5 4.5 4.5 4.5-4.5"></path>
                            <path d="M4 20h16"></path>
                        </svg>
                        Excel
                    </button>
                </div>
            </section>

            <section class="task-assignment-controls">
                <div class="task-assignment-view-filters">
                    ${renderMultiSelectFilter("taskRole", roles, selectedRoles, "roles", openTaskFilterGroup, "Estamentos")}
                    ${renderMultiSelectFilter("taskProfession", professions, selectedProfessions, "professions", openTaskFilterGroup, "Profesiones")}
                    <button class="task-assignment-gap-filter${onlyUncovered ? " is-on" : ""}" type="button" data-only-uncovered>
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"></path>
                            <path d="M12 8v5"></path>
                            <path d="M12 16.4h.01"></path>
                        </svg>
                        Solo sin cubrir
                    </button>
                </div>
                ${renderTaskAddForm()}
                ${renderScheduleAttachmentStatus()}
            </section>
            ${renderBoard("day", tasks, days, assignments, holidays)}
            ${renderBoard("night", tasks, days, assignments, holidays)}
            ${renderEventsBoard(days, holidays)}
        </div>
    `;
}

function addTask(title) {
    const cleanTitle = String(title || "").trim();

    if (!cleanTitle) return;

    const tasks = getTasks();
    const order = tasks.length;

    tasks.push({
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        shift: GENERIC_TASK_SHIFT,
        title: cleanTitle,
        details: { day: "", night: "" },
        detail: "",
        order,
        createdAt: new Date().toISOString()
    });

    saveTasks(tasks);
}

function updateTaskTitle(taskId, title) {
    const cleanTitle = String(title || "").trim();

    if (!cleanTitle) return;

    const currentTask = getTasks().find(task => task.id === taskId);
    const affectedWorkers = currentTask
        ? [...taskWorkerNames(currentTask)]
        : [];

    saveTasks(
        getTasks().map(task =>
            task.id === taskId
                ? { ...task, title: cleanTitle }
                : task
        )
    );
    publishTaskAssignmentChanges(affectedWorkers);
}

function updateTaskDetail(taskId, shift, detail) {
    const cleanShift = shift === "night" ? "night" : "day";
    const cleanDetail = cleanTaskDetail(detail);
    const currentTask = getTasks().find(task => task.id === taskId);

    if (
        !currentTask ||
        taskDetailForShift(currentTask, cleanShift) === cleanDetail
    ) {
        return;
    }

    saveTasks(
        getTasks().map(task => {
            if (task.id !== taskId) return task;

            const details = {
                ...normalizeTaskDetails(task),
                [cleanShift]: cleanDetail
            };

            return { ...task, details, detail: details.day };
        })
    );
}

function workerDefaultRule(task, workerName) {
    return taskDefaultRules(task)
        .find(rule => rule.workerName === workerName) || null;
}

function taskWithDefaultWorkerRule(
    task,
    workerName,
    enabled,
    interval,
    anchorKeyDay,
    habilOnly = false
) {
    const defaultWorkerRules = normalizeTaskDefaultRules({
        defaultWorkers: [],
        defaultWorkerRules: [
            ...taskDefaultRules(task)
                .filter(rule => rule.workerName !== workerName),
            ...(enabled
                ? [{
                    workerName,
                    interval,
                    anchorKeyDay,
                    habilOnly: Boolean(habilOnly)
                }]
                : [])
        ]
    });

    return {
        ...task,
        defaultWorkerRules,
        defaultWorkers: uniqueValues(
            defaultWorkerRules.map(rule => rule.workerName)
        )
    };
}

function updateTaskDefaultWorkerRule(
    taskId,
    workerName,
    enabled,
    interval,
    anchorKeyDay,
    habilOnly = false
) {
    const cleanWorker = String(workerName || "").trim();

    if (!cleanWorker) return;

    const task = getTasks().find(item => item.id === taskId);
    const affectedWorkers = task
        ? [...taskWorkerNames(task), cleanWorker]
        : [cleanWorker];

    saveTasks(
        getTasks().map(task =>
            task.id === taskId
                ? taskWithDefaultWorkerRule(
                    task,
                    cleanWorker,
                    enabled,
                    interval,
                    anchorKeyDay,
                    habilOnly
                )
                : task
        )
    );
    publishTaskAssignmentChanges(affectedWorkers);
}

function clearRemovedDefaultForCell(shift, taskId, keyDay, workerName) {
    const assignments = getWeekAssignments();
    const cellKey = assignmentKey(shift, taskId, keyDay);
    const entry = assignments[cellKey];

    if (!entry) return;

    const removedDefaults = assignmentRemovedDefaults(entry)
        .filter(name => name !== workerName);

    if (removedDefaults.length === assignmentRemovedDefaults(entry).length) {
        return;
    }

    persistEntryOrDelete(assignments, cellKey, {
        ...entry,
        removedDefaults
    });
    saveWeekAssignments(assignments);
    publishTaskAssignmentChanges([workerName]);
}

function syncWorkerDefaultForCurrentWeek(taskId, workerName, preserveKeyDay) {
    const task = getTasks().find(item => item.id === taskId);
    const assignments = getWeekAssignments();
    let changed = false;

    if (!task) return;

    SHIFT_TYPES.forEach(shift => {
        weekDays().forEach(day => {
            const keyDay = keyFromDate(day);

            if (keyDay === preserveKeyDay) return;

            const cellKey = assignmentKey(shift, task.id, keyDay);
            const entry = getCellEntry(
                assignments,
                shift,
                task.id,
                keyDay
            );
            const workers = assignmentWorkers(entry);
            const removedDefaults = assignmentRemovedDefaults(entry);
            const shouldApply = defaultWorkersForCell(task, keyDay, shift)
                .includes(workerName);
            const nextWorkers = shouldApply
                ? uniqueValues([...workers, workerName])
                : workers.filter(name => name !== workerName);
            const nextRemovedDefaults = shouldApply
                ? removedDefaults.filter(name => name !== workerName)
                : removedDefaults;

            if (
                nextWorkers.length === workers.length &&
                nextWorkers.every((name, index) => name === workers[index]) &&
                nextRemovedDefaults.length === removedDefaults.length &&
                nextRemovedDefaults.every((name, index) =>
                    name === removedDefaults[index]
                )
            ) return;

            persistEntryOrDelete(assignments, cellKey, {
                ...entry,
                workers: nextWorkers,
                removedDefaults: nextRemovedDefaults
            });
            changed = true;
        });
    });

    if (changed) saveWeekAssignments(assignments);
}

function renderDefaultIntervalOptions(selectedValue, shift) {
    const selected = String(selectedValue || "1");
    const normalOptions = Array.from({ length: 10 }, (_item, index) => {
        const value = String(index + 1);
        const label = value === "1"
            ? "Cada turno"
            : `Cada ${value} turnos`;

        return `
            <option value="${value}" ${value === selected ? "selected" : ""}>
                ${escapeHTML(label)}
            </option>
        `;
    });

    const habilOptions = Array.from(
        { length: MAX_HABIL_INTERVAL },
        (_item, index) => {
            const n = index + 1;
            const value = `h${n}`;
            const label = n === 1
                ? "Cada turno diurno hábil"
                : `Cada ${n} turnos diurno hábil`;

            return `
                <option value="${value}" ${value === selected ? "selected" : ""}>
                    ${escapeHTML(label)}
                </option>
            `;
        }
    );

    return [...normalOptions, ...habilOptions].join("");
}

function deleteTask(taskId) {
    const task = getTasks().find(item => item.id === taskId);
    const affectedWorkers = task ? [...taskWorkerNames(task)] : [];

    saveTasks(getTasks().filter(task => task.id !== taskId));

    const all = getAllAssignments();
    Object.keys(all).forEach(week => {
        Object.keys(all[week] || {}).forEach(cellKey => {
            if (splitAssignmentKey(cellKey).taskId === taskId) {
                delete all[week][cellKey];
            }
        });
    });
    setJSON(ASSIGNMENTS_KEY, all);
    publishTaskAssignmentChanges(affectedWorkers);
}

function reorderTask(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;

    const tasks = getTasks();
    const from = tasks.findIndex(task => task.id === draggedId);
    const to = tasks.findIndex(task => task.id === targetId);

    if (from === -1 || to === -1) return;

    const [moved] = tasks.splice(from, 1);
    tasks.splice(to, 0, moved);
    saveTasks(tasks);
    publishTaskAssignmentChanges();
}

function readDraggedWorker(event) {
    if (draggedWorker) return draggedWorker;

    const raw = event.dataTransfer?.getData(
        "application/x-proturnos-task-worker"
    );

    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);

        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function canMoveWorkerToCell(cell, payload) {
    return Boolean(
        payload?.workerName &&
        payload?.shift === cell.dataset.shift &&
        payload?.keyDay === cell.dataset.day &&
        payload?.taskId !== cell.dataset.taskCell
    );
}

function persistEntryOrDelete(assignments, cellKey, entry) {
    const workers = assignmentWorkers(entry);
    const note = String(entry?.note || "").trim();
    const removedDefaults = assignmentRemovedDefaults(entry);
    // Una casilla fusionada sigue existiendo aunque este vacia: el enlace vive
    // en ella y borrarla desharia la fusion sola.
    const mergedNextTaskId = String(entry?.mergedNextTaskId || "");

    if (workers.length || note || removedDefaults.length || mergedNextTaskId) {
        assignments[cellKey] = {
            workers,
            note,
            removedDefaults,
            ...(mergedNextTaskId ? { mergedNextTaskId } : {})
        };
        return;
    }

    delete assignments[cellKey];
}

function moveWorkerAssignment(payload, targetCell) {
    if (!canMoveWorkerToCell(targetCell, payload)) return false;

    const assignments = getWeekAssignments();
    const tasks = getTasks();
    const sourceTask = tasks.find(task => task.id === payload.taskId);
    const fromKey = assignmentKey(
        payload.shift,
        payload.taskId,
        payload.keyDay
    );
    const toKey = assignmentKey(
        targetCell.dataset.shift,
        targetCell.dataset.taskCell,
        targetCell.dataset.day
    );
    const fromEntry = getCellEntry(
        assignments,
        payload.shift,
        payload.taskId,
        payload.keyDay
    );
    const fromWorkers = assignmentWorkers(fromEntry);

    if (!fromWorkers.includes(payload.workerName)) return false;

    const toEntry = getCellEntry(
        assignments,
        targetCell.dataset.shift,
        targetCell.dataset.taskCell,
        targetCell.dataset.day
    );
    const toWorkers = assignmentWorkers(toEntry);
    const sourceRemovedDefaults = assignmentRemovedDefaults(fromEntry);
    const sourceDefaults = sourceTask
        ? defaultWorkersForCell(sourceTask, payload.keyDay, payload.shift)
        : [];
    const nextSourceRemovedDefaults = sourceDefaults.includes(
        payload.workerName
    )
        ? uniqueValues([...sourceRemovedDefaults, payload.workerName])
        : sourceRemovedDefaults;

    persistEntryOrDelete(assignments, fromKey, {
        ...fromEntry,
        workers: fromWorkers.filter(name => name !== payload.workerName),
        removedDefaults: nextSourceRemovedDefaults
    });

    persistEntryOrDelete(assignments, toKey, {
        ...toEntry,
        workers: toWorkers.includes(payload.workerName)
            ? toWorkers
            : [...toWorkers, payload.workerName],
        removedDefaults: assignmentRemovedDefaults(toEntry)
            .filter(name => name !== payload.workerName)
    });

    saveWeekAssignments(assignments);
    publishTaskAssignmentChanges([payload.workerName]);
    return true;
}

function openWorkerDefaultDialog({ taskId, workerName, shift, keyDay }) {
    const task = getTasks().find(item => item.id === taskId);
    const cleanWorker = String(workerName || "").trim();

    if (!task || !cleanWorker) return;

    const date = parseKey(keyDay);
    const rule = workerDefaultRule(task, cleanWorker);
    const backdrop = document.createElement("div");
    const close = () => backdrop.remove();

    backdrop.className = "task-assignment-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="task-assignment-dialog task-assignment-worker-default-dialog">
            <div class="task-assignment-dialog__head">
                <div>
                    <h3>${escapeHTML(cleanWorker)}</h3>
                    <span>${escapeHTML(task.title)} | ${escapeHTML(formatWeekday(date))} ${escapeHTML(formatShortDate(date))}</span>
                </div>
                <button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">&times;</button>
            </div>
            <label class="task-assignment-worker-default-toggle">
                <input type="checkbox" data-worker-default-enabled checked>
                <span>Predefinido para esta tarea</span>
            </label>
            <label class="task-assignment-worker-default-field">
                <span>Periodicidad</span>
                <select data-worker-default-interval>
                    ${renderDefaultIntervalOptions(
                        encodeIntervalValue(rule?.interval || 1, rule?.habilOnly === true),
                        shift
                    )}
                </select>
            </label>
            <div class="task-assignment-dialog__actions">
                <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
                <button class="primary-button" type="button" data-dialog-save>Guardar</button>
            </div>
        </section>
    `;

    document.body.appendChild(backdrop);

    const enabledInput = backdrop.querySelector("[data-worker-default-enabled]");
    const intervalSelect = backdrop.querySelector("[data-worker-default-interval]");
    const syncState = () => {
        intervalSelect.disabled = !enabledInput.checked;
    };

    enabledInput.addEventListener("change", syncState);
    syncState();

    backdrop.querySelector("[data-dialog-close]")?.addEventListener("click", close);
    backdrop.querySelector("[data-dialog-cancel]")?.addEventListener("click", close);
    backdrop.querySelector("[data-dialog-save]")?.addEventListener("click", () => {
        const parsedInterval = parseIntervalValue(intervalSelect.value);

        updateTaskDefaultWorkerRule(
            task.id,
            cleanWorker,
            enabledInput.checked,
            parsedInterval.interval,
            keyDay,
            parsedInterval.habilOnly
        );
        syncWorkerDefaultForCurrentWeek(task.id, cleanWorker, keyDay);

        if (enabledInput.checked) {
            clearRemovedDefaultForCell(
                shift,
                task.id,
                keyDay,
                cleanWorker
            );
        }

        close();
        renderTaskAssignmentsPanel();
    });
}

/**
 * Dialogo para publicar la programacion de una semana.
 *
 * Recibe la semana porque ahora se abre desde dos lugares: la pantalla de
 * Tareas -donde manda la semana que se esta viendo alli- y el widget de
 * inicio, que abre la semana que el supervisor tiene a la vista en el modal.
 */
export function openScheduleAttachmentDialog(weekStart = currentWeekStart) {
    const dialogWeekStart = new Date(weekStart);
    const current = getScheduleAttachment(dialogWeekStart);
    const weekLabel = scheduleWeekLabel(dialogWeekStart);
    const linkedCount = getWorkerAppLinks()
        .filter(item => item.uid && item.profile)
        .length;
    const backdrop = document.createElement("div");

    backdrop.className = "task-assignment-dialog-backdrop";
    document.body.appendChild(backdrop);

    const close = () => {
        backdrop.remove();
    };

    backdrop.innerHTML = `
        <section class="task-assignment-dialog task-schedule-attachment-dialog">
            <div class="task-assignment-dialog__head">
                <div>
                    <h3>Adjuntar Programaci&oacute;n</h3>
                    <span>${escapeHTML(weekLabel)} | ${linkedCount || 0} trabajador(es) enlazado(s)</span>
                </div>
                <button class="ghost-button" type="button" data-close-schedule-attachment aria-label="Cerrar">&times;</button>
            </div>
            <form data-schedule-attachment-form class="task-schedule-attachment-form">
                <label class="task-schedule-attachment-field">
                    <span>Programaci&oacute;n (Excel)</span>
                    <input type="file" name="scheduleImage" accept="${SCHEDULE_WORKBOOK_ACCEPT}" required>
                    <small>Formato aceptado: Excel (.xlsx). La tabla se arma sola desde la planilla. M&aacute;ximo 10 MB.</small>
                </label>
                ${current ? `
                    <div class="task-schedule-current">
                        <strong>Publicada para esta semana</strong>
                        <span>${escapeHTML(current.name)}</span>
                        ${current.grid ? `
                            <span class="task-schedule-current__ocr">Tabla le&iacute;da del Excel &middot; ${current.grid.rows?.length || 0} filas</span>
                        ` : `
                            <span class="task-schedule-current__ocr">Estado OCR: ${escapeHTML(scheduleOcrStatusLabel(current.ocr))}</span>
                            <button class="secondary-button task-schedule-retry-ocr" type="button" data-retry-schedule-ocr>Reintentar OCR</button>
                        `}
                    </div>
                ` : ""}
                <div class="task-assignment-dialog__actions">
                    ${current ? `<button class="ghost-button" type="button" data-remove-schedule-attachment>Quitar semana</button>` : ""}
                    <button class="secondary-button" type="button" data-close-schedule-attachment>Cancelar</button>
                    <button class="primary-button" type="submit">Publicar programaci&oacute;n</button>
                </div>
            </form>
        </section>
    `;

    backdrop
        .querySelectorAll("[data-close-schedule-attachment]")
        .forEach(button => {
            button.addEventListener("click", close);
        });

    backdrop
        .querySelector("[data-remove-schedule-attachment]")
        ?.addEventListener("click", async () => {
            const previous = getScheduleAttachment(dialogWeekStart);

            if (
                !await showConfirm(
                    `La programacion de ${weekLabel} dejara de mostrarse en la PWA del trabajador.`,
                    {
                        title: "Quitar programacion",
                        tone: "danger",
                        confirmText: "Quitar",
                        destructive: true
                    }
                )
            ) {
                return;
            }

            clearScheduleAttachment(dialogWeekStart);
            await publishScheduleAttachmentChanges(dialogWeekStart);
            if (previous?.storagePath) {
                deleteStoredAttachment(previous).catch(error => {
                    console.warn(
                        "No se pudo eliminar la programacion anterior.",
                        error
                    );
                });
            }
            close();
            renderTaskAssignmentsPanel();
        });

    backdrop
        .querySelector("[data-retry-schedule-ocr]")
        ?.addEventListener("click", async event => {
            const button = event.currentTarget;
            const original = button.textContent;

            button.disabled = true;
            button.textContent = "Leyendo OCR...";

            try {
                const ocr = await reprocessScheduleAttachmentOcr(dialogWeekStart);
                const status = String(ocr?.status || "");

                if (status === "completed") {
                    alert(
                        "OCR completado. La programacion se reenvio a la PWA en modo texto."
                    );
                } else if (status === "empty") {
                    alert(
                        "El OCR se ejecuto pero no detecto texto en la imagen."
                    );
                } else {
                    alert(
                        `No se pudo completar el OCR (${status || "error"}).` +
                        (ocr?.error ? `\n\n${ocr.error}` : "")
                    );
                }

                close();
                renderTaskAssignmentsPanel();
            } catch (error) {
                console.warn(
                    "No se pudo reintentar el OCR de la programacion.",
                    error
                );
                alert(error?.message || "No se pudo reintentar el OCR.");
                button.disabled = false;
                button.textContent = original;
            }
        });

    backdrop
        .querySelector("[data-schedule-attachment-form]")
        ?.addEventListener("submit", async event => {
            event.preventDefault();

            const form = event.currentTarget;
            const submit = form.querySelector("button[type='submit']");
            const file = form.elements.scheduleImage?.files?.[0];
            const previous = getScheduleAttachment(dialogWeekStart);

            try {
                validateScheduleWorkbook(file);
                submit.disabled = true;
                submit.textContent = "Publicando programación...";

                await assertScheduleAttachmentUploadAccess();

                const attachment = await createScheduleWorkbookAttachment(
                    file,
                    dialogWeekStart,
                    {
                        onAskSheet: sheets => askScheduleSheet(sheets, weekLabel)
                    }
                );

                // Cancelo al elegir la hoja: se deja el dialogo como estaba.
                if (!attachment) {
                    submit.disabled = false;
                    submit.textContent = "Publicar programación";
                    return;
                }

                saveScheduleAttachment({
                    ...attachment,
                    updatedAtISO: new Date().toISOString()
                }, dialogWeekStart);
                await publishScheduleAttachmentChanges(dialogWeekStart);

                if (
                    previous?.storagePath &&
                    previous.storagePath !== attachment.storagePath
                ) {
                    deleteStoredAttachment(previous).catch(error => {
                        console.warn(
                            "No se pudo eliminar la programacion reemplazada.",
                            error
                        );
                    });
                }

                close();
                renderTaskAssignmentsPanel();
            } catch (error) {
                console.warn(
                    "No se pudo publicar la programacion adjunta.",
                    error?.cause || error
                );
                alert(scheduleUploadPermissionMessage(error));
                submit.disabled = false;
                submit.textContent = "Publicar programación";
            }
        });

    backdrop.querySelector("input[type='file']")?.focus();
}

// Dos puntos se pueden unir solo si son de la misma columna y de casillas
// pegadas: uno tiene que ser el borde de abajo de una y el otro el borde de
// arriba de la que sigue en el catalogo. Da igual desde cual se arrastre.
function mergePairFor(from, to) {
    if (!from || !to) return null;
    if (from.shift !== to.shift || from.day !== to.day) return null;
    if (from.mergePort === to.mergePort) return null;

    const upper = from.mergePort === "bottom" ? from : to;
    const lower = from.mergePort === "bottom" ? to : from;
    const tasks = getTasks();
    const upperIndex = tasks.findIndex(task => task.id === upper.mergeTask);

    if (upperIndex === -1) return null;
    if (tasks[upperIndex + 1]?.id !== lower.mergeTask) return null;

    return {
        shift: upper.shift,
        keyDay: upper.day,
        upperTaskId: upper.mergeTask
    };
}

async function confirmMergeCells(pair) {
    if (!pair) return;

    if (
        !await showConfirm(
            "Las dos casillas quedaran unidas y compartiran los mismos trabajadores.",
            {
                title: "Combinar casillas",
                confirmText: "Combinar"
            }
        )
    ) {
        return;
    }

    if (mergeCellWithNext(pair.shift, pair.keyDay, pair.upperTaskId)) {
        renderTaskAssignmentsPanel();
    }
}

async function confirmSplitCells(shift, keyDay, taskId) {
    if (
        !await showConfirm(
            "Las casillas se separaran y todos los trabajadores quedaran en la de arriba.",
            {
                title: "Separar casillas",
                confirmText: "Separar"
            }
        )
    ) {
        return;
    }

    if (splitCellGroup(shift, keyDay, taskId)) {
        renderTaskAssignmentsPanel();
    }
}

// La casilla como blanco: se prueba contra sus dos bordes, porque cual de los
// dos toca depende de si el punto que viene en vuelo es el de arriba o el de
// abajo.
function mergePortPairForCell(cell) {
    const size = Number(cell.dataset.mergeSize) || 1;
    const tasks = getTasks();
    const firstIndex = tasks.findIndex(
        task => task.id === cell.dataset.taskCell
    );

    if (firstIndex === -1) return null;

    const base = {
        shift: cell.dataset.shift,
        day: cell.dataset.day
    };

    return mergePairFor(draggedMergePort, {
        ...base,
        mergePort: "top",
        mergeTask: cell.dataset.taskCell
    }) || mergePairFor(draggedMergePort, {
        ...base,
        mergePort: "bottom",
        mergeTask: tasks[firstIndex + size - 1]?.id || cell.dataset.taskCell
    });
}

function bindMergeEvents(root) {
    root
        .querySelectorAll("[data-merge-port]")
        .forEach(port => {
            port.ondragstart = event => {
                // El chip de trabajador y la tarjeta de tarea tambien son
                // arrastrables: sin esto el gesto lo tomaria la de mas afuera.
                event.stopPropagation();
                draggedMergePort = { ...port.dataset };
                event.dataTransfer.effectAllowed = "link";
                event.dataTransfer.setData("text/plain", "merge-port");
                port.classList.add("is-dragging");
            };
            port.ondragend = () => {
                draggedMergePort = null;
                port.classList.remove("is-dragging");
                root
                    .querySelectorAll(".is-merge-target")
                    .forEach(node => node.classList.remove("is-merge-target"));
            };
            port.ondragover = event => {
                if (!mergePairFor(draggedMergePort, port.dataset)) return;

                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "link";
                port.classList.add("is-merge-target");
            };
            port.ondragleave = () => {
                port.classList.remove("is-merge-target");
            };
            port.ondrop = event => {
                const pair = mergePairFor(draggedMergePort, port.dataset);

                port.classList.remove("is-merge-target");

                if (!pair) return;

                event.preventDefault();
                event.stopPropagation();
                draggedMergePort = null;
                void confirmMergeCells(pair);
            };
        });

    root
        .querySelectorAll("[data-merge-split]")
        .forEach(line => {
            line.onclick = () => {
                void confirmSplitCells(
                    line.dataset.shift,
                    line.dataset.day,
                    line.dataset.mergeSplit
                );
            };
        });
}

function bindShellEvents(root) {
    const roleOptions = availableRoles();
    const professionOptions = availableProfessions();

    root.querySelector("[data-task-week-prev]")?.addEventListener("click", () => {
        currentWeekStart = addDays(currentWeekStart, -7);
        renderTaskAssignmentsPanel();
    });
    root.querySelector("[data-task-week-next]")?.addEventListener("click", () => {
        currentWeekStart = addDays(currentWeekStart, 7);
        renderTaskAssignmentsPanel();
    });
    root.querySelector("[data-task-week-current]")?.addEventListener("click", () => {
        currentWeekStart = weekStartMonday(new Date());
        renderTaskAssignmentsPanel();
    });
    root
        .querySelectorAll("[data-shift-toggle]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const shift = button.dataset.shiftToggle;

                collapsedShifts = {
                    ...collapsedShifts,
                    [shift]: !collapsedShifts[shift]
                };
                closeCellPicker();
                renderTaskAssignmentsPanel();
            });
        });

    root
        .querySelectorAll("[data-only-uncovered]")
        .forEach(button => {
            button.addEventListener("click", () => {
                onlyUncovered = !onlyUncovered;
                closeCellPicker();
                renderTaskAssignmentsPanel();
            });
        });

    bindMergeEvents(root);
    root.querySelector("[data-task-export]")?.addEventListener("click", exportTaskAssignmentsExcel);
    root.querySelector("[data-task-schedule-preview]")?.addEventListener("click", async () => {
        const { openTaskSchedulePreview } = await import("./taskSchedulePreview.js");

        openTaskSchedulePreview();
    });
    root.querySelector("[data-task-schedule-attach]")?.addEventListener("click", openScheduleAttachmentDialog);

    root
        .querySelectorAll("[data-task-add-form]")
        .forEach(form => {
            form.onsubmit = event => {
                event.preventDefault();
                addTask(new FormData(form).get("title"));
                renderTaskAssignmentsPanel();
            };
        });

    root
        .querySelectorAll("[data-task-title]")
        .forEach(input => {
            input.onchange = () => {
                updateTaskTitle(input.dataset.taskTitle, input.value);
                renderTaskAssignmentsPanel();
            };
        });

    root
        .querySelectorAll("[data-task-detail]")
        .forEach(input => {
            input.onchange = () => {
                updateTaskDetail(
                    input.dataset.taskDetail,
                    input.dataset.taskDetailShift,
                    input.value
                );
                input.value = cleanTaskDetail(input.value);
            };
        });

    root
        .querySelectorAll("[data-task-delete]")
        .forEach(button => {
            button.onclick = async () => {
                if (
                    !await showConfirm(
                        "Se eliminará la tarea junto con todas sus asignaciones.",
                        {
                            title: "Eliminar tarea",
                            tone: "danger",
                            confirmText: "Eliminar",
                            destructive: true
                        }
                    )
                ) {
                    return;
                }
                deleteTask(button.dataset.taskDelete);
                renderTaskAssignmentsPanel();
            };
        });

    root
        .querySelectorAll(".task-assignment-multiselect[data-filter-group]")
        .forEach(control => {
            syncMultiSelectSelectAll(control);
            control.addEventListener("toggle", () => {
                if (control.open) {
                    openTaskFilterGroup = control.dataset.filterGroup;
                } else if (
                    openTaskFilterGroup === control.dataset.filterGroup
                ) {
                    openTaskFilterGroup = "";
                }
            });
        });

    if (unbindTaskFilterOutside) {
        unbindTaskFilterOutside();
    }
    unbindTaskFilterOutside = bindMultiSelectOutsideClose(
        root,
        () => {
            openTaskFilterGroup = "";
        }
    );

    root
        .querySelectorAll("[data-task-drag]")
        .forEach(card => {
            card.ondragstart = event => {
                draggedWorker = null;
                draggedTask = {
                    id: card.dataset.taskDrag,
                    shift: card.dataset.shift
                };
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", draggedTask.id);
            };
            card.ondragend = () => {
                draggedTask = null;
            };
        });

    root
        .querySelectorAll("[data-task-drop]")
        .forEach(target => {
            target.ondragover = event => {
                if (
                    !draggedTask ||
                    draggedTask.shift !== target.dataset.shift
                ) {
                    return;
                }

                event.preventDefault();
                target.classList.add("is-drag-over");
            };
            target.ondragleave = () => {
                target.classList.remove("is-drag-over");
            };
            target.ondrop = event => {
                if (
                    !draggedTask ||
                    draggedTask.shift !== target.dataset.shift
                ) {
                    return;
                }

                event.preventDefault();
                target.classList.remove("is-drag-over");
                reorderTask(
                    draggedTask?.id || event.dataTransfer.getData("text/plain"),
                    target.dataset.taskDrop
                );
                renderTaskAssignmentsPanel();
            };
        });

    root
        .querySelectorAll("[data-worker-drag]")
        .forEach(chip => {
            chip.ondragstart = event => {
                if (
                    event.target instanceof Element &&
                    event.target.closest("[data-worker-default-config]")
                ) {
                    event.preventDefault();
                    return;
                }

                draggedTask = null;
                draggedWorker = {
                    workerName: chip.dataset.workerDrag,
                    taskId: chip.dataset.workerTask,
                    shift: chip.dataset.workerShift,
                    keyDay: chip.dataset.workerDay
                };
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                    "application/x-proturnos-task-worker",
                    JSON.stringify(draggedWorker)
                );
                event.dataTransfer.setData(
                    "text/plain",
                    draggedWorker.workerName
                );
                chip.classList.add("is-dragging");
            };
            chip.ondragend = () => {
                chip.classList.remove("is-dragging");
                draggedWorker = null;
            };
        });

    root
        .querySelectorAll("[data-worker-default-config]")
        .forEach(button => {
            button.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                openWorkerDefaultDialog({
                    workerName: button.dataset.workerDefaultConfig,
                    taskId: button.dataset.workerTask,
                    shift: button.dataset.workerShift,
                    keyDay: button.dataset.workerDay
                });
            });
            button.addEventListener("dragstart", event => {
                event.preventDefault();
            });
        });

    root
        .querySelectorAll("[data-task-cell]")
        .forEach(cell => {
            cell.querySelector("[data-cell-assign]")?.addEventListener(
                "click",
                event => {
                    event.stopPropagation();

                    const target = {
                        shift: cell.dataset.shift,
                        taskId: cell.dataset.taskCell,
                        keyDay: cell.dataset.day
                    };
                    const wasOpen = isCellPickerOpen(
                        target.shift,
                        target.taskId,
                        target.keyDay
                    );

                    closeCellPicker();
                    if (!wasOpen) openCellPicker = target;
                    renderTaskAssignmentsPanel();
                }
            );
            cell.ondragover = event => {
                // El punto se comprueba PRIMERO: mientras se arrastra uno no
                // hay trabajador en vuelo, y acertarle al circulo solo seria
                // pedir demasiada punteria.
                if (draggedMergePort) {
                    if (!mergePortPairForCell(cell)) return;

                    event.preventDefault();
                    event.dataTransfer.dropEffect = "link";
                    cell.classList.add("is-merge-target");
                    return;
                }

                if (!canMoveWorkerToCell(cell, draggedWorker)) return;

                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                cell.classList.add("is-drag-over");
            };
            cell.ondragleave = () => {
                cell.classList.remove("is-drag-over");
                cell.classList.remove("is-merge-target");
            };
            cell.ondrop = event => {
                cell.classList.remove("is-merge-target");

                if (draggedMergePort) {
                    const pair = mergePortPairForCell(cell);

                    if (!pair) return;

                    event.preventDefault();
                    draggedMergePort = null;
                    void confirmMergeCells(pair);
                    return;
                }

                const payload = readDraggedWorker(event);

                cell.classList.remove("is-drag-over");

                if (!canMoveWorkerToCell(cell, payload)) return;

                event.preventDefault();

                if (moveWorkerAssignment(payload, cell)) {
                    draggedWorker = null;
                    renderTaskAssignmentsPanel();
                }
            };
        });

    root
        .querySelector("[data-filter-group='roles']")
        ?.addEventListener("change", event => {
            handleMultiSelectSelectAllChange(event);
            openTaskFilterGroup = "roles";
            selectedRoles = selectedValues(
                root,
                "[name='taskRole']",
                roleOptions
            );
            renderTaskAssignmentsPanel();
        });

    root
        .querySelector("[data-filter-group='professions']")
        ?.addEventListener("change", event => {
            handleMultiSelectSelectAllChange(event);
            openTaskFilterGroup = "professions";
            selectedProfessions = selectedValues(
                root,
                "[name='taskProfession']",
                professionOptions
            );
            renderTaskAssignmentsPanel();
        });
}

// Copia la asignacion recien guardada a los dias que quedan de la semana.
//
// Es deliberadamente conservadora: solo escribe donde no hay fusion -el grupo
// fusionado tiene su propia casilla duena y su propio criterio- y solo con las
// personas que ese dia estan realmente en el turno y sin permiso. Repetir a
// ciegas terminaria asignando a alguien que ese dia libra o esta con licencia.
function repeatAssignmentForWeek(
    assignments,
    tasks,
    shift,
    taskId,
    keyDay,
    workers
) {
    const days = weekDays();
    const startIndex = days.findIndex(day => keyFromDate(day) === keyDay);
    const task = tasks.find(item => item.id === taskId);

    if (startIndex < 0 || !task) return [];

    const touched = [];

    days.slice(startIndex + 1).forEach(day => {
        const nextKey = keyFromDate(day);
        const group = groupForTask(assignments, shift, tasks, taskId, nextKey);

        if (group && group.taskIds.length > 1) return;

        const available = workers.filter(name => {
            const profile = profileByName(name);

            return profile && isAvailableForShift(profile, nextKey, shift);
        });

        if (!available.length) return;

        const cellKey = assignmentKey(shift, taskId, nextKey);
        const entry = assignments[cellKey] || {};

        persistEntryOrDelete(assignments, cellKey, {
            workers: available,
            note: entry.note || "",
            removedDefaults: defaultWorkersForCell(task, nextKey, shift)
                .filter(worker => !available.includes(worker)),
            mergedNextTaskId: entry.mergedNextTaskId
        });
        touched.push(...available, ...assignmentWorkers(entry));
    });

    return touched;
}

// Cuando el candidato ya esta en otra tarea del mismo turno y dia, el nombre de
// esa tarea vale mas que un simple "ocupado": dice de donde habria que sacarlo.
function workerOtherTaskTitle(
    assignments,
    tasks,
    workerName,
    shift,
    keyDay,
    taskId
) {
    const hit = Object.entries(assignments).find(([cellKey, entry]) => {
        const parts = splitAssignmentKey(cellKey);

        return parts.shift === shift &&
            parts.keyDay === keyDay &&
            parts.taskId !== taskId &&
            assignmentWorkers(entry).includes(workerName);
    });

    if (!hit) return "";

    const otherId = splitAssignmentKey(hit[0]).taskId;

    return tasks.find(task => task.id === otherId)?.title || "En otra tarea";
}

function renderDialogCandidate(
    profile,
    assignments,
    shift,
    keyDay,
    taskId,
    selectedWorkers,
    tasks = getTasks()
) {
    const otherTask = workerOtherTaskTitle(
        assignments,
        tasks,
        profile.name,
        shift,
        keyDay,
        taskId
    );
    const checked = selectedWorkers.has(profile.name);

    return `
        <label class="task-assignment-candidate ${otherTask ? "is-busy" : "is-free"}${checked ? " is-checked" : ""}">
            <input type="checkbox" value="${escapeHTML(profile.name)}" ${checked ? "checked" : ""}>
            ${renderWorkerAvatar(profile.name)}
            <span>
                <strong>${escapeHTML(profile.name)}</strong>
                <small>${escapeHTML(profile.estamento || "Sin estamento")} | ${escapeHTML(profileProfession(profile))}</small>
            </span>
            <em class="task-assignment-candidate__state">${escapeHTML(otherTask || profileShiftLabel(profile, keyDay))}</em>
        </label>
    `;
}

function mergedGroupTitle(assignments, shift, tasks, taskId, keyDay) {
    const group = groupForTask(assignments, shift, tasks, taskId, keyDay);

    if (!group || group.taskIds.length < 2) return "";

    return group.taskIds
        .map(id => tasks.find(task => task.id === id)?.title || "")
        .filter(Boolean)
        .join(" + ");
}

function openAssignmentDialog({ shift, taskId, keyDay }) {
    const tasks = getTasks();
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;

    const assignments = getWeekAssignments();
    const dialogTitle = mergedGroupTitle(
        assignments,
        shift,
        tasks,
        taskId,
        keyDay
    ) || task.title;
    const cellKey = assignmentKey(shift, taskId, keyDay);
    const entry = assignments[cellKey] || { workers: [], note: "" };
    const selectedWorkers = new Set(assignmentWorkers(entry));
    const professions = availableProfessions();
    let dialogProfessions = null;
    let openDialogFilterGroup = "";
    let unbindDialogFilterOutside = null;
    let workerSearch = "";
    let includeWorkersWithoutShift = false;
    let repeatRestOfWeek = false;
    let note = entry.note || "";
    const backdrop = document.createElement("div");

    backdrop.className = "task-assignment-dialog-backdrop";
    document.body.appendChild(backdrop);

    const close = () => {
        if (unbindDialogFilterOutside) {
            unbindDialogFilterOutside();
            unbindDialogFilterOutside = null;
        }
        backdrop.remove();
    };
    const collectDialogFilters = () => {
        dialogProfessions = selectedValues(
            backdrop,
            "[name='dialogTaskProfession']",
            professions
        );
    };
    const collectVisibleWorkers = () => {
        backdrop
            .querySelectorAll("[data-candidate-list] input")
            .forEach(input => {
                if (input.checked) {
                    selectedWorkers.add(input.value);
                } else {
                    selectedWorkers.delete(input.value);
                }
            });
        note = backdrop.querySelector("[data-task-note]")?.value || "";
        workerSearch = backdrop
            .querySelector("[data-dialog-worker-search]")
            ?.value || "";
        repeatRestOfWeek = Boolean(
            backdrop
                .querySelector("[data-dialog-repeat-week]")
                ?.checked
        );
    };
    const selectedStripMarkup = () => `
        <span class="task-assignment-dialog__selected-label">En esta tarea &middot; ${selectedWorkers.size}</span>
        <div class="task-assignment-dialog__chips">
            ${
                selectedWorkers.size
                    ? [...selectedWorkers].map(name => `
                        <span class="task-assignment-dialog__chip">
                            ${renderWorkerAvatar(name)}
                            <span>${escapeHTML(name)}</span>
                            <button type="button" data-selected-drop="${escapeHTML(name)}" title="Quitar de la tarea" aria-label="Quitar de la tarea">&times;</button>
                        </span>
                    `).join("")
                    : `<span class="task-assignment-dialog__chips-empty">Nadie asignado todav&iacute;a</span>`
            }
        </div>
    `;
    // La cabecera de seleccionados y el contador del boton se refrescan solos
    // al marcar una casilla: repintar el dialogo entero perderia el foco y el
    // scroll de la lista.
    const syncSelection = () => {
        const strip = backdrop.querySelector("[data-selected-strip]");

        if (strip) {
            strip.innerHTML = selectedStripMarkup();
            bindSelectedChips();
        }

        const save = backdrop.querySelector("[data-dialog-save]");

        if (save) save.textContent = `Guardar (${selectedWorkers.size})`;

        backdrop
            .querySelectorAll("[data-candidate-list] .task-assignment-candidate")
            .forEach(label => {
                label.classList.toggle(
                    "is-checked",
                    Boolean(label.querySelector("input")?.checked)
                );
            });
    };
    const bindSelectedChips = () => {
        backdrop
            .querySelectorAll("[data-selected-drop]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    const name = button.dataset.selectedDrop;

                    selectedWorkers.delete(name);
                    [...backdrop.querySelectorAll("[data-candidate-list] input")]
                        .filter(input => input.value === name)
                        .forEach(input => {
                            input.checked = false;
                        });
                    syncSelection();
                });
            });
    };
    const render = () => {
        const allCandidates = candidateProfiles(
            shift,
            keyDay,
            null,
            dialogProfessions,
            { includeWorkersWithoutShift }
        );
        const candidates = allCandidates.filter(profile =>
            profileMatchesWorkerSearch(
                profile,
                keyDay,
                workerSearch
            )
        );
        const date = parseKey(keyDay);

        backdrop.innerHTML = `
            <section class="task-assignment-dialog">
                <div class="task-assignment-dialog__head">
                    <div>
                        <h3>
                            ${escapeHTML(dialogTitle)}
                            <em class="task-assignment-shift-badge task-assignment-shift-badge--${escapeHTML(shift)}">${escapeHTML(SHIFT_CONFIG[shift].shortLabel)}</em>
                        </h3>
                        <span>${escapeHTML(formatWeekday(date))} ${escapeHTML(formatShortDate(date))}</span>
                    </div>
                    <button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">&times;</button>
                </div>
                <div class="task-assignment-dialog__selected" data-selected-strip>
                    ${selectedStripMarkup()}
                </div>
                <div class="task-assignment-dialog__filters">
                    <form class="profile-viewer task-assignment-worker-search" data-dialog-worker-search-form autocomplete="off">
                        <div class="profile-viewer__field">
                            <input
                                data-dialog-worker-search
                                type="search"
                                list="taskAssignmentWorkerOptions"
                                placeholder="Buscar por nombre o profesi&oacute;n"
                                value="${escapeHTML(workerSearch)}"
                            >
                            <button class="profile-viewer__button" type="submit" aria-label="Buscar trabajador">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="11" cy="11" r="7"></circle>
                                    <path d="M21 21l-4.35-4.35"></path>
                                </svg>
                            </button>
                        </div>
                        <datalist id="taskAssignmentWorkerOptions">
                            ${renderDialogWorkerOptions(allCandidates)}
                        </datalist>
                    </form>
                    <div class="task-assignment-scope">
                        <button class="task-assignment-scope__option${includeWorkersWithoutShift ? "" : " is-on"}" type="button" data-dialog-scope="shift">Del turno</button>
                        <button class="task-assignment-scope__option${includeWorkersWithoutShift ? " is-on" : ""}" type="button" data-dialog-scope="all">Todos</button>
                    </div>
                    ${renderMultiSelectFilter("dialogTaskProfession", professions, dialogProfessions, "dialog-professions", openDialogFilterGroup, "Profesión")}
                </div>
                <div class="task-assignment-candidates" data-candidate-list>
                    ${
                        candidates.length
                            ? candidates.map(profile =>
                                renderDialogCandidate(
                                    profile,
                                    assignments,
                                    shift,
                                    keyDay,
                                    taskId,
                                    selectedWorkers,
                                    tasks
                                )
                            ).join("")
                            : `<div class="empty-state empty-state--compact">Sin personal disponible para este turno.</div>`
                    }
                </div>
                <label class="task-assignment-note-field">
                    <span>Comentario de la casilla</span>
                    <textarea data-task-note rows="2" placeholder="Ej: Equipo en mantenimiento de 10 a 17 horas.">${escapeHTML(note)}</textarea>
                </label>
                <div class="task-assignment-dialog__actions">
                    <label class="task-assignment-repeat-toggle">
                        <input type="checkbox" data-dialog-repeat-week ${repeatRestOfWeek ? "checked" : ""}>
                        <span>Repetir el resto de la semana</span>
                    </label>
                    <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
                    <button class="primary-button" type="button" data-dialog-save>Guardar (${selectedWorkers.size})</button>
                </div>
            </section>
        `;

        backdrop.querySelector("[data-dialog-close]")?.addEventListener("click", close);
        backdrop.querySelector("[data-dialog-cancel]")?.addEventListener("click", close);
        backdrop
            .querySelector("[data-dialog-worker-search-form]")
            ?.addEventListener("submit", event => {
                event.preventDefault();
                collectVisibleWorkers();
                render();
            });
        const searchInput =
            backdrop.querySelector("[data-dialog-worker-search]");

        if (searchInput) {
            searchInput.addEventListener("input", () => {
                collectVisibleWorkers();
                render();
                const nextInput =
                    backdrop.querySelector("[data-dialog-worker-search]");

                if (nextInput) {
                    nextInput.focus();
                    const end = nextInput.value.length;
                    nextInput.setSelectionRange(end, end);
                }
            });
        }
        bindSelectedChips();
        syncSelection();

        backdrop
            .querySelector("[data-candidate-list]")
            ?.addEventListener("change", () => {
                collectVisibleWorkers();
                syncSelection();
            });

        backdrop
            .querySelectorAll("[data-dialog-scope]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    const next = button.dataset.dialogScope === "all";

                    if (next === includeWorkersWithoutShift) return;

                    collectVisibleWorkers();
                    includeWorkersWithoutShift = next;
                    render();
                });
            });
        backdrop
            .querySelectorAll(".task-assignment-multiselect[data-filter-group]")
            .forEach(control => {
                syncMultiSelectSelectAll(control);
                control.addEventListener("toggle", () => {
                    if (control.open) {
                        openDialogFilterGroup = control.dataset.filterGroup;
                    } else if (
                        openDialogFilterGroup ===
                        control.dataset.filterGroup
                    ) {
                        openDialogFilterGroup = "";
                    }
                });
            });
        if (unbindDialogFilterOutside) {
            unbindDialogFilterOutside();
        }
        unbindDialogFilterOutside = bindMultiSelectOutsideClose(
            backdrop,
            () => {
                openDialogFilterGroup = "";
            }
        );
        backdrop.querySelector("[data-dialog-save]")?.addEventListener("click", () => {
            const previousWorkers = assignmentWorkers(entry);
            collectVisibleWorkers();
            const nextWorkers = [...selectedWorkers];
            const nextNote = note.trim();
            const nextRemovedDefaults = defaultWorkersForCell(task, keyDay, shift)
                .filter(worker => !selectedWorkers.has(worker));

            persistEntryOrDelete(assignments, cellKey, {
                workers: nextWorkers,
                note: nextNote,
                removedDefaults: nextRemovedDefaults,
                mergedNextTaskId: assignments[cellKey]?.mergedNextTaskId
            });

            const repeated = repeatRestOfWeek
                ? repeatAssignmentForWeek(
                    assignments,
                    tasks,
                    shift,
                    taskId,
                    keyDay,
                    nextWorkers
                )
                : [];

            saveWeekAssignments(assignments);
            publishTaskAssignmentChanges(uniqueValues([
                ...previousWorkers,
                ...nextWorkers,
                ...nextRemovedDefaults,
                ...repeated
            ]));
            close();
            renderTaskAssignmentsPanel();
        });

        backdrop
            .querySelector("[data-filter-group='dialog-professions']")
            ?.addEventListener("change", event => {
                handleMultiSelectSelectAllChange(event);
                openDialogFilterGroup = "dialog-professions";
                collectVisibleWorkers();
                collectDialogFilters();
                render();
            });
    };

    render();
}

function cellExcelText(assignments, shift, taskId, day, tasks) {
    const entry = groupOwnerEntry(
        assignments,
        shift,
        tasks,
        taskId,
        keyFromDate(day)
    );
    const workers = assignmentWorkers(entry).join(", ");

    return [workers, entry.note].filter(Boolean).join(" | ");
}

function excelTableForShift(shift, tasks, days, assignments) {
    const title = SHIFT_CONFIG[shift].label;
    const rows = tasks.map(task => taskForShift(task, shift));

    return `
        <h2>${escapeHTML(title)}</h2>
        <table>
            <thead>
                <tr>
                    <th>Tarea</th>
                    ${days.map(day => `<th>${escapeHTML(formatWeekday(day))} ${escapeHTML(formatShortDate(day))}</th>`).join("")}
                </tr>
            </thead>
            <tbody>
                ${rows.map(task => `
                    <tr>
                        <td>${escapeHTML(task.title)}</td>
                        ${days.map(day => `<td>${escapeHTML(cellExcelText(assignments, shift, task.id, day, tasks))}</td>`).join("")}
                    </tr>
                `).join("") || `<tr><td colspan="8">Sin tareas</td></tr>`}
            </tbody>
        </table>
    `;
}

function eventsExcelTable(days) {
    return `
        <h2>Permisos / Ausencias / Cumplea&ntilde;os</h2>
        <table>
            <thead>
                <tr>
                    ${days.map(day => `<th>${escapeHTML(formatWeekday(day))} ${escapeHTML(formatShortDate(day))}</th>`).join("")}
                </tr>
            </thead>
            <tbody>
                <tr>
                    ${days.map(day => {
                        const absences = absenceProfiles(day)
                            .map(item => `${item.profile.name} | ${item.label}`);
                        const birthdays = birthdayProfiles(day)
                            .map(profile => `${profile.name} | Cumplea\u00f1os`);

                        return `<td>${escapeHTML([...absences, ...birthdays].join(" / "))}</td>`;
                    }).join("")}
                </tr>
            </tbody>
        </table>
    `;
}

// La asignacion de tareas vista como la programacion que lee el trabajador:
// una fila por tarea y una columna por dia. Devuelve datos planos para que el
// visor (taskSchedulePreview.js) solo se ocupe de dibujar.
//
// Se omiten las tareas sin nadie asignado en toda la semana y los turnos que
// quedan enteros vacios: en el tablero las filas vacias sirven para soltar
// trabajadores, pero en la tabla publicada solo son ruido.
export function getTaskScheduleWeek() {
    const days = weekDays();
    const tasks = getTasks();
    const assignments = cleanAssignmentsForWeek(days, tasks);

    const sections = SHIFT_TYPES.map(shift => ({
        shift,
        label: SHIFT_CONFIG[shift].label,
        rows: tasks
            .map(task => taskForShift(task, shift))
            .map(task => ({
                taskId: task.id,
                title: task.title,
                detail: taskDetailForShift(task, shift),
                cells: days.map(day => {
                    // Casilla fusionada: los trabajadores viven en la de arriba
                    // del grupo, pero son de todas sus tareas.
                    const entry = groupOwnerEntry(
                        assignments,
                        shift,
                        tasks,
                        task.id,
                        keyFromDate(day)
                    );

                    return {
                        workers: assignmentWorkers(entry)
                            .map(name => shortWorkerName(name, { compact: true }))
                            .filter(Boolean),
                        note: String(entry.note || "").trim()
                    };
                })
            }))
            .filter(row =>
                row.cells.some(cell => cell.workers.length || cell.note)
            )
    })).filter(section => section.rows.length);

    // Las casillas que el supervisor unio en el tablero se dibujan tambien
    // unidas aca: una sola celda para todo el grupo, con el rowspan de sus
    // tareas. Si no, la misma lista de gente se repetiria fila por fila y no se
    // entenderia que es un solo puesto compartido.
    sections.forEach(section => {
        days.forEach((day, dayIndex) => {
            columnGroups(assignments, section.shift, tasks, keyFromDate(day))
                .filter(group => group.taskIds.length > 1)
                .forEach(group => {
                    const indexes = group.taskIds
                        .map(id => section.rows.findIndex(
                            row => row.taskId === id
                        ))
                        .filter(index => index !== -1);

                    // Las filas de un grupo son contiguas por construccion; si
                    // alguna vez no lo fueran, el rowspan pisaria celdas de
                    // otras tareas, asi que se deja sin fusionar.
                    const contiguas = indexes.length > 1 &&
                        indexes[indexes.length - 1] - indexes[0] ===
                            indexes.length - 1;

                    if (!contiguas) return;

                    section.rows[indexes[0]].cells[dayIndex].rowSpan =
                        indexes.length;
                    indexes.slice(1).forEach(index => {
                        section.rows[index].cells[dayIndex].covered = true;
                    });
                });
        });
    });

    return {
        weekStart: new Date(currentWeekStart),
        days: days.map(day => ({
            keyDay: keyFromDate(day),
            weekday: formatWeekday(day),
            shortDate: formatShortDate(day),
            dayNumber: day.getDate()
        })),
        sections
    };
}

export function moveTaskScheduleWeek(offsetDays) {
    currentWeekStart = addDays(currentWeekStart, offsetDays);
    return renderTaskAssignmentsPanel();
}

export function goToTaskScheduleToday() {
    currentWeekStart = weekStartMonday(new Date());
    return renderTaskAssignmentsPanel();
}

function exportTaskAssignmentsExcel() {
    const days = weekDays();
    const tasks = getTasks();
    const assignments = cleanAssignmentsForWeek(days, tasks);
    const html = `
        <!doctype html>
        <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Calibri, Arial, sans-serif; color: #111827; }
                    h1 { font-size: 18px; }
                    h2 { padding: 7px 9px; color: #fff; background: #1d6cff; font-size: 13px; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 14px; }
                    th { background: #dbeafe; color: #0f172a; font-weight: 700; }
                    th, td { border: 1px solid #94a3b8; padding: 6px 8px; vertical-align: top; font-size: 11px; mso-number-format:"\\@"; }
                </style>
            </head>
            <body>
                <h1>Asignaci\u00f3n de Tareas - ${escapeHTML(formatShortDate(days[0]))} al ${escapeHTML(formatShortDate(days[6]))}</h1>
                ${excelTableForShift("day", tasks, days, assignments)}
                ${excelTableForShift("night", tasks, days, assignments)}
                ${eventsExcelTable(days)}
            </body>
        </html>
    `;
    const blob = new Blob([html], {
        type: "application/vnd.ms-excel;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `asignacion_tareas_${weekKey()}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function renderTaskAssignmentsPanel() {
    const root = document.getElementById("taskAssignmentsPanel");

    if (!root) return;

    const token = ++renderToken;
    const days = weekDays();
    const holidays = await holidayMapForDays(days);

    if (token !== renderToken) return;

    root.innerHTML = renderShell(holidays);
    bindShellEvents(root);
    // El selector rapido vive fuera del panel, asi que hay que volver a
    // colgarlo -y reanclarlo a su casilla- despues de cada pintado.
    syncCellPicker(root);
}
