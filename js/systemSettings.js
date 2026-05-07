import {
    DEFAULT_GRADE_HOUR_CONFIG,
    getGradeHourConfig,
    saveGradeHourConfig,
    getReplacementRequestConfig,
    saveReplacementRequestConfig,
    getTurnChangeConfig,
    saveTurnChangeConfig
} from "./storage.js";
import {
    getManualHolidays,
    saveManualHolidays
} from "./holidays.js";
import {
    addAuditLog,
    AUDIT_CATEGORY
} from "./auditLog.js";
import {
    buildStaffingRequirementRows,
    getStaffingConfig,
    saveStaffingConfig,
    staffingConfigSummary
} from "./staffing.js";

const GROUPS = [
    {
        key: "professional",
        title: "Profesionales",
        description: "Valores por defecto para estamento Profesional.",
        grades: Object.keys(DEFAULT_GRADE_HOUR_CONFIG.professional)
    },
    {
        key: "general",
        title: "Tecnicos, Administrativos y Auxiliares",
        description: "Valores por defecto para Tecnicos, Administrativos y Auxiliares.",
        grades: Object.keys(DEFAULT_GRADE_HOUR_CONFIG.general)
    }
];

let activeTab = "grades";
let manualHolidayDraft = [];
let gradeConfigDraft = null;
let replacementRequestConfigDraft = null;
let turnChangeConfigDraft = null;
let staffingConfigDraft = null;
let onSettingsSaved = null;

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatRate(value) {
    return Number(value || 0).toFixed(2);
}

function parseRate(value) {
    const raw = String(value || "").trim();
    const normalized = raw.includes(",")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw;
    const number = Number(normalized);

    return Number.isFinite(number) && number > 0
        ? number
        : 0;
}

function formatDate(isoDate) {
    const [year, month, day] = String(isoDate || "").split("-");
    if (!year || !month || !day) return isoDate || "";

    return `${day}-${month}-${year}`;
}

function renderRateRows(group, config) {
    return group.grades
        .map(grade => `
            <tr>
                <td>Grado ${escapeHTML(grade)}</td>
                <td>
                    <label class="settings-money-field">
                        <span>$</span>
                        <input
                            type="text"
                            inputmode="decimal"
                            data-rate-group="${group.key}"
                            data-rate-grade="${escapeHTML(grade)}"
                            value="${formatRate(config[group.key]?.[grade])}"
                        >
                    </label>
                </td>
            </tr>
        `)
        .join("");
}

function renderGradesPanel(config) {
    return `
        <div class="settings-grade-grid">
            ${GROUPS.map(group => `
                <section class="settings-card">
                    <div class="settings-card__head">
                        <h4>${group.title}</h4>
                        <span>${group.description}</span>
                    </div>
                    <div class="settings-table-wrap">
                        <table class="settings-table">
                            <thead>
                                <tr>
                                    <th>Grado</th>
                                    <th>Valor hora</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${renderRateRows(group, config)}
                            </tbody>
                        </table>
                    </div>
                </section>
            `).join("")}
        </div>
    `;
}

function renderHolidayList() {
    if (!manualHolidayDraft.length) {
        return `
            <div class="settings-empty">
                Aun no hay feriados manuales agregados.
            </div>
        `;
    }

    return manualHolidayDraft
        .map((holiday, index) => `
            <article class="settings-holiday-item">
                <span>
                    <strong>${escapeHTML(formatDate(holiday.date))}</strong>
                    <small>${escapeHTML(holiday.name)}</small>
                </span>
                <button type="button" data-remove-holiday="${index}">
                    Quitar
                </button>
            </article>
        `)
        .join("");
}

function renderHolidaysPanel() {
    return `
        <section class="settings-card settings-card--wide">
            <div class="settings-card__head">
                <h4>Feriados manuales</h4>
                <span>Estos dias se consideran inhabiles y se suman a los feriados oficiales.</span>
            </div>

            <div class="settings-holiday-form">
                <label>
                    <span>Fecha</span>
                    <input id="settingsHolidayDate" type="date">
                </label>
                <label>
                    <span>Nombre o motivo</span>
                    <input id="settingsHolidayName" type="text" placeholder="Ej: Feriado institucional">
                </label>
                <button id="settingsAddHoliday" class="secondary-button" type="button">
                    Agregar feriado
                </button>
            </div>

            <div id="settingsHolidayList" class="settings-holiday-list">
                ${renderHolidayList()}
            </div>
        </section>
    `;
}

