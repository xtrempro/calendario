import { renderCalendar, prevMonth, nextMonth } from "./calendar.js";
import { renderTimeline } from "./timeline.js";
import { pushHistory, undo, redo } from "./history.js";
import { registrarCambio } from "./swaps.js";
import {
    renderStaffingPanel,
    analizarStaffingMes
} from "./staffing.js";

import { fetchHolidays } from "./holidays.js";

import { isBusinessDay } from "./calculations.js";
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
    saveLegalDays,
    getCompDays,
    saveCompDays,
    getAbsences,
    saveAbsences,
    getSwaps
} from "./storage.js";

/* ======================================================
   ELEMENTOS
====================================================== */



const profilesDiv = document.getElementById("profiles");
const newProfileInput = document.getElementById("newProfile");
const createBtn = document.getElementById("createProfile");

const checkbox = document.getElementById("shiftAssigned");
const valorHoraInput = document.getElementById("valorHora");

const autoDiurnoBtn = document.getElementById("autoDiurnoBtn");
const autoCuartoBtn = document.getElementById("autoCuartoBtn");

const adminBtn = document.getElementById("adminBtn");
const halfAdminMorningBtn =
document.getElementById("halfAdminMorningBtn");
const halfAdminAfternoonBtn =
document.getElementById("halfAdminAfternoonBtn");
const legalBtn = document.getElementById("legalBtn");
const compBtn = document.getElementById("compBtn");
const licenseBtn = document.getElementById("licenseBtn");

const selectorInfo = document.getElementById("selectorInfo");
const adminInfo = document.getElementById("adminInfo");

const newProfileRole =
document.getElementById("newProfileRole");

const filterRole =
document.getElementById("filterRole");

/* ======================================================
   ESTADO
====================================================== */

let selectionMode = null;
let adminCantidad = 0;
let legalCantidad = 0;
let licenseCantidad = 0;

window.selectionMode = null;

/* ======================================================
   cambio turnos
====================================================== */

function cargarSelectCambios(){

 const perfiles = getProfiles();

 const a =
 document.getElementById("swapFrom");

 const b =
 document.getElementById("swapTo");

 a.innerHTML="";
 b.innerHTML="";

 perfiles.forEach(p=>{

   a.innerHTML +=
   `<option>${p.name}</option>`;

   b.innerHTML +=
   `<option>${p.name}</option>`;
 });
}


function renderSwapPanel(){

    const box = document.getElementById("swapPanel");
    if(!box) return;

    const perfiles = getProfiles();

    let options = perfiles.map(p =>
        `<option value="${p.name}">${p.name}</option>`
    ).join("");

    box.innerHTML = `
        <h3>Cambio de Turnos</h3>

        <div class="swap-row">
            <select id="swapFrom">${options}</select>
            <select id="swapTo">${options}</select>

            <input type="date" id="swapDate1">
            <input type="date" id="swapDate2">

            <button id="saveSwapBtn">
                Registrar Cambio
            </button>
        </div>

        <div id="swapList"></div>
    `;

    document
    .getElementById("saveSwapBtn")
    .onclick = guardarCambioTurno;

    const swapFrom =
    document.getElementById("swapFrom");

    swapFrom.onchange = actualizarSwapTo;

    actualizarSwapTo();

    renderSwapList();
}

function actualizarSwapTo(){

    const from =
        document.getElementById("swapFrom").value;

    const toSelect =
        document.getElementById("swapTo");

    const perfiles = getProfiles();

    const perfilFrom =
        perfiles.find(p => p.name === from);

    if(!perfilFrom) return;

    const filtrados = perfiles.filter(p =>
        p.name !== from &&
        p.estamento === perfilFrom.estamento &&
        !mismaRotativa(from, p.name)
    );

    toSelect.innerHTML = filtrados.map(p =>
        `<option value="${p.name}">
            ${p.name}
        </option>`
    ).join("");
}



