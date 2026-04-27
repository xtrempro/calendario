import { prevMonth, nextMonth } from "./calendar.js";
import { pushHistory, undo, redo } from "./history.js";
import { refreshAll } from "./refresh.js";
import { DOM } from "./dom.js";
import { renderSwapPanel } from "./swapUI.js";
import { renderStaffingPanel } from "./staffing.js";
import { exportHoursReport } from "./hoursReport.js";
import {
    initHoursCharts,
    renderHoursCharts
} from "./hoursCharts.js";
import {
    addAuditLog,
    AUDIT_CATEGORY,
    renderAuditLogPanel
} from "./auditLog.js";
import {
    fetchHolidays,
    getCachedHolidays
} from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
import {
    turnoLabel,
    aplicarClaseTurno
} from "./uiEngine.js";
import { aplicarCambiosTurno } from "./turnEngine.js";
import {
    calcularHorasMesPerfil,
    renderSummaryHTML
} from "./hoursEngine.js";
import { getRaw, setRaw, getJSON, setJSON } from "./persistence.js";
import {
    getProfileData,
    saveProfileData,
    getBaseProfileData,
    saveBaseProfileData,
    getBlockedDays,
    saveBlockedDays,
    getProfiles,
    saveProfiles,
    setCurrentProfile,
    getCurrentProfile,
    getShiftAssigned,
    setShiftAssigned,
    getAdminDays,
    saveAdminDays,
    getLegalDays,
    saveLegalDays,
    getCompDays,
    saveCompDays,
    getAbsences,
    saveAbsences,
    updateProfile,
    getRotativa,
    saveRotativa,
    getValorHora,
    setValorHora,
    getManualLeaveBalances,
    saveManualLeaveBalances,
    getCarry,
    getSwaps,
    saveSwaps,
    isProfileActive
} from "./storage.js";
import { cambioEstaAnulado } from "./swaps.js";
import { renderReplacementLogHTML } from "./replacements.js";
import {
    addReplacementContract,
    formatContractDate,
    getContractsForProfile
} from "./contracts.js";
import {
    totalAdministrativosUsados,
    aplicarAdministrativo,
    aplicarHalfAdministrativo,
    aplicarAusenciaInjustificada,
    aplicarLegal,
    aplicarComp,
    aplicarLicencia,
    validarCantidadLegalAnual
} from "./leaveEngine.js";

const PROFILE_MODE = {
    VIEW: "view",
    CREATE: "create",
    EDIT: "edit"
};

const THEME_KEY = "proturnos_theme";

let selectionMode = null;
let adminCantidad = 0;
let compCantidad = 0;
let legalCantidad = 0;
let licenseCantidad = 0;
let licenseType = "license";
let availabilityEditMode = false;
let profileRotationMiniDate = new Date();
let profileHoursSummaryRequest = 0;

const profileDraft = {
    mode: PROFILE_MODE.VIEW,
    originalName: "",
    originalRotationType: "",
    originalRotationStart: "",
    name: "",
    email: "",
    rut: "",
    phone: "",
    birthDate: "",
    docs: [],
    active: true,
    unit: "",
    unitEntryDate: "",
    contractType: "",
    estamento: "",
    grade: "",
    rotationType: "",
    rotationStart: "",
    contractStart: "",
    contractEnd: "",
    contractReplaces: "",
    shiftAssigned: false,
    valorHora: ""
};

window.selectionMode = null;
window.compCantidad = 0;
window.licenseCantidad = 0;
window.licenseType = "license";
window.pushUndoState = pushHistory;
window.getProfileDraftSelectionKey = () =>
    inputDateToCalendarKey(
        profileDraft.rotationType === "reemplazo"
            ? profileDraft.contractStart
            : profileDraft.rotationStart
    );

const HR_LOG_CONFIG = [
    {
        key: "academic",
        title: "Formacion academica",
        fields: [
            { name: "level", label: "Nivel" },
            { name: "institution", label: "Institucion" },
            { name: "degree", label: "Titulo/Grado obtenido" },
            { name: "year", label: "Ano de egreso", type: "number" }
        ],
        fileLabel: "Titulo PDF"
    },
    {
        key: "training",
        title: "Capacitaciones",
        fields: [
            { name: "name", label: "Nombre de la capacitacion" },
            { name: "hours", label: "Horas academicas", type: "number" },
            { name: "grade", label: "Nota obtenida" },
            { name: "date", label: "Fecha de realizacion", type: "date" }
        ],
        fileLabel: "Certificado PDF"
    },
    {
        key: "diplomas",
        title: "Diplomados",
        fields: [
            { name: "name", label: "Nombre del diplomado" },
            { name: "hours", label: "Horas academicas", type: "number" },
            { name: "grade", label: "Nota obtenida" },
            { name: "date", label: "Fecha de realizacion", type: "date" }
        ],
        fileLabel: "Certificado PDF"
    },
    {
        key: "experience",
        title: "Experiencia laboral previa",
        fields: [
            { name: "institution", label: "Institucion" },
            { name: "role", label: "Cargo" },
            { name: "start", label: "Fecha ingreso", type: "date" },
            { name: "end", label: "Fecha egreso", type: "date" },
            { name: "functions", label: "Funciones principales", type: "textarea" }
        ]
    },
    {
        key: "events",
        title: "Eventos",
        filterYear: true,
        fields: [
            { name: "date", label: "Fecha", type: "date" },
            { name: "detail", label: "Detalle", type: "textarea" }
        ]
    },
    {
        key: "merit",
        title: "Anotaciones de merito",
        filterYear: true,
        fields: [
            { name: "date", label: "Fecha", type: "date" },
            { name: "title", label: "Titulo de la anotacion" }
        ],
        fileLabel: "Archivo escaneado"
    },
    {
        key: "demerit",
        title: "Anotaciones de demerito",
        filterYear: true,
        fields: [
            { name: "date", label: "Fecha", type: "date" },
            { name: "title", label: "Titulo de la anotacion" }
        ],
        fileLabel: "Archivo escaneado"
    },
    {
        key: "performance",
        title: "Evaluaciones de desempeno",
        filterYear: true,
        fields: [
            { name: "date", label: "Fecha", type: "date" },
            { name: "detail", label: "Detalle importante", type: "textarea" }
        ],
        fileLabel: "Calificacion escaneada"
    }
];

const recordYearFilters = {};

function keyFromDate(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function parseKey(key) {
    const parts = key.split("-");
    return new Date(
        Number(parts[0]),
        Number(parts[1]),
        Number(parts[2])
    );
}

function parseInputDate(value){
    const parts = value.split("-");
    return new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2])
    );
}

function toISODate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function toInputDate(date){
    return toISODate(date);
}

function normalizeStoredStart(start){
    if (!start) return "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        return start;
    }

    const date = new Date(start);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return toInputDate(date);
}

function inputDateToCalendarKey(value){
    if (!value) return "";

    const parts = value.split("-");

    if (parts.length !== 3) return "";

    return `${parts[0]}-${Number(parts[1]) - 1}-${Number(parts[2])}`;
}

function calendarKeyToInputDate(key){
    if (!key) return "";

    return toInputDate(parseKey(key));
}

function compareISODate(a, b) {
    return String(a || "").localeCompare(String(b || ""));
}

function isDateKeyOnOrAfter(key, startDate) {
    const date = parseKey(key);

    if (Number.isNaN(date.getTime())) return false;

    return date >= startDate;
}

function formatDisplayDate(value){
    if (!value) return "";

    const parts = value.split("-");

    if (parts.length !== 3) return value;

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function contarHabiles(
    obj,
    year = new Date().getFullYear(),
    holidays = getCachedHolidays(year)
) {
    let total = 0;

    Object.keys(obj).forEach(key => {
        if (!key.startsWith(year + "-")) return;

        const date = parseKey(key);

        if (isBusinessDay(date, holidays)) total++;
    });

    return total;
}

function formatSaldo(value) {
    return Number.isInteger(value)
        ? String(value)
        : value
            .toFixed(1)
            .replace(".0", "")
            .replace(".", ",");
}

function normalizeBalanceValue(value) {
    const numeric = Number(
        String(value ?? "").replace(",", ".")
    );

    if (!Number.isFinite(numeric)) return 0;

    return Math.max(0, Math.round(numeric * 10) / 10);
}

function withManualBalance(
    manualValue,
    fallbackValue
) {
    const numeric = Number(manualValue);

    return Number.isFinite(numeric)
        ? Math.max(0, numeric)
        : fallbackValue;
}

function getLeaveBalances(
    year = new Date().getFullYear(),
    holidays = getCachedHolidays(year)
) {
    const manual = getManualLeaveBalances(year);
    const calculated = {
        legal: Math.max(0, 15 - contarHabiles(getLegalDays(), year, holidays)),
        admin: Math.max(0, 6 - totalAdministrativosUsados()),
        comp: contarHabiles(getCompDays(), year, holidays)
    };

    return {
        legal: withManualBalance(manual.legal, calculated.legal),
        admin: withManualBalance(manual.admin, calculated.admin),
        comp: withManualBalance(manual.comp, calculated.comp)
    };
}

function decrementManualBalance(
    field,
    amount,
    year = new Date().getFullYear()
) {
    const manual = getManualLeaveBalances(year);
    const currentValue = Number(manual[field]);

    if (!Number.isFinite(currentValue)) return;

    saveManualLeaveBalances(year, {
        ...manual,
        [field]: Math.max(
            0,
            normalizeBalanceValue(currentValue - amount)
        )
    });
}

function incrementManualBalance(
    field,
    amount,
    year = new Date().getFullYear()
) {
    const manual = getManualLeaveBalances(year);
    const currentValue = Number(manual[field]);

    if (!Number.isFinite(currentValue)) return;

    saveManualLeaveBalances(year, {
        ...manual,
        [field]: Math.max(
            0,
            normalizeBalanceValue(currentValue + amount)
        )
    });
}

function sanitizeValorHora(value){
    const numeric = Math.max(0, Number(value) || 0);
    return value === "" ? "" : String(numeric);
}

function sanitizeDigits(value, maxLength = Infinity) {
    return String(value || "")
        .replace(/\D/g, "")
        .slice(0, maxLength);
}

function sanitizeMoney(value) {
    return sanitizeDigits(value);
}

function formatRut(value) {
    const raw = String(value || "")
        .replace(/[^0-9kK]/g, "")
        .toUpperCase();

    if (raw.length <= 1) return raw;

    const body = raw.slice(0, -1);
    const verifier = raw.slice(-1);
    const dotted = body
        .split("")
        .reverse()
        .join("")
        .match(/.{1,3}/g)
        .join(".")
        .split("")
        .reverse()
        .join("");

    return `${dotted}-${verifier}`;
}

function normalizeAttachmentFiles(files) {
    return Array.from(files || []).map(file => ({
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: file.name,
        type: file.type || "",
        size: file.size || 0,
        addedAt: new Date().toISOString()
    }));
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function readAttachmentFiles(files) {
    const list = Array.from(files || []);
    const attachments = [];

    for (const file of list) {
        attachments.push({
            ...normalizeAttachmentFiles([file])[0],
            dataUrl: await readFileAsDataURL(file)
        });
    }

    return attachments;
}

function dataUrlToBlob(dataUrl) {
    const [header, data] = String(dataUrl || "").split(",");
    const mimeMatch = header.match(/data:([^;]+);base64/);
    const mime = mimeMatch?.[1] || "application/octet-stream";
    const binary = atob(data || "");
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: mime });
}

