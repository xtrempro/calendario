import {
    isoFromKey,
    keyFromISO,
    keyToDate as parseKey,
    compareISODate
} from "./dateUtils.js";
import {
    getProfiles,
    getReplacements,
    getRotativa,
    saveProfileDayTurn,
    saveReplacements,
    getReplacementRequests,
    saveReplacementRequests,
    getReplacementRequestConfig
} from "./storage.js";
import {
    aplicarCambiosTurno,
    getTurnoBase,
    getTurnoProgramado
} from "./turnEngine.js";
import { getJSON } from "./persistence.js";
import { TURNO, TURNO_LABEL } from "./constants.js";
import { escapeHTML } from "./htmlUtils.js";
import {
    getTurnoComponentes,
    getAbsenceType,
    getTurnoExtraAgregado,
    restarTurnoCubierto,
    turnoDesdeComponentes,
    tieneAusencia
} from "./rulesEngine.js";
import { calcHours, isBusinessDay } from "./calculations.js";
import { getCachedHolidays } from "./holidays.js";
import {
    getClockDeficitHours,
    getClockExtraHours
} from "./clockMarks.js";
import {
    addAuditLog,
    AUDIT_CATEGORY
} from "./auditLog.js";
import { getWorkerAppLinkForProfile } from "./workerAppDataSync.js";
import { removePreassignment } from "./preassignments.js";

function formatNotificationDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return String(value || "");

    return `${match[3]}-${match[2]}-${match[1]}`;
}

function normalizeHours(hours) {
    if (!hours) return null;

    const d = Math.max(0, Number(hours.d) || 0);
    const n = Math.max(0, Number(hours.n) || 0);

    return d || n ? { d, n } : null;
}

function diurnoExtensionHours(date, holidays = {}) {
    if (!isBusinessDay(date, holidays)) {
        return { d: 0, n: 0 };
    }

    return {
        d: date.getDay() === 5 ? 4 : 3,
        n: 0
    };
}

export function codeToTurno(code) {
    if (code === "L") return TURNO.LARGA;
    if (code === "N") return TURNO.NOCHE;
    if (code === "24" || code === "24h" || code === "24H") {
        return TURNO.TURNO24;
    }
    if (code === "D") return TURNO.DIURNO;
    if (code === "D+N") return TURNO.DIURNO_NOCHE;
    if (code === "HM") return TURNO.MEDIA_MANANA;
    if (code === "HT") return TURNO.MEDIA_TARDE;
    if (code === "18") return TURNO.TURNO18;

    return TURNO.LIBRE;
}

export function turnoToCode(turno) {
    const state = Number(turno) || TURNO.LIBRE;

    if (state === TURNO.LARGA) return "L";
    if (state === TURNO.NOCHE) return "N";
    if (state === TURNO.TURNO24) return "24";
    if (state === TURNO.DIURNO) return "D";
    if (state === TURNO.DIURNO_NOCHE) return "D+N";
    if (state === TURNO.MEDIA_MANANA) return "HM";
    if (state === TURNO.MEDIA_TARDE) return "HT";
    if (state === TURNO.TURNO18) return "18";

    return "";
}

export function turnoReplacementLabel(turno) {
    return TURNO_LABEL[Number(turno) || TURNO.LIBRE] || "";
}

export function replacementActive(replacement) {
    return Boolean(replacement) && !replacement.canceled;
}

function replacementAddsShift(replacement) {
    return replacementActive(replacement) &&
        replacement.addsShift !== false;
}

function mergeTurns(currentTurn, nextTurn) {
    return turnoDesdeComponentes([
        ...getTurnoComponentes(currentTurn),
        ...getTurnoComponentes(nextTurn)
    ]);
}

export function getReplacementForCoveredShift(profile, keyDay) {
    const iso = isoFromKey(keyDay);

    return getReplacements().find(replacement =>
        replacementActive(replacement) &&
        replacement.replaced === profile &&
        replacement.date === iso
    ) || null;
}

export function getActiveCoveredReplacementsForProfileRange(
    profile,
    startISO,
    endISO = ""
) {
    const start = String(startISO || "");
    const end = String(endISO || "");

    if (!profile || !start) return [];

    return getReplacements()
        .filter(replacement =>
            replacementActive(replacement) &&
            replacement.replaced === profile &&
            replacement.date &&
            compareISODate(replacement.date, start) >= 0 &&
            (!end || compareISODate(replacement.date, end) <= 0)
        )
        .sort((a, b) =>
            String(a.date || "").localeCompare(String(b.date || "")) ||
            String(a.worker || "").localeCompare(String(b.worker || ""))
        );
}

// Nombres de los trabajadores que cubren el turno del ausente ese dia (uno o
// varios si el turno esta combinado). Sin duplicados.
export function getCoveringWorkersForShift(profile, keyDay) {
    const iso = isoFromKey(keyDay);

    return [...new Set(
        getReplacements()
            .filter(replacement =>
                replacementActive(replacement) &&
                replacement.replaced === profile &&
                replacement.date === iso &&
                replacement.worker
            )
            .map(replacement => String(replacement.worker))
    )];
}

export function getReplacementForWorkerShift(profile, keyDay) {
    return getReplacementsForWorkerShift(
        profile,
        keyDay
    )[0] || null;
}

export function getClockExtraBackupForWorker(profile, keyDay) {
    const iso = isoFromKey(keyDay);

    return getReplacements().find(replacement =>
        replacementActive(replacement) &&
        replacement.worker === profile &&
        replacement.date === iso &&
        replacement.source === "clock_extra"
    ) || null;
}

export function getReplacementsForWorkerShift(profile, keyDay) {
    const iso = isoFromKey(keyDay);

    return getReplacements().filter(replacement =>
        replacementActive(replacement) &&
        replacement.worker === profile &&
        replacement.date === iso
    );
}

export function getActiveReplacementsForWorkerKeys(
    profile,
    keys = []
) {
    const dates = new Set(keys.map(isoFromKey));

    if (!profile || !dates.size) return [];

    return getReplacements().filter(replacement =>
        replacementActive(replacement) &&
        replacement.worker === profile &&
        dates.has(replacement.date)
    );
}