function guardarCambioTurno(){

    const from =
        document.getElementById("swapFrom").value;

    const to =
        document.getElementById("swapTo").value;

    const fecha =
        document.getElementById("swapDate1").value;

    const devolucion =
        document.getElementById("swapDate2").value;

    if(!from || !to || !fecha || !devolucion){
        alert("Completa todos los campos");
        return;
    }

    if(from === to){
        alert("Debe ser entre trabajadores distintos");
        return;
    }

    const f1 = parseInputDate(fecha);
    const f2 = parseInputDate(devolucion);

    if(
        f1.getFullYear() !== f2.getFullYear() ||
        f1.getMonth() !== f2.getMonth()
    ){
        alert("Ambas fechas deben ser del mismo mes");
        return;
    }
    function obtenerTurno(nombre, fechaISO){
    const data = JSON.parse(
        localStorage.getItem("data_" + nombre)
    ) || {};

    const f = new Date(fechaISO);
    const key = `${f.getFullYear()}-${f.getMonth()}-${f.getDate()}`;

    const state = Number(data[key]) || 0;

    if(state === 2) return "N";
    return "L";
}

registrarCambio({
    from,
    to,
    fecha,
    devolucion,

    turno: obtenerTurno(from, fecha),
    turnoDevuelto: obtenerTurno(to, devolucion),

    year: f1.getFullYear(),
    month: f1.getMonth()
});

    renderSwapList();
    renderCalendar();
    renderTimeline();
    pushHistory();

    alert("Cambio registrado");
}

// la siguiente funcio sirve para bloquear y filtrar el combobox2 de cambios de turno

function getBaseState(nombre, year, month, day = 1){

    const data = JSON.parse(
        localStorage.getItem("data_" + nombre)
    ) || {};

    const blocked = JSON.parse(
        localStorage.getItem("blocked_" + nombre)
    ) || {};

    const key = `${year}-${month}-${day}`;

    /* si no es bloqueado, probablemente fue cambio manual */
    if(!blocked[key]) return null;

    return Number(data[key]) || 0;
}


/* Detecta misma rotativa real */
function mismaRotativa(nombre1, nombre2){

    const now = new Date();

    const y = now.getFullYear();
    const m = now.getMonth();

    let iguales = 0;
    let comparados = 0;

    for(let d=1; d<=20; d++){

        const a = getBaseState(nombre1, y, m, d);
        const b = getBaseState(nombre2, y, m, d);

        if(a === null || b === null) continue;

        comparados++;

        if(a === b) iguales++;
    }

    if(comparados < 4) return false;

    return iguales === comparados;
}
// de aqui adelante otra cosa que no se q es

function renderSwapList(){

    const div =
        document.getElementById("swapList");

    const swaps = getSwaps();

    div.innerHTML = swaps.map((s,i)=>`
    <div class="swap-item">
        ${s.from} → ${s.to}
        (${formatFechaUSA(s.fecha)})
        ↩ devolución ${formatFechaUSA(s.devolucion)}
    </div>
    `).join("");
}
/* ======================================================
   CONFIG
====================================================== */

valorHoraInput.value = localStorage.getItem("valorHora") || "";

valorHoraInput.oninput = () => {
    let v = Number(valorHoraInput.value);
    if (v < 0) v = 0;
    valorHoraInput.value = v;
    localStorage.setItem("valorHora", v);
    renderCalendar();
};

checkbox.onchange = () => {
    setShiftAssigned(checkbox.checked);
    renderBotones();
};

/* ======================================================
   HELPERS
====================================================== */

function parseInputDate(v){
    const p = v.split("-");
    return new Date(
        Number(p[0]),
        Number(p[1])-1,
        Number(p[2])
    );
}

function formatFechaUSA(fechaStr){

    const p = fechaStr.split("-");

    return `${p[1]}-${p[2]}-${p[0]}`;
}

function activarModo(modo, texto) {

    selectionMode = modo;
    window.selectionMode = modo;

    document.body.classList.add("mode-active");
    document.body.dataset.mode = modo;

    selectorInfo.innerHTML = `
        <div class="mode-banner">
            <span>🗓️ ${texto}</span>
            <button id="cancelModeBtn">✖</button>
        </div>
    `;

    selectorInfo.classList.remove("hidden");

    document
        .getElementById("cancelModeBtn")
        .onclick = desactivarModo;
}

function desactivarModo() {

    selectionMode = null;
    window.selectionMode = null;

    document.body.classList.remove("mode-active");
    document.body.removeAttribute("data-mode");

    selectorInfo.classList.add("hidden");
    adminInfo.classList.add("hidden");

    renderCalendar();
    renderTimeline();
    analizarStaffingMes();
}

function keyFromDate(d) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function parseKey(k) {
    const p = k.split("-");
    return new Date(Number(p[0]), Number(p[1]), Number(p[2]));
}