function openAttachment(doc) {
    if (!doc?.dataUrl) {
        alert(
            "Este adjunto se registro antes de guardar el contenido del archivo. Debes quitarlo y volver a adjuntarlo para poder visualizarlo."
        );
        return;
    }

    const url = URL.createObjectURL(dataUrlToBlob(doc.dataUrl));
    const opened = window.open(url, "_blank", "noopener");

    if (!opened) {
        alert("El navegador bloqueo la ventana emergente. Permite pop-ups para visualizar el documento.");
    }

    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getProfileLogs(profileName) {
    const logs = getJSON(`hrLogs_${profileName}`, {});
    const normalized = {};

    HR_LOG_CONFIG.forEach(config => {
        normalized[config.key] = Array.isArray(logs[config.key])
            ? logs[config.key]
            : [];
    });

    return normalized;
}

function saveProfileLogs(profileName, logs) {
    if (!profileName) return;

    setJSON(`hrLogs_${profileName}`, logs || {});
}

function getRecordYear(entry) {
    const source = entry.date || entry.start || "";

    return source ? String(source).slice(0, 4) : "";
}

function renderAttachmentName(entry) {
    return entry?.file?.name
        ? `<small>Clip: ${escapeHTML(entry.file.name)}</small>`
        : "";
}

function getRotativaLabel(type){
    if (type === "3turno") return "3er Turno";
    if (type === "4turno") return "4° Turno";
    if (type === "diurno") return "Diurno";
    if (type === "reemplazo") return "Reemplazo";
    return "Sin rotativa";
}

function activeLabel(value) {
    return value ? "activo" : "desactivado";
}

function yesNoLabel(value) {
    return value ? "si" : "no";
}

function auditProfileSnapshot(profileName) {
    const profile = getProfiles().find(
        item => item.name === profileName
    );

    if (!profile) return null;

    return {
        ...profile,
        shiftAssigned: getShiftAssigned(profileName),
        valorHora: getValorHora(profileName),
        rotativa: getRotativa(profileName)
    };
}

function describeProfileChanges(before, after) {
    if (!before) return "Ficha inicial creada.";

    const changes = [];
    const fields = [
        ["name", "nombre"],
        ["email", "correo"],
        ["rut", "RUT"],
        ["phone", "celular"],
        ["birthDate", "fecha de nacimiento"],
        ["unit", "unidad"],
        ["unitEntryDate", "fecha de ingreso"],
        ["contractType", "tipo de contrato"],
        ["estamento", "estamento"],
        ["grade", "grado"]
    ];

    fields.forEach(([key, label]) => {
        if (String(before[key] || "") !== String(after[key] || "")) {
            changes.push(label);
        }
    });

    if (Boolean(before.shiftAssigned) !== Boolean(after.shiftAssigned)) {
        changes.push("asignacion de turno");
    }

    if (String(before.valorHora || "") !== String(after.valorHora || "")) {
        changes.push("valor hora");
    }

    if (
        String(before.rotativa?.type || "") !== String(after.rotativa?.type || "") ||
        String(before.rotativa?.start || "") !== String(after.rotativa?.start || "")
    ) {
        changes.push("rotativa actual");
    }

    if ((before.docs?.length || 0) !== (after.docs?.length || 0)) {
        changes.push("documentos adjuntos");
    }

    if (before.active !== after.active) {
        changes.push("estado del perfil");
    }

    return changes.length
        ? `Campos modificados: ${changes.join(", ")}.`
        : "Se guardo la ficha sin cambios detectados.";
}

function isProfileEditing(){
    return profileDraft.mode !== PROFILE_MODE.VIEW;
}

function getPerfilActual() {
    const current = getCurrentProfile();
    return getProfiles().find(
        profile => profile.name === current
    ) || null;
}

function canModifyCurrentProfile() {
    const profile = getPerfilActual();

    if (!profile || isProfileActive(profile)) {
        return true;
    }

    alert(
        "Este perfil esta desactivado. Reactivalo desde Perfil para cargar turnos, permisos o modificaciones de calendario."
    );
    return false;
}

function clearDraftValues(){
    profileDraft.originalName = "";
    profileDraft.originalRotationType = "";
    profileDraft.originalRotationStart = "";
    profileDraft.name = "";
    profileDraft.email = "";
    profileDraft.rut = "";
    profileDraft.phone = "";
    profileDraft.birthDate = "";
    profileDraft.docs = [];
    profileDraft.active = true;
    profileDraft.unit = "";
    profileDraft.unitEntryDate = "";
    profileDraft.contractType = "";
    profileDraft.estamento = "";
    profileDraft.grade = "";
    profileDraft.rotationType = "";
    profileDraft.rotationStart = "";
    profileDraft.contractStart = "";
    profileDraft.contractEnd = "";
    profileDraft.contractReplaces = "";
    profileDraft.shiftAssigned = false;
    profileDraft.valorHora = "";
}

function loadDraftFromProfile(profile){
    const rotativa = getRotativa(profile.name);
    const rotationStart =
        normalizeStoredStart(rotativa.start);

    profileDraft.originalName = profile.name;
    profileDraft.originalRotationType =
        rotativa.type || "";
    profileDraft.originalRotationStart =
        rotationStart;
    profileDraft.name = profile.name;
    profileDraft.email = profile.email || "";
    profileDraft.rut = profile.rut || "";
    profileDraft.phone = profile.phone || "";
    profileDraft.birthDate = profile.birthDate || "";
    profileDraft.docs = Array.isArray(profile.docs)
        ? [...profile.docs]
        : [];
    profileDraft.active = isProfileActive(profile);
    profileDraft.unit = profile.unit || "";
    profileDraft.unitEntryDate = profile.unitEntryDate || "";
    profileDraft.contractType = profile.contractType || "";
    profileDraft.estamento = profile.estamento || "";
    profileDraft.grade = String(profile.grade || "");
    profileDraft.rotationType = rotativa.type || "";
    profileDraft.rotationStart = rotationStart;
    profileDraft.shiftAssigned = getShiftAssigned(profile.name);
    profileDraft.valorHora = String(getValorHora(profile.name) || "");
}

function hasRotationChanged() {
    if (profileDraft.mode !== PROFILE_MODE.EDIT) {
        return false;
    }

    return (
        profileDraft.rotationType !==
            profileDraft.originalRotationType ||
        normalizeStoredStart(profileDraft.rotationStart) !==
            normalizeStoredStart(
                profileDraft.originalRotationStart
            )
    );
}

function getDisplayedProfileData(){
    const profile = getPerfilActual();

    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return {
            name: profileDraft.name,
            email: profileDraft.email,
            rut: profileDraft.rut,
            phone: profileDraft.phone,
            birthDate: profileDraft.birthDate,
            docs: profileDraft.docs,
            active: profileDraft.active,
            unit: profileDraft.unit,
            unitEntryDate: profileDraft.unitEntryDate,
            contractType: profileDraft.contractType,
            estamento: profileDraft.estamento,
            grade: profileDraft.grade,
            rotationType: profileDraft.rotationType,
            rotationStart: profileDraft.rotationStart,
            contractStart: profileDraft.contractStart,
            contractEnd: profileDraft.contractEnd,
            contractReplaces: profileDraft.contractReplaces,
            shiftAssigned: profileDraft.shiftAssigned,
            valorHora: profileDraft.valorHora
        };
    }

    if (profileDraft.mode === PROFILE_MODE.EDIT) {
        return {
            name: profileDraft.name,
            email: profileDraft.email,
            rut: profileDraft.rut,
            phone: profileDraft.phone,
            birthDate: profileDraft.birthDate,
            docs: profileDraft.docs,
            active: profileDraft.active,
            unit: profileDraft.unit,
            unitEntryDate: profileDraft.unitEntryDate,
            contractType: profileDraft.contractType,
            estamento: profileDraft.estamento,
            grade: profileDraft.grade,
            rotationType: profileDraft.rotationType,
            rotationStart: profileDraft.rotationStart,
            contractStart: profileDraft.contractStart,
            contractEnd: profileDraft.contractEnd,
            contractReplaces: profileDraft.contractReplaces,
            shiftAssigned: profileDraft.shiftAssigned,
            valorHora: profileDraft.valorHora
        };
    }

    if (!profile) {
        return {
            name: "",
            email: "",
            rut: "",
            phone: "",
            birthDate: "",
            docs: [],
            active: true,
            unit: "",
            unitEntryDate: "",
            contractType: "",
            estamento: "",
            grade: "",
            rotationType: "",
            rotationStart: "",
            contractStart: "",
            contractEnd: "",
            contractReplaces: "",
            shiftAssigned: false,
            valorHora: ""
        };
    }

    const rotativa = getRotativa(profile.name);

    return {
        name: profile.name,
        email: profile.email || "",
        rut: profile.rut || "",
        phone: profile.phone || "",
        birthDate: profile.birthDate || "",
        docs: Array.isArray(profile.docs) ? profile.docs : [],
        active: isProfileActive(profile),
        unit: profile.unit || "",
        unitEntryDate: profile.unitEntryDate || "",
        contractType: profile.contractType || "",
        estamento: profile.estamento,
        grade: String(profile.grade || ""),
        rotationType: rotativa.type || "",
        rotationStart: normalizeStoredStart(rotativa.start),
        contractStart: "",
        contractEnd: "",
        contractReplaces: "",
        shiftAssigned: getShiftAssigned(profile.name),
        valorHora: String(getValorHora(profile.name) || "")
    };
}

