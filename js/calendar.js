import { escapeHTML } from "./htmlUtils.js";
import { showConfirm } from "./dialogs.js";
import {
    aplicarCambiosTurno,
    fusionarTurnos,
    getProtectedDirectEditTurn,
    getTurnoBase,
    getTurnoProgramado
} from "./turnEngine.js";
import {
    calculateWorkerMonthTotals,
    calculateCarryOver
} from "./hoursEngine.js";
import {
    getProfileData,
    saveProfileData,
    getBaseProfileData,
    saveBaseProfileData,
    getBlockedDays,
    saveBlockedDays,
    getCarry,
    saveProfileDayTurn,
    saveCarry,
    getAdminDays,
    getLegalDays,
    getAbsences,
    getCompDays,
    getShiftAssigned,
    getCurrentProfile,
    getProfiles,
    getRotativa,
    getReplacementRequestConfig,
    getTurnChangeConfig,
    getWorkerRequests,
    getReplacements,
    getSwaps,
    isProfileActive,
    profileCanCoverProfile,
    saveReplacements,
    isNoCoverageDay,
    getNoCoverageReason,
    setNoCoverageDay
} from "./storage.js";
import {
    tieneAusencia,
    requiereReemplazoTurnoBase,
    getTurnoExtraAgregado,
    esAusenciaInjustificada,
    getAbsenceType,
    obtenerLabelDia,
    aplicarClasesEspeciales,
    estaBloqueadoModo,
    getTurnoComponentes,
    restarTurnoCubierto,
    turnoDesdeComponentes,
    turnoExtraCubreTurno
} from "./rulesEngine.js";
import { fetchHolidays } from "./holidays.js";
import {
    isBusinessDay,
    isWeekend
} from "./calculations.js";
import {
    turnoLabel,
    aplicarClaseTurno
} from "./uiEngine.js";
import { getDayColorGradient } from "./dayColorBands.js";
import { getTurnoColorConfig } from "./turnoColors.js";
import {
    PENDING_LEAVE_REQUEST_TYPES,
    pendingLeaveRequestEndDate,
    leaveRequestCoversISODate,
    pendingLeaveColorValue
} from "./pendingLeaveRequests.js";
import {
    cancelTimelineRender,
    renderTimeline,
    showTimelinePendingMonth,
    updateTimelineCells
} from "./timeline.js";
import {
    cededSwapTurnBlocks,
    cambioEstaAnulado,
    deshacerCambioTurno,
    getCambioTurnoCalendario,
    getCambiosTurnoCalendario,
    getSwapPerspective,
    swapCodeLabel
} from "./swaps.js";
import {
    cancelShiftMoveById,
    getShiftMoveMarkers,
    getShiftMoves
} from "./shiftMoves.js";
import {
    getAbsenceLabelForProfileDate,
    getBackedTurnForWorker,
    getClockExtraBackupForWorker,
    buildReplacementRequestWhatsAppUrl,
    cancelPreassignment,
    cancelReplacementRequest,
    cancelReplacementById,
    codeToTurno,
    confirmPreassignment,
    createReplacementRequest,
    createReplacementRequests,
    expireReplacementRequests,
    buildPendingRequestIndex,
    getPendingRequestsFromIndex,
    formatRequestTimeLeft,
    getCoveringWorkersForShift,
    getPendingReplacementRequestsForShift,
    getReplacementForCoveredShift,
    getReplacementForWorkerShift,
    replacementActive,
    saveReplacement,
    turnoToCode,
    turnoReplacementLabel,
    workerHasAbsence
} from "./replacements.js";
import {
    getHonorariaContractForDate,
    getInheritedReplacementContractForCoveredShift,
    hasContractForDate,
    isReplacementProfile
} from "./contracts.js";
import {
    getHonorariaExcessForKey,
    getHonorariaLimitMessage,
    getHonorariaMonthlySummary
} from "./honoraria.js";
import {
    addAuditLog,
    AUDIT_CATEGORY,
    getLeaveApplicationInfo,
    getClockMarkAuditInfo,
    getNoCoverageAuditInfo,
    getPreassignmentAuditInfo,
    undoAuditLogEntry
} from "./auditLog.js";
import {
    addPreassignment,
    removePreassignment,
    getPreassignmentForCoveredShift,
    getPreassignmentForWorker,
    getPreassignmentTurnForWorker
} from "./preassignments.js";
import {
    getClockMarks,
    getClockNetExtraHours,
    getClockScheduleState,
    getScheduledSegmentsForProfile,
    hasClockNetExtra,
    hasSevereClockIncident,
    hasSimpleClockIncident
} from "./clockMarks.js";
import {
    classifyClockMarkSegment,
    findClockMarkEntry
} from "./clockMarkUtils.js";
import {
    getHourReturns,
    hourReturnCalendarLabel
} from "./hourReturns.js";
import { withBusyState } from "./busy.js";
import { rotationPositionLabel } from "./rotationUtils.js";
import {
    TURNO,
    TURNO_CLASS
} from "./constants.js";
import {
    getJSON,
    getRaw,
    listKeys,
    removeKey,
    setJSON,
    setRaw
} from "./persistence.js";
import {
    getAppState,
    getWorkerCalendarState,
    resolveWorkerId,
    syncWorkersState,
    syncWorkerCalendarState,
    updateWorkerCalendarMaps
} from "./appState.js";
import {
    calendarKeyInMonth,
    clearCalendarCellRefs,
    diffCalendarRecordKeys,
    getCalendarCell,
    keysForCalendarRange,
    registerCalendarCell,
    replaceCalendarCell
} from "./calendarUpdates.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    cancelInterUnitLoan,
    createInterUnitLoan
} from "./firebaseInterUnitLoans.js";
import {
    findCompatibleReplacementInLinkedUnits
} from "./linkedReplacementService.js";
import {
    getBlockedDayForProfile,
    getWorkerBlockedDays
} from "./workerAvailability.js";
import {
    acceptWorkerRequestById,
    rejectWorkerRequestById
} from "./workerRequests.js";
import { getWorkerAppLinkForProfile } from "./workerAppDataSync.js";
import { runCooperativeRange } from "./mainThreadScheduler.js";
import {
    canEditTarget,
    ensureCanEditTarget
} from "./workspacePermissions.js";
import { searchReplacementsInWorker } from "./workerService.js";
import {
    measurePerformance,
    startPerformanceSpan
} from "./performanceMonitor.js";

export let currentDate = new Date();

const CALENDAR_AUDIT_DELAY_MS = 60000;
const CALENDAR_DIRECT_EDIT_REFRESH_DELAY_MS = 30000;
const CALENDAR_HEAVY_UPDATE_DELAY_MS = 450;
const CALENDAR_CACHE_VERSION = 1;
const CALENDAR_CACHE_PREFIX = "proturnos_ui_cache_calendar_";
const CALENDAR_CACHE_MAX_ENTRIES = 72;
const CALENDAR_CACHE_WRITE_DELAY_MS = 700;
const CALENDAR_PARTIAL_BATCH_SIZE = 5;
const CALENDAR_LARGE_PARTIAL_RATIO = 0.7;
const CALENDAR_LARGE_PARTIAL_MIN_DAYS = 21;
const CALENDAR_SUMMARY_USER_QUIET_MS = 15000;
const CALENDAR_SUMMARY_VISIBLE_RETRY_MS = 120000;
const MANUAL_EXTRA_REASON_PRESETS_KEY = "manualExtraReasonPresets";
const DEFAULT_MANUAL_EXTRA_REASON_PRESETS = [
    "Campa\u00f1a de Invierno",
    "Estaci\u00f3n de Trabajo",
    "Apoyo Oncol\u00f3gico",
    "Apoyo Pabell\u00f3n",
    "Operativo displasia de cadera"
];
// Lista aparte de la de turnos extra: los motivos son de otra naturaleza
// ("Dotacion completa" vs "Campana de Invierno") y mezclarlos ensuciaria las dos.
const NO_COVERAGE_REASON_PRESETS_KEY = "noCoverageReasonPresets";
const DEFAULT_NO_COVERAGE_REASON_PRESETS = [
    "Dotaci\u00f3n completa",
    "Dotaci\u00f3n cubierta por funcionario de 3er turno",
    "Turno sin demanda asistencial",
    "Cobertura resuelta con otra unidad"
];
const calendarAuditTimers = new Map();
const calendarAuditDrafts = new Map();
let linkedReplacementStatus = "";
let calendarRenderRequest = 0;
let calendarNavigationRequest = 0;
let calendarHeavyUpdateRequest = 0;
let calendarHeavyUpdateTimer = 0;
let calendarDirectEditRefreshTimer = 0;
let calendarDirectEditRefreshRequest = 0;
let calendarDirectEditHistoryTimer = 0;
let calendarDirectEditHistoryOpen = false;
const calendarDirectEditPendingChanges = new Map();
let calendarCacheWriteTimer = 0;
let calendarCacheWriteRequest = 0;
let calendarDashboardRefreshTimer = 0;
let calendarDashboardRefreshUsesIdle = false;
let replacementCandidateRequest = 0;
let calendarPickerYear = currentDate.getFullYear();
let calendarMonthPicker = null;
let delegatedCalendar = null;
let calendarSelectionHandler = null;
let lastCalendarView = null;
let pendingCalendarUpdateTimer = 0;
let pendingWorkerSummaryTimer = 0;
let pendingWorkerSummaryRequest = 0;
let calendarLastUserActivityAt = Date.now();
const pendingCalendarKeys = new Set();
const pendingStaffingKeys = new Set();
const calendarCellHandlers = new WeakMap();
const calendarMapSnapshots = new Map();
const calendarMemoryCache = new Map();

const CALENDAR_MONTH_NAMES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre"
];

function calendarCacheHash(value) {
    let hash = 2166136261;
    const text = String(value || "");

    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}

function calendarWorkspaceId() {
    return String(getActiveWorkspace?.()?.id || "local");
}

function calendarMonthKey(year, month) {
    return `${Number(year)}-${Number(month)}`;
}

function calendarTodaySignature() {
    const today = new Date();

    return key(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
    );
}

function calendarVisualSignature() {
    return [
        window.selectionMode || "",
        window.pendingShiftMoveSourceKey || "",
        window.pendingShiftMoveDestinationTurn || 0,
        window.pendingShiftMoveProgrammedTurn || 0,
        window.compCantidad || 0,
        window.legalCantidad || 0,
        window.licenseCantidad || 0,
        window.licenseType || "license",
        typeof window.getProfileDraftSelectionKey === "function"
            ? window.getProfileDraftSelectionKey()
            : "",
        calendarTodaySignature()
    ].join("\u001f");
}

function calendarViewSignature({
    workerId,
    profileName,
    year,
    month,
    activeProfileEnabled
}) {
    return [
        calendarWorkspaceId(),
        workerId || "",
        profileName || "",
        year,
        month,
        activeProfileEnabled ? "active" : "inactive",
        calendarVisualSignature()
    ].join("\u001e");
}

function calendarCacheKey(viewSignature) {
    return (
        CALENDAR_CACHE_PREFIX +
        `${CALENDAR_CACHE_VERSION}_` +
        calendarCacheHash(viewSignature)
    );
}

function parseCalendarCache(raw) {
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function readCalendarCache(cacheKey, {
    viewSignature,
    monthKey,
    workerId
}) {
    const payload = calendarMemoryCache.get(cacheKey) ||
        parseCalendarCache(getRaw(cacheKey, null));

    if (
        !payload ||
        payload.version !== CALENDAR_CACHE_VERSION ||
        payload.viewSignature !== viewSignature ||
        payload.monthKey !== monthKey ||
        payload.workerId !== workerId ||
        typeof payload.html !== "string"
    ) {
        return null;
    }

    calendarMemoryCache.set(cacheKey, payload);
    return payload;
}

function pruneCalendarCache() {
    const keys = listKeys(CALENDAR_CACHE_PREFIX);

    if (keys.length <= CALENDAR_CACHE_MAX_ENTRIES) return;

    keys
        .map(cacheKey => ({
            key: cacheKey,
            savedAt:
                Number(
                    calendarMemoryCache.get(cacheKey)?.savedAt ??
                    parseCalendarCache(getRaw(cacheKey, null))?.savedAt
                ) || 0
        }))
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(CALENDAR_CACHE_MAX_ENTRIES)
        .forEach(entry => {
            calendarMemoryCache.delete(entry.key);
            removeKey(entry.key);
        });
}

function writeCalendarCache(cacheKey, payload) {
    const next = {
        ...payload,
        version: CALENDAR_CACHE_VERSION,
        savedAt: Date.now()
    };

    calendarMemoryCache.set(cacheKey, next);

    try {
        measurePerformance(
            "calendar:write-html-cache",
            () => {
                setRaw(cacheKey, JSON.stringify(next));
                pruneCalendarCache();
            },
            {
                htmlLength: String(payload?.html || "").length,
                profileName: payload?.profileName || "",
                workerId: payload?.workerId || ""
            }
        );
    } catch {
        calendarMemoryCache.delete(cacheKey);
    }
}

function cancelScheduledCalendarCacheWrite() {
    clearTimeout(calendarCacheWriteTimer);
    calendarCacheWriteTimer = 0;
    calendarCacheWriteRequest++;
}

function clearCalendarCache() {
    cancelScheduledCalendarCacheWrite();
    calendarMemoryCache.clear();
    listKeys(CALENDAR_CACHE_PREFIX).forEach(removeKey);
}

function clearCalendarCacheForWorker(workerId) {
    if (!workerId) return;

    cancelScheduledCalendarCacheWrite();
    listKeys(CALENDAR_CACHE_PREFIX).forEach(cacheKey => {
        const payload = calendarMemoryCache.get(cacheKey) ||
            parseCalendarCache(getRaw(cacheKey, null));

        if (payload?.workerId === workerId) {
            calendarMemoryCache.delete(cacheKey);
            removeKey(cacheKey);
        }
    });
}

function registerCalendarCellsFromDOM(calendar) {
    clearCalendarCellRefs();
    calendar?.querySelectorAll(".day[data-date]").forEach(cell => {
        registerCalendarCell(
            cell.dataset.workerId,
            cell.dataset.keyDay,
            cell
        );
    });
}

function writeActiveCalendarCache(calendar = document.getElementById("calendar")) {
    if (!calendar || !lastCalendarView?.cacheKey) return;

    writeCalendarCache(lastCalendarView.cacheKey, {
        viewSignature: lastCalendarView.viewSignature,
        monthKey: lastCalendarView.monthKey,
        workerId: lastCalendarView.workerId,
        profileName: lastCalendarView.profileName,
        year: lastCalendarView.year,
        month: lastCalendarView.month,
        html: calendar.innerHTML,
        hasMultipleBadgeDays:
            calendar.classList.contains("has-multiple-badge-days")
    });
}

function scheduleActiveCalendarCacheWrite(
    calendar = document.getElementById("calendar"),
    {
        delay = CALENDAR_CACHE_WRITE_DELAY_MS
    } = {}
) {
    if (!calendar || !lastCalendarView?.cacheKey) return;

    const snapshot = {
        calendar,
        cacheKey: lastCalendarView.cacheKey,
        viewSignature: lastCalendarView.viewSignature,
        workerId: lastCalendarView.workerId,
        monthKey: lastCalendarView.monthKey
    };
    const requestId = ++calendarCacheWriteRequest;
    const setTimer =
        typeof window !== "undefined" && window.setTimeout
            ? window.setTimeout.bind(window)
            : setTimeout;

    clearTimeout(calendarCacheWriteTimer);
    calendarCacheWriteTimer = setTimer(async () => {
        calendarCacheWriteTimer = 0;

        await waitCalendarIdle(500);

        if (
            requestId !== calendarCacheWriteRequest ||
            !lastCalendarView ||
            lastCalendarView.calendar !== snapshot.calendar ||
            lastCalendarView.cacheKey !== snapshot.cacheKey ||
            lastCalendarView.viewSignature !== snapshot.viewSignature ||
            lastCalendarView.workerId !== snapshot.workerId ||
            lastCalendarView.monthKey !== snapshot.monthKey
        ) {
            return;
        }

        writeActiveCalendarCache(calendar);
    }, Math.max(0, Number(delay) || 0));
}

function activateCalendarCache(calendar, cached, {
    calendarPanel,
    workerId,
    profileName,
    year,
    month,
    days,
    holidays = {},
    cacheKey,
    viewSignature,
    monthKey
}) {
    calendar.innerHTML = cached.html;
    calendar.dataset.calendarState = "cached";
    calendar.setAttribute("aria-busy", "true");
    registerCalendarCellsFromDOM(calendar);
    calendar.classList.toggle(
        "has-multiple-badge-days",
        Boolean(cached.hasMultipleBadgeDays)
    );
    calendarPanel?.classList.toggle(
        "has-multiple-badge-days",
        Boolean(cached.hasMultipleBadgeDays)
    );
    lastCalendarView = {
        calendar,
        workerId,
        profileName,
        year,
        month,
        holidays,
        holidaysLoaded: false,
        days,
        cacheKey,
        viewSignature,
        monthKey
    };
}

function showCalendarBackgroundPending(calendar, {
    workerId,
    profileName,
    year,
    month,
    days,
    cacheKey,
    viewSignature,
    monthKey
}) {
    calendar.replaceChildren();
    calendar.dataset.calendarState = "background-loading";
    calendar.setAttribute("aria-busy", "true");
    clearCalendarCellRefs();
    lastCalendarView = {
        calendar,
        workerId,
        profileName,
        year,
        month,
        holidays: {},
        holidaysLoaded: false,
        days,
        cacheKey,
        viewSignature,
        monthKey
    };
}

function scheduleCalendarBackgroundFreshRender(options = {}) {
    const navigationRequest = Number(options.navigationRequest) || 0;
    const delay = options.cached ? 240 : 80;

    void (async () => {
        await waitCalendarIdle(delay);

        if (
            navigationRequest &&
            navigationRequest !== calendarNavigationRequest
        ) {
            return;
        }

        await renderCalendar({
            ...options,
            backgroundFresh: false,
            skipCache: true
        });
    })();
}

function calendarShiftAssignmentMonth(value = new Date()) {
    if (typeof value === "string") {
        const match = value.trim().match(/^(\d{4})-(\d{2})/);

        if (match) {
            return `${match[1]}-${match[2]}`;
        }
    }

    const date = value instanceof Date
        ? value
        : new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function calendarShiftAssignedResolver(profileName) {
    if (!profileName) return () => false;

    const legacyAssigned =
        Boolean(getJSON(`shift_${profileName}`, false));
    const rawHistory =
        getJSON(`shiftAssignmentHistory_${profileName}`, null);
    const source = rawHistory && typeof rawHistory === "object"
        ? rawHistory
        : {};
    const events = Array.isArray(source.events)
        ? source.events
            .map(event => ({
                month: calendarShiftAssignmentMonth(event?.month),
                assigned: event?.assigned === true
            }))
            .filter(event => event.month)
            .sort((a, b) => a.month.localeCompare(b.month))
        : [];
    const baseline = typeof source.baseline === "boolean"
        ? source.baseline
        : legacyAssigned;

    return date => {
        if (!events.length) return baseline;

        const targetMonth = calendarShiftAssignmentMonth(date);
        let assigned = baseline;

        events.forEach(event => {
            if (!targetMonth || event.month <= targetMonth) {
                assigned = event.assigned;
            }
        });

        return assigned;
    };
}

function buildCalendarReplacementIndex(profileName) {
    const byCoveredDate = new Map();
    const byWorkerDate = new Map();
    const clockExtraBackupByDate = new Map();
    const coveringWorkersByDate = new Map();

    getReplacements()
        .filter(replacementActive)
        .forEach(replacement => {
            const date = String(replacement?.date || "");

            if (!date) return;

            if (
                replacement.replaced === profileName &&
                !byCoveredDate.has(date)
            ) {
                byCoveredDate.set(date, replacement);
            }

            if (
                replacement.replaced === profileName &&
                replacement.worker
            ) {
                const workers = coveringWorkersByDate.get(date) || [];

                if (!workers.includes(replacement.worker)) {
                    workers.push(replacement.worker);
                    coveringWorkersByDate.set(date, workers);
                }
            }

            if (replacement.worker === profileName) {
                if (!byWorkerDate.has(date)) {
                    byWorkerDate.set(date, replacement);
                }

                if (
                    replacement.source === "clock_extra" &&
                    !clockExtraBackupByDate.has(date)
                ) {
                    clockExtraBackupByDate.set(date, replacement);
                }
            }
        });

    return {
        byCoveredDate,
        byWorkerDate,
        clockExtraBackupByDate,
        coveringWorkersByDate
    };
}

function isoToCalendarKeyDay(iso) {
    const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return "";

    return `${Number(match[1])}-${Number(match[2]) - 1}-${Number(match[3])}`;
}

function isoInCalendarMonth(iso, year, month) {
    const match = String(iso || "").match(/^(\d{4})-(\d{2})-/);

    return Boolean(match) &&
        Number(match[1]) === Number(year) &&
        Number(match[2]) - 1 === Number(month);
}

function pushCalendarIndexItem(index, keyDay, item) {
    if (!keyDay || !item) return;

    const list = index.get(keyDay) || [];

    list.push(item);
    index.set(keyDay, list);
}

function buildCalendarTurnChangeIndex(profileName, year, month) {
    const index = new Map();

    getSwaps().forEach(swap => {
        if (
            !swap ||
            cambioEstaAnulado(swap) ||
            (swap.from !== profileName && swap.to !== profileName)
        ) {
            return;
        }

        const perspective = getSwapPerspective(swap, profileName);

        if (!perspective) return;

        if (
            !perspective.changeSkipped &&
            isoInCalendarMonth(perspective.changeDate, year, month)
        ) {
            pushCalendarIndexItem(
                index,
                isoToCalendarKeyDay(perspective.changeDate),
                {
                    swap,
                    perspective,
                    type: "change",
                    label: `CCTT ${perspective.changeTurnLabel}`.trim()
                }
            );
        }

        if (
            !perspective.returnSkipped &&
            isoInCalendarMonth(perspective.returnDate, year, month)
        ) {
            pushCalendarIndexItem(
                index,
                isoToCalendarKeyDay(perspective.returnDate),
                {
                    swap,
                    perspective,
                    type: "return",
                    label: `DDTT ${perspective.returnTurnLabel}`.trim()
                }
            );
        }
    });

    return index;
}

function buildCalendarShiftMoveIndex(profileName, year, month) {
    const index = new Map();

    getShiftMoves()
        .filter(move => move.profile === profileName)
        .forEach(move => {
            [
                move.sourceKey,
                move.targetKey
            ].forEach(keyDay => {
                if (!calendarKeyInMonth(keyDay, year, month)) return;

                pushCalendarIndexItem(index, keyDay, {
                    move,
                    role:
                        move.sourceKey === move.targetKey
                            ? "same"
                            : move.sourceKey === keyDay
                                ? "source"
                                : "target",
                    label: "TTMM"
                });
            });
        });

    return index;
}

function buildCalendarBlockedDayIndex(profileName) {
    const profileKey = String(profileName || "").trim();
    const index = new Map();

    if (!profileKey) return index;

    getWorkerBlockedDays()
        .filter(item => item.profileName === profileName)
        .forEach(item => {
            if (item.date) index.set(item.date, item);
        });

    return index;
}

function calendarAdjacentTurnForMoveShift(
    profileName,
    keyDay,
    offset,
    sourceKey = ""
) {
    const date = dateFromKeyDay(keyDay);

    if (Number.isNaN(date.getTime())) return TURNO.LIBRE;

    date.setDate(date.getDate() + Number(offset || 0));

    const adjacentKey = key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );

    if (
        adjacentKey === sourceKey &&
        adjacentKey !== keyDay
    ) {
        return TURNO.LIBRE;
    }

    return Number(
        aplicarCambiosTurno(
            profileName,
            adjacentKey,
            getTurnoProgramado(profileName, adjacentKey)
        )
    ) || TURNO.LIBRE;
}

function buildPendingLeaveRequestIndex(profileName, year, month, days) {
    const index = new Map();
    const requests = getWorkerRequests().filter(request =>
        request.status === "pending" &&
        request.profile === profileName &&
        PENDING_LEAVE_REQUEST_TYPES.has(request.type)
    );

    if (!requests.length) return index;

    for (let d = 1; d <= days; d++) {
        const keyDay = key(year, month, d);
        const iso = isoFromKeyDay(keyDay);
        const request = requests.find(item =>
            leaveRequestCoversISODate(item, iso)
        );

        if (request) index.set(keyDay, request);
    }

    return index;
}

function buildCalendarContractIndex(profileName, year, month, days) {
    const index = new Map();

    if (!isReplacementProfile(profileName)) return index;

    for (let d = 1; d <= days; d++) {
        const keyDay = key(year, month, d);

        index.set(keyDay, hasContractForDate(profileName, keyDay));
    }

    return index;
}

function clockMarkHasSevereIncident(mark) {
    if (!mark?.segments) return false;

    return Object.values(mark.segments).some(segment =>
        (segment?.missingEntry || segment?.missingExit) &&
        !segment?.rrhhPayApproved
    );
}

function clockMarkHasSimpleIncident(mark) {
    if (!mark?.segments || clockMarkHasSevereIncident(mark)) {
        return false;
    }

    return Object.values(mark.segments).some(segment =>
        (segment?.entryTime || segment?.exitTime) &&
        !segment?.rrhhPayApproved &&
        !segment?.discountWaived
    );
}

async function handleCalendarClick(event) {
    const cell = event.target.closest(".day[data-action='calendar-day']");

    if (!cell || !delegatedCalendar?.contains(cell)) return;

    const selectionWasActive = Boolean(window.selectionMode);

    if (calendarSelectionHandler) {
        const handled = await calendarSelectionHandler({
            event,
            cell,
            date: dateFromKeyDay(cell.dataset.keyDay)
        });

        if (selectionWasActive || handled === true) return;
    }

    const handler = calendarCellHandlers.get(cell);

    if (handler) {
        await handler(event);
        return;
    }

    await handleCalendarCellFallbackClick(cell, event);
}

function ensureCalendarDelegation(calendar) {
    if (!calendar || delegatedCalendar === calendar) return;

    delegatedCalendar?.removeEventListener("click", handleCalendarClick);
    delegatedCalendar = calendar;
    delegatedCalendar.addEventListener("click", handleCalendarClick);
}

async function handleCalendarCellFallbackClick(cell, event) {
    const activeProfile = getCurrentProfile();
    const keyDay = cell?.dataset?.keyDay || "";

    if (!activeProfile || !keyDay) return;

    const workers = getAppState().workers?.length
        ? getAppState().workers
        : getProfiles();
    const activeWorker = workers.find(worker =>
        worker.name === activeProfile
    ) || null;
    const activeProfileEnabled =
        isProfileActive(activeWorker || activeProfile);

    if (!activeProfileEnabled) {
        event.stopPropagation();
        alert("Este perfil esta desactivado. Reactivalo desde Perfil para modificar su calendario.");
        return;
    }

    const date = dateFromKeyDay(keyDay);
    const year = date.getFullYear();
    const month = date.getMonth();
    const holidays =
        lastCalendarView?.year === year &&
        lastCalendarView?.month === month &&
        lastCalendarView?.holidaysLoaded === true
            ? lastCalendarView.holidays || {}
            : await fetchHolidays(year);
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const data = getProfileData();
    const baseState = getTurnoBase(activeProfile, keyDay);
    const state = aplicarCambiosTurno(
        activeProfile,
        keyDay,
        getTurnoProgramado(activeProfile, keyDay)
    );
    const pendingLeaveRequest =
        getPendingLeaveRequestForDay(activeProfile, keyDay);

    if (
        pendingLeaveRequest &&
        !window.selectionMode
    ) {
        event.stopPropagation();
        return openPendingLeaveRequestDialog({
            request: pendingLeaveRequest,
            profile: activeProfile,
            keyDay,
            baseState
        });
    }

    const turnChangeMarkers =
        getCambiosTurnoCalendario(activeProfile, keyDay);
    const turnChangeMarker = turnChangeMarkers[0] || null;
    const turnChange = turnChangeMarker?.swap || null;
    const shiftMoveMarkers =
        getShiftMoveMarkers(activeProfile, keyDay);
    const shiftMoveMarker = shiftMoveMarkers[0] || null;
    const coveredReplacement =
        getReplacementForCoveredShift(activeProfile, keyDay);
    const workerReplacement =
        getReplacementForWorkerShift(activeProfile, keyDay);
    const replacementContractError =
        isReplacementProfile(activeProfile) &&
        state > 0 &&
        !hasContractForDate(activeProfile, keyDay);
    const honorariaSummary = getHonorariaMonthlySummary(
        activeProfile,
        year,
        month,
        holidays
    );
    const honorariaExcess =
        getHonorariaExcessForKey(honorariaSummary, keyDay);
    const severeClockIncident =
        hasSevereClockIncident(activeProfile, keyDay);
    const clockMarkForDay = getClockMarks(activeProfile)[keyDay] || null;
    const simpleClockIncident =
        Boolean(clockMarkForDay) &&
        !severeClockIncident &&
        clockMarkHasSimpleIncident(clockMarkForDay);
    const inheritedContractCoverage =
        getInheritedReplacementContractForCoveredShift(
            activeProfile,
            keyDay
        );
    const needsReplacement =
        requiereReemplazoTurnoBase(
            keyDay,
            baseState,
            admin,
            legal,
            comp,
            absences
        ) &&
        !coveredReplacement &&
        !inheritedContractCoverage &&
        !isNoCoverageDay(activeProfile, keyDay);
    const pendingManualExtra =
        getPendingManualExtraTurn(
            activeProfile,
            keyDay,
            data
        );
    const showExtraReason =
        !needsReplacement &&
        !turnChange &&
        !replacementContractError &&
        pendingManualExtra;
    const clockExtra =
        hasClockNetExtra(
            activeProfile,
            keyDay,
            date,
            state,
            holidays
        );
    const showClockExtraReason =
        clockExtra &&
        !getClockExtraBackupForWorker(activeProfile, keyDay);
    const badgeTarget = event.target.closest(".day-badge");

    if (replacementContractError && badgeTarget) {
        event.stopPropagation();
        window.startReplacementContractEdit?.(
            activeProfile,
            keyDay
        );
        return;
    }

    if (
        honorariaExcess &&
        !replacementContractError &&
        !severeClockIncident &&
        !needsReplacement &&
        badgeTarget
    ) {
        event.stopPropagation();
        alert(getHonorariaLimitMessage(honorariaSummary, keyDay));
        return;
    }

    if (showExtraReason && badgeTarget) {
        event.stopPropagation();
        return openExtraReasonDialog(
            activeProfile,
            keyDay,
            showExtraReason
        );
    }

    if (showClockExtraReason && badgeTarget) {
        event.stopPropagation();
        return openClockExtraReasonDialog(
            activeProfile,
            keyDay,
            state
        );
    }

    // Dia con marcaje modificado (icono de reloj): al presionarlo se abre el
    // detalle del marcaje. No aplica si aun falta el motivo de horas extra (badge
    // "?") ni durante un modo de seleccion (p. ej. marcaje/permisos).
    if (
        simpleClockIncident &&
        !showClockExtraReason &&
        !window.selectionMode
    ) {
        event.stopPropagation();
        return openClockMarkDetailDialog({
            profile: activeProfile,
            keyDay,
            date,
            state,
            holidays
        });
    }

    if (
        turnChange ||
        shiftMoveMarker ||
        needsReplacement ||
        workerReplacement
    ) {
        event.stopPropagation();
    }

    await clickDia(
        keyDay,
        isBusinessDay(date, holidays),
        admin,
        legal,
        comp,
        absences,
        {
            cell,
            date,
            holidays
        }
    );
}

export function setCalendarSelectionHandler(handler) {
    calendarSelectionHandler =
        typeof handler === "function" ? handler : null;
}

function closeCalendarMonthPicker() {
    if (!calendarMonthPicker) return;

    calendarMonthPicker.classList.add("hidden");
    document
        .getElementById("monthYear")
        ?.setAttribute("aria-expanded", "false");
}

function positionCalendarMonthPicker() {
    const trigger = document.getElementById("monthYear");

    if (
        !trigger ||
        !calendarMonthPicker ||
        calendarMonthPicker.classList.contains("hidden")
    ) {
        return;
    }

    const gap = 8;
    const edge = 12;
    const triggerRect = trigger.getBoundingClientRect();
    const pickerRect = calendarMonthPicker.getBoundingClientRect();
    const left = Math.min(
        Math.max(
            edge,
            triggerRect.left +
            (triggerRect.width - pickerRect.width) / 2
        ),
        window.innerWidth - pickerRect.width - edge
    );
    const preferredTop = triggerRect.bottom + gap;
    const top = preferredTop + pickerRect.height <= window.innerHeight - edge
        ? preferredTop
        : Math.max(edge, triggerRect.top - pickerRect.height - gap);

    calendarMonthPicker.style.left = `${Math.round(left)}px`;
    calendarMonthPicker.style.top = `${Math.round(top)}px`;
}

function renderCalendarMonthPicker() {
    if (!calendarMonthPicker) return;

    const activeYear = currentDate.getFullYear();
    const activeMonth = currentDate.getMonth();

    calendarMonthPicker.innerHTML = `
        <div class="calendar-month-picker__year">
            <button class="calendar-month-picker__year-button" type="button" data-calendar-year-step="-1" aria-label="A&#241;o anterior">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
            <strong>${calendarPickerYear}</strong>
            <button class="calendar-month-picker__year-button" type="button" data-calendar-year-step="1" aria-label="A&#241;o siguiente">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        </div>
        <div class="calendar-month-picker__months">
            ${CALENDAR_MONTH_NAMES.map((name, month) => `
                <button
                    class="calendar-month-picker__month${calendarPickerYear === activeYear && month === activeMonth ? " is-active" : ""}"
                    type="button"
                    data-calendar-month="${month}"
                >
                    ${name}
                </button>
            `).join("")}
        </div>
    `;

    calendarMonthPicker
        .querySelectorAll("[data-calendar-year-step]")
        .forEach(button => {
            button.onclick = event => {
                event.stopPropagation();
                calendarPickerYear += Number(button.dataset.calendarYearStep);
                renderCalendarMonthPicker();
                positionCalendarMonthPicker();
            };
        });

    calendarMonthPicker
        .querySelectorAll("[data-calendar-month]")
        .forEach(button => {
            button.onclick = async event => {
                event.stopPropagation();
                await goToCalendarMonth(
                    calendarPickerYear,
                    Number(button.dataset.calendarMonth),
                    { deferHeavy: true }
                );
            };
        });
}

function setupCalendarMonthPicker(trigger) {
    if (!trigger || trigger.dataset.monthPickerBound === "true") {
        return;
    }

    trigger.dataset.monthPickerBound = "true";
    calendarMonthPicker = document.createElement("div");
    calendarMonthPicker.className =
        "calendar-month-picker hidden";
    calendarMonthPicker.setAttribute("role", "dialog");
    calendarMonthPicker.setAttribute(
        "aria-label",
        "Seleccionar mes y a\u00f1o"
    );
    document.body.appendChild(calendarMonthPicker);

    trigger.addEventListener("click", event => {
        event.stopPropagation();

        if (!calendarMonthPicker.classList.contains("hidden")) {
            closeCalendarMonthPicker();
            return;
        }

        calendarPickerYear = currentDate.getFullYear();
        renderCalendarMonthPicker();
        calendarMonthPicker.classList.remove("hidden");
        trigger.setAttribute("aria-expanded", "true");
        positionCalendarMonthPicker();
    });

    document.addEventListener("click", closeCalendarMonthPicker);
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeCalendarMonthPicker();
        }
    });
    window.addEventListener("resize", positionCalendarMonthPicker);
    window.addEventListener(
        "scroll",
        positionCalendarMonthPicker,
        true
    );
}