function renderRequestsPanel() {
    const config =
        replacementRequestConfigDraft ||
        getReplacementRequestConfig();

    return `
        <section class="settings-card settings-card--wide">
            <div class="settings-card__head">
                <h4>Solicitudes de reemplazo</h4>
                <span>
                    Define cuanto tiempo tiene un trabajador para aceptar
                    o rechazar una solicitud enviada a la app o por WhatsApp.
                </span>
            </div>

            <label class="settings-request-field">
                <span>Caducidad de solicitudes</span>
                <input
                    id="settingsReplacementRequestExpires"
                    type="number"
                    min="5"
                    step="5"
                    value="${Number(config.expiresMinutes) || 60}"
                >
                <small>Tiempo en minutos. Valor recomendado: 60.</small>
            </label>
        </section>
    `;
}

function checkboxHTML({
    id,
    checked,
    title,
    description,
    disabled = false
}) {
    return `
        <label class="settings-switch ${disabled ? "is-disabled" : ""}">
            <input
                id="${id}"
                type="checkbox"
                ${checked ? "checked" : ""}
                ${disabled ? "disabled" : ""}
            >
            <span>
                <strong>${escapeHTML(title)}</strong>
                <small>${escapeHTML(description)}</small>
            </span>
        </label>
    `;
}

function renderTurnChangesPanel() {
    const config =
        turnChangeConfigDraft ||
        getTurnChangeConfig();

    return `
        <section class="settings-card settings-card--wide">
            <div class="settings-card__head">
                <h4>Cambio de Turno</h4>
                <span>
                    Define las reglas generales para intercambios de turno
                    y combinaciones de 24 horas.
                </span>
            </div>

            <div class="settings-switch-grid">
                ${checkboxHTML({
                    id: "settingsAllowSwaps",
                    checked: config.allowSwaps,
                    title: "Permitir cambios de turno",
                    description: "Si se desactiva, ningun trabajador podra registrar cambios y el menu quedara deshabilitado."
                })}

                ${config.allowSwaps ? checkboxHTML({
                    id: "settingsAllowDifferentTurnTypes",
                    checked: config.allowDifferentTurnTypes,
                    title: "Permitir Cambios de Turno entre diferentes tipos de turno",
                    description: "Permite cambiar Larga por Noche o Noche por Larga. Si se desactiva, solo se permite Larga por Larga y Noche por Noche."
                }) : ""}

                ${checkboxHTML({
                    id: "settingsAllowTwentyFourHourShifts",
                    checked: config.allowTwentyFourHourShifts,
                    title: "Permitir turnos de 24 horas",
                    description: "Si se desactiva, no se podran generar turnos 24 manuales ni cambios que dejen a un trabajador con turno 24."
                })}

                ${checkboxHTML({
                    id: "settingsAllowInvertedTwentyFourHourShifts",
                    checked: config.allowInvertedTwentyFourHourShifts,
                    title: "Permitir turnos de 24 horas invertidos",
                    description: "Si se desactiva, se bloquea Noche seguida de Larga al dia siguiente y Noche el dia anterior a una Larga."
                })}
            </div>
        </section>
    `;
}

function renderStaffingRows(config) {
    const rows = buildStaffingRequirementRows(config);

    if (!rows.length) {
        return `
            <div class="settings-empty">
                Aun no hay trabajadores activos con rotativa Diurno,
                4° Turno o 3er Turno para configurar dotacion.
            </div>
        `;
    }

    return rows
        .map(row => `
            <label class="settings-staffing-row">
                <span>
                    <strong>${escapeHTML(row.groupLabel)}</strong>
                    <small>${escapeHTML(row.sectionLabel)}</small>
                </span>
                <input
                    type="number"
                    min="0"
                    step="1"
                    data-staffing-modality="${escapeHTML(row.modality)}"
                    data-staffing-estamento="${escapeHTML(row.estamento)}"
                    data-staffing-group="${escapeHTML(row.groupKey)}"
                    value="${Number(row.required) || 0}"
                >
            </label>
        `)
        .join("");
}

function renderStaffingPanel() {
    const config = staffingConfigDraft || getStaffingConfig();

    return `
        <section class="settings-card settings-card--wide">
            <div class="settings-card__head">
                <h4>Dotacion requerida</h4>
                <span>
                    Se muestran solo las profesiones y rotativas que existen
                    actualmente en la unidad.
                </span>
            </div>

            <div class="settings-staffing-grid">
                ${renderStaffingRows(config)}
            </div>
        </section>
    `;
}

function renderActivePanel(config) {
    if (activeTab === "holidays") return renderHolidaysPanel();
    if (activeTab === "requests") return renderRequestsPanel();
    if (activeTab === "turnChanges") return renderTurnChangesPanel();
    if (activeTab === "staffing") return renderStaffingPanel();

    return renderGradesPanel(config);
}

