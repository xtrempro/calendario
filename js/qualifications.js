import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    getProfiles,
    isProfileActive
} from "./storage.js";
import {
    formatDisplayDate,
    keyToDate,
    parseISODate,
    toISODate
} from "./dateUtils.js";
import { buildAttendanceIncidents } from "./hoursReport.js";
import { canEditMenu } from "./workspacePermissions.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    ATTACHMENT_ACCEPT,
    attachmentStorageErrorMessage,
    deleteStoredAttachment,
    hasAttachmentContent,
    openAttachmentFile,
    readAttachmentFiles
} from "./attachmentUtils.js";
import { showAlert, showConfirm } from "./dialogs.js";
import {
    printQualificationForm,
    qualificationFormHTML
} from "./qualificationForm.js";

export const QUALIFICATIONS_KEY = "qualifications";

const STATUS_ALL = "all";
const STATUS_PENDING = "pending";
const STATUS_DRAFT = "draft";
// `evaluated` era el estado final cuando la evaluacion se cerraba dentro de la
// aplicacion. Ahora el cierre lo da el PAPEL: se imprime, lo firman las dos
// partes a mano y vuelve escaneado. Se conserva el nombre viejo para no
// invalidar los registros que ya existen y se leen como "impresa".
const STATUS_EVALUATED = "evaluated";
const STATUS_PRINTED = "printed";
const STATUS_ARCHIVED = "archived";

// La calificacion CON NOTAS es otro instrumento y ocurre una vez al ano, en
// septiembre, apoyada en los tres informes cuatrimestrales ya escritos
// (art. 19). Vive como un "periodo" mas para reutilizar el mismo almacen.
export const ANNUAL_PERIOD_ID = "anual";
const MAX_NOTE_LENGTH = 1600;
const MAX_TEXT_LENGTH = 240;

export const QUALIFICATION_FACTORS = [
    {
        key: "rendimiento",
        label: "Rendimiento",
        detail: "Trabajo ejecutado frente a tareas encomendadas.",
        // Calcado del formulario que reparte la unidad de personal.
        formTitle: "RENDIMIENTO",
        formText: "Mide el trabajo ejecutado durante el periodo en relacion a las tareas encomendadas (Cantidad de trabajo y Calidad de la labor realizada)",
        subfactors: [
            {
                key: "cumplimiento_labor",
                label: "Cumplimiento de la labor",
                detail: "Realizacion, rapidez y oportunidad."
            },
            {
                key: "calidad_labor",
                label: "Calidad de la labor",
                detail: "Ausencia de errores y habilidad."
            }
        ]
    },
    {
        key: "condiciones",
        label: "Condiciones personales",
        detail: "Actitud del funcionario en su vinculacion con los demas.",
        formTitle: "CONDICIONES PERSONALES",
        formText: "Evaluar las aptitudes del funcionario vinculadas con el cumplimiento de las funciones (Condiciones e interes por el trabajo que realiza. Capacidad para realizar trabajos en grupo)",
        subfactors: [
            {
                key: "interes_trabajo",
                label: "Interes por el trabajo",
                detail: "Perfeccionamiento, propuestas y soluciones."
            },
            {
                key: "trabajo_equipo",
                label: "Trabajo en equipo",
                detail: "Integracion y colaboracion eficaz."
            }
        ]
    },
    {
        key: "comportamiento",
        label: "Comportamiento del funcionario",
        detail: "Conducta en el cumplimiento de obligaciones.",
        formTitle: "COMPORTAMIENTO DEL FUNCIONARIO",
        // La errata del original ("del funcionamiento") se conserva: el papel
        // que archiva personal tiene que ser el que ellos reparten.
        formText: "Evaluar la conducta del funcionamiento en el cumplimiento de sus obligaciones (Asistencia y Puntualidad, Responsabilidad, Cumplimiento de normas)",
        subfactors: [
            {
                key: "normas_instrucciones",
                label: "Normas e instrucciones",
                detail: "Respeto de reglamentos y deberes."
            },
            {
                key: "asistencia_puntualidad",
                label: "Asistencia y puntualidad",
                detail: "Presencia y exactitud en la jornada."
            }
        ]
    }
];

export const QUALIFICATION_COEFFICIENTS = Object.freeze({
    directivos: {
        label: "Directivos",
        rendimiento: 4.5,
        condiciones: 3.5,
        comportamiento: 2
    },
    profesionales_tecnicos: {
        label: "Profesionales y tecnicos",
        rendimiento: 4,
        condiciones: 3.5,
        comportamiento: 2.5
    },
    administrativos_auxiliares: {
        label: "Administrativos y auxiliares",
        rendimiento: 4,
        condiciones: 3,
        comportamiento: 3
    }
});

const PERIOD_DEFS = [
    {
        id: "sep-dec",
        label: "Septiembre a diciembre",
        shortLabel: "Sep-Dic",
        startMonth: 8,
        startDay: 1,
        endMonth: 11,
        endDay: 31,
        yearOffset: 0
    },
    {
        id: "jan-apr",
        label: "Enero a abril",
        shortLabel: "Ene-Abr",
        startMonth: 0,
        startDay: 1,
        endMonth: 3,
        endDay: 30,
        yearOffset: 1
    },
    {
        id: "may-aug",
        label: "Mayo a agosto",
        shortLabel: "May-Ago",
        startMonth: 4,
        startDay: 1,
        endMonth: 7,
        endDay: 31,
        yearOffset: 1
    }
];

let selectedCycleStartYear = evaluationCycleStartYear();
let selectedPeriodId = currentPeriodId(new Date(), selectedCycleStartYear);
let selectedStatus = STATUS_ALL;
let selectedProfileKey = "";
let searchText = "";
let searchRenderTimer = null;
let incidentCache = {
    key: "",
    loading: false,
    eventsByProfile: new Map()
};

function clampText(value, maxLength = MAX_TEXT_LENGTH) {
    return String(value || "").trim().slice(0, maxLength);
}

function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
}

function compactKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function rutKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^0-9k]+/g, "");
}

function profileKey(profile = {}) {
    return (
        rutKey(profile.rut) ||
        compactKey(profile.id) ||
        compactKey(profile.name)
    );
}

