// Home / "Inicio": resumen diario del supervisor. Vista de agregacion que
// reune modulos ya existentes (dotacion, ausencias, cambios, cobertura,
// mensajes). Este primer incremento cablea el saludo, la fecha, el nombre del
// supervisor (pie de firma) y la unidad; el resto de los widgets se muestran con
// datos de ejemplo y se cablearan a su modulo en los siguientes pasos.
//
// IMPORTANTE: todas las clases van con prefijo "hm-" para no colisionar con el
// CSS global del app (que ya usa .panel, .list, .count, .stat, etc.).

import { escapeHTML } from "./htmlUtils.js";
import {
    getReportSignatureConfig,
    getProfiles,
    isProfileActive,
    isNoCoverageDay,
    getShiftAssigned
} from "./storage.js";
import { getJSON } from "./persistence.js";
import { keyFromDate } from "./dateUtils.js";
import { getTurnoBase, getTurnoReal } from "./turnEngine.js";
import {
    requiereReemplazoTurnoBase,
    getAbsenceType,
    esAusenciaInjustificada
} from "./rulesEngine.js";
import { getReplacementForCoveredShift } from "./replacements.js";
import {
    getPreassignmentForCoveredShift,
    getPreassignments
} from "./preassignments.js";
import { cambiosDelMes, cambioEstaAnulado } from "./swaps.js";
import { TURNO_LABEL, ESTAMENTO, TURNO } from "./constants.js";
import { getHomeTasks, saveHomeTasks } from "./homeTasks.js";
import { getActiveWorkspace } from "./workspaces.js";

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
    "Una sola vez", "Diario", "Semanal", "Mensual", "Trimestral", "Cuatrimestral", "Anual"
];
const ALERT_OPTS = [
    "Sin alerta", "Al momento", "5 minutos antes", "15 minutos antes", "30 minutos antes", "1 hora antes"
];
let editingTaskId = "";