function modalHTML() {
    const config = gradeConfigDraft || getGradeHourConfig();

    return `
        <div class="turn-change-dialog system-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="systemSettingsTitle">
            <div class="settings-dialog-head">
                <span>
                    <strong id="systemSettingsTitle">Ajustes del sistema</strong>
                    <p>Configura valores transversales para calculos y calendario.</p>
                </span>
                <button class="icon-button" type="button" data-settings-close aria-label="Cerrar ajustes">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 6 6 18"></path>
                        <path d="m6 6 12 12"></path>
                    </svg>
                </button>
            </div>

            <div class="settings-tabs" role="tablist">
                <button class="${activeTab === "grades" ? "is-active" : ""}" type="button" data-settings-tab="grades">
                    Valores por grado
                </button>
                <button class="${activeTab === "holidays" ? "is-active" : ""}" type="button" data-settings-tab="holidays">
                    Feriados manuales
                </button>
                <button class="${activeTab === "requests" ? "is-active" : ""}" type="button" data-settings-tab="requests">
                    Solicitudes
                </button>
                <button class="${activeTab === "turnChanges" ? "is-active" : ""}" type="button" data-settings-tab="turnChanges">
                    Cambio de Turno
                </button>
                <button class="${activeTab === "staffing" ? "is-active" : ""}" type="button" data-settings-tab="staffing">
                    Dotacion RRHH
                </button>
            </div>

            <div class="settings-panel">
                ${renderActivePanel(config)}
            </div>

            <div class="turn-change-dialog__actions settings-actions">
                <button class="secondary-button" type="button" data-settings-close>
                    Cancelar
                </button>
                <button class="primary-button" type="button" data-settings-save>
                    Guardar ajustes
                </button>
            </div>
        </div>
    `;
}

function readRateConfig(backdrop) {
    const config = JSON.parse(
        JSON.stringify(gradeConfigDraft || getGradeHourConfig())
    );

    backdrop
        .querySelectorAll("[data-rate-group][data-rate-grade]")
        .forEach(input => {
            const group = input.dataset.rateGroup;
            const grade = input.dataset.rateGrade;
            const fallback =
                DEFAULT_GRADE_HOUR_CONFIG[group]?.[grade] || 0;
            const value = parseRate(input.value);

            config[group][grade] = value || fallback;
        });

    return config;
}

function readRequestConfig(backdrop) {
    const input =
        backdrop.querySelector("#settingsReplacementRequestExpires");
    const fallback =
        replacementRequestConfigDraft ||
        getReplacementRequestConfig();
    const expiresMinutes = Number(input?.value);

    return {
        ...fallback,
        expiresMinutes:
            Number.isFinite(expiresMinutes) && expiresMinutes > 0
                ? Math.round(expiresMinutes)
                : fallback.expiresMinutes
    };
}

function readTurnChangeConfig(backdrop) {
    const fallback =
        turnChangeConfigDraft ||
        getTurnChangeConfig();
    const hasInput = id =>
        Boolean(backdrop.querySelector(`#${id}`));
    const checked = id =>
        Boolean(backdrop.querySelector(`#${id}`)?.checked);

    return {
        ...fallback,
        allowSwaps: hasInput("settingsAllowSwaps")
            ? checked("settingsAllowSwaps")
            : fallback.allowSwaps,
        allowDifferentTurnTypes:
            hasInput("settingsAllowDifferentTurnTypes")
                ? checked("settingsAllowDifferentTurnTypes")
                : fallback.allowDifferentTurnTypes,
        allowTwentyFourHourShifts:
            hasInput("settingsAllowTwentyFourHourShifts")
                ? checked("settingsAllowTwentyFourHourShifts")
                : fallback.allowTwentyFourHourShifts,
        allowInvertedTwentyFourHourShifts:
            hasInput("settingsAllowInvertedTwentyFourHourShifts")
                ? checked("settingsAllowInvertedTwentyFourHourShifts")
                : fallback.allowInvertedTwentyFourHourShifts
    };
}

function readStaffingConfig(backdrop) {
    const config = {};

    backdrop
        .querySelectorAll("[data-staffing-modality][data-staffing-estamento][data-staffing-group]")
        .forEach(input => {
            const modality = input.dataset.staffingModality;
            const estamento = input.dataset.staffingEstamento;
            const group = input.dataset.staffingGroup;
            const value = Number(input.value);

            if (!config[modality]) config[modality] = {};
            if (!config[modality][estamento]) {
                config[modality][estamento] = {};
            }

            config[modality][estamento][group] =
                Number.isFinite(value) && value > 0
                    ? Math.round(value)
                    : 0;
        });

    return config;
}

function preserveActiveDraft(backdrop) {
    if (activeTab === "grades") {
        gradeConfigDraft = readRateConfig(backdrop);
    }

    if (activeTab === "requests") {
        replacementRequestConfigDraft =
            readRequestConfig(backdrop);
    }

    if (activeTab === "turnChanges") {
        turnChangeConfigDraft =
            readTurnChangeConfig(backdrop);
    }

    if (activeTab === "staffing") {
        staffingConfigDraft = readStaffingConfig(backdrop);
    }
}

