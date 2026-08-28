// Solicitudes de CAMBIO DE TURNO pendientes: mismo tratamiento visual que las
// solicitudes de permiso pendientes. El dia parpadea alternando el color del
// turno con el color del cambio, para que el supervisor vea en el calendario
// que hay algo esperando su respuesta y no dependa solo de la notificacion.
//
// Vive aparte de calendar.js porque el timeline tambien lo necesita y no puede
// importar de ahi (dependencia circular), igual que [[pendingLeaveRequests]].
//
// Una solicitud llega al supervisor recien cuando el COLEGA ya acepto: la Cloud
// Function crea entonces un `workerRequests` con type "swap" y status "pending"
// (functions/index.js, trigger de workerSwapRequests). Antes de eso el cambio
// esta en "pending_colleague" y no es asunto del supervisor todavia.

import { getWorkerRequests } from "./storage.js";

// El dia que se entrega y el de devolucion involucran a AMBOS trabajadores, con
// roles cruzados. Se nombran igual que los marcadores del calendario para un
// cambio ya aceptado: CCTT el dia que entrega su turno, DDTT el que lo devuelve.
export const SWAP_ROLE = {
    GIVES: "gives",
    RECEIVES: "receives"
};

function swapChangeDate(request) {
    return String(request?.fecha || request?.date || "");
}

function swapReturnDate(request) {
    return String(request?.devolucion || request?.returnDate || "");
}

function swapRequester(request) {
    return String(request?.from || request?.profile || "");
}

function swapCounterpart(request) {
    return String(request?.to || request?.targetProfile || "");
}

export function isPendingSwapRequest(request) {
    return Boolean(
        request &&
        request.type === "swap" &&
        request.status === "pending"
    );
}

// Solicitudes pendientes que tocan a este trabajador, sea como solicitante o
// como contraparte. Ambos ven el parpadeo: el cambio les altera el calendario a
// los dos.
export function getPendingSwapRequestsForProfile(profileName) {
    if (!profileName) return [];

    return getWorkerRequests().filter(request =>
        isPendingSwapRequest(request) &&
        (
            swapRequester(request) === profileName ||
            swapCounterpart(request) === profileName
        )
    );
}

// Que le pasa a ESTE trabajador ese dia. Devuelve null si la fecha no es parte
// de la solicitud.
//
// El dia de cambio lo entrega el solicitante y lo recibe la contraparte; el de
// devolucion, al reves. Un mismo dia no puede ser las dos cosas: si la solicitud
// tuviera igual fecha de cambio y devolucion seria invalida, y la Cloud Function
// ya la rechaza ("La fecha de cambio y devolucion deben ser distintas").
export function pendingSwapRoleForDate(request, profileName, iso) {
    if (!isPendingSwapRequest(request) || !profileName || !iso) return null;

    const date = String(iso);
    const requester = swapRequester(request);
    const counterpart = swapCounterpart(request);

    if (date === swapChangeDate(request)) {
        if (profileName === requester) return SWAP_ROLE.GIVES;
        if (profileName === counterpart) return SWAP_ROLE.RECEIVES;
        return null;
    }

    if (date === swapReturnDate(request)) {
        if (profileName === counterpart) return SWAP_ROLE.GIVES;
        if (profileName === requester) return SWAP_ROLE.RECEIVES;
        return null;
    }

    return null;
}

export function getPendingSwapRequestForDate(profileName, iso) {
    if (!profileName || !iso) return null;

    const requests = getPendingSwapRequestsForProfile(profileName);

    for (const request of requests) {
        const role = pendingSwapRoleForDate(request, profileName, iso);

        if (role) {
            return {
                request,
                role,
                counterpart:
                    swapRequester(request) === profileName
                        ? swapCounterpart(request)
                        : swapRequester(request)
            };
        }
    }

    return null;
}

// Etiqueta corta que alterna con el turno mientras parpadea. Es el mismo
// vocabulario que ya usa el calendario para un cambio aceptado, para que el
// supervisor lea lo mismo antes y despues de aprobar.
export function pendingSwapLabel(role) {
    return role === SWAP_ROLE.GIVES ? "CCTT" : "DDTT";
}

export function pendingSwapLongLabel(role) {
    return role === SWAP_ROLE.GIVES
        ? "Entrega su turno"
        : "Recibe el turno";
}

// Color del parpadeo. Distinto del naranja de los permisos administrativos para
// que el supervisor distinga de un vistazo que tipo de solicitud espera.
export function pendingSwapColorValue() {
    return "var(--color-swap-pending, linear-gradient(135deg, #0089c5, #38bdf8))";
}