function optionsHTML(opts, selected) {
    return opts.map(o => `<option ${o === selected ? "selected" : ""}>${esc(o)}</option>`).join("");
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let coverageDetail = false;
// Datos de cobertura calculados una vez por render (para no recalcular al
// alternar el switch de detalles).
let coverageData = { uncovered: [], preassigned: [] };

function getSupervisorName() {
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

function shortName(full) {
    return String(full || "").split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
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

    det.estamentos.forEach(est => {
        const e = det.byEstamento[est];
        byEstamento[est] = { dia: e.dia.length, noche: e.noche.length };
        const unique = new Set([
            ...e.dia.map(x => x.name),
            ...e.noche.map(x => x.name)
        ]);
        total += unique.size;
    });

    return { byEstamento, estamentos: det.estamentos, total };
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
                reason: absenceLabelForDay(profile.name, keyDay),
                candidates: getAvailableCandidates(profile, keyDay).slice(0, 3)
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

// Stat cards: una tarjeta por estamento en servicio hoy (colores en ciclo),
// luego "Plan del día" (total del día) y "Pendientes".
function statsSection() {
    const dot = getDotacionHoy();
    const tones = ["violet", "blue", "green", "amber"];

    const estCards = dot.estamentos.length
        ? dot.estamentos.map((est, i) => {
            const e = dot.byEstamento[est];
            return dotacionCard(tones[i % tones.length], est, e.dia, e.noche);
        }).join("")
        : statCard("violet", IC.users, "En servicio hoy", 0, "sin dotación hoy");

    return `
        ${estCards}
        ${statCard("green", IC.calendar, "Plan del día", dot.total, "turnos programados")}
        ${statCard("amber", IC.clipboard, "Pendientes", 7, "tareas pendientes")}`;
}

function panelLink(text) {
    return `<button class="hm-link" type="button">${text} ${svg(IC.chevron, 'stroke-width="2.2"')}</button>`;
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
    const done = t.doneDate === todayISO();
    return `
        <div class="hm-task ${done ? "is-done" : ""}" data-hm="task-row" data-id="${esc(t.id)}" role="button" tabindex="0" title="Modificar tarea">
            <button class="hm-task-check" type="button" data-hm="task-toggle" data-id="${esc(t.id)}" aria-pressed="${done ? "true" : "false"}" aria-label="Marcar como realizada">${svg(IC.check, 'stroke-width="3"')}</button>
            <span class="hm-task-name">${esc(t.name)}</span>
            <span class="hm-task-time">${esc(t.time)}</span>
        </div>`;
}

function tasksListHTML() {
    const tasks = getHomeTasks();
    if (!tasks.length) {
        return `<div class="hm-empty">Sin tareas. Agrégalas con el botón +.</div>`;
    }
    return tasks.map(taskRowHTML).join("");
}

function tareasWidget() {
    const addBtn = `<button class="hm-gear" type="button" data-hm="tasks-add" aria-label="Agregar tarea" title="Agregar tarea">${svg(IC.plus, 'stroke-width="2.4"')}</button>`;
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(IC.checkClip, "Tareas diarias", addBtn)}
            <div class="hm-listcol" data-hm="tasks-list">${tasksListHTML()}</div>
            ${panelLink("Ver todas las tareas")}
        </div>`;
}

function ausenciasWidget() {
    const items = getTodayAbsences();
    const body = items.length
        ? items.map(item => {
            const chip = item.uncovered > 0
                ? `<span class="hm-uncov">${item.uncovered} sin cubrir</span>`
                : "";
            return `
                <div class="hm-kv">
                    <span class="hm-kv-ico hm-${item.tone}">${svg(IC[item.icon])}</span>
                    <span class="hm-kv-name">${esc(item.label)}</span>
                    <span class="hm-kv-right">${chip}<span class="hm-kv-num hm-${item.tone}">${item.total}</span></span>
                </div>`;
        }).join("")
        : `<div class="hm-empty">Sin ausencias registradas hoy.</div>`;
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(IC.users, "Ausencias del día")}
            <div class="hm-listcol">${body}</div>
            ${panelLink("Ver todas las ausencias")}
        </div>`;
}

function resumenWidget() {
    const swapCount = getMonthSwaps().length;
    const dotacion = getDotacionHoy().total;
    function row(tone, name, val) {
        return `<div class="hm-sum hm-sum--${tone}"><span>${name}</span><span class="hm-sum-val">${val}</span></div>`;
    }
    return `
        <div class="hm-card hm-col-4">
            ${panelHead(IC.bars, "Resumen rápido")}
            <div class="hm-listcol hm-listcol--gap">
                ${row("info", "Turnos programados", dotacion)}
                ${row("good", "En servicio hoy", dotacion)}
                ${row("warn", "Pendientes", 7)}
                ${row("accent", "Cambios de turno", swapCount)}
            </div>
            ${panelLink("Ver calendario")}
        </div>`;
}

function cambiosWidget() {
    const swaps = getMonthSwaps();
    const body = swaps.length
        ? swaps.slice(0, 6).map(swap => {
            const turno = TURNO_LABEL[Number(swap.turno)] || "";
            const meta = [turno, formatShortDate(swap.fecha)].filter(Boolean).join(" · ");
            return `
                <div class="hm-swap">
                    <span class="hm-swap-tag">${esc(shortName(swap.from))}</span>
                    <span class="hm-swap-arrow">${svg(IC.arrowRight, 'stroke-width="2.2"')}</span>
                    <span class="hm-swap-tag">${esc(shortName(swap.to))}</span>
                    <span class="hm-swap-count">${esc(meta)}</span>
                </div>`;
        }).join("")
        : `<div class="hm-empty">Sin cambios de turno este mes.</div>`;
    return `
        <div class="hm-card hm-col-5">
            ${panelHead(IC.swap, "Cambios de turno", `<span class="hm-count">${swaps.length}</span>`)}
            <div class="hm-listcol">${body}</div>
            ${panelLink("Ver todos los cambios")}
        </div>`;
}

function coberturaRow(item, kind) {
    const status = kind === "sincubrir"
        ? '<span class="hm-cob-status hm-cob-status--sincubrir">Sin cubrir</span>'
        : '<span class="hm-cob-status hm-cob-status--preasignado">Preasignado</span>';
    const third = kind === "sincubrir"
        ? (item.candidates.length
            ? `<div class="hm-cob-meta"><b>Podría cubrir:</b> ${esc(item.candidates.join(", "))}</div>`
            : '<div class="hm-cob-meta"><span class="hm-cob-none">Sin candidatos disponibles</span></div>')
        : `<div class="hm-cob-meta"><b>Preasignado:</b> ${esc(item.assigned)}</div>`;
    const reason = item.reason ? ` · ${esc(item.reason)}` : "";
    return `
        <div class="hm-cob-row">
            <div class="hm-cob-top">
                <span class="hm-turno hm-turno--${item.turnoClass}">${esc(item.turnoLabel)}</span>
                <span class="hm-cob-date">${esc(item.dateLabel)}</span>
                ${status}
            </div>
            <div class="hm-cob-meta"><b>Origina:</b> ${esc(item.origin)}${reason}</div>
            ${third}
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
        <div class="hm-card hm-col-7">
            ${panelHead(IC.shield, "Cobertura de turnos", `<span class="hm-count">${total}</span>`)}
            <div class="hm-cob-controls">
                <label class="hm-toggle"><input type="checkbox" data-hm="cob-detail" ${coverageDetail ? "checked" : ""}> Ver detalles</label>
            </div>
            <div class="hm-cob-summary" ${coverageDetail ? "hidden" : ""}>${summary}</div>
            <div class="hm-cob-list" ${coverageDetail ? "" : "hidden"}>${list}</div>
            ${panelLink("Ir a cobertura de turnos")}
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
                            <select data-hm="nt-repeat">
                                <option>Una sola vez</option>
                                <option selected>Diario</option>
                                <option>Semanal</option>
                                <option>Mensual</option>
                                <option>Trimestral</option>
                                <option>Cuatrimestral</option>
                                <option>Anual</option>
                            </select>
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
        <div class="hm-modal-backdrop" data-hm="task-edit-modal" hidden>
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
                    <div class="hm-date">
                        <span class="hm-date-ico">${svg(IC.calendar)}</span>
                        <span><small>Hoy es</small><strong>${esc(todayLabel())}</strong></span>
                    </div>
                </div>
                <div class="hm-highlight">
                    <span class="hm-highlight-big">66</span>
                    <p>Organización hoy, mejores resultados siempre.</p>
                </div>
            </section>

            <section class="hm-stats">
                ${statsSection()}
            </section>

            <section class="hm-grid">
                ${tareasWidget()}
                ${ausenciasWidget()}
                ${resumenWidget()}
            </section>

            <section class="hm-grid">
                ${cambiosWidget()}
                ${coberturaWidget()}
            </section>

            <div class="hm-note">
                ${svg('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>', 'width="18" height="18"')}
                <span><b>Datos reales:</b> tareas (por usuario, con alerta sonora), dotación, ausencias, cambios de turno y cobertura.</span>
            </div>
        </div>
        ${tasksModal()}
        ${taskEditModal()}
        ${dotacionModal()}`;
}

// ---- Interactividad ----
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
        if (tasksList) tasksList.innerHTML = tasksListHTML();
    };

    // --- Tareas: visto (toggle realizada) + click en la fila (modificar) ---
    if (tasksList) {
        tasksList.addEventListener("click", event => {
            const toggle = event.target.closest('[data-hm="task-toggle"]');
            if (toggle) {
                const id = toggle.dataset.id;
                const tasks = getHomeTasks();
                const task = tasks.find(t => t.id === id);
                if (task) {
                    const today = todayISO();
                    task.doneDate = task.doneDate === today ? "" : today;
                    saveHomeTasks(tasks);
                    refreshTasks();
                }
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
                    saveHomeTasks(getHomeTasks().filter(t => t.id !== editingTaskId));
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
        addOpen.addEventListener("click", () => {
            modal.hidden = false;
            modal.querySelector('[data-hm="nt-name"]')?.focus();
        });
        modal.addEventListener("click", event => {
            if (event.target === modal || event.target.closest('[data-hm="close"]')) {
                modal.hidden = true;
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
                    doneDate: ""
                });
                tasks.sort((a, b) => a.time.localeCompare(b.time));
                saveHomeTasks(tasks);
                refreshTasks();
                modal.hidden = true;
            }
        });
    }

    // --- Dotación: click en una stat card -> modal con día/noche + horario ---
    const stats = panel.querySelector(".hm-stats");
    const dotModal = panel.querySelector('[data-hm="dotacion-modal"]');
    if (stats) {
        stats.addEventListener("click", event => {
            const card = event.target.closest('[data-hm="dotacion"]');
            if (card) openDotacion(panel, card.dataset.est);
        });
        stats.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            const card = event.target.closest('[data-hm="dotacion"]');
            if (!card) return;
            event.preventDefault();
            openDotacion(panel, card.dataset.est);
        });
    }
    if (dotModal) {
        dotModal.addEventListener("click", event => {
            if (event.target === dotModal || event.target.closest('[data-hm="close"]')) {
                dotModal.hidden = true;
            }
        });
    }

    // --- Cobertura: switch de detalles (siempre muestra sin cubrir + preasignados) ---
    const detail = panel.querySelector('[data-hm="cob-detail"]');
    if (detail) {
        detail.addEventListener("change", () => {
            coverageDetail = detail.checked;
            reRenderCoverage(panel);
        });
    }
}

function reRenderCoverage(panel) {
    const card = panel.querySelector(".hm-card.hm-col-7");
    if (!card) return;
    const summary = card.querySelector(".hm-cob-summary");
    const list = card.querySelector(".hm-cob-list");

    if (summary) summary.hidden = coverageDetail;
    if (list) list.hidden = !coverageDetail;
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
}