function buildRotationStatus(data){
    if (data.rotationType === "reemplazo") {
        if (profileDraft.mode === PROFILE_MODE.VIEW) {
            const profile = getPerfilActual();
            const contracts = profile
                ? getContractsForProfile(profile.name)
                : [];

            if (!contracts.length) {
                return "Rotativa Reemplazo sin contratos registrados.";
            }

            return `Rotativa Reemplazo con ${contracts.length} contrato(s) registrado(s).`;
        }

        if (!data.contractStart) {
            return "Marca en el mini calendario el inicio del contrato de reemplazo.";
        }

        if (!data.contractEnd) {
            return `Inicio de contrato: ${formatDisplayDate(data.contractStart)}. Ahora marca la fecha de termino.`;
        }

        return `Contrato de reemplazo: ${formatDisplayDate(data.contractStart)} al ${formatDisplayDate(data.contractEnd)}.`;
    }

    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        if (!data.rotationType) {
            return "Selecciona una rotativa para definir su fecha de inicio.";
        }

        if (!data.rotationStart) {
            return `Marca en el mini calendario desde que fecha se aplicara ${getRotativaLabel(data.rotationType)}.`;
        }

        return `${getRotativaLabel(data.rotationType)} comenzara el ${formatDisplayDate(data.rotationStart)}.`;
    }

    if (profileDraft.mode === PROFILE_MODE.EDIT) {
        if (!data.rotationType) {
            return "Selecciona la nueva rotativa y luego marca su fecha de inicio en el mini calendario.";
        }

        if (!hasRotationChanged()) {
            if (!data.rotationStart) {
                return `Rotativa actual: ${getRotativaLabel(data.rotationType)}.`;
            }

            return `Rotativa actual: ${getRotativaLabel(data.rotationType)} desde ${formatDisplayDate(data.rotationStart)}.`;
        }

        if (!data.rotationStart) {
            return `Marca en el mini calendario desde que fecha se aplicara la nueva ${getRotativaLabel(data.rotationType)}.`;
        }

        return `${getRotativaLabel(data.rotationType)} se aplicara desde ${formatDisplayDate(data.rotationStart)}.`;
    }

    if (!data.rotationType) {
        return "Este colaborador aun no tiene una rotativa configurada.";
    }

    if (!data.rotationStart) {
        return `Rotativa actual: ${getRotativaLabel(data.rotationType)}.`;
    }

    return `Rotativa actual: ${getRotativaLabel(data.rotationType)} desde ${formatDisplayDate(data.rotationStart)}.`;
}

function buildEditorHint(profile){
    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        if (profileDraft.rotationType === "reemplazo") {
            return "Completa nombre, estamento, periodo de contrato y a quien reemplaza antes de guardar.";
        }

        return "Completa nombre, estamento, rotativa y marca en el mini calendario desde que fecha inicia antes de guardar.";
    }

    if (profileDraft.mode === PROFILE_MODE.EDIT) {
        if (profileDraft.rotationType === "reemplazo") {
            return "Puedes actualizar los datos del trabajador o agregar un nuevo contrato de reemplazo indicando inicio, termino y a quien reemplaza.";
        }

        return "Actualiza los datos del trabajador. Solo si cambias la rotativa debes marcar en el mini calendario desde que fecha aplica.";
    }

    if (profile) {
        return "Presiona Editar para modificar nombre, estamento, rotativa, asignacion de turno y valor hora.";
    }

    return "Selecciona un colaborador para editarlo o crea uno nuevo.";
}

function getProfileRotationState(profileName, key) {
    if (!profileName) return 0;

    const baseData = getBaseProfileData(profileName);
    const data = getProfileData(profileName);
    const hasData =
        Object.prototype.hasOwnProperty.call(data, key);
    const hasBaseData =
        Object.prototype.hasOwnProperty.call(baseData, key);
    const state = hasData
        ? Number(data[key]) || 0
        : hasBaseData
            ? Number(baseData[key]) || 0
            : 0;

    return aplicarCambiosTurno(profileName, key, state);
}

function handleContractDatePick(key) {
    const selected = calendarKeyToInputDate(key);

    if (
        !profileDraft.contractStart ||
        (
            profileDraft.contractStart &&
            profileDraft.contractEnd
        ) ||
        compareISODate(selected, profileDraft.contractStart) < 0
    ) {
        profileDraft.contractStart = selected;
        profileDraft.contractEnd = "";
        renderDashboardState();
        return;
    }

    profileDraft.contractEnd = selected;
    renderDashboardState();
}

async function renderProfileHoursSummary(profile = getPerfilActual()) {
    const summary = document.getElementById("summary");

    if (!summary) return;

    if (!profile) {
        profileHoursSummaryRequest++;
        summary.innerHTML = `
            <div class="empty-state empty-state--compact">
                Selecciona un colaborador para ver sus horas extras.
            </div>
        `;
        return;
    }

    const requestId = ++profileHoursSummaryRequest;
    const y = profileRotationMiniDate.getFullYear();
    const m = profileRotationMiniDate.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const monthLabel = profileRotationMiniDate.toLocaleString(
        "es-CL",
        {
            month: "long",
            year: "numeric"
        }
    );
    const holidays = await fetchHolidays(y);

    if (requestId !== profileHoursSummaryRequest) return;

    const stats = calcularHorasMesPerfil(
        profile.name,
        y,
        m,
        days,
        holidays,
        getProfileData(profile.name),
        {},
        getCarry(y, m)
    );

    summary.innerHTML = `
        <div class="summary-context">
            Mes visualizado en mini calendario: ${monthLabel}
        </div>
        ${renderSummaryHTML(stats)}
        ${renderReplacementLogHTML(profile.name, y, m, holidays)}
    `;
}

function renderProfileRotationMiniCalendar() {
    if (!DOM.profileRotationMiniCalendar) return;

    const y = profileRotationMiniDate.getFullYear();
    const m = profileRotationMiniDate.getMonth();
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const profile = getPerfilActual();
    const displayedRotationType = isProfileEditing()
        ? profileDraft.rotationType
        : getRotativa(profile?.name).type;
    const isReplacementRotation =
        displayedRotationType === "reemplazo";
    const selectedKey = inputDateToCalendarKey(
        isReplacementRotation
            ? profileDraft.contractStart
            : profileDraft.rotationStart
    );
    const contractEndKey =
        inputDateToCalendarKey(profileDraft.contractEnd);
    const editing = isProfileEditing();
    const canPick = editing && Boolean(displayedRotationType);
    const existingContracts =
        isReplacementRotation && profile
            ? getContractsForProfile(profile.name)
            : [];

    let html = `
        <div class="profile-mini-head">
            <button id="profileMiniPrev" type="button" aria-label="Mes anterior">&lt;</button>
            <strong>${profileRotationMiniDate.toLocaleString("es-CL", {
                month: "long",
                year: "numeric"
            })}</strong>
            <button id="profileMiniNext" type="button" aria-label="Mes siguiente">&gt;</button>
        </div>

        <div class="profile-mini-weekdays">
            <span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span>
        </div>

        <div class="profile-mini-grid">
    `;

    for (let i = 0; i < first; i++) {
        html += `<span class="profile-mini-spacer"></span>`;
    }

    for (let d = 1; d <= days; d++) {
        const key = `${y}-${m}-${d}`;
        const iso = calendarKeyToInputDate(key);
        const state = getProfileRotationState(profile?.name, key);
        const existingContract = existingContracts.find(contract =>
            contract.start <= iso &&
            contract.end >= iso
        );
        const cell = document.createElement("button");

        cell.type = "button";
        cell.className = "profile-mini-day";
        cell.dataset.key = key;

        if (selectedKey === key) {
            cell.classList.add("is-selected");
        }

        if (isReplacementRotation) {
            if (existingContract) {
                cell.classList.add("has-existing-contract");
                cell.title =
                    `Contrato vigente: ${formatContractDate(existingContract.start)} - ${formatContractDate(existingContract.end)} | Reemplaza a: ${existingContract.replaces}`;
            }

            if (contractEndKey === key) {
                cell.classList.add("is-contract-end");
            }

            const draftContractRange = Boolean(
                profileDraft.contractStart &&
                profileDraft.contractEnd &&
                iso >= profileDraft.contractStart &&
                iso <= profileDraft.contractEnd
            );

            if (draftContractRange) {
                cell.classList.add("is-contract-range");
            }
        }

        if (canPick) {
            cell.classList.add("is-pickable");
        } else {
            cell.disabled = true;
        }

        aplicarClaseTurno(cell, state);
        cell.innerHTML = `
            <span>${d}</span>
            <small>${
                isReplacementRotation
                    ? (
                        existingContract
                            ? "Vigente"
                            : cell.classList.contains("is-contract-range")
                                ? "Nuevo"
                                : ""
                    )
                    : turnoLabel(state)
            }</small>
        `;

        html += cell.outerHTML;
    }

    html += `
        </div>
        <p class="profile-mini-help">
            ${canPick
                ? (
                    isReplacementRotation
                        ? "Selecciona inicio y termino del contrato de reemplazo."
                        : "Selecciona aqui desde que fecha se aplicara la rotativa escogida."
                )
                : "Presiona Crear Nuevo o Editar y escoge una rotativa para seleccionar fecha."}
        </p>
    `;

    DOM.profileRotationMiniCalendar.innerHTML = html;

    document.getElementById("profileMiniPrev").onclick = () => {
        profileRotationMiniDate.setMonth(
            profileRotationMiniDate.getMonth() - 1
        );
        renderDashboardState();
    };

    document.getElementById("profileMiniNext").onclick = () => {
        profileRotationMiniDate.setMonth(
            profileRotationMiniDate.getMonth() + 1
        );
        renderDashboardState();
    };

    DOM.profileRotationMiniCalendar
        .querySelectorAll(".profile-mini-day.is-pickable")
        .forEach(button => {
            button.onclick = () => {
                if (profileDraft.rotationType === "reemplazo") {
                    handleContractDatePick(button.dataset.key);
                    return;
                }

                const date = parseKey(button.dataset.key);

                profileDraft.rotationStart = toInputDate(date);
                renderDashboardState();
            };
        });
}

function renderProfileDocs(data, editing) {
    if (!DOM.profileDocsList) return;

    const docs = Array.isArray(data.docs) ? data.docs : [];

    if (!docs.length) {
        DOM.profileDocsList.innerHTML = `
            <div class="attachment-empty">
                Sin documentos adjuntos.
            </div>
        `;
        return;
    }

    DOM.profileDocsList.innerHTML = docs
        .map((doc, index) => `
            <div class="attachment-item">
                <span>
                    <strong>${escapeHTML(doc.name)}</strong>
                    <small>
                        ${doc.type ? escapeHTML(doc.type) : "Archivo"}
                        ${doc.dataUrl ? "" : " | volver a adjuntar para visualizar"}
                    </small>
                </span>
                <span class="attachment-actions">
                    <button class="secondary-button attachment-view" type="button" data-doc-view="${index}" ${doc.dataUrl ? "" : "disabled"}>
                        Ver
                    </button>
                ${editing ? `
                    <button class="ghost-button attachment-remove" type="button" data-doc-index="${index}">
                        Quitar
                    </button>
                ` : ""}
                </span>
            </div>
        `)
        .join("");

    DOM.profileDocsList
        .querySelectorAll("[data-doc-view]")
        .forEach(button => {
            button.onclick = () => {
                const doc = docs[Number(button.dataset.docView)];
                openAttachment(doc);
            };
        });

    DOM.profileDocsList
        .querySelectorAll("[data-doc-index]")
        .forEach(button => {
            button.onclick = () => {
                profileDraft.docs = profileDraft.docs.filter(
                    (_doc, index) =>
                        index !== Number(button.dataset.docIndex)
                );
                renderDashboardState();
            };
        });
}

