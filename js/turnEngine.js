// js/turnEngine.js

import { TURNO } from "./constants.js";

import {
    getSwaps,
    getProfileData,
    getBaseProfileData
} from "./storage.js";

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

    /* si ya tiene 24, mantener */
    if (actual === TURNO.TURNO24) {
        return TURNO.TURNO24;
    }

    /* si ya tiene D+N, mantener */
    if (actual === TURNO.DIURNO_NOCHE) {
        return TURNO.DIURNO_NOCHE;
    }

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

    /* cualquier otra mezcla no válida */
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

        /* ==================================================
           FECHA ORIGINAL
        ================================================== */

        if (!s.skipFecha && s.fecha === fechaISO) {

            /* quien entrega pierde su turno */
            if (s.from === nombre) {
                turno = TURNO.LIBRE;
            }

            /* quien recibe fusiona */
            if (s.to === nombre) {

                const recibido =
                    turnoDesdeCodigoSwap(s.turno);

                turno =
                    fusionarTurnos(turno, recibido);
            }
        }

        /* ==================================================
           FECHA DEVOLUCIÓN
        ================================================== */

        if (!s.skipDevolucion && s.devolucion === fechaISO) {

            /* trabajador B devuelve SOLO el turno pactado */
            if (s.to === nombre) {

                const devuelve =
                    turnoDesdeCodigoSwap(
                        s.turnoDevuelto
                    );

                if (turno === devuelve) {
                    turno = TURNO.LIBRE;
                }

                else if (
                    turno === TURNO.TURNO24 &&
                    devuelve === TURNO.LARGA
                ) {
                    turno = TURNO.NOCHE;
                }

                else if (
                    turno === TURNO.TURNO24 &&
                    devuelve === TURNO.NOCHE
                ) {
                    turno = TURNO.LARGA;
                }

                else if (
                    turno === TURNO.DIURNO_NOCHE &&
                    devuelve === TURNO.DIURNO
                ) {
                    turno = TURNO.NOCHE;
                }

                else if (
                    turno === TURNO.DIURNO_NOCHE &&
                    devuelve === TURNO.NOCHE
                ) {
                    turno = TURNO.DIURNO;
                }

                else {
                    turno = TURNO.LIBRE;
                }
            }

            /* trabajador A recibe devolución */
            if (s.from === nombre) {

                const recibido =
                    turnoDesdeCodigoSwap(
                        s.turnoDevuelto
                    );

                turno =
                    fusionarTurnos(turno, recibido);
            }
        }
    }

    return turno;
}

/* ======================================================
   SIGUIENTE TURNO (click manual calendario)
====================================================== */

export function siguienteTurno(actual, isHab) {

    actual = Number(actual) || TURNO.LIBRE;

    /* Día inhábil: solo rota básicos */
    if (!isHab) {
        switch (actual) {
            case TURNO.LIBRE: return TURNO.LARGA;
            case TURNO.LARGA: return TURNO.NOCHE;
            case TURNO.NOCHE: return TURNO.LIBRE;
            default: return TURNO.LIBRE;
        }
    }

    /* Día hábil */
    switch (actual) {
        case TURNO.LIBRE: return TURNO.LARGA;
        case TURNO.LARGA: return TURNO.NOCHE;
        case TURNO.NOCHE: return TURNO.TURNO24;
        case TURNO.TURNO24: return TURNO.DIURNO;
        case TURNO.DIURNO: return TURNO.DIURNO_NOCHE;
        case TURNO.DIURNO_NOCHE: return TURNO.LIBRE;
        default: return TURNO.LIBRE;
    }
}



/* ======================================================
   TURNO REAL DEL TRABAJADOR EN FECHA
====================================================== */


export function getTurnoReal(nombre, key) {

    const data = getProfileData(nombre);

    const turnoBase = Number(data[key]) || 0;

    return aplicarCambiosTurno(
        nombre,
        key,
        turnoBase
    );
}

export function getTurnoBase(nombre, key) {
    const baseData = getBaseProfileData(nombre);
    const hasBaseData =
        Object.keys(baseData).length > 0;

    if (Object.prototype.hasOwnProperty.call(baseData, key)) {
        return Number(baseData[key]) || TURNO.LIBRE;
    }

    if (hasBaseData) {
        return TURNO.LIBRE;
    }

    const blocked = JSON.parse(
        localStorage.getItem("blocked_" + nombre)
    ) || {};

    if (!blocked[key]) return TURNO.LIBRE;

    const data = getProfileData(nombre);

    return Number(data[key]) || TURNO.LIBRE;
}
