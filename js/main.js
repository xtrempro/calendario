import { renderCalendar, prevMonth, nextMonth } from "./calendar.js";
import { renderTimeline } from "./timeline.js";
import { pushHistory, undo, redo } from "./history.js";
import { refreshAll } from "./refresh.js";
import { DOM } from "./dom.js";
import { renderSwapPanel } from "./swapUI.js";
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
    saveAbsences
} from "./storage.js";

import {
    totalAdministrativosUsados,
    aplicarAdministrativo,
    aplicarHalfAdministrativo,
    existeBloque10Actual,
    aplicarLegal,
    aplicarComp,
    aplicarLicencia
} from "./leaveEngine.js";


/* ======================================================
   ESTADO
====================================================== */

let selectionMode = null;
let adminCantidad = 0;
let legalCantidad = 0;
let licenseCantidad = 0;

window.selectionMode = null;

/* ======================================================
   CONFIG
====================================================== */

DOM.valorHoraInput.value = localStorage.getItem("valorHora") || "";

DOM.valorHoraInput.oninput = () => {
    let v = Number(DOM.valorHoraInput.value);
    if (v < 0) v = 0;
    DOM.valorHoraInput.value = v;
    localStorage.setItem("valorHora", v);
    renderCalendar();
};

DOM.checkbox.onchange = () => {
    setShiftAssigned(DOM.checkbox.checked);
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

    DOM.selectorInfo.innerHTML = `
        <div class="mode-banner">
            <span>🗓️ ${texto}</span>
            <button id="cancelModeBtn">✖</button>
        </div>
    `;

    DOM.selectorInfo.classList.remove("hidden");

    document
        .getElementById("cancelModeBtn")
        .onclick = desactivarModo;
}

function desactivarModo() {

    selectionMode = null;
    window.selectionMode = null;

    document.body.classList.remove("mode-active");
    document.body.removeAttribute("data-mode");

    DOM.selectorInfo.classList.add("hidden");
    DOM.adminInfo.classList.add("hidden");

    refreshAll();
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

    DOM.checkbox.parentElement.style.display =
        admin ? "none" : "block";

    DOM.autoDiurnoBtn.style.display =
        admin ? "none" : "block";

    DOM.autoCuartoBtn.style.display =
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
    const filtro = DOM.filterRole.value;

    DOM.profiles.innerHTML = "";

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

            DOM.checkbox.checked =
                getShiftAssigned();

            await aplicarReglasPerfil(p);

            renderProfiles();
            renderBotones();
            refreshAll();
        };

        DOM.profiles.appendChild(div);
    });
}

async function aplicarReglasPerfil(p){

    if(p.estamento === "Administrativo"){

        DOM.checkbox.checked = false;
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

DOM.createBtn.onclick = async () => {

    const name = DOM.newProfileInput.value.trim();
    if (!name) return;

    const estamento =
        DOM.newProfileRole.value;

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

    DOM.newProfileInput.value = "";

    await aplicarReglasPerfil(nuevo);

    renderProfiles();
    renderSwapPanel();
    renderBotones();
    renderStaffingPanel();
    refreshAll();
};

DOM.filterRole.onchange = renderProfiles;

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
    refreshAll();
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
    refreshAll();
}

// funciones UI de leaveengine

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

    legalCantidad = cant;

    activarModo(
        "legal",
        "Selecciona inicio Feriado Legal"
    );
}

function activarSelectorComp() {

    if (!getShiftAssigned()) {
        alert("Solo disponible con Asignación de Turno.");
        return;
    }

    activarModo(
        "comp",
        "Selecciona inicio Feriado Compensatorio"
    );
}

function activarSelectorLicencia() {

    let cant = Number(
        prompt("¿Cuántos días dura la licencia médica?")
    );

    if (!cant || cant <= 0) return;

    licenseCantidad = cant;

    activarModo(
        "license",
        "Selecciona inicio Licencia Médica"
    );
}

function activarSelectorAdmin() {

    if (totalAdministrativosUsados() >= 6) {
        alert("Ya utilizó los 6 permisos administrativos.");
        return;
    }

    adminCantidad = 1;

    activarModo(
        "admin",
        "Selecciona día administrativo"
    );
}

function activarSelectorHalfAdmin(tipo) {

    if (totalAdministrativosUsados() >= 6) {
        alert("Sin saldo.");
        return;
    }

    window.halfAdminTipo = tipo;

    activarModo(
        "halfadmin",
        tipo === "M"
        ? "Selecciona 1/2 Administrativo Mañana"
        : "Selecciona 1/2 Administrativo Tarde"
    );
}



/* ======================================================
   BOTONES
====================================================== */

DOM.autoDiurnoBtn.onclick = () =>
    activarModo("diurno", "Selecciona inicio Auto Diurno");

DOM.autoCuartoBtn.onclick = () =>
    activarModo("cuarto", "Selecciona inicio Cuarto Turno");

DOM.adminBtn.onclick = () => {
    activarSelectorAdmin();
};
DOM.halfAdminMorningBtn.onclick =
() => activarSelectorHalfAdmin("M");
DOM.halfAdminAfternoonBtn.onclick =
() => activarSelectorHalfAdmin("T");
DOM.legalBtn.onclick = activarSelectorLegal;
DOM.compBtn.onclick = activarSelectorComp;
DOM.licenseBtn.onclick = activarSelectorLicencia;

DOM.prevBtn.onclick = prevMonth;
DOM.nextBtn.onclick = nextMonth;

DOM.undoBtn.onclick = () => {

    if(undo()){
        renderCalendar();
        renderTimeline();

        if(typeof renderStaffingPanel === "function"){
            renderStaffingPanel();
        }
    }
};

DOM.redoBtn.onclick = () => {

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
        await aplicarLicencia(fecha, licenseCantidad);
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
        await await aplicarLegal(fecha, legalCantidad);
        desactivarModo();
        return;
    }

    if (selectionMode === "halfadmin") {
        pushHistory();
        await aplicarHalfAdministrativo(
        fecha,
        window.halfAdminTipo || "M"
        );
        desactivarModo();
        return;
}

    if (selectionMode === "admin") {
        pushHistory();
        await aplicarAdministrativo(fecha, adminCantidad);
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

    DOM.checkbox.checked = getShiftAssigned();

    renderBotones();
    refreshAll();

} else {

    // estado vacío inicial
    DOM.calendar.innerHTML = `
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
    
    DOM.teamTimeline.innerHTML = "";
}