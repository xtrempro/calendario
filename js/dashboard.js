import { normalizeText } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import {
    getCompensationProfileAt,
    getProfileData,
    getProfiles,
    isProfileActive
} from "./storage.js";
import {
    getContractsForProfile,
    getHonorariaContractsForProfile,
    isHonorariaContractType,
    isReplacementContractType,
    isReplacementProfile
} from "./contracts.js";
import { getJSON } from "./persistence.js";
import { currentDate } from "./calendar.js";
import { fetchHolidays } from "./holidays.js";
import { calcularHorasMesPerfil } from "./hoursEngine.js";
import { analizarMes } from "./staffing.js";
import { getAbsenceType } from "./rulesEngine.js";
import { measurePerformance } from "./performanceMonitor.js";

const ROLE_DEFS = [
    {
        key: "profesional",
        label: "Profesional",
        color: "#1d6cff"
    },
    {
        key: "tecnico",
        label: "T\u00e9cnico",
        color: "#14b8a6"
    },
    {
        key: "auxiliar",
        label: "Auxiliar",
        color: "#f59e0b"
    },
    {
        key: "administrativo",
        label: "Administrativo",
        color: "#8b5cf6"
    }
];

const MONTH_SHORT = [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic"
];

const DASHBOARD_MONTH_COUNT = 15;

const dashboardState = {
    licenseYears: 2,
    // Grafico de HH.EE por trabajador: profesion filtrada y mes visible. Se
    // calcula SOLO la profesion elegida; recorrer toda la unidad con
    // calcularHorasMesPerfil es lo que hizo desactivar otros graficos por lentos.
    overtimeProfession: "",
    overtimeYear: currentDate.getFullYear(),
    overtimeMonth: currentDate.getMonth()
};

let renderRequest = 0;
const holidayCache = new Map();

function roleKey(value) {
    const normalized = normalizeText(value)
        .replace(/[^a-z0-9]+/g, "");

    if (normalized.includes("profesional")) return "profesional";
    if (normalized.includes("cnico") || normalized.includes("tecnico")) {
        return "tecnico";
    }
    if (normalized.includes("auxiliar")) return "auxiliar";
    if (normalized.includes("administrativo")) return "administrativo";

    return "";
}

function roleLabel(key) {
    return ROLE_DEFS.find(role => role.key === key)?.label || key;
}

function formatMoney(value) {
    return new Intl.NumberFormat("es-CL", {
        style: "currency",
        currency: "CLP",
        maximumFractionDigits: 0
    }).format(Math.round(Number(value) || 0));
}

function monthLabel(year, month) {
    return `${MONTH_SHORT[month]} ${String(year).slice(-2)}`;
}

function monthRange(count = DASHBOARD_MONTH_COUNT) {
    const monthCount = Math.max(
        1,
        Number(count) || DASHBOARD_MONTH_COUNT
    );
    const end = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
    );
    const start = new Date(
        end.getFullYear(),
        end.getMonth() - monthCount + 1,
        1
    );
    const months = [];

    for (let index = 0; index < monthCount; index++) {
        const date = new Date(
            start.getFullYear(),
            start.getMonth() + index,
            1
        );

        months.push({
            year: date.getFullYear(),
            month: date.getMonth(),
            label: monthLabel(date.getFullYear(), date.getMonth())
        });
    }

    return months;
}

function yearRange(count = 5) {
    const year = currentDate.getFullYear();

    return Array.from({ length: count }, (_, index) => year - index);
}

async function holidaysForYear(year) {
    if (!holidayCache.has(year)) {
        holidayCache.set(year, await fetchHolidays(year));
    }

    return holidayCache.get(year);
}

function profilesForRoles(roleKeys) {
    return getProfiles()
        .filter(profile => roleKeys.has(roleKey(profile.estamento)))
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function profileHheeCost(profile, year, month) {
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await holidaysForYear(year);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        getProfileData(profile.name),
        {},
        { d: 0, n: 0 }
    );

    return (
        Math.max(0, Number(stats.paymentDiurno) || 0) +
        Math.max(0, Number(stats.paymentNocturno) || 0)
    );
}

