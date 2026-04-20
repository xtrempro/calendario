/* ======================================================
   UI ENGINE
   Todo lo visual (labels, colores, clases)
====================================================== */

import {
   TURNO_LABEL,
   TURNO_CLASS
} from "./constants.js";

/* ==========================================
   LABEL DE TURNO
========================================== */

export function turnoLabel(state){
   return TURNO_LABEL[state] || "";
}

export function aplicarClaseTurno(div,state){
   const clase = TURNO_CLASS[state];
   if(clase) div.classList.add(clase);
}