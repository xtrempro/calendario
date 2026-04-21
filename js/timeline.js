import {
    getProfiles,
    getCurrentProfile
} from "./storage.js";

import * as calendar from "./calendar.js";
import { aplicarCambiosTurno } from "./turnEngine.js";
import { TURNO_COLOR } from "./constants.js";

/* ==========================================
   STORAGE HELPERS
========================================== */

function getData(nombre){
    return JSON.parse(localStorage.getItem("data_" + nombre)) || {};
}

function getAdmin(nombre){
    return JSON.parse(localStorage.getItem("admin_" + nombre)) || {};
}

function getLegal(nombre){
    return JSON.parse(localStorage.getItem("legal_" + nombre)) || {};
}

function getComp(nombre){
    return JSON.parse(localStorage.getItem("comp_" + nombre)) || {};
}

function getAbs(nombre){
    return JSON.parse(localStorage.getItem("absences_" + nombre)) || {};
}

/* ==========================================
   COLOR EXACTO DEL CALENDARIO
========================================== */

function getColor(nombre, key){

    const data = getData(nombre);
    const admin = getAdmin(nombre);
    const legal = getLegal(nombre);
    const comp = getComp(nombre);
    const abs = getAbs(nombre);

    if(abs[key]) return "#ff4d4d";
    if(legal[key]) return "#00c853";
    if(comp[key]) return "#ff9800";

    if(admin[key] === 1) return "#ffd600";
    if(admin[key] === "0.5M") return "#fff176";
    if(admin[key] === "0.5T") return "#ffee58";

    let turno = Number(data[key]) || 0;

    turno = aplicarCambiosTurno(
        nombre,
        key,
        turno
    );

    return TURNO_COLOR[turno] || TURNO_COLOR[0];
}

/* ==========================================
   RENDER
========================================== */

export function renderTimeline(){

    const div = document.getElementById("teamTimeline");
    if(!div) return;

    const profiles = getProfiles();
    const actual = getCurrentProfile();

    const perfilActual =
        profiles.find(x => x.name === actual);

    if(!perfilActual) return;

    const grupo = profiles
        .filter(x =>
            x.estamento === perfilActual.estamento
        )
        .sort((a,b)=>{
            if(a.name === actual) return -1;
            if(b.name === actual) return 1;
            return a.name.localeCompare(b.name);
        });

    const year = calendar.currentDate.getFullYear();
    const month = calendar.currentDate.getMonth();

    const diasMes =
        new Date(year, month + 1, 0).getDate();

    let html = `<table class="timeline-table">`;

    html += `<tr><th>Funcionario</th>`;

    for(let d=1; d<=diasMes; d++){
        html += `<th>${d}</th>`;
    }

    html += `</tr>`;

    grupo.forEach(p=>{

        html += `<tr>`;
        html += `<td class="namecol">${p.name}</td>`;

        for(let d=1; d<=diasMes; d++){

            const key =
                `${year}-${month}-${d}`;

            const color =
                getColor(p.name, key);

            html += `
                <td class="mini"
                    style="background:${color}">
                </td>
            `;
        }

        html += `</tr>`;
    });

    html += `</table>`;

    div.innerHTML = html;
}