function deferAfterPaint(callback) {
    if (typeof window === "undefined") {
        callback();
        return;
    }

    const run = () => window.setTimeout(callback, 0);

    if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(run);
        });
    } else {
        run();
    }
}

function deferCalendarDashboardRefresh() {
    if (typeof window === "undefined") return;
    if (typeof window.renderDashboardState !== "function") return;

    if (calendarDashboardRefreshTimer) {
        if (
            calendarDashboardRefreshUsesIdle &&
            typeof window.cancelIdleCallback === "function"
        ) {
            window.cancelIdleCallback(calendarDashboardRefreshTimer);
        } else {
            clearTimeout(calendarDashboardRefreshTimer);
        }
    }
    calendarDashboardRefreshUsesIdle = false;

    const run = () => {
        calendarDashboardRefreshTimer = 0;

        if (typeof window.renderDashboardState !== "function") return;
        window.renderDashboardState();
    };

    if (typeof window.requestIdleCallback === "function") {
        calendarDashboardRefreshUsesIdle = true;
        calendarDashboardRefreshTimer = window.requestIdleCallback(run, {
            timeout: 8000
        });
        return;
    }

    calendarDashboardRefreshTimer = window.setTimeout(run, 3000);
}

function waitCalendarIdle(timeout = 120) {
    return new Promise(resolve => {
        if (typeof window === "undefined") {
            resolve();
            return;
        }

        if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(
                () => resolve(),
                { timeout }
            );
            return;
        }

        window.setTimeout(resolve, Math.min(timeout, 80));
    });
}

function markCalendarUserActivity() {
    calendarLastUserActivityAt = Date.now();
}

function calendarHasPendingInput() {
    try {
        return Boolean(
            typeof navigator !== "undefined" &&
            navigator.scheduling &&
            typeof navigator.scheduling.isInputPending === "function" &&
            navigator.scheduling.isInputPending({ includeContinuous: true })
        );
    } catch (_error) {
        return false;
    }
}

function calendarInteractiveDelay(quietMs = CALENDAR_SUMMARY_USER_QUIET_MS) {
    if (typeof document === "undefined") return 0;
    if (document.visibilityState !== "visible") return 0;

    const activeView = document.body?.dataset?.activeView || "turnos";

    if (activeView !== "turnos" && activeView !== "timeline") return 0;

    if (calendarHasPendingInput()) {
        return CALENDAR_SUMMARY_VISIBLE_RETRY_MS;
    }

    const elapsed = Date.now() - calendarLastUserActivityAt;
    const remaining = Math.max(0, Number(quietMs) - elapsed);

    return remaining > 0 ? remaining : 0;
}

function cancelCalendarHeavyUpdates() {
    clearTimeout(calendarHeavyUpdateTimer);
    calendarHeavyUpdateTimer = 0;
    calendarHeavyUpdateRequest++;
    cancelTimelineRender();
}

function renderDeferredPanelError(elementId, message) {
    const div = document.getElementById(elementId);

    if (!div) return;

    div.setAttribute("aria-busy", "false");
    div.innerHTML = `
        <div class="empty-state empty-state--compact">
            ${message}
        </div>
    `;
}

async function runDeferredTimelineUpdate() {
    try {
        await measurePerformance(
            "timeline:deferred-render",
            () => renderTimeline(),
            {
                activeView: document.body.dataset.activeView || "turnos",
                year: currentDate.getFullYear(),
                month: currentDate.getMonth()
            }
        );
    } catch (error) {
        console.error("No se pudo actualizar el timeline", error);
        renderDeferredPanelError(
            "teamTimeline",
            "No se pudo cargar el timeline. Intenta cambiar de mes o recargar."
        );
    }
}

async function runDeferredStaffingUpdate() {
    if (typeof window.renderInlineStaffingAnalysis !== "function") return;

    try {
        await measurePerformance(
            "staffing:inline-deferred-render",
            () => window.renderInlineStaffingAnalysis(),
            {
                activeView: document.body.dataset.activeView || "turnos",
                year: currentDate.getFullYear(),
                month: currentDate.getMonth()
            }
        );
    } catch (error) {
        console.error("No se pudo actualizar el resumen RRHH", error);
        renderDeferredPanelError(
            "staffingReportInline",
            "No se pudo cargar el resumen RRHH. Intenta cambiar de mes o recargar."
        );
    }
}

function runCalendarHeavyUpdates(options = {}, context = null) {
    if (calendarDirectEditRefreshTimer) {
        cancelTimelineRender();
        return;
    }

    const requestId = ++calendarHeavyUpdateRequest;
    const update = async () => {
        const finishHeavyUpdate = startPerformanceSpan(
            "calendar:heavy-updates",
            {
                deferHeavy: options.deferHeavy === true,
                year: currentDate.getFullYear(),
                month: currentDate.getMonth(),
                activeView: document.body.dataset.activeView || "turnos"
            },
            {
                type: "async-span",
                threshold: 180
            }
        );

        calendarHeavyUpdateTimer = 0;

        try {
            if (requestId !== calendarHeavyUpdateRequest) {
                return;
            }

            await waitCalendarIdle(options.deferHeavy ? 900 : 300);

            if (requestId !== calendarHeavyUpdateRequest) {
                return;
            }

            let activeView =
                document.body.dataset.activeView || "turnos";

            if (
                activeView === "turnos" ||
                activeView === "timeline"
            ) {
                await runDeferredTimelineUpdate();
            }

            if (requestId !== calendarHeavyUpdateRequest) {
                return;
            }

            await waitCalendarIdle(500);

            if (requestId !== calendarHeavyUpdateRequest) {
                return;
            }

            if (
                context &&
                context.profile &&
                context.profile === getCurrentProfile() &&
                context.y === currentDate.getFullYear() &&
                context.m === currentDate.getMonth()
            ) {
                measurePerformance(
                    "calendar:calculate-carry-over",
                    () => {
                        const carryOut = calculateCarryOver(
                            context.profile,
                            context.y,
                            context.m,
                            context.days,
                            context.holidays,
                            context.data
                        );
                        const next = new Date(context.y, context.m + 1, 1);

                        saveCarry(
                            next.getFullYear(),
                            next.getMonth(),
                            carryOut
                        );
                    },
                    {
                        profile: context.profile,
                        year: context.y,
                        month: context.m
                    }
                );
            }

            if (requestId !== calendarHeavyUpdateRequest) {
                return;
            }

            await waitCalendarIdle(900);

            if (requestId !== calendarHeavyUpdateRequest) {
                return;
            }

            activeView =
                document.body.dataset.activeView || "turnos";

            if (
                activeView === "turnos" &&
                typeof window.renderInlineStaffingAnalysis === "function"
            ) {
                await runDeferredStaffingUpdate();
            }
        } finally {
            finishHeavyUpdate();
        }
    };

    if (options.deferHeavy) {
        cancelTimelineRender();
        clearTimeout(calendarHeavyUpdateTimer);
        calendarHeavyUpdateTimer = window.setTimeout(
            () => void update(),
            CALENDAR_HEAVY_UPDATE_DELAY_MS
        );
        return;
    }

    void update();
}

function keepCalendarDirectEditHistoryOpen(label) {
    if (
        !calendarDirectEditHistoryOpen &&
        typeof window.pushUndoState === "function"
    ) {
        window.pushUndoState(label);
    }

    calendarDirectEditHistoryOpen = true;
    clearTimeout(calendarDirectEditHistoryTimer);
    calendarDirectEditHistoryTimer = window.setTimeout(() => {
        calendarDirectEditHistoryOpen = false;
        calendarDirectEditHistoryTimer = 0;
    }, CALENDAR_DIRECT_EDIT_REFRESH_DELAY_MS);
}

function closeCalendarDirectEditHistory() {
    clearTimeout(calendarDirectEditHistoryTimer);
    calendarDirectEditHistoryTimer = 0;
    calendarDirectEditHistoryOpen = false;
}

function recordCalendarDirectEditChange({
    profileName,
    keyDay,
    previousTurn,
    nextTurn
} = {}) {
    if (
        !profileName ||
        !keyDay ||
        Number(previousTurn) === Number(nextTurn)
    ) {
        return;
    }

    const profileChanges =
        calendarDirectEditPendingChanges.get(profileName) || new Map();
    const previous = profileChanges.get(keyDay);

    profileChanges.set(keyDay, {
        keyDay,
        previousTurn:
            previous?.previousTurn ?? (Number(previousTurn) || TURNO.LIBRE),
        nextTurn: Number(nextTurn) || TURNO.LIBRE
    });
    calendarDirectEditPendingChanges.set(profileName, profileChanges);
}

function calendarDirectEditMessage(label, affectedDates = []) {
    if (!affectedDates.length) return `${label}. Revisa tu calendario actualizado.`;

    if (affectedDates.length === 1) {
        const match = String(affectedDates[0] || "")
            .match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const displayDate = match
            ? `${match[3]}-${match[2]}-${match[1]}`
            : affectedDates[0];

        return `${label} para el ${displayDate}.`;
    }

    return `${label} en ${affectedDates.length} días de tu calendario.`;
}

function consumeCalendarDirectEditPendingChanges() {
    const batches = [...calendarDirectEditPendingChanges.entries()]
        .map(([profileName, changes]) => {
            const affectedKeys = [...changes.keys()].sort();
            const affectedDates = affectedKeys
                .map(keyDay => isoFromKeyDay(keyDay))
                .filter(Boolean);
            const bulk = affectedDates.length > 1;

            return {
                profileName,
                affectedKeys,
                affectedDates,
                changes: affectedKeys.map(keyDay => changes.get(keyDay)),
                metadata: {
                    changeType: bulk
                        ? "calendar_bulk_updated"
                        : "shift_updated",
                    source: "main_calendar_manual_edit",
                    title: bulk
                        ? "Tu calendario fue actualizado"
                        : "Tu turno fue modificado",
                    message: calendarDirectEditMessage(
                        bulk
                            ? "Se actualizaron turnos manuales"
                            : "Se modificó un turno",
                        affectedDates
                    ),
                    affectedDates,
                    entityId:
                        `direct_edit_${profileName}_${Date.now()}`
                }
            };
        })
        .filter(batch => batch.affectedDates.length);

    calendarDirectEditPendingChanges.clear();

    return batches;
}

function commitCalendarDirectEditPendingChanges() {
    const batches = consumeCalendarDirectEditPendingChanges();

    if (
        !batches.length ||
        typeof window === "undefined"
    ) {
        return batches;
    }

    batches.forEach(batch => {
        window.dispatchEvent(
            new CustomEvent("proturnos:calendarProfilesChanged", {
                detail: {
                    profiles: [batch.profileName],
                    metadata: batch.metadata,
                    delay: 0,
                    source: "calendar_direct_edit_commit"
                }
            })
        );
    });

    window.dispatchEvent(
        new CustomEvent("proturnos:calendarDirectEditCommitted", {
            detail: {
                batches
            }
        })
    );

    return batches;
}

function cancelCalendarDirectEditRefresh() {
    clearTimeout(calendarDirectEditRefreshTimer);
    calendarDirectEditRefreshTimer = 0;
    calendarDirectEditRefreshRequest++;
    calendarRenderRequest++;
    cancelCalendarHeavyUpdates();
    closeCalendarDirectEditHistory();
}

async function flushCalendarDirectEditRefresh(options = {}) {
    const expectedRequest =
        Number(options.requestId) || 0;
    const force = options.force === true;
    const refresh = options.refresh !== false;

    if (
        expectedRequest &&
        expectedRequest !== calendarDirectEditRefreshRequest
    ) {
        return;
    }

    if (!calendarDirectEditRefreshTimer && !force) return;

    clearTimeout(calendarDirectEditRefreshTimer);
    calendarDirectEditRefreshTimer = 0;
    calendarDirectEditRefreshRequest++;
    closeCalendarDirectEditHistory();
    commitCalendarDirectEditPendingChanges();
    if (!refresh) return;
    await updateVisibleCalendarDays({ updateSummary: true });
}

function scheduleCalendarDirectEditRefresh(keyDay) {
    calendarDirectEditRefreshRequest++;
    queueCalendarDayUpdates([keyDay]);
}

window.flushCalendarDirectEditRefresh =
    flushCalendarDirectEditRefresh;
window.commitCalendarDirectEditPendingChanges =
    commitCalendarDirectEditPendingChanges;

function key(y, m, d) {
    return `${y}-${m}-${d}`;
}

function dateFromKeyDay(keyDay) {
    const [year, month, day] = String(keyDay || "")
        .split("-")
        .map(Number);

    return new Date(year || 0, month || 0, day || 1);
}

function isoFromKeyDay(keyDay) {
    const date = dateFromKeyDay(keyDay);

    if (Number.isNaN(date.getTime())) return "";

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function visibleCalendarKeys() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();

    return Array.from(
        { length: days },
        (_item, index) => key(year, month, index + 1)
    );
}

function queueCalendarDayUpdates(keys = []) {
    keys.forEach(keyDay => {
        if (
            calendarKeyInMonth(
                keyDay,
                currentDate.getFullYear(),
                currentDate.getMonth()
            )
        ) {
            pendingCalendarKeys.add(keyDay);
            pendingStaffingKeys.add(keyDay);
        }
    });

    if (!pendingCalendarKeys.size || pendingCalendarUpdateTimer) return;

    const schedule = window.requestAnimationFrame ||
        (callback => window.setTimeout(callback, 16));

    pendingCalendarUpdateTimer = schedule(async () => {
        pendingCalendarUpdateTimer = 0;
        const changedKeys = [...pendingCalendarKeys];
        const staffingKeys = [...pendingStaffingKeys];
        pendingCalendarKeys.clear();
        pendingStaffingKeys.clear();

        if (changedKeys.length) {
            await renderCalendar({
                changedKeys,
                allowDuringDirectEdit: true,
                updateSummary: true
            });
        }

        if (
            staffingKeys.length &&
            typeof window.updateInlineStaffingDays === "function"
        ) {
            void window.updateInlineStaffingDays(staffingKeys);
        }
    });
}

function scheduleWorkerSummaryUpdate(workerId = getCurrentProfile()) {
    const requestId = ++pendingWorkerSummaryRequest;

    clearTimeout(pendingWorkerSummaryTimer);
    pendingWorkerSummaryTimer = window.setTimeout(async () => {
        pendingWorkerSummaryTimer = 0;
        await waitCalendarIdle(600);

        if (requestId !== pendingWorkerSummaryRequest) return;

        const interactiveDelay = calendarInteractiveDelay();

        if (interactiveDelay > 0) {
            pendingWorkerSummaryTimer = window.setTimeout(() => {
                if (requestId === pendingWorkerSummaryRequest) {
                    scheduleWorkerSummaryUpdate(workerId);
                }
            }, interactiveDelay);
            return;
        }

        measurePerformance(
            "calendar:update-worker-summary",
            () => updateWorkerSummary(workerId),
            {
                workerId: String(workerId || ""),
                profile: getCurrentProfile() || "",
                year: currentDate.getFullYear(),
                month: currentDate.getMonth()
            }
        );
    }, 260);
}

function calendarKeyFromDateInput(workerId, date) {
    if (date instanceof Date) {
        return key(date.getFullYear(), date.getMonth(), date.getDate());
    }

    const storedKey = String(date || "");

    if (getCalendarCell(workerId, storedKey)) return storedKey;

    const isoMatch = storedKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const parsed = isoMatch
        ? new Date(
            Number(isoMatch[1]),
            Number(isoMatch[2]) - 1,
            Number(isoMatch[3])
        )
        : new Date(date);

    return Number.isNaN(parsed.getTime())
        ? ""
        : key(
            parsed.getFullYear(),
            parsed.getMonth(),
            parsed.getDate()
        );
}

// Actualiza un conjunto de fechas en una sola pasada. Esto evita repetir la
// lectura del mes y el calculo del resumen cuando un evento cambia varios dias.
export async function updateDayCells(workerId, dates, options = {}) {
    const activeWorkerId = resolveWorkerId(getCurrentProfile());

    if (
        resolveWorkerId(workerId) !== activeWorkerId ||
        lastCalendarView?.workerId !== activeWorkerId ||
        lastCalendarView?.year !== currentDate.getFullYear() ||
        lastCalendarView?.month !== currentDate.getMonth()
    ) return false;

    const changedKeys = Array.from(new Set(
        (Array.isArray(dates) ? dates : [dates])
            .map(date => calendarKeyFromDateInput(activeWorkerId, date))
            .filter(keyDay => keyDay && calendarKeyInMonth(
                keyDay,
                currentDate.getFullYear(),
                currentDate.getMonth()
            ))
    ));

    if (!changedKeys.length) return false;

    changedKeys.forEach(keyDay => pendingCalendarKeys.delete(keyDay));

    await renderCalendar({
        changedKeys,
        allowDuringDirectEdit: true,
        updateSummary: options.updateSummary !== false
    });
    return true;
}

export async function updateDayCell(workerId, date) {
    return updateDayCells(workerId, [date]);
}

export async function updateDateRange(workerId, startDate, endDate) {
    const activeWorkerId = resolveWorkerId(getCurrentProfile());

    if (
        resolveWorkerId(workerId) !== activeWorkerId ||
        lastCalendarView?.workerId !== activeWorkerId ||
        lastCalendarView?.year !== currentDate.getFullYear() ||
        lastCalendarView?.month !== currentDate.getMonth()
    ) return false;

    const changedKeys = keysForCalendarRange(startDate, endDate)
        .filter(keyDay => calendarKeyInMonth(
            keyDay,
            currentDate.getFullYear(),
            currentDate.getMonth()
        ));

    if (!changedKeys.length) return false;

    changedKeys.forEach(keyDay => pendingCalendarKeys.delete(keyDay));

    await renderCalendar({
        changedKeys,
        allowDuringDirectEdit: true,
        updateSummary: true
    });
    return true;
}

export async function updateVisibleCalendarDays(options = {}) {
    const workerId = resolveWorkerId(getCurrentProfile());

    if (
        !workerId ||
        lastCalendarView?.workerId !== workerId ||
        lastCalendarView?.year !== currentDate.getFullYear() ||
        lastCalendarView?.month !== currentDate.getMonth()
    ) return false;

    visibleCalendarKeys().forEach(keyDay =>
        pendingCalendarKeys.delete(keyDay)
    );

    await renderCalendar({
        changedKeys: visibleCalendarKeys(),
        allowDuringDirectEdit: true,
        updateSummary: options.updateSummary === true,
        cooperative: options.cooperative === true,
        modeRefresh: options.modeRefresh === true
    });
    return true;
}

export function updateWorkerSummary(workerId = getCurrentProfile()) {
    const resolvedWorkerId = resolveWorkerId(workerId);
    const workerName = getCurrentProfile();
    const activeWorkerId = resolveWorkerId(workerName);
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    if (
        !resolvedWorkerId ||
        resolvedWorkerId !== activeWorkerId ||
        lastCalendarView?.workerId !== activeWorkerId ||
        lastCalendarView?.year !== year ||
        lastCalendarView?.month !== month
    ) return null;

    const days = new Date(year, month + 1, 0).getDate();
    const holidays = lastCalendarView?.holidays || {};
    const data = getProfileData(workerName);
    const stats = calculateWorkerMonthTotals(
        workerName,
        year,
        month,
        days,
        holidays,
        data,
        getBlockedDays(workerName),
        getCarry(year, month)
    );
    const carryOut = calculateCarryOver(
        workerName,
        year,
        month,
        days,
        holidays,
        data
    );
    const next = new Date(year, month + 1, 1);

    saveCarry(next.getFullYear(), next.getMonth(), carryOut);

    window.dispatchEvent(new CustomEvent("proturnos:workerMonthUpdated", {
        detail: {
            workerId: resolvedWorkerId,
            workerName,
            year,
            month,
            stats,
            carryOut
        }
    }));

    return stats;
}

export function updateVisibleWorkers() {
    window.dispatchEvent(new CustomEvent("proturnos:visibleWorkersUpdated", {
        detail: {
            year: currentDate.getFullYear(),
            month: currentDate.getMonth()
        }
    }));
}

function calendarStorageMaps(profileName) {
    return {
        [`data_${profileName}`]: getJSON(`data_${profileName}`, {}),
        [`admin_${profileName}`]: getJSON(`admin_${profileName}`, {}),
        [`legal_${profileName}`]: getJSON(`legal_${profileName}`, {}),
        [`comp_${profileName}`]: getJSON(`comp_${profileName}`, {}),
        [`absences_${profileName}`]: getJSON(`absences_${profileName}`, {}),
        [`blocked_${profileName}`]: getJSON(`blocked_${profileName}`, {}),
        [`hourReturns_${profileName}`]: getJSON(`hourReturns_${profileName}`, {}),
        [`clockMarks_${profileName}`]: getJSON(`clockMarks_${profileName}`, {})
    };
}

function syncCalendarMapSnapshots(profileName, maps = null) {
    const nextMaps = maps || calendarStorageMaps(profileName);

    Object.entries(nextMaps).forEach(([storageKey, value]) => {
        calendarMapSnapshots.set(storageKey, value || {});
    });
}

function syncCentralCalendarMaps(profileName) {
    const workerId = resolveWorkerId(profileName);

    updateWorkerCalendarMaps(workerId, {
        shifts: getJSON(`data_${profileName}`, {}),
        absences: {
            admin: getJSON(`admin_${profileName}`, {}),
            legal: getJSON(`legal_${profileName}`, {}),
            comp: getJSON(`comp_${profileName}`, {}),
            absences: getJSON(`absences_${profileName}`, {})
        }
    });
}

function storedDateToCalendarKey(value) {
    const text = String(value || "");
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (iso) {
        return key(
            Number(iso[1]),
            Number(iso[2]) - 1,
            Number(iso[3])
        );
    }

    return /^\d{4}-\d{1,2}-\d{1,2}$/.test(text)
        ? text
        : "";
}

function changedCollectionCalendarKeys(
    storageKey,
    change,
    profileName
) {
    if (!change || !("previous" in change) || !("next" in change)) {
        return null;
    }

    const parse = value => {
        try {
            const result = JSON.parse(value || "[]");
            return Array.isArray(result) ? result : [];
        } catch {
            return [];
        }
    };
    const previous = parse(change.previous);
    const next = parse(change.next);
    const itemId = (item, index) => String(
        item?.id || item?.requestId || `${index}:${JSON.stringify(item)}`
    );
    const previousById = new Map(
        previous.map((item, index) => [itemId(item, index), item])
    );
    const nextById = new Map(
        next.map((item, index) => [itemId(item, index), item])
    );
    const changed = [];

    new Set([...previousById.keys(), ...nextById.keys()])
        .forEach(id => {
            const before = previousById.get(id);
            const after = nextById.get(id);

            if (JSON.stringify(before) === JSON.stringify(after)) return;
            changed.push(after || before);
        });

    const keys = new Set();

    changed.forEach(item => {
        if (storageKey === "replacements") {
            if (
                item?.worker !== profileName &&
                item?.replaced !== profileName
            ) return;

            const keyDay = storedDateToCalendarKey(item?.keyDay);
            if (keyDay) keys.add(keyDay);
            return;
        }

        if (storageKey === "swaps") {
            if (
                item?.from !== profileName &&
                item?.to !== profileName
            ) return;

            [item?.fecha, item?.devolucion]
                .map(storedDateToCalendarKey)
                .filter(Boolean)
                .forEach(keyDay => keys.add(keyDay));
        }
    });

    return [...keys];
}