function renderRecordField(field, recordKey) {
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

function renderRecordEntry(config, entry) {
    const values = config.fields
        .map(field => {
            const value = entry[field.name];
            const displayValue =
                field.type === "date" && value
                    ? formatDisplayDate(value)
                    : value;

            return `
                <span>
                    <strong>${field.label}:</strong>
                    ${escapeHTML(displayValue || "Sin dato")}
                </span>
            `;
        })
        .join("");

    return `
        <article class="record-item">
            <div class="record-item__values">
                ${values}
            </div>
            ${renderAttachmentName(entry)}
        </article>
    `;
}

function renderRecordCard(config, logs, editing) {
    const entries = logs[config.key] || [];
    const years = Array.from(
        new Set(entries.map(getRecordYear).filter(Boolean))
    ).sort((a, b) => b.localeCompare(a));
    const selectedYear = recordYearFilters[config.key] || "all";
    const filteredEntries =
        config.filterYear && selectedYear !== "all"
            ? entries.filter(entry =>
                getRecordYear(entry) === selectedYear
            )
            : entries;

    const filterHTML = config.filterYear
        ? `
            <label class="record-year-filter">
                <span>Ano</span>
                <select data-record-filter="${config.key}">
                    <option value="all">Todos</option>
                    ${years.map(year => `
                        <option value="${year}" ${year === selectedYear ? "selected" : ""}>
                            ${year}
                        </option>
                    `).join("")}
                </select>
            </label>
        `
        : "";
    const fileHTML = config.fileLabel
        ? `
            <label class="record-field">
                <span>${config.fileLabel}</span>
                <input data-record-file type="file" accept="application/pdf,image/*">
            </label>
        `
        : "";

    return `
        <section class="record-card" data-record="${config.key}">
            <div class="record-card__head">
                <h4>${config.title}</h4>
                ${filterHTML}
            </div>

            ${editing ? `
                <div class="record-form">
                    ${config.fields.map(field =>
                        renderRecordField(field, config.key)
                    ).join("")}
                    ${fileHTML}
                    <button class="secondary-button record-add" type="button" data-record-add="${config.key}">
                        Agregar registro
                    </button>
                </div>
            ` : ""}

            <div class="record-list">
                ${filteredEntries.length
                    ? filteredEntries
                        .slice()
                        .reverse()
                        .map(entry => renderRecordEntry(config, entry))
                        .join("")
                    : `
                        <div class="empty-state empty-state--compact">
                            Sin registros.
                        </div>
                    `}
            </div>
        </section>
    `;
}

function addProfileRecord(profileName, config) {
    const card =
        DOM.profileRecordsPanel?.querySelector(
            `[data-record="${config.key}"]`
        );

    if (!card) return;

    const entry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        createdAt: new Date().toISOString()
    };

    config.fields.forEach(field => {
        entry[field.name] =
            card.querySelector(`[data-field="${field.name}"]`)
                ?.value
                .trim() || "";
    });

    const file = card.querySelector("[data-record-file]")?.files?.[0];

    if (file) {
        entry.file = normalizeAttachmentFiles([file])[0];
    }

    const hasData =
        config.fields.some(field => entry[field.name]) ||
        Boolean(entry.file);

    if (!hasData) {
        alert("Completa al menos un dato antes de agregar el registro.");
        return;
    }

    const logs = getProfileLogs(profileName);

    logs[config.key].push(entry);
    saveProfileLogs(profileName, logs);

    addAuditLog(
        AUDIT_CATEGORY.COLLABORATOR_UPDATED,
        "Agrego registro RRHH",
        `${profileName}: ${config.title}.`,
        {
            profile: profileName,
            recordType: config.key
        }
    );

    renderProfileRecords(getPerfilActual(), true);
}

function renderProfileRecords(profile, editing) {
    if (!DOM.profileRecordsPanel) return;

    if (!profile || profileDraft.mode === PROFILE_MODE.CREATE) {
        DOM.profileRecordsPanel.innerHTML = `
            <div class="empty-state empty-state--compact">
                Guarda el perfil para comenzar a registrar antecedentes RRHH.
            </div>
        `;
        return;
    }

    const logs = getProfileLogs(profile.name);

    DOM.profileRecordsPanel.innerHTML = HR_LOG_CONFIG
        .map(config => renderRecordCard(config, logs, editing))
        .join("");

    DOM.profileRecordsPanel
        .querySelectorAll("[data-record-filter]")
        .forEach(select => {
            select.onchange = () => {
                recordYearFilters[select.dataset.recordFilter] =
                    select.value;
                renderProfileRecords(profile, editing);
            };
        });

    DOM.profileRecordsPanel
        .querySelectorAll("[data-record-add]")
        .forEach(button => {
            button.onclick = () => {
                const config = HR_LOG_CONFIG.find(item =>
                    item.key === button.dataset.recordAdd
                );

                if (config) {
                    addProfileRecord(profile.name, config);
                }
            };
        });
}

function renderDisponibilidadVacaciones() {
    if (!DOM.availabilitySummary) return;

    const profile = getPerfilActual();

    if (!profile) {
        availabilityEditMode = false;

        DOM.availabilitySummary.innerHTML = `
            <div class="availability-empty">
                Selecciona un colaborador para ver sus saldos.
            </div>
        `;

        if (DOM.availabilityEditBtn) {
            DOM.availabilityEditBtn.textContent = "EDITAR";
            DOM.availabilityEditBtn.disabled = true;
        }

        return;
    }

    const saldos = getLeaveBalances();
    const licencias = Object.keys(getAbsences()).length;
    const year = new Date().getFullYear();
    const showCompBalance = isProfileEditing()
        ? Boolean(profileDraft.shiftAssigned)
        : getShiftAssigned(profile.name);

    if (DOM.availabilityEditBtn) {
        DOM.availabilityEditBtn.textContent =
            availabilityEditMode ? "GUARDAR" : "EDITAR";
        DOM.availabilityEditBtn.disabled = false;
    }

    if (availabilityEditMode) {
        DOM.availabilitySummary.innerHTML = `
            <div class="availability-list">
                <label class="availability-item">
                    <span>FL</span>
                    <input id="availabilityLegalInput" type="number" min="0" step="0.5" value="${saldos.legal}">
                </label>

                ${showCompBalance ? `
                    <label class="availability-item">
                        <span>FC</span>
                        <input id="availabilityCompInput" type="number" min="0" step="1" value="${saldos.comp}">
                    </label>
                ` : ""}

                <label class="availability-item">
                    <span>ADM</span>
                    <input id="availabilityAdminInput" type="number" min="0" step="0.5" value="${saldos.admin}">
                </label>
            </div>

            <div class="availability-note">
                Editando saldos vigentes del ano ${year}. Licencias medicas cargadas: ${licencias}
            </div>
        `;

        return;
    }

    DOM.availabilitySummary.innerHTML = `
        <div class="availability-list">
            <div class="availability-item">
                <span>FL</span>
                <strong>${formatSaldo(saldos.legal)} dias</strong>
            </div>

            ${showCompBalance ? `
                <div class="availability-item">
                    <span>FC</span>
                    <strong>${formatSaldo(saldos.comp)} reg.</strong>
                </div>
            ` : ""}

            <div class="availability-item">
                <span>ADM</span>
                <strong>${formatSaldo(saldos.admin)} dias</strong>
            </div>
        </div>

        <div class="availability-note">
            Saldos vigentes del ano ${year}. Licencias medicas cargadas: ${licencias}
        </div>
    `;
}

function renderLeaveActionLabels() {
    const profile = getPerfilActual();
    const adminBase = "P. ADMINISTRATIVO";
    const compBase = "F. COMPENSATORIO";
    const legalBase = "F. LEGAL";

    if (!profile || !isProfileActive(profile)) {
        DOM.adminBtnLabel.textContent = adminBase;
        DOM.compBtnLabel.textContent = compBase;
        DOM.legalBtnLabel.textContent = legalBase;
        DOM.adminBtn.disabled = true;
        DOM.halfAdminMorningBtn.disabled = true;
        DOM.halfAdminAfternoonBtn.disabled = true;
        DOM.compBtn.disabled = true;
        DOM.legalBtn.disabled = true;
        DOM.licenseBtn.disabled = true;
        DOM.professionalLicenseBtn.disabled = true;
        DOM.unpaidLeaveBtn.disabled = true;
        DOM.unjustifiedAbsenceBtn.disabled = true;
        if (profile && !isProfileActive(profile)) {
            DOM.adminBtnLabel.textContent = `${adminBase} (inactivo)`;
            DOM.compBtnLabel.textContent = `${compBase} (inactivo)`;
            DOM.legalBtnLabel.textContent = `${legalBase} (inactivo)`;
        }

        return;
    }

    const saldos = getLeaveBalances();

    DOM.adminBtnLabel.textContent =
        `${adminBase} (${formatSaldo(saldos.admin)})`;
    DOM.compBtnLabel.textContent =
        `${compBase} (${formatSaldo(saldos.comp)})`;
    DOM.legalBtnLabel.textContent =
        `${legalBase} (${formatSaldo(saldos.legal)})`;

    DOM.adminBtn.disabled = saldos.admin <= 0;
    DOM.halfAdminMorningBtn.disabled = saldos.admin <= 0;
    DOM.halfAdminAfternoonBtn.disabled = saldos.admin <= 0;
    DOM.compBtn.disabled = saldos.comp <= 0;
    DOM.legalBtn.disabled = saldos.legal <= 0;
    DOM.licenseBtn.disabled = false;
    DOM.professionalLicenseBtn.disabled = false;
    DOM.unpaidLeaveBtn.disabled = false;
    DOM.unjustifiedAbsenceBtn.disabled = false;
}

