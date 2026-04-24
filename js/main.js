import { prevMonth, nextMonth } from "./calendar.js";
import { pushHistory, undo, redo } from "./history.js";
import { refreshAll } from "./refresh.js";
import { DOM } from "./dom.js";
import { renderSwapPanel } from "./swapUI.js";
import { renderStaffingPanel } from "./staffing.js";
import {
    fetchHolidays,
    getCachedHolidays
} from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
import {
    turnoLabel,
    aplicarClaseTurno
} from "./uiEngine.js";
import {
    getProfileData,
    saveProfileData,
    getBaseProfileData,
    saveBaseProfileData,
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
    saveAbsences,
    updateProfile,
    getRotativa,
    saveRotativa,
    getValorHora,
    setValorHora,
    getManualLeaveBalances,
    saveManualLeaveBalances,
    getSwaps,
    saveSwaps
} from "./storage.js";
import {
    totalAdministrativosUsados,
    aplicarAdministrativo,
    aplicarHalfAdministrativo,
    aplicarLegal,
    aplicarComp,
    aplicarLicencia,
    validarCantidadLegalAnual
} from "./leaveEngine.js";

const PROFILE_MODE = {
    VIEW: "view",
    CREATE: "create",
    EDIT: "edit"
};

const THEME_KEY = "proturnos_theme";

let selectionMode = null;
let adminCantidad = 0;
let compCantidad = 0;
let legalCantidad = 0;
let licenseCantidad = 0;
let licenseType = "license";
let availabilityEditMode = false;
let profileRotationMiniDate = new Date();

const profileDraft = {
    mode: PROFILE_MODE.VIEW,
    originalName: "",
    originalRotationType: "",
    originalRotationStart: "",
    name: "",
    estamento: "",
    rotationType: "",
    rotationStart: "",
    shiftAssigned: false,
    valorHora: ""
};

window.selectionMode = null;
window.compCantidad = 0;
window.licenseCantidad = 0;
window.licenseType = "license";
window.pushUndoState = pushHistory;
window.getProfileDraftSelectionKey = () =>
    inputDateToCalendarKey(profileDraft.rotationStart);

function keyFromDate(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function parseKey(key) {
    const parts = key.split("-");
    return new Date(
        Number(parts[0]),
        Number(parts[1]),
        Number(parts[2])
    );
}

function parseInputDate(value){
    const parts = value.split("-");
    return new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2])
    );
}

function toISODate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function toInputDate(date){
    return toISODate(date);
}

function normalizeStoredStart(start){
    if (!start) return "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        return start;
    }

    const date = new Date(start);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return toInputDate(date);
}

function inputDateToCalendarKey(value){
    if (!value) return "";

    const parts = value.split("-");

    if (parts.length !== 3) return "";

    return `${parts[0]}-${Number(parts[1]) - 1}-${Number(parts[2])}`;
}

function compareISODate(a, b) {
    return String(a || "").localeCompare(String(b || ""));
}

function isDateKeyOnOrAfter(key, startDate) {
    const date = parseKey(key);

    if (Number.isNaN(date.getTime())) return false;

    return date >= startDate;
}

