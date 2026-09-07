// Confirmaciones de lectura de las informaciones.
//
// Cada trabajador tiene UN documento propio en
// `workspaces/{ws}/informationReads/{uid}` con el sello de cada informacion que
// confirmo: `{ profileName, acks: { [informacionId]: fechaISO } }`.
//
// Un documento por persona y no uno por confirmacion: una unidad de 130
// personas con 20 informaciones al mes son 130 documentos que se actualizan,
// no 2.600 que se crean. El supervisor lee la coleccion entera de una vez para
// armar el informe, y la PWA solo escribe el suyo.
//
// Aqui NO se escribe: el que confirma es el trabajador desde su aplicacion.
// Este modulo solo mira.

import { getFirebaseServices } from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";

const COLLECTION = "informationReads";

let reads = new Map();
let activeWorkspaceId = "";
let unsubscribe = null;
let loading = false;
let loadError = "";

function notify() {
    if (typeof window === "undefined") return;

    window.dispatchEvent(new CustomEvent("proturnos:informationReadsChanged"));
}

function normalizeEntry(uid, data = {}) {
    const acks = data && typeof data.acks === "object" && data.acks
        ? data.acks
        : {};
    const clean = {};

    Object.entries(acks).forEach(([informationId, stamp]) => {
        const id = String(informationId || "").trim();

        if (!id) return;

        clean[id] = String(stamp || "");
    });

    return {
        uid: String(uid || ""),
        profileName: String(data.profileName || "").trim(),
        acks: clean
    };
}

/** Lo que se sabe hoy: uid -> `{ uid, profileName, acks }`. */
export function getInformationReads() {
    return reads;
}

export function informationReadsAreLoading() {
    return loading;
}

export function informationReadsError() {
    return loadError;
}

/**
 * Cuando confirmo esa persona, o "" si no lo ha hecho.
 *
 * Se busca por UID, que es la clave del documento y lo unico que no cambia.
 * El nombre NO sirve de llave: al renombrar un perfil, el enlace de la PWA se
 * queda con el nombre viejo, y una comparacion por nombre daria a esa persona
 * por pendiente para siempre -y le mandaria recordatorios de algo que ya
 * confirmo-. El `profileName` guardado en el documento es solo para mostrar.
 *
 * @param {string} informationId
 * @param {string} uid uid del enlace de la PWA de esa persona.
 */
export function readStampFor(informationId, uid) {
    const id = String(informationId || "");
    const key = String(uid || "").trim();

    if (!id || !key) return "";

    return reads.get(key)?.acks[id] || "";
}

/** Si esa persona ya confirmo esa informacion. */
export function hasRead(informationId, uid) {
    return Boolean(readStampFor(informationId, uid));
}

/** Cuantas confirmaciones tiene una informacion, contando a todo el mundo. */
export function readCountFor(informationId) {
    const id = String(informationId || "");
    let count = 0;

    if (!id) return count;

    reads.forEach(entry => {
        if (entry.acks[id]) count += 1;
    });

    return count;
}

export function stopInformationReads() {
    if (unsubscribe) {
        try {
            unsubscribe();
        } catch (error) {
            console.warn("No se pudo cerrar el listener de lecturas.", error);
        }
    }

    unsubscribe = null;
    activeWorkspaceId = "";
    reads = new Map();
    loading = false;
    loadError = "";
}

/**
 * Engancha el listener al workspace activo. Es idempotente: llamarlo de nuevo
 * con el mismo workspace no abre un segundo listener.
 */
export async function watchInformationReads() {
    const workspace = getActiveWorkspace();
    const workspaceId = String(workspace?.id || "");

    if (!workspaceId) {
        stopInformationReads();
        return false;
    }

    // El guardia mira `activeWorkspaceId`, que se fija ANTES del await, y no
    // `unsubscribe`, que sigue en null hasta que Firestore responde: con dos
    // llamadas seguidas -pintar el panel dos veces- las dos pasaban el guardia
    // y quedaba un listener huerfano por toda la sesion.
    if (workspaceId === activeWorkspaceId) return true;

    stopInformationReads();
    activeWorkspaceId = workspaceId;
    loading = true;
    notify();

    try {
        const { db, firestoreModule } = await getFirebaseServices();

        // El workspace pudo cambiar mientras se resolvia el cliente.
        if (activeWorkspaceId !== workspaceId) return false;

        const ref = firestoreModule.collection(
            db,
            "workspaces",
            workspaceId,
            COLLECTION
        );

        unsubscribe = firestoreModule.onSnapshot(
            ref,
            snapshot => {
                const next = new Map();

                snapshot.forEach(doc => {
                    next.set(doc.id, normalizeEntry(doc.id, doc.data()));
                });
                reads = next;
                loading = false;
                loadError = "";
                notify();
            },
            error => {
                console.warn("No se pudieron leer las confirmaciones.", error);
                loading = false;
                // Sin permiso de lectura el panel sigue sirviendo: se publica
                // igual, solo que sin el recuento de quien leyo.
                loadError = error?.code === "permission-denied"
                    ? "Tu usuario no puede ver las confirmaciones de lectura."
                    : "No se pudieron cargar las confirmaciones de lectura.";
                notify();
            }
        );

        return true;
    } catch (error) {
        console.warn("No se pudo escuchar las confirmaciones.", error);
        loading = false;
        loadError = "No se pudieron cargar las confirmaciones de lectura.";
        notify();
        return false;
    }
}