function renderDashboardState() {
    const profile = getPerfilActual();
    const data = getDisplayedProfileData();
    const editing = isProfileEditing();

    DOM.profileNameInput.value = data.name || "";
    DOM.profileEmailInput.value = data.email || "";
    DOM.profileRutInput.value = data.rut || "";
    DOM.profilePhoneInput.value = data.phone || "";
    DOM.profileBirthDateInput.value = data.birthDate || "";
    DOM.profileUnitInput.value = data.unit || "";
    DOM.profileUnitEntryDateInput.value = data.unitEntryDate || "";
    DOM.profileContractTypeSelect.value = data.contractType || "";
    DOM.profileRoleSelect.value = data.estamento || "";
    DOM.profileGradeSelect.value = data.grade || "";
    DOM.profileRotationSelect.value = data.rotationType || "";
    DOM.checkbox.checked = Boolean(data.shiftAssigned);
    DOM.valorHoraInput.value = data.valorHora;
    DOM.profileActiveToggle.checked = data.active !== false;

    DOM.profileNameInput.disabled = !editing;
    DOM.profileEmailInput.disabled = !editing;
    DOM.profileRutInput.disabled = !editing;
    DOM.profilePhoneInput.disabled = !editing;
    DOM.profileBirthDateInput.disabled = !editing;
    DOM.profileDocsInput.disabled = !editing;
    DOM.profileUnitInput.disabled = !editing;
    DOM.profileUnitEntryDateInput.disabled = !editing;
    DOM.profileContractTypeSelect.disabled = !editing;
    DOM.profileRoleSelect.disabled = !editing;
    DOM.profileGradeSelect.disabled = !editing;
    DOM.profileRotationSelect.disabled = !editing;
    DOM.checkbox.disabled = !editing;
    DOM.valorHoraInput.disabled = !editing;
    DOM.profileActiveToggle.disabled =
        profileDraft.mode === PROFILE_MODE.CREATE
            ? false
            : !profile;

    const isReplacementRotation =
        data.rotationType === "reemplazo";

    if (DOM.replacementContractEditor) {
        DOM.replacementContractEditor.classList.toggle(
            "hidden",
            !isReplacementRotation
        );
    }

    if (DOM.replacementTargetInput) {
        DOM.replacementTargetInput.value =
            data.contractReplaces || "";
        DOM.replacementTargetInput.disabled =
            !editing || !isReplacementRotation;
    }

    if (DOM.replacementContractStatus) {
        if (!isReplacementRotation) {
            DOM.replacementContractStatus.textContent = "";
        } else if (editing) {
            DOM.replacementContractStatus.textContent =
                data.contractStart && data.contractEnd
                    ? `Contrato seleccionado: ${formatDisplayDate(data.contractStart)} al ${formatDisplayDate(data.contractEnd)}.`
                    : data.contractStart
                        ? `Inicio seleccionado: ${formatDisplayDate(data.contractStart)}. Falta marcar termino.`
                        : "Selecciona inicio y termino del contrato en el mini calendario.";
        } else {
            const contracts = profile
                ? getContractsForProfile(profile.name)
                : [];

            DOM.replacementContractStatus.innerHTML = contracts.length
                ? contracts
                    .map(contract =>
                        `${formatContractDate(contract.start)} - ${formatContractDate(contract.end)} | ${contract.replaces}`
                    )
                    .join("<br>")
                : "Sin contratos registrados.";
        }
    }

    DOM.profileRotationStatus.textContent =
        buildRotationStatus(data);

    renderProfileRotationMiniCalendar();
    renderProfileHoursSummary(profile);
    renderProfileDocs(data, editing);
    renderProfileRecords(profile, editing);

    DOM.profileEditorHint.textContent =
        buildEditorHint(profile);

    DOM.openCreateProfileBtn.textContent =
        profileDraft.mode === PROFILE_MODE.CREATE
            ? "GUARDAR"
            : "CREAR NUEVO";

    DOM.openEditProfileBtn.textContent =
        profileDraft.mode === PROFILE_MODE.EDIT
            ? "GUARDAR"
            : "EDITAR";

    DOM.openCreateProfileBtn.disabled =
        profileDraft.mode === PROFILE_MODE.EDIT;

    DOM.openEditProfileBtn.disabled =
        profileDraft.mode === PROFILE_MODE.CREATE ||
        (!profile && profileDraft.mode !== PROFILE_MODE.EDIT);

    if (DOM.printHoursReportBtn) {
        DOM.printHoursReportBtn.disabled =
            !profile || profileDraft.mode === PROFILE_MODE.CREATE;
    }

    renderLeaveActionLabels();
    renderDisponibilidadVacaciones();
    if (document.body.dataset.activeView === "hours") {
        renderHoursCharts(profile);
    }
    updateTurnChangesNavState();
}

window.renderDashboardState = renderDashboardState;

function renderBotones() {
    const hasProfile = Boolean(getCurrentProfile());
    const activeProfile = isProfileActive(getCurrentProfile());
    const shiftAssigned = isProfileEditing()
        ? Boolean(profileDraft.shiftAssigned)
        : getShiftAssigned();

    DOM.compBtn.classList.toggle(
        "hidden",
        !hasProfile || !activeProfile || !shiftAssigned
    );

    updateTurnChangesNavState();
}

function updateTurnChangesNavState() {
    const button =
        document.getElementById("turnChangesNav") ||
        document.querySelector("[data-target='turnChangesView']");

    if (!button) return;

    const currentProfile = getCurrentProfile();
    const rotativa = currentProfile
        ? getRotativa(currentProfile)
        : { type: "" };
    const disabled =
        !currentProfile ||
        !isProfileActive(currentProfile) ||
        rotativa.type === "diurno";

    button.disabled = disabled;
    button.classList.toggle("is-disabled", disabled);
    button.title = disabled
        ? "Cambios de turno no disponible para perfiles desactivados o con rotativa Diurno."
        : "";

    if (
        disabled &&
        document.body.dataset.activeView === "swap"
    ) {
        setActiveShortcut("calendarPanel");
    }
}

function getViewForTarget(targetId) {
    if (
        targetId === "profileSection" ||
        targetId === "availabilitySummary"
    ) {
        return "profile";
    }

    if (targetId === "hoursPanel") {
        return "hours";
    }

    if (targetId === "turnChangesView") {
        return "swap";
    }

    if (targetId === "auditLogPanel") {
        return "log";
    }

    if (targetId === "staffingPanel") {
        return "staffing";
    }

    return "turnos";
}

function setDashboardView(view) {
    document.body.dataset.activeView = view;
}

function setActiveShortcut(targetId) {
    const nextView = getViewForTarget(targetId);

    if (nextView === "profile" && selectionMode) {
        clearSelectionMode(false);
    }

    setDashboardView(nextView);

    if (nextView === "hours") {
        renderHoursCharts(getPerfilActual());
    }

    if (nextView === "log") {
        renderAuditLogPanel();
    }

    document
        .querySelectorAll(".nav-tile[data-target]")
        .forEach(button => {
            button.classList.toggle(
                "is-active",
                button.dataset.target === targetId
            );
        });
}

function renderProfiles() {
    const profiles = getProfiles();
    const showInactive =
        DOM.showInactiveProfiles?.checked ?? true;
    const selectableProfiles = profiles.filter(profile =>
        showInactive || isProfileActive(profile)
    );

    if (
        profiles.length > 0 &&
        !profiles.some(
            profile => profile.name === getCurrentProfile()
        ) &&
        profileDraft.mode === PROFILE_MODE.VIEW
    ) {
        setCurrentProfile(selectableProfiles[0]?.name || null);
    }

    if (
        profileDraft.mode === PROFILE_MODE.VIEW &&
        getCurrentProfile() &&
        !selectableProfiles.some(profile =>
            profile.name === getCurrentProfile()
        )
    ) {
        setCurrentProfile(selectableProfiles[0]?.name || null);
    }

    const current = getCurrentProfile();
    const filtro = DOM.filterRole.value;
    const query =
        DOM.profileSearch.value
            .trim()
            .toLowerCase();

    DOM.profiles.innerHTML = "";

    const visibles = profiles.filter(profile => {
        const matchActive =
            showInactive || isProfileActive(profile);
        const matchRole =
            filtro === "Todos" ||
            profile.estamento === filtro;

        const matchSearch =
            !query ||
            profile.name.toLowerCase().includes(query) ||
            profile.estamento.toLowerCase().includes(query) ||
            String(profile.email || "").toLowerCase().includes(query) ||
            String(profile.rut || "").toLowerCase().includes(query);

        return matchActive && matchRole && matchSearch;
    });

    if (!visibles.length) {
        DOM.emptyProfiles.classList.remove("hidden");
        DOM.emptyProfiles.textContent = profiles.length
            ? "No hay resultados con ese filtro."
            : "Aun no hay colaboradores creados.";
    } else {
        DOM.emptyProfiles.classList.add("hidden");
    }

    visibles.forEach(profile => {
        const item = document.createElement("div");
        item.className = "profile-item";

        if (!isProfileActive(profile)) {
            item.classList.add("is-inactive");
        }

        if (
            profile.name === current &&
            profileDraft.mode !== PROFILE_MODE.CREATE
        ) {
            item.classList.add("active");
        }

        const avatar = document.createElement("div");
        avatar.className = "profile-item__avatar";
        avatar.textContent =
            profile.name.trim().charAt(0).toUpperCase() || "T";

        const content = document.createElement("div");
        content.className = "profile-item__content";

        const name = document.createElement("strong");
        name.textContent = profile.name;

        const meta = document.createElement("span");
        meta.textContent = isProfileActive(profile)
            ? profile.estamento
            : `${profile.estamento} | Desactivado`;

        content.append(name, meta);
        item.append(avatar, content);

        item.onclick = () => {
            clearSelectionMode(false);
            clearDraftValues();
            availabilityEditMode = false;
            profileDraft.mode = PROFILE_MODE.VIEW;
            setCurrentProfile(profile.name);
            renderProfiles();
            renderBotones();
            refreshAll();
        };

        DOM.profiles.appendChild(item);
    });

    renderDashboardState();
}

function clearSelectionMode(shouldRefresh = true) {
    selectionMode = null;
    window.selectionMode = null;
    compCantidad = 0;
    window.compCantidad = 0;
    licenseCantidad = 0;
    licenseType = "license";
    window.licenseCantidad = 0;
    window.licenseType = "license";

    document.body.classList.remove("mode-active");
    document.body.removeAttribute("data-mode");

    DOM.selectorInfo.classList.add("hidden");
    DOM.selectorInfo.innerHTML = "";
    DOM.adminInfo.classList.add("hidden");

    if (shouldRefresh) {
        refreshAll();
    }
}

function activarModo(modo, texto) {
    if (!canModifyCurrentProfile()) return;

    selectionMode = modo;
    window.selectionMode = modo;

    document.body.classList.add("mode-active");
    document.body.dataset.mode = modo;

    DOM.selectorInfo.innerHTML = `
        <div class="mode-banner">
            <span>${texto}</span>
            <button id="cancelModeBtn" type="button">Cancelar</button>
        </div>
    `;

    DOM.selectorInfo.classList.remove("hidden");
    DOM.adminInfo.textContent =
        "Selecciona una fecha en el calendario para continuar.";
    DOM.adminInfo.classList.remove("hidden");

    document
        .getElementById("cancelModeBtn")
        .onclick = () => clearSelectionMode();

    refreshAll();
}