function formatDisplayDate(value){
    if (!value) return "";

    const parts = value.split("-");

    if (parts.length !== 3) return value;

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function contarHabiles(
    obj,
    year = new Date().getFullYear(),
    holidays = getCachedHolidays(year)
) {
    let total = 0;

    Object.keys(obj).forEach(key => {
        if (!key.startsWith(year + "-")) return;

        const date = parseKey(key);

        if (isBusinessDay(date, holidays)) total++;
    });

    return total;
}

function formatSaldo(value) {
    return Number.isInteger(value)
        ? String(value)
        : value
            .toFixed(1)
            .replace(".0", "")
            .replace(".", ",");
}

function normalizeBalanceValue(value) {
    const numeric = Number(
        String(value ?? "").replace(",", ".")
    );

    if (!Number.isFinite(numeric)) return 0;

    return Math.max(0, Math.round(numeric * 10) / 10);
}

function withManualBalance(
    manualValue,
    fallbackValue
) {
    const numeric = Number(manualValue);

    return Number.isFinite(numeric)
        ? Math.max(0, numeric)
        : fallbackValue;
}

function getLeaveBalances(
    year = new Date().getFullYear(),
    holidays = getCachedHolidays(year)
) {
    const manual = getManualLeaveBalances(year);
    const calculated = {
        legal: Math.max(0, 15 - contarHabiles(getLegalDays(), year, holidays)),
        admin: Math.max(0, 6 - totalAdministrativosUsados()),
        comp: contarHabiles(getCompDays(), year, holidays)
    };

    return {
        legal: withManualBalance(manual.legal, calculated.legal),
        admin: withManualBalance(manual.admin, calculated.admin),
        comp: withManualBalance(manual.comp, calculated.comp)
    };
}

function decrementManualBalance(
    field,
    amount,
    year = new Date().getFullYear()
) {
    const manual = getManualLeaveBalances(year);
    const currentValue = Number(manual[field]);

    if (!Number.isFinite(currentValue)) return;

    saveManualLeaveBalances(year, {
        ...manual,
        [field]: Math.max(
            0,
            normalizeBalanceValue(currentValue - amount)
        )
    });
}

function incrementManualBalance(
    field,
    amount,
    year = new Date().getFullYear()
) {
    const manual = getManualLeaveBalances(year);
    const currentValue = Number(manual[field]);

    if (!Number.isFinite(currentValue)) return;

    saveManualLeaveBalances(year, {
        ...manual,
        [field]: Math.max(
            0,
            normalizeBalanceValue(currentValue + amount)
        )
    });
}

function sanitizeValorHora(value){
    const numeric = Math.max(0, Number(value) || 0);
    return value === "" ? "" : String(numeric);
}

function getRotativaLabel(type){
    if (type === "4turno") return "4° Turno";
    if (type === "diurno") return "Diurno";
    return "Sin rotativa";
}

function isProfileEditing(){
    return profileDraft.mode !== PROFILE_MODE.VIEW;
}

function getPerfilActual() {
    const current = getCurrentProfile();
    return getProfiles().find(
        profile => profile.name === current
    ) || null;
}

function clearDraftValues(){
    profileDraft.originalName = "";
    profileDraft.originalRotationType = "";
    profileDraft.originalRotationStart = "";
    profileDraft.name = "";
    profileDraft.estamento = "";
    profileDraft.rotationType = "";
    profileDraft.rotationStart = "";
    profileDraft.shiftAssigned = false;
    profileDraft.valorHora = "";
}

function loadDraftFromProfile(profile){
    const rotativa = getRotativa(profile.name);
    const rotationStart =
        normalizeStoredStart(rotativa.start);

    profileDraft.originalName = profile.name;
    profileDraft.originalRotationType =
        rotativa.type || "";
    profileDraft.originalRotationStart =
        rotationStart;
    profileDraft.name = profile.name;
    profileDraft.estamento = profile.estamento || "";
    profileDraft.rotationType = rotativa.type || "";
    profileDraft.rotationStart = rotationStart;
    profileDraft.shiftAssigned = getShiftAssigned(profile.name);
    profileDraft.valorHora = String(getValorHora(profile.name) || "");
}

function hasRotationChanged() {
    if (profileDraft.mode !== PROFILE_MODE.EDIT) {
        return false;
    }

    return (
        profileDraft.rotationType !==
            profileDraft.originalRotationType ||
        normalizeStoredStart(profileDraft.rotationStart) !==
            normalizeStoredStart(
                profileDraft.originalRotationStart
            )
    );
}

function getDisplayedProfileData(){
    const profile = getPerfilActual();

    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return {
            name: profileDraft.name,
            estamento: profileDraft.estamento,
            rotationType: profileDraft.rotationType,
            rotationStart: profileDraft.rotationStart,
            shiftAssigned: profileDraft.shiftAssigned,
            valorHora: profileDraft.valorHora
        };
    }

    if (profileDraft.mode === PROFILE_MODE.EDIT) {
        return {
            name: profileDraft.name,
            estamento: profileDraft.estamento,
            rotationType: profileDraft.rotationType,
            rotationStart: profileDraft.rotationStart,
            shiftAssigned: profileDraft.shiftAssigned,
            valorHora: profileDraft.valorHora
        };
    }

    if (!profile) {
        return {
            name: "",
            estamento: "",
            rotationType: "",
            rotationStart: "",
            shiftAssigned: false,
            valorHora: ""
        };
    }

    const rotativa = getRotativa(profile.name);

    return {
        name: profile.name,
        estamento: profile.estamento,
        rotationType: rotativa.type || "",
        rotationStart: normalizeStoredStart(rotativa.start),
        shiftAssigned: getShiftAssigned(profile.name),
        valorHora: String(getValorHora(profile.name) || "")
    };
}

function buildRotationStatus(data){
    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        if (!data.rotationType) {
            return "Selecciona una rotativa para definir su fecha de inicio.";
        }

        if (!data.rotationStart) {
            return `Marca en el mini calendario desde que fecha se aplicara ${getRotativaLabel(data.rotationType)}.`;
        }

        return `${getRotativaLabel(data.rotationType)} comenzara el ${formatDisplayDate(data.rotationStart)}.`;
    }

    if (profileDraft.mode === PROFILE_MODE.EDIT) {
        if (!data.rotationType) {
            return "Selecciona la nueva rotativa y luego marca su fecha de inicio en el mini calendario.";
        }

        if (!hasRotationChanged()) {
            if (!data.rotationStart) {
                return `Rotativa actual: ${getRotativaLabel(data.rotationType)}.`;
            }

            return `Rotativa actual: ${getRotativaLabel(data.rotationType)} desde ${formatDisplayDate(data.rotationStart)}.`;
        }

        if (!data.rotationStart) {
            return `Marca en el mini calendario desde que fecha se aplicara la nueva ${getRotativaLabel(data.rotationType)}.`;
        }

        return `${getRotativaLabel(data.rotationType)} se aplicara desde ${formatDisplayDate(data.rotationStart)}.`;
    }

    if (!data.rotationType) {
        return "Este colaborador aun no tiene una rotativa configurada.";
    }

    if (!data.rotationStart) {
        return `Rotativa actual: ${getRotativaLabel(data.rotationType)}.`;
    }

    return `Rotativa actual: ${getRotativaLabel(data.rotationType)} desde ${formatDisplayDate(data.rotationStart)}.`;
}

function buildEditorHint(profile){
    if (profileDraft.mode === PROFILE_MODE.CREATE) {
        return "Completa nombre, estamento, rotativa y marca en el mini calendario desde que fecha inicia antes de guardar.";
    }

    if (profileDraft.mode === PROFILE_MODE.EDIT) {
        return "Actualiza los datos del trabajador. Solo si cambias la rotativa debes marcar en el mini calendario desde que fecha aplica.";
    }

    if (profile) {
        return "Presiona Editar para modificar nombre, estamento, rotativa, asignacion de turno y valor hora.";
    }

    return "Selecciona un colaborador para editarlo o crea uno nuevo.";
}

function getProfileRotationState(profileName, key) {
    if (!profileName) return 0;

    const baseData = getBaseProfileData(profileName);
    const data = getProfileData(profileName);

    if (Object.prototype.hasOwnProperty.call(baseData, key)) {
        return Number(baseData[key]) || 0;
    }

    return Number(data[key]) || 0;
}