function cancelLinkedRequestsForReplacements(
    replacements,
    {
        canceledAt,
        reason,
        details
    }
) {
    const requestIds = new Set();
    const groupIds = new Set();

    replacements.forEach(replacement => {
        if (replacement.requestId) {
            requestIds.add(String(replacement.requestId));
        }

        if (replacement.requestGroupId) {
            groupIds.add(String(replacement.requestGroupId));
        }
    });

    if (!requestIds.size && !groupIds.size) return;

    let changed = false;
    const requests = getReplacementRequests().map(request => {
        const belongsToCanceledReplacement =
            requestIds.has(String(request.id)) ||
            groupIds.has(String(request.groupId || request.id));

        if (!belongsToCanceledReplacement || request.status === "canceled") {
            return request;
        }

        changed = true;

        return {
            ...request,
            status: "canceled",
            canceledAt,
            cancelReason: reason,
            cancellationReason: details
        };
    });

    if (changed) {
        saveReplacementRequests(requests);
    }
}

export function cancelReplacementsForWorkerKeys(
    profile,
    keys = [],
    {
        reason = "medical_leave_applied",
        details = "Turno extra anulado al aplicar una licencia medica."
    } = {}
) {
    const dates = new Set(keys.map(isoFromKey));

    if (!profile || !dates.size) return [];

    const canceledAt = new Date().toISOString();
    const canceled = [];
    const replacements = getReplacements().map(replacement => {
        if (
            !replacementActive(replacement) ||
            replacement.worker !== profile ||
            !dates.has(replacement.date)
        ) {
            return replacement;
        }

        const nextReplacement = {
            ...replacement,
            canceled: true,
            canceledAt,
            cancelReason: reason,
            cancellationDetails: details
        };

        canceled.push(nextReplacement);
        return nextReplacement;
    });

    if (!canceled.length) return [];

    saveReplacements(replacements);
    cancelLinkedRequestsForReplacements(canceled, {
        canceledAt,
        reason,
        details
    });

    return canceled;
}

// Anula los reemplazos activos del trabajador (turnos extras, motivos manuales,
// horas extras del reloj) desde una fecha ISO en adelante. Se usa al aplicar una
// rotativa nueva para que el calendario hacia adelante quede limpio.
export function cancelFutureReplacementsForWorker(
    profile,
    startISO,
    {
        reason = "rotation_reset",
        details = "Turno extra anulado al aplicar una nueva rotativa."
    } = {}
) {
    const boundary = String(startISO || "");

    if (!profile || !boundary) return [];

    const canceledAt = new Date().toISOString();
    const canceled = [];
    const replacements = getReplacements().map(replacement => {
        if (
            !replacementActive(replacement) ||
            replacement.worker !== profile ||
            !replacement.date ||
            String(replacement.date) < boundary
        ) {
            return replacement;
        }

        const nextReplacement = {
            ...replacement,
            canceled: true,
            canceledAt,
            cancelReason: reason,
            cancellationDetails: details
        };

        canceled.push(nextReplacement);
        return nextReplacement;
    });

    if (!canceled.length) return [];

    saveReplacements(replacements);
    cancelLinkedRequestsForReplacements(canceled, {
        canceledAt,
        reason,
        details
    });

    return canceled;
}

export function cancelReplacementsForWorkerRange(
    profile,
    startISO,
    endISO = "",
    {
        reason = "rotation_reset",
        details = "Turno extra anulado al aplicar una nueva rotativa."
    } = {}
) {
    const start = String(startISO || "");
    const end = String(endISO || "");

    if (!profile || !start) return [];

    const canceledAt = new Date().toISOString();
    const canceled = [];
    const replacements = getReplacements().map(replacement => {
        const date = String(replacement.date || "");
        const inRange =
            date &&
            compareISODate(date, start) >= 0 &&
            (
                !end ||
                compareISODate(date, end) <= 0
            );

        if (
            !replacementActive(replacement) ||
            replacement.worker !== profile ||
            !inRange
        ) {
            return replacement;
        }

        const nextReplacement = {
            ...replacement,
            canceled: true,
            canceledAt,
            cancelReason: reason,
            cancellationDetails: details
        };

        canceled.push(nextReplacement);
        return nextReplacement;
    });

    if (!canceled.length) return [];

    saveReplacements(replacements);
    cancelLinkedRequestsForReplacements(canceled, {
        canceledAt,
        reason,
        details
    });

    return canceled;
}

/**
 * Quita del calendario el turno extra que respaldaba un registro anulado.
 *
 * Un turno extra MANUAL se agrega primero al calendario (edicion directa) y
 * despues se le registra el motivo con addsShift: false: el registro es solo el
 * respaldo, no proyecta el turno. Al anularlo se borraba el motivo pero el turno
 * seguia puesto, asi que la casilla volvia a pedir motivo con el "?" y en la
 * practica no se anulaba nada. Aca se resta ese turno del dia, dejando la casilla
 * en su turno base o vacia.
 *
 * Los respaldos de marcaje (clock_extra) no entran: sus horas vienen del reloj,
 * no de un turno del calendario, asi que no hay nada que quitar.
 */
function removeManualExtraTurnFromCalendar(record) {
    if (record?.source !== "manual_extra") return;

    const worker = String(record?.worker || "").trim();
    const keyDay = keyFromISO(record?.date);
    const extraTurn = codeToTurno(record?.turno);

    if (!worker || !keyDay || !extraTurn) return;

    const currentTurn = getTurnoProgramado(worker, keyDay);
    const restoredTurn = restarTurnoCubierto(currentTurn, extraTurn);

    // El turno extra puede no estar en el calendario (p. ej. una extension
    // horaria, que solo existe como registro): ahi no hay nada que revertir.
    if (Number(restoredTurn) === Number(currentTurn)) return;

    saveProfileDayTurn(keyDay, restoredTurn, worker);
}

