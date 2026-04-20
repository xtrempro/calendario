// js/calendar.js
import { aplicarCambiosTurno } from "./shiftEngine.js";
import {
    getProfileData,
    saveProfileData,
    getCarry,
    saveCarry,
    getBlockedDays,
    getAdminDays,
    getLegalDays,
    getAbsences,
    getCompDays,
    getShiftAssigned,
    getCurrentProfile
} from "./storage.js";

import { fetchHolidays } from "./holidays.js";

import {
    calcHours,
    isBusinessDay,
    isWeekend,
    calcCarry
} from "./calculations.js";

import { renderTimeline } from "./timeline.js";

/* ======================================================
   ESTADO GLOBAL
====================================================== */

export let currentDate = new Date();

/* ======================================================
   HELPERS
====================================================== */

function key(y, m, d) {
    return `${y}-${m}-${d}`;
}

function turnoLabel(state) {
    return ["", "Larga", "Noche", "24", "Diurno", "D+N"][state] || "";
}

function tieneAusencia(keyDay, admin, legal, comp, absences) {
    return (
        admin[keyDay] ||
        legal[keyDay] ||
        comp[keyDay] ||
        absences[keyDay]
    );
}

function aplicarClaseTurno(div, state) {
    if (state === 1) div.classList.add("green");
    if (state === 2) div.classList.add("blue");
    if (state === 3) div.classList.add("purple");
    if (state === 4) div.classList.add("lightgreen");
    if (state === 5) div.classList.add("yellow");
}

function aplicarClasesEspeciales(
    div,
    keyDay,
    state,
    isHab,
    isW,
    isH,
    admin,
    legal,
    comp,
    absences
) {
    if (isW) div.classList.add("weekend");
    if (isH) div.classList.add("holiday");

    aplicarClaseTurno(div, state);

    if ((isW || isH) && state > 0) {
        div.classList.add("inactive-selected");
    }

    if (admin[keyDay] === 1) {
        div.classList.add("admin-day");
    }

    if (
        admin[keyDay] === "0.5M" ||
        admin[keyDay] === "0.5T" ||
        admin[keyDay] === 0.5
    ) {
        div.classList.add("half-admin-day");
    }

    if (absences[keyDay]?.type === "license") {
        div.classList.add("license-day");
    }

    if (legal[keyDay]) {
        div.classList.add(state > 0 || isHab ? "legal-day" : "legal-soft");
    }

    if (comp[keyDay]) {
        div.classList.add(state > 0 || isHab ? "comp-day" : "comp-soft");
    }
}

function aplicarModoSeleccion(
    div,
    keyDay,
    state,
    isHab,
    admin,
    legal,
    comp,
    absences
) {
    if (window.selectionMode === "halfadmin") {
        const bloqueado =
            !isHab ||
            state === 0 ||
            state === 2 ||
            tieneAusencia(keyDay, admin, legal, comp, absences);

        div.classList.add(
            bloqueado ? "mpa-disabled" : "mpa-enabled"
        );
    }

    if (window.selectionMode === "admin") {
        let bloqueado = false;

        if (getShiftAssigned()) {
            bloqueado =
                state === 0 ||
                tieneAusencia(keyDay, admin, legal, comp, absences);
        } else {
            bloqueado =
                !isHab ||
                tieneAusencia(keyDay, admin, legal, comp, absences);
        }

        div.classList.add(
            bloqueado ? "mpa-disabled" : "mpa-enabled"
        );
    }
}

function obtenerLabel(
    keyDay,
    state,
    admin,
    legal,
    comp,
    absences
) {
    let label = turnoLabel(state);

    if (admin[keyDay] === 1) label = "ADM";
    if (admin[keyDay] === "0.5M") label = "1/2M";
    if (admin[keyDay] === "0.5T") label = "1/2T";
    if (admin[keyDay] === 0.5) label = "1/2";

    if (legal[keyDay]) label = "FL";
    if (comp[keyDay]) label = "FC";
    if (absences[keyDay]?.type === "license") label = "LM";

    return label;
}

function siguienteTurno(state, isHab) {
    let s = state;

    do {
        s++;
        if (s > 5) s = 0;
    } while ((s === 4 || s === 5) && !isHab);

    return s;
}

/* ======================================================
   HORAS / RESUMEN
====================================================== */

function calcularHorasMes(
    y,
    m,
    days,
    holidays,
    data,
    blocked,
    carryIn
) {
    let totalD = carryIn.d;
    let totalN = carryIn.n;
    let businessDays = 0;

    for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d);
        const k = key(y, m, d);
        const perfilActual = getCurrentProfile();

        let state = Number(data[k]) || 0;

        state = aplicarCambiosTurno(
        perfilActual,
        k,
        state
        );

        if (isBusinessDay(date, holidays)) {
            businessDays++;
        }

        const hrs = calcHours(date, state, holidays);
        totalD += hrs.d;
        totalN += hrs.n;
    }

    const horasHabiles = Math.round(businessDays * 8.8);

    let hheeDiurnas = horasHabiles - totalD;
    if (hheeDiurnas < 0) hheeDiurnas = 0;

    let hheeNocturnas = getShiftAssigned() ? 0 : totalN;

    Object.keys(blocked).forEach(k => {
        if (!blocked[k]) return;

        const p = k.split("-");
        const date = new Date(
            Number(p[0]),
            Number(p[1]),
            Number(p[2])
        );

        const state = data[k] || 0;

        const hrs = calcHours(date, state, holidays);

        hheeDiurnas -= hrs.d;
        hheeNocturnas -= hrs.n;
    });

    if (hheeDiurnas < 0) hheeDiurnas = 0;
    if (hheeNocturnas < 0) hheeNocturnas = 0;

    return {
        totalD,
        totalN,
        horasHabiles,
        hheeDiurnas,
        hheeNocturnas
    };
}

