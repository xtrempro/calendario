import { renderCalendar } from "./calendar.js";
import { renderTimeline } from "./timeline.js";
import { renderAuditLogPanel } from "./auditLog.js";

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

    if (document.body.dataset.activeView === "log") {
        renderAuditLogPanel();
    }

    if (
        document.body.dataset.activeView === "clockmarks" &&
        typeof window.renderClockMarksPanel === "function"
    ) {
        window.renderClockMarksPanel();
    }
}