function contarHabiles(obj) {
    const year = new Date().getFullYear();
    let total = 0;

    Object.keys(obj).forEach(k => {
        if (!k.startsWith(year + "-")) return;

        const d = parseKey(k);
        const dow = d.getDay();

        if (dow !== 0 && dow !== 6) total++;
    });

    return total;
}

function renderBotones() {

    const perfiles = getProfiles();

    const actual =
        perfiles.find(
            x => x.name === getCurrentProfile()
        );

    const admin =
        actual &&
        actual.estamento === "Administrativo";

    checkbox.parentElement.style.display =
        admin ? "none" : "block";

    autoDiurnoBtn.style.display =
        admin ? "none" : "block";

    autoCuartoBtn.style.display =
        admin ? "none" : "block";

    compBtn.style.display =
        admin
        ? "none"
        : getShiftAssigned()
            ? "block"
            : "none";
}

function diasEntre(a, b) {
    return Math.floor((a - b) / 86400000);
}

function validarRangoAusencias(fechas) {

    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const abs = getAbsences();

    for (const key of fechas) {

        if (admin[key]) {
            alert("No se puede aplicar sobre Permiso Administrativo.");
            return false;
        }

        if (legal[key]) {
            alert("Ya existe Feriado Legal en ese rango.");
            return false;
        }

        if (comp[key]) {
            alert("Ya existe Feriado Compensatorio en ese rango.");
            return false;
        }

        if (abs[key]) {
            alert("Existe Licencia Médica en ese rango.");
            return false;
        }
    }

    return true;
}

/* ======================================================
   PERFILES
====================================================== */

function renderProfiles() {

    const profiles = getProfiles();
    const current = getCurrentProfile();
    const filtro = filterRole.value;

    profilesDiv.innerHTML = "";

    profiles
    .filter(p =>
        filtro === "Todos" ||
        p.estamento === filtro
    )
    .forEach(p => {

        const div = document.createElement("div");

        div.innerText =
            `${p.name} (${p.estamento})`;

        if (p.name === current) {
            div.classList.add("active");
        }

        div.onclick = async () => {

            setCurrentProfile(p.name);

            checkbox.checked =
                getShiftAssigned();

            await aplicarReglasPerfil(p);

            renderProfiles();
            renderBotones();
            renderCalendar();
            renderTimeline();
            analizarStaffingMes();
        };

        profilesDiv.appendChild(div);
    });
}

async function aplicarReglasPerfil(p){

    if(p.estamento === "Administrativo"){

        checkbox.checked = false;
        setShiftAssigned(false);

        await aplicarDiurnoDesde(
            new Date(
                new Date().getFullYear(),
                0,
                1
            )
        );
    }
}

createBtn.onclick = async () => {

    const name = newProfileInput.value.trim();
    if (!name) return;

    const estamento =
        newProfileRole.value;

    const profiles = getProfiles();

    if (profiles.some(x => x.name === name)) {
        alert("Ese perfil ya existe.");
        return;
    }

    const nuevo = {
        name,
        estamento
    };

    profiles.push(nuevo);

    saveProfiles(profiles);

    setCurrentProfile(name);

    newProfileInput.value = "";

    await aplicarReglasPerfil(nuevo);

    renderProfiles();
    renderSwapPanel();
    renderBotones();
    renderCalendar();
    renderTimeline();
    renderStaffingPanel();
    analizarStaffingMes();
};

filterRole.onchange = renderProfiles;

/* ======================================================
   TURNOS AUTOMÁTICOS
====================================================== */

async function aplicarDiurnoDesde(fecha) {
    const data = getProfileData();
    const blocked = getBlockedDays();

    const year = fecha.getFullYear();
    const holidays = await fetchHolidays(year);

    let d = new Date(fecha);

    while (d.getFullYear() === year) {
        const key = keyFromDate(d);

        delete data[key];
        delete blocked[key];

        if (isBusinessDay(d, holidays)) {
            data[key] = 4;
            blocked[key] = true;
        }

        d.setDate(d.getDate() + 1);
    }

    saveProfileData(data);
    saveBlockedDays(blocked);
    renderCalendar();
    renderTimeline();
    analizarStaffingMes();
}