function renderProfileRotationMiniCalendar() {
    if (!DOM.profileRotationMiniCalendar) return;

    const y = profileRotationMiniDate.getFullYear();
    const m = profileRotationMiniDate.getMonth();
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const selectedKey =
        inputDateToCalendarKey(profileDraft.rotationStart);
    const profile = getPerfilActual();
    const editing = isProfileEditing();
    const canPick = editing && Boolean(profileDraft.rotationType);

    let html = `
        <div class="profile-mini-head">
            <button id="profileMiniPrev" type="button" aria-label="Mes anterior">&lt;</button>
            <strong>${profileRotationMiniDate.toLocaleString("es-CL", {
                month: "long",
                year: "numeric"
            })}</strong>
            <button id="profileMiniNext" type="button" aria-label="Mes siguiente">&gt;</button>
        </div>

        <div class="profile-mini-weekdays">
            <span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span>
        </div>

        <div class="profile-mini-grid">
    `;

    for (let i = 0; i < first; i++) {
        html += `<span class="profile-mini-spacer"></span>`;
    }

    for (let d = 1; d <= days; d++) {
        const key = `${y}-${m}-${d}`;
        const state = getProfileRotationState(profile?.name, key);
        const cell = document.createElement("button");

        cell.type = "button";
        cell.className = "profile-mini-day";
        cell.dataset.key = key;

        if (selectedKey === key) {
            cell.classList.add("is-selected");
        }

        if (canPick) {
            cell.classList.add("is-pickable");
        } else {
            cell.disabled = true;
        }

        aplicarClaseTurno(cell, state);
        cell.innerHTML = `
            <span>${d}</span>
            <small>${turnoLabel(state)}</small>
        `;

        html += cell.outerHTML;
    }

    html += `
        </div>
        <p class="profile-mini-help">
            ${canPick
                ? "Selecciona aqui desde que fecha se aplicara la rotativa escogida."
                : "Presiona Crear Nuevo o Editar y escoge una rotativa para seleccionar fecha."}
        </p>
    `;

    DOM.profileRotationMiniCalendar.innerHTML = html;

    document.getElementById("profileMiniPrev").onclick = () => {
        profileRotationMiniDate.setMonth(
            profileRotationMiniDate.getMonth() - 1
        );
        renderProfileRotationMiniCalendar();
    };

    document.getElementById("profileMiniNext").onclick = () => {
        profileRotationMiniDate.setMonth(
            profileRotationMiniDate.getMonth() + 1
        );
        renderProfileRotationMiniCalendar();
    };

    DOM.profileRotationMiniCalendar
        .querySelectorAll(".profile-mini-day.is-pickable")
        .forEach(button => {
            button.onclick = () => {
                const date = parseKey(button.dataset.key);

                profileDraft.rotationStart = toInputDate(date);
                renderDashboardState();
            };
        });
}

function renderDisponibilidadVacaciones() {
    if (!DOM.availabilitySummary) return;

    const profile = getPerfilActual();

    if (!profile) {
        availabilityEditMode = false;

        DOM.availabilitySummary.innerHTML = `
            <div class="availability-empty">
                Selecciona un colaborador para ver sus saldos.
            </div>
        `;

        if (DOM.availabilityEditBtn) {
            DOM.availabilityEditBtn.textContent = "EDITAR";
            DOM.availabilityEditBtn.disabled = true;
        }

        return;
    }

    const saldos = getLeaveBalances();
    const licencias = Object.keys(getAbsences()).length;
    const year = new Date().getFullYear();

    if (DOM.availabilityEditBtn) {
        DOM.availabilityEditBtn.textContent =
            availabilityEditMode ? "GUARDAR" : "EDITAR";
        DOM.availabilityEditBtn.disabled = false;
    }

    if (availabilityEditMode) {
        DOM.availabilitySummary.innerHTML = `
            <div class="availability-list">
                <label class="availability-item">
                    <span>FL</span>
                    <input id="availabilityLegalInput" type="number" min="0" step="0.5" value="${saldos.legal}">
                </label>

                <label class="availability-item">
                    <span>FC</span>
                    <input id="availabilityCompInput" type="number" min="0" step="1" value="${saldos.comp}">
                </label>

                <label class="availability-item">
                    <span>ADM</span>
                    <input id="availabilityAdminInput" type="number" min="0" step="0.5" value="${saldos.admin}">
                </label>
            </div>

            <div class="availability-note">
                Editando saldos vigentes del ano ${year}. Licencias medicas cargadas: ${licencias}
            </div>
        `;

        return;
    }

    DOM.availabilitySummary.innerHTML = `
        <div class="availability-list">
            <div class="availability-item">
                <span>FL</span>
                <strong>${formatSaldo(saldos.legal)} dias</strong>
            </div>

            <div class="availability-item">
                <span>FC</span>
                <strong>${formatSaldo(saldos.comp)} reg.</strong>
            </div>

            <div class="availability-item">
                <span>ADM</span>
                <strong>${formatSaldo(saldos.admin)} dias</strong>
            </div>
        </div>

        <div class="availability-note">
            Saldos vigentes del ano ${year}. Licencias medicas cargadas: ${licencias}
        </div>
    `;
}

