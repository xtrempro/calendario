/* ======================================================
   UI ENGINE
   Todo lo visual (labels, colores, clases)
====================================================== */

/* ==========================================
   LABEL DE TURNO
========================================== */

export function turnoLabel(state) {
    return ["", "Larga", "Noche", "24", "Diurno", "D+N"][state] || "";
}

/* ==========================================
   COLOR / CLASE DE TURNO
========================================== */

export function aplicarClaseTurno(div, state) {
    if (state === 1) div.classList.add("green");
    if (state === 2) div.classList.add("blue");
    if (state === 3) div.classList.add("purple");
    if (state === 4) div.classList.add("lightgreen");
    if (state === 5) div.classList.add("yellow");
}