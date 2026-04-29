import {
    getRaw,
    setRaw,
    removeKey,
    getJSON,
    setJSON,
    getNumber,
    listKeys,
    moveKey
} from "./persistence.js";

let currentProfile = null;

export const DEFAULT_GRADE_HOUR_CONFIG = {
    professional: {
        10: 9378.56,
        11: 8605.85,
        12: 7897.38,
        13: 7272.24,
        14: 6663.65,
        15: 6107.22
    },
    general: {
        12: 4420.99,
        13: 4205.87,
        14: 4002.53,
        15: 3784.87,
        16: 3550.55,
        17: 3392.09,
        18: 3230.79,
        19: 3085.6,
        20: 2902.88,
        21: 2751.67,
        22: 2550.45,
        23: 2330.32,
        24: 2148.73
    }
};

function normalizeRateMap(map = {}, fallback = {}) {
    return Object.keys(fallback).reduce((acc, grade) => {
        const value = Number(map[grade]);
        acc[grade] = Number.isFinite(value) && value > 0
            ? value
            : fallback[grade];
        return acc;
    }, {});
}

function normalizeGradeHourConfig(config = {}) {
    return {
        professional: normalizeRateMap(
            config.professional,
            DEFAULT_GRADE_HOUR_CONFIG.professional
        ),
        general: normalizeRateMap(
            config.general,
            DEFAULT_GRADE_HOUR_CONFIG.general
        )
    };
}

function gradeHourGroup(estamento) {
    return normalizeEstamento(estamento) === "Profesional"
        ? "professional"
        : "general";
}

export function getGradeHourConfig() {
    return normalizeGradeHourConfig(
        getJSON("gradeHourConfig", DEFAULT_GRADE_HOUR_CONFIG)
    );
}

export function saveGradeHourConfig(config) {
    setJSON(
        "gradeHourConfig",
        normalizeGradeHourConfig(config)
    );
}

export function getGradeHourValue(estamento, grade) {
    const group = gradeHourGroup(estamento);
    const config = getGradeHourConfig();

    return Number(config[group]?.[String(grade)] || 0);
}

function normalizeEstamento(value){
    const source = String(value || "").trim();

    if (!source) return "Profesional";

    const normalized = source
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    if (normalized === "tecnico") return "T\u00e9cnico";
    if (normalized === "administrativo") return "Administrativo";
    if (normalized === "auxiliar") return "Auxiliar";

    return "Profesional";
}

function normalizeRotativaType(value){
    const source = String(value || "").trim();
    const normalized = source
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    if (
        normalized === "3turno" ||
        normalized === "3 turno" ||
        normalized === "3er turno" ||
        normalized === "tercer turno"
    ) {
        return "3turno";
    }

    if (
        normalized === "4turno" ||
        normalized === "4 turno" ||
        normalized === "4oturno" ||
        normalized === "cuarto turno"
    ) {
        return "4turno";
    }

    if (normalized === "diurno") {
        return "diurno";
    }

    if (
        normalized === "reemplazo" ||
        normalized === "replacement"
    ) {
        return "reemplazo";
    }

    return "";
}

function normalizeRotationFirstTurn(value) {
    const normalized = String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    return normalized === "noche"
        ? "noche"
        : "larga";
}

function moveStorageKey(oldKey, newKey){
    moveKey(oldKey, newKey);
}

export function getProfiles(){
    const raw = getJSON("profiles", []);

    return raw.map(profile => {
        if (typeof profile === "string") {
            return {
                name: profile,
                estamento: "Profesional"
            };
        }

        return {
            ...profile,
            estamento: normalizeEstamento(profile.estamento)
        };
    });
}

export function isProfileActive(profileOrName){
    const profile = typeof profileOrName === "string"
        ? getProfiles().find(item =>
            item.name === profileOrName
        )
        : profileOrName;

    if (!profile) return false;

    return profile.active !== false;
}

export function getSwaps(){
    return getJSON("swaps", []);
}

export function saveSwaps(data){
    setJSON("swaps", data);
}

export function getReplacements(){
    return getJSON("replacements", []);
}

export function saveReplacements(data){
    setJSON("replacements", data);
}

export function getReplacementContracts(profile = currentProfile){
    if (!profile) return [];

    return getJSON("replacementContracts_" + profile, []);
}

export function saveReplacementContracts(
    contracts,
    profile = currentProfile
){
    if (!profile) return;

    setJSON(
        "replacementContracts_" + profile,
        Array.isArray(contracts) ? contracts : []
    );
}

export function saveProfiles(profiles){
    const normalized = (profiles || []).map(profile => ({
        ...profile,
        estamento: normalizeEstamento(profile.estamento)
    }));

    setJSON("profiles", normalized);
}

export function setCurrentProfile(profile){
    currentProfile = profile || null;
}

export function getCurrentProfile(){
    return currentProfile;
}

export function getProfileData(profile = currentProfile){
    return getJSON("data_" + profile, {});
}

export function saveProfileData(data, profile = currentProfile){
    setJSON("data_" + profile, data);
}

export function getBaseProfileData(profile = currentProfile){
    return getJSON("baseData_" + profile, {});
}

export function saveBaseProfileData(data, profile = currentProfile){
    setJSON("baseData_" + profile, data);
}

export function getBlockedDays(profile = currentProfile){
    return getJSON("blocked_" + profile, {});
}

export function saveBlockedDays(data, profile = currentProfile){
    setJSON("blocked_" + profile, data);
}

export function getShiftAssigned(profile = currentProfile){
    return getJSON("shift_" + profile, false);
}

export function setShiftAssigned(value, profile = currentProfile){
    setJSON("shift_" + profile, Boolean(value));
}