function renderLeaveActionLabels() {
    const profile = getPerfilActual();
    const adminBase = "P. ADMINISTRATIVO";
    const compBase = "F. COMPENSATORIO";
    const legalBase = "F. LEGAL";

    if (!profile) {
        DOM.adminBtnLabel.textContent = adminBase;
        DOM.compBtnLabel.textContent = compBase;
        DOM.legalBtnLabel.textContent = legalBase;
        DOM.adminBtn.disabled = true;
        DOM.halfAdminMorningBtn.disabled = true;
        DOM.halfAdminAfternoonBtn.disabled = true;
        DOM.compBtn.disabled = true;
        DOM.legalBtn.disabled = true;
        DOM.licenseBtn.disabled = true;
        DOM.professionalLicenseBtn.disabled = true;
        DOM.unpaidLeaveBtn.disabled = true;
        return;
    }

    const saldos = getLeaveBalances();

    DOM.adminBtnLabel.textContent =
        `${adminBase} (${formatSaldo(saldos.admin)})`;
    DOM.compBtnLabel.textContent =
        `${compBase} (${formatSaldo(saldos.comp)})`;
    DOM.legalBtnLabel.textContent =
        `${legalBase} (${formatSaldo(saldos.legal)})`;

    DOM.adminBtn.disabled = saldos.admin <= 0;
    DOM.halfAdminMorningBtn.disabled = saldos.admin <= 0;
    DOM.halfAdminAfternoonBtn.disabled = saldos.admin <= 0;
    DOM.compBtn.disabled = saldos.comp <= 0;
    DOM.legalBtn.disabled = saldos.legal <= 0;
    DOM.licenseBtn.disabled = false;
    DOM.professionalLicenseBtn.disabled = false;
    DOM.unpaidLeaveBtn.disabled = false;
}

function renderDashboardState() {
    const profile = getPerfilActual();
    const data = getDisplayedProfileData();
    const editing = isProfileEditing();

    DOM.profileNameInput.value = data.name || "";
    DOM.profileRoleSelect.value = data.estamento || "";
    DOM.profileRotationSelect.value = data.rotationType || "";
    DOM.checkbox.checked = Boolean(data.shiftAssigned);
    DOM.valorHoraInput.value = data.valorHora;

    DOM.profileNameInput.disabled = !editing;
    DOM.profileRoleSelect.disabled = !editing;
    DOM.profileRotationSelect.disabled = !editing;
    DOM.checkbox.disabled = !editing;
    DOM.valorHoraInput.disabled = !editing;

    DOM.profileRotationStatus.textContent =
        buildRotationStatus(data);

    renderProfileRotationMiniCalendar();

    DOM.profileEditorHint.textContent =
        buildEditorHint(profile);

    DOM.openCreateProfileBtn.textContent =
        profileDraft.mode === PROFILE_MODE.CREATE
            ? "GUARDAR"
            : "CREAR NUEVO";

    DOM.openEditProfileBtn.textContent =
        profileDraft.mode === PROFILE_MODE.EDIT
            ? "GUARDAR"
            : "EDITAR";

    DOM.openCreateProfileBtn.disabled =
        profileDraft.mode === PROFILE_MODE.EDIT;

    DOM.openEditProfileBtn.disabled =
        profileDraft.mode === PROFILE_MODE.CREATE ||
        (!profile && profileDraft.mode !== PROFILE_MODE.EDIT);

    renderLeaveActionLabels();
    renderDisponibilidadVacaciones();
    updateTurnChangesNavState();
}

window.renderDashboardState = renderDashboardState;

function renderBotones() {
    const hasProfile = Boolean(getCurrentProfile());
    const shiftAssigned = isProfileEditing()
        ? Boolean(profileDraft.shiftAssigned)
        : getShiftAssigned();

    DOM.compBtn.classList.toggle(
        "hidden",
        !hasProfile || !shiftAssigned
    );

    updateTurnChangesNavState();
}

function updateTurnChangesNavState() {
    const button =
        document.getElementById("turnChangesNav") ||
        document.querySelector("[data-target='turnChangesView']");

    if (!button) return;

    const currentProfile = getCurrentProfile();
    const rotativa = currentProfile
        ? getRotativa(currentProfile)
        : { type: "" };
    const disabled =
        !currentProfile ||
        rotativa.type === "diurno";

    button.disabled = disabled;
    button.classList.toggle("is-disabled", disabled);
    button.title = disabled
        ? "Cambios de turno no disponible para trabajadores con rotativa Diurno."
        : "";

    if (
        disabled &&
        document.body.dataset.activeView === "swap"
    ) {
        setActiveShortcut("calendarPanel");
    }
}

function getViewForTarget(targetId) {
    if (
        targetId === "profileSection" ||
        targetId === "availabilitySummary" ||
        targetId === "hoursPanel"
    ) {
        return "profile";
    }

    if (
        targetId === "swapPanel" ||
        targetId === "turnChangesView"
    ) {
        return "swap";
    }

    if (targetId === "staffingPanel") {
        return "staffing";
    }

    return "turnos";
}

function setDashboardView(view) {
    document.body.dataset.activeView = view;
}

function setActiveShortcut(targetId) {
    const nextView = getViewForTarget(targetId);

    if (nextView === "profile" && selectionMode) {
        clearSelectionMode(false);
    }

    setDashboardView(nextView);

    document
        .querySelectorAll(".nav-tile[data-target]")
        .forEach(button => {
            button.classList.toggle(
                "is-active",
                button.dataset.target === targetId
            );
        });
}

