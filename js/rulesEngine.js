// js/rulesEngine.js

/* ======================================================
   RULES ENGINE
   Centraliza ausencias, bloqueos y etiquetas especiales
   SIN romper funcionalidades actuales
====================================================== */

import { MODO, TURNO } from "./constants.js";
import { isBusinessDay } from "./calculations.js";

/* ======================================================
   HELPERS
====================================================== */

export function tieneAusencia(
    keyDay,
    admin,
    legal,
    comp,
    absences
) {
    return (
        admin[keyDay] ||
        legal[keyDay] ||
        comp[keyDay] ||
        absences[keyDay]
    );
}

function normalizeText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function getAbsenceText(absence) {
    if (!absence) return "";

    if (typeof absence === "string") {
        return absence;
    }

    return [
        absence.type,
        absence.kind,
        absence.label,
        absence.name,
        absence.code
    ]
        .filter(Boolean)
        .join(" ");
}

function parseKey(keyDay) {
    const parts = String(keyDay || "").split("-");

    return new Date(
        Number(parts[0]),
        Number(parts[1]),
        Number(parts[2])
    );
}

function diasEntre(a, b) {
    return Math.floor((a - b) / 86400000);
}

function ultimoDiaRegistradoHasta(map, keyDay) {
    const target = parseKey(keyDay);
    let ultimo = null;

    Object.keys(map || {}).forEach(key => {
        const date = parseKey(key);

        if (Number.isNaN(date.getTime())) return;
        if (date > target) return;

        if (!ultimo || date > ultimo) {
            ultimo = date;
        }
    });

    return ultimo;
}

export function esMedioAdministrativo(value) {
    return (
        value === "0.5M" ||
        value === "0.5T" ||
        value === 0.5
    );
}

export function esAusenciaInjustificada(absence) {
    const text = normalizeText(getAbsenceText(absence));

    return (
        text.includes("injustificada") ||
        text.includes("injustificado") ||
        text.includes("unjustified")
    );
}

function bloqueaAdministrativoPorAusencia(absence) {
    if (!absence) return false;

    return !esAusenciaInjustificada(absence);
}

function bloqueaCompensatorioPorAusencia(absence) {
    if (!absence) return false;

    return !esAusenciaInjustificada(absence);
}

export function esTurnoAdministrativoValido(state) {
    const turno = Number(state) || TURNO.LIBRE;

    return (
        turno === TURNO.LARGA ||
        turno === TURNO.NOCHE
    );
}

export function puedeAplicarAdministrativo(
    keyDay,
    state,
    isHab,
    admin,
    legal,
    comp,
    absences,
    shiftAssigned
) {
    if (legal[keyDay] || comp[keyDay]) {
        return false;
    }

    if (admin[keyDay] && !esMedioAdministrativo(admin[keyDay])) {
        return false;
    }

    if (bloqueaAdministrativoPorAusencia(absences[keyDay])) {
        return false;
    }

    if (!esTurnoAdministrativoValido(state)) {
        return false;
    }

    if (!shiftAssigned && !isHab) {
        return false;
    }

    return true;
}

export function puedeIniciarLegal(
    keyDay,
    isHab,
    admin,
    legal,
    comp,
    absences
) {
    if (!isHab) {
        return false;
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
        return false;
    }

    return true;
}

export function bloqueaCompensatorioPorLegal(keyDay, legal) {
    const ultimoLegal = ultimoDiaRegistradoHasta(legal, keyDay);

    if (!ultimoLegal) return false;

    return diasEntre(parseKey(keyDay), ultimoLegal) < 90;
}

export function tieneBloqueoCompensatorio(
    keyDay,
    admin,
    legal,
    comp,
    absences
) {
    if (admin[keyDay] || legal[keyDay] || comp[keyDay]) {
        return true;
    }

    return bloqueaCompensatorioPorAusencia(absences[keyDay]);
}

export function puedeIniciarCompensatorio(
    keyDay,
    isHab,
    admin,
    legal,
    comp,
    absences
) {
    return (
        isHab &&
        !bloqueaCompensatorioPorLegal(keyDay, legal) &&
        !tieneBloqueoCompensatorio(
            keyDay,
            admin,
            legal,
            comp,
            absences
        )
    );
}

