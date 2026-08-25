// Home / "Inicio": resumen diario del supervisor. Vista de agregacion que
// reune modulos ya existentes (dotacion, ausencias, cambios, cobertura,
// mensajes). Este primer incremento cablea el saludo, la fecha, el nombre del
// supervisor (pie de firma) y la unidad; el resto de los widgets se muestran con
// datos de ejemplo y se cablearan a su modulo en los siguientes pasos.
//
// IMPORTANTE: todas las clases van con prefijo "hm-" para no colisionar con el
// CSS global del app (que ya usa .panel, .list, .count, .stat, etc.).

import { escapeHTML } from "./htmlUtils.js";
import { getCurrentFirebaseUser } from "./firebaseClient.js";
import { isWorkspaceOwner } from "./workspacePermissions.js";
import {
    getAdminDisplayName,
    getReportSignatureConfig,
    getProfiles,
    isProfileActive,
    isNoCoverageDay,
    getShiftAssigned,
    getWorkerRequests
} from "./storage.js";
import { getJSON } from "./persistence.js";
import { keyFromDate, keyFromISO, isoFromKey } from "./dateUtils.js";
import { getTurnoBase, getTurnoReal } from "./turnEngine.js";
import {
    requiereReemplazoTurnoBase,
    getAbsenceType,
    esAusenciaInjustificada
} from "./rulesEngine.js";
import {
    cancelPreassignment,
    confirmPreassignment,
    getReplacementForCoveredShift,
    buildPendingRequestIndex,
    getPendingRequestsFromIndex
} from "./replacements.js";
import {
    getPreassignmentForCoveredShift,
    getPreassignments
} from "./preassignments.js";
import { refreshAll } from "./refresh.js";
import { updateDayCell, updateVisibleCalendarDays } from "./calendar.js";
import { updateTimelineCells } from "./timeline.js";
import { birthDateParts } from "./staffing.js";
import {
    cambiosDelMes,
    cambioEstaAnulado,
    deshacerCambioTurno,
    swapCodeLabel
} from "./swaps.js";
import { TURNO_LABEL, ESTAMENTO, TURNO } from "./constants.js";
import {
    getHomeTasks,
    saveHomeTasks,
    deleteHomeTask,
    isTaskActiveOn,
    isTaskDoneOn,
    toggleTaskDone
} from "./homeTasks.js";
import {
    acceptWorkerRequestById,
    rejectWorkerRequestById
} from "./workerRequests.js";
import { fetchHolidays, getCachedHolidays } from "./holidays.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    addDays as addScheduleDays,
    publishedWeeksOfMonth,
    weekAttachment,
    weekHeading,
    weekNeedsImage,
    weekStartMonday,
    weeklyScheduleBody
} from "./weeklySchedulePreview.js";
import { openAttachmentFile } from "./attachmentUtils.js";
import { openScheduleAttachmentDialog } from "./taskAssignments.js";
import {
    ATTENDANCE_INCIDENT_KINDS,
    buildAttendanceIncidents
} from "./hoursReport.js";

// Nombre por defecto para entornos que aun no tienen "Nombre del supervisor"
// cargado al crearse (entornos de prueba previos al requerimiento).
const SUPERVISOR_FALLBACK = "Cristian Morales";

const DIAS = [
    "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"
];
const MESES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

// Las tareas se leen/guardan por usuario en Firestore (ver homeTasks.js).
const REPEAT_OPTS = [
    "Una sola vez", "Diario", "Diario Hábil", "Semanal", "Mensual",
    "Trimestral", "Cuatrimestral", "Anual"
];
const ALERT_OPTS = [
    "Sin alerta", "Al momento", "5 minutos antes", "15 minutos antes", "30 minutos antes", "1 hora antes"
];
const REQUEST_LEAVE_TYPES = new Set([
    "",
    "admin",
    "half_admin_morning",
    "half_admin_afternoon",
    "legal",
    "comp",
    "union_leave",
    "unpaid_leave",
    "leave_cancel"
]);
const REQUEST_CLOCK_TYPES = new Set(["missing_clock", "clock_incident"]);
const REQUEST_TYPE_LABELS = {
    admin: "P. Administrativo",
    half_admin_morning: "1/2 ADM Mañana",
    half_admin_afternoon: "1/2 ADM Tarde",
    legal: "F. Legal",
    comp: "F. Compensatorio",
    union_leave: "Permiso Gremial",
    unpaid_leave: "Permiso sin Goce",
    leave_cancel: "Anulación de permiso",
    missing_clock: "Olvido de marcación",
    clock_incident: "Incidencia de marcaje",
    swap: "Cambio de turno",
    unknown: "Solicitud"
};
let editingTaskId = "";

function optionsHTML(opts, selected) {
    return opts.map(o => `<option ${o === selected ? "selected" : ""}>${esc(o)}</option>`).join("");
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Mes visible en la tarjeta de cumpleaños. Arranca en el actual y se mueve con
// las flechas; se conserva entre repintados del panel.
let birthdayYear = new Date().getFullYear();
let birthdayMonth = new Date().getMonth();

// Semana visible en el visor de programacion. Arranca en la de hoy.
let weeklyScheduleWeek = weekStartMonday(new Date());

// Calendario organizativo de tareas (se abre desde la fecha del encabezado).
let taskCalYear = new Date().getFullYear();
let taskCalMonth = new Date().getMonth();

let coverageDetail = false;
let requestsDetail = false;
// Datos de cobertura calculados una vez por render (para no recalcular al
// alternar el switch de detalles).
let coverageData = { uncovered: [], preassigned: [] };

// Nombre para el saludo del inicio.
//
// Antes devolvia SIEMPRE la firma del supervisor, asi que un administrador
// invitado entraba y veia el nombre de otra persona. Ahora cada usuario ve el
// suyo: primero el nombre que el supervisor le puso en Ajustes, despues el de
// su propia cuenta, y solo el dueño de la unidad cae en la firma.
function getSupervisorName() {
    const user = getCurrentFirebaseUser();
    const asignado = getAdminDisplayName(user?.email);

    if (asignado) return asignado;

    if (!isWorkspaceOwner() && user) {
        const propio = String(user.displayName || "").trim();

        if (propio) return propio;
    }

    const line = String(getReportSignatureConfig().lines?.[0] || "").trim();

    return line || SUPERVISOR_FALLBACK;
}

function getUnitName() {
    return String(getActiveWorkspace()?.name || "tu unidad").trim() || "tu unidad";
}

// ---- Ausencias del día (datos reales) ----
// Categorias en orden de despliegue. tone e icon se resuelven en ausenciasWidget.
const ABSENCE_CATS = [
    { key: "legal", label: "Feriado Legal", tone: "crit", icon: "sun" },
    { key: "comp", label: "F. Compensatorio", tone: "good", icon: "palm" },
    { key: "admin", label: "P. Administrativo", tone: "info", icon: "file" },
    { key: "license", label: "Licencia Médica", tone: "info", icon: "file" },
    { key: "professional_license", label: "L.M. Profesional", tone: "info", icon: "file" },
    { key: "union_leave", label: "Permiso Gremial", tone: "good", icon: "palm" },
    { key: "unpaid_leave", label: "Permiso sin Goce", tone: "warn", icon: "file" },
    { key: "unjustified_absence", label: "Ausencia Injustificada", tone: "crit", icon: "alertTri" }
];

function profileMap(prefix, name) {
    return getJSON(`${prefix}_${name}`, {});
}

// Clasifica la ausencia de un perfil en un dia a una de las categorias, o "".
function classifyAbsence(name, keyDay) {
    if (profileMap("legal", name)[keyDay]) return "legal";
    if (profileMap("comp", name)[keyDay]) return "comp";
    if (profileMap("admin", name)[keyDay]) return "admin";

    const absence = profileMap("absences", name)[keyDay];
    if (!absence) return "";

    const type = getAbsenceType(absence);
    if (type === "professional_license") return "professional_license";
    if (type === "union_leave") return "union_leave";
    if (type === "unpaid_leave") return "unpaid_leave";
    if (type === "unjustified_absence" || esAusenciaInjustificada(absence)) {
        return "unjustified_absence";
    }
    return "license";
}

// Un turno queda "sin cubrir": el turno base requiere reemplazo por la ausencia
// y no hay reemplazo activo, ni preasignacion, ni marca "no requiere cobertura".
// Misma logica que el badge "!" del calendario.
function isShiftUncovered(name, keyDay) {
    const admin = profileMap("admin", name);
    const legal = profileMap("legal", name);
    const comp = profileMap("comp", name);
    const absences = profileMap("absences", name);

    // Corto-circuito barato: sin ausencia ese dia no hay nada que cubrir.
    if (!admin[keyDay] && !legal[keyDay] && !comp[keyDay] && !absences[keyDay]) {
        return false;
    }

    const requires = requiereReemplazoTurnoBase(
        keyDay,
        getTurnoBase(name, keyDay),
        admin,
        legal,
        comp,
        absences
    );
    if (!requires) return false;

    return (
        !getReplacementForCoveredShift(name, keyDay) &&
        !getPreassignmentForCoveredShift(name, keyDay) &&
        !isNoCoverageDay(name, keyDay)
    );
}

function getTodayAbsences() {
    const keyDay = keyFromDate(new Date());
    const counts = {};

    getProfiles().forEach(profile => {
        if (!isProfileActive(profile)) return;

        const name = profile.name;
        const cat = classifyAbsence(name, keyDay);
        if (!cat) return;

        if (!counts[cat]) counts[cat] = { total: 0, uncovered: 0 };
        counts[cat].total += 1;
        if (isShiftUncovered(name, keyDay)) counts[cat].uncovered += 1;
    });

    return ABSENCE_CATS
        .filter(cat => counts[cat.key])
        .map(cat => ({ ...cat, ...counts[cat.key] }));
}

function getTodayAbsenceDetails(categoryKey) {
    const today = new Date();
    const keyDay = keyFromDate(today);
    const iso = isoFromKey(keyDay);
    const category = ABSENCE_CATS.find(cat => cat.key === categoryKey);

    if (!category) {
        return { category: null, rows: [], keyDay, iso, dateLabel: shortDateFromDate(today) };
    }

    const rows = getProfiles()
        .filter(isProfileActive)
        .map(profile => {
            const name = profile.name;
            if (classifyAbsence(name, keyDay) !== categoryKey) return null;

            const turno = Number(getTurnoBase(name, keyDay));
            const meta = [profile.estamento, profile.profession]
                .filter(Boolean)
                .join(" · ");
            const uncovered = isShiftUncovered(name, keyDay);

            return {
                name,
                meta: meta || "Sin estamento",
                keyDay,
                iso,
                dateLabel: shortDateFromDate(today),
                absenceLabel: absenceLabelForDay(name, keyDay) || category.label,
                turnoLabel: turno > 0 ? (TURNO_LABEL[turno] || "Turno") : "Libre",
                turnoClass: turnoCssClass(turno),
                uncovered
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, "es"));

    return { category, rows, keyDay, iso, dateLabel: shortDateFromDate(today) };
}

// ---- Cambios de turno (datos reales) ----
const MESES_ABR = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
];
const DIAS_ABR = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function formatShortDate(iso) {
    const parts = String(iso || "").split("-");
    if (parts.length !== 3) return String(iso || "");
    const day = Number(parts[2]);
    const monthIndex = Number(parts[1]) - 1;
    return `${day} ${MESES_ABR[monthIndex] || ""}`.trim();
}

function formatSwapDetailDate(iso) {
    const parts = String(iso || "").split("-");

    if (parts.length !== 3) return String(iso || "");

    const day = Number(parts[2]);
    const monthIndex = Number(parts[1]) - 1;
    const year = Number(parts[0]);

    return [day, MESES_ABR[monthIndex], year]
        .filter(Boolean)
        .join(" ");
}

function shortName(full) {
    return String(full || "").split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
}

function homeSwapTurnLabel(turno) {
    const numeric = Number(turno);

    return TURNO_LABEL[numeric] || swapCodeLabel(turno);
}

// Cambios de turno activos del mes en curso.
function getMonthSwaps() {
    const now = new Date();
    return cambiosDelMes(now.getFullYear(), now.getMonth())
        .filter(swap => !cambioEstaAnulado(swap));
}

// ---- Dotación en servicio hoy, por estamento (datos reales) ----
// Un perfil está "en servicio hoy" si tiene turno real (> Libre) y no está de
// ausencia/permiso hoy. Los reemplazos ya vienen incluidos en getTurnoReal.
// ---- Horario (entrada/salida) por trabajador en servicio hoy ----
function pad2(n) { return String(n).padStart(2, "0"); }
function hm(h, m = 0) { return `${pad2(h)}:${pad2(m)}`; }

// Horario estándar según el turno del día. El fin del Diurno depende del día
// (viernes 16:00, resto 17:00). Devuelve { dia, noche } con etiquetas o null.
function standardSchedule(base, date) {
    const diurnoEnd = date.getDay() === 5 ? 16 : 17;
    switch (base) {
        case TURNO.LARGA:        return { dia: "08:00 a 20:00", noche: null };
        case TURNO.NOCHE:        return { dia: null, noche: "20:00 a 08:00" };
        case TURNO.TURNO24:      return { dia: "08:00 a 20:00", noche: "20:00 a 08:00" };
        case TURNO.DIURNO:       return { dia: `08:00 a ${hm(diurnoEnd)}`, noche: null };
        case TURNO.DIURNO_NOCHE: return { dia: `08:00 a ${hm(diurnoEnd)}`, noche: "20:00 a 08:00" };
        case TURNO.MEDIA_MANANA: return { dia: "08:00 a 14:00", noche: null };
        case TURNO.MEDIA_TARDE:  return { dia: "14:00 a 20:00", noche: null };
        case TURNO.TURNO18:      return { dia: "14:00 a 20:00", noche: "20:00 a 08:00" };
        default:                 return { dia: null, noche: null };
    }
}

// Horario con 1/2 ADM (permiso parcial administrativo), según reglas de RRHH:
// - 1/2 ADM Mañana (0.5M): el trabajador entra más tarde y trabaja la tarde.
//     · con asignación de turno: 14:00 a 20:00.
//     · sin asignación: entra 12:30 (viernes 12:00); sale 20:00 si es Larga,
//       o 17:00 (viernes 16:00) si es Diurno.
// - 1/2 ADM Tarde (0.5T): trabaja la mañana y se retira antes.
//     · con asignación de turno: 08:00 a 14:00.
//     · sin asignación: 08:00 a 12:30.
function halfAdminSchedule(base, half, date, assigned) {
    const friday = date.getDay() === 5;

    if (half === "0.5M") {
        if (assigned) return { dia: "14:00 a 20:00", noche: null };
        const entry = friday ? "12:00" : "12:30";
        const exit = base === TURNO.LARGA
            ? "20:00"
            : (friday ? "16:00" : "17:00");
        return { dia: `${entry} a ${exit}`, noche: null };
    }

    // 0.5T
    if (assigned) return { dia: "08:00 a 14:00", noche: null };
    return { dia: "08:00 a 12:30", noche: null };
}

// Horario real de un trabajador hoy, o null si no está en servicio (libre o con
// ausencia/permiso completo). El 1/2 ADM se considera media jornada trabajada.
function serviceScheduleToday(profile, keyDay, date) {
    const name = profile.name;

    if (profileMap("legal", name)[keyDay]) return null;
    if (profileMap("comp", name)[keyDay]) return null;
    if (profileMap("absences", name)[keyDay]) return null;

    const adminVal = profileMap("admin", name)[keyDay];
    const half = (adminVal === "0.5M" || adminVal === "0.5T") ? adminVal : null;
    if (adminVal && !half) return null; // administrativo completo → libre

    const base = Number(getTurnoReal(name, keyDay));
    if (base <= 0) return null;

    const sched = half
        ? halfAdminSchedule(base, half, date, getShiftAssigned(name))
        : standardSchedule(base, date);

    return (sched.dia || sched.noche) ? sched : null;
}

// Detalle de dotación por estamento: listas de trabajadores de día y de noche
// (con su horario). Un mismo trabajador puede aparecer en ambos (24h/D+N/18h).
function getDotacionDetalleHoy() {
    const now = new Date();
    const keyDay = keyFromDate(now);
    const byEstamento = {};

    getProfiles().forEach(profile => {
        if (!isProfileActive(profile)) return;
        const sched = serviceScheduleToday(profile, keyDay, now);
        if (!sched) return;

        const est = profile.estamento || "Otros";
        if (!byEstamento[est]) byEstamento[est] = { dia: [], noche: [] };
        if (sched.dia) byEstamento[est].dia.push({ name: profile.name, time: sched.dia });
        if (sched.noche) byEstamento[est].noche.push({ name: profile.name, time: sched.noche });
    });

    const canonicalOrder = est => {
        const index = ESTAMENTO.indexOf(est);
        return index === -1 ? ESTAMENTO.length : index;
    };
    const estamentos = Object.keys(byEstamento)
        .sort((a, b) => canonicalOrder(a) - canonicalOrder(b) || a.localeCompare(b));

    estamentos.forEach(est => {
        byEstamento[est].dia.sort((a, b) => a.name.localeCompare(b.name));
        byEstamento[est].noche.sort((a, b) => a.name.localeCompare(b.name));
    });

    return { byEstamento, estamentos };
}

// Conteos por estamento (día/noche) derivados del detalle, para las stat cards.
function getDotacionHoy() {
    const det = getDotacionDetalleHoy();
    const byEstamento = {};
    let total = 0;
    let dia = 0;
    let noche = 0;

    det.estamentos.forEach(est => {
        const e = det.byEstamento[est];
        byEstamento[est] = { dia: e.dia.length, noche: e.noche.length };
        dia += e.dia.length;
        noche += e.noche.length;
        const unique = new Set([
            ...e.dia.map(x => x.name),
            ...e.noche.map(x => x.name)
        ]);
        total += unique.size;
    });

    return { byEstamento, estamentos: det.estamentos, total, dia, noche };
}

// ---- Cobertura de turnos (datos reales) ----
const COVERAGE_WINDOW_DAYS = 14;   // ventana hacia adelante para turnos sin cubrir
const COVERAGE_MAX_ROWS = 8;

function shortDateFromDate(date) {
    return `${DIAS_ABR[date.getDay()]} ${date.getDate()} ${MESES_ABR[date.getMonth()]}`;
}

function shortDateFromISO(iso) {
    const parts = String(iso || "").split("-");
    if (parts.length !== 3) return String(iso || "");
    return shortDateFromDate(
        new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    );
}

function turnoCssClass(code) {
    switch (Number(code)) {
        case 1: return "larga";
        case 2: return "noche";
        case 3: return "noche";
        case 4: return "diurno";
        case 5: return "noche";
        case 6: return "media-m";
        case 7: return "media-t";
        case 8: return "noche";
        default: return "larga";
    }
}

function absenceLabelForDay(name, keyDay) {
    const cat = classifyAbsence(name, keyDay);
    return ABSENCE_CATS.find(c => c.key === cat)?.label || "";
}

// Colegas del mismo estamento (y profesion) libres ese dia y sin ausencia.
// Heuristica de disponibilidad (la compatibilidad fina de 24h/contrato vive en
// el modal de reemplazo del calendario).
function getAvailableCandidates(replacedProfile, keyDay) {
    const estamento = replacedProfile.estamento;
    const profession = replacedProfile.profession;

    return getProfiles()
        .filter(candidate =>
            isProfileActive(candidate) &&
            candidate.name !== replacedProfile.name &&
            candidate.estamento === estamento &&
            (!profession || candidate.profession === profession) &&
            Number(getTurnoReal(candidate.name, keyDay)) === 0 &&
            !classifyAbsence(candidate.name, keyDay)
        )
        .map(candidate => candidate.name);
}

function getUncoveredShifts() {
    const today = new Date();
    const profiles = getProfiles().filter(isProfileActive);
    const rows = [];
    // Una sola pasada para toda la ventana de cobertura.
    const pendingRequestIndex = buildPendingRequestIndex();

    for (let offset = 0; offset < COVERAGE_WINDOW_DAYS; offset++) {
        const date = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate() + offset
        );
        const keyDay = keyFromDate(date);

        for (const profile of profiles) {
            if (!isShiftUncovered(profile.name, keyDay)) continue;

            const turno = Number(getTurnoBase(profile.name, keyDay));
            rows.push({
                dateLabel: shortDateFromDate(date),
                turnoLabel: TURNO_LABEL[turno] || "Turno",
                turnoClass: turnoCssClass(turno),
                origin: profile.name,
                // Para "Ver en calendario" y "Cobertura automatica".
                keyDay,
                iso: isoFromKey(keyDay),
                reason: absenceLabelForDay(profile.name, keyDay),
                candidates: getAvailableCandidates(profile, keyDay).slice(0, 3),
                // Solicitudes ya enviadas a las PWA: el turno pasa de "sin
                // cubrir" a "en espera".
                pendingRequests: getPendingRequestsFromIndex(
                    pendingRequestIndex,
                    profile.name,
                    isoFromKey(keyDay)
                )
            });

            if (rows.length >= COVERAGE_MAX_ROWS) return rows;
        }
    }

    return rows;
}