function aplicarCuartoTurnoDesde(fecha) {

    localStorage.setItem(
        "rotativa_" + getCurrentProfile(),
        fecha
    );

    const data = getProfileData();
    const blocked = getBlockedDays();

    let d = new Date(fecha);
    const year = d.getFullYear();

    while (d.getFullYear() === year) {
        for (let i = 0; i < 4; i++) {

            const key = keyFromDate(d);

            delete data[key];
            delete blocked[key];

            if (i === 0) {
                data[key] = 1;
                blocked[key] = true;
            }

            if (i === 1) {
                data[key] = 2;
                blocked[key] = true;
            }

            d.setDate(d.getDate() + 1);
        }
    }

    saveProfileData(data);
    saveBlockedDays(blocked);
    renderCalendar();
    renderTimeline();
    analizarStaffingMes();
}

/* ======================================================
   ADMINISTRATIVO
====================================================== */

function totalAdministrativosUsados() {
    const admin = getAdminDays();

    let total = 0;

    Object.values(admin).forEach(v => {
        if (v === 1) total += 1;
        else total += 0.5;
    });

    return total;
}

function activarSelectorAdmin() {

    const usados = totalAdministrativosUsados();

    if (usados >= 6) {
        alert("Ya utilizó los 6 permisos administrativos.");
        return;
    }

    adminCantidad = 1;

    activarModo(
        "admin",
        "Selecciona un día para Permiso Administrativo"
    );

    renderCalendar();
    renderTimeline();
    analizarStaffingMes();
}


function activarSelectorHalfAdmin(tipo) {

    const usados = totalAdministrativosUsados();

    if (usados >= 6) {
        alert("Ya utilizó los 6 permisos administrativos.");
        return;
    }

    window.halfAdminTipo = tipo;

    activarModo(
        "halfadmin",
        tipo === "M"
        ? "Selecciona día válido para 1/2 Administrativo Mañana"
        : "Selecciona día válido para 1/2 Administrativo Tarde"
    );

    renderCalendar(); // 🔥 ESTA LÍNEA FALTABA
    renderTimeline();
    analizarStaffingMes();
}

async function aplicarAdministrativo(fecha) {

    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const abs = getAbsences();
    const data = getProfileData();

    const holidays =
        await fetchHolidays(fecha.getFullYear());

    let d = new Date(fecha);
    const nuevos = [];

    for (let i = 0; i < adminCantidad; i++) {

        if (d.getFullYear() !== fecha.getFullYear()) {
            alert("No puede pasar a enero.");
            return;
        }

        const key = keyFromDate(d);
        const turno = data[key] || 0;
        const habil =
            isBusinessDay(d, holidays);

        if (getShiftAssigned()) {

            // Solo días con turno
            if (turno === 0) {
                alert("No puede pedir PA en día libre.");
                return;
            }

        } else {

            // Solo hábiles
            if (!habil) {
                alert("Solo puede pedir PA en día hábil.");
                return;
            }
        }

        if (admin[key]) {
            alert("Ya existe PA.");
            return;
        }

        if (legal[key]) {
            alert("Feriado Legal.");
            return;
        }

        if (comp[key]) {
            alert("Feriado Compensatorio.");
            return;
        }

        if (abs[key]) {
            alert("Licencia Médica.");
            return;
        }

        nuevos.push(key);

        d.setDate(d.getDate() + 1);
    }

    nuevos.forEach(k => admin[k] = 1);

    saveAdminDays(admin);
    renderTimeline();
    analizarStaffingMes();
}

async function aplicarHalfAdministrativo(fecha, cerrarModo = false) {

    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const abs = getAbsences();
    const data = getProfileData();

    const holidays = await fetchHolidays(fecha.getFullYear());

    if (!isBusinessDay(fecha, holidays)) {
        alert("Solo puede aplicarse en día hábil.");
        return;
    }

    const key = keyFromDate(fecha);

    // Turno del día
    const turno = data[key] || 0;

    // Nunca en Noche
    if (turno === 2) {
        alert("No puede aplicarse en turno Noche.");
        return;
    }

    // Solo turnos permitidos
    if (![1,3,4,5].includes(turno)) {
        alert("Solo puede aplicarse en Largo, 24, Diurno o Diurno + Noche.");
        return;
    }

    if (admin[key]) {
        alert("Ese día ya posee Permiso Administrativo.");
        return;
    }

    if (legal[key]) {
        alert("No puede aplicarse sobre Feriado Legal.");
        return;
    }

    if (comp[key]) {
        alert("No puede aplicarse sobre Feriado Compensatorio.");
        return;
    }

    if (abs[key]) {
        alert("No puede aplicarse sobre Licencia Médica.");
        return;
    }

    const usados = totalAdministrativosUsados();

    if (usados + 0.5 > 6) {
        alert("Sin saldo.");
        return;
    }

    const tipo = window.halfAdminTipo || "M";

    admin[key] = tipo === "M"
        ? "0.5M"
        : "0.5T";

    saveAdminDays(admin);

    if(cerrarModo){
    desactivarModo();
}
    renderCalendar();
    renderTimeline();
    analizarStaffingMes();
}

