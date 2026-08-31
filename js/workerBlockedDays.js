// Dias que el trabajador marco desde su PWA como "no me ofrezcan reemplazos"
// (workspaces/{ws}/workerBlockedDays), en memoria y sin Firestore.
//
// Es el filtro 1 de la cobertura automatica. Vive aparte de
// workerAvailability.js -que es quien lo llena con el listener- por el mismo
// motivo que workerAppLinks.js: el motor del servidor necesita evaluar el filtro
// y no puede arrastrar el cliente Firebase. En el navegador lo siembra el
// listener; en el servidor, la Cloud Function con lo que leyo de la coleccion.

import { normalizeText } from "./stringUtils.js";

let blockedDays = [];

function normalizeProfileName(value) {
    return normalizeText(value);
}

function normalizeDate(value) {
    const text = String(value || "").slice(0, 10);

    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function keyToISODate(keyDay) {
    const parts = String(keyDay || "").split("-");

    if (parts.length !== 3) return "";

    return [
        parts[0],
        String(Number(parts[1]) + 1).padStart(2, "0"),
        String(Number(parts[2])).padStart(2, "0")
    ].join("-");
}

export function normalizeBlockedDay(id, data = {}) {
    const date = normalizeDate(data.date || data.day || data.iso);
    const profileName = String(
        data.profileName ||
        data.profile ||
        data.workerDisplayName ||
        ""
    ).trim();

    if (!date || !profileName) return null;
    if (["canceled", "deleted", "inactive"].includes(String(data.status || ""))) {
        return null;
    }

    return {
        id: String(data.id || id || ""),
        date,
        profileName,
        profileKey: normalizeProfileName(profileName),
        workerUid: String(data.workerUid || ""),
        profileRut: String(data.profileRut || ""),
        reason: String(data.reason || "Compromiso personal"),
        message: String(
            data.supervisorMessage ||
            "El trabajador solicito no hacer reemplazos ni cambios de turno en esta fecha."
        ),
        replacementAllowed: data.replacementAllowed !== false
    };
}

/** Reemplaza la lista completa de dias bloqueados conocidos. */
export function setWorkerBlockedDays(days) {
    blockedDays = (Array.isArray(days) ? days : [])
        .slice()
        .sort((a, b) =>
            String(a.date).localeCompare(String(b.date)) ||
            String(a.profileName).localeCompare(String(b.profileName))
        );
}

export function getBlockedDayForProfile(profileName, keyDay) {
    const profileKey = normalizeProfileName(profileName);
    const date = keyToISODate(keyDay);

    if (!profileKey || !date) return null;

    return blockedDays.find(item =>
        item.profileKey === profileKey &&
        item.date === date
    ) || null;
}

export function getWorkerBlockedDays() {
    return [...blockedDays];
}