function getPreassignedShifts() {
    return getPreassignments()
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map(record => ({
            dateLabel: shortDateFromISO(record.date),
            turnoLabel: TURNO_LABEL[Number(record.turno)] || "Turno",
            turnoClass: turnoCssClass(record.turno),
            id: record.id,
            origin: record.replaced,
            reason: record.absenceType || "",
            assigned: record.worker
        }));
}

function getCoverageData() {
    return {
        uncovered: getUncoveredShifts(),
        preassigned: getPreassignedShifts()
    };
}

function todayLabel() {
    const d = new Date();
    return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function esc(value) {
    return escapeHTML(String(value));
}

// ---- SVG helpers (stroke-based, al estilo de los iconos del app) ----
const IC = {
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    clipboard: '<path d="M9 5h6M9 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2M12 11v4M12 8h.01"/>',
    checkClip: '<path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="17" rx="2"/>',
    swap: '<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    bars: '<path d="M4 19V9M10 19V4M16 19v-6M20 19H2"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.17a2 2 0 1 1-4 0V21a1.7 1.7 0 0 0-1.4-1.6 1.7 1.7 0 0 0-1 .34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1H2.83a2 2 0 1 1 0-4H3a1.7 1.7 0 0 0 1.6-1.4 1.7 1.7 0 0 0-.34-1l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 4V2.83a2 2 0 1 1 4 0V3a1.7 1.7 0 0 0 1.6 1.4 1.7 1.7 0 0 0 1-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14.5h18M9 9v11M15 9v11"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2.8"/><path d="M10.6 4.7h2.8"/><rect x="7.4" y="6.7" width="9.2" height="10.2" rx="1"/><circle cx="12" cy="19.6" r="1.15"/>',
    cake: '<path d="M4 21h16v-7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3z"/><path d="M4 16c1.5 1 2.5 1 4 0s2.5-1 4 0 2.5 1 4 0 2.5-1 4 0"/><path d="M12 8V5M9 8V6M15 8V6"/>',
    palm: '<path d="M12 2a7 7 0 0 1 7 7c0 4-7 13-7 13S5 13 5 9a7 7 0 0 1 7-7z"/>',
    sun: '<path d="M17 8c0-3-2-5-5-5S7 5 7 8c0 6-3 8-3 8h16s-3-2-3-8"/><path d="M12 3V1"/>',
    file: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 8v6M9 11h6"/>',
    alertTri: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'
};

function svg(paths, extra = "") {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;
}

const DN_SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>`;
const DN_MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>`;

function statCard(tone, icon, label, value, sub) {
    return `
        <article class="hm-stat hm-stat--${tone}">
            <span class="hm-stat-icon">${svg(icon)}</span>
            <div class="hm-stat-label">${esc(label)}</div>
            <div class="hm-stat-value">${value}</div>
            <div class="hm-stat-sub">${esc(sub)}</div>
            <span class="hm-stat-go">${svg(IC.arrowRight, 'stroke-width="2.4"')}</span>
        </article>`;
}

// Tarjeta de dotación por estamento: muestra cuántos hay de día y de noche
// (sin total). Los turnos que cubren ambos periodos suman en los dos.
function dotacionCard(tone, label, dia, noche) {
    return `
        <article class="hm-stat hm-stat--${tone}" data-hm="dotacion" data-est="${esc(label)}" role="button" tabindex="0" title="Ver trabajadores en servicio">
            <span class="hm-stat-icon">${svg(IC.users)}</span>
            <div class="hm-stat-label">${esc(label)}</div>
            <div class="hm-dn2">
                <div class="hm-dn2-item">
                    <span class="hm-dn2-ico">${DN_SUN}</span>
                    <div class="hm-dn2-txt"><b>${dia}</b><small>de día</small></div>
                </div>
                <div class="hm-dn2-item">
                    <span class="hm-dn2-ico">${DN_MOON}</span>
                    <div class="hm-dn2-txt"><b>${noche}</b><small>de noche</small></div>
                </div>
            </div>
            <span class="hm-stat-go">${svg(IC.arrowRight, 'stroke-width="2.4"')}</span>
        </article>`;
}

/**
 * Semanas con programacion publicada: la actual y la siguiente.
 *
 * Devuelve solo las que tienen algo adjunto. Si la lista queda vacia no hay
 * nada que mostrar, y el widget no se dibuja.
 */
function programacionSemanas() {
    const estaSemana = weekStartMonday(new Date());

    return [
        { label: "Esta semana", start: estaSemana },
        { label: "Próxima semana", start: addScheduleDays(estaSemana, 7) }
    ]
        .map(semana => {
            const adjunto = weekAttachment(semana.start);

            return adjunto
                ? { label: semana.label, ...actualizacion(adjunto) }
                : null;
        })
        .filter(Boolean);
}

/**
 * Cuando se actualizo por ultima vez esa programacion. La fecha va en la
 * tarjeta y la hora exacta en el title, para no apretar la tarjeta.
 */
function actualizacion(adjunto) {
    const fecha = new Date(adjunto.updatedAtISO || adjunto.addedAt || "");

    if (Number.isNaN(fecha.getTime())) {
        return { fecha: "sin fecha", exacta: "Sin fecha de actualización" };
    }

    return {
        fecha: fecha.toLocaleDateString("es-CL", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }),
        exacta: `Actualizada el ${fecha.toLocaleString("es-CL", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        })}`
    };
}

/**
 * Widget de programacion semanal. Reemplaza al boton del encabezado y solo
 * aparece cuando hay alguna semana publicada: sin nada adjunto, un acceso que
 * lleva a una pantalla vacia solo estorba.
 */