export function cancelReplacementById(
    replacementId,
    {
        reason = "supervisor_canceled",
        details = "Reemplazo anulado por el supervisor.",
        canceledBy = "Calendario"
    } = {}
) {
    const id = String(replacementId || "");

    if (!id) return null;

    const canceledAt = new Date().toISOString();
    let canceled = null;
    const replacements = getReplacements().map(replacement => {
        if (
            String(replacement?.id || "") !== id ||
            !replacementActive(replacement)
        ) {
            return replacement;
        }

        canceled = {
            ...replacement,
            canceled: true,
            canceledAt,
            canceledBy,
            cancelReason: reason,
            cancellationDetails: details
        };

        return canceled;
    });

    if (!canceled) return null;

    saveReplacements(replacements);
    removeManualExtraTurnFromCalendar(canceled);
    cancelLinkedRequestsForReplacements([canceled], {
        canceledAt,
        reason,
        details
    });

    if (typeof window !== "undefined") {
        window.dispatchEvent(
            new CustomEvent("proturnos:calendarProfilesChanged", {
                detail: {
                    profiles: [
                        canceled.worker,
                        canceled.replaced
                    ].filter(Boolean),
                    metadata: {
                        changeType: "replacement_canceled",
                        source: canceled.source || "replacement",
                        title: canceled.replaced
                            ? "Reemplazo anulado"
                            : "Turno extra anulado",
                        message: canceled.replaced
                            ? `Se anuló el reemplazo del ${formatNotificationDate(canceled.date)}.`
                            : `Se anuló un turno extra para el ${formatNotificationDate(canceled.date)}.`,
                        affectedDates: [canceled.date].filter(Boolean),
                        entityId: canceled.id,
                        notifyProfiles: [canceled.worker].filter(Boolean)
                    }
                }
            })
        );
    }

    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        canceled.replaced
            ? "Anulo reemplazo de turno"
            : "Anulo turno extra",
        canceled.replaced
            ? `${canceled.worker} dejo de cubrir a ${canceled.replaced} el ${canceled.date}.`
            : `${canceled.worker}: turno extra anulado el ${canceled.date}.`,
        {
            profile: canceled.worker,
            replacementId: canceled.id,
            worker: canceled.worker,
            replaced: canceled.replaced || "",
            source: canceled.source || "",
            cancelReason: reason
        }
    );

    return canceled;
}

export function getReplacementTurnForWorker(profile, keyDay) {
    return getReplacementsForWorkerShift(profile, keyDay)
        .filter(replacementAddsShift)
        .reduce(
            (turno, replacement) =>
                mergeTurns(turno, codeToTurno(replacement.turno)),
            TURNO.LIBRE
        );
}

export function getBackedTurnForWorker(profile, keyDay) {
    return getReplacementsForWorkerShift(profile, keyDay)
        .filter(replacement =>
            replacement.source !== "clock_extra"
        )
        .reduce(
            (turno, replacement) =>
                mergeTurns(turno, codeToTurno(replacement.turno)),
            TURNO.LIBRE
        );
}

export function getReplacementLogForWorkerMonth(profile, year, month) {
    return getReplacements()
        .filter(replacement =>
            replacementActive(replacement) &&
            replacement.worker === profile &&
            Number(replacement.year) === Number(year) &&
            Number(replacement.month) === Number(month)
        )
        .sort((a, b) => a.date.localeCompare(b.date));
}

export function getReplacementOvertimeHours(
    replacement,
    date,
    turno,
    holidays = {}
) {
    const savedHours = normalizeHours(replacement?.overtimeHours);

    if (
        !savedHours &&
        replacement?.worker &&
        getRotativa(replacement?.worker).type === "diurno" &&
        Number(turno) === TURNO.MEDIA_TARDE
    ) {
        return diurnoExtensionHours(date, holidays);
    }

    return savedHours || calcHours(date, turno, holidays);
}

/**
 * Horas de un respaldo de HH.EE ya registrado.
 *
 * Un respaldo de marcaje ("clock_extra") vale por el marcaje que lo origino: si
 * ese marcaje se borro o se corrigio, las horas que guardo en su momento dejaron
 * de existir en el calendario. Antes se usaba esa foto guardada
 * (record.clockHours) y solo se recalculaba cuando venia vacia, asi que un
 * respaldo huerfano seguia sumando horas fantasma; con una extension horaria
 * registrada el mismo dia, las mismas horas se veian dos veces.
 *
 * Se recalculan siempre contra el marcaje vigente y el turno realmente
 * realizado, que es la misma fuente que usan el motor de horas y el reporte.
 */
export function getReplacementRecordHours(
    record,
    keyDay,
    date,
    turno,
    holidays = {}
) {
    if (record?.source !== "clock_extra") {
        return getReplacementOvertimeHours(record, date, turno, holidays);
    }

    const state = aplicarCambiosTurno(
        record.worker,
        keyDay,
        getTurnoProgramado(record.worker, keyDay)
    );

    return getClockExtraHours(
        record.worker,
        keyDay,
        date,
        state,
        holidays
    );
}

/**
 * Confirma una preasignacion: pasa a reemplazo REAL (proyecta el turno y suma
 * HH.EE) y saca la reserva tentativa. Es la accion del boton "Confirmar (el
 * trabajador acepto)" del calendario, compartida con la tarjeta de cobertura del
 * inicio para que las dos entradas hagan exactamente lo mismo.
 */
export function confirmPreassignment(preassignment) {
    const record = preassignment || {};
    const keyDay = keyFromISO(record.date);

    if (!record.id || !keyDay || !record.worker) return false;

    if (typeof window !== "undefined" &&
        typeof window.pushUndoState === "function") {
        window.pushUndoState("Confirmar preasignacion");
    }

    saveReplacement({
        worker: record.worker,
        replaced: record.replaced || "",
        keyDay,
        turno: codeToTurno(record.turno),
        absenceType: record.absenceType || "",
        source: "replacement",
        overtimeHours: record.overtimeHours || null,
        diurnoLongCoverage: Boolean(record.diurnoLongCoverage)
    });
    removePreassignment(record.id);
    addAuditLog(
        AUDIT_CATEGORY.CALENDAR,
        "Confirmo preasignacion",
        `${record.replaced || "Sin reemplazado"}: ${record.worker} confirmo el turno preasignado del ${keyDay}.`,
        { profile: record.replaced || record.worker, keyDay }
    );

    return true;
}

/**
 * Cancela una preasignacion: el turno vuelve a quedar pendiente de cobertura
 * ("!"). Espejo de "Cancelar preasignacion" del calendario.
 */
