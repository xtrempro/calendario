let currentProfile = null;

export function getProfiles(){
    return JSON.parse(localStorage.getItem("profiles")) || [];
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

export function getProfileData(){
    return JSON.parse(localStorage.getItem("data_"+currentProfile)) || {};
}

export function saveProfileData(d){
    localStorage.setItem("data_"+currentProfile, JSON.stringify(d));
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