function startCreateMode() {
    clearSelectionMode(false);
    clearDraftValues();
    availabilityEditMode = false;
    profileRotationMiniDate = new Date();

    profileDraft.mode = PROFILE_MODE.CREATE;
    setCurrentProfile(null);

    renderProfiles();
    renderBotones();
    refreshAll();
    setActiveShortcut("profileSection");
    DOM.profileNameInput.focus();
}

function startEditMode() {
    const profile = getPerfilActual();
    if (!profile) return;

    clearSelectionMode(false);
    availabilityEditMode = false;
    loadDraftFromProfile(profile);
    profileRotationMiniDate = profileDraft.rotationStart
        ? parseInputDate(profileDraft.rotationStart)
        : new Date();
    profileDraft.mode = PROFILE_MODE.EDIT;

    renderDashboardState();
    renderBotones();
    refreshAll();
    setActiveShortcut("profileSection");
    DOM.profileNameInput.focus();
    DOM.profileNameInput.select();
}

function startReplacementContractEdit(profileName, keyDay) {
    const profile = getProfiles().find(item =>
        item.name === profileName
    );

    if (!profile) return;

    clearSelectionMode(false);
    availabilityEditMode = false;
    setCurrentProfile(profileName);
    loadDraftFromProfile(profile);
    profileDraft.mode = PROFILE_MODE.EDIT;
    profileDraft.rotationType = "reemplazo";
    profileDraft.contractStart =
        calendarKeyToInputDate(keyDay);
    profileDraft.contractEnd = "";
    profileDraft.contractReplaces = "";
    profileRotationMiniDate = parseKey(keyDay);

    renderProfiles();
    renderBotones();
    refreshAll();
    setActiveShortcut("profileSection");

    DOM.replacementTargetInput?.focus();
}

window.startReplacementContractEdit =
    startReplacementContractEdit;

function exitProfileMode(selectedName = getCurrentProfile()) {
    clearSelectionMode(false);
    clearDraftValues();
    availabilityEditMode = false;
    profileDraft.mode = PROFILE_MODE.VIEW;

    setCurrentProfile(selectedName || null);
    renderProfiles();
    renderBotones();
}

function handleRotationSelectionChange() {
    if (!isProfileEditing()) return;

    profileDraft.rotationType =
        DOM.profileRotationSelect.value;
    profileDraft.rotationStart = "";
    profileDraft.contractStart = "";
    profileDraft.contractEnd = "";
    profileDraft.contractReplaces = "";

    if (!profileDraft.rotationType) {
        clearSelectionMode(false);
        renderDashboardState();
        refreshAll();
        return;
    }

    renderDashboardState();
    setActiveShortcut("profileSection");
}

function hasPendingReplacementContract() {
    return Boolean(
        profileDraft.contractStart ||
        profileDraft.contractEnd ||
        profileDraft.contractReplaces.trim()
    );
}

function requiresReplacementContract() {
    if (profileDraft.rotationType !== "reemplazo") {
        return false;
    }

    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return true;
    }

    if (hasRotationChanged()) {
        return true;
    }

    if (hasPendingReplacementContract()) {
        return true;
    }

    const existingContracts =
        getContractsForProfile(
            profileDraft.originalName || getCurrentProfile()
        );

    return existingContracts.length === 0;
}

function validateDraft() {
    const missing = [];
    const requiresRotationStart =
        profileDraft.mode === PROFILE_MODE.CREATE ||
        hasRotationChanged();

    if (!profileDraft.name.trim()) missing.push("nombre");
    if (!profileDraft.estamento) missing.push("estamento");
    if (!profileDraft.rotationType) missing.push("rotativa");
    if (requiresReplacementContract()) {
        if (!profileDraft.contractStart) {
            missing.push("inicio de contrato");
        }

        if (!profileDraft.contractEnd) {
            missing.push("termino de contrato");
        }

        if (!profileDraft.contractReplaces.trim()) {
            missing.push("a quien reemplaza");
        }
    }

    if (
        profileDraft.rotationType !== "reemplazo" &&
        requiresRotationStart &&
        !profileDraft.rotationStart
    ) {
        missing.push("fecha de inicio de rotativa");
    }

    if (
        profileDraft.rotationType === "reemplazo" &&
        profileDraft.contractStart &&
        profileDraft.contractEnd &&
        compareISODate(
            profileDraft.contractEnd,
            profileDraft.contractStart
        ) < 0
    ) {
        alert("La fecha de termino del contrato no puede ser anterior al inicio.");
        return false;
    }

    if (!missing.length) {
        return true;
    }

    alert(
        `Falta completar: ${missing.join(", ")}.`
    );
    return false;
}

function futureKeys(map, startDate) {
    return Object.keys(map || {}).filter(key =>
        isDateKeyOnOrAfter(key, startDate)
    );
}

function pushReturnKey(target, key) {
    const year = key.split("-")[0];

    if (!target[year]) target[year] = [];

    target[year].push(key);
}

async function countBusinessKeys(keys) {
    const holidaysByYear = {};
    let total = 0;

    for (const key of keys) {
        const date = parseKey(key);
        const year = date.getFullYear();

        if (!holidaysByYear[year]) {
            holidaysByYear[year] = await fetchHolidays(year);
        }

        if (isBusinessDay(date, holidaysByYear[year])) {
            total++;
        }
    }

    return total;
}

async function returnBusinessBalances(field, keysByYear) {
    for (const [year, keys] of Object.entries(keysByYear)) {
        const total = await countBusinessKeys(keys);
        incrementManualBalance(field, total, Number(year));
    }
}

function returnAdminBalances(amountByYear) {
    Object.entries(amountByYear).forEach(([year, amount]) => {
        incrementManualBalance("admin", amount, Number(year));
    });
}

function cleanupFutureSwaps(profileName, startISO) {
    const nextSwaps = [];

    getSwaps().forEach(swap => {
        if (cambioEstaAnulado(swap)) {
            nextSwaps.push(swap);
            return;
        }

        if (
            swap.from !== profileName &&
            swap.to !== profileName
        ) {
            nextSwaps.push(swap);
            return;
        }

        const skipFecha =
            Boolean(swap.skipFecha) ||
            (
                swap.fecha &&
                compareISODate(swap.fecha, startISO) >= 0
            );
        const skipDevolucion =
            Boolean(swap.skipDevolucion) ||
            (
                swap.devolucion &&
                compareISODate(swap.devolucion, startISO) >= 0
            );

        if (skipFecha && skipDevolucion) {
            return;
        }

        nextSwaps.push({
            ...swap,
            skipFecha,
            skipDevolucion
        });
    });

    saveSwaps(nextSwaps);
}

async function cleanupFutureSchedule(startDate) {
    const profileName = getCurrentProfile();

    if (!profileName) return;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const returnedLegal = {};
    const returnedComp = {};
    const returnedAdmin = {};
    const startISO = toISODate(startDate);

    futureKeys(data, startDate).forEach(key => {
        delete data[key];
    });

    futureKeys(baseData, startDate).forEach(key => {
        delete baseData[key];
    });

    futureKeys(blocked, startDate).forEach(key => {
        delete blocked[key];
    });

    futureKeys(legal, startDate).forEach(key => {
        delete legal[key];
        pushReturnKey(returnedLegal, key);
    });

    futureKeys(comp, startDate).forEach(key => {
        delete comp[key];
        pushReturnKey(returnedComp, key);
    });

    futureKeys(admin, startDate).forEach(key => {
        const amount = admin[key] === 1 ? 1 : 0.5;
        const year = key.split("-")[0];

        delete admin[key];
        returnedAdmin[year] =
            (returnedAdmin[year] || 0) + amount;
    });

    futureKeys(absences, startDate).forEach(key => {
        delete absences[key];
    });

    cleanupFutureSwaps(profileName, startISO);

    await returnBusinessBalances("legal", returnedLegal);
    await returnBusinessBalances("comp", returnedComp);
    returnAdminBalances(returnedAdmin);

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);
    saveAdminDays(admin);
    saveLegalDays(legal);
    saveCompDays(comp);
    saveAbsences(absences);
}

async function aplicarDiurnoDesde(fecha) {
    if (!getCurrentProfile()) return;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();

    const year = fecha.getFullYear();
    const holidays = await fetchHolidays(year);

    let day = new Date(fecha);

    while (day.getFullYear() === year) {
        const key = keyFromDate(day);

        delete data[key];
        delete baseData[key];
        delete blocked[key];

        if (isBusinessDay(day, holidays)) {
            data[key] = 4;
            baseData[key] = 4;
            blocked[key] = true;
        }

        day.setDate(day.getDate() + 1);
    }

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);
    refreshAll();
}

function aplicarRotativaSecuencialDesde(fecha, secuencia) {
    if (!getCurrentProfile()) return;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();

    let day = new Date(fecha);
    const year = day.getFullYear();

    while (day.getFullYear() === year) {
        for (let i = 0; i < secuencia.length; i++) {
            const key = keyFromDate(day);
            const turno = secuencia[i];

            delete data[key];
            delete baseData[key];
            delete blocked[key];

            if (turno) {
                data[key] = turno;
                baseData[key] = turno;
                blocked[key] = true;
            }

            day.setDate(day.getDate() + 1);
        }
    }

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);
    refreshAll();
}

function aplicarCuartoTurnoDesde(fecha) {
    aplicarRotativaSecuencialDesde(fecha, [1, 2, 0, 0]);
}

function aplicarTercerTurnoDesde(fecha) {
    aplicarRotativaSecuencialDesde(fecha, [1, 1, 2, 2, 0, 0]);
}

async function applyDraftRotation(rotationType, rotationStart) {
    const startDate = parseInputDate(rotationStart);

    await cleanupFutureSchedule(startDate);

    if (rotationType === "reemplazo") {
        refreshAll();
        return;
    }

    if (rotationType === "diurno") {
        await aplicarDiurnoDesde(startDate);
        return;
    }

    if (rotationType === "3turno") {
        aplicarTercerTurnoDesde(startDate);
        return;
    }

    aplicarCuartoTurnoDesde(startDate);
}