function makeId(prefix = "qualification") {
    return globalThis.crypto?.randomUUID?.() ||
        `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Las tres apreciaciones escritas del informe cuatrimestral. Es lo unico que
// lleva ese instrumento: las notas van en la calificacion anual.
function normalizeAppraisals(values = {}) {
    return QUALIFICATION_FACTORS.reduce((map, factor) => {
        map[factor.key] = clampText(values?.[factor.key], MAX_NOTE_LENGTH);
        return map;
    }, {});
}

// El formulario firmado que vuelve escaneado. Se guarda la misma forma que el
// resto de adjuntos del proyecto para poder abrirlo con attachmentUtils.
function normalizeScan(value = {}) {
    const name = clampText(value?.name, 240);
    const storagePath = String(value?.storagePath || "");
    const downloadURL = String(value?.downloadURL || "");
    const dataUrl = String(value?.dataUrl || "");

    if (!name || (!storagePath && !downloadURL && !dataUrl)) return null;

    return {
        id: String(value.id || makeId("qual_scan")),
        name,
        type: String(value.type || "application/octet-stream").toLowerCase(),
        size: Number(value.size) || 0,
        addedAt: String(value.addedAt || new Date().toISOString()),
        storagePath,
        downloadURL,
        dataUrl,
        uploadedByUid: String(value.uploadedByUid || "")
    };
}

function validStatus(status) {
    return [
        STATUS_DRAFT,
        STATUS_EVALUATED,
        STATUS_PRINTED,
        STATUS_ARCHIVED
    ].includes(status)
        ? status
        : STATUS_DRAFT;
}

function normalizePlainText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function normalizeScore(value) {
    if (value === "" || value === null || value === undefined) return "";

    const score = Number(value);

    if (!Number.isFinite(score)) return "";

    return Math.min(10, Math.max(1, Math.round(score)));
}

function scoreNumber(value) {
    if (value === "" || value === null || value === undefined) return NaN;

    const score = Number(value);

    return Number.isFinite(score) ? score : NaN;
}

function factorComputedScore(factorValue = {}) {
    const source = factorValue && typeof factorValue === "object"
        ? factorValue
        : {};
    const scores = Object.values(source.subfactors || {})
        .map(item => scoreNumber(item?.score))
        .filter(Number.isFinite);

    if (!scores.length) return scoreNumber(source.score);

    return Number(
        (
            scores.reduce((sum, value) => sum + value, 0) / scores.length
        ).toFixed(2)
    );
}

function normalizeFactorValues(values = {}) {
    return QUALIFICATION_FACTORS.reduce((map, factor) => {
        const source = values?.[factor.key] || {};
        const subfactorSource =
            source.subfactors && typeof source.subfactors === "object"
                ? source.subfactors
                : {};
        const subfactors = {};

        factor.subfactors.forEach(subfactor => {
            subfactors[subfactor.key] = {
                score: normalizeScore(
                    subfactorSource?.[subfactor.key]?.score
                ),
                comment: clampText(
                    subfactorSource?.[subfactor.key]?.comment,
                    MAX_NOTE_LENGTH
                )
            };
        });

        const computedScore = factorComputedScore({ subfactors });
        const fallbackScore = normalizeScore(source.score);

        map[factor.key] = {
            score: Number.isFinite(computedScore)
                ? computedScore
                : fallbackScore,
            subfactors,
            comment: clampText(source.comment, MAX_NOTE_LENGTH)
        };

        return map;
    }, {});
}

function normalizeRecord(record = {}) {
    const cycleStartYear = Number(record.cycleStartYear);

    if (!record?.profileKey || !record?.periodId || !cycleStartYear) {
        return null;
    }

    return {
        id: String(record.id || makeId()),
        profileKey: String(record.profileKey),
        profileName: clampText(record.profileName, 180),
        profileRut: clampText(record.profileRut, 40),
        cycleStartYear,
        periodId: String(record.periodId),
        status: validStatus(record.status),
        // Las notas SOLO las usa la calificacion anual. En un informe
        // cuatrimestral quedan en cero y no se muestran; el campo se conserva
        // porque los registros creados antes de esta separacion las traen.
        factors: normalizeFactorValues(record.factors),
        appraisals: normalizeAppraisals(record.appraisals),
        scan: normalizeScan(record.scan),
        supervisorName: clampText(record.supervisorName, 180),
        supervisorCargo: clampText(record.supervisorCargo, 180),
        observations: clampText(record.observations, MAX_NOTE_LENGTH),
        employeeObservations: clampText(
            record.employeeObservations,
            MAX_NOTE_LENGTH
        ),
        employeeAgreement: record.employeeAgreement === false
            ? "disconforme"
            : record.employeeAgreement === true
                ? "conforme"
                : String(record.employeeAgreement || ""),
        createdAt: String(record.createdAt || new Date().toISOString()),
        updatedAt: String(record.updatedAt || new Date().toISOString()),
        evaluatedAt: String(record.evaluatedAt || "")
    };
}

export function normalizeQualificationState(value = {}) {
    const rawRecords = value?.records && typeof value.records === "object"
        ? value.records
        : {};
    const records = {};

    Object.entries(rawRecords).forEach(([id, record]) => {
        const normalized = normalizeRecord({
            ...record,
            id: record?.id || id
        });

        if (normalized) records[normalized.id] = normalized;
    });

    return { records };
}

export function getQualificationState() {
    return normalizeQualificationState(getJSON(QUALIFICATIONS_KEY, {}));
}

function saveQualificationState(state) {
    setJSON(QUALIFICATIONS_KEY, normalizeQualificationState(state));
}

export function evaluationCycleStartYear(date = new Date()) {
    const parsed = date instanceof Date ? date : new Date(date);
    const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

    return safeDate.getMonth() >= 8
        ? safeDate.getFullYear()
        : safeDate.getFullYear() - 1;
}

export function qualificationPeriods(cycleStartYear = selectedCycleStartYear) {
    const startYear = Number(cycleStartYear) ||
        evaluationCycleStartYear();

    return PERIOD_DEFS.map((period, index) => {
        const year = startYear + period.yearOffset;
        const startDate = new Date(
            year,
            period.startMonth,
            period.startDay
        );
        const endDate = new Date(
            year,
            period.endMonth,
            period.endDay
        );

        return {
            ...period,
            order: index + 1,
            cycleStartYear: startYear,
            startDate,
            endDate,
            startISO: toISODate(startDate),
            endISO: toISODate(endDate),
            deadlineISO: toISODate(endDate)
        };
    });
}

/**
 * La calificacion anual del ciclo. Cubre los doce meses del articulo 3 (1 de
 * septiembre al 31 de agosto) y se hace en septiembre, cuando los tres
 * informes cuatrimestrales ya estan escritos.
 */
export function annualPeriod(cycleStartYear = selectedCycleStartYear) {
    const startYear = Number(cycleStartYear) || evaluationCycleStartYear();
    const startDate = new Date(startYear, 8, 1);
    const endDate = new Date(startYear + 1, 7, 31);

    return {
        id: ANNUAL_PERIOD_ID,
        label: "Calificacion anual",
        shortLabel: "Anual",
        annual: true,
        order: 4,
        cycleStartYear: startYear,
        startDate,
        endDate,
        startISO: toISODate(startDate),
        endISO: toISODate(endDate),
        // El proceso se inicia el 1 de septiembre y la precalificacion del jefe
        // directo corre en los primeros dias (art. 3 y art. 20).
        deadlineISO: toISODate(new Date(startYear + 1, 8, 15))
    };
}

export function isAnnualPeriod(period) {
    return Boolean(period?.annual) || period?.id === ANNUAL_PERIOD_ID;
}

/** Los tres informes escritos MAS la calificacion anual. */
export function qualificationCycleSteps(cycleStartYear = selectedCycleStartYear) {
    return [...qualificationPeriods(cycleStartYear), annualPeriod(cycleStartYear)];
}

function periodById(id, cycleStartYear = selectedCycleStartYear) {
    if (id === ANNUAL_PERIOD_ID) return annualPeriod(cycleStartYear);

    return qualificationPeriods(cycleStartYear).find(period =>
        period.id === id
    ) || qualificationPeriods(cycleStartYear)[0];
}

function currentPeriodId(date = new Date(), cycleStartYear = selectedCycleStartYear) {
    const iso = toISODate(date instanceof Date ? date : new Date(date));

    return qualificationPeriods(cycleStartYear).find(period =>
        period.startISO <= iso && iso <= period.endISO
    )?.id || "sep-dec";
}

export function isISODateInPeriod(value, period) {
    const iso = normalizeISODate(value);

    return Boolean(
        iso &&
        period?.startISO &&
        period?.endISO &&
        period.startISO <= iso &&
        iso <= period.endISO
    );
}

function normalizeISODate(value) {
    if (!value) return "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return String(value);
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) return "";

    return toISODate(parsed);
}

function periodRecordId(period, profile) {
    return [
        period.cycleStartYear,
        period.id,
        profileKey(profile)
    ].join(":");
}

function findRecordForProfile(state, period, profile) {
    const id = periodRecordId(period, profile);

    return state.records[id] || null;
}

export function qualificationRecordStatus(record = null) {
    if (!record) return STATUS_PENDING;
    // El escaneo firmado es la prueba de que el circuito se cerro: manda sobre
    // el estado guardado, porque el papel es el original.
    if (record.scan) return STATUS_ARCHIVED;
    if (record.status === STATUS_ARCHIVED) return STATUS_ARCHIVED;
    if (
        record.status === STATUS_PRINTED ||
        record.status === STATUS_EVALUATED ||
        record.evaluatedAt
    ) {
        return STATUS_PRINTED;
    }

    return STATUS_DRAFT;
}

// Cerrado = ya salio a la impresora, con o sin el escaneado de vuelta. Es lo
// que antes contaba `evaluated`.
function isClosedStatus(status) {
    return status === STATUS_PRINTED || status === STATUS_ARCHIVED;
}

function statusLabel(status) {
    if (status === STATUS_ARCHIVED) return "Firmada y archivada";
    // `evaluated` es el estado que dejaban los registros anteriores a la
    // separacion entre informe escrito y calificacion anual.
    if (status === STATUS_PRINTED || status === STATUS_EVALUATED) {
        return "Impresa, sin firma";
    }
    if (status === STATUS_DRAFT) return "Borrador";

    return "Sin escribir";
}

function statusClass(status) {
    if (status === STATUS_ARCHIVED) return "accepted";
    if (status === STATUS_PRINTED || status === STATUS_EVALUATED) return "completed";
    if (status === STATUS_DRAFT) return "completed";

    return "pending";
}

function periodMonths(period) {
    const months = [];
    const cursor = new Date(
        period.startDate.getFullYear(),
        period.startDate.getMonth(),
        1
    );
    const endSerial =
        period.endDate.getFullYear() * 12 + period.endDate.getMonth();

    while (
        cursor.getFullYear() * 12 + cursor.getMonth() <= endSerial
    ) {
        months.push(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return months;
}

function incidentCacheKey(period, profiles = []) {
    return [
        period.cycleStartYear,
        period.id,
        profiles.map(profile => profileKey(profile)).join("|")
    ].join("::");
}

async function ensurePeriodIncidents(period, profiles) {
    const key = incidentCacheKey(period, profiles);

    if (incidentCache.key === key || incidentCache.loading) return;

    incidentCache = {
        key,
        loading: true,
        eventsByProfile: new Map()
    };

    try {
        const results = await Promise.all(
            periodMonths(period).map(month =>
                buildAttendanceIncidents(profiles, month)
            )
        );
        const eventsByProfile = new Map();

        results.flatMap(result => result.events || [])
            .filter(event => isISODateInPeriod(event.iso, period))
            .forEach(event => {
                const name = String(event.profile || "");

                if (!eventsByProfile.has(name)) {
                    eventsByProfile.set(name, []);
                }

                eventsByProfile.get(name).push(event);
            });

        incidentCache = {
            key,
            loading: false,
            eventsByProfile
        };
    } catch (error) {
        console.warn(
            "No se pudieron calcular las incidencias para calificaciones.",
            error
        );
        incidentCache = {
            key,
            loading: false,
            eventsByProfile: new Map()
        };
    }

    if (
        typeof document !== "undefined" &&
        document.body?.dataset?.activeView === "qualifications"
    ) {
        renderQualificationsPanel();
    }
}

function getProfileLogs(profileName) {
    const raw = getJSON(`hrLogs_${profileName}`, {});
    const normalized = {};

    [
        "training",
        "diplomas",
        "events",
        "merit",
        "demerit",
        "performance"
    ].forEach(key => {
        normalized[key] = Array.isArray(raw?.[key])
            ? raw[key]
            : [];
    });

    return normalized;
}

function entryDate(entry = {}) {
    return normalizeISODate(entry.date || entry.start || entry.createdAt);
}

function entriesInPeriod(entries = [], period) {
    return entries.filter(entry =>
        isISODateInPeriod(entryDate(entry), period)
    );
}

function calendarEntriesInPeriod(profileName, period) {
    const result = [];
    const maps = [
        ["admin", "Permiso administrativo", getJSON(`admin_${profileName}`, {})],
        ["legal", "Feriado legal", getJSON(`legal_${profileName}`, {})],
        ["comp", "Permiso compensatorio", getJSON(`comp_${profileName}`, {})],
        ["absence", "Ausencia", getJSON(`absences_${profileName}`, {})]
    ];

    maps.forEach(([kind, label, values]) => {
        Object.entries(values || {}).forEach(([keyDay, value]) => {
            const date = keyToDate(keyDay);

            if (
                Number.isNaN(date.getTime()) ||
                !isISODateInPeriod(toISODate(date), period)
            ) {
                return;
            }

            const type = kind === "absence"
                ? absenceType(value)
                : kind;

            result.push({
                kind: type,
                label: type === "training"
                    ? "Capacitacion"
                    : label,
                iso: toISODate(date),
                detail: calendarEntryDetail(type, value)
            });
        });
    });

    return result.sort((a, b) =>
        a.iso.localeCompare(b.iso) ||
        a.label.localeCompare(b.label)
    );
}

function absenceType(value) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
        return String(value.type || value.kind || "absence");
    }

    return "absence";
}

function calendarEntryDetail(type, value) {
    if (value && typeof value === "object") {
        return clampText(value.note || value.reason || value.detail, 260);
    }

    if (type === "training") return "Capacitacion registrada en calendario";

    return "";
}

function countLateEvents(events = []) {
    return events.filter(event =>
        event.kind === "atraso" ||
        event.kind === "lateOnExtra"
    ).length;
}

function buildSummary(profile, period, state, eventsByProfile) {
    const logs = getProfileLogs(profile.name);
    const record = findRecordForProfile(state, period, profile);
    const status = qualificationRecordStatus(record);
    const incidents = eventsByProfile.get(profile.name) || [];
    const calendar = calendarEntriesInPeriod(profile.name, period);
    const training = [
        ...entriesInPeriod(logs.training, period),
        ...entriesInPeriod(logs.diplomas, period)
    ];

    return {
        profile,
        profileKey: profileKey(profile),
        record,
        status,
        merits: entriesInPeriod(logs.merit, period),
        demerits: entriesInPeriod(logs.demerit, period),
        events: entriesInPeriod(logs.events, period),
        performance: entriesInPeriod(logs.performance, period),
        training,
        calendar,
        calendarTraining: calendar.filter(item => item.kind === "training"),
        incidents,
        lateCount: countLateEvents(incidents),
        clockIssueCount: incidents.length
    };
}

function searchableText(summary) {
    const profile = summary.profile || {};

    return normalizePlainText([
        profile.name,
        profile.rut,
        profile.estamento,
        profile.profession,
        statusLabel(summary.status)
    ].join(" "));
}

function visibleSummaries(summaries) {
    const cleanSearch = normalizePlainText(searchText);

    return summaries
        .filter(summary => {
            if (selectedStatus === STATUS_ALL) return true;
            // "Impresas" agrupa las dos etapas del papel; "Archivadas" es el
            // subconjunto que ya volvio firmado.
            if (selectedStatus === STATUS_PRINTED) {
                return isClosedStatus(summary.status);
            }

            return summary.status === selectedStatus;
        })
        .filter(summary =>
            !cleanSearch || searchableText(summary).includes(cleanSearch)
        )
        .sort((a, b) => {
            // Sin los estados nuevos aqui, la resta daba NaN y el orden
            // "primero lo que falta" se perdia.
            const order = {
                [STATUS_PENDING]: 0,
                [STATUS_DRAFT]: 1,
                [STATUS_EVALUATED]: 2,
                [STATUS_PRINTED]: 2,
                [STATUS_ARCHIVED]: 3
            };
            const statusDiff = (order[a.status] || 0) - (order[b.status] || 0);

            if (statusDiff) return statusDiff;

            return String(a.profile.name || "")
                .localeCompare(String(b.profile.name || ""), "es");
        });
}

function formatDate(value) {
    return formatDisplayDate(value) || "Sin fecha";
}

function formatPeriodDeadline(period) {
    return formatDate(period.deadlineISO);
}

function daysUntilDeadline(period) {
    const today = new Date();
    const start = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
    );
    const deadline = parseISODate(period.deadlineISO);

    return Math.ceil((deadline - start) / 86400000);
}

function deadlineText(period, pendingCount) {
    const days = daysUntilDeadline(period);

    if (!pendingCount) return "Periodo cerrado";
    if (days < 0) return `${Math.abs(days)} dia(s) vencido`;
    if (days === 0) return "Vence hoy";

    return `${days} dia(s) restantes`;
}

function scoreAverage(record) {
    if (!record) return "";

    const values = QUALIFICATION_FACTORS
        .map(factor => factorComputedScore(record.factors?.[factor.key]))
        .filter(Number.isFinite);

    if (!values.length) return "";

    return (
        values.reduce((sum, value) => sum + value, 0) / values.length
    ).toFixed(1);
}

export function qualificationCoefficientGroup(profile = {}) {
    const estamento = normalizePlainText(
        profile.estamento || profile.role || profile.profession
    );

    if (estamento.includes("directivo")) return "directivos";
    if (
        estamento.includes("profesional") ||
        estamento.includes("tecnico")
    ) {
        return "profesionales_tecnicos";
    }

    return "administrativos_auxiliares";
}

export function qualificationPoints(record, profile = {}) {
    if (!record) return "";

    const group =
        QUALIFICATION_COEFFICIENTS[qualificationCoefficientGroup(profile)] ||
        QUALIFICATION_COEFFICIENTS.administrativos_auxiliares;
    let total = 0;

    for (const factor of QUALIFICATION_FACTORS) {
        const score = factorComputedScore(record.factors?.[factor.key]);

        if (!Number.isFinite(score)) return "";

        total += score * (group[factor.key] || 0);
    }

    return Number(total.toFixed(2));
}

export function qualificationList(points) {
    if (points === "" || points === null || points === undefined) return null;

    const score = Number(points);

    if (!Number.isFinite(score) || score < 10) return null;
    if (score >= 81) return { number: 1, label: "Distincion" };
    if (score >= 46) return { number: 2, label: "Buena" };
    if (score >= 30) return { number: 3, label: "Condicional" };

    return { number: 4, label: "Eliminacion" };
}

function qualificationListLabel(points) {
    const list = qualificationList(points);

    return list ? `Lista ${list.number}: ${list.label}` : "-";
}

function scoreConcept(score) {
    const value = scoreNumber(score);

    if (!Number.isFinite(value)) return "Sin nota";
    if (value >= 9) return "Optimo";
    if (value >= 7) return "Buena";
    if (value >= 5) return "Satisfactorio";
    if (value >= 3) return "Insuficiente";

    return "Deficiente";
}

function initials(name) {
    return String(name || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase() || "")
        .join("") || "?";
}

function kpiCardHTML(label, value, detail, tone = "blue") {
    return `
        <article class="qual-kpi qual-kpi--${tone}">
            <span>${escapeHTML(label)}</span>
            <strong>${escapeHTML(String(value))}</strong>
            <small>${escapeHTML(detail)}</small>
        </article>
    `;
}

function periodButtonHTML(period) {
    const active = period.id === selectedPeriodId;
    const annual = isAnnualPeriod(period);

    return `
        <button class="qual-period ${active ? "is-active" : ""}${annual ? " qual-period--annual" : ""}"
            type="button"
            data-qual-period="${escapeAttribute(period.id)}">
            <strong>${escapeHTML(period.shortLabel)}</strong>
            <small>${escapeHTML(annual ? "con notas" : formatPeriodDeadline(period))}</small>
        </button>
    `;
}

function filterButtonHTML(status, label, count) {
    const active = selectedStatus === status;

    return `
        <button class="worker-request-filter ${active ? "is-active" : ""}"
            type="button"
            data-qual-status="${escapeAttribute(status)}">
            ${escapeHTML(label)} <span>${count}</span>
        </button>
    `;
}

function workerRowHTML(summary) {
    const profile = summary.profile;
    const selected = summary.profileKey === selectedProfileKey;
    const points = qualificationPoints(summary.record, profile);

    return `
        <button class="qual-worker-row ${selected ? "is-selected" : ""}"
            type="button"
            data-qual-profile="${escapeAttribute(summary.profileKey)}">
            <span class="qual-avatar">${escapeHTML(initials(profile.name))}</span>
            <span class="qual-worker-main">
                <strong>${escapeHTML(profile.name || "Sin nombre")}</strong>
                <small>${escapeHTML([
                    profile.rut || "Sin RUT",
                    profile.estamento || "",
                    profile.profession || ""
                ].filter(Boolean).join(" | "))}</small>
                <span class="qual-worker-tags">
                    <span>${summary.merits.length} merito</span>
                    <span>${summary.demerits.length} demerito</span>
                    <span>${summary.lateCount} atraso</span>
                    <span>${summary.training.length + summary.calendarTraining.length} capacitacion</span>
                </span>
            </span>
            <span class="qual-worker-side">
                <span class="worker-request-status worker-request-status--${statusClass(summary.status)}">
                    ${escapeHTML(statusLabel(summary.status))}
                </span>
                ${points ? `<small>${escapeHTML(String(points))} pts</small>` : ""}
            </span>
        </button>
    `;
}

// Los antecedentes se reparten entre los tres factores para que cada uno se
// escriba MIRANDO lo suyo. Antes vivian en un recuadro aparte, arriba de todo:
// habia que leerlos, bajar, y redactar de memoria.
//
// El reparto es por afinidad, no exacto: un demerito puede pesar en rendimiento
// o en comportamiento segun de que sea. Por eso el chip es solo un atajo -copia
// su texto a la apreciacion- y no una clasificacion que decida nada.
function evidenceByFactor(summary) {
    const buckets = {
        rendimiento: [],
        condiciones: [],
        comportamiento: []
    };

    summary.merits.forEach(item => {
        buckets.rendimiento.push({
            tone: "ok",
            title: item.title || "Anotacion de merito",
            detail: [formatDate(entryDate(item)), item.detail].filter(Boolean).join(" - "),
            text: item.title || "Anotacion de merito"
        });
    });

    summary.demerits.forEach(item => {
        buckets.comportamiento.push({
            tone: "warn",
            title: item.title || "Anotacion de demerito",
            detail: [formatDate(entryDate(item)), item.detail].filter(Boolean).join(" - "),
            text: item.title || "Anotacion de demerito"
        });
    });

    summary.events.forEach(item => {
        buckets.rendimiento.push({
            tone: "mute",
            title: item.title || "Anotacion",
            detail: formatDate(entryDate(item)),
            text: item.title || "Anotacion en la hoja de vida"
        });
    });

    [...summary.training, ...summary.calendarTraining].forEach(item => {
        const name = item.name || item.label || "Capacitacion";
        const extra = [
            item.hours ? `${item.hours} horas` : "",
            item.grade ? `nota ${item.grade}` : ""
        ].filter(Boolean).join(", ");

        buckets.condiciones.push({
            tone: "ok",
            title: name,
            detail: extra || formatDate(entryDate(item) || item.iso),
            text: extra ? `${name} (${extra})` : name
        });
    });

    if (summary.lateCount) {
        buckets.comportamiento.push({
            tone: "bad",
            title: `${summary.lateCount} ${summary.lateCount === 1 ? "atraso" : "atrasos"}`,
            detail: "Reloj control",
            text: summary.lateCount === 1
                ? "Registra un atraso en el reloj control durante el periodo."
                : `Registra ${summary.lateCount} atrasos en el reloj control durante el periodo.`
        });
    }

    const otherIssues = summary.clockIssueCount - summary.lateCount;

    if (otherIssues > 0) {
        buckets.comportamiento.push({
            tone: "warn",
            title: `${otherIssues} ${otherIssues === 1 ? "incidencia" : "incidencias"} de marcaje`,
            detail: "Entradas o salidas sin registrar",
            text: `Registra ${otherIssues} ${otherIssues === 1 ? "incidencia" : "incidencias"} de marcaje en el periodo.`
        });
    }

    summary.calendar
        .filter(item => item.kind !== "training")
        .forEach(item => {
            buckets.comportamiento.push({
                tone: "mute",
                title: item.label,
                detail: formatDate(item.iso),
                text: `${item.label} el ${formatDate(item.iso)}.`
            });
        });

    return buckets;
}

function evidenceChipsHTML(factorKey, items) {
    if (!items.length) {
        return `
            <p class="qual-evidence-empty">
                Sin registros de este tipo en el periodo. La apreciacion se escribe igual.
            </p>
        `;
    }

    return items.slice(0, 8).map((item, index) => `
        <button class="qual-chip qual-chip--${escapeAttribute(item.tone)}"
            type="button"
            data-qual-insert="${escapeAttribute(factorKey)}"
            data-qual-insert-index="${index}"
            title="Copiar a la apreciacion">
            <span class="qual-chip__dot"></span>
            <span class="qual-chip__text">
                <strong>${escapeHTML(item.title)}</strong>
                <small>${escapeHTML(item.detail || "")}</small>
            </span>
            <span class="qual-chip__add" aria-hidden="true">+</span>
        </button>
    `).join("");
}

// ---------------------------------------------------------------------------
// Informe cuatrimestral: apreciaciones escritas, sin notas.
// ---------------------------------------------------------------------------

function appraisalFieldHTML(factor, record, evidence, editable) {
    const text = record?.appraisals?.[factor.key] || "";

    return `
        <section class="qual-factor">
            <div class="qual-factor__main">
                <div class="qual-factor-head">
                    <div>
                        <strong>${escapeHTML(factor.label)}</strong>
                        <small>${escapeHTML(factor.formText)}</small>
                    </div>
                </div>
                <textarea class="qual-appraisal"
                    rows="5"
                    data-qual-appraisal="${escapeAttribute(factor.key)}"
                    maxlength="${MAX_NOTE_LENGTH}"
                    placeholder="Que hizo, con que oportunidad y con que calidad durante el cuatrimestre."
                    ${editable ? "" : "disabled"}>${escapeHTML(text)}</textarea>
                <span class="qual-appraisal-count" data-qual-count="${escapeAttribute(factor.key)}">
                    ${text.trim().length ? `${text.trim().length} caracteres escritos` : "Sin escribir"}
                </span>
            </div>
            <aside class="qual-factor__evidence">
                <span class="qual-evidence-title">Antecedentes de este factor</span>
                ${evidenceChipsHTML(factor.key, evidence)}
            </aside>
        </section>
    `;
}

function paperFlowHTML(summary, status) {
    const written = QUALIFICATION_FACTORS.every(factor =>
        String(summary.record?.appraisals?.[factor.key] || "").trim()
    );
    const printed = status === STATUS_PRINTED || status === STATUS_ARCHIVED;
    const archived = status === STATUS_ARCHIVED;
    const steps = [
        ["1", "Escribir", "Las tres apreciaciones del cuatrimestre.", written],
        ["2", "Imprimir", "Sale el formulario de personal, ya relleno.", printed],
        ["3", "Firmar en papel", "Jefatura y funcionario, con fecha.", archived],
        ["4", "Escanear y guardar", "Queda archivado en este cuatrimestre.", archived]
    ];

    return `
        <section class="qual-paper">
            <div class="qual-subhead">
                <h4>Formulario firmado</h4>
                <span>El papel es el original; aqui queda la copia del periodo</span>
            </div>
            <div class="qual-paper-steps">
                ${steps.map(([number, title, detail, done]) => `
                    <div class="qual-step ${done ? "is-done" : ""}">
                        <span class="qual-step__dot">${number}</span>
                        <strong>${escapeHTML(title)}</strong>
                        <small>${escapeHTML(detail)}</small>
                    </div>
                `).join("")}
            </div>
            ${scanRowHTML(summary)}
        </section>
    `;
}

function scanRowHTML(summary) {
    const scan = summary.record?.scan;
    const editable = canEditMenu("qualifications");

    if (!scan) {
        return `
            <label class="qual-scan-drop ${editable ? "" : "is-disabled"}">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 16.5V4"></path>
                    <path d="m7.5 8.5 4.5-4.5 4.5 4.5"></path>
                    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"></path>
                </svg>
                <span>Adjuntar el formulario escaneado y firmado</span>
                <input type="file" accept="${ATTACHMENT_ACCEPT}" data-qual-scan ${editable ? "" : "disabled"}>
            </label>
        `;
    }

    return `
        <div class="qual-scan">
            <span class="qual-scan__badge">${escapeHTML(scanExtLabel(scan))}</span>
            <span class="qual-scan__meta">
                <strong>${escapeHTML(scan.name)}</strong>
                <small>${escapeHTML(formatBytes(scan.size))} - ${escapeHTML(formatDate(scan.addedAt))}</small>
            </span>
            <button class="secondary-button secondary-button--small" type="button" data-qual-scan-open>Ver</button>
            ${editable ? `
                <button class="qual-scan__remove" type="button" data-qual-scan-remove aria-label="Quitar el escaneado">&times;</button>
            ` : ""}
        </div>
    `;
}

function scanExtLabel(scan = {}) {
    const name = String(scan.name || "").toLowerCase();

    if (/\.pdf$/.test(name)) return "PDF";
    if (/\.(png|jpe?g|gif|webp|heic|heif)$/.test(name)) return "IMG";

    return "DOC";
}

function formatBytes(value) {
    const size = Number(value) || 0;

    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;

    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Calificacion anual: las notas del articulo 14.
// ---------------------------------------------------------------------------

function factorFieldHTML(factor, record, editable) {
    const value = record?.factors?.[factor.key] || {};
    const score = factorComputedScore(value);
    const scoreText = Number.isFinite(score) ? score.toFixed(2) : "-";

    return `
        <section class="qual-factor">
            <div class="qual-factor-head">
                <div>
                    <strong>${escapeHTML(factor.label)}</strong>
                    <small>${escapeHTML(factor.detail)}</small>
                </div>
                <span class="qual-factor-score">
                    <strong>${escapeHTML(scoreText)}</strong>
                    <small>${escapeHTML(scoreConcept(score))}</small>
                </span>
            </div>
            <div class="qual-subfactors">
                ${factor.subfactors.map(subfactor => {
                    const subvalue =
                        value.subfactors?.[subfactor.key] || {};

                    return `
                        <label class="qual-subfactor">
                            <span>
                                <strong>${escapeHTML(subfactor.label)}</strong>
                                <small>${escapeHTML(subfactor.detail)}</small>
                            </span>
                            <input type="number"
                                min="1"
                                max="10"
                                step="1"
                                inputmode="numeric"
                                data-qual-sub-score="${escapeAttribute(`${factor.key}:${subfactor.key}`)}"
                                value="${escapeAttribute(subvalue.score || "")}"
                                ${editable ? "" : "disabled"}>
                            <textarea rows="2"
                                data-qual-sub-comment="${escapeAttribute(`${factor.key}:${subfactor.key}`)}"
                                maxlength="${MAX_NOTE_LENGTH}"
                                placeholder="Fundamento"
                                ${editable ? "" : "disabled"}>${escapeHTML(subvalue.comment || "")}</textarea>
                        </label>
                    `;
                }).join("")}
            </div>
            <label class="qual-factor-comment">
                <span>Fundamento del factor</span>
                <textarea rows="2"
                    data-qual-comment="${escapeAttribute(factor.key)}"
                    maxlength="${MAX_NOTE_LENGTH}"
                    ${editable ? "" : "disabled"}>${escapeHTML(value.comment || "")}</textarea>
            </label>
        </section>
    `;
}

function detailHTML(summary, period, readonly) {
    if (!summary) {
        return `
            <section class="panel qual-detail-panel">
                <div class="empty-state empty-state--compact">
                    Sin trabajador seleccionado para el filtro actual.
                </div>
            </section>
        `;
    }

    return isAnnualPeriod(period)
        ? annualDetailHTML(summary, period, readonly)
        : quarterDetailHTML(summary, period, readonly);
}

function detailHeadHTML(summary, period) {
    const profile = summary.profile;
    const annual = isAnnualPeriod(period);

    return `
        <div class="qual-detail-head">
            <div>
                <span class="worker-request-type">
                    ${annual ? "Calificacion anual" : "Informe cuatrimestral"}
                </span>
                <h3>${escapeHTML(profile.name || "Sin nombre")}</h3>
                <small>${escapeHTML([
                    profile.rut || "Sin RUT",
                    profile.estamento || "",
                    profile.profession || ""
                ].filter(Boolean).join(" | "))}</small>
            </div>
            <span class="worker-request-status worker-request-status--${statusClass(summary.status)}">
                ${escapeHTML(statusLabel(summary.status))}
            </span>
        </div>
    `;
}

function supervisorFieldsHTML(record, editable) {
    return `
        <div class="qual-form-grid">
            <label>
                <span>Jefe directo</span>
                <input name="supervisorName"
                    type="text"
                    maxlength="${MAX_TEXT_LENGTH}"
                    value="${escapeAttribute(record?.supervisorName || "")}"
                    ${editable ? "" : "disabled"}>
            </label>
            <label>
                <span>Cargo</span>
                <input name="supervisorCargo"
                    type="text"
                    maxlength="${MAX_TEXT_LENGTH}"
                    value="${escapeAttribute(record?.supervisorCargo || "")}"
                    ${editable ? "" : "disabled"}>
            </label>
        </div>
    `;
}

/* ==========================================================================
   Informe cuatrimestral: tres al ano, escrito y SIN notas.
   ========================================================================== */

function quarterDetailHTML(summary, period, readonly) {
    const record = summary.record;
    const editable = !readonly;
    const evidence = evidenceByFactor(summary);
    const written = QUALIFICATION_FACTORS.filter(factor =>
        String(record?.appraisals?.[factor.key] || "").trim()
    ).length;
    const complete = written === QUALIFICATION_FACTORS.length;

    return `
        <section class="panel qual-detail-panel">
            ${detailHeadHTML(summary, period)}

            <div class="qual-evidence-grid">
                ${kpiCardHTML("Meritos", summary.merits.length, "Hoja de vida", "green")}
                ${kpiCardHTML("Demeritos", summary.demerits.length, "Hoja de vida", "red")}
                ${kpiCardHTML("Atrasos", summary.lateCount, "Reloj control", "orange")}
                ${kpiCardHTML("Marcajes", summary.clockIssueCount, "Incidencias", "slate")}
                ${kpiCardHTML(
                    "Capacitacion",
                    summary.training.length + summary.calendarTraining.length,
                    "Periodo evaluado",
                    "teal"
                )}
                ${kpiCardHTML(
                    "Apreciaciones",
                    `${written} de 3`,
                    complete ? "Listas para imprimir" : "Faltan por escribir",
                    complete ? "blue" : "orange"
                )}
            </div>

            <p class="qual-note">
                Este informe va SIN notas: son apreciaciones escritas. Las notas,
                los coeficientes y la lista se ponen una vez al ano, en la
                calificacion de septiembre.
            </p>

            <form class="qual-form" data-qual-form>
                ${supervisorFieldsHTML(record, editable)}

                <div class="qual-factors">
                    ${QUALIFICATION_FACTORS.map(factor => appraisalFieldHTML(
                        factor,
                        record,
                        evidence[factor.key] || [],
                        editable
                    )).join("")}
                </div>

                ${paperFlowHTML(summary, summary.status)}

                <div class="qual-actions">
                    <button class="primary-button" type="submit" ${editable ? "" : "disabled"}>
                        Guardar borrador
                    </button>
                    <button class="secondary-button" type="button" data-qual-print ${complete && editable ? "" : "disabled"}>
                        Imprimir formulario
                    </button>
                    <button class="danger-action" type="button" data-qual-reset ${editable ? "" : "disabled"}>
                        Reiniciar
                    </button>
                </div>
            </form>
        </section>
    `;
}

/* ==========================================================================
   Calificacion anual: una al ano, con las notas del articulo 14.
   ========================================================================== */

function quarterReportsHTML(summary, period) {
    const state = getQualificationState();
    const reports = qualificationPeriods(period.cycleStartYear).map(quarter => {
        const record = findRecordForProfile(state, quarter, summary.profile);
        const parts = QUALIFICATION_FACTORS
            .map(factor => ({
                label: factor.label,
                text: String(record?.appraisals?.[factor.key] || "").trim()
            }))
            .filter(part => part.text);

        return { quarter, parts };
    });

    return `
        <section class="qual-reports">
            <div class="qual-subhead">
                <h4>Los tres informes del periodo</h4>
                <span>Articulo 19: antecedente de la precalificacion</span>
            </div>
            ${reports.map(({ quarter, parts }) => `
                <details class="qual-report">
                    <summary>
                        <strong>${escapeHTML(quarter.label)}</strong>
                        <span class="${parts.length ? "is-ok" : "is-missing"}">
                            ${parts.length ? "escrito" : "sin escribir"}
                        </span>
                    </summary>
                    ${parts.length
                        ? parts.map(part => `
                            <div class="qual-report__part">
                                <strong>${escapeHTML(part.label)}</strong>
                                <p>${escapeHTML(part.text)}</p>
                            </div>
                        `).join("")
                        : `<p class="qual-evidence-empty">No se escribio el informe de este cuatrimestre.</p>`}
                </details>
            `).join("")}
        </section>
    `;
}

function annualDetailHTML(summary, period, readonly) {
    const profile = summary.profile;
    const record = summary.record;
    const editable = !readonly;
    const average = scoreAverage(record) || "-";
    const points = qualificationPoints(record, profile);
    const pointsText = points ? String(points) : "-";
    const listText = qualificationListLabel(points);
    const coefficientGroup =
        QUALIFICATION_COEFFICIENTS[qualificationCoefficientGroup(profile)] ||
        QUALIFICATION_COEFFICIENTS.administrativos_auxiliares;

    return `
        <section class="panel qual-detail-panel">
            ${detailHeadHTML(summary, period)}

            <div class="qual-evidence-grid">
                ${kpiCardHTML("Puntaje", pointsText, "Notas x coeficiente", "blue")}
                ${kpiCardHTML("Lista", listText, `Promedio ${average}`, "violet")}
                ${kpiCardHTML(
                    "Coeficientes",
                    coefficientGroup.label,
                    QUALIFICATION_FACTORS.map(factor => coefficientGroup[factor.key]).join(" / "),
                    "slate"
                )}
                ${kpiCardHTML("Meritos", summary.merits.length, "Del ciclo", "green")}
                ${kpiCardHTML("Demeritos", summary.demerits.length, "Del ciclo", "red")}
                ${kpiCardHTML("Atrasos", summary.lateCount, "Reloj control", "orange")}
            </div>

            ${quarterReportsHTML(summary, period)}

            <form class="qual-form" data-qual-form>
                ${supervisorFieldsHTML(record, editable)}

                <div class="qual-factors">
                    ${QUALIFICATION_FACTORS.map(factor =>
                        factorFieldHTML(factor, record, editable)
                    ).join("")}
                </div>

                <label>
                    <span>Observaciones de la jefatura</span>
                    <textarea name="observations"
                        rows="3"
                        maxlength="${MAX_NOTE_LENGTH}"
                        ${editable ? "" : "disabled"}>${escapeHTML(record?.observations || "")}</textarea>
                </label>

                <div class="qual-actions">
                    <button class="primary-button" type="submit" ${editable ? "" : "disabled"}>
                        Guardar borrador
                    </button>
                    <button class="secondary-button" type="button" data-qual-evaluate ${editable ? "" : "disabled"}>
                        Cerrar precalificacion
                    </button>
                    <button class="danger-action" type="button" data-qual-reset ${editable ? "" : "disabled"}>
                        Reiniciar
                    </button>
                </div>
            </form>
        </section>
    `;
}

function collectFormRecord(form, summary, period, status = STATUS_DRAFT) {
    const now = new Date().toISOString();
    const profile = summary.profile;
    const previous = summary.record || {};
    const annual = isAnnualPeriod(period);
    const factors = {};
    const appraisals = {};

    QUALIFICATION_FACTORS.forEach(factor => {
        if (annual) {
            // Solo la calificacion anual lleva notas.
            const commentInput = form.querySelector(
                `[data-qual-comment="${factor.key}"]`
            );
            const subfactors = {};

            factor.subfactors.forEach(subfactor => {
                const scoreInput = form.querySelector(
                    `[data-qual-sub-score="${factor.key}:${subfactor.key}"]`
                );
                const subCommentInput = form.querySelector(
                    `[data-qual-sub-comment="${factor.key}:${subfactor.key}"]`
                );

                subfactors[subfactor.key] = {
                    score: scoreInput?.value || "",
                    comment: subCommentInput?.value || ""
                };
            });

            factors[factor.key] = {
                subfactors,
                comment: commentInput?.value || ""
            };
            return;
        }

        const appraisal = form.querySelector(
            `[data-qual-appraisal="${factor.key}"]`
        );

        appraisals[factor.key] = appraisal?.value || "";
    });

    return normalizeRecord({
        ...previous,
        id: periodRecordId(period, profile),
        profileKey: profileKey(profile),
        profileName: profile.name || "",
        profileRut: profile.rut || "",
        cycleStartYear: period.cycleStartYear,
        periodId: period.id,
        status,
        // Cada instrumento escribe lo suyo y deja intacto lo del otro: si se
        // guarda un informe escrito, las notas de la anual no se tocan.
        factors: annual ? factors : previous.factors,
        appraisals: annual ? previous.appraisals : appraisals,
        scan: previous.scan,
        supervisorName: form.elements.supervisorName?.value || "",
        supervisorCargo: form.elements.supervisorCargo?.value || "",
        // Se lee el campo tal cual: con `|| previous` no habia forma de
        // dejarlo vacio, porque al borrarlo volvia el texto anterior.
        observations: form.elements.observations
            ? form.elements.observations.value
            : previous.observations || "",
        employeeObservations: previous.employeeObservations || "",
        employeeAgreement: previous.employeeAgreement || "",
        createdAt: previous.createdAt || now,
        updatedAt: now,
        evaluatedAt: status === STATUS_EVALUATED || status === STATUS_ARCHIVED
            ? previous.evaluatedAt || now
            : previous.evaluatedAt || ""
    });
}

// El formulario de personal, relleno con lo que se escribio.
function buildFormDocument(summary, period) {
    const record = summary.record || {};
    const profile = summary.profile || {};

    return qualificationFormHTML({
        folio: String(record.id || "").slice(-12).toUpperCase(),
        periodId: period.id,
        year: period.endDate.getFullYear(),
        profile: {
            name: profile.name || "",
            planta: profile.estamento || "",
            unidad: profile.profession || getActiveWorkspaceName()
        },
        supervisor: {
            name: record.supervisorName || "",
            cargo: record.supervisorCargo || ""
        },
        factors: QUALIFICATION_FACTORS.map(factor => ({
            title: factor.formTitle,
            formText: factor.formText,
            text: record.appraisals?.[factor.key] || ""
        }))
    });
}

function getActiveWorkspaceName() {
    try {
        return getActiveWorkspace()?.name || "";
    } catch (error) {
        return "";
    }
}

function persistRecord(record) {
    if (!record?.id) return;

    const state = getQualificationState();
    state.records[record.id] = record;
    saveQualificationState(state);
}

function removeRecord(summary, period) {
    const id = periodRecordId(period, summary.profile);
    const state = getQualificationState();

    delete state.records[id];
    saveQualificationState(state);
}

function selectedSummaryFrom(summaries) {
    if (!summaries.length) return null;

    const selected = summaries.find(summary =>
        summary.profileKey === selectedProfileKey
    );

    if (selected) return selected;

    selectedProfileKey = summaries[0].profileKey;
    return summaries[0];
}

function renderHeader(period, summaries) {
    const total = summaries.length;
    const closed = summaries.filter(summary =>
        isClosedStatus(summary.status)
    ).length;
    const pending = summaries.filter(summary =>
        summary.status === STATUS_PENDING
    ).length;
    const deadline = deadlineText(period, pending);

    return `
        <div class="section-head section-head--with-action qual-head">
            <span class="section-head__title">
                <h3>Calificaciones</h3>
                <small>Ciclo ${period.cycleStartYear}-${period.cycleStartYear + 1} | ${escapeHTML(period.label)}</small>
            </span>
            <span class="worker-request-counter">
                ${closed} de ${total} cerrada(s)
            </span>
        </div>
        <section class="qual-cyclebar">
            <button class="secondary-button qual-cycle-nav"
                type="button"
                data-qual-cycle="-1"
                aria-label="Ciclo anterior">&lt;</button>
            <strong>Ciclo ${period.cycleStartYear}-${period.cycleStartYear + 1}</strong>
            <button class="secondary-button qual-cycle-nav"
                type="button"
                data-qual-cycle="1"
                aria-label="Ciclo siguiente">&gt;</button>
            <div class="qual-periods">
                ${qualificationCycleSteps(period.cycleStartYear)
                    .map(periodButtonHTML)
                    .join("")}
            </div>
        </section>
        <section class="qual-kpis">
            ${kpiCardHTML("Pendientes", pending, deadline, pending ? "orange" : "green")}
            ${kpiCardHTML("Borradores", summaries.filter(summary => summary.status === STATUS_DRAFT).length, "En preparacion", "teal")}
            ${kpiCardHTML("Cerradas", closed, `Limite ${formatPeriodDeadline(period)}`, "blue")}
            ${kpiCardHTML(
                "Alertas",
                summaries.reduce((sum, summary) =>
                    sum + summary.demerits.length + summary.lateCount,
                    0
                ),
                "Demeritos y atrasos",
                "red"
            )}
        </section>
    `;
}

function renderList(visible, summaries, period) {
    const counts = {
        [STATUS_ALL]: summaries.length,
        [STATUS_PENDING]: summaries.filter(summary =>
            summary.status === STATUS_PENDING
        ).length,
        [STATUS_DRAFT]: summaries.filter(summary =>
            summary.status === STATUS_DRAFT
        ).length,
        // Un solo filtro para las dos etapas del papel: lo que ya salio a
        // la impresora, este o no de vuelta el escaneado.
        [STATUS_PRINTED]: summaries.filter(summary =>
            isClosedStatus(summary.status)
        ).length,
        [STATUS_ARCHIVED]: summaries.filter(summary =>
            summary.status === STATUS_ARCHIVED
        ).length
    };

    return `
        <section class="panel qual-list-panel">
            <div class="qual-list-tools">
                <label class="field-shell field-shell--icon">
                    <span class="field-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="7"></circle>
                            <path d="M21 21l-4.35-4.35"></path>
                        </svg>
                    </span>
                    <input type="search"
                        data-qual-search
                        value="${escapeAttribute(searchText)}"
                        placeholder="Buscar trabajador, RUT o estamento">
                </label>
                <div class="worker-request-filters">
                    ${filterButtonHTML(STATUS_ALL, "Todos", counts[STATUS_ALL])}
                    ${filterButtonHTML(STATUS_PENDING, "Pendientes", counts[STATUS_PENDING])}
                    ${filterButtonHTML(STATUS_DRAFT, "Borrador", counts[STATUS_DRAFT])}
                    ${filterButtonHTML(STATUS_PRINTED, "Impresas", counts[STATUS_PRINTED])}
                    ${filterButtonHTML(STATUS_ARCHIVED, "Archivadas", counts[STATUS_ARCHIVED])}
                </div>
            </div>

            <div class="qual-list-head">
                <h4>Trabajadores</h4>
                <small>${escapeHTML(formatDate(period.startISO))} - ${escapeHTML(formatDate(period.endISO))}</small>
            </div>

            <div class="qual-worker-list">
                ${incidentCache.loading
                    ? `<div class="qual-sync-note">Calculando marcajes del periodo...</div>`
                    : ""}
                ${visible.length
                    ? visible.map(workerRowHTML).join("")
                    : `
                        <div class="empty-state empty-state--compact">
                            Sin trabajadores para el filtro seleccionado.
                        </div>
                    `}
            </div>
        </section>
    `;
}

export function renderQualificationsPanel() {
    if (typeof document === "undefined") return;

    const panel = document.getElementById("qualificationsPanel");

    if (!panel) return;

    const period = periodById(selectedPeriodId, selectedCycleStartYear);
    const profiles = getProfiles().filter(isProfileActive);
    const state = getQualificationState();

    void ensurePeriodIncidents(period, profiles);

    const summaries = profiles.map(profile =>
        buildSummary(
            profile,
            period,
            state,
            incidentCache.eventsByProfile
        )
    );
    const visible = visibleSummaries(summaries);
    const selected = selectedSummaryFrom(visible);
    const readonly = !canEditMenu("qualifications");

    panel.innerHTML = `
        <div class="qual-root">
            ${renderHeader(period, summaries)}
            <div class="qual-layout">
                ${renderList(visible, summaries, period)}
                ${detailHTML(selected, period, readonly)}
            </div>
        </div>
    `;

    bindQualificationsPanel(panel, {
        period,
        summaries,
        selected
    });
}

function bindQualificationsPanel(panel, { period, summaries, selected }) {
    panel.querySelectorAll("[data-qual-cycle]").forEach(button => {
        button.onclick = () => {
            selectedCycleStartYear += Number(button.dataset.qualCycle) || 0;
            selectedPeriodId = "sep-dec";
            selectedProfileKey = "";
            incidentCache = {
                key: "",
                loading: false,
                eventsByProfile: new Map()
            };
            renderQualificationsPanel();
        };
    });

    panel.querySelectorAll("[data-qual-period]").forEach(button => {
        button.onclick = () => {
            selectedPeriodId = button.dataset.qualPeriod || "sep-dec";
            selectedProfileKey = "";
            incidentCache = {
                key: "",
                loading: false,
                eventsByProfile: new Map()
            };
            renderQualificationsPanel();
        };
    });

    panel.querySelectorAll("[data-qual-status]").forEach(button => {
        button.onclick = () => {
            selectedStatus = button.dataset.qualStatus || STATUS_ALL;
            selectedProfileKey = "";
            renderQualificationsPanel();
        };
    });

    const search = panel.querySelector("[data-qual-search]");

    if (search) {
        search.oninput = () => {
            searchText = search.value || "";
            selectedProfileKey = "";
            const cursor = search.selectionStart;

            clearTimeout(searchRenderTimer);
            searchRenderTimer = setTimeout(() => {
                renderQualificationsPanel();
                const nextSearch = document.querySelector(
                    "[data-qual-search]"
                );

                nextSearch?.focus();
                if (
                    nextSearch &&
                    typeof nextSearch.setSelectionRange === "function"
                ) {
                    nextSearch.setSelectionRange(cursor, cursor);
                }
            }, 140);
        };
    }

    panel.querySelectorAll("[data-qual-profile]").forEach(button => {
        button.onclick = () => {
            selectedProfileKey = button.dataset.qualProfile || "";
            renderQualificationsPanel();
        };
    });

    const form = panel.querySelector("[data-qual-form]");

    if (form && selected) {
        const annual = isAnnualPeriod(period);

        form.onsubmit = event => {
            event.preventDefault();
            persistRecord(collectFormRecord(form, selected, period));
            renderQualificationsPanel();
        };

        form.querySelector("[data-qual-evaluate]")?.addEventListener(
            "click",
            () => {
                persistRecord(
                    collectFormRecord(form, selected, period, STATUS_EVALUATED)
                );
                renderQualificationsPanel();
            }
        );

        form.querySelector("[data-qual-reset]")?.addEventListener(
            "click",
            () => {
                void resetRecord(selected, period);
            }
        );

        // Imprimir NO abre el dialogo del navegador sobre la pagina entera:
        // arma el formulario de personal relleno y lo manda a un iframe. Y deja
        // el informe marcado como impreso, que es el paso que sigue en el papel.
        form.querySelector("[data-qual-print]")?.addEventListener(
            "click",
            () => {
                persistRecord(
                    collectFormRecord(form, selected, period, STATUS_PRINTED)
                );
                printQualificationForm(
                    buildFormDocument(
                        currentSummaryFor(selected, period),
                        period
                    )
                );
                renderQualificationsPanel();
            }
        );

        if (!annual) {
            bindAppraisalHelpers(form, selected, period);
        }
    }

    bindScanControls(panel, selected, period);

    if (
        selected &&
        !summaries.some(summary =>
            summary.profileKey === selectedProfileKey
        )
    ) {
        selectedProfileKey = selected.profileKey;
    }
}

// Vuelve a leer el resumen desde el almacen. Se usa justo despues de guardar,
// cuando hay que imprimir con lo recien escrito y el `summary` en mano ya
// quedo viejo.
function currentSummaryFor(summary, period) {
    const state = getQualificationState();
    const record = findRecordForProfile(state, period, summary.profile);

    return { ...summary, record };
}

/**
 * Los atajos del informe escrito: contar caracteres mientras se escribe y
 * copiar un antecedente al final de la apreciacion.
 *
 * El contador se actualiza a mano, sin repintar el panel: repintar con cada
 * tecla le quitaria el foco al recuadro en el que se esta escribiendo.
 */
function bindAppraisalHelpers(form, summary, period) {
    const evidence = evidenceByFactor(summary);

    QUALIFICATION_FACTORS.forEach(factor => {
        const field = form.querySelector(
            `[data-qual-appraisal="${factor.key}"]`
        );
        const counter = form.querySelector(
            `[data-qual-count="${factor.key}"]`
        );

        if (!field) return;

        const paint = () => {
            if (!counter) return;

            const length = field.value.trim().length;

            counter.textContent = length
                ? `${length} caracteres escritos`
                : "Sin escribir";
        };

        field.oninput = paint;
    });

    form.querySelectorAll("[data-qual-insert]").forEach(button => {
        button.onclick = () => {
            const key = button.dataset.qualInsert;
            const index = Number(button.dataset.qualInsertIndex);
            const item = (evidence[key] || [])[index];
            const field = form.querySelector(
                `[data-qual-appraisal="${key}"]`
            );

            if (!item || !field) return;

            // Se agrega al final y no se reemplaza: el antecedente es material
            // para la redaccion, no la redaccion misma.
            const current = field.value.trim();

            field.value = current ? `${current} ${item.text}` : item.text;
            field.focus();
            field.setSelectionRange(field.value.length, field.value.length);
            field.dispatchEvent(new Event("input", { bubbles: true }));
        };
    });
}

/** Subir, abrir y quitar el formulario firmado que vuelve escaneado. */
function bindScanControls(panel, summary, period) {
    if (!summary) return;

    const input = panel.querySelector("[data-qual-scan]");

    if (input) {
        input.onchange = () => {
            // Se le pasa el formulario: adjuntar tiene que guardar tambien lo
            // que este escrito y sin guardar, o el repintado posterior se lo
            // lleva por delante.
            void attachScan(
                input,
                summary,
                period,
                panel.querySelector("[data-qual-form]")
            );
        };
    }

    panel.querySelector("[data-qual-scan-open]")?.addEventListener(
        "click",
        () => {
            void openScan(summary);
        }
    );

    panel.querySelector("[data-qual-scan-remove]")?.addEventListener(
        "click",
        () => {
            void removeScan(summary, period);
        }
    );
}

async function attachScan(input, summary, period, form) {
    const file = input.files?.[0];

    if (!file) return;

    input.disabled = true;

    // Lo escrito en pantalla manda sobre lo guardado: si el supervisor termino
    // de redactar y arrastro el escaneado sin guardar antes, no se pierde.
    const typed = form
        ? collectFormRecord(form, summary, period, STATUS_ARCHIVED)
        : null;

    try {
        const [uploaded] = await readAttachmentFiles([file], {
            moduleId: "qualifications",
            ownerId: summary.profileKey,
            recordId: periodRecordId(period, summary.profile)
        });

        if (!uploaded) return;

        const state = getQualificationState();
        const previous = typed ||
            findRecordForProfile(state, period, summary.profile);
        const record = normalizeRecord({
            ...(previous || {}),
            id: periodRecordId(period, summary.profile),
            profileKey: summary.profileKey,
            profileName: summary.profile.name || "",
            profileRut: summary.profile.rut || "",
            cycleStartYear: period.cycleStartYear,
            periodId: period.id,
            status: STATUS_ARCHIVED,
            scan: uploaded,
            createdAt: previous?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            evaluatedAt: previous?.evaluatedAt || new Date().toISOString()
        });

        persistRecord(record);
    } catch (error) {
        console.error("No se pudo adjuntar el escaneado.", error);
        await showAlert(
            error?.attachmentStorageMessage ||
            String(error?.code || "").startsWith("storage/")
                ? attachmentStorageErrorMessage(error, "subir")
                : error?.message ||
                    "No se pudo adjuntar el archivo. Revisa la conexion e intenta nuevamente.",
            { title: "Calificaciones", tone: "danger" }
        );
    } finally {
        input.disabled = false;
        renderQualificationsPanel();
    }
}

async function openScan(summary) {
    const scan = summary.record?.scan;

    if (!hasAttachmentContent(scan)) return;

    try {
        await openAttachmentFile(scan, { newTab: true });
    } catch (error) {
        await showAlert(
            error?.attachmentStorageMessage
                ? error.message
                : error?.message || "No se pudo abrir el archivo.",
            { title: "Calificaciones", tone: "danger" }
        );
    }
}

async function removeScan(summary, period) {
    const scan = summary.record?.scan;

    if (!scan) return;

    if (!await showConfirm(
        "Se quitara el formulario escaneado de este cuatrimestre. El informe vuelve a quedar como impreso sin firma.",
        {
            title: "Quitar escaneado",
            tone: "danger",
            confirmText: "Quitar",
            destructive: true
        }
    )) {
        return;
    }

    try {
        await deleteStoredAttachment(scan);
    } catch (error) {
        console.warn("No se pudo borrar el archivo del almacenamiento.", error);
    }

    const state = getQualificationState();
    const previous = findRecordForProfile(state, period, summary.profile);

    if (previous) {
        persistRecord(normalizeRecord({
            ...previous,
            scan: null,
            status: STATUS_PRINTED,
            updatedAt: new Date().toISOString()
        }));
    }

    renderQualificationsPanel();
}

async function resetRecord(summary, period) {
    if (!await showConfirm(
        "Se borrara lo escrito en este periodo, incluido el formulario escaneado si lo hay.",
        {
            title: "Reiniciar evaluacion",
            tone: "danger",
            confirmText: "Reiniciar",
            destructive: true
        }
    )) {
        return;
    }

    const scan = summary.record?.scan;

    if (scan) {
        try {
            await deleteStoredAttachment(scan);
        } catch (error) {
            console.warn("No se pudo borrar el archivo del almacenamiento.", error);
        }
    }

    removeRecord(summary, period);
    renderQualificationsPanel();
}

function qualificationDataChanged(keys = []) {
    return keys.some(key => {
        const clean = String(key || "");

        return clean === QUALIFICATIONS_KEY ||
            clean === "profiles" ||
            clean === "attendanceMarks" ||
            clean === "attendanceMarksImportedAt" ||
            clean.startsWith("hrLogs_") ||
            clean.startsWith("admin_") ||
            clean.startsWith("legal_") ||
            clean.startsWith("comp_") ||
            clean.startsWith("absences_") ||
            clean.startsWith("clockMarks_");
    });
}

export function initQualificationsPanel() {
    if (typeof window === "undefined") return;

    const rerenderWhenActive = keys => {
        if (
            document.body.dataset.activeView !== "qualifications" ||
            !qualificationDataChanged(keys)
        ) {
            return;
        }

        incidentCache = {
            key: "",
            loading: false,
            eventsByProfile: new Map()
        };
        renderQualificationsPanel();
    };

    window.addEventListener("proturnos:persistenceChanged", event => {
        rerenderWhenActive(event.detail?.keys || []);
    });

    window.addEventListener("proturnos:firebaseAppState", event => {
        rerenderWhenActive(event.detail?.keys || []);
    });

    window.addEventListener("proturnos:workspacePermissionsChanged", () => {
        if (document.body.dataset.activeView === "qualifications") {
            renderQualificationsPanel();
        }
    });
}
