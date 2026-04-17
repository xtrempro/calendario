import { renderCalendar, prevMonth, nextMonth } from "./calendar.js";

import {
    getProfileData,
    saveProfileData,
    getBlockedDays,
    saveBlockedDays,
    getProfiles,
    saveProfiles,
    setCurrentProfile,
    getCurrentProfile,
    getShiftAssigned,
    setShiftAssigned,
    getAdminDays,
    saveAdminDays,
    getLegalDays,
    getAbsences, 
    saveAbsences,
    saveLegalDays
} from "./storage.js";

import { fetchHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";

/* ======================================================
   ELEMENTOS HTML
====================================================== */

const profilesDiv     = document.getElementById("profiles");
const newProfileInput = document.getElementById("newProfile");
const createBtn       = document.getElementById("createProfile");

const checkbox        = document.getElementById("shiftAssigned");
const valorHoraInput  = document.getElementById("valorHora");

const autoDiurnoBtn   = document.getElementById("autoDiurnoBtn");
const autoCuartoBtn   = document.getElementById("autoCuartoBtn");

const selectorInfo    = document.getElementById("selectorInfo");

const adminBtn        = document.getElementById("adminBtn");
const adminInfo       = document.getElementById("adminInfo");

const legalBtn = document.getElementById("legalBtn");
const licenseBtn = document.getElementById("licenseBtn");


/* ======================================================
   MODOS DE SELECCIÓN
====================================================== */

let selectionMode = null; 
// null | diurno | cuarto | admin

let adminCantidad = 0;
let legalCantidad = 0;
let licenseCantidad = 0;

window.selectionMode = null;

/* ======================================================
   CONFIGURACIÓN GENERAL
====================================================== */

valorHoraInput.value = localStorage.getItem("valorHora") || "";

valorHoraInput.oninput = ()=>{
    let v = Number(valorHoraInput.value);
    if(v < 0) v = 0;

    valorHoraInput.value = v;
    localStorage.setItem("valorHora", v);
    renderCalendar();
};

checkbox.onchange = ()=>{
    setShiftAssigned(checkbox.checked);
};

/* ======================================================
   PERFILES
====================================================== */

function renderProfiles(){

    const profiles = getProfiles();
    const current  = getCurrentProfile();

    profilesDiv.innerHTML = "";

    profiles.forEach(name=>{

        const div = document.createElement("div");
        div.innerText = name;

        if(name === current){
            div.classList.add("active");
        }

        div.onclick = ()=>{
            setCurrentProfile(name);
            checkbox.checked = getShiftAssigned();
            renderProfiles();
            renderCalendar();
        };

        profilesDiv.appendChild(div);
    });
}

createBtn.onclick = ()=>{

    const name = newProfileInput.value.trim();
    if(!name) return;

    const profiles = getProfiles();

    if(profiles.includes(name)){
        alert("Ese perfil ya existe.");
        return;
    }

    profiles.push(name);
    saveProfiles(profiles);

    newProfileInput.value = "";
    renderProfiles();
};

/* ======================================================
   SELECTORES VISUALES
====================================================== */

function activarModo(modo, texto){

    selectionMode = modo;
    window.selectionMode = modo;

    selectorInfo.innerHTML = texto;
    selectorInfo.classList.remove("hidden");
}

function desactivarModo(){

    selectionMode = null;
    window.selectionMode = null;

    selectorInfo.classList.add("hidden");
    adminInfo.classList.add("hidden");
}

function activarSelectorDiurno(){

    activarModo(
        "diurno",
        'Selecciona desde qué fecha iniciar turno <b>Diurno</b>'
    );
}

function activarSelectorCuarto(){

    activarModo(
        "cuarto",
        'Selecciona en calendario el próximo turno <b>Largo</b>'
    );
}

function activarSelectorAdmin(){

    const usados = contarAdministrativos();

    if(usados >= 6){
        alert("Ya utilizó los 6 permisos administrativos.");
        return;
    }

    let cant = Number(prompt(
        `¿Cuántos días solicitará? Disponibles: ${6-usados}`
    ));

    if(!cant || cant <= 0) return;

    if(cant + usados > 6){
        alert("Supera máximo anual.");
        return;
    }

    adminCantidad = cant;

    selectionMode = "admin";
    window.selectionMode = "admin";

    adminInfo.classList.remove("hidden");
}


function contarLegal(){

    const year = new Date().getFullYear();
    const legal = getLegalDays();

    let total = 0;

    Object.keys(legal).forEach(k=>{

        if(!k.startsWith(year+"-")) return;

        const p = k.split("-");
        const d = new Date(p[0], p[1], p[2]);

        const dow = d.getDay();

        // solo hábiles descuentan saldo
        if(dow !== 0 && dow !== 6){
            total++;
        }

    });

    return total;
}

function contarLegalConObjeto(legal){

    const year = new Date().getFullYear();

    let total = 0;

    Object.keys(legal).forEach(k=>{

        if(!k.startsWith(year+"-")) return;

        const p = k.split("-");
        const d = new Date(p[0], p[1], p[2]);

        const dow = d.getDay();

        if(dow !== 0 && dow !== 6){
            total++;
        }

    });

    return total;
}

function existeBloqueLegal10(legal, holidays, year){

    const fechas = Object.keys(legal)
        .filter(k=>k.startsWith(year+"-"))
        .sort((a,b)=> new Date(a)-new Date(b));

    for(let i=0;i<fechas.length;i++){

        let cuenta = 0;
        let d = new Date(fechas[i]);

        while(cuenta < 10){

            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

            if(!legal[key]) break;

            const dow = d.getDay();
            const fer = holidays[key];

            const habil = dow !== 0 && dow !== 6 && !fer;

            if(habil) cuenta++;

            d.setDate(d.getDate()+1);
        }

        if(cuenta >= 10) return true;
    }

    return false;
}


function activarSelectorLegal(){

    const usados = contarLegal();
    const disponibles = 15 - usados;

    if(disponibles <= 0){
        alert("No posee días disponibles.");
        return;
    }

    let cant = Number(prompt(
        `¿Cuántos días solicitará? Disponibles: ${disponibles}`
    ));

    if(!cant || cant <= 0) return;

    if(cant > disponibles){
        alert("Supera saldo disponible.");
        return;
    }

    legalCantidad = cant;

    selectionMode = "legal";
    window.selectionMode = "legal";

    selectorInfo.innerHTML =
        'Selecciona fecha inicio de <b>Feriado Legal</b>';

    selectorInfo.classList.remove("hidden");
}


async function aplicarLegal(fecha){

    const data    = getProfileData();
    const legal   = getLegalDays();
    const admin   = getAdminDays();
    const blocked = getBlockedDays();

    const year = fecha.getFullYear();
    const holidays = await fetchHolidays(year);

    // saldo real
    const usados = contarLegal();
    const disponibles = 15 - usados;

    if(legalCantidad > disponibles){
        alert("No posee saldo suficiente.");
        return;
    }

    let d = new Date(fecha);
    let consumidos = 0;

    const nuevos = {};
    const nuevosBlocked = {};

    while(consumidos < legalCantidad){

        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

        // NO permitir superponer otras ausencias
        if(admin[key]){
            alert("No puede asignar Feriado Legal sobre un Permiso Administrativo.");
            return;
        }

        const dow = d.getDay();
        const fer = holidays[key];
        const habil = dow !== 0 && dow !== 6 && !fer;

        nuevos[key] = true;
        nuevosBlocked[key] = true;

        if(habil){
            consumidos++;
        }

        d.setDate(d.getDate()+1);
    }

    // cubrir inhábiles posteriores hasta próximo hábil
    while(true){

        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

        const dow = d.getDay();
        const fer = holidays[key];
        const habil = dow !== 0 && dow !== 6 && !fer;

        if(habil) break;

        if(admin[key]){
            alert("No puede asignar Feriado Legal sobre un Permiso Administrativo.");
            return;
        }

        nuevos[key] = true;
        nuevosBlocked[key] = true;

        d.setDate(d.getDate()+1);
    }

    // grabar recién al final
    Object.assign(legal, nuevos);
    Object.assign(blocked, nuevosBlocked);

    // validar bloque de 10 SOLO si completa 15
    const totalFinal = contarLegalConObjeto(legal);

    if(totalFinal >= 15){

        if(!existeBloqueLegal10(legal, holidays, year)){
            alert("Antes de completar los 15 días debe existir un bloque continuo de 10 días hábiles.");
            return;
        }
    }

    saveLegalDays(legal);
    saveBlockedDays(blocked);
    renderCalendar();
}

function activarSelectorLicencia(){

    let cant = Number(prompt(
        "¿Cuántos días dura la licencia médica?"
    ));

    if(!cant || cant <= 0) return;

    licenseCantidad = cant;

    selectionMode = "license";
    window.selectionMode = "license";

    selectorInfo.innerHTML =
        'Selecciona fecha inicio de <b>Licencia Médica</b>';

    selectorInfo.classList.remove("hidden");
}


function aplicarLicencia(fecha){

    const abs     = getAbsences();
    const blocked = getBlockedDays();

    const admin = getAdminDays();
    const legal = getLegalDays();

    let d = new Date(fecha);

    for(let i=0;i<licenseCantidad;i++){

        const key =
        `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

        // 🔥 si había administrativo -> lo libera
        if(admin[key]){
            delete admin[key];
        }

        // 🔥 si había feriado legal -> lo libera
        if(legal[key]){
            delete legal[key];
        }

        // 🔥 elimina cualquier otra ausencia central
        delete abs[key];

        // crea licencia
        abs[key] = {
            type:"license"
        };

        blocked[key] = true;

        d.setDate(d.getDate()+1);
    }

    saveAdminDays(admin);
    saveLegalDays(legal);
    saveAbsences(abs);
    saveBlockedDays(blocked);

    renderCalendar();
}



/* ======================================================
   TURNO DIURNO
====================================================== */

async function aplicarDiurnoDesde(fecha){

    const data    = getProfileData();
    const blocked = getBlockedDays();

    const year = fecha.getFullYear();
    const holidays = await fetchHolidays(year);

    let d = new Date(fecha);

    while(d.getFullYear() === year){

        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

        delete data[key];
        delete blocked[key];

        if(isBusinessDay(d, holidays)){
            data[key] = 4;
            blocked[key] = true;
        }

        d.setDate(d.getDate()+1);
    }

    saveProfileData(data);
    saveBlockedDays(blocked);
    renderCalendar();
}

/* ======================================================
   CUARTO TURNO
====================================================== */

function aplicarCuartoTurnoDesde(fecha){

    const data    = getProfileData();
    const blocked = getBlockedDays();

    const year = fecha.getFullYear();

    let d = new Date(fecha);

    while(d.getFullYear() === year){

        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

        delete data[key];
        delete blocked[key];

        d.setDate(d.getDate()+1);
    }

    d = new Date(fecha);

    while(d.getFullYear() === year){

        for(let i=0;i<4;i++){

            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

            if(i===0){
                data[key] = 1; // Largo
                blocked[key] = true;
            }

            if(i===1){
                data[key] = 2; // Noche
                blocked[key] = true;
            }

            d.setDate(d.getDate()+1);
        }
    }

    saveProfileData(data);
    saveBlockedDays(blocked);
    renderCalendar();
}

/* ======================================================
   ADMINISTRATIVOS
====================================================== */

function contarAdministrativos(){

    const year = new Date().getFullYear();
    const admin = getAdminDays();

    let total = 0;

    Object.keys(admin).forEach(k=>{
        if(k.startsWith(year+"-")) total++;
    });

    return total;
}

function aplicarAdministrativo(fecha){

    const data  = getProfileData();
    const admin = getAdminDays();

    const shiftAssigned = getShiftAssigned();

    if(!shiftAssigned){

        const dow = fecha.getDay();

        if(dow === 0 || dow === 6){
            alert("Solo puede pedir administrativos en días hábiles por no poseer Asignación de Turno.");
            return;
        }
    }

    let d = new Date(fecha);
    let puestos = 0;

    while(puestos < adminCantidad){

        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const state = data[key] || 0;

        let valido = false;

        if(shiftAssigned){
            if(state > 0) valido = true;
        }else{
            const dow = d.getDay();
            const habil = ![0,6].includes(dow);

            if(habil && state > 0){
                valido = true;
            }
        }

        if(valido){
            admin[key] = true;
            puestos++;
        }

        d.setDate(d.getDate()+1);
    }

    saveAdminDays(admin);
    renderCalendar();
}

/* ======================================================
   CLICK CALENDARIO
====================================================== */

document.addEventListener("click",(e)=>{

    const celda = e.target.closest(".day");
    if(!celda) return;

    const day   = Number(celda.dataset.day);
    const month = Number(celda.dataset.month);
    const year  = Number(celda.dataset.year);

    const fecha = new Date(year, month, day);

    if(selectionMode === "license"){ aplicarLicencia(fecha); desactivarModo(); return; }

    if(selectionMode === "diurno"){
        aplicarDiurnoDesde(fecha);
        desactivarModo();
        return;
    }

    if(selectionMode === "cuarto"){
        aplicarCuartoTurnoDesde(fecha);
        desactivarModo();
        return;
    }

if(selectionMode === "legal"){
    aplicarLegal(fecha);
    desactivarModo();
    return;
}

    if(selectionMode === "admin"){
        aplicarAdministrativo(fecha);
        desactivarModo();
        return;
    }

});

/* ======================================================
   BOTONES
====================================================== */

autoDiurnoBtn.onclick = activarSelectorDiurno;
autoCuartoBtn.onclick = activarSelectorCuarto;
adminBtn.onclick      = activarSelectorAdmin;
legalBtn.onclick = activarSelectorLegal;
licenseBtn.onclick = activarSelectorLicencia;

document.getElementById("prevBtn").onclick = prevMonth;
document.getElementById("nextBtn").onclick = nextMonth;

/* ======================================================
   INICIO
====================================================== */

renderProfiles();

if(getProfiles().length){

    setCurrentProfile(getProfiles()[0]);
    checkbox.checked = getShiftAssigned();
    renderCalendar();
}