async function guardarPerfil() {
    if (!validateDraft()) return;

    const isCreating =
        profileDraft.mode === PROFILE_MODE.CREATE;
    const isEditing =
        profileDraft.mode === PROFILE_MODE.EDIT;
    const previousSnapshot = isEditing
        ? auditProfileSnapshot(profileDraft.originalName)
        : null;
    const nextName = profileDraft.name.trim();
    const nextEstamento = profileDraft.estamento;
    const nextShiftAssigned =
        Boolean(profileDraft.shiftAssigned);
    const nextValorHora =
        sanitizeValorHora(profileDraft.valorHora);
    const nextProfilePayload = {
        name: nextName,
        email: profileDraft.email.trim(),
        rut: formatRut(profileDraft.rut),
        phone: sanitizeDigits(profileDraft.phone, 8),
        birthDate: profileDraft.birthDate,
        docs: Array.isArray(profileDraft.docs)
            ? [...profileDraft.docs]
            : [],
        active: profileDraft.active !== false,
        unit: profileDraft.unit.trim(),
        unitEntryDate: profileDraft.unitEntryDate,
        contractType: profileDraft.contractType,
        estamento: nextEstamento,
        grade: profileDraft.grade
    };
    const nextRotationType =
        profileDraft.rotationType;
    const nextRotationStart =
        nextRotationType === "reemplazo"
            ? (
                profileDraft.contractStart ||
                profileDraft.rotationStart
            )
            : profileDraft.rotationStart;
    const shouldApplyRotation =
        profileDraft.mode === PROFILE_MODE.CREATE ||
        hasRotationChanged();
    const shouldSaveReplacementContract =
        nextRotationType === "reemplazo" &&
        requiresReplacementContract();
    const nextSnapshot = {
        ...nextProfilePayload,
        shiftAssigned: nextShiftAssigned,
        valorHora: nextValorHora,
        rotativa: {
            type: nextRotationType,
            start: nextRotationStart
        }
    };

    try {
        if (isCreating) {
            const profiles = getProfiles();

            if (
                profiles.some(
                    profile => profile.name === nextName
                )
            ) {
                alert("Ese perfil ya existe.");
                return;
            }

            profiles.push(nextProfilePayload);

            saveProfiles(profiles);
            setCurrentProfile(nextName);
        }

        if (isEditing) {
            updateProfile(
                profileDraft.originalName,
                nextProfilePayload
            );

            setCurrentProfile(nextName);
        }

        setShiftAssigned(nextShiftAssigned);
        setValorHora(nextValorHora);
        saveRotativa({
            type: nextRotationType,
            start: nextRotationStart
        });

        if (shouldSaveReplacementContract) {
            addReplacementContract(nextName, {
                start: profileDraft.contractStart,
                end: profileDraft.contractEnd,
                replaces:
                    profileDraft.contractReplaces.trim()
            });
        }

        if (isCreating) {
            addAuditLog(
                AUDIT_CATEGORY.COLLABORATOR_CREATED,
                "Creo nuevo colaborador",
                `${nextName} (${nextEstamento}) con rotativa ${getRotativaLabel(nextRotationType)}.`,
                { profile: nextName }
            );
        }

        if (isEditing) {
            addAuditLog(
                AUDIT_CATEGORY.COLLABORATOR_UPDATED,
                "Modifico datos del colaborador",
                `${profileDraft.originalName} -> ${nextName}. ${describeProfileChanges(previousSnapshot, nextSnapshot)}`,
                { profile: nextName }
            );

            if (
                previousSnapshot &&
                previousSnapshot.active !== nextProfilePayload.active
            ) {
                addAuditLog(
                    AUDIT_CATEGORY.PROFILE_STATUS,
                    nextProfilePayload.active
                        ? "Reactivo perfil"
                        : "Inactivo perfil",
                    `${nextName} quedo ${activeLabel(nextProfilePayload.active)}.`,
                    { profile: nextName }
                );
            }
        }

        exitProfileMode(nextName);
        if (shouldApplyRotation) {
            await applyDraftRotation(
                nextRotationType,
                nextRotationStart
            );

            addAuditLog(
                AUDIT_CATEGORY.CALENDAR,
                "Aplico rotativa base",
                `${nextName}: ${getRotativaLabel(nextRotationType)} desde ${formatDisplayDate(nextRotationStart)}. Se limpiaron programaciones futuras desde esa fecha.`,
                {
                    profile: nextName,
                    date: nextRotationStart,
                    rotationType: nextRotationType
                }
            );
        }
        refreshAll();
    } catch (error) {
        alert(
            error.message ||
            "No se pudo guardar el colaborador."
        );
    }
}

function handleAvailabilityEdit() {
    const profile = getPerfilActual();

    if (!profile) return;
    if (!isProfileActive(profile)) {
        alert("No se pueden editar saldos en un perfil desactivado.");
        return;
    }

    if (!availabilityEditMode) {
        availabilityEditMode = true;
        renderDisponibilidadVacaciones();
        document
            .getElementById("availabilityLegalInput")
            ?.focus();
        return;
    }

    const year = new Date().getFullYear();
    const balances = {
        legal: normalizeBalanceValue(
            document.getElementById("availabilityLegalInput")?.value
        ),
        admin: normalizeBalanceValue(
            document.getElementById("availabilityAdminInput")?.value
        )
    };
    const compInput =
        document.getElementById("availabilityCompInput");

    if (compInput) {
        balances.comp = normalizeBalanceValue(compInput.value);
    }

    saveManualLeaveBalances(year, balances, profile.name);
    addAuditLog(
        AUDIT_CATEGORY.LEAVE_ABSENCE,
        "Modifico saldos de vacaciones",
        `${profile.name}: FL ${formatSaldo(balances.legal)}, ADM ${formatSaldo(balances.admin)}${balances.comp !== undefined ? `, FC ${formatSaldo(balances.comp)}` : ""}.`,
        {
            profile: profile.name,
            year
        }
    );

    availabilityEditMode = false;
    refreshAll();
}

async function activarSelectorLegal() {
    if (!canModifyCurrentProfile()) return;

    const year = new Date().getFullYear();
    const holidays = await fetchHolidays(year);
    const saldo = getLeaveBalances(year, holidays).legal;

    if (saldo <= 0) {
        alert("No quedan dias de feriado legal.");
        return;
    }

    const cantidad = Number(
        prompt(
            `Cuantos dias deseas cargar? Disponibles: ${saldo}`
        )
    );

    if (!cantidad || cantidad <= 0) return;

    const validacion =
        await validarCantidadLegalAnual(cantidad, year);

    if (!validacion.ok) {
        alert(validacion.message);
        return;
    }

    legalCantidad = cantidad;

    activarModo(
        "legal",
        "Selecciona un dia habil para iniciar el feriado legal. Los dias inhabiles y ausencias incompatibles quedaran bloqueados."
    );
}

function activarSelectorComp() {
    if (!canModifyCurrentProfile()) return;

    const saldo = getLeaveBalances().comp;
    const cantidad = Number(saldo);

    if (saldo <= 0) {
        alert("No quedan feriados compensatorios disponibles.");
        return;
    }

    if (!Number.isInteger(cantidad)) {
        alert("El saldo de F. Compensatorio debe ser un numero entero para aplicar el bloque completo.");
        return;
    }

    if (!getShiftAssigned()) {
        alert("Solo disponible con asignacion de turno activa.");
        return;
    }

    compCantidad = cantidad;
    window.compCantidad = cantidad;

    activarModo(
        "comp",
        `Selecciona un dia habil para iniciar el bloque completo de ${formatSaldo(cantidad)} F. Compensatorio. Deben haber pasado 90 dias corridos desde el ultimo F. Legal.`
    );
}

function getLicenseTypeLabel(type) {
    if (type === "professional_license") return "LM Profesional";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    return "Licencia Medica";
}

function activarSelectorLicencia(type = "license") {
    if (!canModifyCurrentProfile()) return;

    const cantidad = Number(
        prompt(`Cuantos dias dura ${getLicenseTypeLabel(type)}?`)
    );

    if (!cantidad || cantidad <= 0) return;

    licenseCantidad = cantidad;
    licenseType = type;
    window.licenseCantidad = cantidad;
    window.licenseType = type;

    activarModo(
        "license",
        `Selecciona el inicio de ${getLicenseTypeLabel(type)}. Se contara en dias corridos.`
    );
}

function activarSelectorAdmin() {
    if (!canModifyCurrentProfile()) return;

    const saldo = getLeaveBalances().admin;

    if (saldo <= 0) {
        alert("Ya se utilizaron los 6 permisos administrativos.");
        return;
    }

    if (saldo < 1) {
        alert(
            `Saldo insuficiente. El saldo disponible (${formatSaldo(saldo)}) solo permite aplicar 1/2 ADM Manana o 1/2 ADM Tarde.`
        );
        return;
    }

    adminCantidad = 1;

    activarModo(
        "admin",
        getShiftAssigned()
            ? "Selecciona un turno Larga o Noche valido para el permiso administrativo."
            : "Selecciona un turno Larga o Noche en dia habil para el permiso administrativo."
    );
}

function activarSelectorHalfAdmin(tipo) {
    if (!canModifyCurrentProfile()) return;

    if (getLeaveBalances().admin <= 0) {
        alert("No quedan permisos administrativos disponibles.");
        return;
    }

    window.halfAdminTipo = tipo;

    activarModo(
        "halfadmin",
        tipo === "M"
            ? "Selecciona el medio dia administrativo de manana"
            : "Selecciona el medio dia administrativo de tarde"
    );
}

function activarSelectorAusenciaInjustificada() {
    if (!canModifyCurrentProfile()) return;

    activarModo(
        "unjustified",
        "Selecciona uno por uno los turnos donde se aplicara la ausencia injustificada."
    );

    DOM.adminInfo.textContent =
        "Solo quedan habilitados los dias con turno real del trabajador. Puedes marcar varios turnos y presionar Cancelar para terminar.";
}

function applyTheme(theme) {
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(`theme-${theme}`);
    DOM.themeToggle.setAttribute(
        "aria-pressed",
        theme === "dark" ? "true" : "false"
    );
}

function initTheme() {
    const savedTheme = getRaw(THEME_KEY, "");
    const prefersLight =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: light)").matches;

    const initialTheme =
        savedTheme || (prefersLight ? "light" : "dark");

    applyTheme(initialTheme);

    DOM.themeToggle.onclick = () => {
        const nextTheme =
            document.body.classList.contains("theme-dark")
                ? "light"
                : "dark";

        setRaw(THEME_KEY, nextTheme);
        applyTheme(nextTheme);
    };
}

