// Solicitudes de permiso PENDIENTES: lógica compartida entre el calendario
// principal y el timeline (que no puede importar de calendar.js por dependencia
// circular). Una solicitud pendiente hace parpadear el día alternando el color del
// turno con el color del permiso solicitado.

import { getWorkerRequests } from "./storage.js";

export const PENDING_LEAVE_REQUEST_TYPES = new Set([
    "admin",
    "half_admin_morning",
    "half_admin_afternoon",
    "legal",
    "comp",
    "union_leave",
    "unpaid_leave"
]);

function addDaysISO(iso, offset) {
    const parts = String(iso || "").split("-").map(Number);
    const date = new Date(
        Number(parts[0]) || 0,
        (Number(parts[1]) || 1) - 1,
        Number(parts[2]) || 1
    );

    if (Number.isNaN(date.getTime())) return "";

    date.setDate(date.getDate() + Number(offset || 0));

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

export function pendingLeaveRequestEndDate(request) {
    if (request.endDate) return request.endDate;

    const days = Math.max(1, Math.ceil(Number(request.days) || 1));

    return addDaysISO(request.date, days - 1);
}

export function leaveRequestCoversISODate(request, iso) {
    if (!request?.date || !iso) return false;

    const endDate = pendingLeaveRequestEndDate(request);

    return (
        String(iso) >= String(request.date) &&
        String(iso) <= String(endDate || request.date)
    );
}

// Solicitudes de permiso pendientes de un trabajador (para precomputar por perfil).
export function getPendingLeaveRequestsForProfile(profileName) {
    if (!profileName) return [];

    return getWorkerRequests().filter(request =>
        request.status === "pending" &&
        request.profile === profileName &&
        PENDING_LEAVE_REQUEST_TYPES.has(request.type)
    );
}

export function getPendingLeaveRequestForDate(profileName, iso) {
    if (!profileName || !iso) return null;

    return getPendingLeaveRequestsForProfile(profileName)
        .find(request => leaveRequestCoversISODate(request, iso)) || null;
}

// Color (valor CSS) del permiso solicitado, para parpadear alternando con el color
// del turno mientras la solicitud está pendiente. Coincide con el color con que se
// pinta ese permiso una vez aprobado.
export function pendingLeaveColorValue(type) {
    if (type === "half_admin_morning" || type === "half_admin_afternoon") {
        return "linear-gradient(135deg, #f4b223, #ffd15c)";
    }
    if (type === "legal") return "var(--color-legal, #0ea5a6)";
    if (type === "comp") return "var(--color-comp, #8b2bd9)";
    if (type === "union_leave") return "linear-gradient(135deg, #dc2626, #fb7185)";
    if (type === "unpaid_leave") return "var(--color-unpaid_leave, #6b7280)";

    // admin y cualquier otro permiso.
    return "var(--color-admin, #f97316)";
}
