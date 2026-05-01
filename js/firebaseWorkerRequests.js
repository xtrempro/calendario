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

    applyingRemoteRequests = true;

    try {
        saveWorkerRequests(remoteRequests, { silent: true });
    } finally {
        applyingRemoteRequests = false;
    }

    onRequestsChanged(remoteRequests);
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