function bindProfileForm() {
    DOM.profileNameInput.oninput = () => {
        if (!isProfileEditing()) return;
        profileDraft.name = DOM.profileNameInput.value;
    };

    DOM.profileEmailInput.oninput = () => {
        if (!isProfileEditing()) return;
        profileDraft.email = DOM.profileEmailInput.value.trim();
    };

    DOM.profileRutInput.oninput = () => {
        if (!isProfileEditing()) return;
        const formatted = formatRut(DOM.profileRutInput.value);
        DOM.profileRutInput.value = formatted;
        profileDraft.rut = formatted;
    };

    DOM.profilePhoneInput.oninput = () => {
        if (!isProfileEditing()) return;
        const phone = sanitizeDigits(DOM.profilePhoneInput.value, 8);
        DOM.profilePhoneInput.value = phone;
        profileDraft.phone = phone;
    };

    DOM.profileBirthDateInput.onchange = () => {
        if (!isProfileEditing()) return;
        profileDraft.birthDate = DOM.profileBirthDateInput.value;
    };

    DOM.profileDocsInput.onchange = async () => {
        if (!isProfileEditing()) return;

        try {
            const attachments =
                await readAttachmentFiles(DOM.profileDocsInput.files);

            profileDraft.docs = [
                ...profileDraft.docs,
                ...attachments
            ];
            DOM.profileDocsInput.value = "";
            renderDashboardState();
        } catch {
            alert("No se pudo leer el archivo adjunto. Intenta nuevamente con otro documento.");
        }
    };

    DOM.profileUnitInput.oninput = () => {
        if (!isProfileEditing()) return;
        profileDraft.unit = DOM.profileUnitInput.value;
    };

    DOM.profileUnitEntryDateInput.onchange = () => {
        if (!isProfileEditing()) return;
        profileDraft.unitEntryDate =
            DOM.profileUnitEntryDateInput.value;
    };

    DOM.profileContractTypeSelect.onchange = () => {
        if (!isProfileEditing()) return;
        profileDraft.contractType =
            DOM.profileContractTypeSelect.value;
    };

    DOM.profileRoleSelect.onchange = () => {
        if (!isProfileEditing()) return;
        profileDraft.estamento =
            DOM.profileRoleSelect.value;
    };

    DOM.profileGradeSelect.onchange = () => {
        if (!isProfileEditing()) return;
        profileDraft.grade = DOM.profileGradeSelect.value;
    };

    DOM.profileRotationSelect.onchange =
        handleRotationSelectionChange;

    if (DOM.replacementTargetInput) {
        DOM.replacementTargetInput.oninput = () => {
            if (!isProfileEditing()) return;

            profileDraft.contractReplaces =
                DOM.replacementTargetInput.value;
        };
    }

    DOM.checkbox.onchange = () => {
        if (isProfileEditing()) {
            profileDraft.shiftAssigned =
                DOM.checkbox.checked;
            renderBotones();
            return;
        }

        if (!getCurrentProfile()) return;

        setShiftAssigned(DOM.checkbox.checked);
        addAuditLog(
            AUDIT_CATEGORY.COLLABORATOR_UPDATED,
            "Modifico asignacion de turno",
            `${getCurrentProfile()}: asignacion de turno ${yesNoLabel(DOM.checkbox.checked)}.`,
            { profile: getCurrentProfile() }
        );
        renderBotones();
        refreshAll();
    };

    DOM.profileActiveToggle.onchange = () => {
        if (isProfileEditing()) {
            profileDraft.active =
                DOM.profileActiveToggle.checked;
            return;
        }

        const profile = getPerfilActual();
        if (!profile) return;

        const nextActive = DOM.profileActiveToggle.checked;
        updateProfile(profile.name, {
            ...profile,
            active: nextActive
        });
        addAuditLog(
            AUDIT_CATEGORY.PROFILE_STATUS,
            nextActive ? "Reactivo perfil" : "Inactivo perfil",
            `${profile.name} quedo ${activeLabel(nextActive)}.`,
            { profile: profile.name }
        );

        renderProfiles();
        refreshAll();
    };

    DOM.valorHoraInput.oninput = () => {
        const sanitized = sanitizeValorHora(
            sanitizeMoney(DOM.valorHoraInput.value)
        );

        DOM.valorHoraInput.value = sanitized;

        if (isProfileEditing()) {
            profileDraft.valorHora = sanitized;
            return;
        }

        if (!getCurrentProfile()) return;

        setValorHora(sanitized);
        refreshAll();
    };

    DOM.valorHoraInput.onchange = () => {
        if (isProfileEditing() || !getCurrentProfile()) return;

        addAuditLog(
            AUDIT_CATEGORY.COLLABORATOR_UPDATED,
            "Modifico valor hora",
            `${getCurrentProfile()}: valor hora ${sanitizeValorHora(DOM.valorHoraInput.value) || "0"}.`,
            { profile: getCurrentProfile() }
        );
    };

    DOM.openCreateProfileBtn.onclick = async () => {
        if (profileDraft.mode === PROFILE_MODE.CREATE) {
            await guardarPerfil();
            return;
        }

        startCreateMode();
    };

    DOM.openEditProfileBtn.onclick = async () => {
        if (profileDraft.mode === PROFILE_MODE.EDIT) {
            await guardarPerfil();
            return;
        }

        startEditMode();
    };

    if (DOM.availabilityEditBtn) {
        DOM.availabilityEditBtn.onclick = handleAvailabilityEdit;
    }

    if (DOM.printHoursReportBtn) {
        DOM.printHoursReportBtn.onclick = () =>
            exportHoursReport(
                getPerfilActual(),
                profileRotationMiniDate
            );
    }
}

function bindShellInteractions() {
    DOM.filterRole.onchange = renderProfiles;
    DOM.profileSearch.oninput = renderProfiles;
    if (DOM.showInactiveProfiles) {
        DOM.showInactiveProfiles.onchange = renderProfiles;
    }

    document
        .querySelectorAll(".nav-tile[data-target]")
        .forEach(button => {
            button.onclick = () => {
                const target = document.getElementById(
                    button.dataset.target
                );

                if (!target) return;

                setActiveShortcut(button.dataset.target);
                target.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            };
        });

    document
        .querySelectorAll("[data-editor-mode]")
        .forEach(button => {
            button.onclick = () => startEditMode();
        });
}

DOM.adminBtn.onclick = activarSelectorAdmin;
DOM.halfAdminMorningBtn.onclick =
    () => activarSelectorHalfAdmin("M");
DOM.halfAdminAfternoonBtn.onclick =
    () => activarSelectorHalfAdmin("T");
DOM.legalBtn.onclick = activarSelectorLegal;
DOM.compBtn.onclick = activarSelectorComp;
DOM.licenseBtn.onclick = () => activarSelectorLicencia("license");
DOM.professionalLicenseBtn.onclick =
    () => activarSelectorLicencia("professional_license");
DOM.unpaidLeaveBtn.onclick =
    () => activarSelectorLicencia("unpaid_leave");
DOM.unjustifiedAbsenceBtn.onclick =
    activarSelectorAusenciaInjustificada;

DOM.prevBtn.onclick = prevMonth;
DOM.nextBtn.onclick = nextMonth;

DOM.undoBtn.onclick = () => {
    if (undo()) {
        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Deshizo ultima accion",
            "El usuario revirtio el ultimo cambio guardado en el historial."
        );
        refreshAll();
    }
};

DOM.redoBtn.onclick = () => {
    if (redo()) {
        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Rehizo ultima accion",
            "El usuario reaplico el ultimo cambio revertido en el historial."
        );
        refreshAll();
    }
};

document.addEventListener("click", async event => {
    const celda = event.target.closest(".day");
    if (!celda) return;

    if (selectionMode && !canModifyCurrentProfile()) {
        clearSelectionMode(false);
        return;
    }

    if (
        selectionMode &&
        celda.classList.contains("mpa-disabled")
    ) {
        return;
    }

    const fecha = new Date(
        Number(celda.dataset.year),
        Number(celda.dataset.month),
        Number(celda.dataset.day)
    );

    if (selectionMode === "license") {
        pushHistory();
        const aplicado = await aplicarLicencia(
            fecha,
            licenseCantidad,
            licenseType
        );

        if (!aplicado) {
            alert(
                "No se pudo aplicar esta ausencia. Una Licencia Medica solo puede reemplazarse por una LM Profesional y viceversa; el Permiso sin Goce no puede superponerse sobre licencias existentes."
            );
        }

        clearSelectionMode();
        return;
    }

    if (selectionMode === "unjustified") {
        pushHistory();
        const aplicado =
            aplicarAusenciaInjustificada(fecha);

        if (!aplicado) {
            alert(
                "No se pudo aplicar la ausencia injustificada. Solo puede marcarse sobre dias con turno real y sin permisos, feriados o licencias ya cargadas."
            );
            return;
        }

        refreshAll();
        return;
    }

    if (selectionMode === "comp") {
        pushHistory();
        const aplicado = await aplicarComp(fecha, compCantidad);

        if (aplicado) {
            decrementManualBalance(
                "comp",
                compCantidad,
                fecha.getFullYear()
            );
        } else {
            alert(
                "No se pudo aplicar el F. Compensatorio. Debe iniciar en un dia habil, haber pasado 90 dias corridos desde el ultimo F. Legal y el bloque completo no puede cruzarse con licencias, feriados legales, permisos administrativos, medios ADM, permisos sin goce u otros bloqueos incompatibles."
            );
        }

        clearSelectionMode();
        return;
    }

    if (selectionMode === "legal") {
        pushHistory();
        const aplicado =
            await aplicarLegal(fecha, legalCantidad);

        if (!aplicado) {
            alert(
                "No se pudo aplicar el F. Legal en esa fecha. Revisa que el inicio sea habil, que hayan pasado 90 dias desde el ultimo F. Compensatorio y que el rango no tenga ausencias incompatibles."
            );
        } else {
            decrementManualBalance(
                "legal",
                legalCantidad,
                fecha.getFullYear()
            );
        }

        clearSelectionMode();
        return;
    }

    if (selectionMode === "halfadmin") {
        pushHistory();
        const aplicado = await aplicarHalfAdministrativo(
            fecha,
            window.halfAdminTipo || "M"
        );

        if (aplicado) {
            decrementManualBalance(
                "admin",
                0.5,
                fecha.getFullYear()
            );
        }

        clearSelectionMode();
        return;
    }

    if (selectionMode === "admin") {
        pushHistory();
        const aplicado =
            await aplicarAdministrativo(fecha, adminCantidad);

        if (aplicado) {
            decrementManualBalance(
                "admin",
                adminCantidad,
                fecha.getFullYear()
            );
        }

        clearSelectionMode();
        return;
    }

});

initTheme();
bindProfileForm();
bindShellInteractions();
initHoursCharts(getPerfilActual);
renderStaffingPanel();
renderSwapPanel();
renderProfiles();
renderBotones();

if (getProfiles().length > 0) {
    setActiveShortcut("calendarPanel");
    refreshAll();
} else {
    setActiveShortcut("profileSection");
    renderDashboardState();
    refreshAll();
}
