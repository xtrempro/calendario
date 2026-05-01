import {
    getCurrentProfile,
    getProfiles,
    getRotativa,
    isProfileActive
} from "./storage.js";
import { aplicarCambiosTurno } from "./turnEngine.js";
import { ESTAMENTO, TURNO } from "./constants.js";
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

function defaultConfig() {
    return {};
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
    return normalizeStaffingConfig(getJSON(KEY, {}));
}

export function saveStaffingConfig(cfg) {
    setJSON(KEY, normalizeStaffingConfig(cfg));
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

const STAFFING_ESTAMENTOS = [
    "Profesional",
    "Técnico",
    "Administrativo",
    "Auxiliar"
];
const PROFESSION_BASED_ESTAMENTOS = new Set([
    "Profesional",
    "Técnico"
]);
const STAFFING_MODALITIES = [
    {
        key: "diurno",
        label: "Turno Diurno",
        dayLabel: "Diurno",
        checksNight: false
    },
    {
        key: "4turno",
        label: "4° Turno",
        dayLabel: "Larga",
        nightLabel: "Noche",
        checksNight: true
    },
    {
        key: "3turno",
        label: "3er Turno",
        dayLabel: "Larga",
        nightLabel: "Noche",
        checksNight: true
    }
];

function emptyStaffingConfig() {
    return STAFFING_MODALITIES.reduce((config, modality) => {
        config[modality.key] = {};
        STAFFING_ESTAMENTOS.forEach(estamento => {
            config[modality.key][estamento] = {};
        });
        return config;
    }, {});
}

function normalizeStaffingEstamento(value) {
    const clean = String(value || "").trim();
    const comparable = clean
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    if (comparable === "tecnico") return "Técnico";

    return STAFFING_ESTAMENTOS.find(estamento =>
        estamento
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase() === comparable
    ) || clean;
}

function isProfessionBasedStaffing(estamento) {
    return PROFESSION_BASED_ESTAMENTOS.has(
        normalizeStaffingEstamento(estamento)
    );
}

function normalizeStaffingProfession(value) {
    const clean = String(value || "").trim();

    return clean || "Sin información";
}

function normalizeStaffingRotativa(type) {
    const value = String(type || "")
        .trim()
        .toLowerCase();

    if (value === "4° turno" || value === "4 turno") return "4turno";
    if (value === "3er turno" || value === "3 turno") return "3turno";
    if (value === "diurno") return "diurno";

    return value;
}

function sanitizeStaffingAmount(value) {
    const number = Number(value);

    return Number.isFinite(number) && number > 0
        ? Math.round(number)
        : 0;
}

function normalizeStaffingConfig(config = {}) {
    const normalized = emptyStaffingConfig();

    STAFFING_MODALITIES.forEach(modality => {
        const modalityValues = config?.[modality.key] || {};

        STAFFING_ESTAMENTOS.forEach(estamento => {
            const values = modalityValues[estamento] || {};

            Object.entries(values).forEach(([group, value]) => {
                const groupKey = isProfessionBasedStaffing(estamento)
                    ? normalizeStaffingProfession(group)
                    : "total";
                const amount = sanitizeStaffingAmount(value);

                if (amount > 0) {
                    normalized[modality.key][estamento][groupKey] =
                        amount;
                }
            });
        });
    });

    return normalized;
}

function getStaffingProfileModality(profile) {
    return normalizeStaffingRotativa(
        getRotativa(profile.name)?.type ||
        profile.rotativaActual ||
        profile.rotation
    );
}

function getStaffingProfileGroupKey(profile) {
    const estamento = normalizeStaffingEstamento(profile.estamento);

    return isProfessionBasedStaffing(estamento)
        ? normalizeStaffingProfession(profile.profession)
        : "total";
}

function getStaffingGroupLabel(estamento, groupKey) {
    return isProfessionBasedStaffing(estamento)
        ? normalizeStaffingProfession(groupKey)
        : estamento;
}

export function getStaffingModalities() {
    return STAFFING_MODALITIES.map(modality => ({ ...modality }));
}

export function buildStaffingRequirementRows(
    config = getStaffingConfig()
) {
    const normalized = normalizeStaffingConfig(config);
    const profiles = getProfiles()
        .filter(isProfileActive)
        .filter(profile =>
            STAFFING_ESTAMENTOS.includes(
                normalizeStaffingEstamento(profile.estamento)
            )
        );
    const rows = [];

    STAFFING_MODALITIES.forEach(modality => {
        STAFFING_ESTAMENTOS.forEach(estamento => {
            const profilesForGroup = profiles.filter(profile =>
                normalizeStaffingEstamento(profile.estamento) === estamento &&
                getStaffingProfileModality(profile) === modality.key
            );

            if (!profilesForGroup.length) return;

            const groups = isProfessionBasedStaffing(estamento)
                ? [...new Set(
                    profilesForGroup.map(getStaffingProfileGroupKey)
                )].sort((a, b) => a.localeCompare(b, "es"))
                : ["total"];

            groups.forEach(groupKey => {
                rows.push({
                    modality: modality.key,
                    modalityLabel: modality.label,
                    sectionLabel: `${estamento} en ${modality.label}`,
                    estamento,
                    groupKey,
                    groupLabel:
                        getStaffingGroupLabel(estamento, groupKey),
                    required:
                        normalized[modality.key]?.[estamento]?.[groupKey] ||
                        0
                });
            });
        });
    });

    return rows;
}

export function staffingConfigSummary(config = getStaffingConfig()) {
    const rows = buildStaffingRequirementRows(config)
        .filter(row => row.required > 0);

    if (!rows.length) return "Sin dotacion requerida configurada.";

    return rows
        .map(row =>
            `${row.sectionLabel} / ${row.groupLabel}: ${row.required}`
        )
        .join("; ");
}

function worksStaffingDiurno(turno) {
    return turno === TURNO.DIURNO ||
        turno === TURNO.DIURNO_NOCHE;
}

function worksStaffingLong(turno) {
    return turno === TURNO.LARGA ||
        turno === TURNO.TURNO24;
}

function worksStaffingNight(turno) {
    return turno === TURNO.NOCHE ||
        turno === TURNO.TURNO24 ||
        turno === TURNO.DIURNO_NOCHE;
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

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function firstName(name) {
    return String(name || "")
        .trim()
        .split(/\s+/)[0] || "colaborador";
}

function birthDateParts(value) {
    const source = String(value || "").trim();
    let match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (match) {
        return {
            month: Number(match[2]) - 1,
            day: Number(match[3])
        };
    }

    match = source.match(/^(\d{2})-(\d{2})-(\d{4})$/);

    if (match) {
        return {
            month: Number(match[2]) - 1,
            day: Number(match[1])
        };
    }

    return null;
}

function birthdayDetailsForDay(month, day) {
    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => {
            const parts = birthDateParts(profile.birthDate);

            return parts &&
                parts.month === month &&
                parts.day === day;
        })
        .map(profile => ({
            tipo: "birthday",
            name: firstName(profile.name)
        }));
}

function withBirthdayDetails(data, month) {
    return data.map(item => ({
        ...item,
        detalle: [
            ...item.detalle,
            ...birthdayDetailsForDay(month, item.dia)
        ]
    }));
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

function staffingGroupMatches(profile, row) {
    const estamento = normalizeStaffingEstamento(profile.estamento);

    if (estamento !== row.estamento) return false;

    return isProfessionBasedStaffing(estamento)
        ? getStaffingProfileGroupKey(profile) === row.groupKey
        : true;
}

function getStaffingTurno(profile, y, m, d) {
    const dayKey = key(y, m, d);
    const data = getDataPerfil(profile.name);
    const turno = data[dayKey] || 0;

    return aplicarCambiosTurno(
        profile.name,
        dayKey,
        turno
    );
}

function worksForStaffing(row, turno, shiftKind) {
    if (row.modality === "diurno") {
        return worksStaffingDiurno(turno);
    }

    if (shiftKind === "night") {
        return worksStaffingNight(turno);
    }

    return worksStaffingLong(turno);
}

function contarRequerimiento(profiles, row, y, m, d, shiftKind){
    return profiles
        .filter(profile => staffingGroupMatches(profile, row))
        .filter(profile =>
            worksForStaffing(
                row,
                getStaffingTurno(profile, y, m, d),
                shiftKind
            )
        )
        .length;
}

function sugerirReemplazo(profiles, row, y, m, d){
    const libres = profiles
        .filter(profile => staffingGroupMatches(profile, row))
        .filter(profile => {
            return getStaffingTurno(profile, y, m, d) === 0;
        });

    if (!libres.length) return null;

    libres.sort((a, b) => a.name.localeCompare(b.name));

    return libres[0].name;
}

export function analizarMes(year, month){
    const profiles = getProfiles().filter(isProfileActive);
    const requirements = buildStaffingRequirementRows()
        .filter(row => row.required > 0);
    const diasMes =
        new Date(year, month + 1, 0).getDate();

    const salida = [];

    for (let d = 1; d <= diasMes; d++) {
        const detalle = [];

        requirements.forEach(row => {
            const checks = row.modality === "diurno"
                ? [{
                    kind: "diurno",
                    label: "Diurno",
                    badgeType: "faltante"
                }]
                : [
                    {
                        kind: "day",
                        label: "Larga",
                        badgeType: "faltante"
                    },
                    {
                        kind: "night",
                        label: "Noche",
                        badgeType: "noche"
                    }
                ];

            checks.forEach(check => {
                const real = contarRequerimiento(
                    profiles,
                    row,
                    year,
                    month,
                    d,
                    check.kind
                );

                if (real < row.required) {
                    detalle.push({
                        tipo: check.badgeType,
                        estamento: row.estamento,
                        groupLabel: row.groupLabel,
                        shiftLabel: check.label,
                        cantidad: row.required - real,
                        sugerencia: sugerirReemplazo(
                            profiles,
                            row,
                            year,
                            month,
                            d
                        )
                    });
                }

                if (real > row.required) {
                    detalle.push({
                        tipo: "exceso",
                        estamento: row.estamento,
                        groupLabel: row.groupLabel,
                        shiftLabel: check.label,
                        cantidad: real - row.required
                    });
                }
            });
        });

        salida.push({
            dia: d,
            detalle
        });
    }

    return salida;
}

export function renderStaffingPanel(){
    renderStaffingAnalysis();
}

function renderDetailBadge(detail){
    if (detail.tipo === "birthday") {
        return `
            <span class="staffing-pill staffing-pill--birthday">
                Cumplea&ntilde;os de ${escapeHTML(detail.name)}
            </span>
        `;
    }

    if (detail.tipo === "faltante") {
        return `
            <span class="staffing-pill staffing-pill--bad">
                Falta ${detail.cantidad} ${escapeHTML(detail.groupLabel || detail.estamento)}
                en turno ${escapeHTML(detail.shiftLabel || "Diurno")}
                ${detail.sugerencia ? ` - Sugerido: ${escapeHTML(detail.sugerencia)}` : ""}
            </span>
        `;
    }

    if (detail.tipo === "exceso") {
        return `
            <span class="staffing-pill staffing-pill--warn">
                Exceso ${detail.cantidad} ${escapeHTML(detail.groupLabel || detail.estamento)}
                en turno ${escapeHTML(detail.shiftLabel || "Diurno")}
            </span>
        `;
    }

    return `
        <span class="staffing-pill staffing-pill--night">
            Falta ${detail.cantidad} ${escapeHTML(detail.groupLabel || detail.estamento)}
            en turno ${escapeHTML(detail.shiftLabel || "Noche")}
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

function renderInlineStaffingReport(data, month = currentDate.getMonth()){
    const div = document.getElementById("staffingReportInline");
    if (!div) return;

    const reportData = withBirthdayDetails(data, month);
    const issues = reportData.filter(item => item.detalle.length);

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
    renderInlineStaffingReport(data, month);
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
