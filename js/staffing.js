import {
    getCurrentProfile,
    getProfiles,
    isProfileActive
} from "./storage.js";
import { aplicarCambiosTurno } from "./turnEngine.js";
import { ESTAMENTO } from "./constants.js";
import { isWeekend } from "./calculations.js";
import { currentDate } from "./calendar.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    formatContractDate,
    getAllReplacementContracts
} from "./contracts.js";
import { getAbsenceType } from "./rulesEngine.js";
import {
    addAuditLog,
    AUDIT_CATEGORY
} from "./auditLog.js";

const KEY = "staffing_config";
let staffingEditMode = false;

function defaultConfig() {
    const tecnico = ESTAMENTO[1];

    return {
        Profesional: { habil: 2, inhabil: 1, noche: 1 },
        [tecnico]: { habil: 3, inhabil: 2, noche: 1 },
        Administrativo: { habil: 2, inhabil: 0, noche: 0 },
        Auxiliar: { habil: 2, inhabil: 1, noche: 1 }
    };
}

function normalizeConfig(config = {}) {
    const base = defaultConfig();
    const tecnico = ESTAMENTO[1];
    const legacyTecnico =
        config["TÃ©cnico"] ||
        config.Tecnico ||
        {};

    return {
        ...base,
        ...config,
        [tecnico]: {
            ...base[tecnico],
            ...(config[tecnico] || legacyTecnico)
        }
    };
}

function configSummary(config) {
    return Object.entries(normalizeConfig(config))
        .map(([estamento, values]) =>
            `${estamento}: H${values.habil}/I${values.inhabil}/N${values.noche}`
        )
        .join("; ");
}

export function getStaffingConfig() {
    return normalizeConfig(getJSON(KEY, {}));
}

export function saveStaffingConfig(cfg) {
    setJSON(KEY, normalizeConfig(cfg));
}

function renderStaffingConfigSummary(cfg) {
    const summary = document.getElementById("staffingConfigSummary");
    if (!summary) return;

    summary.innerHTML = ESTAMENTO.map(est => `
        <article class="staffing-config-card">
            <strong>${est}</strong>
            <span>Habil: ${cfg[est].habil}</span>
            <span>Inhabil: ${cfg[est].inhabil}</span>
            <span>Noche: ${cfg[est].noche}</span>
        </article>
    `).join("");
}

function trabajaDia(turno) {
    return [1, 3, 4, 5].includes(turno);
}

function trabajaNoche(turno) {
    return [2, 3, 5].includes(turno);
}

function key(y, m, d){
    return `${y}-${m}-${d}`;
}

function parseKey(keyDay) {
    const parts = String(keyDay || "").split("-");

    return {
        year: Number(parts[0]),
        month: Number(parts[1]),
        day: Number(parts[2])
    };
}

function formatMonth(year, month) {
    return new Date(year, month, 1)
        .toLocaleString("es-CL", {
            month: "short",
            year: "2-digit"
        })
        .replace(".", "");
}

function isMedicalType(type) {
    return (
        type === "license" ||
        type === "professional_license"
    );
}

function getAbsencesPerfil(nombre) {
    return getJSON("absences_" + nombre, {});
}

function medicalSeriesTemplate() {
    const end = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
    );
    const start = new Date(
        end.getFullYear(),
        end.getMonth() - 23,
        1
    );
    const months = [];

    for (let i = 0; i < 24; i++) {
        const date = new Date(
            start.getFullYear(),
            start.getMonth() + i,
            1
        );

        months.push({
            year: date.getFullYear(),
            month: date.getMonth(),
            label: formatMonth(
                date.getFullYear(),
                date.getMonth()
            ),
            license: 0,
            professional: 0
        });
    }

    return months;
}

function countMedicalAbsences(nombre) {
    const months = medicalSeriesTemplate();
    const index = new Map(
        months.map((item, position) => [
            `${item.year}-${item.month}`,
            position
        ])
    );

    Object.entries(getAbsencesPerfil(nombre))
        .forEach(([keyDay, absence]) => {
            const type = getAbsenceType(absence);

            if (!isMedicalType(type)) return;

            const parsed = parseKey(keyDay);
            const position =
                index.get(`${parsed.year}-${parsed.month}`);

            if (position === undefined) return;

            if (type === "professional_license") {
                months[position].professional++;
            } else {
                months[position].license++;
            }
        });

    return months;
}