function programacionWidget() {
    const semanas = programacionSemanas();

    if (!semanas.length) return "";

    return `
        <article class="hm-stat hm-stat--teal" data-hm="open-weekly" role="button"
            tabindex="0" title="Ver la programación semanal publicada">
            <span class="hm-stat-icon">${svg(IC.table)}</span>
            <div class="hm-stat-label">Programación semanal</div>
            <div class="hm-weeks">
                ${semanas.map(semana => `
                    <div class="hm-week" title="${esc(semana.exacta)}">
                        <b>${esc(semana.label)}</b>
                        <small>${esc(semana.fecha)}</small>
                    </div>`).join("")}
            </div>
            <span class="hm-stat-go">${svg(IC.arrowRight, 'stroke-width="2.4"')}</span>
        </article>`;
}

/**
 * Recordatorios de RRHH que rotan en el inicio.
 *
 * Son las reglas que mas se preguntan y que no estan a la vista en ninguna
 * pantalla: el orden de FC y FL, en que dias se puede pedir cada permiso, y a
 * que hora entra quien pide medio administrativo.
 */
const NOTAS_RRHH = [
    "💡 Recuerda: el orden recomendado es FC primero y luego FL.",
    "⏳ Si solicitas FL primero, deberán pasar 90 días desde el último FL para poder solicitar FC.",
    "⏰ Los atrasos solo se miden en los turnos base, no en los turnos extra.",
    "🚫 Si un funcionario solicita un PA, no puede hacer ningún turno ese día, ni siquiera noche.",
    "📅 Los funcionarios sin asignación de turno no pueden solicitar PA en días inhábiles.",
    "📦 Los FC se pueden acumular por razones de buen servicio.",
    "🗓️ Si acumulas los FC, deberás tomar el bloque completo al año siguiente: los 20 días continuos.",
    "🔟 Cada año hay que reservar un bloque de 10 FL continuos; el resto se puede parcializar.",
    "❌ No se puede pedir un FL en un día inhábil.",
    "▶️ Los FL y los FC deben comenzar siempre en un día hábil.",
    "✅ Los PA sí pueden pedirse en días inhábiles, siempre que el funcionario tenga asignación de turno.",
    "🕛 Los 1/2 PA de mañana permiten que el funcionario ingrese a la mitad de su jornada.",
    "🕧 Un funcionario diurno que pide 1/2 PA mañana marca su entrada a las 12:30 (12:00 los viernes).",
    "🕑 Un funcionario de turno que pide 1/2 PA mañana marca su entrada a las 14:00."
];

// Lo justo para leer la nota mas larga sin quedarse esperando la siguiente.
const NOTA_MS = 6000;

// El ciclo vive fuera del render: cada repintado reemplaza el panel entero, y
// un intervalo del render anterior se quedaria escribiendo en nodos ya sueltos.
let notasTimer = null;

/**
 * Arranca la rotacion de notas. Se detiene con el mouse encima, para poder
 * terminar de leer una nota larga sin que se escape.
 */
function iniciarNotas(panel) {
    if (notasTimer) {
        clearInterval(notasTimer);
        notasTimer = null;
    }

    const tarjeta = panel.querySelector('[data-hm="notas"]');
    const texto = tarjeta?.querySelector('[data-hm="nota"]');

    if (!tarjeta || !texto) return;

    let detenido = false;

    tarjeta.addEventListener("mouseenter", () => { detenido = true; });
    tarjeta.addEventListener("mouseleave", () => { detenido = false; });

    notasTimer = setInterval(() => {
        if (detenido || !texto.isConnected) return;

        const siguiente =
            (Number(tarjeta.dataset.index) + 1) % NOTAS_RRHH.length;

        tarjeta.dataset.index = String(siguiente);
        texto.classList.add("is-fading");

        window.setTimeout(() => {
            texto.textContent = NOTAS_RRHH[siguiente];
            texto.classList.remove("is-fading");
        }, 200);
    }, NOTA_MS);
}

function notasWidget() {
    // Arranca en una nota al azar: entrando y saliendo del inicio, empezar
    // siempre por la primera haria que las ultimas no se vieran nunca.
    const inicio = Math.floor(Math.random() * NOTAS_RRHH.length);

    return `
        <article class="hm-stat hm-stat--indigo hm-notas" data-hm="notas"
            data-index="${inicio}" title="Pasa el mouse para que no cambie">
            <span class="hm-stat-icon">${svg(IC.megaphone)}</span>
            <div class="hm-stat-label">¿Sabías que...?</div>
            <p class="hm-nota" data-hm="nota">${esc(NOTAS_RRHH[inicio])}</p>
        </article>`;
}

// Stat cards: una tarjeta por estamento en servicio hoy (colores en ciclo),
// y al final la programacion semanal si esta publicada.
function statsSection() {
    const dot = getDotacionHoy();
    const tones = ["violet", "blue", "green", "amber"];
    const dotacion = dot.estamentos.length
        ? dot.estamentos.map((est, i) => {
            const e = dot.byEstamento[est];
            return dotacionCard(tones[i % tones.length], est, e.dia, e.noche);
        }).join("")
        : statCard("violet", IC.users, "En servicio hoy", 0, "sin dotación hoy");

    return dotacion + programacionWidget() + notasWidget();
}

function panelHead(icon, title, extra = "") {
    return `
        <div class="hm-head">
            <span class="hm-head-icon">${svg(icon)}</span>
            <h3>${title}</h3>
            ${extra}
        </div>`;
}

// ---- Widgets ----
function taskRowHTML(t) {
    const done = isTaskDoneOn(t, todayISO());
    return `
        <div class="hm-task ${done ? "is-done" : ""}" data-hm="task-row" data-id="${esc(t.id)}" role="button" tabindex="0" title="Modificar tarea">
            <button class="hm-task-check" type="button" data-hm="task-toggle" data-id="${esc(t.id)}" aria-pressed="${done ? "true" : "false"}" aria-label="Marcar como realizada">${svg(IC.check, 'stroke-width="3"')}</button>
            <span class="hm-task-name">${esc(t.name)}</span>
            <span class="hm-task-time">${esc(t.time)}</span>
        </div>`;
}

function tasksListHTML() {
    // Solo las de HOY: una tarea programada para el 27 no tiene nada que hacer
    // en el resumen del 20. Se filtra con la misma regla que usan el calendario
    // y las alertas, no con una comparacion propia.
    const tasks = getTasksForDay(new Date());

    if (!tasks.length) {
        return `<div class="hm-empty">Sin tareas para hoy. Agrégalas con el botón + o revisa el calendario.</div>`;
    }

    return tasks.map(taskRowHTML).join("");
}

