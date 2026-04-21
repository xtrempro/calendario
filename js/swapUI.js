import { registrarCambio } from "./swaps.js";
import { getProfiles, getSwaps } from "./storage.js";
import { refreshAll } from "./refresh.js";
import { pushHistory } from "./history.js";


/* ===============================
   HELPERS
=============================== */

function parseInputDate(v){
    const p = v.split("-");
    return new Date(
        Number(p[0]),
        Number(p[1]) - 1,
        Number(p[2])
    );
}

function formatFechaUSA(fechaStr){
    const p = fechaStr.split("-");
    return `${p[1]}-${p[2]}-${p[0]}`;
}

/* ===============================
   BASE STATE
=============================== */

function getBaseState(nombre, year, month, day = 1){

    const data = JSON.parse(
        localStorage.getItem("data_" + nombre)
    ) || {};

    const blocked = JSON.parse(
        localStorage.getItem("blocked_" + nombre)
    ) || {};

    const key = `${year}-${month}-${day}`;

    if(!blocked[key]) return null;

    return Number(data[key]) || 0;
}

function codigoTurno(valor){

    valor = Number(valor) || 0;

    if(valor === 2) return "N";
    if(valor === 4) return "D";

    return "L";
}

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

/* ===============================
   RENDER
=============================== */

export function renderSwapPanel(){

    const box = document.getElementById("swapPanel");
    if(!box) return;

    const perfiles = getProfiles();

    const options = perfiles.map(p =>
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

    document.getElementById("saveSwapBtn").onclick =
        guardarCambioTurno;

    document.getElementById("swapFrom").onchange =
        actualizarSwapTo;

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

function renderSwapList(){

    const div =
        document.getElementById("swapList");

    const swaps = getSwaps();

    div.innerHTML = swaps.map(s => `
        <div class="swap-item">
            ${s.from} → ${s.to}
            (${formatFechaUSA(s.fecha)})
            ↩ devolución ${formatFechaUSA(s.devolucion)}
        </div>
    `).join("");
}

/* ===============================
   GUARDAR
=============================== */

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

    const turnoFrom = getBaseState(
        from,
        f1.getFullYear(),
        f1.getMonth(),
        f1.getDate()
    );

    const turnoTo = getBaseState(
        to,
        f2.getFullYear(),
        f2.getMonth(),
        f2.getDate()
    );

    if(turnoFrom === null){
        alert(from + " no tiene turno ese día");
        return;
    }

    if(turnoTo === null){
        alert(to + " no tiene turno en devolución");
        return;
    }

    registrarCambio({
        from,
        to,
        fecha,
        devolucion,

        turno: codigoTurno(turnoFrom),
        turnoDevuelto: codigoTurno(turnoTo),

        year: f1.getFullYear(),
        month: f1.getMonth()
    });

    pushHistory();

    refreshAll();

    alert("Cambio registrado");
}