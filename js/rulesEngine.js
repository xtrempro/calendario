// js/rulesEngine.js

/* ======================================================
   RULES ENGINE
   Centraliza ausencias, bloqueos y etiquetas especiales
   SIN romper funcionalidades actuales
====================================================== */

import { MODO } from "./constants.js";

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
    shiftAssigned
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

        if (shiftAssigned) {
            return (
                state === 0 ||
                tieneAusencia(
                    keyDay,
                    admin,
                    legal,
                    comp,
                    absences
                )
            );
        }

        return (
            !isHab ||
            tieneAusencia(
                keyDay,
                admin,
                legal,
                comp,
                absences
            )
        );
    }

    return false;
}