function tareasWidget() {
    const addBtn = `<button class="hm-gear" type="button" data-hm="tasks-add" aria-label="Agregar tarea" title="Agregar tarea">${svg(IC.plus, 'stroke-width="2.4"')}</button>`;
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(IC.checkClip, "Tareas diarias", addBtn)}
            <div class="hm-listcol hm-tasks-list hm-scroller" data-hm="tasks-list">${tasksListHTML()}</div>
        </div>`;
}

function requestTypeLabel(type) {
    return REQUEST_TYPE_LABELS[type] || REQUEST_TYPE_LABELS.unknown;
}

function requestSummaryGroup(request = {}) {
    const type = String(request.type || "");

    if (REQUEST_LEAVE_TYPES.has(type)) return "leave";
    if (type === "swap") return "swap";
    if (REQUEST_CLOCK_TYPES.has(type)) return "clock";

    return "";
}

export function buildRequestSummary(requests = getWorkerRequests()) {
    const summary = {
        leave: [],
        swap: [],
        clock: [],
        total: 0,
        pending: []
    };

    (Array.isArray(requests) ? requests : []).forEach(request => {
        if (request?.status !== "pending") return;

        const group = requestSummaryGroup(request);
        if (!group) return;

        summary[group].push(request);
        summary.pending.push({ ...request, group });
    });

    summary.pending.sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );
    summary.total = summary.pending.length;

    return summary;
}

function requestPrimaryDate(request = {}) {
    return (
        request.date ||
        request.changeDate ||
        request.fecha ||
        request.startDate ||
        request.returnDate ||
        request.devolucion ||
        ""
    );
}

function requestSummaryDateLabel(request = {}) {
    const iso = requestPrimaryDate(request);

    return iso ? shortDateFromISO(iso) : "Sin fecha";
}

function requestDocumentCount(request = {}) {
    const documents = Array.isArray(request.documents)
        ? request.documents
        : Array.isArray(request.attachments)
            ? request.attachments
            : [];

    return documents.length;
}

function requestSummaryMeta(request = {}) {
    const pieces = [];
    const date = requestPrimaryDate(request);

    if (date) pieces.push(`Fecha: ${shortDateFromISO(date)}`);
    if (request.endDate && request.endDate !== date) {
        pieces.push(`Hasta: ${shortDateFromISO(request.endDate)}`);
    }
    if (request.days) pieces.push(`${request.days} día(s)`);

    if (request.type === "swap") {
        const counterpart =
            request.to ||
            request.targetProfile ||
            request.counterpart ||
            request.receiver ||
            "";
        const returnDate =
            request.devolucion ||
            request.returnDate ||
            request.endDate ||
            "";

        if (counterpart) pieces.push(`Con: ${counterpart}`);
        if (returnDate) pieces.push(`Devuelve: ${shortDateFromISO(returnDate)}`);
    }

    if (REQUEST_CLOCK_TYPES.has(String(request.type || ""))) {
        const docs = requestDocumentCount(request);

        if (docs) pieces.push(`${docs} adjunto(s)`);
    }

    return pieces.join(" · ");
}

function requestSummaryChipHTML(tone, icon, count, label) {
    return `
        <div class="hm-req-chip hm-req-chip--${tone}">
            <span class="hm-req-chip-ico">${svg(icon)}</span>
            <span>
                <span class="hm-req-chip-num">${count}</span>
                <span class="hm-req-chip-lbl">${label}</span>
            </span>
        </div>`;
}

function requestSummaryRowHTML(request) {
    const groupLabel = request.group === "leave"
        ? "Permiso"
        : request.group === "swap"
            ? "Cambio"
            : "Marcaje";
    const meta = requestSummaryMeta(request);

    return `
        <div class="hm-req-row hm-req-row--${esc(request.group)}" data-request-id="${esc(request.id || "")}">
            <div class="hm-req-top">
                <span class="hm-req-type">${esc(groupLabel)}</span>
                <span class="hm-req-worker">${esc(request.profile || "Sin trabajador")}</span>
                <span class="hm-req-date">${esc(requestSummaryDateLabel(request))}</span>
            </div>
            <div class="hm-req-meta">
                <b>${esc(requestTypeLabel(request.type))}</b>${meta ? ` · ${esc(meta)}` : ""}
            </div>
            <div class="hm-cob-actions hm-req-row-actions">
                <button class="hm-cob-btn hm-cob-btn--confirm" type="button"
                    data-hm="req-accept" data-request-id="${esc(request.id || "")}">ACEPTAR</button>
                <button class="hm-cob-btn hm-cob-btn--cancel" type="button"
                    data-hm="req-reject" data-request-id="${esc(request.id || "")}">RECHAZAR</button>
            </div>
        </div>`;
}

function solicitudesWidget() {
    const summary = buildRequestSummary();
    const list = summary.pending.length
        ? summary.pending.map(requestSummaryRowHTML).join("")
        : `<div class="hm-empty">Sin solicitudes pendientes.</div>`;

    return `
        <div class="hm-card hm-col-4">
            ${panelHead(
                IC.megaphone,
                "Resumen de solicitudes",
                `<label class="hm-toggle hm-head-toggle"><input type="checkbox" data-hm="req-detail" ${requestsDetail ? "checked" : ""}> Ver detalles</label>
                <span class="hm-count">${summary.total}</span>`
            )}
            <div class="hm-req-summary" ${requestsDetail ? "hidden" : ""}>
                ${requestSummaryChipHTML("leave", IC.file, summary.leave.length, "Vacaciones / permisos")}
                ${requestSummaryChipHTML("swap", IC.swap, summary.swap.length, "Cambios de turno")}
                ${requestSummaryChipHTML("clock", IC.clock, summary.clock.length, "Incidencias marcaje")}
            </div>
            <div class="hm-req-list hm-scroller" ${requestsDetail ? "" : "hidden"}>
                ${list}
                <div class="hm-req-actions">
                    <button class="hm-cob-btn hm-cob-btn--ver" type="button" data-hm="req-open">REVISAR SOLICITUDES</button>
                </div>
            </div>
        </div>`;
}

/* =========================================================
   Calendario organizativo de tareas

   Se abre al hacer click en la fecha del encabezado ("Hoy es ..."). Pinta el mes
   con las tareas que caen en cada dia segun su recurrencia, usando la MISMA
   regla que dispara las alertas (isTaskActiveOn), para que el calendario y el
   aviso sonoro nunca digan cosas distintas.

   En una casilla no caben todas las tareas de un dia: se muestran las primeras
   y el resto queda como "+N mas". Al abrir el dia se ve el listado completo.
========================================================= */

// Cuantas tareas alcanzan a mostrarse dentro de una casilla.
const TASKS_PER_CELL = 3;

// La semana parte el lunes.
const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function getTasksForDay(date, tasks = getHomeTasks(), holidays) {
    return tasks
        .filter(task => isTaskActiveOn(task, date, holidays))
        .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

// Las casillas del mes, con los blancos iniciales para que el dia 1 caiga en su
// columna. null = casilla vacia antes del dia 1.
export function buildTaskCalendarCells(
    year,
    month,
    tasks = getHomeTasks(),
    holidays = getCachedHolidays(year)
) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // getDay() da 0 en domingo; con la semana en lunes, domingo es la columna 6.
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const cells = new Array(lead).fill(null);

    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day);

        cells.push({
            day,
            iso: isoFromDate(date),
            tasks: getTasksForDay(date, tasks, holidays)
        });
    }

    return cells;
}

function isoFromDate(date) {
    return `${date.getFullYear()}` +
        `-${String(date.getMonth() + 1).padStart(2, "0")}` +
        `-${String(date.getDate()).padStart(2, "0")}`;
}

function dateLabelFromISO(iso) {
    const [year, month, day] = String(iso).split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return `${DIAS[date.getDay()]}, ${day} de ${MESES[month - 1]} de ${year}`;
}

function taskChipHTML(task, iso) {
    const done = isTaskDoneOn(task, iso);

    return `
        <span class="hm-tc-chip ${done ? "is-done" : ""}" title="${esc(`${task.time} · ${task.name}`)}">
            <b>${esc(task.time)}</b>${esc(task.name)}
        </span>`;
}

function taskCalendarCellHTML(cell, todayIso) {
    if (!cell) return `<div class="hm-tc-cell hm-tc-cell--blank"></div>`;

    const isToday = cell.iso === todayIso;
    const extra = cell.tasks.length - TASKS_PER_CELL;
    // Todos los dias reales se pueden abrir: aunque no tengan tareas, desde el
    // listado del dia se pueden crear nuevas con el boton +.
    const clickable = true;
    const attrs = ` role="button" tabindex="0" data-hm="taskcal-day" data-iso="${esc(cell.iso)}"` +
        ` title="Abrir tareas del día"`;

    return `
        <div class="hm-tc-cell ${isToday ? "is-today" : ""} ${clickable ? "is-clickable" : ""}"${attrs}>
            <span class="hm-tc-day">${cell.day}</span>
            <div class="hm-tc-chips">
                ${cell.tasks.slice(0, TASKS_PER_CELL).map(task => taskChipHTML(task, cell.iso)).join("")}
                ${extra > 0 ? `<span class="hm-tc-more">+${extra} más</span>` : ""}
            </div>
        </div>`;
}

function taskCalendarBody() {
    const cells = buildTaskCalendarCells(taskCalYear, taskCalMonth);
    const todayIso = todayISO();
    const total = cells.reduce(
        (sum, cell) => sum + (cell ? cell.tasks.length : 0),
        0
    );

    return {
        heading: `${MESES[taskCalMonth]} ${taskCalYear}`,
        total,
        grid: `
            ${DIAS_SEMANA.map(day => `<div class="hm-tc-dow">${day}</div>`).join("")}
            ${cells.map(cell => taskCalendarCellHTML(cell, todayIso)).join("")}`
    };
}

function taskCalendarModal() {
    const { heading, total, grid } = taskCalendarBody();

    return `
        <div class="hm-modal-backdrop" data-hm="taskcal-modal" hidden>
            <div class="hm-modal hm-modal--taskcal" role="dialog" aria-modal="true" aria-label="Calendario de tareas">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.calendar)}</span>
                    <h3>Calendario de tareas · <span data-hm="tc-month">${esc(heading)}</span></h3>
                    <div class="hm-bday-nav">
                        <button type="button" data-hm="tc-prev" aria-label="Mes anterior">&#8249;</button>
                        <button type="button" data-hm="tc-next" aria-label="Mes siguiente">&#8250;</button>
                    </div>
                    <span class="hm-count" data-hm="tc-count">${total}</span>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body">
                    <div class="hm-tc-grid" data-hm="tc-grid">${grid}</div>
                </div>
            </div>
        </div>`;
}

// Segundo modal: el listado completo de un dia, para cuando las tareas no caben
// en la casilla.
function dayTasksModal() {
    return `
        <div class="hm-modal-backdrop hm-modal-backdrop--over" data-hm="dayTasks-modal" hidden>
            <div class="hm-modal" role="dialog" aria-modal="true" aria-label="Tareas del día">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.checkClip)}</span>
                    <h3 data-hm="dt-title">Tareas del día</h3>
                    <button class="hm-modal-action" type="button" data-hm="dt-add"
                        aria-label="Agregar tarea" title="Agregar tarea">${svg(IC.plus, 'stroke-width="2.4"')}</button>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body" data-hm="dt-body"></div>
            </div>
        </div>`;
}

function dayTaskRowHTML(task, iso) {
    const done = isTaskDoneOn(task, iso);

    return `
        <div class="hm-dt-row ${done ? "is-done" : ""}" data-hm="dt-row" data-id="${esc(task.id)}"
            role="button" tabindex="0" title="Modificar tarea">
            <button class="hm-task-check" type="button" data-hm="dt-toggle" data-id="${esc(task.id)}"
                aria-pressed="${done ? "true" : "false"}" aria-label="Marcar como realizada">${svg(IC.check, 'stroke-width="3"')}</button>
            <span class="hm-dt-time">${esc(task.time)}</span>
            <span class="hm-dt-name">${esc(task.name)}</span>
            <span class="hm-dt-repeat">${esc(task.repeat)}</span>
        </div>`;
}

// El dia abierto en el listado. Al modificar o marcar una tarea hay que
// repintarlo, y el modal no guarda su propia fecha.
let openDayIso = "";

function renderDayTasks(panel) {
    const modal = panel.querySelector('[data-hm="dayTasks-modal"]');
    if (!modal || !openDayIso) return;

    const iso = openDayIso;
    const [year, month, day] = String(iso).split("-").map(Number);
    const tasks = getTasksForDay(new Date(year, month - 1, day));

    modal.querySelector('[data-hm="dt-title"]').textContent = dateLabelFromISO(iso);
    modal.querySelector('[data-hm="dt-body"]').innerHTML = tasks.length
        ? `<div class="hm-dt-list">${tasks.map(task => dayTaskRowHTML(task, iso)).join("")}</div>`
        : `<div class="hm-empty">Sin tareas para este día.</div>`;
}

function openDayTasks(panel, iso) {
    const modal = panel.querySelector('[data-hm="dayTasks-modal"]');
    if (!modal) return;

    openDayIso = iso;
    renderDayTasks(panel);
    modal.hidden = false;
}

// "Diario Hábil" depende de los feriados del año que se esta mirando, y la
// primera vez vienen de red. Se pinta con lo que haya en cache y se repinta al
// llegar, en vez de dejar el calendario esperando.
async function ensureHolidaysLoaded(year, onReady) {
    if (Object.keys(getCachedHolidays(year)).length) return;

    try {
        await fetchHolidays(year);
        onReady();
    } catch (error) {
        console.warn("No se pudieron cargar los feriados del calendario.", error);
    }
}

function reRenderTaskCalendar(panel) {
    const { heading, total, grid } = taskCalendarBody();
    const month = panel.querySelector('[data-hm="tc-month"]');
    const count = panel.querySelector('[data-hm="tc-count"]');
    const host = panel.querySelector('[data-hm="tc-grid"]');

    if (month) month.textContent = heading;
    if (count) count.textContent = total;
    if (host) host.innerHTML = grid;
}

/* =========================================================
   Incidencias de marcaje del mes
========================================================= */

// Mes que se esta mirando y lo ultimo calculado. Recorrer el mes de todos los
// trabajadores toma del orden de 100 ms con una unidad completa, asi que no se
// rehace en cada repintado del inicio: se calcula una vez por mes y se guarda.
let incidenciasMes = new Date();
let incidenciasCache = null;
let incidenciasRequest = 0;

/**
 * Lo calculado deja de valer cuando cambian los datos de los que salio: las
 * marcas del reloj -que solo cambian al subir una planilla- y el marcaje
 * autorizado, que mueve la hora de ingreso y de salida.
 */
if (typeof window !== "undefined") {
    ["proturnos:attendanceMarksChanged", "proturnos:clockMarksChanged"]
        .forEach(evento => {
            window.addEventListener(evento, () => {
                incidenciasCache = null;

                const panel = document.getElementById("homePanel");

                if (panel && document.body.dataset.activeView === "home") {
                    void cargarIncidencias(panel);
                }
            });
        });
}

function incidenciasMesLabel(date) {
    const texto = date.toLocaleDateString("es-CL", {
        month: "long",
        year: "numeric"
    });

    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function incidenciasMesKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}`;
}

/**
 * El mes tal como va DENTRO del titulo ("Incidencias de marcaje de Agosto").
 *
 * Es la misma forma que usan los cumpleanos, y ahorra la fila que antes
 * repetia el mes debajo del encabezado. El año solo aparece cuando no es el
 * actual: navegando por el mes propio, repetirlo siempre es ruido.
 *
 * incidenciasMesLabel() sigue existiendo para el titulo del modal, donde el
 * mes va suelto y si necesita el año completo.
 */
function incidenciasMesTitulo(date) {
    const mes = MESES[date.getMonth()];

    return date.getFullYear() === new Date().getFullYear()
        ? mes
        : `${mes} ${date.getFullYear()}`;
}

function incidenciasWidget() {
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(
                IC.clipboard,
                `Incidencias de marcaje de <span data-hm="inc-month">${esc(incidenciasMesTitulo(incidenciasMes))}</span>`,
                `<div class="hm-bday-nav">
                    <button type="button" data-hm="inc-prev" aria-label="Mes anterior">&#8249;</button>
                    <button type="button" data-hm="inc-next" aria-label="Mes siguiente">&#8250;</button>
                </div>`
            )}
            <div class="hm-listcol" data-hm="inc-list">
                <div class="hm-empty">Revisando el mes...</div>
            </div>
        </div>`;
}

function incidenciasListHTML(totals) {
    const total = ATTENDANCE_INCIDENT_KINDS
        .reduce((suma, kind) => suma + (totals[kind.key] || 0), 0);

    if (!total) {
        return `<div class="hm-empty">Sin incidencias de marcaje este mes.</div>`;
    }

    // Se listan las cinco siempre, incluso en cero: ver un "0" al lado de "Sin
    // marcaje entrada" dice algo; que la fila desaparezca, no.
    return ATTENDANCE_INCIDENT_KINDS.map(kind => {
        const cantidad = totals[kind.key] || 0;

        return `
            <button class="hm-kv" type="button" data-hm="inc-kind"
                data-kind="${esc(kind.key)}" ${cantidad ? "" : "disabled"}>
                <span class="hm-kv-name">${esc(kind.label)}</span>
                <span class="hm-kv-right">
                    <span class="hm-kv-num ${cantidad ? "hm-amber" : ""}">${cantidad}</span>
                </span>
            </button>`;
    }).join("");
}

/**
 * Calcula las incidencias del mes en curso y pinta el recuadro.
 *
 * Va aparte del render porque tarda: el inicio aparece de inmediato con
 * "Revisando el mes..." y el resultado entra cuando esta.
 */
async function cargarIncidencias(panel) {
    const lista = panel.querySelector('[data-hm="inc-list"]');
    const mes = panel.querySelector('[data-hm="inc-month"]');

    if (!lista) return;

    if (mes) mes.textContent = incidenciasMesTitulo(incidenciasMes);

    if (incidenciasCache?.key === incidenciasMesKey(incidenciasMes)) {
        lista.innerHTML = incidenciasListHTML(incidenciasCache.totals);
        return;
    }

    const requestId = ++incidenciasRequest;

    lista.innerHTML = `<div class="hm-empty">Revisando el mes...</div>`;

    try {
        const resultado = await buildAttendanceIncidents(
            getProfiles(),
            incidenciasMes
        );

        // Si mientras tanto se cambio de mes, manda el ultimo pedido.
        if (requestId !== incidenciasRequest) return;

        incidenciasCache = {
            key: incidenciasMesKey(incidenciasMes),
            ...resultado
        };
        lista.innerHTML = incidenciasListHTML(resultado.totals);
    } catch (error) {
        if (requestId !== incidenciasRequest) return;

        console.warn("No se pudieron calcular las incidencias.", error);
        lista.innerHTML =
            `<div class="hm-empty">No se pudieron calcular las incidencias.</div>`;
    }
}

function incidenciasDetalleHTML(kind) {
    const eventos = (incidenciasCache?.events || [])
        .filter(evento => evento.kind === kind)
        .sort((a, b) => a.iso.localeCompare(b.iso) ||
            a.profile.localeCompare(b.profile));

    if (!eventos.length) {
        return `<div class="hm-empty">Sin eventos de este tipo.</div>`;
    }

    return `
        <div class="hm-inc-detail">
            ${eventos.map(evento => `
                <div class="hm-inc-row">
                    <b>${esc(evento.profile)}</b>
                    <span class="hm-inc-date">${esc(formatIncidentDate(evento.iso))}</span>
                    <small>${esc(evento.detail)}</small>
                </div>`).join("")}
        </div>`;
}

function formatIncidentDate(iso) {
    const [year, month, day] = String(iso).split("-");

    return `${day}/${month}/${year}`;
}

function ausenciasWidget() {
    const items = getTodayAbsences();
    const body = items.length
        ? items.map(item => {
            const chip = item.uncovered > 0
                ? `<span class="hm-uncov">${item.uncovered} sin cubrir</span>`
                : "";
            return `
                <button class="hm-kv" type="button" data-hm="absence-summary" data-absence-cat="${esc(item.key)}">
                    <span class="hm-kv-ico hm-${item.tone}">${svg(IC[item.icon])}</span>
                    <span class="hm-kv-name">${esc(item.label)}</span>
                    <span class="hm-kv-right">${chip}<span class="hm-kv-num hm-${item.tone}">${item.total}</span></span>
                </button>`;
        }).join("")
        : `<div class="hm-empty">Sin ausencias registradas hoy.</div>`;
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(IC.users, "Ausencias del día")}
            <div class="hm-listcol" data-hm="absence-list">${body}</div>
        </div>`;
}