function mode(values) {
    if (!values.length) return 0;

    const counts = new Map();

    values.forEach(value => {
        counts.set(value, (counts.get(value) || 0) + 1);
    });

    return [...counts.entries()]
        .sort((a, b) =>
            b[1] - a[1] ||
            b[0] - a[0]
        )[0][0];
}

function formatDecimal(value) {
    const rounded =
        Math.round((Number(value) || 0) * 10) / 10;

    if (Number.isInteger(rounded)) return String(rounded);

    return String(rounded).replace(".", ",");
}

function renderStaffingMedicalChart() {
    const target = document.getElementById("staffingMedicalChart");
    if (!target) return;

    const selectedName = getCurrentProfile();
    const selectedProfile = getProfiles().find(profile =>
        profile.name === selectedName
    );

    if (!selectedProfile) {
        target.innerHTML = `
            <section class="medical-chart-card">
                <div class="empty-state empty-state--compact">
                    Selecciona un trabajador para comparar licencias.
                </div>
            </section>
        `;
        return;
    }

    const peers = getProfiles()
        .filter(isProfileActive)
        .filter(profile =>
            profile.name !== selectedProfile.name &&
            profile.estamento === selectedProfile.estamento
        );
    const selectedSeries =
        countMedicalAbsences(selectedProfile.name);
    const peerSeries =
        peers.map(profile => countMedicalAbsences(profile.name));

    const chartRows = selectedSeries.map((item, index) => {
        const peerTotals = peerSeries.map(series =>
            (series[index]?.license || 0) +
            (series[index]?.professional || 0)
        );
        const average = peerTotals.length
            ? peerTotals.reduce((sum, value) => sum + value, 0) /
                peerTotals.length
            : 0;

        return {
            ...item,
            total: item.license + item.professional,
            peerAverage: average,
            peerMode: mode(peerTotals)
        };
    });
    const maxValue = Math.max(
        1,
        ...chartRows.map(row =>
            Math.max(row.total, row.peerAverage, row.peerMode)
        )
    );
    const selectedTotals = chartRows.reduce(
        (total, row) => ({
            license: total.license + row.license,
            professional:
                total.professional + row.professional
        }),
        { license: 0, professional: 0 }
    );
    const peerPeriodTotals = peers.map((_profile, peerIndex) =>
        peerSeries[peerIndex].reduce(
            (sum, row) =>
                sum + row.license + row.professional,
            0
        )
    );
    const peerPeriodAverage = peerPeriodTotals.length
        ? peerPeriodTotals.reduce((sum, value) => sum + value, 0) /
            peerPeriodTotals.length
        : 0;
    const peerPeriodMode = mode(peerPeriodTotals);
    const latestLabel =
        chartRows[chartRows.length - 1]?.label || "";
    const firstLabel = chartRows[0]?.label || "";

    target.innerHTML = `
        <section class="medical-chart-card">
            <div class="medical-chart-head">
                <div>
                    <h4>Licencias ultimos 2 anos</h4>
                    <p>
                        ${selectedProfile.name} vs ${peers.length} trabajador(es)
                        ${selectedProfile.estamento} | ${firstLabel} - ${latestLabel}
                    </p>
                </div>

                <div class="medical-chart-summary">
                    <span>LM: <strong>${selectedTotals.license}</strong></span>
                    <span>LMP: <strong>${selectedTotals.professional}</strong></span>
                    <span>Prom. pares: <strong>${formatDecimal(peerPeriodAverage)}</strong></span>
                    <span>Moda pares: <strong>${formatDecimal(peerPeriodMode)}</strong></span>
                </div>
            </div>

            <div class="medical-chart-legend">
                <span><i class="medical-color-license"></i> LM perfil</span>
                <span><i class="medical-color-professional"></i> LMP perfil</span>
                <span><i class="medical-line-average"></i> Promedio pares</span>
                <span><i class="medical-line-mode"></i> Moda pares</span>
            </div>

            <div class="medical-chart-bars">
                ${chartRows.map(row => {
                    const licenseHeight = row.license
                        ? (row.license / maxValue) * 100
                        : 0;
                    const professionalHeight = row.professional
                        ? (row.professional / maxValue) * 100
                        : 0;
                    const averageBottom =
                        (row.peerAverage / maxValue) * 100;
                    const modeBottom =
                        (row.peerMode / maxValue) * 100;

                    return `
                        <div class="medical-chart-month" title="${row.label}: LM ${row.license}, LMP ${row.professional}, promedio pares ${formatDecimal(row.peerAverage)}, moda pares ${formatDecimal(row.peerMode)}">
                            <div class="medical-chart-bar">
                                <span class="medical-ref medical-ref--average" style="bottom:${averageBottom}%"></span>
                                <span class="medical-ref medical-ref--mode" style="bottom:${modeBottom}%"></span>
                                <span class="medical-stack medical-stack--professional" style="height:${professionalHeight}%"></span>
                                <span class="medical-stack medical-stack--license" style="height:${licenseHeight}%"></span>
                            </div>
                            <small>${row.label}</small>
                        </div>
                    `;
                }).join("")}
            </div>
        </section>
    `;
}

