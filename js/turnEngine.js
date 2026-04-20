// js/turnEngine.js

import { getSwaps } from "./storage.js";
import { TURNO } from "./constants.js";

/* ======================================================
   TURN ENGINE
   Motor central de combinaciones y cambios de turno
====================================================== */

/* ======================================================
   FUSIONAR TURNOS
====================================================== */

export function fusionarTurnos(actual, recibido) {

    actual = Number(actual) || TURNO.LIBRE;
    recibido = Number(recibido) || TURNO.LIBRE;

    if (recibido === TURNO.LIBRE) return actual;
    if (actual === TURNO.LIBRE) return recibido;

    /* Largo + Noche = 24 */
    if (
        (actual === TURNO.LARGA && recibido === TURNO.NOCHE) ||
        (actual === TURNO.NOCHE && recibido === TURNO.LARGA)
    ) {
        return TURNO.TURNO24;
    }

    /* Diurno + Noche = D+N */
    if (
        (actual === TURNO.DIURNO && recibido === TURNO.NOCHE) ||
        (actual === TURNO.NOCHE && recibido === TURNO.DIURNO)
    ) {
        return TURNO.DIURNO_NOCHE;
    }

    /* Largo + Diurno = Diurno */
    if (
        (actual === TURNO.LARGA && recibido === TURNO.DIURNO) ||
        (actual === TURNO.DIURNO && recibido === TURNO.LARGA)
    ) {
        return TURNO.DIURNO;
    }

    /* si no hay combinación definida */
    return actual;
}

/* ======================================================
   HELPERS
====================================================== */

function isoFromKey(key) {

    const p = key.split("-");

    return `${p[0]}-${String(Number(p[1]) + 1).padStart(2, "0")}-${String(p[2]).padStart(2, "0")}`;
}

function turnoDesdeCodigoSwap(valor) {

    if (valor === "N") return TURNO.NOCHE;
    if (valor === "D") return TURNO.DIURNO;

    return TURNO.LARGA;
}

/* ======================================================
   APLICAR CAMBIOS DE TURNO
====================================================== */

export function aplicarCambiosTurno(nombre, key, turnoBase) {

    let turno = Number(turnoBase) || TURNO.LIBRE;

    const swaps = getSwaps();
    const fechaISO = isoFromKey(key);

    for (const s of swaps) {

        /* ==========================================
           ENTREGA
        ========================================== */

        if (
            s.fecha === fechaISO &&
            s.from === nombre
        ) {
            turno = TURNO.LIBRE;
        }

        if (
            s.fecha === fechaISO &&
            s.to === nombre
        ) {
            const recibido =
                turnoDesdeCodigoSwap(s.turno);

            turno =
                fusionarTurnos(turno, recibido);
        }

        /* ==========================================
           DEVOLUCIÓN
        ========================================== */

        if (
            s.devolucion === fechaISO &&
            s.to === nombre
        ) {
            turno = TURNO.LIBRE;
        }

        if (
            s.devolucion === fechaISO &&
            s.from === nombre
        ) {
            const recibido =
                turnoDesdeCodigoSwap(
                    s.turnoDevuelto
                );

            turno =
                fusionarTurnos(turno, recibido);
        }
    }

    return turno;
}