function absenceDetailRowHTML(item) {
    const status = item.uncovered
        ? '<span class="hm-cob-status hm-cob-status--sincubrir">Sin cubrir</span>'
        : '<span class="hm-cob-status hm-cob-status--preasignado">Cubierto</span>';

    return `
        <div class="hm-cob-row hm-absence-detail-row">
            <div class="hm-cob-top">
                <span class="hm-turno hm-turno--${item.turnoClass}">${esc(item.turnoLabel)}</span>
                <span class="hm-cob-date hm-absence-worker">${esc(item.name)}</span>
                ${status}
            </div>
            <div class="hm-cob-meta"><b>${esc(item.absenceLabel)}:</b> ${esc(item.dateLabel)}</div>
            <div class="hm-cob-meta"><b>Detalle:</b> ${esc(item.meta)}</div>
            <div class="hm-cob-actions">
                <button class="hm-cob-btn hm-cob-btn--ver" type="button"
                    data-hm="absence-ver" data-absence-profile="${esc(item.name)}"
                    data-absence-iso="${esc(item.iso)}">VER EN CALENDARIO</button>
            </div>
        </div>`;
}

/* =========================================================
   Programacion semanal publicada

   Hasta ahora solo se veia en la PWA del trabajador: el menu de tareas la sube
   pero no la dibuja. Aca se muestra igual que la ve el trabajador, sin poder
   editarla, y con las semanas del mes a mano para no ir de a una buscando cual
   tiene algo publicado.
========================================================= */

function weeklyScheduleModal() {
    return `
        <div class="hm-modal-backdrop" data-hm="weekly-modal" hidden>
            <div class="hm-modal hm-modal--weekly" role="dialog" aria-modal="true" aria-label="Programación semanal">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.table)}</span>
                    <h3>Programación · <span data-hm="ws-heading"></span></h3>
                    <div class="hm-bday-nav">
                        <button type="button" data-hm="ws-prev" aria-label="Semana anterior">&#8249;</button>
                        <button type="button" data-hm="ws-next" aria-label="Semana siguiente">&#8250;</button>
                    </div>
                    <button class="hm-btn-secondary hm-ws-today" type="button" data-hm="ws-today">Hoy</button>
                    <button class="hm-btn-secondary hm-ws-attach" type="button"
                        data-hm="ws-attach" title="Publicar la programación de esta semana">Adjuntar</button>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-ws-weeks" data-hm="ws-weeks"></div>
                <div class="hm-modal-body" data-hm="ws-body"></div>
            </div>
        </div>`;
}

// Atajos a las semanas del mes que SI tienen programacion. Sin esto habria que
// avanzar de a una para descubrir cuales estan publicadas.
function weeklyScheduleWeeksHTML() {
    const semanas = publishedWeeksOfMonth(weeklyScheduleWeek);
    const actual = weeklyScheduleWeek.getTime();

    if (!semanas.length) {
        return `<span class="hm-ws-weeks-empty">Sin programación publicada este mes.</span>`;
    }

    return semanas.map(week => `
        <button class="hm-ws-week ${week.getTime() === actual ? "is-active" : ""}"
            type="button" data-hm="ws-week" data-week="${week.getTime()}">
            ${week.getDate()} ${MESES_ABR[week.getMonth()]}
        </button>
    `).join("");
}

function renderWeeklySchedule(panel, { imageUrl = "", loading = false } = {}) {
    const modal = panel.querySelector('[data-hm="weekly-modal"]');

    if (!modal) return;

    modal.querySelector('[data-hm="ws-heading"]').textContent =
        weekHeading(weeklyScheduleWeek);
    modal.querySelector('[data-hm="ws-weeks"]').innerHTML =
        weeklyScheduleWeeksHTML();
    modal.querySelector('[data-hm="ws-body"]').innerHTML =
        weeklyScheduleBody(weeklyScheduleWeek, { imageUrl, loading });
}

// Las programaciones subidas como imagen viven en Storage: hay que pedir su URL
// de descarga, que es asincrono. Se pinta primero el "cargando" y se repinta al
// llegar, comprobando que la semana no haya cambiado mientras tanto.
async function loadWeeklyScheduleImage(panel) {
    const semana = weeklyScheduleWeek.getTime();
    const attachment = weekAttachment(weeklyScheduleWeek);

    if (!attachment) return;

    renderWeeklySchedule(panel, { loading: true });

    try {
        const url = await resolveAttachmentUrl(attachment);

        if (weeklyScheduleWeek.getTime() !== semana) return;

        renderWeeklySchedule(panel, { imageUrl: url });
    } catch (error) {
        console.warn("No se pudo cargar la programación publicada.", error);

        if (weeklyScheduleWeek.getTime() === semana) {
            renderWeeklySchedule(panel);
        }
    }
}

async function resolveAttachmentUrl(attachment) {
    if (attachment.downloadURL) return attachment.downloadURL;
    if (attachment.dataUrl) return attachment.dataUrl;
    if (!attachment.storagePath) return "";

    const { getFirebaseServices } = await import("./firebaseClient.js");
    const { storage, storageModule } = await getFirebaseServices();

    return storageModule.getDownloadURL(
        storageModule.ref(storage, attachment.storagePath)
    );
}

function showWeeklySchedule(panel) {
    const modal = panel.querySelector('[data-hm="weekly-modal"]');

    if (!modal) return;

    renderWeeklySchedule(panel);
    modal.hidden = false;

    if (weekNeedsImage(weeklyScheduleWeek)) {
        void loadWeeklyScheduleImage(panel);
    }
}

function absenceModal() {
    return `
        <div class="hm-modal-backdrop" data-hm="absence-modal" hidden>
            <div class="hm-modal hm-modal--absence" role="dialog" aria-modal="true" aria-label="Detalle de ausencias">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.users)}</span>
                    <h3 data-hm="absence-title">Ausencias del dia</h3>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body" data-hm="absence-body"></div>
            </div>
        </div>`;
}

function openAbsenceDetail(panel, categoryKey) {
    const detail = getTodayAbsenceDetails(categoryKey);
    const modal = panel.querySelector('[data-hm="absence-modal"]');
    if (!modal) return;

    const title = detail.category
        ? `${detail.category.label} · ${detail.rows.length}`
        : "Ausencias del dia";
    modal.querySelector('[data-hm="absence-title"]').textContent = title;
    modal.querySelector('[data-hm="absence-body"]').innerHTML = detail.rows.length
        ? `<div class="hm-absence-detail-list">${detail.rows.map(absenceDetailRowHTML).join("")}</div>`
        : `<div class="hm-dot-empty">Sin trabajadores con esta ausencia hoy.</div>`;
    modal.hidden = false;
}

// ---- Cumpleaños del mes ----
// Se reusa birthDateParts de staffing (acepta YYYY-MM-DD y DD-MM-YYYY) para no
// tener dos lecturas distintas de la misma fecha.
export function getMonthBirthdays(reference = new Date(), now = new Date()) {
    const month = reference.getMonth();
    const year = reference.getFullYear();
    // "Hoy" y "ya paso" son relativos a la fecha REAL, no al mes que se esta
    // mirando: al navegar a otro mes ningun dia debe marcarse como hoy.
    const isCurrentMonth =
        now.getMonth() === month &&
        now.getFullYear() === year;
    const isPastMonth =
        year < now.getFullYear() ||
        (year === now.getFullYear() && month < now.getMonth());
    const today = now.getDate();

    return getProfiles()
        .filter(isProfileActive)
        .map(profile => {
            const parts = birthDateParts(profile.birthDate);

            if (!parts || parts.month !== month) return null;

            // La edad solo se muestra si la fecha trae año.
            const bornYear = Number(
                String(profile.birthDate || "").match(/(\d{4})/)?.[1]
            );
            const turns = bornYear && bornYear < year
                ? year - bornYear
                : 0;

            return {
                name: profile.name,
                day: parts.day,
                turns,
                isToday: isCurrentMonth && parts.day === today,
                isPast: isPastMonth ||
                    (isCurrentMonth && parts.day < today)
            };
        })
        .filter(Boolean)
        .sort((a, b) =>
            a.day - b.day ||
            a.name.localeCompare(b.name, "es")
        );
}

function birthdaysBody() {
    const reference = new Date(birthdayYear, birthdayMonth, 1);
    const birthdays = getMonthBirthdays(reference);
    const monthName = MESES[birthdayMonth];
    const now = new Date();
    // El año solo se muestra cuando no es el actual, para no repetirlo siempre.
    const heading = birthdayYear === now.getFullYear()
        ? monthName
        : `${monthName} ${birthdayYear}`;
    const list = birthdays.length
        ? birthdays.map(item => `
            <div class="hm-bday ${item.isToday ? "is-today" : ""} ${item.isPast ? "is-past" : ""}">
                <span class="hm-bday-day">${item.day}</span>
                <span class="hm-bday-name">
                    <strong>${esc(item.name)}</strong>
                    ${item.turns ? `<small>cumple ${item.turns}</small>` : ""}
                </span>
                ${item.isToday ? `<span class="hm-bday-today">Hoy</span>` : ""}
            </div>`).join("")
        : `<div class="hm-empty">Sin cumpleaños en ${esc(monthName.toLowerCase())}.</div>`;

    return { heading, count: birthdays.length, list };
}

function cumpleanosWidget() {
    const { heading, count, list } = birthdaysBody();

    return `
        <div class="hm-card hm-col-4">
            ${panelHead(
                IC.cake,
                `Cumpleaños de <span data-hm="bday-month">${esc(heading)}</span>`,
                // Las flechas van pegadas al mes; el contador conserva su
                // margin-left:auto y sigue alineado a la derecha.
                `<div class="hm-bday-nav">
                    <button type="button" data-hm="bday-prev" aria-label="Mes anterior">&#8249;</button>
                    <button type="button" data-hm="bday-next" aria-label="Mes siguiente">&#8250;</button>
                </div>
                <span class="hm-count" data-hm="bday-count">${count}</span>`
            )}
            <div class="hm-listcol hm-bday-list hm-scroller" data-hm="bday-list">${list}</div>
        </div>`;
}

function resumenWidget() {
    const swapCount = getMonthSwaps().length;
    const dotacion = getDotacionHoy();
    // Si hoy cumple alguien, el resumen lo dice; si no, la fila no aparece.
    const birthdaysToday = getMonthBirthdays().filter(item => item.isToday);
    function row(tone, name, val) {
        return `<div class="hm-sum hm-sum--${tone}"><span>${name}</span><span class="hm-sum-val">${val}</span></div>`;
    }
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(IC.bars, "Resumen rápido")}
            <div class="hm-listcol hm-listcol--gap">
                ${row("good", "En servicio hoy", dotacion.total)}
                ${row("info", "Personal de día", dotacion.dia)}
                ${row("night", "Personal de noche", dotacion.noche)}
                ${row("accent", "Cambios de turno", swapCount)}
                ${birthdaysToday.length
                    ? `<div class="hm-sum hm-sum--bday" title="${esc(birthdaysToday.map(item => item.name).join(", "))}">
                        <span>🎂 ${esc(birthdaysToday.map(item => item.name).join(", "))}</span>
                        <span class="hm-sum-val">Hoy</span>
                    </div>`
                    : ""}
            </div>
        </div>`;
}

function cambiosWidget() {
    const swaps = getMonthSwaps();
    const body = swaps.length
        ? swaps.slice(0, 6).map(swap => {
            const turno = homeSwapTurnLabel(swap.turno);
            const meta = [turno, formatShortDate(swap.fecha)].filter(Boolean).join(" · ");
            return `
                <button class="hm-swap" type="button" data-hm="swap-detail" data-swap-id="${esc(swap.id || "")}">
                    <span class="hm-swap-tag">${esc(shortName(swap.from))}</span>
                    <span class="hm-swap-arrow">${svg(IC.arrowRight, 'stroke-width="2.2"')}</span>
                    <span class="hm-swap-tag">${esc(shortName(swap.to))}</span>
                    <span class="hm-swap-count">${esc(meta)}</span>
                </button>`;
        }).join("")
        : `<div class="hm-empty">Sin cambios de turno este mes.</div>`;
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(IC.swap, "Cambios de turno", `<span class="hm-count">${swaps.length}</span>`)}
            <div class="hm-listcol">${body}</div>
        </div>`;
}

function swapDetailItemHTML(label, date, turn, skipped) {
    const turnLabel = homeSwapTurnLabel(turn);
    const value = skipped
        ? "Sin movimiento en calendario"
        : [formatSwapDetailDate(date), turnLabel].filter(Boolean).join(" - ");

    return `
        <li>
            <span>${esc(label)}</span>
            <strong>${esc(value || "Sin dato")}</strong>
        </li>`;
}