export function puedeAplicarCompensatorioDesde(
    keyDay,
    cantidad,
    holidays,
    admin,
    legal,
    comp,
    absences
) {
    const total = Number(cantidad);

    if (!total || total <= 0 || !Number.isInteger(total)) {
        return false;
    }

    const start = parseKey(keyDay);

    if (
        Number.isNaN(start.getTime()) ||
        !isBusinessDay(start, holidays)
    ) {
        return false;
    }

    if (bloqueaCompensatorioPorLegal(keyDay, legal)) {
        return false;
    }

    let usados = 0;
    let guard = 0;
    const cursor = new Date(start);

    while (usados < total && guard < 370) {
        const currentKey =
            `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;

        if (
            tieneBloqueoCompensatorio(
                currentKey,
                admin,
                legal,
                comp,
                absences
            )
        ) {
            return false;
        }

        if (isBusinessDay(cursor, holidays)) {
            usados++;
        }

        cursor.setDate(cursor.getDate() + 1);
        guard++;
    }

    return usados === total;
}

/* ======================================================
   LABEL VISUAL DEL DIA
====================================================== */

export function obtenerLabelDia(
    keyDay,
    state,
    admin,
    legal,
    comp,
    absences,
    turnoLabelFn
) {
    let label = turnoLabelFn(state);

    /* administrativos */

    if (admin[keyDay] === 1) {
        label = "ADM";
    }

    if (admin[keyDay] === "0.5M") {
        label = "1/2M";
    }

    if (admin[keyDay] === "0.5T") {
        label = "1/2T";
    }

    if (admin[keyDay] === 0.5) {
        label = "1/2";
    }

    /* feriados legales */

    if (legal[keyDay]) {
        label = "FL";
    }

    /* compensatorios */

    if (comp[keyDay]) {
        label = "FC";
    }

    /* licencia médica */

    if (
        absences[keyDay] &&
        absences[keyDay].type === "license"
    ) {
        label = "LM";
    }

    return label;
}

/* ======================================================
   CLASES ESPECIALES CSS
====================================================== */

export function aplicarClasesEspeciales(
    div,
    keyDay,
    state,
    isHab,
    isWeekend,
    isHoliday,
    admin,
    legal,
    comp,
    absences,
    aplicarClaseTurnoFn
) {
    if (isWeekend) {
        div.classList.add("weekend");
    }

    if (isHoliday) {
        div.classList.add("holiday");
    }

    aplicarClaseTurnoFn(div, state);

    if (
        (isWeekend || isHoliday) &&
        state > 0
    ) {
        div.classList.add(
            "inactive-selected"
        );
    }

    /* administrativos */

    if (admin[keyDay] === 1) {
        div.classList.add("admin-day");
    }

    if (
        admin[keyDay] === "0.5M" ||
        admin[keyDay] === "0.5T" ||
        admin[keyDay] === 0.5
    ) {
        div.classList.add(
            "half-admin-day"
        );
    }

    /* licencia */

    if (
        absences[keyDay] &&
        absences[keyDay].type === "license"
    ) {
        div.classList.add(
            "license-day"
        );
    }

    /* legal */

    if (legal[keyDay]) {
        div.classList.add(
            state > 0 || isHab
                ? "legal-day"
                : "legal-soft"
        );
    }

    /* compensatorio */

    if (comp[keyDay]) {
        div.classList.add(
            state > 0 || isHab
                ? "comp-day"
                : "comp-soft"
        );
    }
}

/* ======================================================
   VALIDACION MODO SELECCION
====================================================== */

export function estaBloqueadoModo(
    selectionMode,
    keyDay,
    state,
    isHab,
    admin,
    legal,
    comp,
    absences,
    shiftAssigned,
    options = {}
) {
    if (selectionMode === "halfadmin") {
        return (
            !isHab ||
            state === 0 ||
            state === 2 ||
            tieneAusencia(
                keyDay,
                admin,
                legal,
                comp,
                absences
            )
        );
    }

    if (selectionMode === MODO.ADMIN) {
        return !puedeAplicarAdministrativo(
            keyDay,
            state,
            isHab,
            admin,
            legal,
            comp,
            absences,
            shiftAssigned
        );
    }

    if (selectionMode === "legal") {
        return !puedeIniciarLegal(
            keyDay,
            isHab,
            admin,
            legal,
            comp,
            absences
        );
    }

    if (selectionMode === "comp") {
        return !puedeAplicarCompensatorioDesde(
            keyDay,
            options.compCantidad || 0,
            options.holidays || {},
            admin,
            legal,
            comp,
            absences
        );
    }

    return false;
}