function getDataPerfil(nombre){
    return getJSON("data_" + nombre, {});
}

function contarGrupo(profiles, estamento, y, m, d){
    let dia = 0;
    let noche = 0;

    profiles
        .filter(profile => profile.estamento === estamento)
        .forEach(profile => {
            const data = getDataPerfil(profile.name);

            let turno = data[key(y, m, d)] || 0;

            turno = aplicarCambiosTurno(
                profile.name,
                key(y, m, d),
                turno
            );

            if (trabajaDia(turno)) dia++;
            if (trabajaNoche(turno)) noche++;
        });

    return { dia, noche };
}

function sugerirReemplazo(profiles, estamento, y, m, d){
    const libres = profiles
        .filter(profile => profile.estamento === estamento)
        .filter(profile => {
            const data = getDataPerfil(profile.name);

            let turno = data[key(y, m, d)] || 0;

            turno = aplicarCambiosTurno(
                profile.name,
                key(y, m, d),
                turno
            );

            return turno === 0;
        });

    if (!libres.length) return null;

    libres.sort((a, b) => a.name.localeCompare(b.name));

    return libres[0].name;
}

export function analizarMes(year, month){
    const cfg = getStaffingConfig();
    const profiles = getProfiles().filter(isProfileActive);
    const diasMes =
        new Date(year, month + 1, 0).getDate();

    const salida = [];

    for (let d = 1; d <= diasMes; d++) {
        const fecha = new Date(year, month, d);
        const habil = !isWeekend(fecha);
        const detalle = [];

        ESTAMENTO.forEach(est => {
            const req = habil
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

            if (real.dia < req) {
                const faltan = req - real.dia;
                const sug =
                    sugerirReemplazo(
                        profiles,
                        est,
                        year,
                        month,
                        d
                    );

                detalle.push({
                    tipo: "faltante",
                    estamento: est,
                    cantidad: faltan,
                    sugerencia: sug
                });
            }

            if (real.dia > req) {
                detalle.push({
                    tipo: "exceso",
                    estamento: est,
                    cantidad: real.dia - req
                });
            }

            if (real.noche < reqN) {
                detalle.push({
                    tipo: "noche",
                    estamento: est,
                    cantidad: reqN - real.noche
                });
            }
        });

        salida.push({
            dia: d,
            detalle
        });
    }

    return salida;
}

export function renderStaffingPanel(){
    const btn = document.getElementById("saveStaffingBtn");
    const grid = document.querySelector(".staff-grid");
    if (!btn) return;

    const cfg = getStaffingConfig();
    renderStaffingConfigSummary(cfg);

    ESTAMENTO.forEach(est => {
        document.getElementById(`cfg_${est}_habil`).value =
            cfg[est].habil;

        document.getElementById(`cfg_${est}_inhabil`).value =
            cfg[est].inhabil;

        document.getElementById(`cfg_${est}_noche`).value =
            cfg[est].noche;
    });

    if (grid) {
        grid.classList.toggle("is-collapsed", !staffingEditMode);
    }

    btn.textContent = staffingEditMode
        ? "Guardar Dotaci\u00f3n"
        : "Modificar Dotaci\u00f3n";

    btn.onclick = () => {
        if (!staffingEditMode) {
            staffingEditMode = true;
            renderStaffingPanel();
            return;
        }

        const nuevo = {};

        ESTAMENTO.forEach(est => {
            nuevo[est] = {
                habil: Number(document.getElementById(`cfg_${est}_habil`).value) || 0,
                inhabil: Number(document.getElementById(`cfg_${est}_inhabil`).value) || 0,
                noche: Number(document.getElementById(`cfg_${est}_noche`).value) || 0
            };
        });

        saveStaffingConfig(nuevo);
        addAuditLog(
            AUDIT_CATEGORY.STAFFING,
            "Modifico dotacion requerida",
            `Antes: ${configSummary(cfg)}. Ahora: ${configSummary(nuevo)}.`
        );
        staffingEditMode = false;
        renderStaffingPanel();
        renderStaffingAnalysis();
    };

    renderReplacementContractsLog();
    renderStaffingMedicalChart();
}