export function cancelPreassignment(preassignment) {
    const record = preassignment || {};
    const keyDay = keyFromISO(record.date);

    if (!record.id || !keyDay) return false;

    if (typeof window !== "undefined" &&
        typeof window.pushUndoState === "function") {
        window.pushUndoState("Cancelar preasignacion");
    }

    removePreassignment(record.id);
    addAuditLog(
        AUDIT_CATEGORY.CALENDAR,
        "Cancelo preasignacion",
        `${record.replaced || "Sin reemplazado"}: se cancelo el turno preasignado del ${keyDay}.`,
        { profile: record.replaced || record.worker || "", keyDay }
    );

    return true;
}

export function getAbsenceLabelForProfileDate(profile, keyDay) {
    const admin = getJSON(`admin_${profile}`, {});
    const legal = getJSON(`legal_${profile}`, {});
    const comp = getJSON(`comp_${profile}`, {});
    const absences = getJSON(`absences_${profile}`, {});

    if (admin[keyDay] === 1) return "P. Administrativo";
    if (admin[keyDay] === "0.5M") return "1/2 ADM Ma\u00f1ana";
    if (admin[keyDay] === "0.5T") return "1/2 ADM Tarde";
    if (admin[keyDay] === 0.5) return "1/2 ADM";
    if (legal[keyDay]) return "F. Legal";
    if (comp[keyDay]) return "F. Compensatorio";

    const absenceType = getAbsenceType(absences[keyDay]);

    if (absenceType === "professional_license") {
        return "LM Profesional";
    }

    if (absenceType === "unpaid_leave") {
        return "Permiso sin Goce";
    }

    if (absenceType === "union_leave") {
        return "Permiso Gremial";
    }

    if (absenceType === "license") {
        return "Licencia M\u00e9dica";
    }

    if (absenceType) {
        return "Ausencia Injustificada";
    }

    return "Ausencia";
}

export function workerHasAbsence(profile, keyDay) {
    return Boolean(
        tieneAusencia(
            keyDay,
            getJSON(`admin_${profile}`, {}),
            getJSON(`legal_${profile}`, {}),
            getJSON(`comp_${profile}`, {}),
            getJSON(`absences_${profile}`, {})
        )
    );
}