async function buildHheeExpenseRows() {
    const rows = monthRange().map(month => ({
        ...month,
        values: Object.fromEntries(
            ROLE_DEFS.map(role => [role.key, 0])
        )
    }));
    const profiles = profilesForRoles(
        new Set(ROLE_DEFS.map(role => role.key))
    );

    for (const row of rows) {
        for (const profile of profiles) {
            const key = roleKey(profile.estamento);
            row.values[key] += await profileHheeCost(
                profile,
                row.year,
                row.month
            );
        }
    }

    return rows;
}

function parseISODate(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (!match) return null;

    const date = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
    );

    return Number.isNaN(date.getTime()) ? null : date;
}

function contractTypeKey(profile) {
    const normalized = normalizeText(profile.contractType)
        .replace(/[^a-z0-9]+/g, "");

    if (
        isReplacementContractType(profile.contractType) ||
        isReplacementProfile(profile.name)
    ) {
        return "reemplazo";
    }

    if (isHonorariaContractType(profile.contractType)) {
        return "honorarios";
    }

    if (normalized.includes("contrata")) return "contrata";
    if (normalized.includes("planta")) return "planta";

    return "";
}

function dateRangeOverlapsYear(
    startValue,
    endValue,
    year,
    { includeUndated = false } = {}
) {
    const start = parseISODate(startValue);
    const end = parseISODate(endValue);

    if (!start && !end) {
        return includeUndated;
    }

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

    return (
        (!start || start.getTime() <= yearEnd.getTime()) &&
        (!end || end.getTime() >= yearStart.getTime())
    );
}

function profileOverlapsStaffingYear(profile, year, type) {
    const includeUndated = isProfileActive(profile);

    if (type === "reemplazo") {
        const contracts = getContractsForProfile(profile.name);

        if (contracts.length) {
            return contracts.some(contract =>
                dateRangeOverlapsYear(contract.start, contract.end, year)
            );
        }

        return dateRangeOverlapsYear(
            profile.contractStart,
            profile.contractEnd,
            year,
            { includeUndated }
        );
    }

    if (type === "honorarios") {
        const contracts = getHonorariaContractsForProfile(profile);

        if (contracts.length) {
            return contracts.some(contract =>
                dateRangeOverlapsYear(
                    contract.start,
                    contract.end,
                    year,
                    { includeUndated }
                )
            );
        }

        return dateRangeOverlapsYear(
            profile.honorariaStart ||
                profile.contractStart,
            profile.honorariaEnd || profile.contractEnd,
            year,
            { includeUndated }
        );
    }

    return dateRangeOverlapsYear(
        profile.contractStart,
        profile.contractEnd,
        year,
        { includeUndated }
    );
}

function buildStaffingHeadcountRows() {
    const years = yearRange(5).reverse();

    return years.map(year => {
        const values = Object.fromEntries(
            ROLE_DEFS.map(role => [role.key, 0])
        );
        const yearEnd = new Date(year, 11, 31);

        getProfiles().forEach(profile => {
            const type = contractTypeKey(profile);

            if (!type) return;

            const profileForYear =
                getCompensationProfileAt(profile.name, yearEnd) ||
                profile;
            const key = roleKey(profileForYear.estamento);

            if (
                !(key in values) ||
                !profileOverlapsStaffingYear(profile, year, type)
            ) {
                return;
            }

            values[key]++;
        });

        return {
            label: String(year),
            values
        };
    });
}

function countMissingStaffing(data) {
    return data.reduce((sum, day) => {
        return sum + (day.detalle || [])
            .filter(detail =>
                detail.tipo === "faltante" ||
                detail.tipo === "noche"
            )
            .reduce(
                (daySum, detail) =>
                    daySum + Math.max(0, Number(detail.cantidad) || 0),
                0
            );
    }, 0);
}

async function buildStaffingRows() {
    const months = monthRange();
    const values = [];

    for (const item of months) {
        const holidays = await holidaysForYear(item.year);

        values.push(
            countMissingStaffing(
                analizarMes(item.year, item.month, holidays)
            )
        );
    }

    return {
        labels: months.map(item => item.label),
        series: [
            {
                label: "Turnos sin cubrir",
                color: "#ef4444",
                values
            }
        ]
    };
}

function parseKeyDay(value) {
    const [year, month, day] = String(value || "")
        .split("-")
        .map(Number);

    if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day)
    ) {
        return null;
    }

    return new Date(year, month, day);
}

function dateInRange(date, start, end) {
    return date &&
        date.getTime() >= start.getTime() &&
        date.getTime() <= end.getTime();
}

