// js/staffing.js

import {
    getProfiles,
    getCurrentProfile
} from "./storage.js";

import { isWeekend } from "./calculations.js";

/* ==========================================
   STORAGE CONFIG
========================================== */

const KEY = "staffing_config";

function defaultConfig() {
    return {
        Profesional: { habil: 2, inhabil: 1, noche: 1 },
        Técnico: { habil: 3, inhabil: 2, noche: 1 },
        Administrativo: { habil: 2, inhabil: 0, noche: 0 },
        Auxiliar: { habil: 2, inhabil: 1, noche: 1 }
    };
}

export function getStaffingConfig() {
    return JSON.parse(localStorage.getItem(KEY)) || defaultConfig();
}

export function saveStaffingConfig(cfg) {
    localStorage.setItem(KEY, JSON.stringify(cfg));
}

/* ==========================================
   TURNOS
   1=Larga
   2=Noche
   3=24
   4=Diurno
   5=D+N
========================================== */

function trabajaDia(turno) {
    return [1,3,4,5].includes(turno);
}

function trabajaNoche(turno) {
    return [2,3,5].includes(turno);
}

/* ==========================================
   FECHA
========================================== */

function key(y,m,d){
    return `${y}-${m}-${d}`;
}

/* ==========================================
   OBTENER DATA PERFIL
========================================== */

function getDataPerfil(nombre){
    return JSON.parse(
        localStorage.getItem("data_" + nombre)
    ) || {};
}

/* ==========================================
   CONTAR COBERTURA
========================================== */

function contarGrupo(profiles, estamento, y,m,d){

    let dia = 0;
    let noche = 0;

    profiles
    .filter(p => p.estamento === estamento)
    .forEach(p => {

        const data = getDataPerfil(p.name);
        const turno = data[key(y,m,d)] || 0;

        if(trabajaDia(turno)) dia++;
        if(trabajaNoche(turno)) noche++;
    });

    return { dia, noche };
}

/* ==========================================
   REEMPLAZO
========================================== */

function sugerirReemplazo(profiles, estamento, y,m,d){

    const libres = profiles
        .filter(p => p.estamento === estamento)
        .filter(p => {

            const data = getDataPerfil(p.name);
            const turno = data[key(y,m,d)] || 0;

            return turno === 0;
        });

    if(!libres.length) return null;

    libres.sort((a,b)=>a.name.localeCompare(b.name));

    return libres[0].name;
}

/* ==========================================
   ANALISIS MES
========================================== */

export function analizarMes(year, month){

    const cfg = getStaffingConfig();
    const profiles = getProfiles();

    const diasMes =
        new Date(year, month+1, 0).getDate();

    const salida = [];

    for(let d=1; d<=diasMes; d++){

        const fecha = new Date(year,month,d);

        const habil = !isWeekend(fecha);

        const detalle = [];

        ["Profesional","Técnico","Administrativo","Auxiliar"]
        .forEach(est => {

            const req =
                habil
                ? cfg[est].habil
                : cfg[est].inhabil;

            const reqN = cfg[est].noche;

            const real =
                contarGrupo(
                    profiles,
                    est,
                    year,
                    month,
                    d
                );

            if(real.dia < req){

                const faltan = req-real.dia;

                const sug =
                    sugerirReemplazo(
                        profiles,
                        est,
                        year,
                        month,
                        d
                    );

                detalle.push({
                    tipo:"faltante",
                    estamento:est,
                    cantidad:faltan,
                    sugerencia:sug
                });
            }

            if(real.dia > req){
                detalle.push({
                    tipo:"exceso",
                    estamento:est,
                    cantidad:real.dia-req
                });
            }

            if(real.noche < reqN){
                detalle.push({
                    tipo:"noche",
                    estamento:est,
                    cantidad:reqN-real.noche
                });
            }
        });

        salida.push({
            dia:d,
            detalle
        });
    }

    return salida;
}


/* ==========================================
   PANEL VISUAL
========================================== */

export function renderStaffingPanel(){

    const btn = document.getElementById("saveStaffingBtn");
    if(!btn) return;

    const cfg = getStaffingConfig();

    const grupos = [
        "Profesional",
        "Técnico",
        "Administrativo",
        "Auxiliar"
    ];

    grupos.forEach(est => {

        document.getElementById(`cfg_${est}_habil`).value =
            cfg[est].habil;

        document.getElementById(`cfg_${est}_inhabil`).value =
            cfg[est].inhabil;

        document.getElementById(`cfg_${est}_noche`).value =
            cfg[est].noche;
    });

    btn.onclick = () => {

        const nuevo = {};

        grupos.forEach(est => {

            nuevo[est] = {
                habil: Number(document.getElementById(`cfg_${est}_habil`).value) || 0,
                inhabil: Number(document.getElementById(`cfg_${est}_inhabil`).value) || 0,
                noche: Number(document.getElementById(`cfg_${est}_noche`).value) || 0
            };
        });

        saveStaffingConfig(nuevo);

        const hoy = new Date();

        mostrarResultado(
            analizarMes(
                hoy.getFullYear(),
                hoy.getMonth()
            )
        );
    };
}

function mostrarResultado(data){

    const div = document.getElementById("staffingResult");
    if(!div) return;

    let html = "<b>Análisis actual:</b><br><br>";

    data.forEach(x => {

        if(!x.detalle.length) return;

        html += `<b>Día ${x.dia}</b><br>`;

        x.detalle.forEach(d => {

            if(d.tipo === "faltante"){
                html += `🔴 Falta ${d.cantidad} ${d.estamento}`;
                if(d.sugerencia){
                    html += ` (Sugerido: ${d.sugerencia})`;
                }
                html += "<br>";
            }

            if(d.tipo === "exceso"){
                html += `🟡 Exceso ${d.cantidad} ${d.estamento}<br>`;
            }

            if(d.tipo === "noche"){
                html += `🌙 Falta noche ${d.cantidad} ${d.estamento}<br>`;
            }

        });

        html += "<br>";
    });

    div.innerHTML = html;
}

export function analizarStaffingMes(year, month){
    const data = analizarMes(year, month);
    mostrarResultado(data);
    return data;
}