function renderProfiles() {
    const profiles = getProfiles();

    if (
        profiles.length > 0 &&
        !profiles.some(
            profile => profile.name === getCurrentProfile()
        ) &&
        profileDraft.mode === PROFILE_MODE.VIEW
    ) {
        setCurrentProfile(profiles[0].name);
    }

    const current = getCurrentProfile();
    const filtro = DOM.filterRole.value;
    const query =
        DOM.profileSearch.value
            .trim()
            .toLowerCase();

    DOM.profiles.innerHTML = "";

    const visibles = profiles.filter(profile => {
        const matchRole =
            filtro === "Todos" ||
            profile.estamento === filtro;

        const matchSearch =
            !query ||
            profile.name.toLowerCase().includes(query) ||
            profile.estamento.toLowerCase().includes(query);

        return matchRole && matchSearch;
    });

    if (!visibles.length) {
        DOM.emptyProfiles.classList.remove("hidden");
        DOM.emptyProfiles.textContent = profiles.length
            ? "No hay resultados con ese filtro."
            : "Aun no hay colaboradores creados.";
    } else {
        DOM.emptyProfiles.classList.add("hidden");
    }

    visibles.forEach(profile => {
        const item = document.createElement("div");
        item.className = "profile-item";

        if (
            profile.name === current &&
            profileDraft.mode !== PROFILE_MODE.CREATE
        ) {
            item.classList.add("active");
        }

        const avatar = document.createElement("div");
        avatar.className = "profile-item__avatar";
        avatar.textContent =
            profile.name.trim().charAt(0).toUpperCase() || "T";

        const content = document.createElement("div");
        content.className = "profile-item__content";

        const name = document.createElement("strong");
        name.textContent = profile.name;

        const meta = document.createElement("span");
        meta.textContent = profile.estamento;

        content.append(name, meta);
        item.append(avatar, content);

        item.onclick = () => {
            clearSelectionMode(false);
            clearDraftValues();
            availabilityEditMode = false;
            profileDraft.mode = PROFILE_MODE.VIEW;
            setCurrentProfile(profile.name);
            renderProfiles();
            renderBotones();
            refreshAll();
        };

        DOM.profiles.appendChild(item);
    });

    renderDashboardState();
}

function clearSelectionMode(shouldRefresh = true) {
    selectionMode = null;
    window.selectionMode = null;
    compCantidad = 0;
    window.compCantidad = 0;
    licenseCantidad = 0;
    licenseType = "license";
    window.licenseCantidad = 0;
    window.licenseType = "license";

    document.body.classList.remove("mode-active");
    document.body.removeAttribute("data-mode");

    DOM.selectorInfo.classList.add("hidden");
    DOM.selectorInfo.innerHTML = "";
    DOM.adminInfo.classList.add("hidden");

    if (shouldRefresh) {
        refreshAll();
    }
}

function activarModo(modo, texto) {
    selectionMode = modo;
    window.selectionMode = modo;

    document.body.classList.add("mode-active");
    document.body.dataset.mode = modo;

    DOM.selectorInfo.innerHTML = `
        <div class="mode-banner">
            <span>${texto}</span>
            <button id="cancelModeBtn" type="button">Cancelar</button>
        </div>
    `;

    DOM.selectorInfo.classList.remove("hidden");
    DOM.adminInfo.textContent =
        "Selecciona una fecha en el calendario para continuar.";
    DOM.adminInfo.classList.remove("hidden");

    document
        .getElementById("cancelModeBtn")
        .onclick = () => clearSelectionMode();

    refreshAll();
}

function startCreateMode() {
    clearSelectionMode(false);
    clearDraftValues();
    availabilityEditMode = false;
    profileRotationMiniDate = new Date();

    profileDraft.mode = PROFILE_MODE.CREATE;
    setCurrentProfile(null);

    renderProfiles();
    renderBotones();
    refreshAll();
    setActiveShortcut("profileSection");
    DOM.profileNameInput.focus();
}

function startEditMode() {
    const profile = getPerfilActual();
    if (!profile) return;

    clearSelectionMode(false);
    availabilityEditMode = false;
    loadDraftFromProfile(profile);
    profileRotationMiniDate = profileDraft.rotationStart
        ? parseInputDate(profileDraft.rotationStart)
        : new Date();
    profileDraft.mode = PROFILE_MODE.EDIT;

    renderDashboardState();
    renderBotones();
    refreshAll();
    setActiveShortcut("profileSection");
    DOM.profileNameInput.focus();
    DOM.profileNameInput.select();
}

function exitProfileMode(selectedName = getCurrentProfile()) {
    clearSelectionMode(false);
    clearDraftValues();
    availabilityEditMode = false;
    profileDraft.mode = PROFILE_MODE.VIEW;

    setCurrentProfile(selectedName || null);
    renderProfiles();
    renderBotones();
}

function handleRotationSelectionChange() {
    if (!isProfileEditing()) return;

    profileDraft.rotationType =
        DOM.profileRotationSelect.value;
    profileDraft.rotationStart = "";

    if (!profileDraft.rotationType) {
        clearSelectionMode(false);
        renderDashboardState();
        refreshAll();
        return;
    }

    renderDashboardState();
    setActiveShortcut("profileSection");
}

function validateDraft() {
    const missing = [];
    const requiresRotationStart =
        profileDraft.mode === PROFILE_MODE.CREATE ||
        hasRotationChanged();

    if (!profileDraft.name.trim()) missing.push("nombre");
    if (!profileDraft.estamento) missing.push("estamento");
    if (!profileDraft.rotationType) missing.push("rotativa");
    if (
        requiresRotationStart &&
        !profileDraft.rotationStart
    ) {
        missing.push("fecha de inicio de rotativa");
    }

    if (!missing.length) {
        return true;
    }

    alert(
        `Falta completar: ${missing.join(", ")}.`
    );
    return false;
}

function futureKeys(map, startDate) {
    return Object.keys(map || {}).filter(key =>
        isDateKeyOnOrAfter(key, startDate)
    );
}

function pushReturnKey(target, key) {
    const year = key.split("-")[0];

    if (!target[year]) target[year] = [];

    target[year].push(key);
}

async function countBusinessKeys(keys) {
    const holidaysByYear = {};
    let total = 0;

    for (const key of keys) {
        const date = parseKey(key);
        const year = date.getFullYear();

        if (!holidaysByYear[year]) {
            holidaysByYear[year] = await fetchHolidays(year);
        }

        if (isBusinessDay(date, holidaysByYear[year])) {
            total++;
        }
    }

    return total;
}