export function buildLicenseRanking() {
    const end = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0
    );
    const start = new Date(
        end.getFullYear(),
        end.getMonth() - (dashboardState.licenseYears * 12) + 1,
        1
    );

    return getProfiles()
        // Los perfiles desactivados ya no son parte de la dotacion: seguir
        // rankeandolos empujaba fuera del top a gente que si esta trabajando.
        .filter(isProfileActive)
        .map(profile => {
            const days = Object.entries(
                getJSON(`absences_${profile.name}`, {})
            ).filter(([keyDay, absence]) => {
                const type = getAbsenceType(absence);

                return (
                    (
                        type === "license" ||
                        type === "professional_license"
                    ) &&
                    dateInRange(parseKeyDay(keyDay), start, end)
                );
            }).length;

            return {
                name: profile.name,
                role: roleLabel(roleKey(profile.estamento)),
                days
            };
        })
        .filter(item => item.days > 0)
        .sort((a, b) =>
            b.days - a.days ||
            a.name.localeCompare(b.name)
        )
        .slice(0, 15);
}

function chartEmpty(message) {
    return `
        <div class="dashboard-empty">
            ${escapeHTML(message)}
        </div>
    `;
}

function renderLicenseControls() {
    return `
        <aside class="dashboard-control-card">
            <strong>Periodo</strong>
            <div class="dashboard-radio-list">
                ${[1, 2, 3, 4, 5].map(years => `
                    <label>
                        <input type="radio" name="dashboardLicenseYears" value="${years}" ${dashboardState.licenseYears === years ? "checked" : ""}>
                        <span>${years === 1 ? "\u00daltimo a\u00f1o" : `\u00daltimos ${years} a\u00f1os`}</span>
                    </label>
                `).join("")}
            </div>
        </aside>
    `;
}

function renderLicenseRanking(rows) {
    const maxDays = Math.max(1, ...rows.map(row => row.days));

    if (!rows.length) {
        return chartEmpty("No hay licencias médicas registradas en el período.");
    }

    return `
        <div class="dashboard-ranking">
            ${rows.map((row, index) => {
                const width = (row.days / maxDays) * 100;

                return `
                    <article class="dashboard-ranking-row">
                        <div class="dashboard-ranking-person">
                            <b>${index + 1}</b>
                            <span>
                                <strong>${escapeHTML(row.name)}</strong>
                                <small>${escapeHTML(row.role)}</small>
                            </span>
                        </div>
                        <div class="dashboard-ranking-bar">
                            <span style="width:${width}%"></span>
                            <strong>${row.days} d\u00edas</strong>
                        </div>
                    </article>
                `;
            }).join("")}
        </div>
    `;
}

// ---- HH.EE por trabajador (filtrado por profesion, mes a mes) ----

function overtimeProfessions() {
    const seen = new Map();

    getProfiles()
        .filter(isProfileActive)
        .forEach(profile => {
            const label = String(profile.profession || "").trim();

            if (!label) return;

            const key = normalizeText(label);

            if (!seen.has(key)) seen.set(key, label);
        });

    return [...seen.values()].sort((a, b) => a.localeCompare(b, "es"));
}

function activeOvertimeProfession() {
    const professions = overtimeProfessions();

    if (!professions.length) return "";

    const current = dashboardState.overtimeProfession;

    return professions.includes(current) ? current : professions[0];
}

// Nombre corto para el eje X: los nombres completos no caben. El nombre
// completo viaja en el tooltip de la barra.
function shortWorkerName(fullName) {
    const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);

    if (parts.length <= 2) return parts.join(" ");

    return `${parts[0]} ${parts[parts.length - 2]}`;
}

export async function buildOvertimeByWorkerRows(profession, year, month) {
    const target = normalizeText(profession);
    const profiles = getProfiles().filter(profile =>
        isProfileActive(profile) &&
        normalizeText(profile.profession || "") === target
    );

    if (!profiles.length) return [];

    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await holidaysForYear(year);

    return profiles
        .map(profile => {
            const stats = calcularHorasMesPerfil(
                profile.name,
                year,
                month,
                days,
                holidays,
                getProfileData(profile.name),
                {},
                { d: 0, n: 0 }
            );
            const day = Number(stats.hheeDiurnas) || 0;
            const night = Number(stats.hheeNocturnas) || 0;

            return {
                name: profile.name,
                shortName: shortWorkerName(profile.name),
                day,
                night,
                total: day + night
            };
        })
        .sort((a, b) =>
            b.total - a.total ||
            a.name.localeCompare(b.name, "es")
        );
}

