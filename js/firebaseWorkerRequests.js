import { getFirebaseServices } from "./firebaseClient.js";
import {
    getWorkerRequests,
    saveWorkerRequests
} from "./storage.js";

let activeWorkspaceId = "";
let unsubscribeRequests = null;
let applyingRemoteRequests = false;
let syncTimer = null;
let syncInFlight = false;
let servicesCache = null;
let onRequestsChanged = () => {};

function requestDocId(request) {
    return encodeURIComponent(String(request?.id || "").trim())
        .replace(/\./g, "%2E");
}

async function services() {
    if (!servicesCache) {
        servicesCache = await getFirebaseServices();
    }

    return servicesCache;
}

function requestsCollection(db, firestoreModule, workspaceId) {
    return firestoreModule.collection(
        db,
        "workspaces",
        workspaceId,
        "workerRequests"
    );
}

async function uploadRequests(requests) {
    if (!activeWorkspaceId || applyingRemoteRequests) return;
    if (syncInFlight) {
        scheduleWorkerRequestUpload();
        return;
    }

    syncInFlight = true;

    try {
        const {
            db,
            firestoreModule
        } = await services();
        const batch = firestoreModule.writeBatch(db);

        requests.forEach(request => {
            if (!request?.id) return;

            const ref = firestoreModule.doc(
                db,
                "workspaces",
                activeWorkspaceId,
                "workerRequests",
                requestDocId(request)
            );

            batch.set(
                ref,
                {
                    ...request,
                    updatedAt: firestoreModule.serverTimestamp()
                },
                { merge: true }
            );
        });

        await batch.commit();
    } catch (error) {
        console.warn(
            "No se pudieron sincronizar solicitudes de trabajadores.",
            error
        );
    } finally {
        syncInFlight = false;
    }
}

function scheduleWorkerRequestUpload() {
    if (!activeWorkspaceId || applyingRemoteRequests) return;

    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        uploadRequests(getWorkerRequests());
    }, 650);
}

// Una solicitud solo avanza de "pendiente" a resuelta: nada en el app la
// devuelve a pendiente. Asi que si el local ya la resolvio y el remoto todavia
// la trae pendiente, el remoto esta atrasado, no al reves.
//
// Sin esto, aceptar una solicitud se perdia: la resolucion queda local y la
// subida va con 650 ms de retraso, asi que cualquier snapshot que llegara en esa
// ventana la devolvia a "pendiente" -y la subida siguiente cementaba la vuelta
// atras, porque sube la lista COMPLETA tal como quedo-. El cambio de turno si se
// aplicaba, porque viaja por otro modulo de estado; lo que se revertia era el
// estado de la solicitud.
function mergeRemoteRequest(local, remote) {
    if (!local) return remote;
    if (!remote) return local;

    return local.status !== "pending" && remote.status === "pending"
        ? local
        : remote;
}

// Exportada para poder probarla sin Firebase: es la regla que decide que
// version de cada solicitud sobrevive.
export function mergeRemoteRequests(localRequests, remoteRequests) {
    const localById = new Map(
        (localRequests || []).map(request => [String(request.id), request])
    );
    const remoteIds = new Set(
        (remoteRequests || []).map(request => String(request.id))
    );
    const merged = (remoteRequests || []).map(remote =>
        mergeRemoteRequest(localById.get(String(remote.id)), remote)
    );
    // Las que solo existen aca todavia no se han subido: descartarlas las
    // borraba antes de que la subida alcanzara a salir.
    const localOnly = (localRequests || []).filter(request =>
        !remoteIds.has(String(request.id))
    );

    return {
        requests: [...merged, ...localOnly],
        // Si algo del local gano, el remoto quedo atrasado y hay que empujarlo.
        remoteIsBehind:
            localOnly.length > 0 ||
            merged.some((request, index) => request !== remoteRequests[index])
    };
}

function applyRemoteSnapshot(snapshot) {
    const localRequests = getWorkerRequests();
    const remoteRequests = snapshot.docs
        .map(docSnap => docSnap.data())
        .filter(request => request?.id)
        .sort((a, b) =>
            String(b.createdAt || "").localeCompare(
                String(a.createdAt || "")
            )
        );

    if (!remoteRequests.length) {
        if (localRequests.length) {
            scheduleWorkerRequestUpload();
        }
        return;
    }

    const { requests, remoteIsBehind } = mergeRemoteRequests(
        localRequests,
        remoteRequests
    );

    applyingRemoteRequests = true;

    try {
        saveWorkerRequests(requests, { silent: true });
    } finally {
        applyingRemoteRequests = false;
    }

    if (remoteIsBehind) scheduleWorkerRequestUpload();

    onRequestsChanged(requests);
}

export async function startFirebaseWorkerRequestSync(
    workspace,
    options = {}
) {
    const workspaceId = workspace?.id || "";

    onRequestsChanged =
        typeof options.onChange === "function"
            ? options.onChange
            : () => {};

    if (activeWorkspaceId === workspaceId && unsubscribeRequests) {
        return;
    }

    stopFirebaseWorkerRequestSync();
    activeWorkspaceId = workspaceId;

    if (!activeWorkspaceId) return;

    try {
        const {
            db,
            firestoreModule
        } = await services();
        const collectionRef = requestsCollection(
            db,
            firestoreModule,
            activeWorkspaceId
        );

        unsubscribeRequests = firestoreModule.onSnapshot(
            collectionRef,
            applyRemoteSnapshot,
            error => {
                console.warn(
                    "No se pudo leer solicitudes de trabajadores Firebase.",
                    error
                );
            }
        );

        scheduleWorkerRequestUpload();
    } catch (error) {
        console.warn(
            "No se pudo iniciar sincronizacion de solicitudes de trabajadores.",
            error
        );
    }
}

export function stopFirebaseWorkerRequestSync() {
    clearTimeout(syncTimer);
    syncTimer = null;

    if (unsubscribeRequests) {
        unsubscribeRequests();
        unsubscribeRequests = null;
    }

    activeWorkspaceId = "";
    applyingRemoteRequests = false;
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:workerRequestsSaved", event => {
        if (event.detail?.remote === false) return;
        scheduleWorkerRequestUpload();
    });
}
