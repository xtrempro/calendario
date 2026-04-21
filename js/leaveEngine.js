import { fetchHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";

import {
    getProfileData,
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

    getShiftAssigned
} from "./storage.js";

import { renderTimeline } from "./timeline.js";
import { analizarStaffingMes } from "./staffing.js";

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

    Object.values(admin).forEach(v=>{

        if(v === 1) total += 1;
        else total += 0.5;
    });

    return total;
}

export async function aplicarAdministrativo(fecha, cantidad = 1){

    const admin = getAdminDays();
    const data = getProfileData();

    const holidays =
        await fetchHolidays(fecha.getFullYear());

    let d = new Date(fecha);

    for(let i=0;i<cantidad;i++){

        const key = keyFromDate(d);

        if(admin[key]) return false;

        const habil =
            isBusinessDay(d, holidays);

        const turno = data[key] || 0;

        if(getShiftAssigned()){

            if(turno === 0) return false;

        }else{

            if(!habil) return false;
        }

        admin[key] = 1;

        d.setDate(d.getDate()+1);
    }

    saveAdminDays(admin);

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

export async function aplicarLegal(fecha, cantidad){

    const legal = getLegalDays();
    const blocked = getBlockedDays();

    const year = fecha.getFullYear();

    const holidays =
        await fetchHolidays(year);

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

function ultimoLegal(){

    const legal = getLegalDays();

    let ult = null;

    Object.keys(legal).forEach(k=>{

        const d = parseKey(k);

        if(!ult || d > ult){
            ult = d;
        }
    });

    return ult;
}

export async function aplicarComp(fecha){

    const ult = ultimoLegal();

    if(ult){

        const dias = diasEntre(fecha, ult);

        if(dias < 90) return false;
    }

    const comp = getCompDays();
    const blocked = getBlockedDays();

    const holidays =
        await fetchHolidays(fecha.getFullYear());

    let usados = 0;
    let d = new Date(fecha);

    const nuevos = [];

    while(usados < 10){

        const key = keyFromDate(d);

        nuevos.push(key);

        if(isBusinessDay(d, holidays)){
            usados++;
        }

        d.setDate(d.getDate()+1);
    }

    if(!validarRangoAusencias(nuevos)) return false;

    nuevos.forEach(k=>{

        comp[k] = true;
        blocked[k] = true;
    });

    saveCompDays(comp);
    saveBlockedDays(blocked);

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