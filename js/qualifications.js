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

export const QUALIFICATIONS_KEY = "qualifications";

const STATUS_ALL = "all";
const STATUS_PENDING = "pending";
const STATUS_DRAFT = "draft";
const STATUS_EVALUATED = "evaluated";
const MAX_NOTE_LENGTH = 1600;
const MAX_TEXT_LENGTH = 240;

export const QUALIFICATION_FACTORS = [
    {
        key: "rendimiento",
        label: "Rendimiento",
        detail: "Trabajo ejecutado frente a tareas encomendadas.",
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

function validStatus(status) {
    return status === STATUS_DRAFT || status === STATUS_EVALUATED
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
        factors: normalizeFactorValues(record.factors),
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
    if (record.status === STATUS_EVALUATED || record.evaluatedAt) {
        return STATUS_EVALUATED;
    }

    return STATUS_DRAFT;
}

function statusLabel(status) {
    if (status === STATUS_EVALUATED) return "Evaluado";
    if (status === STATUS_DRAFT) return "Borrador";

    return "Pendiente";
}

function statusClass(status) {
    if (status === STATUS_EVALUATED) return "accepted";
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
        .filter(summary =>
            selectedStatus === STATUS_ALL ||
            summary.status === selectedStatus
        )
        .filter(summary =>
            !cleanSearch || searchableText(summary).includes(cleanSearch)
        )
        .sort((a, b) => {
            const order = {
                [STATUS_PENDING]: 0,
                [STATUS_DRAFT]: 1,
                [STATUS_EVALUATED]: 2
            };
            const statusDiff = order[a.status] - order[b.status];

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

    return `
        <button class="qual-period ${active ? "is-active" : ""}"
            type="button"
            data-qual-period="${escapeAttribute(period.id)}">
            <strong>${escapeHTML(period.shortLabel)}</strong>
            <small>${escapeHTML(formatPeriodDeadline(period))}</small>
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

function evidenceItemHTML(item) {
    return `
        <article class="qual-evidence-item qual-evidence-item--${escapeAttribute(item.kind || "event")}">
            <time>${escapeHTML(formatDate(item.iso || entryDate(item)))}</time>
            <div>
                <strong>${escapeHTML(item.label || item.title || item.name || item.kind || "Registro")}</strong>
                ${item.detail
                    ? `<small>${escapeHTML(item.detail)}</small>`
                    : ""}
            </div>
        </article>
    `;
}

function evidenceList(summary) {
    const items = [
        ...summary.merits.map(item => ({
            ...item,
            kind: "merit",
            label: item.title || "Anotacion de merito",
            iso: entryDate(item)
        })),
        ...summary.demerits.map(item => ({
            ...item,
            kind: "demerit",
            label: item.title || "Anotacion de demerito",
            iso: entryDate(item)
        })),
        ...summary.events.map(item => ({
            ...item,
            kind: "event",
            label: "Anotacion",
            iso: entryDate(item)
        })),
        ...summary.training.map(item => ({
            ...item,
            kind: "training",
            label: item.name || "Capacitacion",
            detail: [
                item.hours ? `${item.hours} horas` : "",
                item.grade ? `nota ${item.grade}` : ""
            ].filter(Boolean).join(" | "),
            iso: entryDate(item)
        })),
        ...summary.calendar.map(item => ({
            ...item,
            kind: item.kind || "calendar"
        })),
        ...summary.incidents.map(item => ({
            ...item,
            kind: item.kind,
            label: incidentLabel(item.kind),
            detail: item.detail,
            iso: item.iso
        }))
    ].sort((a, b) =>
        String(a.iso || "").localeCompare(String(b.iso || ""))
    );

    return items.slice(0, 18);
}

function incidentLabel(kind) {
    const labels = {
        atraso: "Atraso",
        missingEntry: "Sin marcaje entrada",
        missingExit: "Sin marcaje salida",
        lateOnExtra: "Marcaje tardio",
        earlyEntry: "Entrada anticipada",
        earlyExit: "Salida temprana",
        lateExit: "Salida posterior",
        unexplainedMarks: "Marcas sin justificar",
        markOnFreeDay: "Marcaje en dia libre"
    };

    return labels[kind] || "Incidencia de marcaje";
}

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

    const profile = summary.profile;
    const record = summary.record;
    const status = summary.status;
    const average = scoreAverage(record) || "-";
    const points = qualificationPoints(record, profile);
    const pointsText = points ? String(points) : "-";
    const listText = qualificationListLabel(points);
    const coefficientGroup =
        QUALIFICATION_COEFFICIENTS[qualificationCoefficientGroup(profile)] ||
        QUALIFICATION_COEFFICIENTS.administrativos_auxiliares;
    const evidence = evidenceList(summary);
    const editable = !readonly;

    return `
        <section class="panel qual-detail-panel">
            <div class="qual-detail-head">
                <div>
                    <span class="worker-request-type">Ficha cuatrimestral</span>
                    <h3>${escapeHTML(profile.name || "Sin nombre")}</h3>
                    <small>${escapeHTML([
                        profile.rut || "Sin RUT",
                        profile.estamento || "",
                        profile.profession || ""
                    ].filter(Boolean).join(" | "))}</small>
                </div>
                <span class="worker-request-status worker-request-status--${statusClass(status)}">
                    ${escapeHTML(statusLabel(status))}
                </span>
            </div>

            <div class="qual-evidence-grid">
                ${kpiCardHTML("Puntaje", pointsText, "Notas x coeficiente", "blue")}
                ${kpiCardHTML("Lista", listText, `Promedio ${average}`, "violet")}
                ${kpiCardHTML("Merito", summary.merits.length, "Hoja de vida", "green")}
                ${kpiCardHTML("Demerito", summary.demerits.length, "Hoja de vida", "red")}
                ${kpiCardHTML("Atrasos", summary.lateCount, "Reloj control", "orange")}
                ${kpiCardHTML("Marcajes", summary.clockIssueCount, "Incidencias", "slate")}
                ${kpiCardHTML(
                    "Capacitacion",
                    summary.training.length + summary.calendarTraining.length,
                    "Periodo evaluado",
                    "teal"
                )}
            </div>

            <section class="qual-doc-summary">
                <div class="qual-doc-row">
                    <span>Periodo</span>
                    <strong>${escapeHTML(period.label)}</strong>
                    <small>${escapeHTML(formatDate(period.startISO))} - ${escapeHTML(formatDate(period.endISO))}</small>
                </div>
                <div class="qual-doc-row">
                    <span>Fecha limite</span>
                    <strong>${escapeHTML(formatPeriodDeadline(period))}</strong>
                    <small>${escapeHTML(deadlineText(period, status === STATUS_EVALUATED ? 0 : 1))}</small>
                </div>
                <div class="qual-doc-row">
                    <span>Fuente</span>
                    <strong>Formulario cuatrimestral</strong>
                    <small>Hoja de vida, observaciones e instrumentos auxiliares</small>
                </div>
                <div class="qual-doc-row">
                    <span>Escala</span>
                    <strong>1 a 10</strong>
                    <small>Subfactores con nota entera</small>
                </div>
                <div class="qual-doc-row">
                    <span>Coeficientes</span>
                    <strong>${escapeHTML(coefficientGroup.label)}</strong>
                    <small>${escapeHTML(QUALIFICATION_FACTORS.map(factor =>
                        `${factor.label}: ${coefficientGroup[factor.key]}`
                    ).join(" | "))}</small>
                </div>
            </section>

            <section class="qual-evidence-list">
                <div class="qual-subhead">
                    <h4>Antecedentes del periodo</h4>
                    <span>${evidence.length} registro(s)</span>
                </div>
                ${evidence.length
                    ? evidence.map(evidenceItemHTML).join("")
                    : `
                        <div class="empty-state empty-state--compact">
                            Sin antecedentes dentro de este periodo.
                        </div>
                    `}
            </section>

            <form class="qual-form" data-qual-form>
                <div class="qual-subhead">
                    <h4>Borrador de evaluacion</h4>
                    <span>${readonly ? "Solo lectura" : "Editable"}</span>
                </div>

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

                <div class="qual-factors">
                    ${QUALIFICATION_FACTORS.map(factor =>
                        factorFieldHTML(factor, record, editable)
                    ).join("")}
                </div>

                <label>
                    <span>Observaciones del supervisor</span>
                    <textarea name="observations"
                        rows="3"
                        maxlength="${MAX_NOTE_LENGTH}"
                        ${editable ? "" : "disabled"}>${escapeHTML(record?.observations || "")}</textarea>
                </label>

                <label>
                    <span>Observaciones del funcionario</span>
                    <textarea name="employeeObservations"
                        rows="3"
                        maxlength="${MAX_NOTE_LENGTH}"
                        ${editable ? "" : "disabled"}>${escapeHTML(record?.employeeObservations || "")}</textarea>
                </label>

                <div class="qual-agreement" role="group" aria-label="Notificacion al funcionario">
                    <label>
                        <input type="radio"
                            name="employeeAgreement"
                            value="conforme"
                            ${record?.employeeAgreement === "conforme" ? "checked" : ""}
                            ${editable ? "" : "disabled"}>
                        <span>Conforme</span>
                    </label>
                    <label>
                        <input type="radio"
                            name="employeeAgreement"
                            value="disconforme"
                            ${record?.employeeAgreement === "disconforme" ? "checked" : ""}
                            ${editable ? "" : "disabled"}>
                        <span>Disconforme</span>
                    </label>
                </div>

                <div class="qual-actions">
                    <button class="primary-button" type="submit" ${editable ? "" : "disabled"}>
                        Guardar borrador
                    </button>
                    <button class="secondary-button" type="button" data-qual-evaluate ${editable ? "" : "disabled"}>
                        Marcar evaluado
                    </button>
                    <button class="secondary-button" type="button" data-qual-print>
                        Imprimir ficha
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
    const factors = {};

    QUALIFICATION_FACTORS.forEach(factor => {
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
        factors,
        supervisorName: form.elements.supervisorName?.value || "",
        supervisorCargo: form.elements.supervisorCargo?.value || "",
        observations: form.elements.observations?.value || "",
        employeeObservations: form.elements.employeeObservations?.value || "",
        employeeAgreement: form.elements.employeeAgreement?.value || "",
        createdAt: previous.createdAt || now,
        updatedAt: now,
        evaluatedAt: status === STATUS_EVALUATED
            ? previous.evaluatedAt || now
            : previous.evaluatedAt || ""
    });
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
    const evaluated = summaries.filter(summary =>
        summary.status === STATUS_EVALUATED
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
                ${evaluated} de ${total} evaluado(s)
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
                ${qualificationPeriods(period.cycleStartYear)
                    .map(periodButtonHTML)
                    .join("")}
            </div>
        </section>
        <section class="qual-kpis">
            ${kpiCardHTML("Pendientes", pending, deadline, pending ? "orange" : "green")}
            ${kpiCardHTML("Borradores", summaries.filter(summary => summary.status === STATUS_DRAFT).length, "En preparacion", "teal")}
            ${kpiCardHTML("Evaluados", evaluated, `Limite ${formatPeriodDeadline(period)}`, "blue")}
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
        [STATUS_EVALUATED]: summaries.filter(summary =>
            summary.status === STATUS_EVALUATED
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
                    ${filterButtonHTML(STATUS_EVALUATED, "Evaluados", counts[STATUS_EVALUATED])}
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

    const periods = qualificationPeriods(selectedCycleStartYear);
    const period = periods.find(item => item.id === selectedPeriodId) ||
        periods[0];
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
        form.onsubmit = event => {
            event.preventDefault();
            persistRecord(collectFormRecord(form, selected, period));
            renderQualificationsPanel();
        };

        form.querySelector("[data-qual-evaluate]")?.addEventListener(
            "click",
            () => {
                persistRecord(
                    collectFormRecord(
                        form,
                        selected,
                        period,
                        STATUS_EVALUATED
                    )
                );
                renderQualificationsPanel();
            }
        );

        form.querySelector("[data-qual-reset]")?.addEventListener(
            "click",
            () => {
                removeRecord(selected, period);
                renderQualificationsPanel();
            }
        );

        form.querySelector("[data-qual-print]")?.addEventListener(
            "click",
            () => {
                window.print();
            }
        );
    }

    if (
        selected &&
        !summaries.some(summary =>
            summary.profileKey === selectedProfileKey
        )
    ) {
        selectedProfileKey = selected.profileKey;
    }
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