function handleCalendarPersistenceChange(event) {
    const profileName = getCurrentProfile();
    const changedStorageKeys = event?.detail?.keys;
    const storageChanges = event?.detail?.changes || {};

    if (
        !profileName ||
        !lastCalendarView ||
        !Array.isArray(changedStorageKeys)
    ) return;

    if (
        changedStorageKeys.length &&
        changedStorageKeys.every(storageKey =>
            String(storageKey || "").startsWith("proturnos_ui_cache_")
        )
    ) {
        return;
    }

    const profileMaps = calendarStorageMaps(profileName);
    const mapKeys = new Set(Object.keys(profileMaps));
    const fullWorkerKeys = new Set([
        `baseData_${profileName}`,
        `rotativa_${profileName}`,
        `shift_${profileName}`,
        `shiftAssignmentHistory_${profileName}`,
        `contractHistory_${profileName}`,
        `gradeHistory_${profileName}`
    ]);
    const sharedCalendarKeys = new Set([
        "profiles",
        "manualHolidays",
        "turnoColorConfig",
        "turnChangeConfig"
    ]);
    const changedDayKeys = new Set();
    let refreshVisibleMonth = false;
    let clearAllCalendarCaches = false;

    changedStorageKeys.forEach(storageKey => {
        if (mapKeys.has(storageKey)) {
            const previous = calendarMapSnapshots.get(storageKey) || {};
            const next = profileMaps[storageKey] || {};

            diffCalendarRecordKeys(previous, next)
                .forEach(keyDay => changedDayKeys.add(keyDay));
            calendarMapSnapshots.set(storageKey, next);
            return;
        }

        if (storageKey === "replacements" || storageKey === "swaps") {
            const collectionKeys = changedCollectionCalendarKeys(
                storageKey,
                storageChanges[storageKey],
                profileName
            );

            if (collectionKeys === null) {
                refreshVisibleMonth = true;
            } else {
                collectionKeys.forEach(keyDay =>
                    changedDayKeys.add(keyDay)
                );
            }
            return;
        }

        if (
            fullWorkerKeys.has(storageKey) ||
            sharedCalendarKeys.has(storageKey)
        ) {
            refreshVisibleMonth = true;
            if (storageKey === "profiles") {
                clearAllCalendarCaches = true;
            }
        }
    });

    if (!changedDayKeys.size && !refreshVisibleMonth) return;

    if (clearAllCalendarCaches) {
        clearCalendarCache();
    } else {
        clearCalendarCacheForWorker(resolveWorkerId(profileName));
    }

    syncCentralCalendarMaps(profileName);
    queueCalendarDayUpdates(
        refreshVisibleMonth
            ? visibleCalendarKeys()
            : [...changedDayKeys]
    );
}

if (typeof window !== "undefined") {
    window.addEventListener(
        "proturnos:persistenceChanged",
        handleCalendarPersistenceChange
    );
    window.addEventListener("proturnos:firebaseAppState", event => {
        if (event.detail?.type !== "app-state-entries-applied") return;

        handleCalendarPersistenceChange({
            detail: {
                keys: event.detail.keys || []
            }
        });
    });
}

function pendingLeaveRequestLabel(type) {
    if (type === "admin") return "ADM";
    if (type === "half_admin_morning") return "1/2M";
    if (type === "half_admin_afternoon") return "1/2T";
    if (type === "legal") return "FL";
    if (type === "comp") return "FC";
    if (type === "union_leave") return "PG";
    if (type === "unpaid_leave") return "PSG";

    return "Permiso";
}

function pendingLeaveRequestLongLabel(type) {
    if (type === "admin") return "P. Administrativo";
    if (type === "half_admin_morning") return "1/2 ADM Ma\u00f1ana";
    if (type === "half_admin_afternoon") return "1/2 ADM Tarde";
    if (type === "legal") return "F. Legal";
    if (type === "comp") return "F. Compensatorio";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";

    return "Permiso";
}

function getPendingLeaveRequestForDay(profileName, keyDay) {
    const iso = isoFromKeyDay(keyDay);

    if (!profileName || !iso) return null;

    return getWorkerRequests().find(request =>
        request.status === "pending" &&
        request.profile === profileName &&
        PENDING_LEAVE_REQUEST_TYPES.has(request.type) &&
        leaveRequestCoversISODate(request, iso)
    ) || null;
}

function pendingLeaveHoverTitle(request, profileName, keyDay, baseState) {
    if (!request) return "";

    const start = request.date
        ? formatISODateForHover(request.date)
        : leaveDateLabelFromKey(keyDay);
    const end = pendingLeaveRequestEndDate(request);
    const baseLabel = turnoLabel(baseState) || "Libre";

    return [
        "Solicitud pendiente",
        `Trabajador: ${profileName}`,
        `Tipo: ${pendingLeaveRequestLongLabel(request.type)}`,
        `Inicio: ${start}`,
        end && end !== request.date
            ? `Termino: ${formatISODateForHover(end)}`
            : "",
        request.days ? `Dias: ${request.days}` : "",
        `Turno base: ${baseLabel}`,
        request.note ? `Detalle: ${request.note}` : ""
    ].filter(Boolean).join("\n");
}

function openPendingLeaveRequestDialog({
    request,
    profile,
    keyDay,
    baseState
}) {
    if (!request) return;

    const label = pendingLeaveRequestLongLabel(request.type);
    const start = request.date
        ? formatISODateForHover(request.date)
        : leaveDateLabelFromKey(keyDay);
    const end = pendingLeaveRequestEndDate(request);
    const baseLabel = turnoLabel(baseState) || "Libre";
    const canManage =
        typeof window.workspaceCanEditTarget !== "function" ||
        window.workspaceCanEditTarget("workerRequestsPanel");

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog leave-request-dialog" role="dialog" aria-modal="true" aria-labelledby="pendingLeaveRequestTitle">
            <strong id="pendingLeaveRequestTitle">Solicitud pendiente</strong>
            <div class="leave-detail-rows">
                <div><span>Trabajador</span><b>${escapeHTML(profile)}</b></div>
                <div><span>Tipo</span><b>${escapeHTML(label)}</b></div>
                <div><span>Inicio</span><b>${escapeHTML(start)}</b></div>
                ${end && end !== request.date
                    ? `<div><span>T\u00e9rmino</span><b>${escapeHTML(formatISODateForHover(end))}</b></div>`
                    : ""}
                <div><span>D\u00edas</span><b>${escapeHTML(String(request.days || 1))}</b></div>
                <div><span>Turno base</span><b>${escapeHTML(baseLabel)}</b></div>
            </div>
            ${request.note
                ? `<p class="leave-detail-note">${escapeHTML(request.note)}</p>`
                : ""}
            ${canManage
                ? `
                    <div class="turn-change-dialog__actions">
                        <button class="primary-button" type="button" data-action="accept">Aceptar</button>
                        <button class="secondary-button" type="button" data-action="reject">Rechazar</button>
                        <button class="ghost-button" type="button" data-action="close">Cerrar</button>
                    </div>
                `
                : `
                    <p class="leave-detail-note">Tu usuario solo puede revisar esta solicitud.</p>
                    <div class="turn-change-dialog__actions">
                        <button class="ghost-button" type="button" data-action="close">Cerrar</button>
                    </div>
                `}
        </section>
    `;

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };
    const onKeydown = event => {
        if (event.key === "Escape") close();
    };
    const finish = async action => {
        const button = backdrop.querySelector(`[data-action='${action}']`);

        if (button) {
            button.disabled = true;
            button.textContent =
                action === "accept" ? "Aceptando..." : "Rechazando...";
        }

        const ok = action === "accept"
            ? await acceptWorkerRequestById(request.id)
            : await rejectWorkerRequestById(request.id);

        if (!ok) {
            if (button) {
                button.disabled = false;
                button.textContent =
                    action === "accept" ? "Aceptar" : "Rechazar";
            }
            return;
        }

        close();
        window.dispatchEvent(
            new CustomEvent("proturnos:workerRequestsChanged")
        );
        await updateDateRange(
            profile,
            request.date || isoFromKeyDay(keyDay),
            end || request.date || isoFromKeyDay(keyDay)
        );
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-action='close']")
        ?.addEventListener("click", close);
    backdrop
        .querySelector("[data-action='accept']")
        ?.addEventListener("click", () => void finish("accept"));
    backdrop
        .querySelector("[data-action='reject']")
        ?.addEventListener("click", () => void finish("reject"));

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
}

function scheduleCalendarAuditLog({
    profile,
    keyDay,
    previousTurn,
    nextTurn
}) {
    if (!profile || !keyDay) return;

    const id = `${profile}::${keyDay}`;
    const currentDraft =
        calendarAuditDrafts.get(id);
    const draft = {
        profile,
        keyDay,
        previousTurn: currentDraft
            ? currentDraft.previousTurn
            : previousTurn,
        nextTurn
    };

    calendarAuditDrafts.set(id, draft);

    if (calendarAuditTimers.has(id)) {
        clearTimeout(calendarAuditTimers.get(id));
    }

    calendarAuditTimers.set(
        id,
        setTimeout(() => {
            const finalDraft =
                calendarAuditDrafts.get(id);

            calendarAuditTimers.delete(id);
            calendarAuditDrafts.delete(id);

            if (!finalDraft) return;
            if (
                Number(finalDraft.previousTurn) ===
                Number(finalDraft.nextTurn)
            ) {
                return;
            }

            addAuditLog(
                AUDIT_CATEGORY.CALENDAR,
                "Modifico turno manualmente",
                `${finalDraft.profile}: ${finalDraft.keyDay} paso de ${turnoLabel(finalDraft.previousTurn) || "Libre"} a ${turnoLabel(finalDraft.nextTurn) || "Libre"}.`,
                {
                    profile: finalDraft.profile,
                    keyDay: finalDraft.keyDay,
                    previousTurn: finalDraft.previousTurn,
                    nextTurn: finalDraft.nextTurn,
                    delayed: true
                }
            );
        }, CALENDAR_AUDIT_DELAY_MS)
    );
}

// Logo documento+lapiz para marcar, en el calendario principal, los dias con un
// contrato de Honorarios vigente (indica que ese dia admite turnos).
const HONORARIA_CONTRACT_ICON = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5"/>
        <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
        <path d="M10.42 12.61a2.1 2.1 0 1 1 2.97 2.97L7.95 21 4 22l.99-3.95 5.43-5.44Z"/>
    </svg>
`;

// Badge de "marcaje reloj control modificado": reemplaza el antiguo asterisco por
// un icono de reloj. Es un centinela (no texto visible) que buildDayCell detecta
// para renderizar el SVG en vez de escaparlo como texto.
const CLOCK_MARK_BADGE = "clock-mark";
const CLOCK_MARK_BADGE_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5"/>
        <path d="M12 7.5V12l3 2"/>
    </svg>
`;

// Badge de "turno preasignado" (cobertura tentativa): pastilla con gradiente
// naranjo (via CSS) y tres puntos blancos. Reemplaza al "!" en la casilla del
// ausente y marca el turno tentativo del reemplazante. Centinela que buildDayCell
// detecta para rendir el SVG.
// Badge de "solicitud de cobertura enviada": celular, para distinguir de un
// vistazo el turno que ya salio a las PWA del que todavia no se pidio a nadie.
const REQUEST_PENDING_BADGE = "request-pending";
const REQUEST_PENDING_BADGE_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="7" y="2" width="10" height="20" rx="2.2"/>
        <path d="M11 18.5h2"/>
    </svg>
`;

const PREASSIGN_BADGE = "preassign";
const PREASSIGN_BADGE_ICON = `
    <svg viewBox="0 0 24 10" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="5" r="2.3"/>
        <circle cx="12" cy="5" r="2.3"/>
        <circle cx="19" cy="5" r="2.3"/>
    </svg>
`;

// Icono del boton de opciones del modal de reemplazo (barras + triangulo hacia
// abajo): al presionarlo despliega el panel de opciones.
const REPLACEMENT_OPTIONS_ICON = `
    <svg viewBox="0 0 30 24" fill="none" aria-hidden="true">
        <g stroke="currentColor" stroke-width="2.8" stroke-linecap="round">
            <line x1="2" y1="5" x2="15" y2="5"/>
            <line x1="2" y1="12" x2="15" y2="12"/>
            <line x1="2" y1="19" x2="15" y2="19"/>
        </g>
        <path d="M19 8H28L23.5 15Z" fill="currentColor"/>
    </svg>
`;

function buildDayCell({
    day,
    month,
    year,
    keyDay,
    label,
    alternateLabel,
    badge,
    badges,
    title,
    isWeekendDay,
    isHoliday,
    isDraftSelected,
    hasHonorariaContract
}) {
    const div = document.createElement("div");

    div.classList.add("day");
    div.dataset.day = day;
    div.dataset.month = month;
    div.dataset.year = year;

    if (isWeekendDay) {
        div.classList.add("weekend");
    }

    if (isHoliday) {
        div.classList.add("holiday");
    }

    const today = new Date();
    if (
        today.getFullYear() === Number(year) &&
        today.getMonth() === Number(month) &&
        today.getDate() === Number(day)
    ) {
        div.classList.add("today");
    }

    if (isDraftSelected) {
        div.classList.add("draft-selected");
    }

    if (hasHonorariaContract) {
        div.classList.add("honoraria-contract-day");
    }

    const contractMarkHTML = hasHonorariaContract
        ? `<span class="day-contract-mark" title="Contrato de honorarios vigente">${HONORARIA_CONTRACT_ICON}</span>`
        : "";

    const visibleBadges = Array.isArray(badges)
        ? badges.filter(Boolean)
        : (badge ? [badge] : []);

    if (visibleBadges.length > 1) {
        div.classList.add("has-multiple-badges");
    }

    const badgeHTML = visibleBadges.length
        ? `
            <span class="day-badges">
                ${visibleBadges.map(item => {
                    if (item === CLOCK_MARK_BADGE) {
                        return `<span class="day-badge day-badge--clock" title="Marcaje reloj control modificado">${CLOCK_MARK_BADGE_ICON}</span>`;
                    }

                    if (item === PREASSIGN_BADGE) {
                        return `<span class="day-badge day-badge--preassign" title="Turno preasignado (pendiente de confirmar)">${PREASSIGN_BADGE_ICON}</span>`;
                    }

                    if (item === REQUEST_PENDING_BADGE) {
                        return `<span class="day-badge day-badge--request" title="Solicitud de cobertura enviada: en espera de respuesta">${REQUEST_PENDING_BADGE_ICON}</span>`;
                    }

                    const className = item === "No disp."
                        ? "day-badge day-badge--worker-blocked"
                        : "day-badge";

                    return `<span class="${className}">${escapeHTML(item)}</span>`;
                }).join("")}
            </span>
        `
        : "";
    const labelHTML = alternateLabel
        ? `
            <span class="day-label day-label--alternating">
                <span class="day-label__primary">${escapeHTML(label || "")}</span>
                <span class="day-label__alternate">${escapeHTML(alternateLabel || "")}</span>
            </span>
        `
        : `<span class="day-label">${escapeHTML(label || "")}</span>`;

    div.innerHTML = `
        <span class="day-number">${day}</span>
        ${contractMarkHTML}
        <span class="day-label-stack">
            ${labelHTML}
            ${badgeHTML}
        </span>
    `;

    if (title) {
        div.title = title;
    }

    return div;
}

function confirmUndoTurnChange(swap) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <div class="turn-change-dialog" role="dialog" aria-modal="true" aria-labelledby="turnChangeDialogTitle">
                <strong id="turnChangeDialogTitle">Cambio de turno aplicado</strong>
                <p>
                    Para modificar el turno de este dia debes deshacer el cambio de turno aplicado.
                </p>
                <div class="turn-change-dialog__meta">
                    ${swap.from} -> ${swap.to}
                </div>
                <ul class="turn-change-dialog__swap-detail">
                    ${swap.fecha ? `
                        <li>
                            <span>Entrega</span>
                            <strong>${escapeHTML(formatISODateForSwapHover(swap.fecha))} &middot; ${escapeHTML(swapCodeLabel(swap.turno))}</strong>
                        </li>
                    ` : ""}
                    ${swap.devolucion ? `
                        <li>
                            <span>Devuelve</span>
                            <strong>${escapeHTML(formatISODateForSwapHover(swap.devolucion))} &middot; ${escapeHTML(swapCodeLabel(swap.turnoDevuelto))}</strong>
                        </li>
                    ` : ""}
                </ul>
                <div class="turn-change-dialog__actions">
                    <button class="secondary-button" type="button" data-action="cancel">
                        Cancelar
                    </button>
                    <button class="primary-button" type="button" data-action="undo">
                        Deshacer
                    </button>
                </div>
            </div>
        `;

        const close = value => {
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            resolve(value);
        };

        const onKeydown = event => {
            if (event.key === "Escape") {
                close(false);
            }
        };

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close(false);
            }
        });

        backdrop
            .querySelector("[data-action='cancel']")
            .onclick = () => close(false);

        backdrop
            .querySelector("[data-action='undo']")
            .onclick = () => close(true);

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);

        backdrop
            .querySelector("[data-action='undo']")
            .focus();
    });
}

async function handleTurnChangeDayClick(swap) {
    const shouldUndo =
        await confirmUndoTurnChange(swap);

    if (!shouldUndo) {
        return true;
    }

    if (typeof window.pushUndoState === "function") {
        window.pushUndoState("Deshacer cambio de turno");
    }

    deshacerCambioTurno(swap);
    await updateDayCell(getCurrentProfile(), swap.fecha);
    await updateDayCell(getCurrentProfile(), swap.devolucion);

    return true;
}

function replacementDetailDateLabel(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return String(value || "");

    return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
    ).toLocaleDateString(
        "es-CL",
        {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric"
        }
    );
}

function replacementDetailCreatedLabel(value) {
    const date = new Date(value || "");

    if (Number.isNaN(date.getTime())) return "Sin registro";

    return date.toLocaleString(
        "es-CL",
        {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}

function replacementDetailSourceLabel(replacement = {}) {
    if (replacement.isLoan || replacement.source === "inter_unit_loan") {
        return "Prestamo entre unidades";
    }

    const source = String(replacement.source || "");

    if (source === "manual_extra") return "Turno extra manual";
    if (source === "clock_extra") return "Horas extras por marcaje";
    if (source === "forced_replacement") return "Reemplazo forzado";
    if (source === "replacement_request") return "Solicitud aceptada";
    if (source === "forced_replacement_request") {
        return "Solicitud forzada aceptada";
    }

    return "Reemplazo de turno";
}

function replacementDetailHoursLabel(replacement = {}) {
    const hours =
        replacement.overtimeHours ||
        replacement.clockHours ||
        null;

    if (!hours) return "";

    if (typeof hours === "number") {
        return `${hours} h`;
    }

    const day = Number(hours.d) || 0;
    const night = Number(hours.n) || 0;

    if (!day && !night) return "";

    return `D: ${day} h · N: ${night} h`;
}

function replacementDetailTurnLabel(replacement = {}) {
    const turno = codeToTurno(replacement.turno);

    return turnoReplacementLabel(turno) ||
        replacement.turno ||
        "Sin turno";
}

function replacementDetailReasonLabel(replacement = {}) {
    const reason = String(replacement.reason || "").trim();
    const absenceType = String(replacement.absenceType || "").trim();

    return replacement.replaced
        ? (absenceType || reason || "Sin detalle")
        : (reason || absenceType || "Sin detalle");
}

function getReplacementDetailRecord(
    profileName,
    keyDay,
    replacementId = ""
) {
    if (replacementId) {
        const match = getReplacements().find(replacement =>
            replacementActive(replacement) &&
            String(replacement.id || "") === String(replacementId)
        );

        if (match) return match;
    }

    return getReplacementForWorkerShift(profileName, keyDay);
}

async function openReplacementDetailDialog(
    profileName,
    keyDay,
    replacementId = ""
) {
    const replacement = getReplacementDetailRecord(
        profileName,
        keyDay,
        replacementId
    );

    if (!replacement) return false;

    // Solo lectura en Turnos: el detalle sigue siendo consultable (es
    // informacion del turno), pero pierde la accion de anular.
    const canEdit = canEditTarget("calendarPanel");

    const backdrop = document.createElement("div");
    const title = replacement.replaced
        ? (
            replacement.isLoan
                ? "Prestamo asignado"
                : "Reemplazo asignado"
        )
        : "Turno extra asignado";
    const details = [
        ["Trabajador", replacement.worker || profileName],
        replacement.replaced
            ? [
                replacement.isLoan ? "Cubre a" : "Reemplaza a",
                replacement.replaced
            ]
            : null,
        ["Fecha", replacementDetailDateLabel(replacement.date)],
        ["Turno", replacementDetailTurnLabel(replacement)],
        [
            replacement.replaced ? "Ausencia" : "Motivo",
            replacementDetailReasonLabel(replacement)
        ],
        ["Origen", replacementDetailSourceLabel(replacement)],
        replacement.workerWorkspaceName
            ? ["Unidad origen", replacement.workerWorkspaceName]
            : null,
        replacement.hostWorkspaceName
            ? ["Unidad destino", replacement.hostWorkspaceName]
            : null,
        replacementDetailHoursLabel(replacement)
            ? ["HH.EE", replacementDetailHoursLabel(replacement)]
            : null,
        ["Registrado", replacementDetailCreatedLabel(replacement.createdAt)]
    ].filter(Boolean);

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog replacement-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="replacementDetailTitle">
            <strong id="replacementDetailTitle">${escapeHTML(title)}</strong>
            ${canEdit ? `
            <p>
                Para modificar este turno extra debes anular el reemplazo aplicado.
            </p>
            ` : ""}
            <div class="leave-detail-rows replacement-detail-rows">
                ${details.map(([label, value]) => `
                    <div>
                        <span>${escapeHTML(label)}</span>
                        <b>${escapeHTML(value)}</b>
                    </div>
                `).join("")}
            </div>
            ${canEdit ? `
            <p class="leave-detail-note">
                Al anularlo, se quitara este turno extra del calendario del trabajador que cubre y se actualizara la cobertura del trabajador reemplazado.
            </p>
            ` : ""}
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    ${canEdit ? "Cancelar" : "Cerrar"}
                </button>
                ${canEdit ? `
                <button class="leave-detail-undo" type="button" data-action="undo">
                    Anular reemplazo
                </button>
                ` : ""}
            </div>
        </section>
    `;

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    backdrop
        .querySelector("[data-action='cancel']")
        .onclick = close;

    const undoButton = backdrop.querySelector("[data-action='undo']");

    if (undoButton) undoButton.onclick = async () => {
        const confirmed = await showConfirm(
            `Se anulara el reemplazo de ${replacement.worker} para el ${replacementDetailDateLabel(replacement.date)}.`,
            {
                title: "Anular reemplazo",
                tone: "danger",
                confirmText: "Anular reemplazo",
                cancelText: "Volver",
                destructive: true
            }
        );

        if (!confirmed) return;

        await withBusyState(async () => {
            if (typeof window.pushUndoState === "function") {
                window.pushUndoState("Anular reemplazo");
            }

            if (replacement.isLoan && replacement.interUnitLoanId) {
                await cancelInterUnitLoan(
                    replacement.interUnitLoanId,
                    replacement.hostWorkspaceId || ""
                );
            }

            const canceled = cancelReplacementById(
                replacement.id,
                {
                    reason: "supervisor_canceled",
                    details: "Reemplazo anulado desde el calendario."
                }
            );

            if (!canceled) {
                alert("No se pudo anular el reemplazo. Es posible que ya haya cambiado.");
                return;
            }

            close();

            await updateDayCell(
                canceled.worker || profileName,
                canceled.date || keyDay
            );

            if (canceled.replaced) {
                await updateDayCell(
                    canceled.replaced,
                    canceled.date || keyDay
                );
            }

            updateTimelineCells(
                canceled.worker || profileName,
                [keyDay]
            );

            if (canceled.replaced) {
                updateTimelineCells(
                    canceled.replaced,
                    [keyDay]
                );
            }
        }, {
            label: "Anulando reemplazo..."
        });
    };

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop
        .querySelector("[data-action='undo']")
        ?.focus();

    return true;
}

window.openReplacementDetailDialog = openReplacementDetailDialog;

function sameRoleProfiles(profileName) {
    const profiles = getProfiles();
    const base = profiles.find(profile =>
        profile.name === profileName
    );

    if (!base || !isProfileActive(base)) return [];

    return profiles.filter(profile =>
        profile.name !== profileName &&
        isProfileActive(profile) &&
        profileCanCoverProfile(profile, base)
    );
}

function replacementScopeProfiles(profileName, scope = "compatible") {
    const profiles = getProfiles();
    const base = profiles.find(profile =>
        profile.name === profileName
    );

    if (!base || !isProfileActive(base)) return [];

    return profiles.filter(profile =>
        profile.name !== profileName &&
        isProfileActive(profile) &&
        (
            scope === "all-local" ||
            profileCanCoverProfile(profile, base)
        )
    );
}

function keyToISODate(keyDay) {
    const parts = String(keyDay || "").split("-");

    return `${parts[0]}-${String(Number(parts[1]) + 1).padStart(2, "0")}-${String(Number(parts[2])).padStart(2, "0")}`;
}

function formatISODateForHover(value) {
    const parts = String(value || "").split("-");

    if (parts.length !== 3) return String(value || "");

    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function formatISODateForSwapHover(value) {
    const parts = String(value || "")
        .split("-")
        .map(Number);

    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        return formatISODateForHover(value);
    }

    return new Intl.DateTimeFormat(
        "es-CL",
        {
            day: "numeric",
            month: "long"
        }
    ).format(new Date(parts[0], parts[1] - 1, parts[2]));
}

function turnChangeHoverTitle(marker, profileName) {
    const swap = marker?.swap;
    const perspective = marker?.perspective;

    if (!swap) return "";

    if (perspective) {
        return [
            !perspective.changeSkipped &&
                `Cambia su turno base de ${perspective.changeTurnLabel} del ${formatISODateForSwapHover(perspective.changeDate)} con ${perspective.counterpart}`,
            !perspective.returnSkipped &&
                `Devuelve el turno el ${formatISODateForSwapHover(perspective.returnDate)} realizando ${perspective.returnTurnLabel}`
        ].filter(Boolean).join("\n");
    }

    return [
        `Cambio de turno: ${marker.label}`,
        `Trabajador seleccionado: ${profileName}`,
        `Entrega turno: ${swap.from}`,
        `Recibe turno: ${swap.to}`,
        `Fecha cambio: ${formatISODateForHover(swap.fecha)}`,
        `Turno cambio: ${swapCodeLabel(swap.turno)}`,
        `Fecha devoluci\u00f3n: ${formatISODateForHover(swap.devolucion)}`,
        `Turno devoluci\u00f3n: ${swapCodeLabel(swap.turnoDevuelto)}`
    ].filter(Boolean).join("\n");
}

function formatShiftMoveDate(keyDay) {
    const date = dateFromKeyDay(keyDay);

    if (Number.isNaN(date.getTime())) {
        return String(keyDay || "");
    }

    return new Intl.DateTimeFormat(
        "es-CL",
        {
            day: "numeric",
            month: "long",
            year: "numeric"
        }
    ).format(date);
}

function shiftMoveTurnLabel(turn) {
    return Number(turn) === TURNO.NOCHE
        ? "Noche"
        : "Larga";
}

function shiftMoveHoverTitle(marker) {
    const move = marker?.move;

    if (!move) return "";

    const detail = [
        "Turno modificado (TTMM)",
        `Trabajador: ${move.profile}`,
        `Origen: ${formatShiftMoveDate(move.sourceKey)} · ${shiftMoveTurnLabel(move.sourceTurn)}`,
        `Destino: ${formatShiftMoveDate(move.targetKey)} · ${shiftMoveTurnLabel(move.destinationTurn)}`
    ];

    if (marker.role === "source") {
        detail.push("Este dia quedo libre por el movimiento.");
    } else if (marker.role === "target") {
        detail.push("Este dia recibio el turno movido.");
    } else {
        detail.push("En este dia se modifico el horario del turno.");
    }

    return detail.join("\n");
}