export function getValorHora(profile = currentProfile){
    const profileData = getProfiles().find(item =>
        item.name === profile
    );
    const configuredValue = profileData
        ? getGradeHourValue(
            profileData.estamento,
            profileData.grade
        )
        : 0;

    if (configuredValue > 0) {
        return configuredValue;
    }

    return 0;
}

export function getCarryKey(y, m){
    return `carry_${currentProfile}_${y}_${m}`;
}

export function saveCarry(y, m, data){
    setJSON(getCarryKey(y, m), data);
}

export function getCarry(y, m){
    return getJSON(getCarryKey(y, m), { d: 0, n: 0 });
}

export function getAdminDays(){
    return getJSON("admin_" + currentProfile, {});
}

export function saveAdminDays(data){
    setJSON("admin_" + currentProfile, data);
}

export function getLegalDays(){
    return getJSON("legal_" + currentProfile, {});
}

export function saveLegalDays(data){
    setJSON("legal_" + currentProfile, data);
}

export function getCompDays(){
    return getJSON("comp_" + currentProfile, {});
}

export function saveCompDays(data){
    setJSON("comp_" + currentProfile, data);
}

export function getManualLeaveBalances(
    year = new Date().getFullYear(),
    profile = currentProfile
) {
    if (!profile) return {};

    const allBalances = getJSON(
        "leaveBalances_" + profile,
        {}
    );

    return allBalances[String(year)] || {};
}

export function saveManualLeaveBalances(
    year = new Date().getFullYear(),
    balances = {},
    profile = currentProfile
) {
    if (!profile) return;

    const allBalances = getJSON(
        "leaveBalances_" + profile,
        {}
    );
    const currentYearBalances =
        allBalances[String(year)] || {};
    const nextBalances = {
        ...currentYearBalances
    };

    ["legal", "comp", "admin"].forEach(field => {
        if (
            !Object.prototype.hasOwnProperty.call(
                balances,
                field
            )
        ) {
            return;
        }

        nextBalances[field] = Math.max(
            0,
            Number(balances[field]) || 0
        );
    });

    allBalances[String(year)] = nextBalances;

    setJSON("leaveBalances_" + profile, allBalances);
}

export function getAbsences(){
    return getJSON("absences_" + currentProfile, {});
}

export function saveAbsences(data){
    setJSON("absences_" + currentProfile, data);
}

export function getRotativa(profile = currentProfile){
    const raw = getRaw("rotativa_" + profile, null);

    if (!raw) {
        return {
            type: "",
            start: "",
            firstTurn: "larga"
        };
    }

    try {
        const parsed = JSON.parse(raw);

        if (typeof parsed === "string") {
            return {
                type: "4turno",
                start: parsed,
                firstTurn: "larga"
            };
        }

        if (parsed && typeof parsed === "object") {
            return {
                type: normalizeRotativaType(parsed.type),
                start: String(parsed.start || ""),
                firstTurn: normalizeRotationFirstTurn(parsed.firstTurn)
            };
        }
    } catch {
        return {
            type: "4turno",
            start: raw,
            firstTurn: "larga"
        };
    }

    return {
        type: "",
        start: "",
        firstTurn: "larga"
    };
}

export function saveRotativa(rotativa, profile = currentProfile){
    const type = normalizeRotativaType(rotativa?.type);
    const start = String(rotativa?.start || "");
    const firstTurn = normalizeRotationFirstTurn(rotativa?.firstTurn);

    if (!type) {
        removeKey("rotativa_" + profile);
        return;
    }

    setJSON("rotativa_" + profile, { type, start, firstTurn });
}

export function updateProfile(oldName, nextProfile){
    const profiles = getProfiles();
    const targetName = String(
        nextProfile?.name || ""
    ).trim();

    if (!targetName) {
        throw new Error(
            "El nombre del colaborador es obligatorio."
        );
    }

    if (
        profiles.some(
            profile =>
                profile.name !== oldName &&
                profile.name === targetName
        )
    ) {
        throw new Error("Ese perfil ya existe.");
    }

    const updatedProfiles = profiles.map(profile => {
        if (profile.name !== oldName) {
            return profile;
        }

        return {
            ...profile,
            ...nextProfile,
            name: targetName,
            estamento: normalizeEstamento(
                nextProfile.estamento ?? profile.estamento
            )
        };
    });

    saveProfiles(updatedProfiles);

    if (oldName === targetName) {
        if (currentProfile === oldName) {
            currentProfile = targetName;
        }
        return;
    }

    const keysToMove = [
        "data_",
        "blocked_",
        "baseData_",
        "shift_",
        "admin_",
        "legal_",
        "comp_",
        "absences_",
        "rotativa_",
        "leaveBalances_",
        "replacementContracts_",
        "clockMarks_",
        "hrLogs_"
    ];

    keysToMove.forEach(prefix => {
        moveStorageKey(
            `${prefix}${oldName}`,
            `${prefix}${targetName}`
        );
    });

    const carryPrefix = `carry_${oldName}_`;
    const carryKeys = listKeys(carryPrefix);

    carryKeys.forEach(key => {
        moveStorageKey(
            key,
            key.replace(
                carryPrefix,
                `carry_${targetName}_`
            )
        );
    });

    const swaps = getSwaps().map(swap => ({
        ...swap,
        from: swap.from === oldName
            ? targetName
            : swap.from,
        to: swap.to === oldName
            ? targetName
            : swap.to
    }));

    saveSwaps(swaps);

    const replacements = getReplacements().map(replacement => ({
        ...replacement,
        worker: replacement.worker === oldName
            ? targetName
            : replacement.worker,
        replaced: replacement.replaced === oldName
            ? targetName
            : replacement.replaced
    }));

    saveReplacements(replacements);

    if (currentProfile === oldName) {
        currentProfile = targetName;
    }
}