function renderDetailBadge(detail){
    if (detail.tipo === "faltante") {
        return `
            <span class="staffing-pill staffing-pill--bad">
                Falta ${detail.cantidad} ${detail.estamento}
                ${detail.sugerencia ? ` - Sugerido: ${detail.sugerencia}` : ""}
            </span>
        `;
    }

    if (detail.tipo === "exceso") {
        return `
            <span class="staffing-pill staffing-pill--warn">
                Exceso ${detail.cantidad} ${detail.estamento}
            </span>
        `;
    }

    return `
        <span class="staffing-pill staffing-pill--night">
            Falta noche ${detail.cantidad} ${detail.estamento}
        </span>
    `;
}

function mostrarResultado(data){
    const div = document.getElementById("staffingResult");
    if (!div) return;

    const issues = data.filter(item => item.detalle.length);

    if (!issues.length) {
        div.innerHTML = `
            <div class="staffing-summary staffing-summary--ok">
                Cobertura completa para el mes visible.
            </div>
        `;
        return;
    }

    div.innerHTML = issues
        .map(item => `
            <article class="staffing-entry">
                <div class="staffing-entry__day">Día ${item.dia}</div>
                <div class="staffing-entry__list">
                    ${item.detalle.map(renderDetailBadge).join("")}
                </div>
            </article>
        `)
        .join("");
}

function renderInlineStaffingReport(data){
    const div = document.getElementById("staffingReportInline");
    if (!div) return;

    const issues = data.filter(item => item.detalle.length);

    if (!issues.length) {
        div.innerHTML = `
            <div class="staffing-report-empty">
                Cobertura completa para el mes visible.
            </div>
        `;
        return;
    }

    div.innerHTML = issues
        .map(item => `
            <article class="staffing-report-day">
                <strong>D&iacute;a ${item.dia}</strong>
                <div class="staffing-report-pills">
                    ${item.detalle.map(renderDetailBadge).join("")}
                </div>
            </article>
        `)
        .join("");
}

export function renderReplacementContractsLog(){
    const div = document.getElementById("replacementContractsLog");
    if (!div) return;

    const contracts = getAllReplacementContracts();

    if (!contracts.length) {
        div.innerHTML = `
            <div class="staffing-contract-log staffing-contract-log--empty">
                Sin contratos de reemplazo registrados.
            </div>
        `;
        return;
    }

    div.innerHTML = `
        <section class="staffing-contract-log">
            <h4>Contratos personal Reemplazo</h4>
            ${contracts.map(contract => `
                <article class="staffing-contract-item">
                    <strong>${contract.worker}</strong>
                    <span>${contract.estamento}</span>
                    <small>
                        ${formatContractDate(contract.start)} - ${formatContractDate(contract.end)}
                        | Reemplaza a: ${contract.replaces}
                    </small>
                </article>
            `).join("")}
        </section>
    `;
}

export function analizarStaffingMes(
    year = currentDate.getFullYear(),
    month = currentDate.getMonth()
){
    const data = analizarMes(year, month);
    mostrarResultado(data);
    renderInlineStaffingReport(data);
    return data;
}

export function renderStaffingAnalysis(){
    renderReplacementContractsLog();
    renderStaffingMedicalChart();

    return analizarStaffingMes(
        currentDate.getFullYear(),
        currentDate.getMonth()
    );
}

window.renderStaffingAnalysis = renderStaffingAnalysis;
