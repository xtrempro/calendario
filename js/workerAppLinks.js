// Registro de enlaces de la PWA del trabajador (workspaces/{ws}/workerLinks).
//
// Vive aparte de workerAppDataSync.js -que es quien lo llena desde Firestore-
// por una razon de empaquetado: replacements.js necesita saber si un trabajador
// tiene la app enlazada para armar la solicitud (canal app o WhatsApp, uid,
// correo), y workerAppDataSync arrastra el cliente Firebase entero. Con esa
// dependencia, replacements.js no se podia empaquetar en el motor del servidor
// (functions/engine), que es justamente donde ahora corre el temporizador de la
// cobertura automatica.
//
// Aqui no hay Firestore ni listeners: solo la lista en memoria y como cruzarla
// con los perfiles. En el navegador la llena el listener de workerAppDataSync;
// en el servidor la siembra la Cloud Function con lo que leyo de la coleccion.

import { getProfiles } from "./storage.js";
import { normalizeText } from "./stringUtils.js";

let workerLinks = [];

export function normalizeWorkerLinkRut(value) {
    return String(value || "")
        .replace(/[^0-9kK]/g, "")
        .toUpperCase();
}

/** Reemplaza la lista completa de enlaces conocidos. */
export function setWorkerAppLinks(links) {
    workerLinks = Array.isArray(links) ? links : [];
}

/** La lista cruda, tal como la entrego quien la sembro. */
export function getWorkerAppLinkList() {
    return workerLinks;
}

/**
 * Perfil al que apunta un enlace. Primero por RUT -que no cambia- y despues por
 * nombre normalizado, que es el unico dato que queda cuando el perfil no tiene
 * RUT cargado.
 */
export function findProfileForLink(link, profiles) {
    const linkRut = normalizeWorkerLinkRut(link?.profileRut);
    const linkName = normalizeText(link?.profileName);

    if (linkRut) {
        const rutMatch = profiles.find(profile =>
            normalizeWorkerLinkRut(profile.rut) === linkRut
        );

        if (rutMatch) return rutMatch;
    }

    if (linkName) {
        const exactNameMatch = profiles.find(profile =>
            normalizeText(profile.name) === linkName
        );

        if (exactNameMatch) return exactNameMatch;
    }

    return null;
}

export function getWorkerAppLinkForProfile(profileOrName) {
    const profiles = getProfiles();
    const profile = typeof profileOrName === "string"
        ? profiles.find(item => item.name === profileOrName)
        : profileOrName;

    if (!profile) return null;

    return workerLinks.find(link => {
        const linkedProfile = findProfileForLink(link, profiles);

        return linkedProfile?.name === profile.name;
    }) || null;
}

export function getWorkerAppLinks() {
    const profiles = getProfiles();

    return workerLinks.map(link => ({
        ...link,
        profile: findProfileForLink(link, profiles)
    }));
}
