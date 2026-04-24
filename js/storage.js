let currentProfile = null;

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

    return "";
}

function moveStorageKey(oldKey, newKey){
    const value = localStorage.getItem(oldKey);
    if (value === null) return;

    localStorage.setItem(newKey, value);
    localStorage.removeItem(oldKey);
}

export function getProfiles(){
    const raw =
        JSON.parse(localStorage.getItem("profiles")) || [];

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

export function getSwaps(){
    return JSON.parse(localStorage.getItem("swaps")) || [];
}

export function saveSwaps(data){
    localStorage.setItem("swaps", JSON.stringify(data));
}

export function saveProfiles(profiles){
    const normalized = (profiles || []).map(profile => ({
        ...profile,
        estamento: normalizeEstamento(profile.estamento)
    }));

    localStorage.setItem("profiles", JSON.stringify(normalized));
}

export function setCurrentProfile(profile){
    currentProfile = profile || null;
}

export function getCurrentProfile(){
    return currentProfile;
}

export function getProfileData(profile = currentProfile){
    return JSON.parse(
        localStorage.getItem("data_" + profile)
    ) || {};
}

export function saveProfileData(data){
    localStorage.setItem(
        "data_" + currentProfile,
        JSON.stringify(data)
    );
}

export function getBaseProfileData(profile = currentProfile){
    return JSON.parse(
        localStorage.getItem("baseData_" + profile)
    ) || {};
}

export function saveBaseProfileData(data, profile = currentProfile){
    localStorage.setItem(
        "baseData_" + profile,
        JSON.stringify(data)
    );
}

export function getBlockedDays(){
    return JSON.parse(
        localStorage.getItem("blocked_" + currentProfile)
    ) || {};
}

export function saveBlockedDays(data){
    localStorage.setItem(
        "blocked_" + currentProfile,
        JSON.stringify(data)
    );
}

export function getShiftAssigned(profile = currentProfile){
    return JSON.parse(
        localStorage.getItem("shift_" + profile)
    ) || false;
}

export function setShiftAssigned(value, profile = currentProfile){
    localStorage.setItem(
        "shift_" + profile,
        JSON.stringify(Boolean(value))
    );
}

export function getValorHora(profile = currentProfile){
    const ownValue = localStorage.getItem(
        "valorHora_" + profile
    );

    if (ownValue !== null) {
        return Number(ownValue) || 0;
    }

    return Number(localStorage.getItem("valorHora")) || 0;
}

export function setValorHora(value, profile = currentProfile){
    const normalized = Math.max(0, Number(value) || 0);

    localStorage.setItem(
        "valorHora_" + profile,
        String(normalized)
    );
}

export function getCarryKey(y, m){
    return `carry_${currentProfile}_${y}_${m}`;
}

export function saveCarry(y, m, data){
    localStorage.setItem(
        getCarryKey(y, m),
        JSON.stringify(data)
    );
}

export function getCarry(y, m){
    return JSON.parse(
        localStorage.getItem(getCarryKey(y, m))
    ) || { d: 0, n: 0 };
}

export function getAdminDays(){
    return JSON.parse(
        localStorage.getItem("admin_" + currentProfile)
    ) || {};
}

export function saveAdminDays(data){
    localStorage.setItem(
        "admin_" + currentProfile,
        JSON.stringify(data)
    );
}

export function getLegalDays(){
    return JSON.parse(
        localStorage.getItem("legal_" + currentProfile)
    ) || {};
}

export function saveLegalDays(data){
    localStorage.setItem(
        "legal_" + currentProfile,
        JSON.stringify(data)
    );
}

export function getCompDays(){
    return JSON.parse(
        localStorage.getItem("comp_" + currentProfile)
    ) || {};
}

export function saveCompDays(data){
    localStorage.setItem(
        "comp_" + currentProfile,
        JSON.stringify(data)
    );
}

export function getManualLeaveBalances(
    year = new Date().getFullYear(),
    profile = currentProfile
) {
    if (!profile) return {};

    const allBalances = JSON.parse(
        localStorage.getItem("leaveBalances_" + profile)
    ) || {};

    return allBalances[String(year)] || {};
}

export function saveManualLeaveBalances(
    year = new Date().getFullYear(),
    balances = {},
    profile = currentProfile
) {
    if (!profile) return;

    const allBalances = JSON.parse(
        localStorage.getItem("leaveBalances_" + profile)
    ) || {};
    const currentYearBalances =
        allBalances[String(year)] || {};
    const nextBalances = {
        ...currentYearBalances,
        ...balances
    };

    allBalances[String(year)] = {
        legal: Math.max(0, Number(nextBalances.legal) || 0),
        comp: Math.max(0, Number(nextBalances.comp) || 0),
        admin: Math.max(0, Number(nextBalances.admin) || 0)
    };

    localStorage.setItem(
        "leaveBalances_" + profile,
        JSON.stringify(allBalances)
    );
}

export function getAbsences(){
    return JSON.parse(
        localStorage.getItem("absences_" + currentProfile)
    ) || {};
}

export function saveAbsences(data){
    localStorage.setItem(
        "absences_" + currentProfile,
        JSON.stringify(data)
    );
}

export function getRotativa(profile = currentProfile){
    const raw = localStorage.getItem(
        "rotativa_" + profile
    );

    if (!raw) {
        return {
            type: "",
            start: ""
        };
    }

    try {
        const parsed = JSON.parse(raw);

        if (typeof parsed === "string") {
            return {
                type: "4turno",
                start: parsed
            };
        }

        if (parsed && typeof parsed === "object") {
            return {
                type: normalizeRotativaType(parsed.type),
                start: String(parsed.start || "")
            };
        }
    } catch {
        return {
            type: "4turno",
            start: raw
        };
    }

    return {
        type: "",
        start: ""
    };
}

export function saveRotativa(rotativa, profile = currentProfile){
    const type = normalizeRotativaType(rotativa?.type);
    const start = String(rotativa?.start || "");

    if (!type) {
        localStorage.removeItem("rotativa_" + profile);
        return;
    }

    localStorage.setItem(
        "rotativa_" + profile,
        JSON.stringify({ type, start })
    );
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

    const updatedProfiles = profiles.map(profile =>
        profile.name === oldName
            ? {
                name: targetName,
                estamento: normalizeEstamento(
                    nextProfile.estamento
                )
            }
            : profile
    );

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
        "valorHora_",
        "leaveBalances_"
    ];

    keysToMove.forEach(prefix => {
        moveStorageKey(
            `${prefix}${oldName}`,
            `${prefix}${targetName}`
        );
    });

    const carryPrefix = `carry_${oldName}_`;
    const carryKeys = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(carryPrefix)) {
            carryKeys.push(key);
        }
    }

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

    if (currentProfile === oldName) {
        currentProfile = targetName;
    }
}
