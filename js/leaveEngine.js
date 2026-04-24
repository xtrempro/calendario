import { fetchHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";

import {
    getBlockedDays,
    saveBlockedDays,

    getAdminDays,
    saveAdminDays,

    getLegalDays,
    saveLegalDays,

    getCompDays,
    saveCompDays,

    getAbsences,
    saveAbsences,

    getShiftAssigned,
    getCurrentProfile,
    getManualLeaveBalances
} from "./storage.js";

import { renderTimeline } from "./timeline.js";
import { analizarStaffingMes } from "./staffing.js";
import { getTurnoBase } from "./turnEngine.js";
import {
    esAusenciaInjustificada,
    puedeAplicarAdministrativo,
    puedeAplicarCompensatorioDesde,
    puedeIniciarLegal
} from "./rulesEngine.js";

/* =========================================
HELPERS
========================================= */

function keyFromDate(d){
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function parseKey(k){
    const p = k.split("-");
    return new Date(Number(p[0]), Number(p[1]), Number(p[2]));
}

function diasEntre(a,b){
    return Math.floor((a-b)/86400000);
}

function isSameYearKey(key, year){
    return key.startsWith(year + "-");
}

function contarHabiles(obj){

    const year = new Date().getFullYear();
    let total = 0;

    Object.keys(obj).forEach(k=>{

        if(!k.startsWith(year + "-")) return;

        const d = parseKey(k);
        const dow = d.getDay();

        if(dow !== 0 && dow !== 6){
            total++;
        }
    });

    return total;
}

function validarRangoAusencias(fechas){

    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const abs = getAbsences();

    for(const key of fechas){

        if(admin[key]) return false;
        if(legal[key]) return false;
        if(comp[key]) return false;
        if(abs[key]) return false;
    }

    return true;
}

/* =========================================
ADMINISTRATIVO
========================================= */

export function totalAdministrativosUsados(){

    const admin = getAdminDays();
    let total = 0;
    const currentYear = new Date().getFullYear() + "-";

    Object.entries(admin).forEach(([key, value])=>{
        if (!key.startsWith(currentYear)) return;

        if(value === 1) total += 1;
        else total += 0.5;
    });

    return total;
}

function contarHabilesEnAno(obj, year, holidays){
    let total = 0;

    Object.keys(obj).forEach(key => {
        if (!isSameYearKey(key, year)) return;

        if (isBusinessDay(parseKey(key), holidays)) {
            total++;
        }
    });

    return total;
}

export async function aplicarAdministrativo(fecha, cantidad = 1){

    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const shiftAssigned =
        getShiftAssigned();
    const currentProfile =
        getCurrentProfile();

    const holidays =
        await fetchHolidays(fecha.getFullYear());

    let d = new Date(fecha);
    let changedAbsences = false;

    for(let i=0;i<cantidad;i++){

        const key = keyFromDate(d);

        const habil =
            isBusinessDay(d, holidays);

        const turno = getTurnoBase(
            currentProfile,
            key
        );

        if (
            !puedeAplicarAdministrativo(
                key,
                turno,
                habil,
                admin,
                legal,
                comp,
                absences,
                shiftAssigned
            )
        ) {
            return false;
        }

        if (esAusenciaInjustificada(absences[key])) {
            delete absences[key];
            changedAbsences = true;
        }

        admin[key] = 1;

        d.setDate(d.getDate()+1);
    }

    saveAdminDays(admin);

    if (changedAbsences) {
        saveAbsences(absences);
    }

    renderTimeline();
    analizarStaffingMes();

    return true;
}

export async function aplicarHalfAdministrativo(fecha, tipo="M"){

    const admin = getAdminDays();

    const holidays =
        await fetchHolidays(fecha.getFullYear());

    if(!isBusinessDay(fecha, holidays)) return false;

    const key = keyFromDate(fecha);

    if(admin[key]) return false;

    admin[key] =
        tipo === "M" ? "0.5M" : "0.5T";

    saveAdminDays(admin);

    renderTimeline();
    analizarStaffingMes();

    return true;
}

/* =========================================
FERIADO LEGAL
========================================= */

export function existeBloque10Actual(){

    const legal = getLegalDays();

    const fechas = Object.keys(legal)
        .map(parseKey)
        .sort((a,b)=>a-b);

    let max = 0;
    let actual = 0;
    let prev = null;

    fechas.forEach(d=>{

        const dow = d.getDay();

        if(dow===0 || dow===6) return;

        if(!prev){
            actual = 1;
        }else{
            const dif = diasEntre(d, prev);

            actual = dif <= 3 ? actual+1 : 1;
        }

        if(actual > max) max = actual;

        prev = d;
    });

    return max >= 10;
}

export async function existeBloque10Legal(year = new Date().getFullYear()){
    const legal = getLegalDays();
    const holidays = await fetchHolidays(year);

    let max = 0;
    let actual = 0;
    const cursor = new Date(year, 0, 1);

    while (cursor.getFullYear() === year) {
        const key = keyFromDate(cursor);
        const isHab = isBusinessDay(cursor, holidays);

        if (isHab && legal[key]) {
            actual++;
            if (actual > max) max = actual;
        } else if (isHab) {
            actual = 0;
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    return max >= 10;
}

export async function validarCantidadLegalAnual(cantidad, year = new Date().getFullYear()){
    const legal = getLegalDays();
    const holidays = await fetchHolidays(year);
    const saldoCalculado = Math.max(
        0,
        15 - contarHabilesEnAno(legal, year, holidays)
    );
    const saldoManual = Number(
        getManualLeaveBalances(year).legal
    );
    const saldo = Number.isFinite(saldoManual)
        ? Math.max(0, saldoManual)
        : saldoCalculado;

    if (
        !cantidad ||
        cantidad <= 0 ||
        !Number.isInteger(Number(cantidad))
    ) {
        return {
            ok: false,
            saldo,
            message: "Ingresa una cantidad valida de feriado legal."
        };
    }

    if (cantidad > saldo) {
        return {
            ok: false,
            saldo,
            message: "La cantidad supera el saldo disponible."
        };
    }

    const yaTieneBloque10 = await existeBloque10Legal(year);
    const dejaReserva10 = saldo - cantidad >= 10;

    if (
        !yaTieneBloque10 &&
        cantidad < 10 &&
        !dejaReserva10
    ) {
        return {
            ok: false,
            saldo,
            message: "El trabajador aun debe reservar saldo para solicitar 10 F. Legales continuos. Reduce la cantidad o solicita un bloque de al menos 10 dias."
        };
    }

    return {
        ok: true,
        saldo,
        message: ""
    };
}

export async function aplicarLegal(fecha, cantidad){

    const legal = getLegalDays();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const comp = getCompDays();
    const absences = getAbsences();

    const year = fecha.getFullYear();

    const holidays =
        await fetchHolidays(year);

    const startKey = keyFromDate(fecha);
    const startIsHab = isBusinessDay(fecha, holidays);
    const cantidadValida =
        await validarCantidadLegalAnual(cantidad, year);

    if (!cantidadValida.ok) return false;

    if (
        !puedeIniciarLegal(
            startKey,
            startIsHab,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        return false;
    }

    let usados = 0;
    let d = new Date(fecha);

    const nuevos = [];

    while(usados < cantidad){

        const key = keyFromDate(d);

        nuevos.push(key);

        if(isBusinessDay(d, holidays)){
            usados++;
        }

        d.setDate(d.getDate()+1);
    }

    if(!validarRangoAusencias(nuevos)) return false;

    nuevos.forEach(k=>{

        legal[k] = true;
        blocked[k] = true;
    });

    saveLegalDays(legal);
    saveBlockedDays(blocked);

    renderTimeline();
    analizarStaffingMes();

    return true;
}

/* =========================================
COMPENSATORIO
========================================= */

function ultimoLegalHasta(fechaLimite){

    const legal = getLegalDays();

    let ult = null;

    Object.keys(legal).forEach(k=>{

        const d = parseKey(k);

        if (fechaLimite && d > fechaLimite) {
            return;
        }

        if(!ult || d > ult){
            ult = d;
        }
    });

    return ult;
}

export async function aplicarComp(fecha, cantidad = 10){
    const total = Number(cantidad);

    if (!total || total <= 0 || !Number.isInteger(total)) {
        return false;
    }

    const ult = ultimoLegalHasta(fecha);

    if(ult){

        const dias = diasEntre(fecha, ult);

        if(dias < 90) return false;
    }

    const comp = getCompDays();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const legal = getLegalDays();
    const absences = getAbsences();

    const holidays =
        await fetchHolidays(fecha.getFullYear());
    const startKey = keyFromDate(fecha);

    if (
        !puedeAplicarCompensatorioDesde(
            startKey,
            total,
            holidays,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        return false;
    }

    let usados = 0;
    let d = new Date(fecha);
    let changedAbsences = false;

    const nuevos = [];

    while(usados < total){

        const key = keyFromDate(d);

        nuevos.push(key);

        if(isBusinessDay(d, holidays)){
            usados++;
        }

        d.setDate(d.getDate()+1);
    }

    nuevos.forEach(k=>{
        if (esAusenciaInjustificada(absences[k])) {
            delete absences[k];
            changedAbsences = true;
        }

        comp[k] = true;
        blocked[k] = true;
    });

    saveCompDays(comp);
    saveBlockedDays(blocked);

    if (changedAbsences) {
        saveAbsences(absences);
    }

    renderTimeline();
    analizarStaffingMes();

    return true;
}

/* =========================================
LICENCIA
========================================= */

export function aplicarLicencia(fecha, cantidad){

    const abs = getAbsences();
    const blocked = getBlockedDays();

    let d = new Date(fecha);

    for(let i=0;i<cantidad;i++){

        const key = keyFromDate(d);

        abs[key] = { type:"license" };
        blocked[key] = true;

        d.setDate(d.getDate()+1);
    }

    saveAbsences(abs);
    saveBlockedDays(blocked);

    renderTimeline();
    analizarStaffingMes();

    return true;
}