/* ======================================================
   FERIADO LEGAL
====================================================== */

function existeBloque10Actual() {
    const legal = getLegalDays();

    const fechas = Object.keys(legal)
        .map(parseKey)
        .sort((a, b) => a - b);

    let maxSeguido = 0;
    let actual = 0;
    let prev = null;

    fechas.forEach(d => {
        const dow = d.getDay();

        if (dow === 0 || dow === 6) return;

        if (!prev) {
            actual = 1;
        } else {
            const dif = diasEntre(d, prev);

            if (dif <= 3) {
                actual++;
            } else {
                actual = 1;
            }
        }

        if (actual > maxSeguido) maxSeguido = actual;
        prev = d;
    });

    return maxSeguido >= 10;
}

function activarSelectorLegal() {
    const usados = contarHabiles(getLegalDays());
    const saldo = 15 - usados;

    if (saldo <= 0) {
        alert("Sin saldo de feriado legal.");
        return;
    }

    let cant = Number(prompt(`¿Cuántos días? Disponibles: ${saldo}`));
    if (!cant || cant <= 0) return;

    if (cant > saldo) {
        alert("Supera saldo.");
        return;
    }

    const yaTieneBloque10 = existeBloque10Actual();

    if (!yaTieneBloque10) {
        const restante = saldo - cant;

        if (cant < 10 && restante < 10) {
            alert("Debe quedar saldo suficiente para un bloque continuo de 10 días.");
            return;
        }
    }

    legalCantidad = cant;

    activarModo("legal", "Selecciona inicio Feriado Legal");
}

async function aplicarLegal(fecha) {

    const legal = getLegalDays();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const comp = getCompDays();
    const abs = getAbsences();

    const year = fecha.getFullYear();
    const holidays = await fetchHolidays(year);

    let usados = 0;
    let d = new Date(fecha);

    const nuevos = [];

    while (usados < legalCantidad) {

        if (d.getFullYear() !== year) {
            alert("No puede continuar a enero del siguiente año.");
            return;
        }

        const key = keyFromDate(d);


        nuevos.push(key);

        if (isBusinessDay(d, holidays)) {
            usados++;
        }

        d.setDate(d.getDate() + 1);
    }

    if (!validarRangoAusencias(nuevos)) {
    return;
    }

    nuevos.forEach(k => {
        legal[k] = true;
        blocked[k] = true;
    });

    saveLegalDays(legal);
    saveBlockedDays(blocked);
    renderTimeline();
    analizarStaffingMes();
}

/* ======================================================
   FERIADO COMPENSATORIO
====================================================== */

function ultimoLegal() {
    const legal = getLegalDays();

    let ult = null;

    Object.keys(legal).forEach(k => {
        const d = parseKey(k);

        if (!ult || d > ult) ult = d;
    });

    return ult;
}

function activarSelectorComp() {
    if (!getShiftAssigned()) {
        alert("Solo disponible con Asignación de Turno.");
        return;
    }

    const usados = contarHabiles(getCompDays());

    if (usados >= 10) {
        alert("Ya utilizó los 10 compensatorios.");
        return;
    }

    activarModo("comp", "Selecciona inicio Feriado Compensatorio");
}

async function aplicarComp(fecha) {

    const comp = getCompDays();
    const blocked = getBlockedDays();
    const legal = getLegalDays();
    const admin = getAdminDays();
    const abs = getAbsences();

    const year = fecha.getFullYear();
    const holidays = await fetchHolidays(year);

    const ult = ultimoLegal();

    if (ult && fecha > ult) {
        const dias = diasEntre(fecha, ult);

        if (dias < 90) {
            alert("Deben pasar 90 días desde el último Feriado Legal.");
            return;
        }
    }

    let usados = 0;
    let d = new Date(fecha);

    const nuevos = [];

    while (usados < 10) {

        if (d.getFullYear() !== year) {
            alert("No puede continuar a enero del siguiente año.");
            return;
        }

        const key = keyFromDate(d);


        nuevos.push(key);

        if (isBusinessDay(d, holidays)) {
            usados++;
        }

        d.setDate(d.getDate() + 1);
    }

    if (!validarRangoAusencias(nuevos)) {
    return;
    }

    nuevos.forEach(k => {
        comp[k] = true;
        blocked[k] = true;
    });

    saveCompDays(comp);
    saveBlockedDays(blocked);
    renderTimeline();
    analizarStaffingMes();
}



