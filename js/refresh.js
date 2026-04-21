
import { renderCalendar } from "./calendar.js";
import { renderTimeline } from "./timeline.js";
import { analizarStaffingMes } from "./staffing.js";

export function refreshAll(){
    renderCalendar();
    renderTimeline();
    analizarStaffingMes();
}

