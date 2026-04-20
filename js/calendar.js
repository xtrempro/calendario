// js/calendar.js
import { aplicarCambiosTurno } from "./shiftEngine.js";
import {
    calcularHorasMes,
    renderSummaryHTML,
    calcularCarryMes
} from "./hoursEngine.js";
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
import {
    tieneAusencia,
    obtenerLabelDia,
    aplicarClasesEspeciales,
    estaBloqueadoModo
} from "./rulesEngine.js";
import { fetchHolidays } from "./holidays.js";

import {
    calcHours,
    isBusinessDay,
    isWeekend,
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

function aplicarClaseTurno(div, state) {
    if (state === 1) div.classList.add("green");
    if (state === 2) div.classList.add("blue");
    if (state === 3) div.classList.add("purple");
    if (state === 4) div.classList.add("lightgreen");
    if (state === 5) div.classList.add("yellow");
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
            absences,
            aplicarClaseTurno
        );

        const bloqueado = estaBloqueadoModo(
            window.selectionMode,
            keyDay,
            state,
            isHab,
            admin,
            legal,
            comp,
            absences,
            getShiftAssigned()
            );

            if (window.selectionMode) {
            div.classList.add(
            bloqueado
            ? "mpa-disabled"
            : "mpa-enabled"
        );
}

        const hrs = calcHours(date, state, holidays);

        const label = obtenerLabelDia(
            keyDay,
            state,
            admin,
            legal,
            comp,
            absences,
            turnoLabel
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
    const carryOut = calcularCarryMes(
    y,
    m,
    days,
    holidays,
    data
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

    summary.innerHTML = renderSummaryHTML(stats);

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