function renderSummary(summary, stats) {
    const valorHora =
        Number(localStorage.getItem("valorHora")) || 0;

    const pagoDiurno =
        stats.hheeDiurnas * 1.25 * valorHora;

    const pagoNocturno =
        stats.hheeNocturnas * 1.5 * valorHora;

    summary.innerHTML = `
        <div>🌞 Diurnas: ${stats.totalD}h</div>
        <div>🌙 Nocturnas: ${stats.totalN}h</div>
        <div>📊 Horas hábiles: ${stats.horasHabiles}h</div>

        <hr>

        <div>🟢 HHEE Diurnas: ${stats.hheeDiurnas}h</div>
        <div>💰 Pago HHEE Diurnas: $${pagoDiurno.toFixed(0)}</div>

        <hr>

        <div>🌜 HHEE Nocturnas: ${stats.hheeNocturnas}h</div>
        <div>💰 Pago HHEE Nocturnas: $${pagoNocturno.toFixed(0)}</div>
    `;
}

/* ======================================================
   CLICK CELDA
====================================================== */

async function clickDia(
    keyDay,
    state,
    isHab,
    data,
    admin,
    legal,
    comp,
    absences
) {
    if (window.selectionMode === "halfadmin") return;
    if (window.selectionMode) return;

    if (
        tieneAusencia(
            keyDay,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        return;
    }

    const nuevo = siguienteTurno(state, isHab);

    if (window.pushUndoState) {
        window.pushUndoState(
            `Cambio ${keyDay}: ${turnoLabel(state)} → ${turnoLabel(nuevo)}`
        );
    }

    data[keyDay] = nuevo;
    saveProfileData(data);

    await renderCalendar();
}

/* ======================================================
   RENDER CALENDARIO
====================================================== */

export async function renderCalendar() {
    const cal = document.getElementById("calendar");
    const summary = document.getElementById("summary");
    const monthYear = document.getElementById("monthYear");

    if (!cal) return;

    cal.replaceChildren();

    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();

    const data = getProfileData();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();

    const holidays = await fetchHolidays(y);
    const carryIn = getCarry(y, m);

    monthYear.innerText = currentDate.toLocaleString(
        "es-ES",
        {
            month: "long",
            year: "numeric"
        }
    );

    const first =
        (new Date(y, m, 1).getDay() + 6) % 7;

    const days =
        new Date(y, m + 1, 0).getDate();

    for (let i = 0; i < first; i++) {
        cal.innerHTML += "<div></div>";
    }

    for (let d = 1; d <= days; d++) {
        const keyDay = key(y, m, d);

        const perfilActual = getCurrentProfile();
        let state = Number(data[keyDay]) || 0;
        state = aplicarCambiosTurno(
        perfilActual,
        keyDay,
        state
        );
        


        const date = new Date(y, m, d);

        const isW = isWeekend(date);
        const isH = holidays[keyDay];
        const isHab = isBusinessDay(date, holidays);

        const div = document.createElement("div");

        div.classList.add("day");

        div.dataset.day = d;
        div.dataset.month = m;
        div.dataset.year = y;

        aplicarClasesEspeciales(
            div,
            keyDay,
            state,
            isHab,
            isW,
            isH,
            admin,
            legal,
            comp,
            absences
        );

        aplicarModoSeleccion(
            div,
            keyDay,
            state,
            isHab,
            admin,
            legal,
            comp,
            absences
        );

        const hrs = calcHours(date, state, holidays);

        const label = obtenerLabel(
            keyDay,
            state,
            admin,
            legal,
            comp,
            absences
        );

        div.innerHTML = `${d}<br>${label}`;

        div.title =
            `Diurnas:${hrs.d} Nocturnas:${hrs.n}`;

        div.onclick = async () => {
            await clickDia(
                keyDay,
                state,
                isHab,
                data,
                admin,
                legal,
                comp,
                absences
            );
        };

        cal.appendChild(div);
    }

    /* carry */

    const lastKey = key(y, m, days);
    const perfilActual = getCurrentProfile();

    const lastState = aplicarCambiosTurno(
    perfilActual,
    lastKey,
    Number(data[lastKey]) || 0
    );

    const carryOut = calcCarry(
        new Date(y, m, days),
        lastState,
        holidays
    );

    const next = new Date(y, m + 1, 1);

    saveCarry(
        next.getFullYear(),
        next.getMonth(),
        carryOut
    );

    /* resumen */

    const stats = calcularHorasMes(
        y,
        m,
        days,
        holidays,
        data,
        blocked,
        carryIn
    );

    renderSummary(summary, stats);

    /* timeline */

    renderTimeline();
}

/* ======================================================
   NAVEGACION
====================================================== */

export function prevMonth() {
    currentDate.setMonth(
        currentDate.getMonth() - 1
    );

    renderCalendar();
}

export function nextMonth() {
    currentDate.setMonth(
        currentDate.getMonth() + 1
    );

    renderCalendar();
}