async function returnBusinessBalances(field, keysByYear) {
    for (const [year, keys] of Object.entries(keysByYear)) {
        const total = await countBusinessKeys(keys);
        incrementManualBalance(field, total, Number(year));
    }
}

function returnAdminBalances(amountByYear) {
    Object.entries(amountByYear).forEach(([year, amount]) => {
        incrementManualBalance("admin", amount, Number(year));
    });
}

function cleanupFutureSwaps(profileName, startISO) {
    const nextSwaps = [];

    getSwaps().forEach(swap => {
        if (
            swap.from !== profileName &&
            swap.to !== profileName
        ) {
            nextSwaps.push(swap);
            return;
        }

        const skipFecha =
            Boolean(swap.skipFecha) ||
            (
                swap.fecha &&
                compareISODate(swap.fecha, startISO) >= 0
            );
        const skipDevolucion =
            Boolean(swap.skipDevolucion) ||
            (
                swap.devolucion &&
                compareISODate(swap.devolucion, startISO) >= 0
            );

        if (skipFecha && skipDevolucion) {
            return;
        }

        nextSwaps.push({
            ...swap,
            skipFecha,
            skipDevolucion
        });
    });

    saveSwaps(nextSwaps);
}

async function cleanupFutureSchedule(startDate) {
    const profileName = getCurrentProfile();

    if (!profileName) return;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const returnedLegal = {};
    const returnedComp = {};
    const returnedAdmin = {};
    const startISO = toISODate(startDate);

    futureKeys(data, startDate).forEach(key => {
        delete data[key];
    });

    futureKeys(baseData, startDate).forEach(key => {
        delete baseData[key];
    });

    futureKeys(blocked, startDate).forEach(key => {
        delete blocked[key];
    });

    futureKeys(legal, startDate).forEach(key => {
        delete legal[key];
        pushReturnKey(returnedLegal, key);
    });

    futureKeys(comp, startDate).forEach(key => {
        delete comp[key];
        pushReturnKey(returnedComp, key);
    });

    futureKeys(admin, startDate).forEach(key => {
        const amount = admin[key] === 1 ? 1 : 0.5;
        const year = key.split("-")[0];

        delete admin[key];
        returnedAdmin[year] =
            (returnedAdmin[year] || 0) + amount;
    });

    futureKeys(absences, startDate).forEach(key => {
        delete absences[key];
    });

    cleanupFutureSwaps(profileName, startISO);

    await returnBusinessBalances("legal", returnedLegal);
    await returnBusinessBalances("comp", returnedComp);
    returnAdminBalances(returnedAdmin);

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);
    saveAdminDays(admin);
    saveLegalDays(legal);
    saveCompDays(comp);
    saveAbsences(absences);
}

async function aplicarDiurnoDesde(fecha) {
    if (!getCurrentProfile()) return;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();

    const year = fecha.getFullYear();
    const holidays = await fetchHolidays(year);

    let day = new Date(fecha);

    while (day.getFullYear() === year) {
        const key = keyFromDate(day);

        delete data[key];
        delete baseData[key];
        delete blocked[key];

        if (isBusinessDay(day, holidays)) {
            data[key] = 4;
            baseData[key] = 4;
            blocked[key] = true;
        }

        day.setDate(day.getDate() + 1);
    }

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);
    refreshAll();
}

function aplicarCuartoTurnoDesde(fecha) {
    if (!getCurrentProfile()) return;

    const data = getProfileData();
    const baseData = getBaseProfileData();
    const blocked = getBlockedDays();

    let day = new Date(fecha);
    const year = day.getFullYear();

    while (day.getFullYear() === year) {
        for (let i = 0; i < 4; i++) {
            const key = keyFromDate(day);

            delete data[key];
            delete baseData[key];
            delete blocked[key];

            if (i === 0) {
                data[key] = 1;
                baseData[key] = 1;
                blocked[key] = true;
            }

            if (i === 1) {
                data[key] = 2;
                baseData[key] = 2;
                blocked[key] = true;
            }

            day.setDate(day.getDate() + 1);
        }
    }

    saveProfileData(data);
    saveBaseProfileData(baseData);
    saveBlockedDays(blocked);
    refreshAll();
}

async function applyDraftRotation(rotationType, rotationStart) {
    const startDate = parseInputDate(rotationStart);

    await cleanupFutureSchedule(startDate);

    if (rotationType === "diurno") {
        await aplicarDiurnoDesde(startDate);
        return;
    }

    aplicarCuartoTurnoDesde(startDate);
}

async function guardarPerfil() {
    if (!validateDraft()) return;

    const nextName = profileDraft.name.trim();
    const nextEstamento = profileDraft.estamento;
    const nextShiftAssigned =
        Boolean(profileDraft.shiftAssigned);
    const nextValorHora =
        sanitizeValorHora(profileDraft.valorHora);
    const nextRotationType =
        profileDraft.rotationType;
    const nextRotationStart =
        profileDraft.rotationStart;
    const shouldApplyRotation =
        profileDraft.mode === PROFILE_MODE.CREATE ||
        hasRotationChanged();

    try {
        if (profileDraft.mode === PROFILE_MODE.CREATE) {
            const profiles = getProfiles();

            if (
                profiles.some(
                    profile => profile.name === nextName
                )
            ) {
                alert("Ese perfil ya existe.");
                return;
            }

            profiles.push({
                name: nextName,
                estamento: nextEstamento
            });

            saveProfiles(profiles);
            setCurrentProfile(nextName);
        }

        if (profileDraft.mode === PROFILE_MODE.EDIT) {
            updateProfile(
                profileDraft.originalName,
                {
                    name: nextName,
                    estamento: nextEstamento
                }
            );

            setCurrentProfile(nextName);
        }

        setShiftAssigned(nextShiftAssigned);
        setValorHora(nextValorHora);
        saveRotativa({
            type: nextRotationType,
            start: nextRotationStart
        });

        exitProfileMode(nextName);
        if (shouldApplyRotation) {
            await applyDraftRotation(
                nextRotationType,
                nextRotationStart
            );
        }
        refreshAll();
    } catch (error) {
        alert(
            error.message ||
            "No se pudo guardar el colaborador."
        );
    }
}

