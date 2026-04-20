let currentProfile = null;

export function getProfiles(){
    const raw =
        JSON.parse(localStorage.getItem("profiles")) || [];

    return raw.map(p => {

        if(typeof p === "string"){
            return {
                name:p,
                estamento:"Profesional"
            };
        }

        return p;
    });
}

export function getSwaps(){
    return JSON.parse(localStorage.getItem("swaps")) || [];
}

export function saveSwaps(d){
    localStorage.setItem("swaps", JSON.stringify(d));
}

export function saveProfiles(p){
    localStorage.setItem("profiles", JSON.stringify(p));
}

export function setCurrentProfile(p){
    currentProfile = p;
}

export function getCurrentProfile(){
    return currentProfile;
}

export function getProfileData(profile = currentProfile){
    return JSON.parse(
        localStorage.getItem("data_" + profile)
    ) || {};
}

export function saveProfileData(d){
    localStorage.setItem("data_"+currentProfile, JSON.stringify(d));
}

// 🔥 NUEVO: días bloqueados (no cuentan como HHEE)
export function getBlockedDays(){
    return JSON.parse(localStorage.getItem("blocked_"+currentProfile)) || {};
}

export function saveBlockedDays(d){
    localStorage.setItem("blocked_"+currentProfile, JSON.stringify(d));
}

export function getShiftAssigned(){
    return JSON.parse(localStorage.getItem("shift_"+currentProfile)) || false;
}

export function setShiftAssigned(v){
    localStorage.setItem("shift_"+currentProfile, JSON.stringify(v));
}

export function getCarryKey(y,m){
    return `carry_${currentProfile}_${y}_${m}`;
}

export function saveCarry(y,m,data){
    localStorage.setItem(getCarryKey(y,m), JSON.stringify(data));
}

export function getCarry(y,m){
    return JSON.parse(localStorage.getItem(getCarryKey(y,m))) || {d:0,n:0};
}

export function getAdminDays(){
    return JSON.parse(localStorage.getItem("admin_"+currentProfile)) || {};
}

export function saveAdminDays(d){
    localStorage.setItem("admin_"+currentProfile, JSON.stringify(d));
}

export function getLegalDays(){
    return JSON.parse(localStorage.getItem("legal_"+currentProfile)) || {};
}

export function getCompDays(){
    return JSON.parse(
        localStorage.getItem("comp_"+currentProfile)
    ) || {};
}

export function saveCompDays(d){
    localStorage.setItem(
        "comp_"+currentProfile,
        JSON.stringify(d)
    );
}

export function saveLegalDays(d){
    localStorage.setItem("legal_"+currentProfile, JSON.stringify(d));
}


export function getAbsences(){
    return JSON.parse(
        localStorage.getItem("absences_"+currentProfile)
    ) || {};
}

export function saveAbsences(d){
    localStorage.setItem(
        "absences_"+currentProfile,
        JSON.stringify(d)
    );
}


