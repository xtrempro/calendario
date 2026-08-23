// FUENTE UNICA de las reglas de horas extras.
//
// Este archivo es la primera piedra de un motor unico de horas. Hoy conviven
// tres implementaciones del mismo calculo: hoursEngine.js (que ya alimenta al
// timeline, reportes, dashboard y el menu HHEE), el worker de proyeccion
// (js/workers/scheduleWorker.js) y la PWA del trabajador, que tiene su propia
// copia en otro repositorio. Cada regla que se mueva aca deja de poder
// divergir entre esas tres.
//
// REQUISITOS PARA LO QUE SE AGREGUE AQUI:
//   - Sin imports de modulos de la app (nada de storage, DOM ni Firebase). Solo
//     funciones puras sobre fecha y feriados.
//   - Sin estado. La misma entrada da la misma salida siempre.
// Eso es lo que permite que el archivo se copie tal cual a la PWA y, mas
// adelante, se ejecute en el backend sin tocarle una linea.
//
// El archivo se mantiene identico en los dos repositorios; un test lo verifica
// byte a byte (tests/motor-horas-extras.test.mjs).

// Horas de una jornada diurna EXTRA, por dia de la semana.
//
// Antes se usaba 8,8 todos los dias, que es el promedio de la semana
// (9+9+9+9+8 = 44; 44/5 = 8,8). El promedio sirve para repartir la jornada
// contractual del mes, pero NO para pagar un turno extra puntual: el trabajador
// que viene un martes hace 9 horas, y el que viene un viernes hace 8. Cobrar
// 8,8 en ambos casos le queda debiendo 0,2 al primero y le paga 0,8 de mas al
// segundo.
const DIURNO_EXTRA_HOURS_BY_WEEKDAY = {
    1: 9, // lunes
    2: 9, // martes
    3: 9, // miercoles
    4: 9, // jueves
    5: 8  // viernes
};

// Jornada diurna promedio. Sigue siendo la base para repartir horas
// contractuales del mes (horas habiles esperadas, descuentos por permiso), que
// es un reparto y no un turno concreto.
export const AVERAGE_DIURNAL_WORKDAY_HOURS = 8.8;

/**
 * Base de horas habiles del mes, redondeada a hora entera.
 *
 * El total sale de multiplicar los dias habiles por la jornada promedio de 8,8
 * y descontar los permisos, asi que casi nunca da entero: 19 dias habiles dan
 * 167,2. Se redondea porque es la cifra contra la que se miden las horas
 * extras, y no tiene sentido perseguir decimas en la base.
 *
 * Importa que el redondeo ocurra UNA vez y en el origen: si se redondeara solo
 * al mostrarlo, el informe diria 167 mientras el calculo usa 167,2.
 *
 * @param {number} total
 * @returns {number}
 */
export function roundMonthlyBusinessHours(total) {
    return Math.round(Number(total) || 0);
}

/**
 * Horas diurnas que aporta un turno diurno EXTRA en esa fecha.
 *
 * Devuelve 0 en sabado, domingo y feriado: en un dia inhabil la jornada no
 * cuenta como diurna, y quien decide eso es el clasificador de dia habil que
 * recibe por parametro (para no atar este archivo a un modulo de la app).
 *
 * @param {Date} date
 * @param {(date: Date) => boolean} isBusinessDayFn
 * @returns {number}
 */
export function diurnoExtraDayHours(date, isBusinessDayFn) {
    if (typeof isBusinessDayFn === "function" && !isBusinessDayFn(date)) {
        return 0;
    }

    return DIURNO_EXTRA_HOURS_BY_WEEKDAY[date.getDay()] || 0;
}

/**
 * Igual que diurnoExtraDayHours pero recibiendo el mapa de feriados que usa el
 * resto del app, para los llamadores que ya lo tienen a mano.
 *
 * @param {Date} date
 * @param {Record<string, unknown>} holidays
 * @returns {number}
 */
export function diurnoExtraDayHoursWithHolidays(date, holidays = {}) {
    return diurnoExtraDayHours(date, day =>
        ![0, 6].includes(day.getDay()) &&
        !holidays[`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`]
    );
}