function handleAvailabilityEdit() {
    const profile = getPerfilActual();

    if (!profile) return;

    if (!availabilityEditMode) {
        availabilityEditMode = true;
        renderDisponibilidadVacaciones();
        document
            .getElementById("availabilityLegalInput")
            ?.focus();
        return;
    }

    const year = new Date().getFullYear();

    saveManualLeaveBalances(year, {
        legal: normalizeBalanceValue(
            document.getElementById("availabilityLegalInput")?.value
        ),
        comp: normalizeBalanceValue(
            document.getElementById("availabilityCompInput")?.value
        ),
        admin: normalizeBalanceValue(
            document.getElementById("availabilityAdminInput")?.value
        )
    }, profile.name);

    availabilityEditMode = false;
    refreshAll();
}

async function activarSelectorLegal() {
    const year = new Date().getFullYear();
    const holidays = await fetchHolidays(year);
    const saldo = getLeaveBalances(year, holidays).legal;

    if (saldo <= 0) {
        alert("No quedan dias de feriado legal.");
        return;
    }

    const cantidad = Number(
        prompt(
            `Cuantos dias deseas cargar? Disponibles: ${saldo}`
        )
    );

    if (!cantidad || cantidad <= 0) return;

    const validacion =
        await validarCantidadLegalAnual(cantidad, year);

    if (!validacion.ok) {
        alert(validacion.message);
        return;
    }

    legalCantidad = cantidad;

    activarModo(
        "legal",
        "Selecciona un dia habil para iniciar el feriado legal. Los dias inhabiles y ausencias incompatibles quedaran bloqueados."
    );
}

function activarSelectorComp() {
    const saldo = getLeaveBalances().comp;
    const cantidad = Number(saldo);

    if (saldo <= 0) {
        alert("No quedan feriados compensatorios disponibles.");
        return;
    }

    if (!Number.isInteger(cantidad)) {
        alert("El saldo de F. Compensatorio debe ser un numero entero para aplicar el bloque completo.");
        return;
    }

    if (!getShiftAssigned()) {
        alert("Solo disponible con asignacion de turno activa.");
        return;
    }

    compCantidad = cantidad;
    window.compCantidad = cantidad;

    activarModo(
        "comp",
        `Selecciona un dia habil para iniciar el bloque completo de ${formatSaldo(cantidad)} F. Compensatorio. Deben haber pasado 90 dias corridos desde el ultimo F. Legal.`
    );
}

function getLicenseTypeLabel(type) {
    if (type === "professional_license") return "LM Profesional";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    return "Licencia Medica";
}

function activarSelectorLicencia(type = "license") {
    const cantidad = Number(
        prompt(`Cuantos dias dura ${getLicenseTypeLabel(type)}?`)
    );

    if (!cantidad || cantidad <= 0) return;

    licenseCantidad = cantidad;
    licenseType = type;
    window.licenseCantidad = cantidad;
    window.licenseType = type;

    activarModo(
        "license",
        `Selecciona el inicio de ${getLicenseTypeLabel(type)}. Se contara en dias corridos.`
    );
}

function activarSelectorAdmin() {
    const saldo = getLeaveBalances().admin;

    if (saldo <= 0) {
        alert("Ya se utilizaron los 6 permisos administrativos.");
        return;
    }

    if (saldo < 1) {
        alert(
            `Saldo insuficiente. El saldo disponible (${formatSaldo(saldo)}) solo permite aplicar 1/2 ADM Manana o 1/2 ADM Tarde.`
        );
        return;
    }

    adminCantidad = 1;

    activarModo(
        "admin",
        getShiftAssigned()
            ? "Selecciona un turno Larga o Noche valido para el permiso administrativo."
            : "Selecciona un turno Larga o Noche en dia habil para el permiso administrativo."
    );
}

function activarSelectorHalfAdmin(tipo) {
    if (getLeaveBalances().admin <= 0) {
        alert("No quedan permisos administrativos disponibles.");
        return;
    }

    window.halfAdminTipo = tipo;

    activarModo(
        "halfadmin",
        tipo === "M"
            ? "Selecciona el medio dia administrativo de manana"
            : "Selecciona el medio dia administrativo de tarde"
    );
}

function applyTheme(theme) {
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(`theme-${theme}`);
    DOM.themeToggle.setAttribute(
        "aria-pressed",
        theme === "dark" ? "true" : "false"
    );
}

function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const prefersLight =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: light)").matches;

    const initialTheme =
        savedTheme || (prefersLight ? "light" : "dark");

    applyTheme(initialTheme);

    DOM.themeToggle.onclick = () => {
        const nextTheme =
            document.body.classList.contains("theme-dark")
                ? "light"
                : "dark";

        localStorage.setItem(THEME_KEY, nextTheme);
        applyTheme(nextTheme);
    };
}

