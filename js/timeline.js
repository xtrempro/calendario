import {
    getProfiles,
    getCurrentProfile
} from "./storage.js";

import * as calendar from "./calendar.js";
import { aplicarCambiosTurno } from "./turnEngine.js";
import { TURNO_COLOR } from "./constants.js";
import { fetchHolidays } from "./holidays.js";
import { calcularHorasMesPerfil } from "./hoursEngine.js";

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

function getBlocked(nombre){
    return JSON.parse(localStorage.getItem("blocked_" + nombre)) || {};
}

function getCarry(nombre, y, m){
    return JSON.parse(
        localStorage.getItem(`carry_${nombre}_${y}_${m}`)
    ) || { d: 0, n: 0 };
}

function formatTimelineHours(value){
    const rounded = Math.round(Number(value) || 0);

    return rounded > 0 ? String(rounded) : "";
}

function getColor(nombre, key){
    const data = getData(nombre);
    const admin = getAdmin(nombre);
    const legal = getLegal(nombre);
    const comp = getComp(nombre);
    const abs = getAbs(nombre);

    if (abs[key]) return "#ef4444";
    if (legal[key]) return "#0ea5a6";
    if (comp[key]) return "#f97316";

    if (admin[key] === 1) return "#f59e0b";
    if (admin[key] === "0.5M") return "#fbbf24";
    if (admin[key] === "0.5T") return "#facc15";

    let turno = Number(data[key]) || 0;

    turno = aplicarCambiosTurno(
        nombre,
        key,
        turno
    );

    return TURNO_COLOR[turno] || TURNO_COLOR[0];
}

export async function renderTimeline(){
    const div = document.getElementById("teamTimeline");
    if (!div) return;

    const profiles = getProfiles();
    const actual = getCurrentProfile();

    const perfilActual =
        profiles.find(x => x.name === actual);

    if (!perfilActual) {
        div.innerHTML = `
            <div class="empty-state empty-state--compact">
                Selecciona un colaborador para ver el reporte mensual.
            </div>
        `;
        return;
    }

    const grupo = profiles
        .filter(
            profile =>
                profile.estamento === perfilActual.estamento
        )
        .sort((a, b) => {
            if (a.name === actual) return -1;
            if (b.name === actual) return 1;
            return a.name.localeCompare(b.name);
        });

    if (!grupo.length) {
        div.innerHTML = `
            <div class="empty-state empty-state--compact">
                No hay colaboradores del mismo estamento para comparar este mes.
            </div>
        `;
        return;
    }

    const year = calendar.currentDate.getFullYear();
    const month = calendar.currentDate.getMonth();
    const diasMes =
        new Date(year, month + 1, 0).getDate();
    const holidays = await fetchHolidays(year);

    let html = `
        <div class="timeline-shell">
            <table class="timeline-table">
                <thead>
                    <tr>
                        <th class="timeline-name-head">Funcionarios</th>
                        <th class="timeline-hhee-head timeline-hhee--day">HHEE Diurnas</th>
                        <th class="timeline-hhee-head timeline-hhee--night">HHEE Nocturnas</th>
    `;

    for (let d = 1; d <= diasMes; d++) {
        html += `<th>${d}</th>`;
    }

    html += `
                    </tr>
                </thead>
                <tbody>
    `;

    grupo.forEach(profile => {
        const data = getData(profile.name);
        const stats = calcularHorasMesPerfil(
            profile.name,
            year,
            month,
            diasMes,
            holidays,
            data,
            getBlocked(profile.name),
            getCarry(profile.name, year, month)
        );

        html += `<tr>`;
        html += `<td class="namecol">${profile.name}</td>`;
        html += `
            <td class="timeline-hhee timeline-hhee--day">
                ${formatTimelineHours(stats.hheeDiurnas)}
            </td>
            <td class="timeline-hhee timeline-hhee--night">
                ${formatTimelineHours(stats.hheeNocturnas)}
            </td>
        `;

        for (let d = 1; d <= diasMes; d++) {
            const key = `${year}-${month}-${d}`;
            const color = getColor(profile.name, key);

            html += `
                <td
                    class="mini"
                    style="background:${color}"
                ></td>
            `;
        }

        html += `</tr>`;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    div.innerHTML = html;
}
