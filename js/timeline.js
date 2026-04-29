import {
    getProfiles,
    getCurrentProfile,
    getShiftAssigned
} from "./storage.js";

import * as calendar from "./calendar.js";
import {
    aplicarCambiosTurno,
    getTurnoBase
} from "./turnEngine.js";
import { TURNO_COLOR } from "./constants.js";
import { fetchHolidays } from "./holidays.js";
import { calcularHorasMesPerfil } from "./hoursEngine.js";
import { getJSON } from "./persistence.js";
import {
    getTurnoExtraAgregado,
    requiereReemplazoTurnoBase,
    restarTurnoCubierto
} from "./rulesEngine.js";
import {
    getBackedTurnForWorker,
    getClockExtraBackupForWorker,
    getReplacementForCoveredShift,
    getReplacementForWorkerShift
} from "./replacements.js";
import {
    hasContractForDate,
    isReplacementProfile
} from "./contracts.js";
import {
    hasClockExtra,
    hasSevereClockIncident,
    hasSimpleClockIncident
} from "./clockMarks.js";

function getData(nombre){
    return getJSON("data_" + nombre, {});
}

function getAdmin(nombre){
    return getJSON("admin_" + nombre, {});
}

function getLegal(nombre){
    return getJSON("legal_" + nombre, {});
}

function getComp(nombre){
    return getJSON("comp_" + nombre, {});
}

function getAbs(nombre){
    return getJSON("absences_" + nombre, {});
}

function getBlocked(nombre){
    return getJSON("blocked_" + nombre, {});
}

function getCarry(nombre, y, m){
    return getJSON(
        `carry_${nombre}_${y}_${m}`,
        { d: 0, n: 0 }
    );
}

