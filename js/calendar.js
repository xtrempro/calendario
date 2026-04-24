import {
    aplicarCambiosTurno,
    getTurnoBase,
    siguienteTurno
} from "./turnEngine.js";
import {
    calcularHorasMes,
    renderSummaryHTML,
    calcularCarryMes
} from "./hoursEngine.js";
import {
    getProfileData,
    saveProfileData,
    getCarry,
    saveCarry,
    getBlockedDays,
    getAdminDays,
    getLegalDays,
    getAbsences,
    getCompDays,
    getShiftAssigned,
    getCurrentProfile
} from "./storage.js";
import {
    tieneAusencia,
    obtenerLabelDia,
    aplicarClasesEspeciales,
    estaBloqueadoModo
} from "./rulesEngine.js";
import { fetchHolidays } from "./holidays.js";
import {
    calcHours,
    isBusinessDay,
    isWeekend
} from "./calculations.js";
import {
    turnoLabel,
    aplicarClaseTurno
} from "./uiEngine.js";
import { renderTimeline } from "./timeline.js";

export let currentDate = new Date();

function key(y, m, d) {
    return `${y}-${m}-${d}`;
}

function buildDayCell({
    day,
    month,
    year,
    keyDay,
    label,
    title,
    isWeekendDay,
    isHoliday,
    isDraftSelected
}) {
    const div = document.createElement("div");

    div.classList.add("day");
    div.dataset.day = day;
    div.dataset.month = month;
    div.dataset.year = year;

    if (isWeekendDay) {
        div.classList.add("weekend");
    }

    if (isHoliday) {
        div.classList.add("holiday");
    }

    if (isDraftSelected) {
        div.classList.add("draft-selected");
    }

    div.innerHTML = `
        <span class="day-number">${day}</span>
        <span class="day-label">${label || ""}</span>
    `;

    if (title) {
        div.title = title;
    }

    return div;
}

async function clickDia(
    keyDay,
    state,
    isHab,
    data,
    admin,
    legal,
    comp,
    absences
) {
    if (window.selectionMode === "halfadmin") return;
    if (window.selectionMode) return;

    if (
        tieneAusencia(
            keyDay,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        return;
    }

    const nuevo = siguienteTurno(state, isHab);

    if (typeof window.pushUndoState === "function") {
        window.pushUndoState(
            `Cambio ${keyDay}: ${turnoLabel(state)} -> ${turnoLabel(nuevo)}`
        );
    }

    data[keyDay] = nuevo;
    saveProfileData(data);

    await renderCalendar();
}

export async function renderCalendar() {
    const cal = document.getElementById("calendar");
    const summary = document.getElementById("summary");
    const monthYear = document.getElementById("monthYear");

    if (!cal) return;

    cal.replaceChildren();

    const activeProfile = getCurrentProfile();
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const holidays = await fetchHolidays(y);
    const first =
        (new Date(y, m, 1).getDay() + 6) % 7;
    const days =
        new Date(y, m + 1, 0).getDate();
    const draftKey =
        typeof window.getProfileDraftSelectionKey === "function"
            ? window.getProfileDraftSelectionKey()
            : "";

    if (monthYear) {
        monthYear.innerText = currentDate.toLocaleString(
            "es-CL",
            {
                month: "long",
                year: "numeric"
            }
        );
    }

    for (let i = 0; i < first; i++) {
        cal.innerHTML += "<div class=\"calendar-spacer\"></div>";
    }

    if (!activeProfile) {
        for (let d = 1; d <= days; d++) {
            const keyDay = key(y, m, d);
            const date = new Date(y, m, d);

            const div = buildDayCell({
                day: d,
                month: m,
                year: y,
                keyDay,
                label: "",
                title: "Selecciona una fecha para la nueva rotativa.",
                isWeekendDay: isWeekend(date),
                isHoliday: Boolean(holidays[keyDay]),
                isDraftSelected: draftKey === keyDay
            });

            cal.appendChild(div);
        }

        if (summary) {
            summary.innerHTML = `
                <div class="empty-state empty-state--compact">
                    Aun no hay horas extras para mostrar.
                </div>
            `;
        }

        renderTimeline();

        if (typeof window.renderDashboardState === "function") {
            window.renderDashboardState();
        }

        return;
    }

    const data = getProfileData();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const carryIn = getCarry(y, m);

    for (let d = 1; d <= days; d++) {
        const keyDay = key(y, m, d);

        let state = Number(data[keyDay]) || 0;

        state = aplicarCambiosTurno(
            activeProfile,
            keyDay,
            state
        );

        const date = new Date(y, m, d);
        const isWeekendDay = isWeekend(date);
        const isHoliday = holidays[keyDay];
        const isHab = isBusinessDay(date, holidays);

        const div = buildDayCell({
            day: d,
            month: m,
            year: y,
            keyDay,
            label: obtenerLabelDia(
                keyDay,
                state,
                admin,
                legal,
                comp,
                absences,
                turnoLabel
            ),
            title: (() => {
                const hrs = calcHours(date, state, holidays);
                return `Diurnas: ${hrs.d} | Nocturnas: ${hrs.n}`;
            })(),
            isWeekendDay,
            isHoliday: Boolean(isHoliday),
            isDraftSelected: draftKey === keyDay
        });

        aplicarClasesEspeciales(
            div,
            keyDay,
            state,
            isHab,
            isWeekendDay,
            isHoliday,
            admin,
            legal,
            comp,
            absences,
            aplicarClaseTurno
        );

        const bloqueado = estaBloqueadoModo(
            window.selectionMode,
            keyDay,
            window.selectionMode === "admin"
                ? getTurnoBase(activeProfile, keyDay)
                : state,
            isHab,
            admin,
            legal,
            comp,
            absences,
            getShiftAssigned(),
            {
                compCantidad: window.compCantidad || 0,
                licenseCantidad: window.licenseCantidad || 0,
                licenseType: window.licenseType || "license",
                holidays
            }
        );

        if (window.selectionMode) {
            div.classList.add(
                bloqueado
                    ? "mpa-disabled"
                    : "mpa-enabled"
            );
        }

        div.onclick = async () => {
            await clickDia(
                keyDay,
                state,
                isHab,
                data,
                admin,
                legal,
                comp,
                absences
            );
        };

        cal.appendChild(div);
    }

    const carryOut = calcularCarryMes(
        y,
        m,
        days,
        holidays,
        data
    );

    const next = new Date(y, m + 1, 1);

    saveCarry(
        next.getFullYear(),
        next.getMonth(),
        carryOut
    );

    const stats = calcularHorasMes(
        y,
        m,
        days,
        holidays,
        data,
        blocked,
        carryIn
    );

    if (summary) {
        summary.innerHTML = renderSummaryHTML(stats);
    }

    renderTimeline();

    if (typeof window.renderDashboardState === "function") {
        window.renderDashboardState();
    }
}

function syncShellPanels() {
    if (typeof window.renderSwapPanel === "function") {
        window.renderSwapPanel();
    }

    if (typeof window.renderStaffingAnalysis === "function") {
        window.renderStaffingAnalysis();
    }

    if (typeof window.renderDashboardState === "function") {
        window.renderDashboardState();
    }
}

export function prevMonth() {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
    syncShellPanels();
}

export function nextMonth() {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
    syncShellPanels();
}
