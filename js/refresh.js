import { renderCalendar } from "./calendar.js";
import { renderTimeline } from "./timeline.js";

export function refreshAll(){
    renderCalendar();
    renderTimeline();

    if (typeof window.renderStaffingAnalysis === "function") {
        window.renderStaffingAnalysis();
    }

    if (typeof window.renderSwapPanel === "function") {
        window.renderSwapPanel();
    }

    if (typeof window.renderDashboardState === "function") {
        window.renderDashboardState();
    }
}
