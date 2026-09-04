// Efemerides del sector salud, para la tabla de novedades de la programacion
// semanal.
//
// Es una tabla FIJA y editable a mano: una linea por fecha, en formato
// "MM-DD". Todas se repiten cada año, asi que no llevan año. Para agregar,
// quitar o corregir una, se toca solo este archivo:
//
//     { date: "05-12", title: "Dia Internacional de la Enfermeria" },
//
// Si alguna vez hiciera falta una efemeride de fecha movil -el tercer jueves de
// tal mes, por ejemplo-, NO forzarla aqui: este modulo compara mes y dia y solo
// sabe de fechas fijas.

// Conmemoraciones internacionales de salud. Son las de la OMS y las de uso
// mundial establecido.
const OBSERVANCIAS_INTERNACIONALES = [
    { date: "02-04", title: "Día Mundial contra el Cáncer" },
    { date: "03-24", title: "Día Mundial de la Tuberculosis" },
    { date: "04-07", title: "Día Mundial de la Salud" },
    { date: "05-05", title: "Día Mundial de la Higiene de Manos" },
    { date: "05-12", title: "Día Internacional de la Enfermería" },
    { date: "05-17", title: "Día Mundial de la Hipertensión" },
    { date: "05-31", title: "Día Mundial Sin Tabaco" },
    { date: "06-14", title: "Día Mundial del Donante de Sangre" },
    { date: "09-10", title: "Día Mundial para la Prevención del Suicidio" },
    { date: "09-17", title: "Día Mundial de la Seguridad del Paciente" },
    { date: "09-21", title: "Día Mundial del Alzheimer" },
    { date: "09-29", title: "Día Mundial del Corazón" },
    { date: "10-10", title: "Día Mundial de la Salud Mental" },
    { date: "10-19", title: "Día Mundial contra el Cáncer de Mama" },
    { date: "11-08", title: "Día Internacional de la Radiología" },
    { date: "11-14", title: "Día Mundial de la Diabetes" },
    { date: "12-01", title: "Día Mundial de la Lucha contra el SIDA" },
    { date: "12-03", title: "Día Internacional de las Personas con Discapacidad" }
];

// Dias de las profesiones de la salud en Chile.
//
// Esta lista va aparte a proposito y arranca corta: las fechas gremiales
// chilenas varian entre colegios profesionales y servicios, y una fecha
// equivocada impresa en la programacion que circula por la unidad es peor que
// una fecha ausente. Se completa a mano, confirmando cada una:
//
//     { date: "MM-DD", title: "Día del/de la ..." },
const CONMEMORACIONES_CHILE = [
    { date: "12-03", title: "Día del Médico" }
];

export const COMMEMORATIVE_DAYS = [
    ...OBSERVANCIAS_INTERNACIONALES,
    ...CONMEMORACIONES_CHILE
];

function monthDayKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${month}-${day}`;
}

/**
 * Las efemerides que caen en esa fecha. Devuelve los titulos, en el orden en
 * que estan declarados, o un arreglo vacio si ese dia no conmemora nada.
 *
 * @param {Date} date
 * @param {Array<{date: string, title: string}>} [table]
 * @returns {string[]}
 */
export function commemorativeDaysForDate(date, table = COMMEMORATIVE_DAYS) {
    const key = monthDayKey(date);

    if (!key) return [];

    return table
        .filter(item => item.date === key)
        .map(item => item.title);
}