/* ======================================================
   LICENCIA MÉDICA
====================================================== */

function activarSelectorLicencia() {
    let cant = Number(prompt("¿Cuántos días dura la licencia médica?"));
    if (!cant || cant <= 0) return;

    licenseCantidad = cant;

    activarModo("license", "Selecciona inicio Licencia Médica");
}

function aplicarLicencia(fecha) {
    const abs = getAbsences();
    const blocked = getBlockedDays();

    let d = new Date(fecha);

    for (let i = 0; i < licenseCantidad; i++) {
        const key = keyFromDate(d);

        abs[key] = { type: "license" };
        blocked[key] = true;

        d.setDate(d.getDate() + 1);
    }

    saveAbsences(abs);
    saveBlockedDays(blocked);
    renderTimeline();
    analizarStaffingMes();
}

/* ======================================================
   BOTONES
====================================================== */

autoDiurnoBtn.onclick = () =>
    activarModo("diurno", "Selecciona inicio Auto Diurno");

autoCuartoBtn.onclick = () =>
    activarModo("cuarto", "Selecciona inicio Cuarto Turno");

adminBtn.onclick = () => {
    activarSelectorAdmin();
};
halfAdminMorningBtn.onclick =
() => activarSelectorHalfAdmin("M");
halfAdminAfternoonBtn.onclick =
() => activarSelectorHalfAdmin("T");
legalBtn.onclick = activarSelectorLegal;
compBtn.onclick = activarSelectorComp;
licenseBtn.onclick = activarSelectorLicencia;

document.getElementById("prevBtn").onclick = prevMonth;
document.getElementById("nextBtn").onclick = nextMonth;

document.getElementById("undoBtn").onclick = () => {

    if(undo()){
        renderCalendar();
        renderTimeline();

        if(typeof renderStaffingPanel === "function"){
            renderStaffingPanel();
        }
    }
};

document.getElementById("redoBtn").onclick = () => {

    if(redo()){
        renderCalendar();
        renderTimeline();

        if(typeof renderStaffingPanel === "function"){
            renderStaffingPanel();
        }
    }
};

/* ======================================================
   CLICK CALENDARIO
====================================================== */

document.addEventListener("click", async (e) => {
    const celda = e.target.closest(".day");
    if (!celda) return;

    const fecha = new Date(
        Number(celda.dataset.year),
        Number(celda.dataset.month),
        Number(celda.dataset.day)
    );

    if (selectionMode === "license") {
        pushHistory();
        await aplicarLicencia(fecha);
        desactivarModo();
        return;
    }

    if (selectionMode === "comp") {
        pushHistory();
        await aplicarComp(fecha);
        desactivarModo();
        return;
    }

    if (selectionMode === "legal") {
        pushHistory();
        await aplicarLegal(fecha);
        desactivarModo();
        return;
    }

    if (selectionMode === "halfadmin") {
        pushHistory();
        await aplicarHalfAdministrativo(fecha, true);
        return;
}

    if (selectionMode === "admin") {
        pushHistory();
        await aplicarAdministrativo(fecha);
        desactivarModo();
        return;
}

    if (selectionMode === "diurno") {
        pushHistory();
        await aplicarDiurnoDesde(fecha);
        desactivarModo();
        return;
    }

    if (selectionMode === "cuarto") {
        pushHistory();
        aplicarCuartoTurnoDesde(fecha);
        desactivarModo();
        return;
    }
});

/* ======================================================
   INICIO
====================================================== */

renderProfiles();
renderStaffingPanel();
renderSwapPanel();

const perfiles = getProfiles();

if (perfiles.length > 0) {

    setCurrentProfile(perfiles[0]);

    checkbox.checked = getShiftAssigned();

    renderBotones();
    renderCalendar();
    renderTimeline();
    analizarStaffingMes();

} else {

    // estado vacío inicial
    document.getElementById("calendar").innerHTML = `
        <div style="
            grid-column:1/-1;
            padding:40px;
            text-align:center;
            color:#666;
            font-size:18px;
        ">
            Cree un perfil para comenzar
        </div>
    `;

    document.getElementById("teamTimeline").innerHTML = "";
}