function openHomeSwapDetailDialog(swap) {
    if (!swap) return;

    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop hm-swap-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog hm-swap-dialog" role="dialog" aria-modal="true" aria-labelledby="homeSwapDetailTitle">
            <strong id="homeSwapDetailTitle">Cambio de turno aplicado</strong>
            <p>
                Revisa el detalle del cambio antes de anularlo.
            </p>
            <div class="turn-change-dialog__meta hm-swap-dialog__meta">
                <span>${esc(swap.from || "Sin trabajador")}</span>
                <span class="hm-swap-dialog__arrow">${svg(IC.arrowRight, 'stroke-width="2.2"')}</span>
                <span>${esc(swap.to || "Sin trabajador")}</span>
            </div>
            <ul class="turn-change-dialog__swap-detail">
                ${swapDetailItemHTML("Entrega", swap.fecha, swap.turno, Boolean(swap.skipFecha))}
                ${swapDetailItemHTML("Devuelve", swap.devolucion, swap.turnoDevuelto, Boolean(swap.skipDevolucion))}
            </ul>
            <p class="leave-detail-note hm-swap-dialog__note">
                Al anularlo se restauran los dias de ambos trabajadores a su turno original.
            </p>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
                <button class="leave-detail-undo" type="button" data-action="undo">
                    Anular cambio
                </button>
            </div>
        </section>`;

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
        ?.addEventListener("click", close);

    backdrop
        .querySelector("[data-action='undo']")
        ?.addEventListener("click", async event => {
            const targetSwap = getMonthSwaps().find(item =>
                String(item.id || "") === String(swap.id || "")
            );

            event.currentTarget.disabled = true;

            if (!targetSwap) {
                alert("Este cambio ya no esta disponible para anular.");
                close();
                renderHomePanel();
                return;
            }

            if (typeof window.pushUndoState === "function") {
                window.pushUndoState("Deshacer cambio de turno");
            }

            deshacerCambioTurno(targetSwap);

            const dates = [targetSwap.fecha, targetSwap.devolucion]
                .filter(Boolean);
            const profiles = [targetSwap.from, targetSwap.to]
                .filter(Boolean);
            const keys = dates
                .map(keyFromISO)
                .filter(key => key && !key.includes("NaN"));

            await Promise.all(
                profiles.flatMap(profile =>
                    dates.map(date => updateDayCell(profile, date))
                )
            );

            profiles.forEach(profile => {
                updateTimelineCells(profile, keys);
            });
            await updateVisibleCalendarDays({ updateSummary: true });

            close();
            refreshAll();
            renderHomePanel();
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-action='undo']")?.focus();
}

function coberturaRow(item, kind) {
    // El turno cuya solicitud ya salio a las PWA no esta "sin cubrir": esta en
    // espera de respuesta. El celular es el mismo marcador del calendario y del
    // timeline, para que las tres superficies digan lo mismo.
    const waiting = kind === "sincubrir" && (item.pendingRequests?.length || 0) > 0;
    const status = waiting
        ? `<button class="hm-cob-status hm-cob-status--espera" type="button"
                data-hm="cob-espera" data-cob-profile="${esc(item.origin)}" data-cob-key="${esc(item.keyDay)}"
                title="Ver a quién se le envió y cuánto queda">${svg(IC.phone, 'stroke-width="1.7"')}En espera..</button>`
        : kind === "sincubrir"
            ? '<span class="hm-cob-status hm-cob-status--sincubrir">Sin cubrir</span>'
            : '<span class="hm-cob-status hm-cob-status--preasignado">Preasignado</span>';
    const third = waiting
        ? `<div class="hm-cob-meta"><b>Solicitud enviada a:</b> ${esc(
            item.pendingRequests.map(request => request.worker).join(", ")
        )}</div>`
        : kind === "sincubrir"
        ? (item.candidates.length
            ? `<div class="hm-cob-meta"><b>Podría cubrir:</b> ${esc(item.candidates.join(", "))}</div>`
            : '<div class="hm-cob-meta"><span class="hm-cob-none">Sin candidatos disponibles</span></div>')
        : `<div class="hm-cob-meta"><b>Preasignado:</b> ${esc(item.assigned)}</div>`;
    const reason = item.reason ? ` · ${esc(item.reason)}` : "";
    // Los preasignados se resuelven desde aca sin pasar por el calendario: son
    // las mismas dos acciones del modal del turno preasignado.
    const actions = kind === "preasignado" && item.id
        ? `
            <div class="hm-cob-actions">
                <button class="hm-cob-btn hm-cob-btn--confirm" type="button" data-hm="cob-confirm" data-preassign-id="${esc(item.id)}">CONFIRMAR</button>
                <button class="hm-cob-btn hm-cob-btn--cancel" type="button" data-hm="cob-cancel" data-preassign-id="${esc(item.id)}">CANCELAR</button>
            </div>`
        : kind === "sincubrir" && item.keyDay
            ? `
            <div class="hm-cob-actions">
                <button class="hm-cob-btn hm-cob-btn--ver" type="button" data-hm="cob-ver" data-cob-profile="${esc(item.origin)}" data-cob-iso="${esc(item.iso)}">VER EN CALENDARIO</button>
                <button class="hm-cob-btn hm-cob-btn--auto" type="button" data-hm="cob-auto"
                    data-cob-profile="${esc(item.origin)}" data-cob-key="${esc(item.keyDay)}"
                    ${waiting ? `disabled title="Ya se envió la solicitud. Se habilita cuando caduque o cuando alguien acepte el turno."` : ""}>${
                    waiting ? "SOLICITUD ENVIADA" : "COBERTURA AUTOMÁTICA"}</button>
            </div>`
            : "";
    return `
        <div class="hm-cob-row">
            <div class="hm-cob-top">
                <span class="hm-turno hm-turno--${item.turnoClass}">${esc(item.turnoLabel)}</span>
                <span class="hm-cob-date">${esc(item.dateLabel)}</span>
                ${status}
            </div>
            <div class="hm-cob-meta"><b>Origina:</b> ${esc(item.origin)}${reason}</div>
            ${third}
            ${actions}
        </div>`;
}

function coberturaBody() {
    const { uncovered, preassigned } = coverageData;
    const total = uncovered.length + preassigned.length;

    const summary =
        `<div class="hm-cob-chip hm-cob-chip--crit"><span class="hm-cob-chip-ico">${svg(IC.alertTri)}</span><span><span class="hm-cob-chip-num">${uncovered.length}</span><span class="hm-cob-chip-lbl">Sin cubrir</span></span></div>` +
        `<div class="hm-cob-chip hm-cob-chip--accent"><span class="hm-cob-chip-ico">${svg(IC.clock)}</span><span><span class="hm-cob-chip-num">${preassigned.length}</span><span class="hm-cob-chip-lbl">Preasignados</span></span></div>`;

    let list =
        uncovered.map(i => coberturaRow(i, "sincubrir")).join("") +
        preassigned.map(i => coberturaRow(i, "preasignado")).join("");
    if (!list) {
        list = `<div class="hm-empty">Sin turnos por cubrir ni preasignados.</div>`;
    }

    return { total, summary, list };
}

function coberturaWidget() {
    coverageData = getCoverageData();
    const { total, summary, list } = coberturaBody();
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(
                IC.shield,
                "Cobertura de turnos",
                `<label class="hm-toggle hm-head-toggle"><input type="checkbox" data-hm="cob-detail" ${coverageDetail ? "checked" : ""}> Ver detalles</label>
                <span class="hm-count">${total}</span>`
            )}
            <div class="hm-cob-summary" ${coverageDetail ? "hidden" : ""}>${summary}</div>
            <div class="hm-cob-list hm-scroller" ${coverageDetail ? "" : "hidden"}>${list}</div>
        </div>`;
}

function tasksModal() {
    return `
        <div class="hm-modal-backdrop" data-hm="tasks-modal" hidden>
            <div class="hm-modal" role="dialog" aria-modal="true" aria-label="Agregar tarea">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.plus, 'stroke-width="2.4"')}</span>
                    <h3>Agregar tarea</h3>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body">
                    <div class="hm-form-grid">
                        <label class="hm-full">Nombre de la tarea
                            <input type="text" data-hm="nt-name" placeholder="Ej: Revisión de agenda y asignación de turnos">
                        </label>
                        <label>Fecha de inicio <input type="date" data-hm="nt-date" value="${todayISO()}"></label>
                        <label>Horario <input type="time" data-hm="nt-time" value="08:00"></label>
                        <label>Repetir
                            <select data-hm="nt-repeat">${optionsHTML(REPEAT_OPTS, "Diario")}</select>
                        </label>
                        <label>Alerta
                            <select data-hm="nt-alert">
                                <option>Sin alerta</option>
                                <option>Al momento</option>
                                <option>5 minutos antes</option>
                                <option selected>15 minutos antes</option>
                                <option>30 minutos antes</option>
                                <option>1 hora antes</option>
                            </select>
                        </label>
                    </div>
                </div>
                <div class="hm-modal-foot">
                    <button class="hm-btn-secondary" type="button" data-hm="close">Cancelar</button>
                    <button class="hm-btn-primary" type="button" data-hm="add-task">Agregar tarea</button>
                </div>
            </div>
        </div>`;
}

function taskEditModal() {
    return `
        <div class="hm-modal-backdrop hm-modal-backdrop--top" data-hm="task-edit-modal" hidden>
            <div class="hm-modal" role="dialog" aria-modal="true" aria-label="Modificar tarea">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.edit)}</span>
                    <h3>Modificar tarea</h3>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body">
                    <div class="hm-form-grid">
                        <label class="hm-full">Nombre de la tarea
                            <input type="text" data-hm="et-name" placeholder="Nombre de la tarea">
                        </label>
                        <label>Fecha de inicio <input type="date" data-hm="et-date"></label>
                        <label>Horario <input type="time" data-hm="et-time"></label>
                        <label>Repetir <select data-hm="et-repeat">${optionsHTML(REPEAT_OPTS, "Diario")}</select></label>
                        <label>Alerta <select data-hm="et-alert">${optionsHTML(ALERT_OPTS, "Sin alerta")}</select></label>
                    </div>
                </div>
                <div class="hm-modal-foot hm-modal-foot--split">
                    <button class="hm-btn-danger" type="button" data-hm="delete-task">${svg(IC.trash, 'stroke-width="2"')} Eliminar tarea</button>
                    <div>
                        <button class="hm-btn-secondary" type="button" data-hm="close">Cancelar</button>
                        <button class="hm-btn-primary" type="button" data-hm="save-task">Guardar cambios</button>
                    </div>
                </div>
            </div>
        </div>`;
}

// ---- Modal de dotación (trabajadores en servicio: día / noche + horario) ----
function dotRowHTML(x) {
    return `<div class="hm-dot-row"><span class="hm-dot-name">${esc(x.name)}</span><span class="hm-dot-time">${esc(x.time)}</span></div>`;
}

function dotColumnHTML(icon, title, list) {
    return `
        <div class="hm-dot-col">
            <div class="hm-dot-colhead">${icon}<span>${title}</span><b>${list.length}</b></div>
            <div class="hm-dot-list">
                ${list.length ? list.map(dotRowHTML).join("") : `<div class="hm-dot-empty">Sin trabajadores.</div>`}
            </div>
        </div>`;
}

function dotBodyHTML(e) {
    return `
        <div class="hm-dot-cols">
            ${dotColumnHTML(DN_SUN, "De día", e.dia)}
            ${dotColumnHTML(DN_MOON, "De noche", e.noche)}
        </div>`;
}

function dotacionModal() {
    return `
        <div class="hm-modal-backdrop" data-hm="inc-modal" hidden>
            <div class="hm-modal hm-modal--dotacion" role="dialog" aria-modal="true" aria-label="Detalle de incidencias">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.clipboard)}</span>
                    <h3 data-hm="inc-title">Incidencias</h3>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body" data-hm="inc-body"></div>
            </div>
        </div>
        <div class="hm-modal-backdrop" data-hm="dotacion-modal" hidden>
            <div class="hm-modal hm-modal--dotacion" role="dialog" aria-modal="true" aria-label="Trabajadores en servicio">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico">${svg(IC.users)}</span>
                    <h3 data-hm="dot-title">En servicio hoy</h3>
                    <button class="hm-modal-close" type="button" data-hm="close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body" data-hm="dot-body"></div>
            </div>
        </div>`;
}

function openDotacion(panel, est) {
    const det = getDotacionDetalleHoy();
    const e = det.byEstamento[est];
    const modal = panel.querySelector('[data-hm="dotacion-modal"]');
    if (!modal) return;

    modal.querySelector('[data-hm="dot-title"]').textContent = `${est} · en servicio hoy`;
    modal.querySelector('[data-hm="dot-body"]').innerHTML = e
        ? dotBodyHTML(e)
        : `<div class="hm-dot-empty">Sin trabajadores en servicio.</div>`;
    modal.hidden = false;
}