function rerenderHolidayList(backdrop) {
    const list = backdrop.querySelector("#settingsHolidayList");
    if (!list) return;

    list.innerHTML = renderHolidayList();
}

function bindBackdrop(backdrop) {
    backdrop.addEventListener("change", event => {
        if (event.target?.id !== "settingsAllowSwaps") return;

        preserveActiveDraft(backdrop);
        backdrop.innerHTML = modalHTML();
        backdrop
            .querySelector("#settingsAllowSwaps")
            ?.focus();
    });

    backdrop.addEventListener("click", event => {
        if (
            event.target === backdrop ||
            event.target.closest("[data-settings-close]")
        ) {
            backdrop.remove();
            return;
        }

        const tab = event.target.closest("[data-settings-tab]");
        if (tab) {
            preserveActiveDraft(backdrop);
            activeTab = tab.dataset.settingsTab;
            backdrop.innerHTML = modalHTML();
            return;
        }

        const addHoliday = event.target.closest("#settingsAddHoliday");
        if (addHoliday) {
            const dateInput = backdrop.querySelector("#settingsHolidayDate");
            const nameInput = backdrop.querySelector("#settingsHolidayName");
            const date = dateInput?.value || "";
            const name = String(nameInput?.value || "").trim();

            if (!date) {
                dateInput?.focus();
                return;
            }

            manualHolidayDraft = manualHolidayDraft
                .filter(item => item.date !== date)
                .concat({
                    date,
                    name: name || "Feriado manual"
                })
                .sort((a, b) => a.date.localeCompare(b.date));

            if (dateInput) dateInput.value = "";
            if (nameInput) nameInput.value = "";
            rerenderHolidayList(backdrop);
            dateInput?.focus();
            return;
        }

        const removeHoliday = event.target.closest("[data-remove-holiday]");
        if (removeHoliday) {
            const index = Number(removeHoliday.dataset.removeHoliday);
            manualHolidayDraft = manualHolidayDraft.filter((_, itemIndex) =>
                itemIndex !== index
            );
            rerenderHolidayList(backdrop);
            return;
        }

        if (event.target.closest("[data-settings-save]")) {
            preserveActiveDraft(backdrop);
            const previousStaffingConfig = getStaffingConfig();
            const nextStaffingConfig =
                staffingConfigDraft ||
                getStaffingConfig();
            saveGradeHourConfig(gradeConfigDraft);
            saveManualHolidays(manualHolidayDraft);
            saveReplacementRequestConfig(
                replacementRequestConfigDraft ||
                getReplacementRequestConfig()
            );
            saveTurnChangeConfig(
                turnChangeConfigDraft ||
                getTurnChangeConfig()
            );
            saveStaffingConfig(nextStaffingConfig);

            if (
                staffingConfigSummary(previousStaffingConfig) !==
                staffingConfigSummary(nextStaffingConfig)
            ) {
                addAuditLog(
                    AUDIT_CATEGORY.STAFFING,
                    "Modifico dotacion requerida",
                    `Antes: ${staffingConfigSummary(previousStaffingConfig)}. Ahora: ${staffingConfigSummary(nextStaffingConfig)}.`,
                    { scope: "staffing_settings" }
                );
            }

            addAuditLog(
                AUDIT_CATEGORY.SYSTEM_SETTINGS,
                "Modifico ajustes del sistema",
                "Actualizo valores por grado, feriados manuales, caducidad de solicitudes, reglas de cambios de turno y/o dotacion requerida.",
                { scope: "system_settings" }
            );
            backdrop.remove();
            onSettingsSaved?.();
        }
    });
}

export function openSystemSettings() {
    document
        .querySelector(".turn-change-dialog-backdrop[data-system-settings]")
        ?.remove();

    manualHolidayDraft = getManualHolidays();
    gradeConfigDraft = getGradeHourConfig();
    replacementRequestConfigDraft =
        getReplacementRequestConfig();
    turnChangeConfigDraft = getTurnChangeConfig();
    staffingConfigDraft = getStaffingConfig();

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.dataset.systemSettings = "true";
    backdrop.innerHTML = modalHTML();

    bindBackdrop(backdrop);
    document.body.appendChild(backdrop);

    backdrop
        .querySelector(
            activeTab === "grades"
                ? "[data-rate-group]"
                : activeTab === "holidays"
                    ? "#settingsHolidayDate"
                    : activeTab === "requests"
                        ? "#settingsReplacementRequestExpires"
                        : activeTab === "turnChanges"
                            ? "#settingsAllowSwaps"
                            : "[data-staffing-modality]"
        )
        ?.focus();
}

export function initSystemSettings(options = {}) {
    onSettingsSaved = options.onSaved || null;
    options.button?.addEventListener("click", openSystemSettings);
}
