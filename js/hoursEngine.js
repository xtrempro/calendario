// js/hoursEngine.js

import {
    getShiftAssigned,
    getCurrentProfile
} from "./storage.js";

import { aplicarCambiosTurno } from "./shiftEngine.js";

import {
    calcHours,
    isBusinessDay,
    calcCarry
} from "./calculations.js";

/* ======================================================
   HELPERS
====================================================== */

function key(y, m, d) {
    return `${y}-${m}-${d}`;
}

/* ======================================================
   HORAS DEL MES
====================================================== */

export function calcularHorasMes(
    y,
    m,
    days,
    holidays,
    data,
    blocked,
    carryIn
) {
    const perfilActual = getCurrentProfile();

    let totalD = carryIn?.d || 0;
    let totalN = carryIn?.n || 0;

    let businessDays = 0;

    for (let d = 1; d <= days; d++) {

        const date = new Date(y, m, d);
        const k = key(y, m, d);

        let state = Number(data[k]) || 0;

        state = aplicarCambiosTurno(
            perfilActual,
            k,
            state
        );

        if (isBusinessDay(date, holidays)) {
            businessDays++;
        }

        const hrs = calcHours(
            date,
            state,
            holidays
        );

        totalD += hrs.d;
        totalN += hrs.n;
    }

    const horasHabiles =
        Math.round(businessDays * 8.8);

    let hheeDiurnas =
        horasHabiles - totalD;

    if (hheeDiurnas < 0) {
        hheeDiurnas = 0;
    }

    let hheeNocturnas =
        getShiftAssigned() ? 0 : totalN;

    /* ==========================================
       DESCUENTO DIAS BLOQUEADOS
    ========================================== */

    Object.keys(blocked).forEach(k => {

        if (!blocked[k]) return;

        const p = k.split("-");

        const date = new Date(
            Number(p[0]),
            Number(p[1]),
            Number(p[2])
        );

        let state = Number(data[k]) || 0;

        state = aplicarCambiosTurno(
            perfilActual,
            k,
            state
        );

        const hrs = calcHours(
            date,
            state,
            holidays
        );

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

/* ======================================================
   RESUMEN HTML
====================================================== */

export function renderSummaryHTML(stats) {

    const valorHora =
        Number(localStorage.getItem("valorHora")) || 0;

    const pagoDiurno =
        stats.hheeDiurnas *
        1.25 *
        valorHora;

    const pagoNocturno =
        stats.hheeNocturnas *
        1.5 *
        valorHora;

    return `
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
   CARRY MES SIGUIENTE
====================================================== */

export function calcularCarryMes(
    y,
    m,
    days,
    holidays,
    data
) {
    const perfilActual =
        getCurrentProfile();

    const lastKey =
        key(y, m, days);

    let state =
        Number(data[lastKey]) || 0;

    state = aplicarCambiosTurno(
        perfilActual,
        lastKey,
        state
    );

    return calcCarry(
        new Date(y, m, days),
        state,
        holidays
    );
}