function bindProfileForm() {
    DOM.profileNameInput.oninput = () => {
        if (!isProfileEditing()) return;
        profileDraft.name = DOM.profileNameInput.value;
    };

    DOM.profileRoleSelect.onchange = () => {
        if (!isProfileEditing()) return;
        profileDraft.estamento =
            DOM.profileRoleSelect.value;
    };

    DOM.profileRotationSelect.onchange =
        handleRotationSelectionChange;

    DOM.checkbox.onchange = () => {
        if (isProfileEditing()) {
            profileDraft.shiftAssigned =
                DOM.checkbox.checked;
            renderBotones();
            return;
        }

        if (!getCurrentProfile()) return;

        setShiftAssigned(DOM.checkbox.checked);
        renderBotones();
        refreshAll();
    };

    DOM.valorHoraInput.oninput = () => {
        const sanitized = sanitizeValorHora(
            DOM.valorHoraInput.value
        );

        DOM.valorHoraInput.value = sanitized;

        if (isProfileEditing()) {
            profileDraft.valorHora = sanitized;
            return;
        }

        if (!getCurrentProfile()) return;

        setValorHora(sanitized);
        refreshAll();
    };

    DOM.openCreateProfileBtn.onclick = async () => {
        if (profileDraft.mode === PROFILE_MODE.CREATE) {
            await guardarPerfil();
            return;
        }

        startCreateMode();
    };

    DOM.openEditProfileBtn.onclick = async () => {
        if (profileDraft.mode === PROFILE_MODE.EDIT) {
            await guardarPerfil();
            return;
        }

        startEditMode();
    };

    if (DOM.availabilityEditBtn) {
        DOM.availabilityEditBtn.onclick = handleAvailabilityEdit;
    }
}

function bindShellInteractions() {
    DOM.filterRole.onchange = renderProfiles;
    DOM.profileSearch.oninput = renderProfiles;

    document
        .querySelectorAll(".nav-tile[data-target]")
        .forEach(button => {
            button.onclick = () => {
                const target = document.getElementById(
                    button.dataset.target
                );

                if (!target) return;

                setActiveShortcut(button.dataset.target);
                target.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            };
        });

    document
        .querySelectorAll("[data-editor-mode]")
        .forEach(button => {
            button.onclick = () => startEditMode();
        });
}

DOM.adminBtn.onclick = activarSelectorAdmin;
DOM.halfAdminMorningBtn.onclick =
    () => activarSelectorHalfAdmin("M");
DOM.halfAdminAfternoonBtn.onclick =
    () => activarSelectorHalfAdmin("T");
DOM.legalBtn.onclick = activarSelectorLegal;
DOM.compBtn.onclick = activarSelectorComp;
DOM.licenseBtn.onclick = () => activarSelectorLicencia("license");
DOM.professionalLicenseBtn.onclick =
    () => activarSelectorLicencia("professional_license");
DOM.unpaidLeaveBtn.onclick =
    () => activarSelectorLicencia("unpaid_leave");

DOM.prevBtn.onclick = prevMonth;
DOM.nextBtn.onclick = nextMonth;

DOM.undoBtn.onclick = () => {
    if (undo()) {
        refreshAll();
    }
};

DOM.redoBtn.onclick = () => {
    if (redo()) {
        refreshAll();
    }
};

document.addEventListener("click", async event => {
    const celda = event.target.closest(".day");
    if (!celda) return;

    if (
        selectionMode &&
        celda.classList.contains("mpa-disabled")
    ) {
        return;
    }

    const fecha = new Date(
        Number(celda.dataset.year),
        Number(celda.dataset.month),
        Number(celda.dataset.day)
    );

    if (selectionMode === "license") {
        pushHistory();
        const aplicado = await aplicarLicencia(
            fecha,
            licenseCantidad,
            licenseType
        );

        if (!aplicado) {
            alert(
                "No se pudo aplicar esta ausencia. Una Licencia Medica solo puede reemplazarse por una LM Profesional y viceversa; el Permiso sin Goce no puede superponerse sobre licencias existentes."
            );
        }

        clearSelectionMode();
        return;
    }

    if (selectionMode === "comp") {
        pushHistory();
        const aplicado = await aplicarComp(fecha, compCantidad);

        if (aplicado) {
            decrementManualBalance(
                "comp",
                compCantidad,
                fecha.getFullYear()
            );
        } else {
            alert(
                "No se pudo aplicar el F. Compensatorio. Debe iniciar en un dia habil, haber pasado 90 dias corridos desde el ultimo F. Legal y el bloque completo no puede cruzarse con licencias, feriados legales, permisos administrativos, medios ADM, permisos sin goce u otros bloqueos incompatibles."
            );
        }

        clearSelectionMode();
        return;
    }

    if (selectionMode === "legal") {
        pushHistory();
        const aplicado =
            await aplicarLegal(fecha, legalCantidad);

        if (!aplicado) {
            alert(
                "No se pudo aplicar el F. Legal en esa fecha. Revisa que el inicio sea habil, que hayan pasado 90 dias desde el ultimo F. Compensatorio y que el rango no tenga ausencias incompatibles."
            );
        } else {
            decrementManualBalance(
                "legal",
                legalCantidad,
                fecha.getFullYear()
            );
        }

        clearSelectionMode();
        return;
    }

    if (selectionMode === "halfadmin") {
        pushHistory();
        const aplicado = await aplicarHalfAdministrativo(
            fecha,
            window.halfAdminTipo || "M"
        );

        if (aplicado) {
            decrementManualBalance(
                "admin",
                0.5,
                fecha.getFullYear()
            );
        }

        clearSelectionMode();
        return;
    }

    if (selectionMode === "admin") {
        pushHistory();
        const aplicado =
            await aplicarAdministrativo(fecha, adminCantidad);

        if (aplicado) {
            decrementManualBalance(
                "admin",
                adminCantidad,
                fecha.getFullYear()
            );
        }

        clearSelectionMode();
        return;
    }

});

initTheme();
bindProfileForm();
bindShellInteractions();
renderStaffingPanel();
renderSwapPanel();
renderProfiles();
renderBotones();

if (getProfiles().length > 0) {
    setActiveShortcut("calendarPanel");
    refreshAll();
} else {
    setActiveShortcut("profileSection");
    renderDashboardState();
    refreshAll();
}
