import {
    getShiftAssigned,
    getCurrentProfile,
    getValorHora
} from "./storage.js";

import { aplicarCambiosTurno } from "./turnEngine.js";

import {
    calcHours,
    isBusinessDay,
    calcCarry
} from "./calculations.js";

function key(y, m, d) {
    return `${y}-${m}-${d}`;
}

export function calcularHorasMes(
    y,
    m,
    days,
    holidays,
    data,
    blocked,
    carryIn
) {
    return calcularHorasMesPerfil(
        getCurrentProfile(),
        y,
        m,
        days,
        holidays,
        data,
        blocked,
        carryIn
    );
}

export function calcularHorasMesPerfil(
    nombre,
    y,
    m,
    days,
    holidays,
    data,
    blocked,
    carryIn
) {

    let totalD = carryIn?.d || 0;
    let totalN = carryIn?.n || 0;

    let businessDays = 0;

    for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d);
        const k = key(y, m, d);

        let state = Number(data[k]) || 0;

        state = aplicarCambiosTurno(
            nombre,
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
        getShiftAssigned(nombre) ? 0 : totalN;

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
            nombre,
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

export function renderSummaryHTML(stats) {
    const valorHora =
        getValorHora();

    const pagoDiurno =
        stats.hheeDiurnas *
        1.25 *
        valorHora;

    const pagoNocturno =
        stats.hheeNocturnas *
        1.5 *
        valorHora;

    const currency = new Intl.NumberFormat(
        "es-CL",
        {
            maximumFractionDigits: 0
        }
    );

    return `
        <div class="summary-grid">
            <article class="summary-card">
                <span class="summary-label">Diurnas</span>
                <strong class="summary-value">${stats.hheeDiurnas}h</strong>
                <span class="summary-amount">$${currency.format(pagoDiurno)}</span>
            </article>

            <article class="summary-card">
                <span class="summary-label">Nocturnas</span>
                <strong class="summary-value">${stats.hheeNocturnas}h</strong>
                <span class="summary-amount">$${currency.format(pagoNocturno)}</span>
            </article>
        </div>

        <div class="summary-footnote">
            <span>Total trabajado: ${stats.totalD}h diurnas / ${stats.totalN}h nocturnas</span>
            <span>Base del mes: ${stats.horasHabiles}h</span>
        </div>
    `;
}

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