export function saveReplacement(data) {
    const date = parseKey(data.keyDay);
    const replacements = getReplacements();
    const hasReplacedWorker = Boolean(data.replaced);
    const absenceType =
        data.absenceType ||
        (
            hasReplacedWorker
                ? getAbsenceLabelForProfileDate(
                    data.replaced,
                    data.keyDay
                )
                : ""
        );

    const id =
        data.id ||
        `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const record = {
        id,
        interUnitLoanId: data.interUnitLoanId || "",
        requestId: data.requestId || "",
        requestGroupId: data.requestGroupId || "",
        worker: data.worker,
        replaced: data.replaced || "",
        reason: String(data.reason || "").trim(),
        source: data.source || "replacement",
        addsShift: data.addsShift !== false,
        date: isoFromKey(data.keyDay),
        turno: turnoToCode(data.turno),
        clockLabel: data.clockLabel || "",
        clockHours: data.clockHours || null,
        diurnoLongCoverage: Boolean(data.diurnoLongCoverage),
        overtimeHours: normalizeHours(data.overtimeHours),
        isLoan: Boolean(data.isLoan),
        workerWorkspaceId: data.workerWorkspaceId || "",
        workerWorkspaceName: data.workerWorkspaceName || "",
        hostWorkspaceId: data.hostWorkspaceId || "",
        hostWorkspaceName: data.hostWorkspaceName || "",
        remoteReplacementId: data.remoteReplacementId || "",
        absenceType,
        year: date.getFullYear(),
        month: date.getMonth(),
        createdAt: new Date().toISOString(),
        canceled: false
    };

    replacements.push(record);

    saveReplacements(replacements);

    // El trabajador necesita saber en la notificacion a quien cubre ese dia, o
    // el motivo cuando el turno extra no reemplaza a nadie.
    const extraShiftDetail = hasReplacedWorker
        ? `${data.isLoan ? "Cubres como prestamo a" : "Reemplazas a"} ${data.replaced}${absenceType ? ` por ${absenceType}` : ""}.`
        : String(data.reason || absenceType || "").trim()
            ? `Motivo: ${String(data.reason || absenceType).trim()}.`
            : "";

    if (typeof window !== "undefined") {
        window.dispatchEvent(
            new CustomEvent("proturnos:calendarProfilesChanged", {
                detail: {
                    profiles: [
                        data.worker,
                        data.replaced
                    ].filter(Boolean),
                    metadata: {
                        changeType: data.addsShift === false
                            ? "replacement_updated"
                            : "extra_shift_added",
                        source: data.source || "replacement",
                        title: data.addsShift === false
                            ? "Reemplazo actualizado"
                            : "Nuevo turno extra",
                        message: [
                            data.addsShift === false
                                ? "Se actualizó información de reemplazo en tu calendario."
                                : `Se agregó un turno extra para el ${formatNotificationDate(record.date)}.`,
                            extraShiftDetail
                        ].filter(Boolean).join(" "),
                        affectedDates: [record.date],
                        entityId: id,
                        notifyProfiles: [data.worker].filter(Boolean)
                    }
                }
            })
        );
    }

    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        data.source === "manual_extra" ||
        data.source === "clock_extra"
            ? "Respaldo horas extras manuales"
            : data.isLoan
                ? "Asigno prestamo entre unidades"
            : "Asigno reemplazo de turno",
        hasReplacedWorker
            ? `${data.worker} ${data.isLoan ? "cubre como prestamo a" : "reemplaza a"} ${data.replaced} el ${isoFromKey(data.keyDay)} por ${absenceType || "ausencia"}.`
            : `${data.worker}: ${String(data.reason || absenceType || "sin motivo").trim()} el ${isoFromKey(data.keyDay)}.`,
        {
            profile: data.worker,
            replacementId: id,
            interUnitLoanId: data.interUnitLoanId || "",
            worker: data.worker,
            replaced: data.replaced || "",
            isLoan: Boolean(data.isLoan),
            workerWorkspaceId: data.workerWorkspaceId || "",
            workerWorkspaceName: data.workerWorkspaceName || "",
            hostWorkspaceId: data.hostWorkspaceId || "",
            hostWorkspaceName: data.hostWorkspaceName || "",
            remoteReplacementId: data.remoteReplacementId || "",
            source: data.source || "replacement"
        }
    );

    return record;
}

function isExpiredRequest(request, now = new Date()) {
    if (!request?.expiresAt) return false;

    return new Date(request.expiresAt).getTime() <= now.getTime();
}

function requestId() {
    return `rr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function requestGroupId() {
    return `rrg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getProfileByName(name) {
    return getProfiles().find(profile => profile.name === name) || null;
}

function whatsappPhone(value) {
    const digits = String(value || "").replace(/\D/g, "");

    if (!digits) return "";
    if (digits.length === 8) return `569${digits}`;
    if (digits.length === 9 && digits.startsWith("9")) return `56${digits}`;
    if (digits.length >= 11 && digits.startsWith("56")) return digits;

    return digits;
}

function workerHasMobileApp(profile = {}, appLink = null) {
    return Boolean(
        appLink?.uid ||
        profile.mobileAppUid ||
        profile.appUid
    );
}

export function expireReplacementRequests(now = new Date()) {
    let changed = false;
    const requests = getReplacementRequests().map(request => {
        if (
            request.status === "pending" &&
            isExpiredRequest(request, now)
        ) {
            changed = true;
            return {
                ...request,
                status: "expired",
                expiredAt: now.toISOString()
            };
        }

        return request;
    });

    if (changed) {
        saveReplacementRequests(requests);
    }

    return requests;
}

export function getPendingReplacementRequestsForShift(
    replaced,
    keyDay,
    turno = null
) {
    const iso = isoFromKey(keyDay);
    const turnoCode = turno ? turnoToCode(turno) : "";

    return expireReplacementRequests().filter(request =>
        request.status === "pending" &&
        request.replaced === replaced &&
        request.date === iso &&
        (
            !turnoCode ||
            request.turno === turnoCode
        )
    );
}

function buildReplacementRequest(data) {
    const id = requestId();
    const workerProfile = getProfileByName(data.worker);
    const replacedProfile = getProfileByName(data.replaced);
    const appLink = getWorkerAppLinkForProfile(workerProfile);
    const config = getReplacementRequestConfig();
    const createdAt = new Date();
    const expiresAt = new Date(
        createdAt.getTime() +
        config.expiresMinutes * 60 * 1000
    );
    const workerUid =
        appLink?.uid ||
        workerProfile?.mobileAppUid ||
        workerProfile?.appUid ||
        "";
    const channel = workerHasMobileApp(workerProfile, appLink)
        ? "app"
        : "whatsapp";
    const absenceType =
        data.absenceType ||
        getAbsenceLabelForProfileDate(data.replaced, data.keyDay);
    const turnoCode = turnoToCode(data.turno);
    // calcHours espera el ESTADO numerico del turno (1=Larga, 2=Noche, ...),
    // no la letra que se guarda en el documento (turnoCode).
    const turnoState = Number(data.turno) || 0;

    // Horas extra del turno cubierto (todo el turno es sobretiempo). Se calculan
    // y guardan en la solicitud para que la app del trabajador pueda mostrar el
    // resumen HH.EE (diurnas/nocturnas) sin recalcular.
    const requestDate = data.keyDay ? parseKey(data.keyDay) : null;
    const holidayMap = requestDate
        ? getCachedHolidays(requestDate.getFullYear())
        : {};
    const computedHours = requestDate
        ? calcHours(requestDate, turnoState, holidayMap)
        : { d: 0, n: 0 };
    const explicitOvertime = normalizeHours(data.overtimeHours);
    const dayHours = computedHours.d || 0;
    const nightHours = computedHours.n || 0;

    return {
        id,
        groupId: data.groupId || id,
        groupSize: Number(data.groupSize) || 1,
        status: "pending",
        worker: data.worker,
        workerProfileId: workerProfile?.id || "",
        workerUid,
        workerEmail:
            workerProfile?.email ||
            appLink?.workerEmail ||
            "",
        replaced: data.replaced || "",
        replacedProfileId: replacedProfile?.id || "",
        keyDay: data.keyDay,
        date: isoFromKey(data.keyDay),
        turno: turnoCode,
        turnoLabel: turnoReplacementLabel(data.turno),
        absenceType,
        source: data.source || "replacement_request",
        channel,
        phone: workerProfile?.phone || "",
        scope: data.scope || "compatible",
        diurnoLongCoverage: Boolean(data.diurnoLongCoverage),
        overtimeHours: explicitOvertime || (dayHours + nightHours),
        dayHours,
        nightHours,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        canceledAt: "",
        acceptedAt: "",
        rejectedAt: "",
        expiredAt: "",
        appliedAt: "",
        notificationStatus:
            channel === "app"
                ? "queued"
                : "whatsapp_pending"
    };
}

export function createReplacementRequest(data) {
    const request = buildReplacementRequest(data);

    saveReplacementRequests([
        ...getReplacementRequests(),
        request
    ]);

    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        "Creo solicitud de reemplazo",
        `${request.worker}: solicitud para cubrir ${request.turnoLabel} de ${request.replaced} el ${request.date}. Canal: ${request.channel}.`,
        {
            profile: request.worker,
            requestId: request.id,
            requestGroupId: request.groupId,
            replaced: request.replaced,
            channel: request.channel
        }
    );

    return request;
}

export function createReplacementRequests(data, workers = []) {
    const uniqueWorkers = [...new Set(
        (workers || [])
            .map(worker => String(worker || "").trim())
            .filter(Boolean)
    )];

    if (!uniqueWorkers.length) return [];

    const groupId = requestGroupId();
    const diurnoLongCoverageWorkers = new Set(
        (data.diurnoLongCoverageWorkers || [])
            .map(worker => String(worker || "").trim())
            .filter(Boolean)
    );
    const workerCoverage = data.workerCoverage || {};
    const requests = uniqueWorkers.map(worker => {
        const coverage = workerCoverage[worker] || {};
        const diurnoLongCoverage =
            Boolean(coverage.diurnoLongCoverage) ||
            diurnoLongCoverageWorkers.has(worker);

        return buildReplacementRequest({
            ...data,
            worker,
            groupId,
            groupSize: uniqueWorkers.length,
            diurnoLongCoverage,
            overtimeHours: coverage.overtimeHours ||
                (
                    diurnoLongCoverage
                        ? data.diurnoLongCoverageHours
                        : data.overtimeHours
                )
        });
    });

    saveReplacementRequests([
        ...getReplacementRequests(),
        ...requests
    ]);

    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        requests.length > 1
            ? "Creo solicitud masiva de reemplazo"
            : "Creo solicitud de reemplazo",
        requests.length > 1
            ? `${requests.length} trabajadores invitados para cubrir ${requests[0].turnoLabel} de ${requests[0].replaced} el ${requests[0].date}.`
            : `${requests[0].worker}: solicitud para cubrir ${requests[0].turnoLabel} de ${requests[0].replaced} el ${requests[0].date}. Canal: ${requests[0].channel}.`,
        {
            profile: requests[0].replaced,
            requestGroupId: groupId,
            requestIds: requests.map(request => request.id),
            workers: uniqueWorkers,
            replaced: requests[0].replaced
        }
    );

    return requests;
}

export function cancelReplacementRequest(id, reason = "admin") {
    let canceled = null;
    const now = new Date().toISOString();
    const requests = getReplacementRequests().map(request => {
        if (
            request.id !== id ||
            request.status !== "pending"
        ) {
            return request;
        }

        canceled = {
            ...request,
            status: "canceled",
            canceledAt: now,
            cancelReason: reason
        };

        return canceled;
    });

    if (!canceled) return null;

    saveReplacementRequests(requests);
    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        "Anulo solicitud de reemplazo",
        `${canceled.worker}: solicitud anulada para ${canceled.date}.`,
        {
            profile: canceled.worker,
            requestId: canceled.id
        }
    );

    return canceled;
}

export function buildReplacementRequestWhatsAppUrl(request) {
    const phone = whatsappPhone(request.phone);

    if (!phone) return "";

    const message = [
        `Hola ${request.worker}.`,
        `Se solicita cubrir un turno ${request.turnoLabel} el ${formatDate(request.date)}.`,
        `Motivo: reemplazo de ${request.replaced} por ${request.absenceType}.`,
        request.groupSize > 1
            ? "Esta invitacion fue enviada a varios trabajadores; el primer SI confirmado se queda con el turno."
            : "",
        "Responde SI para aceptar o NO para rechazar.",
        `La solicitud caduca el ${new Date(request.expiresAt).toLocaleString("es-CL")}.`
    ].filter(Boolean).join("\n");

    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function applyAcceptedReplacementRequests() {
    let changed = false;
    const replacements = getReplacements();
    const requests = getReplacementRequests();
    const nextRequests = requests.map(request => ({ ...request }));
    const groupIds = [...new Set(
        nextRequests
            .filter(request =>
                request.status === "accepted" &&
                !request.appliedAt
            )
            .map(request => request.groupId || request.id)
    )];

    groupIds.forEach(groupId => {
        const groupRequests = nextRequests.filter(request =>
            (request.groupId || request.id) === groupId
        );
        const hasAppliedRequest = groupRequests.some(request =>
            Boolean(request.appliedAt)
        );
        const hasAppliedReplacement = replacements.some(replacement =>
            !replacement.canceled &&
            (
                replacement.requestGroupId === groupId ||
                groupRequests.some(request =>
                    replacement.requestId === request.id
                )
            )
        );

        if (hasAppliedRequest || hasAppliedReplacement) {
            return;
        }

        const winner = groupRequests
            .filter(request => request.status === "accepted")
            .sort((a, b) =>
                String(a.acceptedAt || a.createdAt).localeCompare(
                    String(b.acceptedAt || b.createdAt)
                )
            )[0];

        if (!winner) return;

        const alreadyApplied = replacements.some(replacement =>
            !replacement.canceled &&
            (
                replacement.requestId === winner.id ||
                (
                    replacement.worker === winner.worker &&
                    replacement.replaced === winner.replaced &&
                    replacement.date === winner.date &&
                    replacement.turno === winner.turno
                )
            )
        );

        if (!alreadyApplied) {
            saveReplacement({
                worker: winner.worker,
                replaced: winner.replaced,
                keyDay: winner.keyDay,
                turno: codeToTurno(winner.turno),
                absenceType: winner.absenceType,
                source:
                    winner.source === "forced_replacement_request"
                        ? "forced_replacement"
                        : "replacement",
                diurnoLongCoverage:
                    Boolean(winner.diurnoLongCoverage),
                overtimeHours: winner.overtimeHours,
                requestId: winner.id,
                requestGroupId: groupId
            });
        }

        const now = new Date().toISOString();

        groupRequests.forEach(groupRequest => {
            const target = nextRequests.find(request =>
                request.id === groupRequest.id
            );

            if (!target) return;

            if (target.id === winner.id) {
                target.appliedAt = now;
                return;
            }

            if (
                target.status === "pending" ||
                target.status === "accepted"
            ) {
                target.status = "superseded";
                target.supersededAt = now;
                target.supersededByRequestId = winner.id;
            }
        });

        changed = true;
    });

    if (changed) {
        saveReplacementRequests(nextRequests);
    }

    return changed;
}

function formatDate(value) {
    const key = keyFromISO(value);
    const parts = key.split("-");

    return `${String(Number(parts[2])).padStart(2, "0")}-${String(Number(parts[1]) + 1).padStart(2, "0")}-${parts[0]}`;
}

function formatHours(hours) {
    const d = Math.round((Number(hours.d) || 0) * 2) / 2;
    const n = Math.round((Number(hours.n) || 0) * 2) / 2;
    const chunks = [];

    if (d) chunks.push(`${d}h diurnas`);
    if (n) chunks.push(`${n}h nocturnas`);

    return chunks.length ? chunks.join(" / ") : "0h";
}

function getPendingManualExtraTurn(profile, keyDay) {
    const baseWithSwaps = aplicarCambiosTurno(
        profile,
        keyDay,
        getTurnoBase(profile, keyDay),
        { includeReplacements: false }
    );
    const actualWithSwaps = aplicarCambiosTurno(
        profile,
        keyDay,
        getTurnoProgramado(profile, keyDay),
        { includeReplacements: false }
    );
    const extraTurn = getTurnoExtraAgregado(
        baseWithSwaps,
        actualWithSwaps
    );

    return restarTurnoCubierto(
        extraTurn,
        getBackedTurnForWorker(profile, keyDay)
    );
}

// Un dia cubierto por un permiso o licencia aprobada no genera descuento: las
// horas no trabajadas ya estan justificadas. Es el mismo criterio del motor de
// horas, que salta esos dias salvo el medio dia administrativo (ahi si se mide
// contra la media jornada que quedaba por trabajar).
function clockDeficitAppliesToDay(profile, keyDay) {
    const admin = getJSON(`admin_${profile}`, {});
    const adminValue = admin[keyDay];
    const isHalfAdmin =
        adminValue === 0.5 ||
        adminValue === "0.5M" ||
        adminValue === "0.5T";

    if (isHalfAdmin) return true;

    return !tieneAusencia(
        keyDay,
        admin,
        getJSON(`legal_${profile}`, {}),
        getJSON(`comp_${profile}`, {}),
        getJSON(`absences_${profile}`, {})
    );
}

function getClockDeficitLogEntries(profile, year, month, holidays = {}) {
    const days = new Date(year, month + 1, 0).getDate();
    const entries = [];

    for (let day = 1; day <= days; day++) {
        const keyDay = `${year}-${month}-${day}`;
        const date = new Date(year, month, day);

        if (!clockDeficitAppliesToDay(profile, keyDay)) continue;

        const state = aplicarCambiosTurno(
            profile,
            keyDay,
            getTurnoProgramado(profile, keyDay)
        );
        const deficit = getClockDeficitHours(
            profile,
            keyDay,
            date,
            state,
            holidays
        );

        if (!deficit.d && !deficit.n) continue;

        entries.push({
            date: isoFromKey(keyDay),
            hours: deficit,
            detail: `Turno ${turnoReplacementLabel(state)}: horas programadas no trabajadas segun el marcaje.`
        });
    }

    return entries;
}

function getUnbackedOvertimeLogEntries(
    profile,
    year,
    month,
    holidays = {}
) {
    const days = new Date(year, month + 1, 0).getDate();
    const entries = [];

    for (let day = 1; day <= days; day++) {
        const keyDay = `${year}-${month}-${day}`;
        const date = new Date(year, month, day);
        const iso = isoFromKey(keyDay);
        const pendingTurn =
            getPendingManualExtraTurn(profile, keyDay);

        if (pendingTurn) {
            const hours = getReplacementOvertimeHours(
                { worker: profile },
                date,
                pendingTurn,
                holidays
            );

            if (hours.d || hours.n) {
                entries.push({
                    date: iso,
                    label: turnoReplacementLabel(pendingTurn),
                    hours,
                    detail: "No se ha asignado respaldo."
                });
            }
        }

        if (getClockExtraBackupForWorker(profile, keyDay)) {
            continue;
        }

        const state = aplicarCambiosTurno(
            profile,
            keyDay,
            getTurnoProgramado(profile, keyDay)
        );
        const clockHours = getClockExtraHours(
            profile,
            keyDay,
            date,
            state,
            holidays
        );

        if (clockHours.d || clockHours.n) {
            entries.push({
                date: iso,
                label: "Marcaje reloj control",
                hours: clockHours,
                detail: "No se ha asignado respaldo."
            });
        }
    }

    return entries;
}

function renderBackedReplacementLogHTML(profile, year, month, holidays = {}) {
    const records =
        getReplacementLogForWorkerMonth(profile, year, month);

    if (!records.length) {
        return `
            <div class="replacement-log replacement-log--empty">
                Sin respaldos de HHEE registrados en este mes.
            </div>
        `;
    }

    const profiles = getProfiles();

    return `
        <div class="replacement-log">
            ${records.map(record => {
                const key = keyFromISO(record.date);
                const date = parseKey(key);
                const isClockExtra =
                    record.source === "clock_extra";
                const turno = codeToTurno(record.turno);
                const hours = getReplacementRecordHours(
                    record,
                    key,
                    date,
                    turno,
                    holidays
                );
                const label = isClockExtra
                    ? (record.clockLabel || "Marcaje reloj control")
                    : turnoReplacementLabel(turno);
                const replacedProfile = profiles.find(
                    profileItem => profileItem.name === record.replaced
                );
                const estamento = replacedProfile?.estamento
                    ? ` · ${replacedProfile.estamento}`
                    : "";

                const unitText = record.isLoan
                    ? ` Prestamo en ${record.hostWorkspaceName || "otra unidad"}.`
                    : "";
                const detail = record.replaced
                    ? `${record.isLoan ? "Prestamo cubriendo a" : "Reemplaza a"} ${record.replaced}${estamento} por ${record.absenceType || "ausencia"}.${unitText}`
                    : `Motivo: ${record.reason || record.absenceType || "sin detalle"}.`;

                return `
                    <div class="replacement-log__item">
                        <span>${formatDate(record.date)} · ${label}</span>
                        <span>${formatHours(hours)}</span>
                        <small>${detail}</small>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function renderBackedOvertimeLogItem(record, profiles, holidays) {
    const key = keyFromISO(record.date);
    const date = parseKey(key);
    const isClockExtra =
        record.source === "clock_extra";
    const turno = codeToTurno(record.turno);
    const hours = getReplacementRecordHours(
        record,
        key,
        date,
        turno,
        holidays
    );
    const label = isClockExtra
        ? (record.clockLabel || "Marcaje reloj control")
        : turnoReplacementLabel(turno);
    const replacedProfile = profiles.find(
        profileItem => profileItem.name === record.replaced
    );
    const estamento = replacedProfile?.estamento
        ? ` - ${replacedProfile.estamento}`
        : "";
    const unitText = record.isLoan
        ? ` Prestamo en ${record.hostWorkspaceName || "otra unidad"}.`
        : "";
    const detail = record.replaced
        ? `${record.isLoan ? "Prestamo cubriendo a" : "Reemplaza a"} ${record.replaced}${estamento} por ${record.absenceType || "ausencia"}.${unitText}`
        : `Motivo: ${record.reason || record.absenceType || "sin detalle"}.`;

    return `
        <div class="replacement-log__item">
            <span>${escapeHTML(formatDate(record.date))} - ${escapeHTML(label)}</span>
            <span>${escapeHTML(formatHours(hours))}</span>
            <small>${escapeHTML(detail)}</small>
        </div>
    `;
}

function renderUnbackedOvertimeLogItem(entry) {
    return `
        <div class="replacement-log__item">
            <span>${escapeHTML(formatDate(entry.date))} - ${escapeHTML(entry.label)}</span>
            <span>${escapeHTML(formatHours(entry.hours))}</span>
            <small>${escapeHTML(entry.detail)}</small>
        </div>
    `;
}

export function renderReplacementLogHTML(profile, year, month, holidays = {}) {
    const records =
        getReplacementLogForWorkerMonth(profile, year, month);
    const pendingEntries =
        getUnbackedOvertimeLogEntries(
            profile,
            year,
            month,
            holidays
        );

    if (!pendingEntries.length) {
        return renderBackedReplacementLogHTML(
            profile,
            year,
            month,
            holidays
        );
    }

    const profiles = getProfiles();
    const items = [
        ...records.map((record, index) => ({
            date: record.date,
            order: index,
            html: renderBackedOvertimeLogItem(
                record,
                profiles,
                holidays
            )
        })),
        ...pendingEntries.map((entry, index) => ({
            date: entry.date,
            order: records.length + index,
            html: renderUnbackedOvertimeLogItem(entry)
        }))
    ].sort((a, b) =>
        a.date.localeCompare(b.date) ||
        a.order - b.order
    );

    if (!items.length) {
        return `
            <div class="replacement-log replacement-log--empty">
                Sin registros de HHEE en este mes.
            </div>
        `;
    }

    return `
        <div class="replacement-log">
            ${items.map(item => item.html).join("")}
        </div>
    `;
}

const HHEE_RECORD_MONTHS_SHORT = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic"
];

function hheeRecordDateParts(iso) {
    const key = keyFromISO(iso);
    const parts = key.split("-");
    const monthIndex = Number(parts[1]) || 0;

    return {
        day: String(Number(parts[2])).padStart(2, "0"),
        monthShort: HHEE_RECORD_MONTHS_SHORT[monthIndex] || "",
        label: formatDate(iso)
    };
}

function hheeRecordBadgeClass(label, isClockExtra) {
    if (isClockExtra) return "t-marcaje";

    const normalized = String(label || "").toLowerCase();

    if (normalized.includes("larga")) return "t-larga";
    if (normalized.includes("noche")) return "t-noche";
    if (normalized.includes("diurn")) return "t-diurno";

    return "t-larga";
}

/**
 * Devuelve los registros de HHEE de un mes ya normalizados para la vista nueva:
 * fecha, tipo de turno (con clase de badge), horas diurnas/nocturnas, detalle y
 * si tiene respaldo. Reutiliza exactamente el mismo calculo que
 * renderReplacementLogHTML (backed = con respaldo, pending = sin respaldo).
 */
export function getHheeMonthRecords(profile, year, month, holidays = {}) {
    const records =
        getReplacementLogForWorkerMonth(profile, year, month);
    const pendingEntries =
        getUnbackedOvertimeLogEntries(profile, year, month, holidays);
    const profiles = getProfiles();

    const backedItems = records.map((record) => {
        const key = keyFromISO(record.date);
        const date = parseKey(key);
        const isClockExtra = record.source === "clock_extra";
        const turno = codeToTurno(record.turno);
        const hours = getReplacementRecordHours(
            record,
            key,
            date,
            turno,
            holidays
        );
        const label = isClockExtra
            ? (record.clockLabel || "Marcaje reloj control")
            : turnoReplacementLabel(turno);
        const replacedProfile = profiles.find(
            (profileItem) => profileItem.name === record.replaced
        );
        const estamento = replacedProfile?.estamento
            ? ` - ${replacedProfile.estamento}`
            : "";
        const unitText = record.isLoan
            ? ` Prestamo en ${record.hostWorkspaceName || "otra unidad"}.`
            : "";
        const detail = record.replaced
            ? `${record.isLoan ? "Prestamo cubriendo a" : "Reemplaza a"} ${record.replaced}${estamento} por ${record.absenceType || "ausencia"}.${unitText}`
            : `Motivo: ${record.reason || record.absenceType || "sin detalle"}.`;
        const parts = hheeRecordDateParts(record.date);

        return {
            date: record.date,
            day: parts.day,
            monthShort: parts.monthShort,
            dateLabel: parts.label,
            label,
            badgeClass: hheeRecordBadgeClass(label, isClockExtra),
            d: Number(hours?.d) || 0,
            n: Number(hours?.n) || 0,
            detail,
            backed: true,
            isClockExtra
        };
    }).filter((item) =>
        // Respaldo de marcaje sin marcaje vigente: el motivo quedo huerfano
        // porque el marcaje se borro o se corrigio, y ya no representa horas.
        // Listarlo con sus horas antiguas las duplicaba contra la extension
        // horaria del mismo dia, que si es real.
        !item.isClockExtra || item.d || item.n
    );

    const unbackedItems = pendingEntries.map((entry) => {
        const isClockExtra = entry.label === "Marcaje reloj control";
        const parts = hheeRecordDateParts(entry.date);

        return {
            date: entry.date,
            day: parts.day,
            monthShort: parts.monthShort,
            dateLabel: parts.label,
            label: entry.label,
            badgeClass: hheeRecordBadgeClass(entry.label, isClockExtra),
            d: Number(entry.hours?.d) || 0,
            n: Number(entry.hours?.n) || 0,
            detail: entry.detail,
            backed: false
        };
    });

    const deficitItems = getClockDeficitLogEntries(
        profile,
        year,
        month,
        holidays
    ).map((entry) => {
        const parts = hheeRecordDateParts(entry.date);

        return {
            date: entry.date,
            day: parts.day,
            monthShort: parts.monthShort,
            dateLabel: parts.label,
            label: "Descuento por marcaje",
            badgeClass: "t-descuento",
            d: -(Number(entry.hours?.d) || 0),
            n: -(Number(entry.hours?.n) || 0),
            detail: entry.detail,
            backed: true,
            // No es un evento de HH.EE: no entra en el contador de respaldos.
            adjustment: true
        };
    });

    return [...backedItems, ...unbackedItems, ...deficitItems].sort(
        (a, b) => a.date.localeCompare(b.date)
    );
}