function homeHTML() {
    const supervisor = esc(getSupervisorName());
    const unit = esc(getUnitName());
    return `
        <div class="hm-root">
            <section class="hm-hero">
                <div class="hm-greet">
                    <h1>¡Hola, ${supervisor}! 👋</h1>
                    <p>Este es tu resumen diario de ${unit}.</p>
                    <div class="hm-date" data-hm="open-taskcal" role="button" tabindex="0"
                        title="Ver el calendario de tareas">
                        <span class="hm-date-ico">${svg(IC.calendar)}</span>
                        <span><small>Hoy es</small><strong>${esc(todayLabel())}</strong></span>
                        <span class="hm-date-go">${svg(IC.chevron, 'stroke-width="2.4"')}</span>
                    </div>
                </div>
            </section>

            <section class="hm-stats">
                ${statsSection()}
            </section>

            <!--
                Tres PILAS, no tres filas. Cada tarjeta se apoya directamente en
                la de arriba de su columna: si "Tareas diarias" tiene una sola
                tarea, "Ausencias del dia" sube hasta pegarse a ella, y si
                manana tiene diez, la empuja hacia abajo.

                Con filas, la altura la imponia la tarjeta mas alta de la fila y
                las cortas quedaban con medio panel en blanco debajo esperando a
                la vecina. Por eso el orden de lectura del DOM es por columna y
                no por fila.

                  Columna 1 (el dia):  tareas -> ausencias -> cambios
                  Columna 2 (el mes):  solicitudes -> marcaje -> cumpleanos
                  Columna 3 (el turno): resumen -> cobertura, y lo que sobra
                                        abajo es el sitio de la proxima tarjeta.

                Abajo de 1100px las pilas se disuelven (display: contents) y las
                tarjetas vuelven a repartirse solas en la grilla de 12.
            -->
            <section class="hm-grid">
                <div class="hm-stack">
                    ${tareasWidget()}
                    ${ausenciasWidget()}
                    ${cambiosWidget()}
                </div>
                <div class="hm-stack">
                    ${solicitudesWidget()}
                    ${incidenciasWidget()}
                    ${cumpleanosWidget()}
                </div>
                <div class="hm-stack">
                    ${resumenWidget()}
                    ${coberturaWidget()}
                </div>
            </section>

            <div class="hm-note">
                ${svg('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>', 'width="18" height="18"')}
                <span><b>Datos reales:</b> tareas (por usuario, con alerta sonora), dotación, ausencias, cambios de turno y cobertura.</span>
            </div>
        </div>
        ${tasksModal()}
        ${taskEditModal()}
        ${dotacionModal()}
        ${absenceModal()}
        ${weeklyScheduleModal()}
        ${taskCalendarModal()}
        ${dayTasksModal()}`;
}

// ---- Interactividad ----
function openTaskAdd(panel, date = todayISO(), options = {}) {
    const modal = panel.querySelector('[data-hm="tasks-modal"]');
    if (!modal) return;

    modal.classList.toggle("hm-modal-backdrop--top", Boolean(options.top));
    modal.querySelector('[data-hm="nt-name"]').value = "";
    modal.querySelector('[data-hm="nt-date"]').value = date || todayISO();
    modal.querySelector('[data-hm="nt-time"]').value = "08:00";
    modal.querySelector('[data-hm="nt-repeat"]').value = "Diario";
    modal.querySelector('[data-hm="nt-alert"]').value = "15 minutos antes";
    modal.hidden = false;
    modal.querySelector('[data-hm="nt-name"]')?.focus();
}

function openTaskEdit(panel, id) {
    const task = getHomeTasks().find(t => t.id === id);
    if (!task) return;
    const modal = panel.querySelector('[data-hm="task-edit-modal"]');
    if (!modal) return;

    editingTaskId = id;
    modal.querySelector('[data-hm="et-name"]').value = task.name || "";
    modal.querySelector('[data-hm="et-date"]').value = task.date || "";
    modal.querySelector('[data-hm="et-time"]').value = task.time || "08:00";
    modal.querySelector('[data-hm="et-repeat"]').value = task.repeat || "Diario";
    modal.querySelector('[data-hm="et-alert"]').value = task.alert || "Sin alerta";
    modal.hidden = false;
}

function wire(panel) {
    const tasksList = panel.querySelector('[data-hm="tasks-list"]');
    const refreshTasks = () => {
        // Las tres superficies muestran las mismas tareas: la tarjeta del dia,
        // la grilla del mes y el listado del dia abierto. Modificar una tarea
        // desde cualquiera tiene que verse en las otras dos.
        if (tasksList) tasksList.innerHTML = tasksListHTML();
        reRenderTaskCalendar(panel);
        renderDayTasks(panel);
    };

    // --- Tareas: visto (toggle realizada) + click en la fila (modificar) ---
    if (tasksList) {
        tasksList.addEventListener("click", event => {
            const toggle = event.target.closest('[data-hm="task-toggle"]');
            if (toggle) {
                // El visto se guarda solo (toggleTaskDone escribe ese dia de esa
                // tarea, no la lista entera) y pinta al instante.
                void toggleTaskDone(toggle.dataset.id, todayISO());
                refreshTasks();
                return;
            }
            const row = event.target.closest('[data-hm="task-row"]');
            if (row) openTaskEdit(panel, row.dataset.id);
        });
        tasksList.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            const row = event.target.closest('[data-hm="task-row"]');
            if (!row) return;
            event.preventDefault();
            openTaskEdit(panel, row.dataset.id);
        });
    }

    // --- Tareas: modal para MODIFICAR / eliminar (click en la tarea) ---
    const editModal = panel.querySelector('[data-hm="task-edit-modal"]');
    if (editModal) {
        editModal.addEventListener("click", event => {
            if (event.target === editModal || event.target.closest('[data-hm="close"]')) {
                editModal.hidden = true;
                return;
            }
            if (event.target.closest('[data-hm="save-task"]')) {
                if (!editingTaskId) return;
                const nameInput = editModal.querySelector('[data-hm="et-name"]');
                const name = String(nameInput.value || "").trim();
                if (!name) { nameInput.focus(); return; }
                const tasks = getHomeTasks();
                const task = tasks.find(t => t.id === editingTaskId);
                if (task) {
                    task.name = name;
                    task.date = editModal.querySelector('[data-hm="et-date"]').value;
                    task.time = editModal.querySelector('[data-hm="et-time"]').value || "08:00";
                    task.repeat = editModal.querySelector('[data-hm="et-repeat"]').value;
                    task.alert = editModal.querySelector('[data-hm="et-alert"]').value;
                    tasks.sort((a, b) => a.time.localeCompare(b.time));
                    saveHomeTasks(tasks);
                    refreshTasks();
                }
                editModal.hidden = true;
                return;
            }
            if (event.target.closest('[data-hm="delete-task"]')) {
                if (editingTaskId) {
                    // Borrar es la UNICA via por la que una tarea desaparece del
                    // documento: guardar una lista sin ella no la borra.
                    void deleteHomeTask(editingTaskId);
                    refreshTasks();
                }
                editModal.hidden = true;
            }
        });
    }

    // --- Tareas: modal para AGREGAR tareas (icono +) ---
    const modal = panel.querySelector('[data-hm="tasks-modal"]');
    const addOpen = panel.querySelector('[data-hm="tasks-add"]');
    if (addOpen && modal) {
        const closeTaskAdd = () => {
            modal.hidden = true;
            modal.classList.remove("hm-modal-backdrop--top");
        };

        addOpen.addEventListener("click", () => openTaskAdd(panel));
        modal.addEventListener("click", event => {
            if (event.target === modal || event.target.closest('[data-hm="close"]')) {
                closeTaskAdd();
                return;
            }
            if (event.target.closest('[data-hm="add-task"]')) {
                const nameInput = modal.querySelector('[data-hm="nt-name"]');
                const name = String(nameInput.value || "").trim();
                if (!name) { nameInput.focus(); return; }
                const tasks = getHomeTasks();
                tasks.push({
                    name,
                    time: modal.querySelector('[data-hm="nt-time"]').value || "08:00",
                    repeat: modal.querySelector('[data-hm="nt-repeat"]').value,
                    date: modal.querySelector('[data-hm="nt-date"]').value,
                    alert: modal.querySelector('[data-hm="nt-alert"]').value,
                    doneDates: []
                });
                tasks.sort((a, b) => a.time.localeCompare(b.time));
                saveHomeTasks(tasks);
                refreshTasks();
                closeTaskAdd();
            }
        });
    }

    // --- Dotación: click en una stat card -> modal con día/noche + horario ---
    const stats = panel.querySelector(".hm-stats");
    const dotModal = panel.querySelector('[data-hm="dotacion-modal"]');
    iniciarNotas(panel);
    void cargarIncidencias(panel);

    // --- Incidencias de marcaje: navegacion por mes y detalle por tipo ---
    const incCard = panel.querySelector('[data-hm="inc-list"]')?.closest(".hm-card");
    const incModal = panel.querySelector('[data-hm="inc-modal"]');

    incCard?.addEventListener("click", event => {
        const paso = event.target.closest('[data-hm="inc-prev"], [data-hm="inc-next"]');

        if (paso) {
            const salto = paso.dataset.hm === "inc-next" ? 1 : -1;

            incidenciasMes = new Date(
                incidenciasMes.getFullYear(),
                incidenciasMes.getMonth() + salto,
                1
            );
            void cargarIncidencias(panel);
            return;
        }

        const tipo = event.target.closest('[data-hm="inc-kind"]');

        if (!tipo || !incModal) return;

        const kind = tipo.dataset.kind;
        const label = ATTENDANCE_INCIDENT_KINDS
            .find(item => item.key === kind)?.label || "Incidencias";

        panel.querySelector('[data-hm="inc-title"]').textContent =
            `${label} · ${incidenciasMesLabel(incidenciasMes)}`;
        panel.querySelector('[data-hm="inc-body"]').innerHTML =
            incidenciasDetalleHTML(kind);
        incModal.hidden = false;
    });

    incModal?.addEventListener("click", event => {
        if (event.target === incModal || event.target.closest('[data-hm="close"]')) {
            incModal.hidden = true;
        }
    });

    // La programacion semanal es otra tarjeta de la misma fila, asi que
    // comparte estos manejadores y con eso hereda el soporte de teclado.
    const abrirTarjeta = (target) => {
        const dotacion = target.closest('[data-hm="dotacion"]');

        if (dotacion) {
            openDotacion(panel, dotacion.dataset.est);
            return true;
        }

        if (target.closest('[data-hm="open-weekly"]')) {
            openWeeklySchedule(panel);
            return true;
        }

        return false;
    };

    if (stats) {
        stats.addEventListener("click", event => {
            abrirTarjeta(event.target);
        });
        stats.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            if (abrirTarjeta(event.target)) event.preventDefault();
        });
    }
    if (dotModal) {
        dotModal.addEventListener("click", event => {
            if (event.target === dotModal || event.target.closest('[data-hm="close"]')) {
                dotModal.hidden = true;
            }
        });
    }

    // --- Programacion semanal publicada ---
    const weeklyModal = panel.querySelector('[data-hm="weekly-modal"]');

    // El acceso vive en la fila de widgets y lo enlaza el manejador de esa
    // fila; aqui solo queda que hace al abrirse.
    function openWeeklySchedule(target) {
        // Siempre abre en la semana de hoy, no donde quedo la vez anterior.
        weeklyScheduleWeek = weekStartMonday(new Date());
        showWeeklySchedule(target);
    }

    if (weeklyModal) {
        const irASemana = (week) => {
            weeklyScheduleWeek = week;
            renderWeeklySchedule(panel);

            if (weekNeedsImage(weeklyScheduleWeek)) {
                void loadWeeklyScheduleImage(panel);
            }
        };

        weeklyModal.addEventListener("click", event => {
            if (
                event.target === weeklyModal ||
                event.target.closest('[data-hm="close"]')
            ) {
                weeklyModal.hidden = true;
                return;
            }

            const paso = event.target.closest('[data-hm="ws-prev"], [data-hm="ws-next"]');

            if (paso) {
                // De a una semana: es la unidad en que se publica. Avanzando se
                // cruza de mes solo, y el titulo dice en cual se esta.
                irASemana(addScheduleDays(
                    weeklyScheduleWeek,
                    paso.dataset.hm === "ws-next" ? 7 : -7
                ));
                return;
            }

            if (event.target.closest('[data-hm="ws-today"]')) {
                irASemana(weekStartMonday(new Date()));
                return;
            }

            // Publicar la programacion de la semana que se esta viendo, no la
            // de hoy: se navega hasta la semana y se adjunta ahi.
            if (event.target.closest('[data-hm="ws-attach"]')) {
                openScheduleAttachmentDialog(weeklyScheduleWeek);
                return;
            }

            const semana = event.target.closest('[data-hm="ws-week"]');

            if (semana) {
                irASemana(new Date(Number(semana.dataset.week)));
            }
        });
    }

    // --- Ausencias: click en la tarjeta -> modal con trabajadores y acceso al calendario ---
    const absenceList = panel.querySelector('[data-hm="absence-list"]');
    const absenceModalEl = panel.querySelector('[data-hm="absence-modal"]');
    if (absenceList) {
        absenceList.addEventListener("click", event => {
            const row = event.target.closest('[data-hm="absence-summary"]');
            if (!row) return;
            openAbsenceDetail(panel, row.dataset.absenceCat);
        });
    }
    if (absenceModalEl) {
        absenceModalEl.addEventListener("click", event => {
            const button = event.target.closest('[data-hm="absence-ver"]');
            if (button) {
                absenceModalEl.hidden = true;
                window.dispatchEvent(
                    new CustomEvent("proturnos:viewWorkerRequestInCalendar", {
                        detail: {
                            profile: button.dataset.absenceProfile,
                            date: button.dataset.absenceIso
                        }
                    })
                );
                return;
            }

            if (event.target === absenceModalEl || event.target.closest('[data-hm="close"]')) {
                absenceModalEl.hidden = true;
            }
        });
    }

    panel.querySelectorAll('[data-hm="swap-detail"]').forEach(button => {
        button.addEventListener("click", () => {
            const swap = getMonthSwaps().find(item =>
                String(item.id || "") === String(button.dataset.swapId || "")
            );

            if (!swap) {
                renderHomePanel();
                return;
            }

            openHomeSwapDetailDialog(swap);
        });
    });

    // --- Cobertura: ver el dia en el calendario ---
    panel.querySelectorAll('[data-hm="cob-ver"]').forEach(button => {
        button.addEventListener("click", () => {
            // Mismo evento que usa "ver en el calendario" de las solicitudes:
            // salta al mes, selecciona al trabajador y abre Turnos.
            window.dispatchEvent(
                new CustomEvent("proturnos:viewWorkerRequestInCalendar", {
                    detail: {
                        profile: button.dataset.cobProfile,
                        date: button.dataset.cobIso
                    }
                })
            );
        });
    });

    // --- Cobertura: detalle de la solicitud ya enviada ---
    panel.querySelectorAll('[data-hm="cob-espera"]').forEach(button => {
        button.addEventListener("click", () => {
            window.openPendingRequestsDialog?.({
                profile: button.dataset.cobProfile,
                keyDay: button.dataset.cobKey
            });
        });
    });

    // --- Cobertura: solicitud masiva a los candidatos con la app enlazada ---
    panel.querySelectorAll('[data-hm="cob-auto"]').forEach(button => {
        button.addEventListener("click", async () => {
            const label = button.textContent;

            button.disabled = true;
            button.textContent = "ENVIANDO...";

            try {
                const result = await window.runAutomaticCoverage?.(
                    button.dataset.cobProfile,
                    button.dataset.cobKey
                );

                announceAutomaticCoverage(result);
            } catch (error) {
                console.warn("No se pudo enviar la cobertura automatica.", error);
                announceAutomaticCoverage({ status: "error" });
            } finally {
                button.disabled = false;
                button.textContent = label;
            }

            renderHomePanel();
        });
    });

    // --- Calendario de tareas: se abre desde la fecha del encabezado ---
    const taskCal = panel.querySelector('[data-hm="taskcal-modal"]');
    const dayTasks = panel.querySelector('[data-hm="dayTasks-modal"]');

    if (taskCal) {
        const openCalendar = () => {
            // Siempre abre en el mes de hoy, no donde quedo la vez anterior:
            // se entra por "Hoy es ...".
            const now = new Date();

            taskCalYear = now.getFullYear();
            taskCalMonth = now.getMonth();
            reRenderTaskCalendar(panel);
            taskCal.hidden = false;
            void ensureHolidaysLoaded(
                taskCalYear,
                () => reRenderTaskCalendar(panel)
            );
        };

        // Dos puertas al mismo calendario: la fecha del encabezado y "Ver todas
        // las tareas", que es donde uno busca la tarea que programo para otro
        // dia y ya no ve en la tarjeta.
        panel.querySelectorAll('[data-hm="open-taskcal"]').forEach(trigger => {
            trigger.addEventListener("click", openCalendar);
            trigger.addEventListener("keydown", event => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                openCalendar();
            });
        });
    }

    if (taskCal) {
        taskCal.addEventListener("click", event => {
            if (event.target === taskCal || event.target.closest('[data-hm="close"]')) {
                taskCal.hidden = true;
                if (dayTasks) dayTasks.hidden = true;
                return;
            }

            const nav = event.target.closest('[data-hm="tc-prev"], [data-hm="tc-next"]');

            if (nav) {
                const step = nav.dataset.hm === "tc-next" ? 1 : -1;
                // Con Date, diciembre -> enero salta de año solo.
                const next = new Date(taskCalYear, taskCalMonth + step, 1);

                taskCalYear = next.getFullYear();
                taskCalMonth = next.getMonth();
                reRenderTaskCalendar(panel);
                void ensureHolidaysLoaded(
                    taskCalYear,
                    () => reRenderTaskCalendar(panel)
                );
                return;
            }

            const cell = event.target.closest('[data-hm="taskcal-day"]');

            if (cell) openDayTasks(panel, cell.dataset.iso);
        });
        taskCal.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;

            const cell = event.target.closest('[data-hm="taskcal-day"]');

            if (!cell) return;

            event.preventDefault();
            openDayTasks(panel, cell.dataset.iso);
        });
    }

    if (dayTasks) {
        const editFromDay = id => {
            openTaskEdit(panel, id);
            // El listado queda abierto detras: al guardar se vuelve al dia.
        };
        const addFromDay = () => {
            if (!openDayIso) return;
            openTaskAdd(panel, openDayIso, { top: true });
        };

        dayTasks.addEventListener("click", event => {
            // Cerrar el listado del dia deja el calendario abierto detras.
            if (event.target === dayTasks || event.target.closest('[data-hm="close"]')) {
                dayTasks.hidden = true;
                openDayIso = "";
                return;
            }

            if (event.target.closest('[data-hm="dt-add"]')) {
                addFromDay();
                return;
            }

            const toggle = event.target.closest('[data-hm="dt-toggle"]');

            if (toggle) {
                // El visto se marca CONTRA EL DIA ABIERTO, no contra hoy: desde
                // el calendario se cierra el 27 estando parado en el 20.
                void toggleTaskDone(toggle.dataset.id, openDayIso);
                refreshTasks();
                return;
            }

            const row = event.target.closest('[data-hm="dt-row"]');

            if (row) editFromDay(row.dataset.id);
        });
        dayTasks.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;

            const row = event.target.closest('[data-hm="dt-row"]');

            if (!row) return;

            event.preventDefault();
            editFromDay(row.dataset.id);
        });
    }

    // --- Cumpleaños: navegar de mes en mes sin repintar todo el panel ---
    panel.querySelectorAll('[data-hm="bday-prev"], [data-hm="bday-next"]')
        .forEach(button => {
            button.addEventListener("click", () => {
                const step = button.dataset.hm === "bday-next" ? 1 : -1;
                // Con Date, diciembre -> enero salta de año solo.
                const next = new Date(birthdayYear, birthdayMonth + step, 1);

                birthdayYear = next.getFullYear();
                birthdayMonth = next.getMonth();
                reRenderBirthdays(panel);
            });
        });

    // --- Cobertura: switch de detalles (siempre muestra sin cubrir + preasignados) ---
    const detail = panel.querySelector('[data-hm="cob-detail"]');
    if (detail) {
        detail.addEventListener("change", () => {
            coverageDetail = detail.checked;
            reRenderCoverage(panel);
        });
    }

    const requestDetail = panel.querySelector('[data-hm="req-detail"]');
    if (requestDetail) {
        requestDetail.addEventListener("change", () => {
            requestsDetail = requestDetail.checked;
            reRenderRequestsSummary(panel);
        });
    }

    panel.querySelector('[data-hm="req-open"]')?.addEventListener("click", () => {
        document.querySelector('.nav-tile[data-target="workerRequestsPanel"]')?.click();
    });

    panel.querySelectorAll('[data-hm="req-accept"], [data-hm="req-reject"]')
        .forEach(button => {
            button.addEventListener("click", async () => {
                const requestId = button.dataset.requestId || "";
                if (!requestId) return;

                const actions = button.closest(".hm-req-row-actions");
                actions?.querySelectorAll("button").forEach(item => {
                    item.disabled = true;
                });

                const accepted = button.dataset.hm === "req-accept";
                const ok = accepted
                    ? await acceptWorkerRequestById(requestId)
                    : await rejectWorkerRequestById(requestId);

                if (!ok) {
                    actions?.querySelectorAll("button").forEach(item => {
                        item.disabled = false;
                    });
                    return;
                }

                renderHomePanel();
                window.dispatchEvent(new CustomEvent("proturnos:workerRequestsChanged"));
            });
        });

    // --- Cobertura: confirmar / cancelar un turno preasignado sin salir del inicio ---
    panel.querySelectorAll('[data-hm="cob-confirm"], [data-hm="cob-cancel"]')
        .forEach(button => {
            button.addEventListener("click", () => {
                const preassignment = getPreassignments().find(item =>
                    String(item.id) === button.dataset.preassignId
                );

                if (!preassignment) {
                    renderHomePanel();
                    return;
                }

                const confirmar = button.dataset.hm === "cob-confirm";
                const worker = preassignment.worker;
                const replaced = preassignment.replaced;
                const keyDay = keyFromISO(preassignment.date);
                const done = confirmar
                    ? confirmPreassignment(preassignment)
                    : cancelPreassignment(preassignment);

                if (!done) return;

                // refreshAll solo repinta la vista ACTIVA, y aca la activa es
                // el inicio: calendario y timeline quedaban con el marcador de
                // preasignado hasta recargar. Se actualizan sus casillas igual
                // que hace el modal del calendario, aunque esten ocultos.
                void (async () => {
                    await updateDayCell(replaced, keyDay);

                    if (worker && worker !== replaced) {
                        await updateDayCell(worker, keyDay);
                    }

                    updateTimelineCells(replaced, [keyDay]);

                    if (worker) updateTimelineCells(worker, [keyDay]);

                    await updateVisibleCalendarDays({ updateSummary: true });
                })();

                refreshAll();
                renderHomePanel();
            });
        });
}