function formatOvertimeHours(value) {
    const rounded = Math.round((Number(value) || 0) * 10) / 10;

    return Number.isInteger(rounded)
        ? String(rounded)
        : rounded.toFixed(1).replace(".", ",");
}

function renderOvertimeControls(professions, profession) {
    const monthName = `${MONTH_SHORT[dashboardState.overtimeMonth]} ${dashboardState.overtimeYear}`;

    return `
        <aside class="dashboard-control-card">
            <strong>Profesión</strong>
            <select data-dashboard-overtime-profession>
                ${professions.map(item => `
                    <option value="${escapeHTML(item)}" ${item === profession ? "selected" : ""}>
                        ${escapeHTML(item)}
                    </option>
                `).join("")}
            </select>
            <strong>Mes</strong>
            <div class="dashboard-month-nav">
                <button type="button" data-dashboard-overtime-month="-1" aria-label="Mes anterior">&#8249;</button>
                <span>${escapeHTML(monthName)}</span>
                <button type="button" data-dashboard-overtime-month="1" aria-label="Mes siguiente">&#8250;</button>
            </div>
        </aside>
    `;
}

export function renderOvertimeByWorker(rows) {
    if (!rows.length) {
        return chartEmpty(
            "No hay trabajadores activos con esta profesión."
        );
    }

    const totals = rows.reduce((acc, row) => ({
        day: acc.day + row.day,
        night: acc.night + row.night
    }), { day: 0, night: 0 });

    if (!totals.day && !totals.night) {
        return chartEmpty("Sin horas extras registradas en este mes.");
    }

    // Escala del eje Y: se redondea hacia arriba para que la barra mas alta no
    // toque el techo y las guias caigan en numeros legibles.
    const maxTotal = Math.max(...rows.map(row => row.total), 1);
    const step = maxTotal <= 20 ? 5 : maxTotal <= 60 ? 10 : 20;
    const axisMax = Math.ceil(maxTotal / step) * step;
    const guides = [];

    for (let value = axisMax; value >= 0; value -= step) {
        guides.push(value);
    }

    return `
        <div class="dashboard-overtime">
            <div class="dashboard-overtime-legend">
                <span><i class="dashboard-overtime-swatch is-day"></i> HH.EE diurnas</span>
                <span><i class="dashboard-overtime-swatch is-night"></i> HH.EE nocturnas</span>
                <b>Total ${escapeHTML(formatOvertimeHours(totals.day + totals.night))} h</b>
            </div>
            <div class="dashboard-overtime-plot">
                <div class="dashboard-overtime-axis" aria-hidden="true">
                    ${guides.map(value => `<span>${value}</span>`).join("")}
                </div>
                <div class="dashboard-overtime-field">
                    <div class="dashboard-overtime-guides" aria-hidden="true">
                        ${guides.map((value, index) => `
                            <i style="top:${(index / (guides.length - 1)) * 100}%"></i>
                        `).join("")}
                    </div>
                    <div class="dashboard-overtime-bars">
                    ${rows.map(row => {
                        const height = (row.total / axisMax) * 100;
                        const dayShare = row.total
                            ? (row.day / row.total) * 100
                            : 0;
                        const nightShare = row.total
                            ? (row.night / row.total) * 100
                            : 0;
                        const title =
                            `${row.name}: ${formatOvertimeHours(row.total)} h totales ` +
                            `(${formatOvertimeHours(row.day)} diurnas / ${formatOvertimeHours(row.night)} nocturnas)`;

                        return `
                            <div class="dashboard-overtime-item" title="${escapeHTML(title)}">
                                <b class="dashboard-overtime-total">${escapeHTML(formatOvertimeHours(row.total))}</b>
                                <div class="dashboard-overtime-stack" style="height:${height}%">
                                    ${row.night ? `<span class="dashboard-overtime-night" style="height:${nightShare}%"></span>` : ""}
                                    ${row.day ? `<span class="dashboard-overtime-day" style="height:${dayShare}%"></span>` : ""}
                                </div>
                                <small>${escapeHTML(row.shortName)}</small>
                            </div>
                        `;
                    }).join("")}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function loadingHTML() {
    return `
        <div class="dashboard-loading">
            Calculando dashboard...
        </div>
    `;
}

function dashboardShell(content = loadingHTML()) {
    return `
        <div class="dashboard-shell">
            <div class="dashboard-head">
                <div>
                    <h2>Dashboard</h2>
                    <p>Horas extras por trabajador y ranking de licencias m\u00e9dicas.</p>
                </div>
            </div>
            ${content}
        </div>
    `;
}

function renderCard(title, subtitle, chart, controls = "") {
    const layoutClass = controls
        ? "dashboard-card-layout"
        : "dashboard-card-layout dashboard-card-layout--wide";

    return `
        <section class="dashboard-card">
            <div class="dashboard-card-head">
                <div>
                    <h3>${title}</h3>
                    ${subtitle ? `<p>${subtitle}</p>` : ""}
                </div>
            </div>
            <div class="${layoutClass}">
                <div class="dashboard-chart-area">
                    ${chart}
                </div>
                ${controls}
            </div>
        </section>
    `;
}

function bindDashboardControls(root) {
    root
        .querySelectorAll("input[name='dashboardLicenseYears']")
        .forEach(input => {
            input.addEventListener("change", event => {
                dashboardState.licenseYears =
                    Number(event.target.value) || 2;
                renderDashboardPanel();
            });
        });

    root
        .querySelector("[data-dashboard-overtime-profession]")
        ?.addEventListener("change", event => {
            dashboardState.overtimeProfession = event.target.value;
            renderDashboardPanel();
        });

    root
        .querySelectorAll("[data-dashboard-overtime-month]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const step = Number(button.dataset.dashboardOvertimeMonth) || 0;
                const next = new Date(
                    dashboardState.overtimeYear,
                    dashboardState.overtimeMonth + step,
                    1
                );

                dashboardState.overtimeYear = next.getFullYear();
                dashboardState.overtimeMonth = next.getMonth();
                renderDashboardPanel();
            });
        });
}

// NOTA: los graficos "Gasto en pago de horas extras", "Dotacion por estamento"
// y "Turnos sin cubrir" se desactivaron temporalmente porque su calculo
// (buildHheeExpenseRows / buildStaffingHeadcountRows / buildStaffingRows) es
// pesado y ralentizaba la carga del dashboard. Las funciones constructoras y de
// render se conservan intactas para volver a habilitarlos mas adelante con una
// estrategia que no penalice la carga (p. ej. carga diferida o cacheo).
export async function renderDashboardPanel() {
    const root = document.getElementById("dashboardPanel");
    if (!root) return;

    return measurePerformance(
        "dashboard:render-panel",
        async () => {
            const requestId = ++renderRequest;

            root.innerHTML = dashboardShell();

            const licenseRows = measurePerformance(
                "dashboard:build-license-ranking",
                () => buildLicenseRanking(),
                {
                    profileCount: getProfiles().length,
                    years: dashboardState.licenseYears
                }
            );

            if (requestId !== renderRequest) return;

            const professions = overtimeProfessions();
            const profession = activeOvertimeProfession();
            const overtimeRows = profession
                ? await measurePerformance(
                    "dashboard:build-overtime-by-worker",
                    () => buildOvertimeByWorkerRows(
                        profession,
                        dashboardState.overtimeYear,
                        dashboardState.overtimeMonth
                    ),
                    { profession }
                )
                : [];

            if (requestId !== renderRequest) return;

            root.innerHTML = dashboardShell(`
                ${professions.length
                    ? renderCard(
                        "Horas extras por trabajador",
                        `${escapeHTML(profession)} \u00b7 ${MONTH_SHORT[dashboardState.overtimeMonth]} ${dashboardState.overtimeYear}.`,
                        renderOvertimeByWorker(overtimeRows),
                        renderOvertimeControls(professions, profession)
                    )
                    : ""}
                ${renderCard(
                    "Licencias M\u00e9dicas",
                    // Sin subtitulo: el filtro de a\u00f1os que va al lado ya dice el
                    // periodo, y el "Top 15" es un detalle de implementacion.
                    "",
                    renderLicenseRanking(licenseRows),
                    renderLicenseControls()
                )}
            `);

            bindDashboardControls(root);
        },
        {
            years: dashboardState.licenseYears,
            profileCount: getProfiles().length
        }
    );
}
