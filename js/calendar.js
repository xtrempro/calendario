import { getProfileData, saveProfileData, getCarry, saveCarry } from "./storage.js";
import { fetchHolidays } from "./holidays.js";
import { getShiftAssigned } from "./storage.js";
import {
    calcHours,
    isBusinessDay,
    isWeekend,
    calcCarry
} from "./calculations.js";

let currentDate = new Date();

export async function renderCalendar(){
    const cal = document.getElementById("calendar");
    const summary = document.getElementById("summary");
    const monthYear = document.getElementById("monthYear");

    cal.innerHTML = "";

    const data = getProfileData();
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const h = await fetchHolidays(y);

    const carryIn = getCarry(y,m);

    monthYear.innerText =
        currentDate.toLocaleString("es-ES",{month:"long",year:"numeric"});

    let first = (new Date(y,m,1).getDay()+6)%7;
    let days = new Date(y,m+1,0).getDate();

    let totalD = carryIn.d;
    let totalN = carryIn.n;
    let businessDays = 0;

    for(let i=0;i<first;i++) cal.innerHTML += "<div></div>";

    for(let d=1; d<=days; d++){

        const key = `${y}-${m}-${d}`;
        const state = data[key] || 0;

        const div = document.createElement("div");
        div.classList.add("day");

        const date = new Date(y,m,d);
        const isH = h[key];
        const isW = isWeekend(date);
        const isHab = isBusinessDay(date,h);

        if(isHab) businessDays++;

        // 🔥 CLASES VISUALES RESTAURADAS
        if(isW) div.classList.add("weekend");
        if(isH) div.classList.add("holiday");
        if(state===1) div.classList.add("green");
        if(state===2) div.classList.add("blue");
        if(state===3) div.classList.add("purple");
        if(state===4) div.classList.add("lightgreen");
        if(state===5) div.classList.add("yellow");
        if((isW||isH)&&state>0) div.classList.add("inactive-selected");

        const hrs = calcHours(date,state,h);
        totalD += hrs.d;
        totalN += hrs.n;

        const label = ["","Larga","Noche","24","Diurno","D+N"][state];

        div.innerHTML = `${d}<br>${label}`;
        div.title = `Diurnas:${hrs.d} Nocturnas:${hrs.n}`;

        div.addEventListener("click", ()=>{
            let s = state;
            do{
                s++;
                if(s>5) s=0;
            }while((s===4||s===5)&&!isHab);

            data[key] = s;
            saveProfileData(data);
            renderCalendar();
        });

        cal.appendChild(div);
    }

    // 🔥 ARRÁSTRE RESTAURADO
    const lastKey = `${y}-${m}-${days}`;
    const lastState = data[lastKey] || 0;
    const lastDate = new Date(y,m,days);
    const carryOut = calcCarry(lastDate,lastState,h);

    const nextMonthDate = new Date(y,m+1,1);
    saveCarry(nextMonthDate.getFullYear(),nextMonthDate.getMonth(),carryOut);

    const horasHabiles = Math.round(businessDays * 8.8);

    

const shiftAssigned = getShiftAssigned();

// HHEE DIURNAS
let hheeDiurnas = horasHabiles - totalD;
if(hheeDiurnas < 0) hheeDiurnas = 0;

// HHEE NOCTURNAS
let hheeNocturnas = shiftAssigned ? 0 : totalN;

// VALOR HORA
const valorHora = Number(localStorage.getItem("valorHora")) || 0;

// PAGOS
const pagoDiurno = hheeDiurnas * 1.25 * valorHora;
const pagoNocturno = hheeNocturnas * 1.5 * valorHora;

summary.innerHTML = `
    <div>🌞 Diurnas: ${totalD}h</div>
    <div>🌙 Nocturnas: ${totalN}h</div>
    <div>📊 Horas hábiles: ${horasHabiles}h</div>

    <hr>

    <div>🟢 HHEE Diurnas: ${hheeDiurnas}h</div>
    <div>💰 Pago HHEE Diurnas: $${pagoDiurno.toFixed(0)}</div>

    <hr>

    <div>🌜 HHEE Nocturnas: ${hheeNocturnas}h</div>
    <div>💰 Pago HHEE Nocturnas: $${pagoNocturno.toFixed(0)}</div>
`;
}

export function prevMonth(){
    currentDate.setMonth(currentDate.getMonth()-1);
    renderCalendar();
}

export function nextMonth(){
    currentDate.setMonth(currentDate.getMonth()+1);
    renderCalendar();
}