function shiftMoveCreatedLabel(value) {
    const date = new Date(value || "");

    if (Number.isNaN(date.getTime())) return "Sin registro";

    return date.toLocaleString(
        "es-CL",
        {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}

function restoreShiftMoveValue(
    object,
    keyDay,
    hadValue,
    previousValue
) {
    if (hadValue) {
        object[keyDay] = previousValue;
    } else {
        delete object[keyDay];
    }
}

function fallbackUndoShiftMoveValues(move) {
    const complement = Number(move.destinationTurn) === TURNO.LARGA
        ? TURNO.NOCHE
        : TURNO.LARGA;

    return {
        sourceHadData: true,
        sourcePreviousData: Number(move.sourceTurn) || TURNO.LIBRE,
        sourceHadBase: true,
        sourcePreviousBase: Number(move.sourceTurn) || TURNO.LIBRE,
        sourceHadBlocked: true,
        sourcePreviousBlocked: true,
        targetHadData:
            move.targetKey === move.sourceKey ||
            move.combinedInto24 === true,
        targetPreviousData:
            move.targetKey === move.sourceKey
                ? Number(move.sourceTurn) || TURNO.LIBRE
                : move.combinedInto24
                    ? complement
                    : TURNO.LIBRE,
        targetHadBase:
            move.targetKey === move.sourceKey ||
            move.combinedBaseComplement === true,
        targetPreviousBase:
            move.targetKey === move.sourceKey
                ? Number(move.sourceTurn) || TURNO.LIBRE
                : move.combinedBaseComplement
                    ? complement
                    : TURNO.LIBRE,
        targetHadBlocked: true,
        targetPreviousBlocked: true
    };
}

function undoShiftMoveCalendarState(move) {
    const profile = move?.profile || "";

    if (!profile) return false;

    const undo = move.hasUndoSnapshot
        ? move
        : {
            ...move,
            ...fallbackUndoShiftMoveValues(move)
        };
    const data = getProfileData(profile);
    const baseData = getBaseProfileData(profile);
    const blocked = getBlockedDays(profile);

    restoreShiftMoveValue(
        data,
        move.sourceKey,
        undo.sourceHadData,
        Number(undo.sourcePreviousData) || TURNO.LIBRE
    );
    restoreShiftMoveValue(
        baseData,
        move.sourceKey,
        undo.sourceHadBase,
        Number(undo.sourcePreviousBase) || TURNO.LIBRE
    );
    restoreShiftMoveValue(
        blocked,
        move.sourceKey,
        undo.sourceHadBlocked,
        Boolean(undo.sourcePreviousBlocked)
    );

    if (move.targetKey !== move.sourceKey) {
        restoreShiftMoveValue(
            data,
            move.targetKey,
            undo.targetHadData,
            Number(undo.targetPreviousData) || TURNO.LIBRE
        );
        restoreShiftMoveValue(
            baseData,
            move.targetKey,
            undo.targetHadBase,
            Number(undo.targetPreviousBase) || TURNO.LIBRE
        );
        restoreShiftMoveValue(
            blocked,
            move.targetKey,
            undo.targetHadBlocked,
            Boolean(undo.targetPreviousBlocked)
        );
    }

    saveProfileData(data, profile);
    saveBaseProfileData(baseData, profile);
    saveBlockedDays(blocked, profile);

    return true;
}

async function openShiftMoveDetailDialog(marker) {
    const move = marker?.move || null;

    if (!move) return false;

    const details = [
        ["Trabajador", move.profile],
        ["Origen", formatShiftMoveDate(move.sourceKey)],
        ["Turno origen", shiftMoveTurnLabel(move.sourceTurn)],
        ["Destino", formatShiftMoveDate(move.targetKey)],
        ["Turno destino", shiftMoveTurnLabel(move.destinationTurn)],
        move.combinedInto24
            ? [
                "Combinacion",
                move.combinedBaseComplement
                    ? "Formo 24 con otro turno base"
                    : "Formo 24 con turno extra"
            ]
            : null,
        ["Registrado", shiftMoveCreatedLabel(move.createdAt)]
    ].filter(Boolean);
    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog replacement-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="shiftMoveDetailTitle">
            <strong id="shiftMoveDetailTitle">Turno movido</strong>
            <p>
                Este dia tiene un movimiento de turno aplicado.
            </p>
            <div class="leave-detail-rows replacement-detail-rows">
                ${details.map(([label, value]) => `
                    <div>
                        <span>${escapeHTML(label)}</span>
                        <b>${escapeHTML(value)}</b>
                    </div>
                `).join("")}
            </div>
            <p class="leave-detail-note">
                Al anularlo se restauran el dia de origen y el dia de destino al estado previo al movimiento.
            </p>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
                <button class="leave-detail-undo" type="button" data-action="undo">
                    Anular movimiento
                </button>
            </div>
        </section>
    `;

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    backdrop
        .querySelector("[data-action='cancel']")
        .onclick = close;

    backdrop
        .querySelector("[data-action='undo']")
        .onclick = async () => {
            const confirmed = await showConfirm(
                `Se anulara el movimiento de turno de ${move.profile}.`,
                {
                    title: "Anular movimiento",
                    tone: "danger",
                    confirmText: "Anular movimiento",
                    cancelText: "Volver",
                    destructive: true
                }
            );

            if (!confirmed) return;

            await withBusyState(async () => {
                if (typeof window.pushUndoState === "function") {
                    window.pushUndoState("Anular movimiento de turno");
                }

                const canceled = cancelShiftMoveById(move.id);

                if (!canceled) {
                    alert("No se pudo anular el movimiento. Es posible que ya haya cambiado.");
                    return;
                }

                undoShiftMoveCalendarState(move);

                addAuditLog(
                    AUDIT_CATEGORY.CALENDAR,
                    "Anulo movimiento de turno",
                    `${move.profile}: anulo el movimiento del ${formatShiftMoveDate(move.sourceKey)} al ${formatShiftMoveDate(move.targetKey)}.`,
                    {
                        profile: move.profile,
                        shiftMoveId: move.id,
                        sourceKey: move.sourceKey,
                        targetKey: move.targetKey
                    }
                );

                close();

                await updateDayCells(
                    move.profile,
                    [move.sourceKey, move.targetKey],
                    { updateSummary: true }
                );
                updateTimelineCells(
                    move.profile,
                    [move.sourceKey, move.targetKey]
                );
            }, {
                label: "Anulando movimiento..."
            });
        };

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop
        .querySelector("[data-action='undo']")
        ?.focus();

    return true;
}

function leaveTypeForDay(keyDay, admin, legal, comp, absences) {
    if (admin[keyDay] === 1) return "admin";
    if (admin[keyDay] === "0.5M") return "half_admin_morning";
    if (admin[keyDay] === "0.5T") return "half_admin_afternoon";
    if (admin[keyDay] === 0.5) return "half_admin";
    if (legal[keyDay]) return "legal";
    if (comp[keyDay]) return "comp";

    const absence = absences[keyDay];

    if (!absence) return "";

    return esAusenciaInjustificada(absence)
        ? "unjustified_absence"
        : getAbsenceType(absence);
}

function leaveLabelForType(type) {
    if (type === "admin") return "P. Administrativo";
    if (type === "half_admin_morning") return "1/2 ADM Ma\u00f1ana";
    if (type === "half_admin_afternoon") return "1/2 ADM Tarde";
    if (type === "half_admin") return "1/2 ADM";
    if (type === "legal") return "F. Legal";
    if (type === "comp") return "F. Compensatorio";
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    if (type === "unjustified_absence") return "Ausencia Injustificada";
    if (type === "license") return "Licencia Medica";

    return "Permiso/Ausencia";
}

function leaveSourceMapForType(type, admin, legal, comp, absences) {
    if (
        type === "admin" ||
        type === "half_admin_morning" ||
        type === "half_admin_afternoon" ||
        type === "half_admin"
    ) {
        return admin;
    }

    if (type === "legal") return legal;
    if (type === "comp") return comp;

    return absences;
}

function leaveApplicationHoverTitle(
    profileName,
    keyDay,
    admin,
    legal,
    comp,
    absences,
    coveringWorkers = null
) {
    const type = leaveTypeForDay(
        keyDay,
        admin,
        legal,
        comp,
        absences
    );

    if (!type) return "";

    const info = type === "half_admin"
        ? null
        : getLeaveApplicationInfo({
            profile: profileName,
            keyDay,
            type,
            sourceMap: leaveSourceMapForType(
                type,
                admin,
                legal,
                comp,
                absences
            )
        });

    const covering = Array.isArray(coveringWorkers)
        ? coveringWorkers
        : getCoveringWorkersForShift(profileName, keyDay);

    return [
        leaveLabelForType(type),
        `Aplicado: ${info?.createdAtLabel || "Sin registro"}`,
        `Usuario: ${info?.actorName || "No registrado"}`,
        covering.length ? `Cubre: ${covering.join(", ")}` : ""
    ].filter(Boolean).join("\n");
}

function leaveDateLabelFromKey(keyDay) {
    const [y, m, d] = String(keyDay || "").split("-").map(Number);
    const date = new Date(y, m, d);

    if (Number.isNaN(date.getTime())) return String(keyDay || "");

    return date.toLocaleDateString("es-CL", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
    });
}

function openLeaveDetailDialog({
    profile,
    keyDay,
    admin,
    legal,
    comp,
    absences
}) {
    const type = leaveTypeForDay(keyDay, admin, legal, comp, absences);

    if (!type) return;

    const label = leaveLabelForType(type);
    const info = type === "half_admin"
        ? null
        : getLeaveApplicationInfo({
            profile,
            keyDay,
            type,
            sourceMap: leaveSourceMapForType(
                type,
                admin,
                legal,
                comp,
                absences
            )
        });
    const canUndo = Boolean(info?.canUndo && info?.logId);
    const covering = getCoveringWorkersForShift(profile, keyDay);
    const noCoverage = isNoCoverageDay(profile, keyDay);
    const noCoverageInfo = noCoverage
        ? getNoCoverageAuditInfo(profile, keyDay)
        : null;
    const noCoverageReason = noCoverage
        ? getNoCoverageReason(profile, keyDay)
        : "";

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog leave-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="leaveDetailTitle">
            <strong id="leaveDetailTitle">${escapeHTML(label)}</strong>
            <div class="leave-detail-rows">
                <div><span>Trabajador</span><b>${escapeHTML(profile)}</b></div>
                <div><span>Fecha</span><b>${escapeHTML(leaveDateLabelFromKey(keyDay))}</b></div>
                <div><span>Aplicado</span><b>${escapeHTML(info?.createdAtLabel || "Sin registro")}</b></div>
                <div><span>Por</span><b>${escapeHTML(info?.actorName || "No registrado")}</b></div>
                ${covering.length
                    ? `<div><span>Cubre</span><b>${escapeHTML(covering.join(", "))}</b></div>`
                    : ""}
            </div>
            ${noCoverage ? `
                <div class="leave-detail-nocoverage">
                    <strong>Marcado como "No requiere cobertura"</strong>
                    <div class="leave-detail-rows">
                        <div><span>Asignado</span><b>${escapeHTML(noCoverageInfo?.createdAtLabel || "Sin registro")}</b></div>
                        <div><span>Por</span><b>${escapeHTML(noCoverageInfo?.actorName || "No registrado")}</b></div>
                        ${noCoverageReason
                            ? `<div><span>Motivo</span><b>${escapeHTML(noCoverageReason)}</b></div>`
                            : ""}
                    </div>
                    <p class="leave-detail-note">
                        "Sí requiere cobertura" revierte esta marca: vuelve a aparecer la alerta para asignar un reemplazo.
                    </p>
                </div>
            ` : `
                <p class="leave-detail-note">
                    ${canUndo
                        ? "Anular quitara el permiso/ausencia, cancelara los reemplazos asociados, notificara a los trabajadores afectados y dejara el registro del LOG marcado como anulado."
                        : "Este permiso no tiene un registro en el LOG que permita anularlo automaticamente."}
                </p>
            `}
            <div class="turn-change-dialog__actions ${noCoverage ? "leave-detail-actions--stacked" : ""}">
                ${noCoverage
                    ? `<button class="primary-button" type="button" data-action="require-coverage">Sí requiere cobertura</button>`
                    : ""}
                ${canUndo
                    ? `<button class="leave-detail-undo" type="button" data-action="undo">Anular permiso</button>`
                    : ""}
                <button class="ghost-button" type="button" data-action="close">Cerrar</button>
            </div>
        </section>
    `;

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };
    const onKeydown = event => {
        if (event.key === "Escape") close();
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-action='close']")
        ?.addEventListener("click", close);
    backdrop
        .querySelector("[data-action='require-coverage']")
        ?.addEventListener("click", async () => {
            await withBusyState(async () => {
                if (typeof window.pushUndoState === "function") {
                    window.pushUndoState("Reactivar cobertura");
                }

                setNoCoverageDay(profile, keyDay, false);
                addAuditLog(
                    AUDIT_CATEGORY.CALENDAR,
                    "Reactivo cobertura",
                    `${profile}: ${keyDay} vuelve a requerir cobertura.`,
                    { profile, keyDay }
                );
                close();
                await updateDayCell(profile, keyDay);
                updateTimelineCells(profile, [keyDay]);
                await updateVisibleCalendarDays({ updateSummary: true });
            }, { label: "Guardando..." });
        });
    backdrop
        .querySelector("[data-action='undo']")
        ?.addEventListener("click", async event => {
            const button = event.currentTarget;
            const confirmed = await showConfirm(
                `Se anulará ${label} de ${profile}. También se cancelarán los reemplazos asociados y se notificará a los trabajadores.`,
                {
                    title: "Anular permiso",
                    tone: "danger",
                    confirmText: "Anular permiso",
                    destructive: true
                }
            );

            if (!confirmed) return;

            button.disabled = true;
            button.textContent = "Anulando...";

            try {
                const result = await undoAuditLogEntry(info.logId, {
                    source: "calendar"
                });

                if (!result?.ok) {
                    button.disabled = false;
                    button.textContent = "Anular permiso";
                    alert(
                        "No se pudo anular automaticamente. Es posible que el registro haya cambiado."
                    );
                    return;
                }

                close();
                await updateVisibleCalendarDays({
                    updateSummary: true
                });
            } catch (error) {
                console.error(error);
                button.disabled = false;
                button.textContent = "Anular permiso";
                alert("Ocurrio un error al anular el permiso.");
            }
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
}

function previewDirectTurnChange(
    cell,
    nextTurn,
    date,
    holidays = {},
    options = {}
) {
    if (!cell) return;

    Object.values(TURNO_CLASS)
        .filter(Boolean)
        .forEach(className => {
            cell.classList.remove(className);
        });

    cell.classList.remove(
        "needs-extra-reason",
        "clock-extra-day",
        "clock-incident-day",
        "clock-severe-day",
        "manual-extra-day",
        "turno-split"
    );
    cell.style.removeProperty("background");

    aplicarClaseTurno(cell, nextTurn);

    if (options.manualExtra) {
        const gradient = getDayColorGradient(
            options.profileName,
            options.keyDay,
            nextTurn,
            date,
            holidays,
            null,
            options.baseTurn,
            {
                unbasedComponentsAreExtra: true,
                singleBandGradient: true
            }
        );

        cell.classList.add("manual-extra-day");

        if (gradient) {
            cell.style.setProperty(
                "background",
                gradient,
                "important"
            );
            cell.classList.add("turno-split");
        }
    }

    cell.classList.add("calendar-direct-edit-feedback");
    cell.dataset.directTurnState = String(nextTurn);

    const label = cell.querySelector(".day-label");
    if (label) {
        label.textContent = turnoLabel(nextTurn) || "";
    }

    cell.querySelectorAll(".day-badge").forEach(badge => {
        badge.remove();
    });

    window.setTimeout(() => {
        cell.classList.remove("calendar-direct-edit-feedback");
    }, 160);
}

async function linkedWorkspaceCandidates(
    profileName,
    keyDay,
    neededTurn
) {
    linkedReplacementStatus = "";

    const activeWorkspace = getActiveWorkspace();

    if (!activeWorkspace?.id) {
        linkedReplacementStatus =
            "Selecciona una unidad Firebase activa para buscar en unidades enlazadas.";
        return [];
    }

    const baseProfile = getProfiles().find(profile =>
        profile.name === profileName
    );

    if (!baseProfile) {
        linkedReplacementStatus =
            "No se encontro el perfil que requiere reemplazo.";
        return [];
    }

    const result = await findCompatibleReplacementInLinkedUnits({
        requesterWorkspaceId: activeWorkspace.id,
        date: keyToISODate(keyDay),
        turnCode: turnoToCode(neededTurn),
        targetProfile: {
            estamento: baseProfile.estamento,
            profession: baseProfile.profession
        }
    });
    const candidates = result.candidates.map(candidate => {
        const currentState =
            Number(candidate.availability.currentTurn) || TURNO.LIBRE;

        return {
            profile: {
                id: candidate.workerId,
                name: candidate.name,
                estamento: candidate.estamento,
                profession: candidate.profession,
                role: candidate.role
            },
            currentState,
            isFree: currentState === TURNO.LIBRE,
            isForced: false,
            isLinked: true,
            workspaceId: candidate.workspaceId,
            workspaceName: candidate.workspaceName || candidate.workspaceId,
            linkId: candidate.linkId,
            blockedDay: candidate.availability.blocked
                ? {
                    message:
                        "El trabajador marco esta fecha como no disponible para reemplazos."
                }
                : null,
            hheeDiurnas: 0,
            hheeNocturnas: 0,
            hhee: 0
        };
    });

    linkedReplacementStatus = result.message || (
        !candidates.length
            ? "No hay trabajadores compatibles y disponibles en las unidades enlazadas para esa fecha."
            : ""
    );

    return candidates.sort((a, b) =>
        a.workspaceName.localeCompare(b.workspaceName) ||
        a.profile.name.localeCompare(b.profile.name)
    );
}

function candidateMeta(profile) {
    const profession = profile.profession &&
        profile.profession !== "Sin informacion"
        ? ` | ${profile.profession}`
        : "";

    return `${profile.estamento || "Sin estamento"}${profession}`;
}

function formatCandidateHours(value) {
    const hours = Math.round((Number(value) || 0) * 2) / 2;

    return Number.isInteger(hours)
        ? String(hours)
        : String(hours).replace(".", ",");
}

function replacementCandidateCoverageAttrs(candidate) {
    const attrs = [];

    if (candidate.isDiurnoLongCoverage) {
        attrs.push(`data-diurno-long-coverage="true"`);
    }

    if (candidate.overtimeHours) {
        attrs.push(`data-overtime-day-hours="${Number(candidate.overtimeHours.d) || 0}"`);
        attrs.push(`data-overtime-night-hours="${Number(candidate.overtimeHours.n) || 0}"`);
    }

    return attrs.join(" ");
}

function replacementCandidateWarning(candidate) {
    if (!candidate?.blockedDay) return "";

    return candidate.blockedDay.message ||
        "El trabajador solicito no hacer reemplazos ni cambios de turno en esta fecha.";
}

// Aviso corto que va pegado al estado del candidato ("Segundo libre", "Diurno").
function candidateNextDayShiftNote(candidate) {
    const turn = Number(candidate?.nextDayMorningShift) || TURNO.LIBRE;

    if (!turn) return "";

    return `Al día siguiente tiene turno ${turnoReplacementLabel(turn)}.`;
}

function replacementCoverageFromDataset(dataset = {}) {
    const coverage = {};
    const hasCustomOvertime =
        dataset.overtimeDayHours !== undefined ||
        dataset.overtimeNightHours !== undefined;

    if (dataset.diurnoLongCoverage === "true") {
        coverage.diurnoLongCoverage = true;
    }

    if (hasCustomOvertime) {
        coverage.overtimeHours = {
            d: Number(dataset.overtimeDayHours) || 0,
            n: Number(dataset.overtimeNightHours) || 0
        };
    }

    if (
        !coverage.diurnoLongCoverage &&
        !coverage.overtimeHours
    ) {
        return {};
    }

    return coverage;
}

function getActualState(profileName, keyDay) {
    return aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoProgramado(profileName, keyDay)
    );
}

function offsetCalendarKey(keyDay, offset) {
    const parts = String(keyDay || "")
        .split("-")
        .map(Number);

    if (parts.length !== 3 || parts.some(Number.isNaN)) return "";

    const date = new Date(parts[0], parts[1], parts[2] + offset);

    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function replacementTurnIncludesDaytimeStart(turn) {
    const value = Number(turn) || TURNO.LIBRE;

    return (
        value === TURNO.LARGA ||
        value === TURNO.TURNO24 ||
        value === TURNO.DIURNO ||
        value === TURNO.DIURNO_NOCHE ||
        value === TURNO.MEDIA_MANANA ||
        value === TURNO.MEDIA_TARDE
    );
}

function replacementTurnIncludesNight(turn) {
    const value = Number(turn) || TURNO.LIBRE;

    return (
        value === TURNO.NOCHE ||
        value === TURNO.TURNO24 ||
        value === TURNO.DIURNO_NOCHE ||
        value === TURNO.TURNO18
    );
}

// Turnos que ENTRAN por la mañana (08:00). La media tarde queda fuera a
// proposito: parte a las 14:00, asi que despues de una noche todavia queda la
// mañana para dormir.
function replacementTurnStartsInTheMorning(turn) {
    const value = Number(turn) || TURNO.LIBRE;

    return (
        value === TURNO.LARGA ||
        value === TURNO.TURNO24 ||
        value === TURNO.DIURNO ||
        value === TURNO.DIURNO_NOCHE ||
        value === TURNO.MEDIA_MANANA
    );
}

/**
 * Turno que el candidato tiene al dia siguiente cuando lo que se va a cubrir es
 * una noche, y ese turno empieza por la mañana. La noche termina a las 08:00 y
 * el turno siguiente parte a las 08:00: encadena la jornada sin dormir (el "24
 * invertido" o noche + diurno). No bloquea al candidato -a veces es la unica
 * opcion disponible- pero la tarjeta tiene que decirlo antes de asignar.
 *
 * Se mira el estado COMPROMETIDO (real/proyectado mas preasignaciones), no la
 * rotativa base: si al dia siguiente ya le movieron la Larga, no hay advertencia
 * que dar.
 */
export function nextDayMorningShiftAfterNight(profileName, keyDay, neededTurn) {
    if (!profileName || !keyDay) return TURNO.LIBRE;
    if (!replacementTurnIncludesNight(neededTurn)) return TURNO.LIBRE;

    const next = committedStateWithPreassign(
        profileName,
        offsetCalendarKey(keyDay, 1)
    );

    return replacementTurnStartsInTheMorning(next)
        ? next
        : TURNO.LIBRE;
}

function candidateFreePositionKind(positionLabel = "") {
    const normalized = String(positionLabel || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    if (normalized.includes("segundo libre")) return "segundo-libre";
    if (normalized.includes("primer libre")) return "primer-libre";

    return "";
}

function preferredFreePositionKind(neededTurn) {
    if (
        replacementTurnIncludesNight(neededTurn) &&
        !replacementTurnIncludesDaytimeStart(neededTurn)
    ) {
        return "primer-libre";
    }

    if (replacementTurnIncludesDaytimeStart(neededTurn)) {
        return "segundo-libre";
    }

    return "";
}

function replacementPriorityForCandidate(candidate, neededTurn) {
    const preferred = preferredFreePositionKind(neededTurn);
    const kind = candidateFreePositionKind(candidate.positionLabel);

    if (!preferred || !kind) return 20;

    if (kind === preferred) return 0;

    if (
        kind === "primer-libre" ||
        kind === "segundo-libre"
    ) {
        return 5;
    }

    return 20;
}

function replacementCreatesInvertedTwentyFour(
    profileName,
    keyDay,
    currentState,
    neededTurn,
    config = getTurnChangeConfig()
) {
    if (
        !profileName ||
        !keyDay ||
        config.allowInvertedTwentyFourHourShifts !== false
    ) {
        return false;
    }

    const projected = fusionarTurnos(
        currentState,
        neededTurn
    );
    // Importante: se consulta el estado real/proyectado del dia siguiente,
    // no solo la rotativa base. Si el supervisor ya movio la Larga del dia
    // siguiente, getActualState devolvera Libre y el Segundo libre podra cubrir
    // Noche sin generar 24 invertido.
    const previous = getActualState(
        profileName,
        offsetCalendarKey(keyDay, -1)
    );
    const next = getActualState(
        profileName,
        offsetCalendarKey(keyDay, 1)
    );

    return (
        (
            replacementTurnIncludesDaytimeStart(projected) &&
            replacementTurnIncludesNight(previous)
        ) ||
        (
            replacementTurnIncludesNight(projected) &&
            replacementTurnIncludesDaytimeStart(next)
        )
    );
}

// Estado COMPROMETIDO del trabajador ese dia: su estado real/proyectado fusionado
// con lo que tenga PREASIGNADO (aun sin proyectar). Sirve para las reglas de
// compatibilidad: una preasignacion cuenta como si el turno ya estuviera tomado.
function committedStateWithPreassign(profileName, keyDay) {
    return fusionarTurnos(
        getActualState(profileName, keyDay),
        getPreassignmentTurnForWorker(profileName, keyDay)
    );
}

// Un candidato NO debe sugerirse si, al cubrir el turno buscado, se formaria un 24
// incompatible con un dia adyacente (larga despues de un 24, noche antes de un 24)
// considerando sus preasignaciones. Es la regla SIEMPRE prohibida de adyacencia de
// 24h; al cancelar una preasignacion, el candidato vuelve a ser elegible.
function preassignmentBlocksReplacementCandidate(profileName, keyDay, neededTurn) {
    const projected = fusionarTurnos(
        committedStateWithPreassign(profileName, keyDay),
        neededTurn
    );
    const previous = committedStateWithPreassign(
        profileName,
        offsetCalendarKey(keyDay, -1)
    );
    const next = committedStateWithPreassign(
        profileName,
        offsetCalendarKey(keyDay, 1)
    );
    const isTwentyFour = turno => Number(turno) === TURNO.TURNO24;

    return (
        (isTwentyFour(previous) &&
            replacementTurnIncludesDaytimeStart(projected)) ||
        (isTwentyFour(next) &&
            replacementTurnIncludesNight(projected)) ||
        (isTwentyFour(projected) &&
            (replacementTurnIncludesNight(previous) ||
                replacementTurnIncludesDaytimeStart(next)))
    );
}

// Etiqueta de posicion del candidato dentro del bloque consecutivo del mismo
// turno (p.ej. "Primer libre", "Segunda larga"). Cuenta hacia atras cuantos dias
// seguidos tiene el mismo estado que el dia objetivo. Solo aplica a rotativas de
// tercer y cuarto turno; en otras (diurno, etc.) devuelve "" para caer en la
// etiqueta previa.
function candidatePositionLabel(profileName, keyDay, currentState) {
    const rotationType = getRotativa(profileName).type;

    if (rotationType !== "3turno" && rotationType !== "4turno") {
        return "";
    }

    const parts = keyDay.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    let position = 1;

    for (let back = 1; back <= 10; back++) {
        const previous = new Date(year, month, day - back);
        const previousKey =
            `${previous.getFullYear()}-${previous.getMonth()}-${previous.getDate()}`;

        if (getActualState(profileName, previousKey) !== currentState) {
            break;
        }

        position++;
    }

    return rotationPositionLabel(currentState, position);
}

// Texto de estado del candidato en la lista de reemplazos. Prioriza la posicion
// en la rotativa (3er/4to turno); el diurno se muestra como "Diurno" sin prefijo.
function candidateStateLabel(candidate, pendingRequest) {
    if (pendingRequest) return "Solicitud pendiente";
    if (candidate.positionLabel) return candidate.positionLabel;
    if (candidate.currentState === TURNO.DIURNO) return "Diurno";
    if (candidate.isFree) return "Libre ese dia";

    return `Turno actual: ${turnoReplacementLabel(candidate.currentState)}`;
}

function isHalfAdminValue(value) {
    return (
        value === "0.5M" ||
        value === "0.5T" ||
        value === 0.5
    );
}

function getHalfAdminCoverageTurn(profileName, keyDay) {
    const baseTurn = getTurnoBase(profileName, keyDay);

    if (baseTurn !== TURNO.LARGA) {
        return TURNO.LIBRE;
    }

    const admin = getJSON(`admin_${profileName}`, {});

    if (admin[keyDay] === "0.5M") {
        return TURNO.MEDIA_MANANA;
    }

    if (admin[keyDay] === "0.5T") {
        return TURNO.MEDIA_TARDE;
    }

    return TURNO.LIBRE;
}

function getReplacementNeededTurn(profileName, keyDay) {
    const admin = getJSON(`admin_${profileName}`, {});

    if (isHalfAdminValue(admin[keyDay])) {
        return getHalfAdminCoverageTurn(profileName, keyDay);
    }

    return getTurnoBase(profileName, keyDay);
}

function canCoverShift(
    currentState,
    neededTurn,
    config = getTurnChangeConfig(),
    options = {}
) {
    if (!neededTurn) return false;

    if (
        currentState === TURNO.DIURNO &&
        neededTurn === TURNO.LARGA
    ) {
        return options.allowDiurnoLongCoverage === true;
    }

    const merged = fusionarTurnos(
        currentState,
        neededTurn
    );

    if (merged === currentState) return false;

    if (
        merged === TURNO.TURNO24 &&
        config.allowTwentyFourHourShifts === false
    ) {
        return false;
    }

    return true;
}

function diurnoLongCoverageHours(date) {
    return {
        d: date.getDay() === 5 ? 4 : 3,
        n: 0
    };
}

function isHalfAdminAfternoonCoverage(profileName, keyDay, neededTurn) {
    if (neededTurn !== TURNO.MEDIA_TARDE) return false;

    const admin = getJSON(`admin_${profileName}`, {});

    return admin[keyDay] === "0.5T";
}

function halfAdminAfternoonCoverageHours(currentState, date) {
    if (
        currentState === TURNO.DIURNO ||
        currentState === TURNO.DIURNO_NOCHE
    ) {
        return diurnoLongCoverageHours(date);
    }

    return {
        d: 6,
        n: 0
    };
}

function isDiurnoLongCoverageCandidate(
    profile,
    currentState,
    neededTurn,
    date,
    holidays
) {
    return (
        getRotativa(profile.name).type === "diurno" &&
        currentState === TURNO.DIURNO &&
        neededTurn === TURNO.LARGA &&
        isBusinessDay(date, holidays)
    );
}

function getManualExtraTurn(
    profileName,
    keyDay,
    profileData
) {
    const baseWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
    const actualWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        Object.prototype.hasOwnProperty.call(profileData, keyDay)
            ? Number(profileData[keyDay]) || 0
            : getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
    return getTurnoExtraAgregado(
        baseWithSwaps,
        actualWithSwaps
    );
}

function getPendingManualExtraTurn(
    profileName,
    keyDay,
    profileData
) {
    const extraTurn = getManualExtraTurn(
        profileName,
        keyDay,
        profileData
    );

    return restarTurnoCubierto(
        extraTurn,
        getBackedTurnForWorker(profileName, keyDay)
    );
}

function cancelManualExtraBackupsForTurnChange(
    profileName,
    keyDay,
    nextTurn
) {
    const iso = isoFromKeyDay(keyDay);
    const replacements = getReplacements();
    const now = new Date().toISOString();
    let canceledCount = 0;

    const nextReplacements = replacements.map(replacement => {
        if (
            replacement.canceled ||
            replacement.worker !== profileName ||
            replacement.date !== iso ||
            replacement.source !== "manual_extra"
        ) {
            return replacement;
        }

        canceledCount++;

        return {
            ...replacement,
            canceled: true,
            canceledAt: now,
            canceledBy: "Calendario",
            cancelReason: "manual_turn_changed"
        };
    });

    if (!canceledCount) return 0;

    saveReplacements(nextReplacements);
    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        "Anulo respaldo de turno extra",
        `${profileName}: se quito el motivo/respaldo HHEE del ${iso} porque el turno manual fue modificado a ${turnoLabel(nextTurn) || "Libre"}.`,
        {
            profile: profileName,
            keyDay,
            date: iso,
            nextTurn,
            source: "manual_turn_changed",
            canceledCount
        }
    );

    return canceledCount;
}

async function getReplacementCandidates(
    profileName,
    keyDay,
    options = {}
) {
    const requestId = ++replacementCandidateRequest;
    const date = new Date(
        Number(keyDay.split("-")[0]),
        Number(keyDay.split("-")[1]),
        Number(keyDay.split("-")[2])
    );
    const y = date.getFullYear();
    const m = date.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const holidays = await fetchHolidays(y);
    const neededTurn =
        options.neededTurn ||
        getReplacementNeededTurn(profileName, keyDay);
    const isHalfAfternoonCoverage =
        isHalfAdminAfternoonCoverage(
            profileName,
            keyDay,
            neededTurn
        );
    const baseProfile = getProfiles().find(profile =>
        profile.name === profileName
    );
    const scope = options.scope || "compatible";

    if (scope === "linked") {
        const linked = await linkedWorkspaceCandidates(
            profileName,
            keyDay,
            neededTurn,
            {
                y,
                m,
                days,
                holidays
            }
        );

        return requestId === replacementCandidateRequest
            ? linked
            : null;
    }

    const scopeProfiles = replacementScopeProfiles(profileName, scope);
    const candidates = [];
    const progress = await runCooperativeRange(
        0,
        scopeProfiles.length - 1,
        index => {
            const profile = scopeProfiles[index];
            const currentState =
                getActualState(profile.name, keyDay);
            const positionLabel = candidatePositionLabel(
                profile.name,
                keyDay,
                currentState
            );
            const isDiurnoLongCoverage =
                isDiurnoLongCoverageCandidate(
                    profile,
                    currentState,
                    neededTurn,
                    date,
                    holidays
                );
            const overtimeHours = isDiurnoLongCoverage
                ? diurnoLongCoverageHours(date)
                : isHalfAfternoonCoverage
                    ? halfAdminAfternoonCoverageHours(
                        currentState,
                        date
                    )
                    : null;
            const stats = calculateWorkerMonthTotals(
                profile.name,
                y,
                m,
                days,
                holidays,
                getProfileData(profile.name),
                {},
                { d: 0, n: 0 }
            );
            const hheeDiurnas = Number(stats.hheeDiurnas) || 0;
            const hheeNocturnas = Number(stats.hheeNocturnas) || 0;
            const blockedDay =
                getBlockedDayForProfile(profile.name, keyDay);

            candidates.push({
                profile,
                currentState,
                isFree: currentState === 0,
                positionLabel,
                replacementPriority: replacementPriorityForCandidate(
                    { positionLabel },
                    neededTurn
                ),
                isDiurnoLongCoverage,
                overtimeHours,
                nextDayMorningShift: nextDayMorningShiftAfterNight(
                    profile.name,
                    keyDay,
                    neededTurn
                ),
                isForced:
                    !profileCanCoverProfile(profile, baseProfile),
                blockedDay,
                hheeDiurnas,
                hheeNocturnas,
                hhee: hheeDiurnas + hheeNocturnas
            });
        }, {
            shouldContinue: () =>
                requestId === replacementCandidateRequest
        }
    );

    if (!progress.completed) return null;

    const eligible = candidates.filter(candidate =>
            !workerHasAbsence(candidate.profile.name, keyDay) &&
            !replacementCreatesInvertedTwentyFour(
                candidate.profile.name,
                keyDay,
                candidate.currentState,
                neededTurn,
                getTurnChangeConfig()
            ) &&
            !preassignmentBlocksReplacementCandidate(
                candidate.profile.name,
                keyDay,
                neededTurn
            ) &&
            !cededSwapTurnBlocks(
                candidate.profile.name,
                keyDay,
                neededTurn
            ) &&
            canCoverShift(
                candidate.currentState,
                neededTurn,
                getTurnChangeConfig(),
                {
                    allowDiurnoLongCoverage:
                        candidate.isDiurnoLongCoverage
                }
            )
        );
    try {
        const result = await searchReplacementsInWorker({
            mode: "turnoplus-prepared",
            candidates: eligible
        }, {
            channel: `replacement:${profileName}:${keyDay}`,
            timeoutMs: 15000
        });

        return requestId === replacementCandidateRequest
            ? result.candidates
            : null;
    } catch (error) {
        if (error?.name === "AbortError") return null;
        throw error;
    }
}

/**
 * "Cobertura automatica" de la tarjeta de inicio: manda la solicitud de
 * reemplazo a TODOS los candidatos que podrian cubrir el turno y tienen la app
 * enlazada. Es el equivalente a abrir el cuadro de sugerencias, activar
 * "Solicitar aprobacion" y marcar a todos, sin abrirlo.
 *
 * Usa getReplacementCandidates -el motor real, con las reglas de 24 invertido,
 * preasignaciones, contrato y ausencias- y NO la heuristica del inicio: mandar
 * solicitudes con una lista aproximada es peor que no mandarlas.
 *
 * Devuelve un resumen para que quien lo llama avise que paso.
 */
window.runAutomaticCoverage = async (profileName, keyDay) => {
    const name = String(profileName || "").trim();

    if (!name || !keyDay) {
        return { status: "invalid" };
    }

    if (getReplacementRequestConfig().enableWorkerAcceptanceRequest === false) {
        return { status: "disabled" };
    }

    const neededTurn = getReplacementNeededTurn(name, keyDay);

    if (!neededTurn) return { status: "nothing-to-cover" };

    const candidates = await getReplacementCandidates(name, keyDay);

    if (!candidates) return { status: "canceled" };

    // Un forzado no cumple el perfil del ausente y un dia bloqueado es una
    // peticion expresa del trabajador: ninguno entra en un envio masivo.
    const eligible = candidates.filter(candidate =>
        !candidate.isForced &&
        !candidate.blockedDay &&
        !candidate.isLinked
    );
    const pending = new Set(
        getPendingReplacementRequestsForShift(name, keyDay, neededTurn)
            .map(request => request.worker)
    );
    const withApp = eligible.filter(candidate =>
        Boolean(getWorkerAppLinkForProfile(candidate.profile.name))
    );
    const targets = withApp.filter(candidate =>
        !pending.has(candidate.profile.name)
    );
    const summary = {
        status: "ok",
        candidates: eligible.length,
        withoutApp: eligible.length - withApp.length,
        alreadyPending: withApp.length - targets.length,
        sent: 0
    };

    if (!targets.length) return { ...summary, status: "no-targets" };

    if (typeof window.pushUndoState === "function") {
        window.pushUndoState("Cobertura automatica");
    }

    const requests = createReplacementRequests(
        {
            replaced: name,
            keyDay,
            turno: neededTurn,
            absenceType: getAbsenceLabelForProfileDate(name, keyDay),
            scope: "compatible",
            source: "replacement_request",
            diurnoLongCoverageWorkers: targets
                .filter(candidate => candidate.isDiurnoLongCoverage)
                .map(candidate => candidate.profile.name),
            workerCoverage: Object.fromEntries(
                targets.map(candidate => [
                    candidate.profile.name,
                    {
                        diurnoLongCoverage: Boolean(candidate.isDiurnoLongCoverage),
                        overtimeHours: candidate.overtimeHours || null
                    }
                ])
            )
        },
        targets.map(candidate => candidate.profile.name)
    );

    summary.sent = requests.length;

    await updateDayCell(name, keyDay);
    updateTimelineCells(name, [keyDay]);

    return summary;
};

function replacementDialogHTML({
    profileName,
    keyDay,
    neededTurn,
    absenceType,
    candidates,
    scope,
    requestMode,
    pendingRequests,
    selectedRequestWorkers,
    linkedStatus = "",
    optionsOpen = false,
    preassignMode = false
}) {
    const replacementConfig = getReplacementRequestConfig();
    const allowLinkedSuggestions =
        replacementConfig.enableLinkedUnitSuggestions !== false;
    const allowCrossRoleSuggestions =
        replacementConfig.enableCrossRoleSuggestions !== false;
    const allowWorkerAcceptanceRequest =
        replacementConfig.enableWorkerAcceptanceRequest !== false;
    const forceMode =
        allowCrossRoleSuggestions && scope === "all-local";
    const linkedMode =
        allowLinkedSuggestions && scope === "linked";
    const isRequestMode =
        allowWorkerAcceptanceRequest &&
        !linkedMode &&
        requestMode;
    const pendingByWorker = new Map(
        (pendingRequests || []).map(request => [request.worker, request])
    );
    const selectedWorkers =
        selectedRequestWorkers || new Set();
    const availableWorkers = candidates
        .filter(candidate => !pendingByWorker.get(candidate.profile.name))
        .map(candidate => candidate.profile.name);
    const selectedCount = availableWorkers.filter(worker =>
        selectedWorkers.has(worker)
    ).length;
    const allSelected =
        Boolean(availableWorkers.length) &&
        selectedCount === availableWorkers.length;
    const items = candidates.length
        ? candidates.map((candidate, index) => {
            const pendingRequest =
                pendingByWorker.get(candidate.profile.name);
            const checked =
                selectedWorkers.has(candidate.profile.name);
            const warning = replacementCandidateWarning(candidate);
            const nextDayNote = candidateNextDayShiftNote(candidate);
            const candidateHours = candidate.isLinked
                ? "<b>Disponible</b>"
                : `
                    <b>${formatCandidateHours(candidate.hhee)} HHEE</b>
                    <small class="replacement-candidate-hours">
                        D: ${formatCandidateHours(candidate.hheeDiurnas)}h · N: ${formatCandidateHours(candidate.hheeNocturnas)}h
                    </small>
                `;

            if (isRequestMode) {
                return `
                <label class="replacement-candidate replacement-candidate--request ${candidate.isForced ? "replacement-candidate--forced" : ""} ${candidate.blockedDay ? "replacement-candidate--worker-blocked" : ""} ${nextDayNote ? "replacement-candidate--next-day-shift" : ""} ${pendingRequest ? "is-disabled" : ""}">
                    <input
                        class="replacement-candidate-checkbox"
                        type="checkbox"
                        data-request-worker="${escapeHTML(candidate.profile.name)}"
                        ${replacementCandidateCoverageAttrs(candidate)}
                        ${checked ? "checked" : ""}
                        ${pendingRequest ? "disabled" : ""}
                    >
                    <span>
                        <strong>${escapeHTML(candidate.profile.name)}</strong>
                        <small>${escapeHTML(candidateMeta(candidate.profile))}</small>
                        ${candidate.isLinked ? `<small>Unidad: ${escapeHTML(candidate.workspaceName)}</small>` : ""}
                        <small class="replacement-candidate-state">
                            ${escapeHTML(candidateStateLabel(candidate, pendingRequest))}
                            ${nextDayNote ? `<span class="replacement-candidate-next-shift">${escapeHTML(nextDayNote)}</span>` : ""}
                        </small>
                        ${warning ? `<small class="replacement-candidate-warning">${escapeHTML(warning)}</small>` : ""}
                    </span>
                    <span>
                        ${pendingRequest ? "<em>Pendiente</em>" : ""}
                        ${candidate.isLinked ? "<em>Unidad enlazada</em>" : ""}
                        ${candidate.isForced ? "<em>Forzado</em>" : ""}
                        ${candidate.blockedDay ? "<em>Dia bloqueado</em>" : ""}
                        ${candidateHours}
                    </span>
                </label>
                `;
            }

            const previousCandidate = candidates[index - 1];
            const unitHeading = candidate.isLinked && (
                !previousCandidate?.isLinked ||
                previousCandidate.workspaceId !== candidate.workspaceId
            )
                ? `
                    <div class="replacement-candidate-group-title">
                        ${escapeHTML(candidate.workspaceName || "Unidad enlazada")}
                    </div>
                `
                : "";

            return `
            ${unitHeading}
            <button
                class="replacement-candidate ${candidate.isForced ? "replacement-candidate--forced" : ""} ${candidate.isLinked ? "replacement-candidate--linked" : ""} ${candidate.blockedDay ? "replacement-candidate--worker-blocked" : ""} ${nextDayNote ? "replacement-candidate--next-day-shift" : ""} ${pendingRequest ? "is-disabled" : ""}"
                type="button"
                data-worker="${escapeHTML(candidate.profile.name)}"
                data-worker-profile-id="${escapeHTML(candidate.profile.id || "")}"
                data-worker-workspace-id="${escapeHTML(candidate.workspaceId || "")}"
                data-worker-workspace-name="${escapeHTML(candidate.workspaceName || "")}"
                data-worker-link-id="${escapeHTML(candidate.linkId || "")}"
                ${replacementCandidateCoverageAttrs(candidate)}
                ${pendingRequest ? "disabled" : ""}
            >
                <span>
                    <strong>${escapeHTML(candidate.profile.name)}</strong>
                    <small>${escapeHTML(candidateMeta(candidate.profile))}</small>
                    ${candidate.isLinked ? `<small>Unidad: ${escapeHTML(candidate.workspaceName)}</small>` : ""}
                    <small class="replacement-candidate-state">
                        ${escapeHTML(candidateStateLabel(candidate, pendingRequest))}
                        ${nextDayNote ? `<span class="replacement-candidate-next-shift">${escapeHTML(nextDayNote)}</span>` : ""}
                    </small>
                    ${warning ? `<small class="replacement-candidate-warning">${escapeHTML(warning)}</small>` : ""}
                </span>
                <span>
                    ${pendingRequest ? "<em>Pendiente</em>" : ""}
                    ${candidate.isLinked ? "<em>Unidad enlazada</em>" : ""}
                    ${candidate.isForced ? "<em>Forzado</em>" : ""}
                    ${candidate.blockedDay ? "<em>Dia bloqueado</em>" : ""}
                    ${candidateHours}
                </span>
            </button>
            `;
        }).join("")
        : `
            <div class="empty-state empty-state--compact">
                ${escapeHTML(
                    linkedMode && linkedStatus
                        ? linkedStatus
                        : "No hay trabajadores disponibles para este reemplazo."
                )}
            </div>
        `;
    const pendingList = (pendingRequests || []).length
        ? `
            <div class="replacement-request-list">
                ${(pendingRequests || []).map(request => `
                    <article class="replacement-request-item">
                        <span>
                            <strong>${escapeHTML(request.worker)}</strong>
                            <small>Caduca: ${escapeHTML(new Date(request.expiresAt).toLocaleString("es-CL"))}</small>
                        </span>
                        <button class="ghost-button" type="button" data-cancel-request="${escapeHTML(request.id)}">
                            Anular
                        </button>
                    </article>
                `).join("")}
            </div>
        `
        : "";
    const bulkActions = isRequestMode
        ? `
            <div class="replacement-bulk-actions">
                <label>
                    <input type="checkbox" data-action="select-all-requests" ${allSelected ? "checked" : ""} ${availableWorkers.length ? "" : "disabled"}>
                    <span>Enviar solicitud a todos</span>
                </label>
                <button class="primary-button" type="button" data-action="send-selected-requests" ${selectedCount ? "" : "disabled"}>
                    Enviar a seleccionados (${selectedCount})
                </button>
            </div>
        `
        : "";
    const scopeControls = [
        `
            <button
                class="replacement-segment ${(!forceMode && !linkedMode) ? "is-active" : ""}"
                type="button"
                data-action="scope-compatible"
                aria-pressed="${(!forceMode && !linkedMode) ? "true" : "false"}"
            >
                Compatibles
            </button>
        `,
        allowCrossRoleSuggestions
            ? `
                <button
                    class="replacement-segment ${forceMode ? "is-active" : ""}"
                    type="button"
                    data-action="toggle-force"
                    aria-pressed="${forceMode ? "true" : "false"}"
                >
                    Otras profesiones
                </button>
            `
            : "",
        allowLinkedSuggestions
            ? `
                <button
                    class="replacement-segment replacement-segment--green ${linkedMode ? "is-active" : ""}"
                    type="button"
                    data-action="linked-units"
                    aria-pressed="${linkedMode ? "true" : "false"}"
                >
                    Unidades enlazadas
                </button>
            `
            : ""
    ].filter(Boolean).join("");
    const assignmentControls = [
        `
            <button
                class="replacement-segment ${(!isRequestMode && !preassignMode) ? "is-active" : ""}"
                type="button"
                data-action="assignment-direct"
                aria-pressed="${(!isRequestMode && !preassignMode) ? "true" : "false"}"
            >
                Asignar ahora
            </button>
        `,
        (!linkedMode && allowWorkerAcceptanceRequest)
            ? `
                <button
                    class="replacement-segment replacement-segment--green ${isRequestMode ? "is-active" : ""}"
                    type="button"
                    data-action="request-mode"
                    aria-pressed="${isRequestMode ? "true" : "false"}"
                >
                    Solicitar aprobaci&oacute;n
                </button>
            `
            : "",
        `
            <button
                type="button"
                class="replacement-segment replacement-segment--amber ${preassignMode ? "is-active" : ""}"
                data-action="preassign-mode"
                aria-pressed="${preassignMode ? "true" : "false"}"
            >
                Preasignar
            </button>
        `
    ].filter(Boolean).join("");
    const optionControls = `
        <div class="replacement-option-row">
            <span class="replacement-option-label">Alcance</span>
            <div class="replacement-segmented">
                ${scopeControls}
            </div>
        </div>
        <div class="replacement-option-row">
            <span class="replacement-option-label">Asignaci&oacute;n</span>
            <div class="replacement-segmented">
                ${assignmentControls}
            </div>
        </div>
        <div class="replacement-coverage-exception ${preassignMode ? "is-disabled" : ""}">
            <span class="replacement-coverage-exception-copy">
                <strong>Excepci&oacute;n de cobertura</strong>
                <small>Oculta la alerta de este d&iacute;a cuando el turno no necesita reemplazo.</small>
            </span>
            <button class="replacement-coverage-button" type="button" data-action="no-coverage" ${preassignMode ? "disabled" : ""}>
                No requiere cobertura
            </button>
        </div>
    `;

    return `
        <div class="turn-change-dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacementDialogTitle">
            <div class="replacement-dialog-header">
                <strong id="replacementDialogTitle">Seleccionar reemplazo</strong>
                <button
                    class="replacement-options-icon ${optionsOpen ? "is-open" : ""}"
                    type="button"
                    data-action="toggle-options"
                    aria-expanded="${optionsOpen ? "true" : "false"}"
                    aria-label="Más opciones"
                    title="Más opciones"
                >
                    ${REPLACEMENT_OPTIONS_ICON}
                </button>
            </div>
            <p>
                ${escapeHTML(profileName)} requiere cobertura para ${escapeHTML(turnoReplacementLabel(neededTurn))}
                por ${escapeHTML(absenceType)}.
            </p>
            <div class="replacement-options-panel ${optionsOpen ? "" : "is-hidden"}" data-options-panel>
                ${optionControls}
            </div>
            <input
                type="search"
                class="replacement-search is-hidden"
                data-replacement-search
                placeholder="Buscar reemplazo por nombre"
                autocomplete="off"
            >
            ${linkedMode ? `
                <div class="replacement-dialog-note">
                    Sugerencias de unidades enlazadas activas: se muestran trabajadores compatibles y disponibles segun su unidad. Al asignar, se registra como prestamo en ambas unidades.
                </div>
            ` : ""}
            ${bulkActions}
            ${pendingList}
            ${forceMode ? `
                <div class="replacement-dialog-note">
                    Modo forzado activo: se muestran trabajadores disponibles aunque no coincidan por profesion o estamento.
                </div>
            ` : ""}
            <div class="replacement-candidate-list">
                ${items}
            </div>
            <div class="turn-change-dialog__actions replacement-dialog__actions">
                <button class="leave-detail-undo" type="button" data-action="cancel-leave">
                    Anular permiso
                </button>
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

// Anula el permiso/ausencia del trabajador ausente para ese dia y restablece su
// turno original. Reutiliza el mismo camino que el modal de detalle de permiso
// (undoAuditLogEntry): quita el permiso, cancela los reemplazos asociados y
// notifica a los afectados. Si el permiso no tiene un registro undoable en el
// LOG (p. ej. fue evicto por el limite de logs), limpia manualmente los mapas
// del dia para dejar igualmente el turno original.
async function cancelReplacedProfileLeave(profileName, keyDay) {
    const admin = getJSON(`admin_${profileName}`, {});
    const legal = getJSON(`legal_${profileName}`, {});
    const comp = getJSON(`comp_${profileName}`, {});
    const absences = getJSON(`absences_${profileName}`, {});
    const type = leaveTypeForDay(keyDay, admin, legal, comp, absences);

    if (!type) return { ok: false, reason: "no-leave" };

    // Captura ANTES de cancelar a todos los que cubren a este ausente: sus filas
    // del timeline deben recalcularse (turno cubierto + HH.EE). El undo del LOG
    // no siempre devuelve estos trabajadores, asi que no dependemos de su salida.
    const coveringBefore = new Set(
        getReplacements()
            .filter(replacement =>
                replacement &&
                !replacement.canceled &&
                replacement.replaced === profileName
            )
            .map(replacement => String(replacement.worker || "").trim())
            .filter(Boolean)
    );

    const info = type === "half_admin"
        ? null
        : getLeaveApplicationInfo({
            profile: profileName,
            keyDay,
            type,
            sourceMap: leaveSourceMapForType(
                type,
                admin,
                legal,
                comp,
                absences
            )
        });

    if (info?.canUndo && info?.logId) {
        const result = await undoAuditLogEntry(info.logId, {
            source: "calendar"
        });

        if (result?.ok) {
            // Trabajadores cuyos reemplazos se cancelaron: hay que refrescar sus
            // filas del timeline para quitar el turno cubierto y sus HH.EE. Se
            // unen los capturados antes y los que reporta el undo del LOG.
            const coveringWorkers = new Set(coveringBefore);

            (result.canceledReplacements || [])
                .map(replacement => String(replacement?.worker || "").trim())
                .filter(Boolean)
                .forEach(worker => coveringWorkers.add(worker));

            return { ok: true, type, coveringWorkers };
        }
        // Si el undo del LOG falla, cae a la limpieza manual de abajo.
    }

    // Limpieza manual: quita el permiso del mapa correspondiente al dia.
    const sourceMap = leaveSourceMapForType(
        type,
        admin,
        legal,
        comp,
        absences
    );
    delete sourceMap[keyDay];

    if (
        type === "admin" ||
        type === "half_admin_morning" ||
        type === "half_admin_afternoon" ||
        type === "half_admin"
    ) {
        setJSON(`admin_${profileName}`, admin);
    } else if (type === "legal") {
        setJSON(`legal_${profileName}`, legal);
    } else if (type === "comp") {
        setJSON(`comp_${profileName}`, comp);
    } else {
        setJSON(`absences_${profileName}`, absences);
    }

    // Si el dia ya no tiene ninguna ausencia, libera el bloqueo.
    const blocked = getJSON(`blocked_${profileName}`, {});
    if (
        blocked[keyDay] &&
        !admin[keyDay] &&
        !legal[keyDay] &&
        !comp[keyDay] &&
        !absences[keyDay]
    ) {
        delete blocked[keyDay];
        setJSON(`blocked_${profileName}`, blocked);
    }

    // Sin LOG no se cancelan solos: anula los reemplazos que cubrian este dia
    // del ausente y recopila a esos trabajadores para refrescar sus filas.
    const iso = keyToISODate(keyDay);
    const coveringWorkers = new Set(coveringBefore);
    const now = new Date().toISOString();
    let changedReplacements = false;
    const nextReplacements = getReplacements().map(replacement => {
        if (
            replacement &&
            !replacement.canceled &&
            replacement.replaced === profileName &&
            replacement.date === iso
        ) {
            changedReplacements = true;

            const worker = String(replacement.worker || "").trim();
            if (worker) coveringWorkers.add(worker);

            return {
                ...replacement,
                canceled: true,
                canceledAt: now,
                cancelReason: "leave_absence_canceled"
            };
        }

        return replacement;
    });

    if (changedReplacements) saveReplacements(nextReplacements);

    return { ok: true, type, manual: true, coveringWorkers };
}

// Detalle de una solicitud de cobertura ya enviada: a quien se le pidio y
// cuanto le queda antes de caducar. Se abre desde el calendario, el timeline y
// la tarjeta de cobertura del inicio, que son las tres superficies donde
// aparece el celular de "en espera".
function openPendingRequestsDialog({ profile, keyDay }) {
    const requests = getPendingReplacementRequestsForShift(profile, keyDay);

    if (!requests.length) return;

    const canEdit = canEditTarget("calendarPanel");
    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";

    const rowsHTML = () => requests.map(request => {
        const left = formatRequestTimeLeft(request.expiresAt);

        return `
            <div class="request-wait-row" data-request-row="${escapeHTML(request.id)}">
                <span class="request-wait-worker">
                    <b>${escapeHTML(request.worker)}</b>
                    <small>${escapeHTML(
                        request.channel === "app"
                            ? "Enviada a su aplicación"
                            : "Enviada por WhatsApp"
                    )}</small>
                </span>
                <span class="request-wait-left ${left === "Expirada" ? "is-expired" : ""}"
                    data-request-left="${escapeHTML(request.id)}">${escapeHTML(left)}</span>
            </div>`;
    }).join("");

    backdrop.innerHTML = `
        <section class="turn-change-dialog leave-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="requestWaitTitle">
            <strong id="requestWaitTitle">Solicitud de cobertura enviada</strong>
            <div class="leave-detail-rows">
                <div><span>Turno de</span><b>${escapeHTML(profile)}</b></div>
                <div><span>Fecha</span><b>${escapeHTML(leaveDateLabelFromKey(keyDay))}</b></div>
                <div><span>Turno</span><b>${escapeHTML(turnoReplacementLabel(codeToTurno(requests[0].turno)))}</b></div>
            </div>
            <p class="leave-detail-note">
                En espera de respuesta. El turno sigue sin cubrir hasta que alguien
                acepte; si nadie responde antes de que caduque, vuelve a quedar
                marcado como pendiente de cobertura ("!").
            </p>
            <div class="request-wait-list" data-request-list>${rowsHTML()}</div>
            <div class="turn-change-dialog__actions leave-detail-actions--stacked">
                ${canEdit ? `
                <button class="primary-button" type="button" data-action="suggestions">Ver sugerencias de reemplazo</button>
                ` : ""}
                <button class="ghost-button" type="button" data-action="close">Cerrar</button>
            </div>
        </section>
    `;

    // La cuenta regresiva se refresca sola: con 24 h de caducidad el modal
    // puede quedar abierto un buen rato.
    const ticker = setInterval(() => {
        requests.forEach(request => {
            const cell = backdrop.querySelector(
                `[data-request-left="${CSS.escape(request.id)}"]`
            );

            if (!cell) return;

            const left = formatRequestTimeLeft(request.expiresAt);

            cell.textContent = left;
            cell.classList.toggle("is-expired", left === "Expirada");
        });
    }, 30000);

    const close = () => {
        clearInterval(ticker);
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };
    const onKeydown = event => {
        if (event.key === "Escape") close();
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-action='close']")
        ?.addEventListener("click", close);
    backdrop
        .querySelector("[data-action='suggestions']")
        ?.addEventListener("click", () => {
            close();
            void openReplacementDialog(profile, keyDay);
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
}

window.openPendingRequestsDialog = openPendingRequestsDialog;

async function openReplacementDialog(profileName, keyDay) {
    const existing = getReplacementForCoveredShift(
        profileName,
        keyDay
    );

    if (existing || window.selectionMode) {
        return;
    }

    const neededTurn = getReplacementNeededTurn(
        profileName,
        keyDay
    );

    if (!neededTurn) {
        return;
    }

    if (!ensureCanEditTarget("calendarPanel")) {
        return;
    }

    const absenceType =
        getAbsenceLabelForProfileDate(profileName, keyDay);
    let scope = "compatible";
    let requestMode = false;
    let selectedRequestWorkers = new Set();
    let optionsOpen = false;
    let preassignMode = false;
    const normalizeReplacementDialogState = () => {
        const replacementConfig = getReplacementRequestConfig();

        if (
            scope === "linked" &&
            replacementConfig.enableLinkedUnitSuggestions === false
        ) {
            scope = "compatible";
        }

        if (
            scope === "all-local" &&
            replacementConfig.enableCrossRoleSuggestions === false
        ) {
            scope = "compatible";
        }

        if (
            scope === "linked" ||
            replacementConfig.enableWorkerAcceptanceRequest === false
        ) {
            requestMode = false;
            selectedRequestWorkers = new Set();
        }
    };
    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";

    const saveLinkedUnitReplacement = async button => {
        const workerWorkspaceId =
            button.dataset.workerWorkspaceId || "";
        const workerWorkspaceName =
            button.dataset.workerWorkspaceName || "";
        const workerProfileId =
            button.dataset.workerProfileId || "";
        const linkId = button.dataset.workerLinkId || "";
        const worker = button.dataset.worker || "";
        const activeWorkspace = getActiveWorkspace();
        const replacedProfile = getProfiles().find(profile =>
            profile.name === profileName
        );

        if (
            !workerWorkspaceId ||
            !workerProfileId ||
            !worker ||
            !activeWorkspace?.id
        ) {
            throw new Error(
                "No se pudo identificar la unidad enlazada del trabajador."
            );
        }

        const result = await createInterUnitLoan({
            linkId,
            sourceWorkspaceId: workerWorkspaceId,
            hostWorkspaceId: activeWorkspace?.id || "",
            workerProfileId,
            replacedProfileId: replacedProfile?.id || "",
            replacedProfileName: profileName,
            targetEstamento: replacedProfile?.estamento || "",
            targetProfession: replacedProfile?.profession || "",
            date: keyToISODate(keyDay),
            turnCode: turnoToCode(neededTurn),
            absenceType,
        });

        saveReplacement({
            id: `interunit_${result.loanId}`,
            interUnitLoanId: result.loanId,
            worker,
            replaced: profileName,
            keyDay,
            turno: neededTurn,
            absenceType,
            source: "inter_unit_loan",
            isLoan: true,
            workerWorkspaceId,
            workerWorkspaceName,
            hostWorkspaceId: activeWorkspace?.id || "",
            hostWorkspaceName: activeWorkspace?.name || "",
        });
    };

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    const bindActions = () => {
        backdrop
            .querySelector("[data-action='cancel']")
            .onclick = close;

        const optionsTrigger =
            backdrop.querySelector("[data-action='toggle-options']");
        const optionsPanel =
            backdrop.querySelector("[data-options-panel]");
        if (optionsTrigger && optionsPanel) {
            // Toggle directo del DOM (sin re-render): el estado se conserva en
            // optionsOpen para no cerrarse al recomputar candidatos (force/linked).
            optionsTrigger.onclick = () => {
                optionsOpen = !optionsOpen;
                optionsPanel.classList.toggle("is-hidden", !optionsOpen);
                optionsTrigger.classList.toggle("is-open", optionsOpen);
                optionsTrigger.setAttribute(
                    "aria-expanded",
                    optionsOpen ? "true" : "false"
                );
            };
        }

        // Filtro de busqueda: oculta los candidatos cuyo nombre no coincide.
        const searchInput =
            backdrop.querySelector("[data-replacement-search]");
        if (searchInput) {
            const normalize = value => String(value || "")
                .normalize("NFD")
                .replace(/[̀-ͯ]/g, "")
                .toLowerCase()
                .trim();

            searchInput.oninput = () => {
                const term = normalize(searchInput.value);

                backdrop
                    .querySelectorAll(".replacement-candidate")
                    .forEach(candidate => {
                        const name = normalize(
                            candidate.querySelector("strong")?.textContent
                        );

                        candidate.classList.toggle(
                            "is-search-hidden",
                            Boolean(term) && !name.includes(term)
                        );
                    });
            };
        }

        const noCoverageButton =
            backdrop.querySelector("[data-action='no-coverage']");
        if (noCoverageButton) {
            noCoverageButton.onclick = async () => {
                // Segundo modal: confirma y ademas deja registrado POR QUE no
                // necesita cobertura, con motivos predefinidos reutilizables.
                const result = await openNoCoverageReasonDialog(
                    profileName,
                    keyDay
                );

                if (!result) return;

                const reason = result.reason || "";

                await withBusyState(async () => {
                    if (typeof window.pushUndoState === "function") {
                        window.pushUndoState("Marcar sin cobertura");
                    }

                    setNoCoverageDay(profileName, keyDay, true, reason);
                    addAuditLog(
                        AUDIT_CATEGORY.CALENDAR,
                        "Marco sin cobertura",
                        `${profileName}: marco el ${keyDay} como no requiere cobertura.${reason ? ` Motivo: ${reason}.` : ""}`,
                        { profile: profileName, keyDay }
                    );
                    close();
                    await updateDayCell(profileName, keyDay);
                    updateTimelineCells(profileName, [keyDay]);
                    await updateVisibleCalendarDays({ updateSummary: true });
                }, { label: "Guardando..." });
            };
        }

        const compatibleScopeButton =
            backdrop.querySelector("[data-action='scope-compatible']");
        if (compatibleScopeButton) {
            compatibleScopeButton.onclick = async () => {
                scope = "compatible";
                await renderContent();
            };
        }

        const cancelLeaveButton =
            backdrop.querySelector("[data-action='cancel-leave']");
        if (cancelLeaveButton) {
            cancelLeaveButton.onclick = async () => {
                const label = absenceType || "el permiso";
                const confirmed = await showConfirm(
                    `Se anulará ${label} de ${profileName} y se restablecerá su turno original. También se cancelarán los reemplazos asociados y se notificará a los trabajadores.`,
                    {
                        title: "Anular permiso",
                        tone: "danger",
                        confirmText: "Anular permiso",
                        destructive: true
                    }
                );

                if (!confirmed) return;

                await withBusyState(async () => {
                    if (typeof window.pushUndoState === "function") {
                        window.pushUndoState("Anular permiso");
                    }

                    const result = await cancelReplacedProfileLeave(
                        profileName,
                        keyDay
                    );

                    if (!result?.ok) {
                        alert(
                            result?.reason === "no-leave"
                                ? "Este dia ya no tiene un permiso o ausencia que anular."
                                : "No se pudo anular el permiso."
                        );
                        return;
                    }

                    close();

                    // Refresca la fila completa (turnos + HH.EE) del ausente y de
                    // cada trabajador que dejo de cubrir, para que el timeline se
                    // actualice al instante sin cambiar de mes.
                    const affectedProfiles = new Set([
                        profileName,
                        ...(result.coveringWorkers || [])
                    ]);

                    await updateDayCell(profileName, keyDay);
                    affectedProfiles.forEach(worker => {
                        updateTimelineCells(worker);
                    });
                    await updateVisibleCalendarDays({ updateSummary: true });
                }, { label: "Anulando permiso..." });
            };
        }

        const toggleForceButton =
            backdrop.querySelector("[data-action='toggle-force']");
        if (toggleForceButton) {
            toggleForceButton.onclick = async () => {
                scope = scope === "all-local"
                    ? "compatible"
                    : "all-local";
                await renderContent();
            };
        }

        const linkedUnitsButton =
            backdrop.querySelector("[data-action='linked-units']");
        if (linkedUnitsButton) {
            linkedUnitsButton.onclick = async () => {
                scope = scope === "linked"
                    ? "compatible"
                    : "linked";
                requestMode = false;
                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        const assignmentDirectButton =
            backdrop.querySelector("[data-action='assignment-direct']");
        if (assignmentDirectButton) {
            assignmentDirectButton.onclick = async () => {
                requestMode = false;
                preassignMode = false;
                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        const requestToggle =
            backdrop.querySelector("[data-action='request-mode']");
        if (requestToggle) {
            requestToggle.onclick = async () => {
                requestMode = !requestMode;
                // Aprobacion y preasignar son excluyentes.
                if (requestMode) preassignMode = false;
                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        const preassignToggle =
            backdrop.querySelector("[data-action='preassign-mode']");
        if (preassignToggle) {
            preassignToggle.onclick = async () => {
                preassignMode = !preassignMode;
                // Al activar el estado intermedio, aprobacion y "no requiere
                // cobertura" no aplican en conjunto: se apagan.
                if (preassignMode) {
                    requestMode = false;
                    selectedRequestWorkers = new Set();
                }
                await renderContent();
            };
        }

        const updateBulkControls = () => {
            const inputs = [
                ...backdrop.querySelectorAll("[data-request-worker]")
            ];
            const availableInputs = inputs.filter(input =>
                !input.disabled
            );
            const selectedCount = availableInputs.filter(input =>
                input.checked
            ).length;
            const selectAll =
                backdrop.querySelector("[data-action='select-all-requests']");
            const sendButton =
                backdrop.querySelector("[data-action='send-selected-requests']");

            if (selectAll) {
                selectAll.checked =
                    Boolean(availableInputs.length) &&
                    selectedCount === availableInputs.length;
            }

            if (sendButton) {
                sendButton.disabled = selectedCount === 0;
                sendButton.textContent =
                    `Enviar a seleccionados (${selectedCount})`;
            }
        };

        backdrop
            .querySelectorAll("[data-request-worker]")
            .forEach(input => {
                input.onchange = () => {
                    if (input.checked) {
                        selectedRequestWorkers.add(
                            input.dataset.requestWorker
                        );
                    } else {
                        selectedRequestWorkers.delete(
                            input.dataset.requestWorker
                        );
                    }

                    updateBulkControls();
                };
            });

        const selectAllRequests =
            backdrop.querySelector("[data-action='select-all-requests']");
        if (selectAllRequests) {
            selectAllRequests.onchange = () => {
                backdrop
                    .querySelectorAll("[data-request-worker]")
                    .forEach(input => {
                        if (input.disabled) return;

                        input.checked = selectAllRequests.checked;

                        if (input.checked) {
                            selectedRequestWorkers.add(
                                input.dataset.requestWorker
                            );
                        } else {
                            selectedRequestWorkers.delete(
                                input.dataset.requestWorker
                            );
                        }
                    });

                updateBulkControls();
            };
        }

        const sendSelectedRequests =
            backdrop.querySelector("[data-action='send-selected-requests']");
        if (sendSelectedRequests) {
            sendSelectedRequests.onclick = async () => {
                const selectedInputs = [
                    ...backdrop.querySelectorAll("[data-request-worker]")
                ].filter(input =>
                    input.checked &&
                    selectedRequestWorkers.has(
                        input.dataset.requestWorker
                    )
                );
                const workers = selectedInputs.map(input =>
                    input.dataset.requestWorker
                );
                const diurnoLongInputs = selectedInputs.filter(input =>
                    input.dataset.diurnoLongCoverage === "true"
                );
                const workerCoverage = Object.fromEntries(
                    selectedInputs.map(input => [
                        input.dataset.requestWorker,
                        replacementCoverageFromDataset(input.dataset)
                    ])
                );

                if (!workers.length) {
                    alert("Selecciona al menos un trabajador para enviar la solicitud.");
                    return;
                }

                if (typeof window.pushUndoState === "function") {
                    window.pushUndoState("Crear solicitud masiva de reemplazo");
                }

                const requests = createReplacementRequests(
                    {
                        replaced: profileName,
                        keyDay,
                        turno: neededTurn,
                        absenceType,
                        scope,
                        source: scope === "all-local"
                            ? "forced_replacement_request"
                            : "replacement_request",
                        diurnoLongCoverageWorkers:
                            diurnoLongInputs.map(input =>
                                input.dataset.requestWorker
                            ),
                        diurnoLongCoverageHours:
                            replacementCoverageFromDataset(
                                diurnoLongInputs[0]?.dataset
                            ).overtimeHours,
                        workerCoverage
                    },
                    workers
                );
                const whatsappRequests = requests.filter(request =>
                    request.channel === "whatsapp"
                );
                const missingPhones = whatsappRequests.filter(request =>
                    !buildReplacementRequestWhatsAppUrl(request)
                );

                whatsappRequests
                    .map(buildReplacementRequestWhatsAppUrl)
                    .filter(Boolean)
                    .forEach(url => {
                        window.open(url, "_blank", "noopener");
                    });

                if (missingPhones.length) {
                    alert(
                        `${missingPhones.length} solicitud(es) quedaron pendientes, pero sin celular registrado para preparar WhatsApp.`
                    );
                }

                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        backdrop
            .querySelectorAll("[data-cancel-request]")
            .forEach(button => {
                button.onclick = async () => {
                    cancelReplacementRequest(
                        button.dataset.cancelRequest,
                        "admin"
                    );
                    await renderContent();
                };
            });

        backdrop
            .querySelectorAll("[data-worker]")
            .forEach(button => {
                button.onclick = async () => {
                    if (button.disabled) return;

                    await withBusyState(async () => {
                        if (typeof window.pushUndoState === "function") {
                            window.pushUndoState(
                                preassignMode
                                    ? "Preasignar turno"
                                    : requestMode
                                        ? "Crear solicitud de reemplazo"
                                        : "Asignar reemplazo"
                            );
                        }

                        // Modo preasignar: reserva tentativa (no proyecta turno ni
                        // suma horas). Solo candidatos de esta unidad.
                        if (preassignMode) {
                            const coveringWorker = button.dataset.worker;

                            if (button.dataset.workerWorkspaceId) {
                                alert("La preasignación no está disponible para unidades enlazadas.");
                                return;
                            }

                            addPreassignment({
                                worker: coveringWorker,
                                replaced: profileName,
                                keyDay,
                                turno: neededTurn,
                                absenceType,
                                ...replacementCoverageFromDataset(
                                    button.dataset
                                )
                            });
                            addAuditLog(
                                AUDIT_CATEGORY.CALENDAR,
                                "Preasigno turno",
                                `${profileName}: ${coveringWorker} preasignado para el ${keyDay}.`,
                                { profile: profileName, keyDay }
                            );

                            close();
                            await updateDayCell(profileName, keyDay);
                            if (
                                coveringWorker &&
                                coveringWorker !== profileName
                            ) {
                                await updateDayCell(coveringWorker, keyDay);
                            }
                            updateTimelineCells(profileName, [keyDay]);
                            if (coveringWorker) {
                                updateTimelineCells(coveringWorker, [keyDay]);
                            }
                            return;
                        }

                        if (
                            requestMode &&
                            getReplacementRequestConfig()
                                .enableWorkerAcceptanceRequest !== false
                        ) {
                            const request = createReplacementRequest({
                                worker: button.dataset.worker,
                                replaced: profileName,
                                keyDay,
                                turno: neededTurn,
                                absenceType,
                                scope,
                                source: scope === "all-local"
                                    ? "forced_replacement_request"
                                    : "replacement_request",
                                ...replacementCoverageFromDataset(
                                    button.dataset
                                )
                            });
                            const whatsappUrl =
                                buildReplacementRequestWhatsAppUrl(request);

                            if (request.channel === "whatsapp") {
                                if (whatsappUrl) {
                                    window.open(
                                        whatsappUrl,
                                        "_blank",
                                        "noopener"
                                    );
                                } else {
                                    alert(
                                        "La solicitud quedo pendiente, pero este trabajador no tiene celular registrado para preparar el WhatsApp."
                                    );
                                }
                            }

                            await renderContent();
                            return;
                        }

                        const coveringWorker = button.dataset.worker;

                        // Reemplazante (tipo contrato reemplazo) sin contrato
                        // vigente ese dia: ofrecer crear un contrato usando el
                        // permiso del ausente como respaldo. Si dice que no, se
                        // asigna solo el turno y queda con la cruz de sin contrato.
                        if (
                            !button.dataset.workerWorkspaceId &&
                            coveringWorker &&
                            isReplacementProfile(coveringWorker) &&
                            !hasContractForDate(coveringWorker, keyDay)
                        ) {
                            const addContract = await showConfirm(
                                `${coveringWorker} no tiene un contrato de reemplazo vigente en esta fecha.\n\n¿Agregar un contrato usando el permiso de ${profileName} como respaldo? Si eliges "No", se asigna solo este turno y quedara marcado sin contrato.`,
                                {
                                    title: "Sin contrato vigente",
                                    tone: "warning",
                                    confirmText: "Agregar contrato",
                                    cancelText: "Solo este turno"
                                }
                            );

                            if (addContract) {
                                close();
                                window.startReplacementContractEdit?.(
                                    coveringWorker,
                                    keyDay,
                                    { replaced: profileName }
                                );
                                return;
                            }
                        }

                        if (button.dataset.workerWorkspaceId) {
                            await saveLinkedUnitReplacement(button);
                        } else {
                            saveReplacement({
                                worker: button.dataset.worker,
                                replaced: profileName,
                                keyDay,
                                turno: neededTurn,
                                absenceType,
                                source: scope === "all-local"
                                    ? "forced_replacement"
                                    : "replacement",
                                ...replacementCoverageFromDataset(
                                    button.dataset
                                )
                            });
                        }

                        close();
                        await updateDayCell(profileName, keyDay);

                        // Actualiza solo las casillas afectadas del timeline (el
                        // trabajador ausente y quien lo cubre) sin reconstruirlo.
                        if (
                            coveringWorker &&
                            coveringWorker !== profileName
                        ) {
                            await updateDayCell(coveringWorker, keyDay);
                        }

                        updateTimelineCells(profileName, [keyDay]);

                        if (coveringWorker) {
                            updateTimelineCells(coveringWorker, [keyDay]);
                        }
                    }, {
                        label: requestMode
                            ? "Creando solicitud..."
                            : "Guardando reemplazo..."
                    });
                };
            });
    };

    const renderContent = async () => withBusyState(async () => {
        normalizeReplacementDialogState();
        expireReplacementRequests();

        const candidates =
            await getReplacementCandidates(
                profileName,
                keyDay,
                { scope }
            );
        if (!candidates) return;
        const pendingRequests =
            getPendingReplacementRequestsForShift(
                profileName,
                keyDay,
                neededTurn
            );
        const pendingWorkers = new Set(
            pendingRequests.map(request => request.worker)
        );
        const selectableWorkers = new Set(
            candidates
                .map(candidate => candidate.profile.name)
                .filter(worker => !pendingWorkers.has(worker))
        );

        selectedRequestWorkers = new Set(
            [...selectedRequestWorkers].filter(worker =>
                selectableWorkers.has(worker)
            )
        );

        backdrop.innerHTML = replacementDialogHTML({
            profileName,
            keyDay,
            neededTurn,
            absenceType,
            candidates,
            scope,
            requestMode,
            pendingRequests,
            selectedRequestWorkers,
            optionsOpen,
            preassignMode,
            linkedStatus: scope === "linked"
                ? linkedReplacementStatus
                : ""
        });

        bindActions();

        // El buscador solo aparece cuando el listado desborda (hay scroll). Se mide
        // tras insertar el DOM (el backdrop ya esta en el documento).
        const candidateList =
            backdrop.querySelector(".replacement-candidate-list");
        const searchBox =
            backdrop.querySelector("[data-replacement-search]");
        if (candidateList && searchBox) {
            const scrollable =
                candidateList.scrollHeight > candidateList.clientHeight + 4;
            searchBox.classList.toggle("is-hidden", !scrollable);
        }

        (
            backdrop.querySelector(".replacement-candidate") ||
            backdrop.querySelector("[data-action='cancel']")
        )?.focus();
    }, {
        label: "Calculando sugerencias..."
    });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    await renderContent();
}

window.openReplacementDialog = openReplacementDialog;

function getExtraReasonMatches(
    profileName,
    keyDay,
    pendingTurn
) {
    return sameRoleProfiles(profileName)
        .map(profile => {
            const coveredTurn = getReplacementNeededTurn(
                profile.name,
                keyDay
            );

            return {
                profile,
                coveredTurn,
                absenceType:
                    getAbsenceLabelForProfileDate(
                        profile.name,
                        keyDay
                    ),
                exactMatch:
                    Number(coveredTurn) === Number(pendingTurn)
            };
        })
        .filter(match =>
            workerHasAbsence(match.profile.name, keyDay) &&
            !getReplacementForCoveredShift(
                match.profile.name,
                keyDay
            ) &&
            turnoExtraCubreTurno(
                pendingTurn,
                match.coveredTurn
            )
        )
        .sort((a, b) => {
            if (a.exactMatch !== b.exactMatch) {
                return a.exactMatch ? -1 : 1;
            }

            return a.profile.name.localeCompare(b.profile.name);
        });
}

function getManualBackupSections(pendingTurn, matchesByTurn) {
    return getTurnoComponentes(pendingTurn)
        .map(component => {
            const turn = turnoDesdeComponentes([component]);

            return {
                id: component,
                turn,
                label: turnoReplacementLabel(turn),
                matches: matchesByTurn.get(turn) || []
            };
        })
        .filter(section => section.turn);
}

function formatClockHoursForDialog(hours) {
    const d = Math.round((Number(hours?.d) || 0) * 2) / 2;
    const n = Math.round((Number(hours?.n) || 0) * 2) / 2;
    const parts = [];

    if (d) parts.push(`${d}h diurnas`);
    if (n) parts.push(`${n}h nocturnas`);

    return parts.length ? parts.join(" / ") : "0h";
}

function splitManualExtraReasonPresetText(value) {
    return String(value || "")
        .split(/\r?\n|;/)
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeManualExtraReasonPresets(values) {
    const seen = new Set();
    const source = Array.isArray(values)
        ? values
        : splitManualExtraReasonPresetText(values);

    return source
        .map(item => String(item || "").trim())
        .filter(Boolean)
        .filter(item => {
            const key = item.toLocaleLowerCase("es");

            if (seen.has(key)) return false;

            seen.add(key);
            return true;
        })
        .slice(0, 40);
}

function getReasonPresets(
    key = MANUAL_EXTRA_REASON_PRESETS_KEY,
    defaults = DEFAULT_MANUAL_EXTRA_REASON_PRESETS
) {
    return normalizeManualExtraReasonPresets(getJSON(key, defaults));
}

function saveReasonPresets(values, key = MANUAL_EXTRA_REASON_PRESETS_KEY) {
    setJSON(key, normalizeManualExtraReasonPresets(values));
}

function getManualExtraReasonPresets() {
    return getReasonPresets();
}

function saveManualExtraReasonPresets(values) {
    saveReasonPresets(values);
}

function getNoCoverageReasonPresets() {
    return getReasonPresets(
        NO_COVERAGE_REASON_PRESETS_KEY,
        DEFAULT_NO_COVERAGE_REASON_PRESETS
    );
}

function manualExtraReasonPresetButtonsHTML(sectionId) {
    const presets = getManualExtraReasonPresets();

    if (!presets.length) {
        return `
            <small data-manual-reason-presets-empty>
                Sin motivos predefinidos.
            </small>
        `;
    }

    return presets.map(preset => `
        <button
            class="ghost-button"
            type="button"
            data-manual-reason-preset="${escapeHTML(preset)}"
            data-section-id="${escapeHTML(sectionId)}"
        >
            ${escapeHTML(preset)}
        </button>
    `).join("");
}

function appendManualExtraReasonPreset(textarea, preset) {
    if (!textarea) return;

    const cleanPreset = String(preset || "").trim();

    if (!cleanPreset) return;

    const current = textarea.value.trim();
    const separator = current
        ? (/[,\n;]\s*$/.test(textarea.value) ? " " : ", ")
        : "";

    textarea.value = `${current}${separator}${cleanPreset}`;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();

    if (typeof textarea.setSelectionRange === "function") {
        const end = textarea.value.length;

        textarea.setSelectionRange(end, end);
    }
}

function openManualExtraReasonPresetsDialog(
    presetsKey = MANUAL_EXTRA_REASON_PRESETS_KEY,
    presets = getManualExtraReasonPresets()
) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        const previousFocus =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        let settled = false;

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.dataset.manualExtraReasonPresetsDialog = "true";
        backdrop.innerHTML = `
            <section class="turn-change-dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="manualExtraReasonPresetsTitle">
                <strong id="manualExtraReasonPresetsTitle">Motivos predefinidos</strong>
                <p>
                    Escribe un motivo por linea. Quedaran disponibles para todos
                    los administradores de este entorno.
                </p>
                <textarea rows="8" data-manual-reason-preset-list placeholder="Estacion de Trabajo&#10;Apoyo Oncologico">${escapeHTML(presets.join("\n"))}</textarea>
                <div class="turn-change-dialog__actions">
                    <button class="secondary-button" type="button" data-action="cancel-presets">
                        Cancelar
                    </button>
                    <button class="primary-button" type="button" data-action="save-presets">
                        Guardar motivos
                    </button>
                </div>
            </section>
        `;

        const finish = result => {
            if (settled) return;

            settled = true;
            document.removeEventListener("keydown", onKeydown, true);
            backdrop.remove();

            if (previousFocus?.isConnected) {
                previousFocus.focus();
            }

            resolve(result);
        };

        function onKeydown(event) {
            if (event.key !== "Escape") return;

            event.preventDefault();
            event.stopPropagation();
            finish(false);
        }

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                finish(false);
            }
        });
        backdrop
            .querySelector("[data-action='cancel-presets']")
            .addEventListener("click", () => finish(false));
        backdrop
            .querySelector("[data-action='save-presets']")
            .addEventListener("click", () => {
                saveReasonPresets(
                    backdrop.querySelector("[data-manual-reason-preset-list]")
                        ?.value || "",
                    presetsKey
                );
                finish(true);
            });

        document.addEventListener("keydown", onKeydown, true);
        document.body.appendChild(backdrop);
        backdrop.querySelector("[data-manual-reason-preset-list]")?.focus();
    });
}

/**
 * Segundo paso de "No requiere cobertura": pide un comentario OPCIONAL que
 * explique por que ese turno no necesita reemplazo. Antes la marca quedaba muda
 * y meses despues nadie recordaba el criterio.
 *
 * Resuelve con { reason } al confirmar, o null si se cancela. Los motivos
 * predefinidos se editan con el lapiz, igual que los de turnos extra, pero en su
 * propia lista.
 */
function openNoCoverageReasonDialog(profileName, keyDay) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        const previousFocus =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        let settled = false;

        const presetsHTML = () => {
            const presets = getNoCoverageReasonPresets();

            if (!presets.length) {
                return `<small data-no-coverage-presets-empty>Sin motivos predefinidos.</small>`;
            }

            return presets.map(preset => `
                <button
                    class="ghost-button"
                    type="button"
                    data-no-coverage-preset="${escapeHTML(preset)}"
                >
                    ${escapeHTML(preset)}
                </button>
            `).join("");
        };

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.dataset.noCoverageReasonDialog = "true";
        backdrop.innerHTML = `
            <section class="turn-change-dialog replacement-dialog no-coverage-dialog" role="dialog" aria-modal="true" aria-labelledby="noCoverageReasonTitle">
                <strong id="noCoverageReasonTitle">No requiere cobertura</strong>
                <p>
                    Se ocultará la alerta de este día para ${escapeHTML(profileName)}
                    y no se volverá a pedir reemplazo. Puedes dejar un comentario
                    que explique por qué (opcional).
                </p>
                <div class="extra-reason-field">
                    <div class="overtime-backup-subsection__head">
                        <span>Comentario (opcional)</span>
                        <button
                            class="icon-button icon-button--small"
                            type="button"
                            data-action="edit-no-coverage-presets"
                            title="Editar motivos predefinidos"
                            aria-label="Editar motivos predefinidos"
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M12 20h9"></path>
                                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                            </svg>
                        </button>
                    </div>
                    <textarea
                        rows="3"
                        data-no-coverage-reason
                        placeholder="Ej: Dotación completa"
                    ></textarea>
                    <div class="replacement-dialog-toolbar" data-no-coverage-preset-list>
                        ${presetsHTML()}
                    </div>
                </div>
                <div class="turn-change-dialog__actions">
                    <button class="secondary-button" type="button" data-action="cancel">
                        Cancelar
                    </button>
                    <button class="primary-button" type="button" data-action="save">
                        No requiere cobertura
                    </button>
                </div>
            </section>
        `;

        const textarea = backdrop.querySelector("[data-no-coverage-reason]");
        const finish = result => {
            if (settled) return;

            settled = true;
            document.removeEventListener("keydown", onKeydown, true);
            backdrop.remove();

            if (previousFocus?.isConnected) {
                previousFocus.focus();
            }

            resolve(result);
        };

        function onKeydown(event) {
            if (event.key !== "Escape") return;

            event.preventDefault();
            event.stopPropagation();
            finish(null);
        }

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) finish(null);
        });
        backdrop
            .querySelector("[data-action='cancel']")
            ?.addEventListener("click", () => finish(null));
        backdrop
            .querySelector("[data-action='save']")
            ?.addEventListener("click", () => {
                finish({ reason: String(textarea?.value || "").trim() });
            });
        backdrop
            .querySelector("[data-action='edit-no-coverage-presets']")
            ?.addEventListener("click", async () => {
                const saved = await openManualExtraReasonPresetsDialog(
                    NO_COVERAGE_REASON_PRESETS_KEY,
                    getNoCoverageReasonPresets()
                );

                if (!saved) return;

                const host = backdrop.querySelector("[data-no-coverage-preset-list]");

                if (host) host.innerHTML = presetsHTML();
            });
        // Delegado: los botones se vuelven a pintar al editar la lista.
        backdrop.addEventListener("click", event => {
            const preset = event.target.closest("[data-no-coverage-preset]");

            if (!preset) return;

            appendManualExtraReasonPreset(
                textarea,
                preset.dataset.noCoveragePreset
            );
        });

        document.addEventListener("keydown", onKeydown, true);
        document.body.appendChild(backdrop);
        textarea?.focus();
    });
}

function extraReasonDialogHTML({
    profileName,
    pendingTurn,
    manualSections,
    clockHours,
    hasClockSection
}) {
    const hasManualSection = Boolean(pendingTurn);
    const hasMultipleManualSections =
        (manualSections || []).length > 1;
    const savesMultipleBackups =
        hasMultipleManualSections ||
        (hasClockSection && hasManualSection);
    const manualItems = (manualSections || [])
        .map(section => {
            const items = section.matches.length
                ? section.matches.map((match, index) => `
                    <button
                        class="replacement-candidate"
                        type="button"
                        data-section-id="${escapeHTML(section.id)}"
                        data-match-index="${index}"
                    >
                        <span>
                            <strong>${escapeHTML(match.profile.name)}</strong>
                            <small>${escapeHTML(match.absenceType)} | ${escapeHTML(turnoReplacementLabel(match.coveredTurn))}</small>
                        </span>
                        <span>${match.exactMatch ? "Coincide" : "Parcial"}</span>
                    </button>
                `).join("")
                : `
                    <div class="empty-state empty-state--compact">
                        No hay vacaciones o licencias compatibles con este tramo.
                    </div>
                `;

            return `
                <div class="overtime-backup-subsection" data-manual-section="${escapeHTML(section.id)}">
                    <div class="overtime-backup-subsection__head">
                        <span>${escapeHTML(section.label)}</span>
                    </div>
                    <div class="replacement-candidate-list">
                        ${items}
                    </div>
                    <div class="extra-reason-field">
                        <div class="overtime-backup-subsection__head">
                            <span>Motivo manual para ${escapeHTML(section.label)}</span>
                            <button
                                class="icon-button icon-button--small"
                                type="button"
                                data-manual-reason-presets-edit
                                title="Editar motivos predefinidos"
                                aria-label="Editar motivos predefinidos"
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <path d="M12 20h9"></path>
                                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                                </svg>
                            </button>
                        </div>
                        <textarea rows="3" data-manual-reason="${escapeHTML(section.id)}" placeholder="Ej: Campana de Invierno, Estacion de Trabajo"></textarea>
                        <div class="replacement-dialog-toolbar" data-manual-reason-presets="${escapeHTML(section.id)}">
                            ${manualExtraReasonPresetButtonsHTML(section.id)}
                        </div>
                    </div>
                </div>
            `;
        })
        .join("");
    const clockSection = hasClockSection
        ? `
            <section class="overtime-backup-section" data-section="clock">
                <div class="overtime-backup-section__head">
                    <span>Horas por marcaje modificado</span>
                    <small>${formatClockHoursForDialog(clockHours)}</small>
                </div>
                <p>
                    Respalda las horas extras generadas por modificar la entrada
                    o salida del turno.
                </p>
                <label class="extra-reason-field">
                    <span>Motivo del marcaje</span>
                    <textarea rows="3" data-clock-reason placeholder="Ej: Apoyo previo al turno, continuidad de atencion, emergencia del servicio"></textarea>
                </label>
            </section>
        `
        : "";
    const manualSection = hasManualSection
        ? `
            <section class="overtime-backup-section" data-section="manual">
                <div class="overtime-backup-section__head">
                    <span>Turno extra agregado</span>
                    <small>${turnoReplacementLabel(pendingTurn)}</small>
                </div>
                <p>
                    Puedes asociar cada tramo a una ausencia compatible o escribir
                    un motivo manual por separado.
                </p>
                ${manualItems}
            </section>
        `
        : "";

    return `
        <div class="turn-change-dialog replacement-dialog extra-reason-dialog overtime-backup-dialog" role="dialog" aria-modal="true" aria-labelledby="extraReasonDialogTitle">
            <strong id="extraReasonDialogTitle">Respaldar horas extras</strong>
            <p>
                ${profileName} tiene horas extras pendientes de respaldo.
                Completa ${savesMultipleBackups ? "las secciones" : "el motivo"} para validar el pago.
            </p>
            ${clockSection}
            ${manualSection}
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
                <button class="primary-button" type="button" data-action="save-reason">
                    ${savesMultipleBackups ? "Guardar respaldos" : "Guardar motivo"}
                </button>
            </div>
        </div>
    `;
}

async function openExtraReasonDialog(
    profileName,
    keyDay,
    pendingTurn,
    options = {}
) {
    if ((!pendingTurn && !options.forceClock) || window.selectionMode) {
        return;
    }

    const profileData = getProfileData(profileName);
    const actualState = options.state ||
        aplicarCambiosTurno(
            profileName,
            keyDay,
            getTurnoProgramado(profileName, keyDay)
        );
    const [year, month, day] = String(keyDay)
        .split("-")
        .map(Number);
    const date = new Date(year, month, day);
    const holidays = await fetchHolidays(year);
    const hasClockSection =
        hasClockNetExtra(
            profileName,
            keyDay,
            date,
            actualState,
            holidays
        ) &&
        !getClockExtraBackupForWorker(profileName, keyDay);
    const clockHours = hasClockSection
        ? getClockNetExtraHours(
            profileName,
            keyDay,
            date,
            actualState,
            holidays
        )
        : null;

    if (!pendingTurn && !hasClockSection) {
        return;
    }

    if (!ensureCanEditTarget("calendarPanel")) {
        return;
    }

    const matchesByTurn = new Map();
    const manualSections = pendingTurn
        ? getManualBackupSections(pendingTurn, matchesByTurn)
        : [];

    if (pendingTurn) {
        manualSections.forEach(section => {
            const matches = getExtraReasonMatches(
                profileName,
                keyDay,
                section.turn
            );

            matchesByTurn.set(section.turn, matches);
            section.matches = matches;
        });
    }

    const backdrop = document.createElement("div");
    const selectedMatches = new Map();

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = extraReasonDialogHTML({
        profileName,
        pendingTurn,
        manualSections,
        clockHours,
        hasClockSection
    });

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    const saveBackups = async () => {
        const clockReason = backdrop
            .querySelector("[data-clock-reason]")
            ?.value
            .trim() || "";
        const manualBackups = manualSections.map(section => {
            const selectedIndex = selectedMatches.get(section.id);
            const selectedMatch = selectedIndex !== undefined
                ? section.matches[selectedIndex]
                : null;
            const reason = backdrop
                .querySelector(`[data-manual-reason="${section.id}"]`)
                ?.value
                .trim() || "";

            return {
                section,
                selectedMatch,
                reason
            };
        });
        const missingManualBackup = manualBackups.find(backup =>
            !backup.selectedMatch && !backup.reason
        );

        if (hasClockSection && !clockReason) {
            alert("Indica el motivo de las horas extras generadas por el marcaje.");
            backdrop.querySelector("[data-clock-reason]")?.focus();
            return;
        }

        if (pendingTurn && missingManualBackup) {
            alert(`Selecciona una ausencia compatible o escribe el motivo del turno ${missingManualBackup.section.label}.`);
            backdrop
                .querySelector(`[data-manual-reason="${missingManualBackup.section.id}"]`)
                ?.focus();
            return;
        }

        if (typeof window.pushUndoState === "function") {
            window.pushUndoState("Respaldar horas extras");
        }

        if (hasClockSection) {
            saveReplacement({
                worker: profileName,
                keyDay,
                turno: actualState,
                reason: clockReason,
                absenceType: "Marcaje reloj control",
                source: "clock_extra",
                addsShift: false,
                clockLabel: "Marcaje reloj control",
                clockHours
            });
        }

        manualBackups.forEach(backup => {
            saveReplacement({
                worker: profileName,
                keyDay,
                turno: backup.selectedMatch
                    ? backup.selectedMatch.coveredTurn
                    : backup.section.turn,
                replaced: backup.selectedMatch?.profile.name || "",
                reason: backup.selectedMatch ? "" : backup.reason,
                absenceType: backup.selectedMatch
                    ? backup.selectedMatch.absenceType
                    : "Motivo manual",
                source: "manual_extra",
                addsShift: false
            });
        });

        close();
        await updateDayCell(profileName, keyDay);

        // Refresca la fila del timeline (casillas del dia + columna de HH.EE) del
        // trabajador que tomo el turno extra, sin reconstruir todo el timeline.
        updateTimelineCells(profileName, [keyDay]);
    };

    const bindManualReasonPresetButtons = () => {
        backdrop
            .querySelectorAll("[data-manual-reason-preset]")
            .forEach(button => {
                button.onclick = () => {
                    const sectionId = button.dataset.sectionId;
                    const textarea = backdrop
                        .querySelector(`[data-manual-reason="${sectionId}"]`);

                    appendManualExtraReasonPreset(
                        textarea,
                        button.dataset.manualReasonPreset
                    );
                };
            });
    };

    const refreshManualReasonPresetButtons = () => {
        backdrop
            .querySelectorAll("[data-manual-reason-presets]")
            .forEach(container => {
                const sectionId = container.dataset.manualReasonPresets;

                container.innerHTML =
                    manualExtraReasonPresetButtonsHTML(sectionId);
            });

        bindManualReasonPresetButtons();
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    backdrop
        .querySelector("[data-action='cancel']")
        .onclick = close;

    backdrop
        .querySelectorAll("[data-match-index]")
        .forEach(button => {
            button.onclick = () => {
                const sectionId = button.dataset.sectionId;

                selectedMatches.set(
                    sectionId,
                    Number(button.dataset.matchIndex)
                );

                backdrop
                    .querySelectorAll(
                        `[data-match-index][data-section-id="${sectionId}"]`
                    )
                    .forEach(item => {
                        const selected =
                            Number(item.dataset.matchIndex) ===
                            selectedMatches.get(sectionId);

                        item.classList.toggle("is-selected", selected);
                        item.setAttribute(
                            "aria-pressed",
                            selected ? "true" : "false"
                        );
                    });

                const manualTextarea = backdrop
                    .querySelector(`[data-manual-reason="${sectionId}"]`);

                if (manualTextarea) {
                    manualTextarea.value = "";
                }
            };
        });

    backdrop
        .querySelectorAll("[data-manual-reason]")
        .forEach(textarea => {
            textarea.addEventListener("input", event => {
                if (!event.target.value.trim()) return;

                const sectionId = event.target.dataset.manualReason;

                selectedMatches.delete(sectionId);
                backdrop
                    .querySelectorAll(
                        `[data-match-index][data-section-id="${sectionId}"]`
                    )
                    .forEach(item => {
                        item.classList.remove("is-selected");
                        item.setAttribute("aria-pressed", "false");
                    });
            });
        });

    backdrop
        .querySelector("[data-action='save-reason']")
        .onclick = saveBackups;

    backdrop
        .querySelectorAll("[data-manual-reason-presets-edit]")
        .forEach(button => {
            button.onclick = async event => {
                event.preventDefault();
                event.stopPropagation();

                if (await openManualExtraReasonPresetsDialog()) {
                    refreshManualReasonPresetButtons();
                }
            };
        });

    bindManualReasonPresetButtons();

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);

    (
        backdrop.querySelector("[data-clock-reason]") ||
        backdrop.querySelector("[data-match-index]") ||
        backdrop.querySelector("[data-manual-reason]")
    )?.focus();
}

window.openExtraReasonDialog = openExtraReasonDialog;

async function openClockExtraReasonDialog(
    profileName,
    keyDay,
    state
) {
    return openExtraReasonDialog(profileName, keyDay, 0, {
        forceClock: true,
        state
    });
}

window.openClockExtraReasonDialog = openClockExtraReasonDialog;

// Detalle por segmento del marcaje: entrada/salida reales + etiquetas de
// recuperacion / reduccion / horas extra (usa el mismo clasificador del reporte).
function clockDetailSegmentsHTML(profile, keyDay, date, state, holidays, mark) {
    const scheduledState = getClockScheduleState(profile, keyDay, state);
    const segments = getScheduledSegmentsForProfile(
        profile,
        keyDay,
        date,
        scheduledState,
        holidays
    );

    return segments
        .map(segment => {
            const segmentMark = findClockMarkEntry(mark, segment)?.value;

            if (!segmentMark) return "";

            const times = [];

            if (segmentMark.missingEntry) {
                times.push("Sin entrada");
            } else if (segmentMark.entryTime) {
                times.push(`Entrada a las ${segmentMark.entryTime}`);
            }

            if (segmentMark.missingExit) {
                times.push("Sin salida");
            } else if (segmentMark.exitTime) {
                times.push(`Salida a las ${segmentMark.exitTime}`);
            }

            const classification = classifyClockMarkSegment(
                date,
                segment,
                segmentMark,
                { isBaseOrSwap: true }
            );
            const tags = [];

            if (classification.recoveryMinutes > 0) {
                tags.push("Recuperación de horas");
            }

            if (classification.netExtraMinutes > 0) {
                tags.push("Genera horas extra");
            }

            if (classification.isReduction) {
                tags.push("Reducción de jornada");
            }

            return `
                <div class="clock-detail-segment">
                    <strong>${escapeHTML(segment.label || "Turno")}</strong>
                    ${times.length
                        ? `<span>${escapeHTML(times.join(" · "))}</span>`
                        : ""}
                    ${tags.length
                        ? `<span class="clock-detail-tags">${tags.map(tag =>
                            `<em>${escapeHTML(tag)}</em>`).join("")}</span>`
                        : ""}
                </div>
            `;
        })
        .filter(Boolean)
        .join("");
}

// Entrada desde fuera del calendario (panel de registros de HH.EE): resuelve
// por su cuenta la fecha, el turno realizado y los feriados del dia.
window.openClockMarkDetailForDate = async (profile, keyDay) => {
    if (!profile || !keyDay) return;

    const date = parseKey(keyDay);
    const holidays = await fetchHolidays(date.getFullYear());

    openClockMarkDetailDialog({
        profile,
        keyDay,
        date,
        state: aplicarCambiosTurno(
            profile,
            keyDay,
            getTurnoProgramado(profile, keyDay)
        ),
        holidays
    });
};

function openClockMarkDetailDialog({ profile, keyDay, date, state, holidays = {} }) {
    const mark = getClockMarks(profile)[keyDay];

    if (!mark?.segments) return;

    const audit = getClockMarkAuditInfo(profile, keyDay);
    const modifiedLabel = audit?.createdAtLabel ||
        (mark.updatedAt
            ? new Date(mark.updatedAt).toLocaleString("es-CL")
            : "Sin registro");
    const actorName = audit?.actorName || "No registrado";
    const segmentsHTML = clockDetailSegmentsHTML(
        profile,
        keyDay,
        date,
        state,
        holidays,
        mark
    );
    const reason = getClockExtraBackupForWorker(profile, keyDay)?.reason || "";
    // El marcaje puede haberse hecho SOBRE un turno extra. Son dos cosas
    // distintas -el turno extra y su motivo por un lado, la incidencia de
    // marcaje por otro- y este modal solo mostraba la segunda, asi que el motivo
    // del turno extra desaparecia al modificar el marcaje.
    const extraShift = getReplacementDetailRecord(profile, keyDay);
    const extraShiftHTML = extraShift
        ? `
            <div class="clock-detail-extra">
                <strong>${escapeHTML(
                    extraShift.replaced
                        ? (extraShift.isLoan ? "Prestamo asignado" : "Reemplazo asignado")
                        : "Turno extra asignado"
                )}</strong>
                <div class="clock-detail-rows">
                    <div><span>Turno</span><b>${escapeHTML(replacementDetailTurnLabel(extraShift))}</b></div>
                    ${extraShift.replaced
                        ? `<div><span>${escapeHTML(extraShift.isLoan ? "Cubre a" : "Reemplaza a")}</span><b>${escapeHTML(extraShift.replaced)}</b></div>`
                        : ""}
                    <div><span>${escapeHTML(extraShift.replaced ? "Ausencia" : "Motivo")}</span><b>${escapeHTML(replacementDetailReasonLabel(extraShift))}</b></div>
                    <div><span>Origen</span><b>${escapeHTML(replacementDetailSourceLabel(extraShift))}</b></div>
                </div>
            </div>
        `
        : "";

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog clock-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="clockDetailTitle">
            <strong id="clockDetailTitle">Marcaje reloj control</strong>
            <div class="clock-detail-rows">
                <div><span>Trabajador</span><b>${escapeHTML(profile)}</b></div>
                <div><span>Fecha</span><b>${escapeHTML(leaveDateLabelFromKey(keyDay))}</b></div>
                <div><span>Modificado</span><b>${escapeHTML(modifiedLabel)}</b></div>
                <div><span>Por</span><b>${escapeHTML(actorName)}</b></div>
            </div>
            <div class="clock-detail-segments">
                ${segmentsHTML || `<div class="clock-detail-segment"><span>Sin detalle de segmentos.</span></div>`}
            </div>
            ${reason
                ? `<p class="clock-detail-reason"><span>Motivo horas extras:</span> ${escapeHTML(reason)}</p>`
                : ""}
            ${extraShiftHTML}
            <div class="turn-change-dialog__actions">
                <button class="primary-button" type="button" data-action="edit">Modificar marcaje</button>
                ${extraShift
                    ? `<button class="secondary-button" type="button" data-action="extra-shift">Ver turno extra</button>`
                    : ""}
                <button class="ghost-button" type="button" data-action="close">Cerrar</button>
            </div>
        </section>
    `;

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };
    const onKeydown = event => {
        if (event.key === "Escape") close();
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-action='close']")
        ?.addEventListener("click", close);
    backdrop
        .querySelector("[data-action='edit']")
        ?.addEventListener("click", () => {
            close();
            window.openClockMarkEditorForDate?.(date);
        });
    // Con una incidencia de marcaje el click de la casilla abre este modal, asi
    // que el detalle del turno extra -y su anulacion- quedaba sin camino.
    backdrop
        .querySelector("[data-action='extra-shift']")
        ?.addEventListener("click", () => {
            close();
            void openReplacementDetailDialog(
                profile,
                keyDay,
                extraShift?.id || ""
            );
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-action='edit']")?.focus();
}

// Modal de un turno PREASIGNADO (cobertura tentativa). Se abre al clickear la
// casilla del ausente o del reemplazante preasignado. Permite Confirmar (el
// trabajador acepto -> pasa a reemplazo real: proyecta + suma horas) o Cancelar
// (vuelve el "!").
function openPreassignmentDialog({ profile, keyDay }) {
    const preassignment =
        getPreassignmentForCoveredShift(profile, keyDay) ||
        getPreassignmentForWorker(profile, keyDay);

    if (!preassignment) return;

    // Solo lectura en Turnos: la reserva se puede consultar, pero no
    // confirmarse ni cancelarse.
    const canEdit = canEditTarget("calendarPanel");

    const { id, worker, replaced, turno, absenceType } = preassignment;
    const audit = getPreassignmentAuditInfo(replaced, keyDay);
    const preassignedLabel = audit?.createdAtLabel ||
        (preassignment.at
            ? new Date(preassignment.at).toLocaleString("es-CL")
            : "Sin registro");
    const actorName = audit?.actorName || "No registrado";

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog leave-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="preassignDialogTitle">
            <strong id="preassignDialogTitle">Turno preasignado</strong>
            <div class="leave-detail-rows">
                <div><span>Reemplaza a</span><b>${escapeHTML(replaced)}</b></div>
                <div><span>Reemplazante</span><b>${escapeHTML(worker)}</b></div>
                <div><span>Turno</span><b>${escapeHTML(turnoReplacementLabel(turno))}</b></div>
                <div><span>Fecha</span><b>${escapeHTML(leaveDateLabelFromKey(keyDay))}</b></div>
                <div><span>Preasignado</span><b>${escapeHTML(preassignedLabel)}</b></div>
                <div><span>Por</span><b>${escapeHTML(actorName)}</b></div>
            </div>
            <p class="leave-detail-note">
                Reserva tentativa: aun no proyecta el turno ni suma horas. Confirma
                cuando el trabajador acepte; cancelar deja el turno pendiente de
                cobertura ("!").
            </p>
            <div class="turn-change-dialog__actions leave-detail-actions--stacked">
                ${canEdit ? `
                <button class="primary-button" type="button" data-action="confirm">Confirmar (el trabajador aceptó)</button>
                <button class="leave-detail-undo" type="button" data-action="cancel-preassign">Cancelar preasignación</button>
                ` : ""}
                <button class="ghost-button" type="button" data-action="close">Cerrar</button>
            </div>
        </section>
    `;

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };
    const onKeydown = event => {
        if (event.key === "Escape") close();
    };
    const refresh = async () => {
        await updateDayCell(replaced, keyDay);
        if (worker && worker !== replaced) {
            await updateDayCell(worker, keyDay);
        }
        updateTimelineCells(replaced, [keyDay]);
        if (worker) updateTimelineCells(worker, [keyDay]);
        await updateVisibleCalendarDays({ updateSummary: true });
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-action='close']")
        ?.addEventListener("click", close);
    backdrop
        .querySelector("[data-action='confirm']")
        ?.addEventListener("click", async () => {
            await withBusyState(async () => {
                // Pasa a reemplazo real (proyecta + suma horas), igual que el
                // paso directo de asignar. La accion vive en replacements.js
                // porque tambien la dispara la tarjeta de cobertura del inicio.
                confirmPreassignment(preassignment);
                close();
                await refresh();
            }, { label: "Confirmando..." });
        });
    backdrop
        .querySelector("[data-action='cancel-preassign']")
        ?.addEventListener("click", async () => {
            await withBusyState(async () => {
                cancelPreassignment(preassignment);
                close();
                await refresh();
            }, { label: "Cancelando..." });
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-action='confirm']")?.focus();
}

window.openPreassignmentDialog = openPreassignmentDialog;

async function clickDia(
    keyDay,
    isHab,
    admin,
    legal,
    comp,
    absences,
    options = {}
) {
    if (
        typeof window.workspaceCanEditTarget === "function" &&
        !window.workspaceCanEditTarget("calendarPanel")
    ) {
        return true;
    }

    const profileName = getCurrentProfile();

    if (!isProfileActive(profileName)) {
        alert("Este perfil esta desactivado. Reactivalo desde Perfil para modificar su calendario.");
        return true;
    }

    const turnChange =
        getCambioTurnoCalendario(profileName, keyDay)?.swap;

    if (turnChange) {
        return handleTurnChangeDayClick(turnChange);
    }

    const shiftMoveMarker =
        getShiftMoveMarkers(profileName, keyDay)[0] || null;

    if (shiftMoveMarker) {
        return openShiftMoveDetailDialog(shiftMoveMarker);
    }

    const workerReplacement =
        getReplacementForWorkerShift(profileName, keyDay);
    const directEditEnabled =
        typeof window.calendarDirectEditEnabled === "function"
            ? window.calendarDirectEditEnabled()
            : true;

    if (workerReplacement && !directEditEnabled) {
        return openReplacementDetailDialog(
            profileName,
            keyDay,
            workerReplacement.id || ""
        );
    }

    if (window.selectionMode === "halfadmin") return;
    if (window.selectionMode) return;

    const replacementNeededTurn =
        getReplacementNeededTurn(profileName, keyDay);
    const needsReplacement =
        Boolean(replacementNeededTurn) &&
        requiereReemplazoTurnoBase(
            keyDay,
            getTurnoBase(profileName, keyDay),
            admin,
            legal,
            comp,
            absences
        ) &&
        !getReplacementForCoveredShift(
            profileName,
            keyDay
        ) &&
        !getInheritedReplacementContractForCoveredShift(
            profileName,
            keyDay
        ) &&
        !isNoCoverageDay(profileName, keyDay);

    // Turno preasignado (del ausente o del reemplazante): abre el modal de
    // confirmar/cancelar en vez del de reemplazo.
    if (
        getPreassignmentForCoveredShift(profileName, keyDay) ||
        getPreassignmentForWorker(profileName, keyDay)
    ) {
        return openPreassignmentDialog({ profile: profileName, keyDay });
    }

    if (needsReplacement) {
        // Si ya salio la solicitud, lo primero que se necesita saber es a quien
        // se le pidio y cuanto queda; desde ahi se llega al cuadro de
        // sugerencias si hace falta insistir.
        if (getPendingReplacementRequestsForShift(profileName, keyDay).length) {
            return openPendingRequestsDialog({ profile: profileName, keyDay });
        }

        return openReplacementDialog(
            profileName,
            keyDay
        );
    }

    if (
        tieneAusencia(
            keyDay,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        openLeaveDetailDialog({
            profile: profileName,
            keyDay,
            admin,
            legal,
            comp,
            absences
        });
        return;
    }

    if (!directEditEnabled) {
        return;
    }

    const baseTurno = getTurnoBase(
        profileName,
        keyDay
    );
    const previewState = Number(
        options.cell?.dataset.directTurnState
    );
    const currentState = Number.isFinite(previewState)
        ? previewState
        : getActualState(profileName, keyDay);
    const effectiveBaseTurn = aplicarCambiosTurno(
        profileName,
        keyDay,
        baseTurno,
        { includeReplacements: false }
    );
    const directEditTurn = getProtectedDirectEditTurn(
        profileName,
        keyDay,
        currentState,
        isHab,
        { effectiveBaseTurn }
    );
    const nuevo = directEditTurn.nextVisibleTurn;
    const turnToStore = directEditTurn.nextStoredTurn;
    const protectedBaseTurn = directEditTurn.protectedBaseTurn;

    if (Number(nuevo) === Number(currentState)) {
        event.stopPropagation();
        return;
    }

    const manualExtra = Boolean(
        getShiftAssigned(
            profileName,
            options.date || dateFromKeyDay(keyDay)
        ) &&
        getTurnoExtraAgregado(
            protectedBaseTurn || effectiveBaseTurn,
            nuevo
        )
    );

    previewDirectTurnChange(
        options.cell,
        nuevo,
        options.date || dateFromKeyDay(keyDay),
        options.holidays || {},
        {
            profileName,
            keyDay,
            baseTurn: protectedBaseTurn || effectiveBaseTurn,
            manualExtra
        }
    );

    keepCalendarDirectEditHistoryOpen(
        `Edicion directa de turnos desde ${keyDay}`
    );
    if (Number(nuevo) !== Number(currentState)) {
        cancelManualExtraBackupsForTurnChange(
            profileName,
            keyDay,
            nuevo
        );
    }
    saveProfileDayTurn(keyDay, turnToStore, profileName);
    recordCalendarDirectEditChange({
        profileName,
        keyDay,
        previousTurn: currentState,
        nextTurn: nuevo
    });
    scheduleCalendarAuditLog({
        profile: profileName,
        keyDay,
        previousTurn: currentState,
        nextTurn: nuevo
    });
    scheduleCalendarDirectEditRefresh(keyDay);
}

async function renderCalendarImpl(options = {}) {
    if (
        calendarDirectEditRefreshTimer &&
        options.allowDuringDirectEdit !== true
    ) {
        return;
    }

    const cal = document.getElementById("calendar");
    const monthYear = document.getElementById("monthYear");
    const renderRequest = ++calendarRenderRequest;

    if (!cal) return;

    ensureCalendarDelegation(cal);

    const calendarPanel = cal.closest(".calendar-panel");
    const activeProfile = getCurrentProfile();
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const days =
        new Date(y, m + 1, 0).getDate();
    const rawRequestedKeys = new Set(
        Array.isArray(options.changedKeys)
            ? options.changedKeys
            : []
    );
    const largePartialRefresh = Boolean(
        rawRequestedKeys.size >= Math.max(
            CALENDAR_LARGE_PARTIAL_MIN_DAYS,
            Math.ceil(days * CALENDAR_LARGE_PARTIAL_RATIO)
        ) &&
        lastCalendarView?.calendar === cal &&
        lastCalendarView?.workerId === resolveWorkerId(activeProfile) &&
        lastCalendarView?.year === y &&
        lastCalendarView?.month === m
    );
    const effectiveOptions = largePartialRefresh
        ? {
            ...options,
            changedKeys: undefined,
            deferHeavy: true,
            updateSummary: false
        }
        : options;
    const cachedWorkers = getAppState().workers;
    const workers =
        Array.isArray(effectiveOptions.changedKeys) && cachedWorkers.length
            ? cachedWorkers
            : getProfiles();
    const activeWorker = workers.find(worker =>
        worker.name === activeProfile
    ) || null;
    const activeWorkerId = String(
        activeWorker?.id || resolveWorkerId(activeProfile)
    );
    const activeProfileEnabled =
        isProfileActive(activeWorker || activeProfile);
    const turnChangeConfig = getTurnChangeConfig();
    const monthKey = calendarMonthKey(y, m);
    const viewSignature = activeProfile
        ? calendarViewSignature({
            workerId: activeWorkerId,
            profileName: activeProfile,
            year: y,
            month: m,
            activeProfileEnabled
        })
        : "";
    const cacheKey = viewSignature
        ? calendarCacheKey(viewSignature)
        : "";
    const requestedKeys = new Set(
        Array.isArray(effectiveOptions.changedKeys)
            ? effectiveOptions.changedKeys
            : []
    );
    const partialRender = Boolean(
        requestedKeys.size &&
        lastCalendarView?.calendar === cal &&
        lastCalendarView?.workerId === activeWorkerId &&
        lastCalendarView?.year === y &&
        lastCalendarView?.month === m
    );

    if (partialRender && effectiveOptions.modeRefresh === true) {
        cal.dataset.calendarState = "refreshing-mode";
        cal.setAttribute("aria-busy", "true");
    }

    if (!partialRender) {
        syncWorkersState(workers);
        cal.classList.remove("has-multiple-badge-days");
        calendarPanel?.classList.remove("has-multiple-badge-days");
    }

    if (monthYear && !partialRender) {
        monthYear.innerText = currentDate.toLocaleString(
            "es-CL",
            {
                month: "long",
                year: "numeric"
            }
        );
        setupCalendarMonthPicker(monthYear);
    }

    const first =
        (new Date(y, m, 1).getDay() + 6) % 7;
    const draftKey =
        typeof window.getProfileDraftSelectionKey === "function"
            ? window.getProfileDraftSelectionKey()
            : "";
    const cachedCalendar =
        !partialRender &&
        activeProfile &&
        !effectiveOptions.skipCache
            ? readCalendarCache(cacheKey, {
                viewSignature,
                monthKey,
                workerId: activeWorkerId
            })
            : null;

    if (cachedCalendar) {
        activateCalendarCache(cal, cachedCalendar, {
            calendarPanel,
            workerId: activeWorkerId,
            profileName: activeProfile,
            year: y,
            month: m,
            days,
            cacheKey,
            viewSignature,
            monthKey
        });
        if (effectiveOptions.backgroundFresh === true) {
            scheduleCalendarBackgroundFreshRender({
                ...effectiveOptions,
                navigationRequest: effectiveOptions.navigationRequest,
                cached: true
            });
            return {
                cached: true,
                backgroundFresh: true
            };
        }
    } else if (!partialRender) {
        cal.dataset.calendarState = "loading";
        cal.setAttribute("aria-busy", "true");

        if (effectiveOptions.backgroundFresh === true) {
            showCalendarBackgroundPending(cal, {
                workerId: activeWorkerId,
                profileName: activeProfile,
                year: y,
                month: m,
                days,
                cacheKey,
                viewSignature,
                monthKey
            });
            scheduleCalendarBackgroundFreshRender({
                ...effectiveOptions,
                navigationRequest: effectiveOptions.navigationRequest,
                cached: false
            });
            return {
                cached: false,
                backgroundFresh: true
            };
        }
    }

    if (cachedCalendar) {
        await waitCalendarIdle(120);
    }

    const holidays = await fetchHolidays(y);

    if (renderRequest !== calendarRenderRequest) return;

    const fragment = document.createDocumentFragment();
    let hasMultipleBadgeDays = false;

    if (!partialRender) {
        for (let i = 0; i < first; i++) {
            const spacer = document.createElement("div");
            spacer.className = "calendar-spacer";
            fragment.appendChild(spacer);
        }
    }

    if (!activeProfile) {
        for (let d = 1; d <= days; d++) {
            const keyDay = key(y, m, d);
            const date = new Date(y, m, d);

            const div = buildDayCell({
                day: d,
                month: m,
                year: y,
                keyDay,
                label: "",
                title: "Selecciona una fecha para la nueva rotativa.",
                isWeekendDay: isWeekend(date),
                isHoliday: Boolean(holidays[keyDay]),
                isDraftSelected: draftKey === keyDay
            });

            div.dataset.keyDay = keyDay;
            div.dataset.date = isoFromKeyDay(keyDay);
            div.dataset.workerId = "";
            div.dataset.action = "calendar-day";

            fragment.appendChild(div);
        }

        cal.replaceChildren(fragment);
        registerCalendarCellsFromDOM(cal);
        cal.dataset.calendarState = "ready";
        cal.setAttribute("aria-busy", "false");
        lastCalendarView = {
            calendar: cal,
            workerId: "",
            year: y,
            month: m,
            holidaysLoaded: true
        };

        runCalendarHeavyUpdates(effectiveOptions);

        return;
    }

    const finishWorkerContext = startPerformanceSpan(
        "calendar:prepare-worker-context",
        {
            profile: activeProfile,
            year: y,
            month: m,
            partialRender
        }
    );
    const storedMaps = {
        shifts: getProfileData(),
        admin: getAdminDays(),
        legal: getLegalDays(),
        comp: getCompDays(),
        absences: getAbsences()
    };
    const activeRotativa = getRotativa(activeProfile);
    const shiftAssignedForDate =
        calendarShiftAssignedResolver(activeProfile);
    const centralCalendar = syncWorkerCalendarState({
        worker: activeWorker || activeProfile,
        year: y,
        month: m,
        shifts: storedMaps.shifts,
        absences: {
            admin: storedMaps.admin,
            legal: storedMaps.legal,
            comp: storedMaps.comp,
            absences: storedMaps.absences
        },
        configuration: {
            rotativa: activeRotativa,
            shiftAssigned: shiftAssignedForDate(new Date())
        }
    });
    const workerCalendarState = getWorkerCalendarState(
        centralCalendar.workerId
    );
    const data = workerCalendarState.shifts;
    const admin = workerCalendarState.absences.admin;
    const legal = workerCalendarState.absences.legal;
    const comp = workerCalendarState.absences.comp;
    const absences = workerCalendarState.absences.absences;
    const hourReturns = getHourReturns(activeProfile);
    const clockMarks = getClockMarks(activeProfile);
    const replacementIndex =
        buildCalendarReplacementIndex(activeProfile);
    // Una sola pasada para el mes: el barrido de caducidad tambien escribe, y
    // no puede correr una vez por casilla.
    const pendingRequestIndex = buildPendingRequestIndex();
    const turnChangeIndex =
        buildCalendarTurnChangeIndex(activeProfile, y, m);
    const shiftMoveIndex =
        buildCalendarShiftMoveIndex(activeProfile, y, m);
    const blockedDayIndex =
        buildCalendarBlockedDayIndex(activeProfile);
    const pendingLeaveIndex =
        buildPendingLeaveRequestIndex(activeProfile, y, m, days);
    const contractIndex =
        buildCalendarContractIndex(activeProfile, y, m, days);
    const honorariaSummary = getHonorariaMonthlySummary(
        activeProfile,
        y,
        m,
        holidays
    );
    const turnChangeReturnColorEnabled =
        Boolean(getTurnoColorConfig().turnChangeReturn);
    finishWorkerContext({
        days,
        workerId: activeWorkerId
    });
    const cooperativePartialRender =
        partialRender && effectiveOptions.cooperative === true;
    let partialProcessed = 0;
    const finishBuildDays = startPerformanceSpan(
        "calendar:build-day-cells",
        {
            profile: activeProfile,
            year: y,
            month: m,
            days,
            partialRender
        }
    );

    for (let d = 1; d <= days; d++) {
        const keyDay = key(y, m, d);

        if (partialRender && !requestedKeys.has(keyDay)) {
            continue;
        }

        const baseState = getTurnoBase(activeProfile, keyDay);
        const pendingLeaveRequest =
            pendingLeaveIndex.get(keyDay) || null;
        const pendingLeaveLabel =
            pendingLeaveRequest
                ? pendingLeaveRequestLabel(pendingLeaveRequest.type)
                : "";
        const pendingLeaveBaseLabel =
            pendingLeaveRequest
                ? turnoLabel(baseState) || "Libre"
                : "";

        const state = aplicarCambiosTurno(
            activeProfile,
            keyDay,
            getTurnoProgramado(activeProfile, keyDay)
        );

        // Preasignaciones: del ausente (reemplaza el "!") y de este perfil como
        // reemplazante tentativo (muestra el turno extra sin proyectarlo).
        const preassignedCovered = Boolean(
            getPreassignmentForCoveredShift(activeProfile, keyDay)
        );
        const preassignedWorker = getPreassignmentForWorker(
            activeProfile,
            keyDay
        );
        const preassignDisplayTurn =
            preassignedWorker && (Number(state) || 0) === TURNO.LIBRE
                ? getPreassignmentTurnForWorker(activeProfile, keyDay)
                : TURNO.LIBRE;

        const date = new Date(y, m, d);
        const isWeekendDay = isWeekend(date);
        const isHoliday = holidays[keyDay];
        const isHab = isBusinessDay(date, holidays);
        const isoDay = isoFromKeyDay(keyDay);
        const honorariaContractDay =
            Boolean(getHonorariaContractForDate(activeProfile, isoDay));
        const shiftAssigned = shiftAssignedForDate(date);

        const turnChangeMarkers =
            turnChangeIndex.get(keyDay) || [];
        const turnChangeMarker = turnChangeMarkers[0] || null;
        const shiftMoveMarkers =
            shiftMoveIndex.get(keyDay) || [];
        const hourReturn = hourReturns[keyDay] || null;
        const label = preassignDisplayTurn
            ? turnoLabel(preassignDisplayTurn)
            : hourReturn
            ? hourReturnCalendarLabel(hourReturn)
            : (
                pendingLeaveRequest
                    ? pendingLeaveLabel
                    : obtenerLabelDia(
                        keyDay,
                        state,
                        admin,
                        legal,
                        comp,
                        absences,
                        turnoLabel
                )
            );
        const turnChange = turnChangeMarker?.swap || null;
        const coveredReplacement =
            replacementIndex.byCoveredDate.get(isoDay) || null;
        const inheritedContractCoverage =
            getInheritedReplacementContractForCoveredShift(
                activeProfile,
                keyDay
            );
        const workerReplacement =
            replacementIndex.byWorkerDate.get(isoDay) || null;
        const replacementContractError =
            isReplacementProfile(activeProfile) &&
            state > 0 &&
            contractIndex.get(keyDay) === false;
        const pendingManualExtra =
            getPendingManualExtraTurn(
                activeProfile,
                keyDay,
                data
            );
        const manualExtra = Boolean(
            shiftAssigned &&
            getManualExtraTurn(
                activeProfile,
                keyDay,
                data
            )
        );
        const clockMark = clockMarks[keyDay] || null;
        const severeClockIncident =
            clockMarkHasSevereIncident(clockMark);
        const simpleClockIncident =
            !severeClockIncident &&
            clockMarkHasSimpleIncident(clockMark);
        const clockExtra =
            clockMark &&
            hasClockNetExtra(
                activeProfile,
                keyDay,
                date,
                state,
                holidays
            );
        const showClockExtraReason =
            clockExtra &&
            !replacementIndex.clockExtraBackupByDate.get(isoDay);
        const showTurnChangeBadge =
            Boolean(turnChange) &&
            state > 0 &&
            label === turnoLabel(state);
        const needsReplacement =
            requiereReemplazoTurnoBase(
                keyDay,
                baseState,
                admin,
                legal,
                comp,
                absences
            ) &&
            !coveredReplacement &&
            !inheritedContractCoverage &&
            !isNoCoverageDay(activeProfile, keyDay);
        const showExtraReason =
            !needsReplacement &&
            !turnChange &&
            !replacementContractError &&
            pendingManualExtra;
        const honorariaExcess =
            getHonorariaExcessForKey(
                honorariaSummary,
                keyDay
            );
        const showHonorariaLimitBadge =
            Boolean(honorariaExcess) &&
            !replacementContractError &&
            !severeClockIncident &&
            !needsReplacement;
        // Solicitudes ya enviadas a las PWA para este turno. Cambian el "!" de
        // "sin cubrir" por el celular de "en espera": no es lo mismo un turno
        // que nadie ha pedido que uno que ya salio a los telefonos.
        const pendingRequests = needsReplacement
            ? getPendingRequestsFromIndex(
                pendingRequestIndex,
                activeProfile,
                isoDay
            )
            : [];
        const badge = replacementContractError
            ? "X"
            : severeClockIncident
                ? "!!!"
                : preassignedCovered
                    ? PREASSIGN_BADGE
                : pendingRequests.length
                    ? REQUEST_PENDING_BADGE
                : needsReplacement
                    ? "!"
                : preassignedWorker
                    ? PREASSIGN_BADGE
                    : showHonorariaLimitBadge
                        ? "!"
                    : showExtraReason || showClockExtraReason
                    ? "?"
                    : simpleClockIncident
                        ? CLOCK_MARK_BADGE
                        : workerReplacement
                            ? (
                                workerReplacement.isLoan
                                    ? "Prestamo"
                                    : (workerReplacement.reason ? "Motivo" : "Reemplazo")
                            )
                            : (
                                turnChangeMarker?.label ||
                                (showTurnChangeBadge ? "CCTT" : "")
                            );
        const replacementTitle = workerReplacement
            ? (
                workerReplacement.replaced
                    ? `${workerReplacement.isLoan ? "Prestamo cubriendo a" : "Reemplazo de"} ${workerReplacement.replaced} por ${workerReplacement.absenceType || "ausencia"}.`
                    : `Motivo HHEE: ${workerReplacement.reason || workerReplacement.absenceType || "sin detalle"}.`
            )
            : "";
        const turnChangeTitle = Array.from(new Set(
            turnChangeMarkers
                .map(marker => turnChangeHoverTitle(marker, activeProfile))
                .filter(Boolean)
        )).join("\n\n");
        const shiftMoveTitle = Array.from(new Set(
            shiftMoveMarkers
                .map(shiftMoveHoverTitle)
                .filter(Boolean)
        )).join("\n\n");
        const workerBlockedDay =
            blockedDayIndex.get(isoDay) ||
            getBlockedDayForProfile(activeProfile, keyDay);
        const calendarBadges =
            Array.from(new Set([
                ...(pendingLeaveRequest ? ["Pend."] : []),
                ...(workerBlockedDay ? ["No disp."] : []),
                ...turnChangeMarkers.map(marker => marker.label),
                ...shiftMoveMarkers.map(marker => marker.label)
            ]));

        if (calendarBadges.length > 1) {
            hasMultipleBadgeDays = true;
        }

        const div = buildDayCell({
            day: d,
            month: m,
            year: y,
            keyDay,
            label,
            alternateLabel: pendingLeaveRequest
                ? pendingLeaveBaseLabel
                : "",
            badge,
            badges: calendarBadges.length
                ? calendarBadges
                : undefined,
            title: (() => {
                const leaveTitle = leaveApplicationHoverTitle(
                    activeProfile,
                    keyDay,
                    admin,
                    legal,
                    comp,
                    absences,
                    replacementIndex.coveringWorkersByDate.get(isoDay) || []
                );

                const suffix = pendingRequests.length
                    ? ` | Solicitud de cobertura enviada a ${pendingRequests.length} ` +
                      `trabajador${pendingRequests.length === 1 ? "" : "es"}: en espera de respuesta`
                    : needsReplacement
                    ? " | Requiere reemplazo de turno base"
                    : workerBlockedDay
                        ? ` | ${workerBlockedDay.message}`
                    : honorariaExcess
                        ? ` | ${getHonorariaLimitMessage(honorariaSummary, keyDay)}`
                    : showExtraReason
                        ? " | Requiere motivo de horas extras"
                        : showClockExtraReason
                            ? " | Requiere motivo por horas extras de marcaje"
                            : severeClockIncident
                                ? " | Incidencia grave de marcaje"
                                : simpleClockIncident
                                    ? " | Incidencia de marcaje"
                        : replacementContractError
                            ? " | No tiene contrato vigente en la fecha seleccionada"
                            : "";

                const baseTitle = (() => {
                    if (!activeProfileEnabled) {
                        return "Perfil desactivado: calendario solo lectura.";
                    }

                    if (replacementContractError) {
                        return "No tiene contrato vigente en la fecha seleccionada.";
                    }

                    // Ya no se muestran las HHEE (Diurnas/Nocturnas) en el hover;
                    // se conservan solo las advertencias del dia si las hay.
                    const warning = suffix.replace(/^\s*\|\s*/, "");

                    // Un dia puede tener las dos cosas a la vez: el motivo del
                    // turno extra y una incidencia de marcaje sobre ese mismo
                    // turno. Antes el motivo tapaba la advertencia, asi que el
                    // marcaje modificado quedaba invisible en el hover.
                    return [replacementTitle, warning]
                        .filter(Boolean)
                        .join("\n");
                })();

                return [
                    pendingLeaveHoverTitle(
                        pendingLeaveRequest,
                        activeProfile,
                        keyDay,
                        baseState
                    ),
                    turnChangeTitle,
                    shiftMoveTitle,
                    baseTitle,
                    leaveTitle
                ].filter(Boolean).join("\n");
            })(),
            isWeekendDay,
            isHoliday: Boolean(isHoliday),
            isDraftSelected:
                draftKey === keyDay ||
                (
                    window.selectionMode === "moveshifttarget" &&
                    window.pendingShiftMoveSourceKey === keyDay
                ),
            hasHonorariaContract: honorariaContractDay
        });

        div.dataset.keyDay = keyDay;
        div.dataset.date = isoFromKeyDay(keyDay);
        div.dataset.workerId = activeWorkerId;
        div.dataset.action = "calendar-day";

        // CCTT (cambio) y DDTT (devolucion) caen en dias distintos: se marca el tipo
        // para que sus etiquetas lleven colores diferentes.
        const hasReturnMarker =
            turnChangeMarkers.some(marker => marker.type === "return");
        const hasChangeMarker =
            turnChangeMarkers.some(marker => marker.type === "change");
        // Dia de devolucion con color personalizado por el supervisor.
        const returnCustomColor =
            hasReturnMarker && turnChangeReturnColorEnabled;

        if (turnChangeMarker) {
            div.classList.add("turn-change-day");
            div.dataset.swapId = String(
                turnChangeMarker.swap.id
            );

            if (hasChangeMarker) {
                div.classList.add("turn-change-day--change");
            }

            if (hasReturnMarker) {
                div.classList.add("turn-change-day--return");
            }
        }

        if (shiftMoveMarkers.length) {
            div.classList.add("shift-move-day");
        }

        if (workerBlockedDay) {
            div.classList.add("worker-blocked-day");
        }

        if (pendingLeaveRequest) {
            div.classList.add("pending-leave-request-day");
            div.dataset.workerRequestId = pendingLeaveRequest.id;
            // El parpadeo alterna el color del turno (fondo de la celda) con el
            // color del permiso solicitado (overlay), en sincronia con el nombre.
            div.style.setProperty(
                "--pending-leave-color",
                pendingLeaveColorValue(pendingLeaveRequest.type)
            );
            const pendingOverlay = document.createElement("span");
            pendingOverlay.className = "pending-leave-color-overlay";
            pendingOverlay.setAttribute("aria-hidden", "true");
            div.insertBefore(pendingOverlay, div.firstChild);
        }

        if (!activeProfileEnabled) {
            div.classList.add("inactive-profile-day");
        }

        if (needsReplacement && !preassignedCovered) {
            div.classList.add("needs-replacement");
        }

        if (preassignedCovered || preassignedWorker) {
            div.classList.add("preassign-day");
        }

        if (honorariaExcess) {
            div.classList.add("honoraria-limit-day");
        }

        if (showExtraReason) {
            div.classList.add("needs-extra-reason");
        }

        if (showClockExtraReason) {
            div.classList.add("needs-extra-reason");
            div.classList.add("clock-extra-day");
        }

        if (severeClockIncident) {
            div.classList.add("clock-severe-day");
        } else if (simpleClockIncident) {
            div.classList.add("clock-incident-day");
        }

        if (replacementContractError) {
            div.classList.add("contract-error-day");
        }

        if (workerReplacement) {
            div.classList.add("replacement-day");
        }

        if (manualExtra) {
            div.classList.add("manual-extra-day");
        }

        if (hourReturn) {
            div.classList.add("hours-return-day");
            if (!hourReturn.fullTurn) {
                div.classList.add("hours-return-day--partial");
            }
        }

        const dayColorGradient = getDayColorGradient(
            activeProfile,
            keyDay,
            state,
            date,
            holidays,
            admin[keyDay],
            baseState,
            {
                unbasedComponentsAreExtra: manualExtra,
                singleBandGradient: manualExtra,
                // En un dia de devolucion con color personalizado, la mitad DDTT
                // (componente extra del 24h) se pinta con ese color.
                extraColorOverride: returnCustomColor
                    ? "var(--color-turn-change-return)"
                    : undefined
            }
        );

        aplicarClasesEspeciales(
            div,
            keyDay,
            state,
            isHab,
            isWeekendDay,
            isHoliday,
            admin,
            legal,
            comp,
            absences,
            aplicarClaseTurno,
            baseState,
            dayColorGradient
        );

        // Dia de devolucion de UN solo color (no 24h): se pinta la celda completa con
        // el color personalizado (el 24h ya se resolvio via extraColorOverride).
        if (returnCustomColor && !dayColorGradient) {
            div.classList.add("turn-change-return-day");
        }

        const bloqueado = estaBloqueadoModo(
            window.selectionMode,
            keyDay,
            (
                window.selectionMode === "admin" ||
                window.selectionMode === "hoursreturn" ||
                window.selectionMode === "moveshiftsource" ||
                window.selectionMode === "moveshifttarget"
            )
                ? baseState
                : state,
            isHab,
            admin,
            legal,
            comp,
            absences,
            shiftAssigned,
            {
                compCantidad: window.compCantidad || 0,
                legalCantidad: window.legalCantidad || 0,
                licenseCantidad: window.licenseCantidad || 0,
                licenseType: window.licenseType || "license",
                rotativa: activeRotativa,
                holidays,
                hourReturns,
                actualState: state,
                moveShiftSourceKey:
                    window.pendingShiftMoveSourceKey || "",
                moveShiftDestinationTurn:
                    window.pendingShiftMoveDestinationTurn || 0,
                moveShiftProgrammedTurn:
                    getTurnoProgramado(activeProfile, keyDay),
                moveShiftPreviousTurn:
                    calendarAdjacentTurnForMoveShift(
                        activeProfile,
                        keyDay,
                        -1,
                        window.pendingShiftMoveSourceKey || ""
                    ),
                moveShiftNextTurn:
                    calendarAdjacentTurnForMoveShift(
                        activeProfile,
                        keyDay,
                        1,
                        window.pendingShiftMoveSourceKey || ""
                    ),
                allowTwentyFourHourShifts:
                    turnChangeConfig.allowTwentyFourHourShifts,
                allowInvertedTwentyFourHourShifts:
                    turnChangeConfig.allowInvertedTwentyFourHourShifts
            }
        );

        if (window.selectionMode || !activeProfileEnabled) {
            div.classList.add(
                bloqueado || !activeProfileEnabled
                    ? "mpa-disabled"
                    : "mpa-enabled"
            );
        }

        calendarCellHandlers.set(div, async event => {
            if (!activeProfileEnabled) {
                event.stopPropagation();
                alert("Este perfil esta desactivado. Reactivalo desde Perfil para modificar su calendario.");
                return;
            }

            if (
                pendingLeaveRequest &&
                !window.selectionMode
            ) {
                event.stopPropagation();
                return openPendingLeaveRequestDialog({
                    request: pendingLeaveRequest,
                    profile: activeProfile,
                    keyDay,
                    baseState
                });
            }

            if (
                replacementContractError &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                window.startReplacementContractEdit?.(
                    activeProfile,
                    keyDay
                );
                return;
            }

            if (
                showHonorariaLimitBadge &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                alert(getHonorariaLimitMessage(honorariaSummary, keyDay));
                return;
            }

            if (
                showExtraReason &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                return openExtraReasonDialog(
                    activeProfile,
                    keyDay,
                    showExtraReason
                );
            }

            if (
                showClockExtraReason &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                return openClockExtraReasonDialog(
                    activeProfile,
                    keyDay,
                    state
                );
            }

            // Dia con marcaje modificado (icono de reloj): abre el detalle del
            // marcaje. No aplica si falta el motivo de horas extra (badge "?") ni
            // durante un modo de seleccion.
            if (
                simpleClockIncident &&
                !showClockExtraReason &&
                !window.selectionMode
            ) {
                event.stopPropagation();
                return openClockMarkDetailDialog({
                    profile: activeProfile,
                    keyDay,
                    date,
                    state,
                    holidays
                });
            }

            if (
                turnChange ||
                needsReplacement
            ) {
                event.stopPropagation();
            }

            await clickDia(
                keyDay,
                isHab,
                admin,
                legal,
                comp,
                absences,
                {
                    cell: div,
                    date,
                    holidays
                }
            );
        });

        if (partialRender) {
            if (!replaceCalendarCell(activeWorkerId, keyDay, div)) {
                return renderCalendar({
                    ...effectiveOptions,
                    changedKeys: undefined,
                    allowDuringDirectEdit: true
                });
            }

            partialProcessed++;

            if (
                cooperativePartialRender &&
                partialProcessed % CALENDAR_PARTIAL_BATCH_SIZE === 0
            ) {
                await waitCalendarIdle(60);

                if (renderRequest !== calendarRenderRequest) return;
            }
        } else {
            fragment.appendChild(div);
        }
    }
    finishBuildDays({
        processed: partialRender ? partialProcessed : days
    });

    if (!partialRender) {
        measurePerformance(
            "calendar:commit-dom",
            () => {
                cal.replaceChildren(fragment);
                registerCalendarCellsFromDOM(cal);
                cal.dataset.calendarState = "ready";
                cal.setAttribute("aria-busy", "false");
                lastCalendarView = {
                    calendar: cal,
                    workerId: activeWorkerId,
                    profileName: activeProfile,
                    year: y,
                    month: m,
                    holidays,
                    holidaysLoaded: true,
                    days,
                    cacheKey,
                    viewSignature,
                    monthKey
                };
            },
            {
                profile: activeProfile,
                year: y,
                month: m,
                days
            }
        );
    } else {
        cal.dataset.calendarState = "ready";
        cal.setAttribute("aria-busy", "false");
    }
    const monthHasMultipleBadges = partialRender
        ? Boolean(cal.querySelector(".day.has-multiple-badges"))
        : hasMultipleBadgeDays;

    cal.classList.toggle(
        "has-multiple-badge-days",
        monthHasMultipleBadges
    );
    calendarPanel?.classList.toggle(
        "has-multiple-badge-days",
        monthHasMultipleBadges
    );

    syncCalendarMapSnapshots(activeProfile);
    scheduleActiveCalendarCacheWrite(cal, {
        delay: partialRender
            ? CALENDAR_CACHE_WRITE_DELAY_MS
            : 120
    });

    if (partialRender) {
        if (effectiveOptions.updateSummary === true) {
            scheduleWorkerSummaryUpdate(activeWorkerId);
        }
        return;
    }

    runCalendarHeavyUpdates(effectiveOptions, {
        profile: activeProfile,
        y,
        m,
        days,
        holidays,
        data
    });
}

export async function renderCalendar(options = {}) {
    return measurePerformance(
        "calendar:render",
        () => renderCalendarImpl(options),
        {
            year: currentDate.getFullYear(),
            month: currentDate.getMonth(),
            changedKeys: Array.isArray(options.changedKeys)
                ? options.changedKeys.length
                : 0,
            deferHeavy: options.deferHeavy === true,
            backgroundFresh: options.backgroundFresh === true,
            skipCache: options.skipCache === true
        },
        {
            asyncThreshold: 120
        }
    );
}

function syncShellPanels(options = {}) {
    const sync = () => {
        if (
            options.navigationRequest &&
            options.navigationRequest !== calendarNavigationRequest
        ) {
            return;
        }

        if (
            document.body.dataset.activeView === "swap" &&
            typeof window.renderSwapPanel === "function"
        ) {
            window.renderSwapPanel();
        }

        if (
            document.body.dataset.activeView === "dashboard" &&
            typeof window.renderDashboardState === "function"
        ) {
            window.renderDashboardState();
        } else {
            deferCalendarDashboardRefresh();
        }
    };

    if (options.deferHeavy) {
        deferAfterPaint(sync);
        return;
    }

    sync();
}

export async function goToCalendarMonth(year, month, options = {}) {
    const navigationRequest = ++calendarNavigationRequest;
    const renderOptions = {
        ...options,
        deferHeavy: true,
        backgroundFresh: options.backgroundFresh !== false,
        navigationRequest
    };
    const finishMonthNavigation = startPerformanceSpan(
        "calendar:go-to-month",
        {
            year: Number(year),
            month: Number(month),
            backgroundFresh: renderOptions.backgroundFresh
        }
    );

    if (
        typeof window !== "undefined" &&
        typeof window.disableCalendarDirectEditMode === "function"
    ) {
        await window.disableCalendarDirectEditMode({
            flush: true,
            refresh: false,
            reason: "month-change"
        });
    }

    cancelCalendarHeavyUpdates();
    cancelCalendarDirectEditRefresh();
    closeCalendarMonthPicker();
    currentDate.setFullYear(Number(year), Number(month), 1);
    showTimelinePendingMonth(
        currentDate.getFullYear(),
        currentDate.getMonth()
    );
    window.showInlineStaffingPendingMonth?.(
        currentDate.getFullYear(),
        currentDate.getMonth()
    );
    window.scheduleStaffingWeeklyPreload?.({ delay: 900 });
    const renderPromise = renderCalendar(renderOptions);

    if (renderOptions.backgroundFresh) {
        syncShellPanels(renderOptions);
        void renderPromise;
        finishMonthNavigation({
            returnedWithBackgroundFresh: true
        });
        return;
    }

    await renderPromise;

    if (navigationRequest !== calendarNavigationRequest) {
        finishMonthNavigation({
            cancelled: true
        });
        return;
    }

    syncShellPanels(renderOptions);
    finishMonthNavigation({
        returnedWithBackgroundFresh: false
    });
}

export async function prevMonth(options = {}) {
    const target = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() - 1,
        1
    );

    await goToCalendarMonth(
        target.getFullYear(),
        target.getMonth(),
        options
    );
}

export async function nextMonth(options = {}) {
    const target = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        1
    );

    await goToCalendarMonth(
        target.getFullYear(),
        target.getMonth(),
        options
    );
}

if (typeof window !== "undefined") {
    [
        "pointerdown",
        "keydown",
        "wheel",
        "touchstart",
        "input"
    ].forEach(eventName => {
        window.addEventListener(
            eventName,
            markCalendarUserActivity,
            { capture: true, passive: true }
        );
    });
}