// Cada resultado necesita su propio mensaje: "no se envio nada" por falta de
// candidatos no es lo mismo que porque ninguno tiene la app.
function announceAutomaticCoverage(result) {
    const toast = (text, options) =>
        (window.showAppToast || (message => alert(message)))(text, options);

    if (!result || result.status === "error") {
        toast("No se pudo enviar la cobertura automática.", {
            title: "Cobertura automática",
            variant: "warn"
        });
        return;
    }

    if (result.status === "disabled") {
        toast(
            "La solicitud de aprobación al trabajador está desactivada en la configuración del entorno.",
            { title: "Cobertura automática", variant: "warn" }
        );
        return;
    }

    if (result.status === "nothing-to-cover") {
        toast("Ese turno ya no necesita cobertura.", {
            title: "Cobertura automática",
            variant: "warn"
        });
        return;
    }

    if (result.status === "canceled" || result.status === "invalid") {
        toast("No se pudo calcular los candidatos de ese turno.", {
            title: "Cobertura automática",
            variant: "warn"
        });
        return;
    }

    if (result.status === "no-targets") {
        // "Nadie puede cubrir" y "todos pasarian las 40 horas" son cosas
        // distintas: la segunda se resuelve repartiendo el turno, no buscando
        // mas gente.
        const motivo = !result.candidates
            ? (result.overLimit
                ? `Los ${result.overLimit} candidatos superarían las 40 horas extras diurnas del mes con este turno.`
                : "No hay trabajadores que puedan cubrir ese turno.")
            : result.alreadyPending
                ? "Los candidatos con la app enlazada ya tienen una solicitud pendiente."
                : "Ninguno de los candidatos tiene la app enlazada para recibir la solicitud.";

        toast(motivo, { title: "Cobertura automática", variant: "warn" });
        return;
    }

    const extra = [
        result.overLimit
            ? `${result.overLimit} superarían las 40 h extras diurnas`
            : "",
        result.withoutApp ? `${result.withoutApp} sin app` : "",
        result.alreadyPending ? `${result.alreadyPending} ya tenían solicitud` : ""
    ].filter(Boolean).join(" · ");

    toast(
        `Solicitud enviada a ${result.sent} trabajador(es)${extra ? `. ${extra}.` : "."}`,
        { title: "Cobertura automática", variant: "good" }
    );
}

function reRenderBirthdays(panel) {
    const { heading, count, list } = birthdaysBody();
    const monthEl = panel.querySelector('[data-hm="bday-month"]');
    const countEl = panel.querySelector('[data-hm="bday-count"]');
    const listEl = panel.querySelector('[data-hm="bday-list"]');

    if (monthEl) monthEl.textContent = heading;
    if (countEl) countEl.textContent = String(count);
    if (listEl) listEl.innerHTML = list;
}

function reRenderCoverage(panel) {
    // Por el interruptor, no por el ancho: la tarjeta cambio de columnas al
    // pasar al tablero de tres y un selector por .hm-col-N vuelve a romperse
    // en el proximo ajuste de layout.
    const card = panel.querySelector('[data-hm="cob-detail"]')?.closest(".hm-card");
    if (!card) return;
    const summary = card.querySelector(".hm-cob-summary");
    const list = card.querySelector(".hm-cob-list");

    if (summary) summary.hidden = coverageDetail;
    if (list) list.hidden = !coverageDetail;
}

function reRenderRequestsSummary(panel) {
    const control = panel.querySelector('[data-hm="req-detail"]');
    const card = control?.closest(".hm-card");
    if (!card) return;

    const summary = card.querySelector(".hm-req-summary");
    const list = card.querySelector(".hm-req-list");

    if (summary) summary.hidden = requestsDetail;
    if (list) list.hidden = !requestsDetail;
}

// Refresca solo el listado de tareas (para el sync remoto de Firestore).
export function refreshHomeTasks() {
    const list = document.getElementById("homePanel")
        ?.querySelector('[data-hm="tasks-list"]');
    if (list) list.innerHTML = tasksListHTML();
}

export function renderHomePanel() {
    const panel = document.getElementById("homePanel");
    if (!panel) return;

    panel.innerHTML = homeHTML();
    wire(panel);

    // La tarjeta del dia tambien filtra por "Diario Hábil": sin los feriados
    // cargados, una tarea habil apareceria en un feriado hasta el repintado.
    const year = new Date().getFullYear();

    void ensureHolidaysLoaded(year, () => {
        const list = panel.querySelector('[data-hm="tasks-list"]');

        if (list) list.innerHTML = tasksListHTML();
    });
}