function formatTimelineHours(value){
    const rounded =
        Math.round((Number(value) || 0) * 2) / 2;

    if (!rounded) return "";

    return String(rounded).replace(".", ",");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function dayExtraAlertClass(nombre, value) {
    if (!getShiftAssigned(nombre)) {
        return "";
    }

    const hours = Number(value) || 0;

    if (hours >= 40) {
        return " hhee-alert-danger";
    }

    if (hours > 30 && hours < 40) {
        return " hhee-alert-warning";
    }

    return "";
}

function syncTimelineStickyOffsets(container) {
    const shell = container.querySelector(".timeline-shell");
    const headerCells = container.querySelectorAll(
        ".timeline-table thead th"
    );

    if (!shell || headerCells.length < 3) return;

    const nameWidth = Math.ceil(
        headerCells[0].getBoundingClientRect().width
    );
    const dayWidth = Math.ceil(
        headerCells[1].getBoundingClientRect().width
    );

    shell.style.setProperty(
        "--timeline-hhee-day-left",
        `${nameWidth}px`
    );
    shell.style.setProperty(
        "--timeline-hhee-night-left",
        `${nameWidth + dayWidth}px`
    );
}

function getColor(nombre, key){
    const data = getData(nombre);
    const admin = getAdmin(nombre);
    const legal = getLegal(nombre);
    const comp = getComp(nombre);
    const abs = getAbs(nombre);

    if (abs[key]?.type === "professional_license") return "#2563eb";
    if (abs[key]?.type === "unpaid_leave") return "#6b7280";
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

function needsReplacementMarker(nombre, key) {
    return (
        requiereReemplazoTurnoBase(
            key,
            getTurnoBase(nombre, key),
            getAdmin(nombre),
            getLegal(nombre),
            getComp(nombre),
            getAbs(nombre)
        ) &&
        !getReplacementForCoveredShift(nombre, key)
    );
}

function replacementMarker(nombre, key) {
    return getReplacementForWorkerShift(nombre, key);
}

function pendingManualExtraMarker(nombre, key) {
    const data = getData(nombre);
    const baseWithSwaps = aplicarCambiosTurno(
        nombre,
        key,
        getTurnoBase(nombre, key),
        { includeReplacements: false }
    );
    const actualWithSwaps = aplicarCambiosTurno(
        nombre,
        key,
        Number(data[key]) || 0,
        { includeReplacements: false }
    );
    const extraTurn = getTurnoExtraAgregado(
        baseWithSwaps,
        actualWithSwaps
    );

    return restarTurnoCubierto(
        extraTurn,
        getBackedTurnForWorker(nombre, key)
    );
}

function contractErrorMarker(nombre, key) {
    if (!isReplacementProfile(nombre)) {
        return false;
    }

    const data = getData(nombre);
    const state = aplicarCambiosTurno(
        nombre,
        key,
        Number(data[key]) || 0
    );

    return state > 0 && !hasContractForDate(nombre, key);
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
                        <th class="timeline-hhee-head timeline-hhee--day" title="HHEE Diurnas">
                            <span class="timeline-hhee-label" aria-label="HHEE Diurnas">
                                <span>HHEE</span>
                                <svg class="timeline-hhee-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <circle cx="12" cy="12" r="4"></circle>
                                    <path d="M12 2v2"></path>
                                    <path d="M12 20v2"></path>
                                    <path d="M4.93 4.93l1.41 1.41"></path>
                                    <path d="M17.66 17.66l1.41 1.41"></path>
                                    <path d="M2 12h2"></path>
                                    <path d="M20 12h2"></path>
                                    <path d="M6.34 17.66l-1.41 1.41"></path>
                                    <path d="M17.66 6.34l1.41-1.41"></path>
                                </svg>
                            </span>
                        </th>
                        <th class="timeline-hhee-head timeline-hhee--night" title="HHEE Nocturnas">
                            <span class="timeline-hhee-label" aria-label="HHEE Nocturnas">
                                <span>HHEE</span>
                                <svg class="timeline-hhee-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M21 12.79A9 9 0 1 1 11.21 3A7 7 0 0 0 21 12.79z"></path>
                                </svg>
                            </span>
                        </th>
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
        html += `
            <td class="namecol">
                <button
                    class="timeline-profile-link"
                    type="button"
                    data-profile-name="${escapeHtml(profile.name)}"
                    title="Abrir perfil de ${escapeHtml(profile.name)}"
                >
                    ${escapeHtml(profile.name)}
                </button>
            </td>
        `;
        html += `
            <td class="timeline-hhee timeline-hhee--day${dayExtraAlertClass(profile.name, stats.hheeDiurnas)}">
                ${formatTimelineHours(stats.hheeDiurnas)}
            </td>
            <td class="timeline-hhee timeline-hhee--night">
                ${formatTimelineHours(stats.hheeNocturnas)}
            </td>
        `;

        for (let d = 1; d <= diasMes; d++) {
            const key = `${year}-${month}-${d}`;
            const color = getColor(profile.name, key);
            const contractError =
                contractErrorMarker(profile.name, key);
            const needsReplacement =
                needsReplacementMarker(profile.name, key);
            const pendingManualExtra =
                pendingManualExtraMarker(profile.name, key);
            const severeClockIncident =
                hasSevereClockIncident(profile.name, key);
            const simpleClockIncident =
                !severeClockIncident &&
                hasSimpleClockIncident(profile.name, key);
            const clockExtra =
                hasClockExtra(
                    profile.name,
                    key,
                    new Date(year, month, d),
                    aplicarCambiosTurno(
                        profile.name,
                        key,
                        Number(data[key]) || 0
                    ),
                    holidays
                );
            const showClockExtra =
                clockExtra &&
                !getClockExtraBackupForWorker(profile.name, key);
            const showExtraReason =
                !contractError &&
                !needsReplacement &&
                pendingManualExtra;
            const replacement =
                replacementMarker(profile.name, key);
            const marker = contractError
                ? "X"
                : severeClockIncident
                    ? "!!!"
                    : needsReplacement
                        ? "!"
                        : showExtraReason || showClockExtra
                        ? "?"
                        : simpleClockIncident
                            ? "*"
                            : (replacement ? "R" : "");
            const title = contractError
                ? "No tiene contrato vigente en la fecha seleccionada"
                : severeClockIncident
                    ? "Incidencia grave de marcaje"
                    : needsReplacement
                        ? "Requiere reemplazo de turno base"
                        : showExtraReason
                        ? "Requiere motivo de horas extras"
                        : showClockExtra
                            ? "Requiere motivo por horas extras de marcaje"
                            : simpleClockIncident
                                ? "Incidencia de marcaje"
                        : replacement
                            ? (
                                replacement.replaced
                                    ? `Reemplazo de ${replacement.replaced} por ${replacement.absenceType || "ausencia"}`
                                    : `Motivo HHEE: ${replacement.reason || replacement.absenceType || "sin detalle"}`
                            )
                            : "";

            html += `
                <td
                    class="mini ${contractError ? "contract-error-day" : ""} ${severeClockIncident ? "clock-severe-day" : ""} ${simpleClockIncident ? "clock-incident-day" : ""} ${needsReplacement ? "needs-replacement" : ""} ${showExtraReason || showClockExtra ? "needs-extra-reason" : ""} ${replacement ? "replacement-day" : ""}"
                    style="background:${color}"
                    title="${title}"
                    ${contractError ? `data-contract-error-profile="${profile.name}" data-contract-error-key="${key}"` : ""}
                    ${needsReplacement ? `data-replacement-profile="${profile.name}" data-replacement-key="${key}"` : ""}
                    ${showExtraReason ? `data-extra-profile="${profile.name}" data-extra-key="${key}" data-extra-turn="${showExtraReason}"` : ""}
                    ${showClockExtra && !showExtraReason ? `data-clock-extra-profile="${profile.name}" data-clock-extra-key="${key}" data-clock-extra-turn="${aplicarCambiosTurno(profile.name, key, Number(data[key]) || 0)}"` : ""}
                >
                    ${marker ? `<span class="timeline-replacement-marker">${marker}</span>` : ""}
                </td>
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
    div.querySelectorAll("[data-profile-name]")
        .forEach(button => {
            button.onclick = () => {
                window.selectProfileByName?.(
                    button.dataset.profileName,
                    {
                        openTurns: true,
                        scrollToTop: true
                    }
                );
            };
        });
    div.querySelectorAll("[data-replacement-profile]")
        .forEach(cell => {
            cell.onclick = () => {
                window.openReplacementDialog?.(
                    cell.dataset.replacementProfile,
                    cell.dataset.replacementKey
                );
            };
        });
    div.querySelectorAll("[data-extra-profile]")
        .forEach(cell => {
            cell.onclick = () => {
                window.openExtraReasonDialog?.(
                    cell.dataset.extraProfile,
                    cell.dataset.extraKey,
                    Number(cell.dataset.extraTurn) || 0
                );
            };
        });
    div.querySelectorAll("[data-clock-extra-profile]")
        .forEach(cell => {
            cell.onclick = () => {
                window.openClockExtraReasonDialog?.(
                    cell.dataset.clockExtraProfile,
                    cell.dataset.clockExtraKey,
                    Number(cell.dataset.clockExtraTurn) || 0
                );
            };
        });
    div.querySelectorAll("[data-contract-error-profile]")
        .forEach(cell => {
            cell.onclick = () => {
                window.startReplacementContractEdit?.(
                    cell.dataset.contractErrorProfile,
                    cell.dataset.contractErrorKey
                );
            };
        });
    syncTimelineStickyOffsets(div);
    requestAnimationFrame(() => syncTimelineStickyOffsets(div));
}
