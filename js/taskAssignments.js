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
let renderToken = 0;

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

function scheduleWeekStartISO(start = currentWeekStart) {
    return isoFromDate(weekStartMonday(start));
}

function scheduleWeekEndISO(start = currentWeekStart) {
    return isoFromDate(addDays(weekStartMonday(start), 6));
}

function scheduleWeekLabel(start = currentWeekStart) {
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

function getScheduleAttachments() {
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

function getScheduleAttachment(start = currentWeekStart) {
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
async function createScheduleWorkbookAttachment(file, weekStart = currentWeekStart) {
    const workspace = getActiveWorkspace();
    const dataUrl = await readFileAsDataURL(file);
    const normalizedWeekStart = weekStartMonday(weekStart);
    const { functions, functionsModule } = await getFirebaseServices();
    const upload = functionsModule.httpsCallable(
        functions,
        "uploadScheduleWorkbook"
    );
    const result = await upload({
        workspaceId: workspace?.id || "",
        name: file.name || "programacion.xlsx",
        type: file.type || "",
        weekStartISO: normalizedWeekStart
            ? scheduleWeekStartISO(normalizedWeekStart)
            : "",
        dataUrl
    });
    const attachment = normalizeScheduleAttachment(result.data, weekStart);

    if (!attachment || !attachment.grid) {
        throw new Error("No se pudo leer la programacion del Excel.");
    }

    return attachment;
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

function normalizeStoredTask(task, index) {
    const defaultWorkerRules = normalizeTaskDefaultRules(task);

    return {
        id: String(task?.id || `task_${Date.now()}_${index}`),
        shift: normalizeTaskShift(task?.shift),
        title: String(task?.title || "").trim(),
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

                    const cellKey = assignmentKey(shift, task.id, keyDay);
                    const entry = getCellEntry(
                        assignments,
                        shift,
                        task.id,
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

        if (!days.some(day => keyFromDate(day) === keyDay)) return;

        const availableWorkers = assignmentWorkers(entry)
            .filter(name => {
                const profile = profileByName(name);

                return isAvailableForShift(profile, keyDay, shift);
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
        removedDefaults: []
    };
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
    openAction = openTaskFilterGroup
) {
    const normalizedSelected = selected || options;
    const isOpen = openAction === action;

    return `
        <details class="task-assignment-multiselect" data-filter-group="${escapeHTML(action)}" ${isOpen ? "open" : ""}>
            <summary>
                <span>${escapeHTML(filterSummaryLabel(options, selected))}</span>
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

    return `
        <span class="task-assignment-worker-chip" draggable="true" data-worker-drag="${escapeHTML(profileName)}" data-worker-task="${escapeHTML(task.id)}" data-worker-shift="${escapeHTML(task.shift)}" data-worker-day="${escapeHTML(keyDay)}" title="Arrastrar a otra tarea del mismo turno y d&iacute;a">
            <span class="task-assignment-worker-chip__name">${escapeHTML(profileName)}</span>
            <button class="task-assignment-worker-edit${configuredClass}" type="button" data-worker-default-config="${escapeHTML(profileName)}" data-worker-task="${escapeHTML(task.id)}" data-worker-shift="${escapeHTML(task.shift)}" data-worker-day="${escapeHTML(keyDay)}" title="Editar trabajador predefinido" aria-label="Editar trabajador predefinido">
                &#9998;
            </button>
        </span>
    `;
}

function renderAssignmentCell(assignments, task, day, holidays = {}) {
    const keyDay = keyFromDate(day);
    const entry = getCellEntry(
        assignments,
        task.shift,
        task.id,
        keyDay
    );
    const workers = assignmentWorkers(entry)
        .map(profileName => renderWorkerChip(profileName, task, keyDay))
        .filter(Boolean);

    return `
        <div class="task-assignment-cell${inhabilClass(day, holidays, "task-assignment-cell--inhabil")}" data-task-cell="${escapeHTML(task.id)}" data-shift="${escapeHTML(task.shift)}" data-day="${escapeHTML(keyDay)}">
            <button class="task-assignment-add" type="button" title="Asignar trabajadores">
                +
            </button>
            <div class="task-assignment-cell-workers">
                ${workers.join("")}
            </div>
            ${entry.note ? `<p>${escapeHTML(entry.note)}</p>` : ""}
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
            <strong>Nueva tarea</strong>
            <div class="task-assignment-task-form">
                <input name="title" type="text" maxlength="80" placeholder="Ej: Revisar insumos">
                <button class="task-assignment-task-add" type="submit" aria-label="Agregar tarea">+</button>
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

function renderBoard(shift, tasks, days, assignments, holidays = {}) {
    const config = SHIFT_CONFIG[shift];
    const sectionTasks = tasks.map(task => taskForShift(task, shift));

    return `
        <section class="task-assignment-section task-assignment-section--${escapeHTML(config.className)}">
            <div class="task-assignment-section-title">
                ${escapeHTML(config.label)}
            </div>
            <div class="task-assignment-board">
                <div class="task-assignment-task-head task-assignment-task-head--label">
                    Tareas
                </div>
                ${days.map(day => `
                    <div class="task-assignment-day-head${inhabilClass(day, holidays, "task-assignment-day-head--inhabil")}">
                        <strong>${escapeHTML(formatWeekday(day))}</strong>
                        <span>${escapeHTML(formatShortDate(day))}</span>
                    </div>
                `).join("")}
                ${
                    sectionTasks.length
                        ? sectionTasks.map(task => `
                            <div class="task-assignment-task-cell" data-task-drop="${escapeHTML(task.id)}" data-shift="${escapeHTML(shift)}">
                                ${renderTaskControl(task)}
                            </div>
                            ${days.map(day =>
                                renderAssignmentCell(
                                    assignments,
                                    task,
                                    day,
                                    holidays
                                )
                            ).join("")}
                        `).join("")
                        : `
                            <div class="task-assignment-empty-row">
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
            <div class="task-assignment-events-grid">
                <div class="task-assignment-events-head">
                    Permisos / Ausencias / Cumplea&ntilde;os
                </div>
                ${days.map(day => {
                    const absences = absenceProfiles(day);
                    const birthdays = birthdayProfiles(day);

                    return `
                        <div class="task-assignment-event-day${inhabilClass(day, holidays, "task-assignment-event-day--inhabil")}">
                            <div class="task-assignment-event-date">
                                <strong>${escapeHTML(formatWeekday(day))}</strong>
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

function renderShell(holidays = {}) {
    const days = weekDays();
    const tasks = getTasks();
    const assignments = cleanAssignmentsForWeek(days, tasks);
    const roles = availableRoles();
    const professions = availableProfessions();

    return `
        <div class="task-assignment-shell">
            <section class="task-assignment-controls">
                <div class="task-assignment-view-filters">
                    <div>
                        <strong>Estamentos</strong>
                        ${renderMultiSelectFilter("taskRole", roles, selectedRoles, "roles")}
                    </div>
                    <div>
                        <strong>Profesiones</strong>
                        ${renderMultiSelectFilter("taskProfession", professions, selectedProfessions, "professions")}
                    </div>
                </div>
                ${renderTaskAddForm()}
                <span class="task-assignment-toolbar">
                    <button class="secondary-button secondary-button--small" type="button" data-task-schedule-attach>Adjuntar Programaci&oacute;n</button>
                    <button class="secondary-button secondary-button--small" type="button" data-task-week-prev>Anterior</button>
                    <button class="secondary-button secondary-button--small" type="button" data-task-week-current>Semana actual</button>
                    <button class="secondary-button secondary-button--small" type="button" data-task-week-next>Siguiente</button>
                    <button class="primary-button secondary-button--small" type="button" data-task-export>Descargar Excel</button>
                </span>
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

    if (workers.length || note || removedDefaults.length) {
        assignments[cellKey] = {
            workers,
            note,
            removedDefaults
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

function openScheduleAttachmentDialog() {
    const dialogWeekStart = new Date(currentWeekStart);
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
                    dialogWeekStart
                );

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
    root.querySelector("[data-task-export]")?.addEventListener("click", exportTaskAssignmentsExcel);
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
            cell.querySelector(".task-assignment-add")?.addEventListener(
                "click",
                () => openAssignmentDialog({
                    shift: cell.dataset.shift,
                    taskId: cell.dataset.taskCell,
                    keyDay: cell.dataset.day
                })
            );
            cell.ondragover = event => {
                if (!canMoveWorkerToCell(cell, draggedWorker)) return;

                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                cell.classList.add("is-drag-over");
            };
            cell.ondragleave = () => {
                cell.classList.remove("is-drag-over");
            };
            cell.ondrop = event => {
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

function renderDialogCandidate(
    profile,
    assignments,
    shift,
    keyDay,
    taskId,
    selectedWorkers
) {
    const busy = workerHasOtherTask(
        assignments,
        profile.name,
        shift,
        keyDay,
        taskId
    );

    return `
        <label class="task-assignment-candidate ${busy ? "is-busy" : "is-free"}">
            <input type="checkbox" value="${escapeHTML(profile.name)}" ${selectedWorkers.has(profile.name) ? "checked" : ""}>
            <span>
                <strong>${escapeHTML(profile.name)}</strong>
                <small>${escapeHTML(profile.estamento || "Sin estamento")} | ${escapeHTML(profileProfession(profile))} | ${escapeHTML(profileShiftLabel(profile, keyDay))}</small>
            </span>
        </label>
    `;
}

function openAssignmentDialog({ shift, taskId, keyDay }) {
    const task = getTasks().find(item => item.id === taskId);
    if (!task) return;

    const assignments = getWeekAssignments();
    const cellKey = assignmentKey(shift, taskId, keyDay);
    const entry = assignments[cellKey] || { workers: [], note: "" };
    const selectedWorkers = new Set(assignmentWorkers(entry));
    const professions = availableProfessions();
    let dialogProfessions = null;
    let openDialogFilterGroup = "";
    let unbindDialogFilterOutside = null;
    let workerSearch = "";
    let includeWorkersWithoutShift = false;
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
        includeWorkersWithoutShift = Boolean(
            backdrop
                .querySelector("[data-dialog-include-free-workers]")
                ?.checked
        );
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
                        <h3>${escapeHTML(task.title)}</h3>
                        <span>${escapeHTML(SHIFT_CONFIG[shift].shortLabel)} | ${escapeHTML(formatWeekday(date))} ${escapeHTML(formatShortDate(date))}</span>
                    </div>
                    <button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">&times;</button>
                </div>
                <div class="task-assignment-dialog__filters">
                    <div class="task-assignment-worker-search-field">
                        <strong>Trabajador</strong>
                        <form class="profile-viewer task-assignment-worker-search" data-dialog-worker-search-form autocomplete="off">
                            <div class="profile-viewer__field">
                                <input
                                    data-dialog-worker-search
                                    type="search"
                                    list="taskAssignmentWorkerOptions"
                                    placeholder="Buscar trabajador"
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
                    </div>
                    <div>
                        <strong>Profesi&oacute;n</strong>
                        ${renderMultiSelectFilter("dialogTaskProfession", professions, dialogProfessions, "dialog-professions", openDialogFilterGroup)}
                    </div>
                </div>
                <label class="task-assignment-free-toggle">
                    <input type="checkbox" data-dialog-include-free-workers ${includeWorkersWithoutShift ? "checked" : ""}>
                    <span>Incluir trabajadores libres del d&iacute;a</span>
                </label>
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
                                    selectedWorkers
                                )
                            ).join("")
                            : `<div class="empty-state empty-state--compact">Sin personal disponible para este turno.</div>`
                    }
                </div>
                <label class="task-assignment-note-field">
                    <span>Comentario</span>
                    <textarea data-task-note rows="3" placeholder="Ej: Equipo en mantenimiento de 10 a 17 horas.">${escapeHTML(note)}</textarea>
                </label>
                <div class="task-assignment-dialog__actions">
                    <button class="secondary-button" type="button" data-dialog-cancel>Cancelar</button>
                    <button class="primary-button" type="button" data-dialog-save>Guardar</button>
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
        backdrop
            .querySelector("[data-dialog-include-free-workers]")
            ?.addEventListener("change", () => {
                collectVisibleWorkers();
                render();
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

            if (
                nextWorkers.length ||
                nextNote ||
                nextRemovedDefaults.length
            ) {
                assignments[cellKey] = {
                    workers: nextWorkers,
                    note: nextNote,
                    removedDefaults: nextRemovedDefaults
                };
            } else {
                delete assignments[cellKey];
            }

            saveWeekAssignments(assignments);
            publishTaskAssignmentChanges(uniqueValues([
                ...previousWorkers,
                ...nextWorkers,
                ...nextRemovedDefaults
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

function cellExcelText(assignments, shift, taskId, day) {
    const entry = getCellEntry(
        assignments,
        shift,
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
                        ${days.map(day => `<td>${escapeHTML(cellExcelText(assignments, shift, task.id, day))}</td>`).join("")}
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
}
