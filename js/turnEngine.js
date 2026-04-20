import { getSwaps } from "./storage.js";
import { fusionarTurnos } from "./turnEngine.js";

export function fusionarTurnos(actual, recibido){

    actual = Number(actual) || 0;
    recibido = Number(recibido) || 0;

    if(recibido === 0) return actual;
    if(actual === 0) return recibido;

    /* Largo + Noche = 24 */
    if(
        (actual === 1 && recibido === 2) ||
        (actual === 2 && recibido === 1)
    ){
        return 3;
    }

    /* Diurno + Noche = D+N */
    if(
        (actual === 4 && recibido === 2) ||
        (actual === 2 && recibido === 4)
    ){
        return 5;
    }

    /* Largo + Diurno */
    if(
        (actual === 1 && recibido === 4) ||
        (actual === 4 && recibido === 1)
    ){
        return 4;
    }

    return actual;
}

function isoFromKey(key){

    const p = key.split("-");

    return `${p[0]}-${String(Number(p[1])+1).padStart(2,"0")}-${String(p[2]).padStart(2,"0")}`;
}

export function aplicarCambiosTurno(nombre, key, turnoBase){

    let turno = Number(turnoBase) || 0;

    const swaps = getSwaps();
    const fechaISO = isoFromKey(key);

    for(const s of swaps){

        /* entrega */

        if(s.fecha === fechaISO && s.from === nombre){
            turno = 0;
        }

        if(s.fecha === fechaISO && s.to === nombre){

            const recibido =
                s.turno === "N" ? 2 :
                s.turno === "D" ? 4 : 1;

            turno = fusionarTurnos(turno, recibido);
        }

        /* devolución */

        if(s.devolucion === fechaISO && s.to === nombre){
            turno = 0;
        }

        if(s.devolucion === fechaISO && s.from === nombre){

            const recibido =
                s.turnoDevuelto === "N" ? 2 :
                s.turnoDevuelto === "D" ? 4 : 1;

            turno = fusionarTurnos(turno, recibido);
        }
    }

    return turno;
}