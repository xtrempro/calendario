/* ======================================================
   CONSTANTS
====================================================== */

/* ==========================================
   TURNOS
========================================== */

export const TURNO = {
    LIBRE: 0,
    LARGA: 1,
    NOCHE: 2,
    TURNO24: 3,
    DIURNO: 4,
    DIURNO_NOCHE: 5
};

/* ==========================================
   LABELS
========================================== */

export const TURNO_LABEL = {
    0: "",
    1: "Larga",
    2: "Noche",
    3: "24",
    4: "Diurno",
    5: "D+N"
};

/* ==========================================
   CSS CLASSES
========================================== */

export const TURNO_CLASS = {
    1: "green",
    2: "blue",
    3: "purple",
    4: "lightgreen",
    5: "yellow"
};

export const TURNO_COLOR = {
   0:"#f3f4f6",
   1:"#00ff88",
   2:"#1e88e5",
   3:"#9c27b0",
   4:"#4fc3ff",
   5:"#673ab7"
};

/* ==========================================
   MODOS SELECCION
========================================== */

export const MODO = {
    ADMIN: "admin",
    HALF_ADMIN: "halfadmin",
    LICENSE: "license"
};

/* ==========================================
   AUSENCIAS
========================================== */

export const AUSENCIA = {
    LICENSE: "license"
};

/* ==========================================
   ESTAMENTOS
========================================== */

export const ESTAMENTO = [
    "Profesional",
    "Técnico",
    "Administrativo",
    "Auxiliar"
];