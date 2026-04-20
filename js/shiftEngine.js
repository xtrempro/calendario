import { getSwaps } from "./storage.js";
import { fusionarTurnos } from "./turnEngine.js";

function isoFromKey(key){

    const p = key.split("-");

    return `${p[0]}-${String(Number(p[1])+1).padStart(2,"0")}-${String(p[2]).padStart(2,"0")}`;
}

export function aplicarCambiosTurno(nombre, key, turnoBase){

    let turno = Number(turnoBase) || 0;

    const swaps = getSwaps();
    const fechaISO = isoFromKey(key);

    for(const s of swaps){

        /* ENTREGA */

        if(s.fecha === fechaISO && s.from === nombre){
            turno = 0;
        }

        if(s.fecha === fechaISO && s.to === nombre){

            const recibido =
                s.turno === "N" ? 2 :
                s.turno === "D" ? 4 : 1;

            turno = fusionarTurnos(turno, recibido);
        }

        /* DEVOLUCIÓN */

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