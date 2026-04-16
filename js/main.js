import { renderCalendar, prevMonth, nextMonth } from "./calendar.js";
import {
    getProfiles,
    saveProfiles,
    setCurrentProfile,
    getCurrentProfile,
    getShiftAssigned,
    setShiftAssigned
} from "./storage.js";

const profilesDiv = document.getElementById("profiles");
const newProfileInput = document.getElementById("newProfile");
const createBtn = document.getElementById("createProfile");
const checkbox = document.getElementById("shiftAssigned");

const valorHoraInput = document.getElementById("valorHora");

valorHoraInput.value = localStorage.getItem("valorHora") || "";

valorHoraInput.oninput = ()=>{
    let v = Number(valorHoraInput.value);

    if(v < 0) v = 0;

    valorHoraInput.value = v;
    localStorage.setItem("valorHora", v);

    renderCalendar();
};

function renderProfiles(){
    const profiles = getProfiles();
    const current = getCurrentProfile();

    profilesDiv.innerHTML = "";

    profiles.forEach(p=>{
        const div = document.createElement("div");
        div.innerText = p;

        if(p===current) div.classList.add("active");

        div.onclick = ()=>{
            setCurrentProfile(p);
            checkbox.checked = getShiftAssigned();
            renderProfiles();
            renderCalendar();
        };

        profilesDiv.appendChild(div);
    });
}

createBtn.onclick = ()=>{
    const name = newProfileInput.value.trim();
    if(!name) return;

    const profiles = getProfiles();
    if(profiles.includes(name)) return alert("Ya existe");

    profiles.push(name);
    saveProfiles(profiles);

    newProfileInput.value = "";
    renderProfiles();
};

checkbox.onchange = ()=>{
    setShiftAssigned(checkbox.checked);
};

// INIT
renderProfiles();

if(getProfiles().length){
    setCurrentProfile(getProfiles()[0]);
    checkbox.checked = getShiftAssigned();
    renderCalendar();
}

document.getElementById("prevBtn").onclick = prevMonth;
document.getElementById("nextBtn").onclick = nextMonth;