// js/turnEngine.js

/* ======================================================
   TURN ENGINE
   Centraliza lógica de turnos
====================================================== */

/* ======================================================
   CONSTANTES
====================================================== */

export const TURNOS = {
    LIBRE: 0,
    LARGA: 1,
    NOCHE: 2,
    VEINTICUATRO: 3,
    DIURNO: 4,
    DIURNO_NOCHE: 5
};

/* ======================================================
   LABELS
====================================================== */

export function turnoLabel(state) {
    return [
        "",
        "Larga",
        "Noche",
        "24",
        "Diurno",
        "D+N"
    ][Number(state) || 0] || "";
}

/* ======================================================
   COLOR / CLASE CSS
====================================================== */

export function aplicarClaseTurno(
    div,
    state
) {
    state = Number(state) || 0;

    if (state === TURNOS.LARGA) {
        div.classList.add("green");
    }

    if (state === TURNOS.NOCHE) {
        div.classList.add("blue");
    }

    if (state === TURNOS.VEINTICUATRO) {
        div.classList.add("purple");
    }

    if (state === TURNOS.DIURNO) {
        div.classList.add("lightgreen");
    }

    if (state === TURNOS.DIURNO_NOCHE) {
        div.classList.add("yellow");
    }
}

/* ======================================================
   CICLO MANUAL DE CLICK
====================================================== */

export function siguienteTurno(
    state,
    isHab
) {
    let s = Number(state) || 0;

    do {
        s++;

        if (s > TURNOS.DIURNO_NOCHE) {
            s = TURNOS.LIBRE;
        }

    } while (
        (s === TURNOS.DIURNO ||
         s === TURNOS.DIURNO_NOCHE) &&
        !isHab
    );

    return s;
}

/* ======================================================
   FUSION DE TURNOS
====================================================== */

export function fusionarTurnos(
    actual,
    recibido
) {
    actual = Number(actual) || 0;
    recibido = Number(recibido) || 0;

    if (actual === recibido) {
        return actual;
    }

    /* libre + recibido */

    if (actual === 0) {
        return recibido;
    }

    if (recibido === 0) {
        return actual;
    }

    /* larga + noche = 24 */

    if (
        (actual === TURNOS.LARGA &&
         recibido === TURNOS.NOCHE) ||

        (actual === TURNOS.NOCHE &&
         recibido === TURNOS.LARGA)
    ) {
        return TURNOS.VEINTICUATRO;
    }

    /* diurno + noche */

    if (
        (actual === TURNOS.DIURNO &&
         recibido === TURNOS.NOCHE) ||

        (actual === TURNOS.NOCHE &&
         recibido === TURNOS.DIURNO)
    ) {
        return TURNOS.DIURNO_NOCHE;
    }

    /* larga + diurno */

    if (
        (actual === TURNOS.LARGA &&
         recibido === TURNOS.DIURNO) ||

        (actual === TURNOS.DIURNO &&
         recibido === TURNOS.LARGA)
    ) {
        return TURNOS.DIURNO_NOCHE;
    }

    /* fallback */

    return recibido;
}