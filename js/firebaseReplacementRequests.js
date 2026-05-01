import { getFirebaseServices } from "./firebaseClient.js";
import {
    getReplacementRequests,
    saveReplacementRequests
} from "./storage.js";
import {
    applyAcceptedReplacementRequests,
    expireReplacementRequests
} from "./replacements.js";

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
        "replacementRequests"
    );
}

async function uploadRequests(requests) {
    if (!activeWorkspaceId || applyingRemoteRequests) return;
    if (syncInFlight) {
        scheduleRequestUpload();
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
                "replacementRequests",
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
            "No se pudieron sincronizar solicitudes de reemplazo.",
            error
        );
    } finally {
        syncInFlight = false;
    }
}

function scheduleRequestUpload() {
    if (!activeWorkspaceId || applyingRemoteRequests) return;

    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        uploadRequests(expireReplacementRequests());
    }, 650);
}

function applyRemoteSnapshot(snapshot) {
    const localRequests = getReplacementRequests();
    const remoteRequests = snapshot.docs
        .map(docSnap => docSnap.data())
        .filter(request => request?.id)
        .sort((a, b) =>
            String(a.createdAt || "").localeCompare(
                String(b.createdAt || "")
            )
        );

    if (!remoteRequests.length) {
        if (localRequests.length) {
            scheduleRequestUpload();
        }
        return;
    }

    applyingRemoteRequests = true;

    try {
        saveReplacementRequests(remoteRequests, { silent: true });
    } finally {
        applyingRemoteRequests = false;
    }

    const appliedAccepted = applyAcceptedReplacementRequests();

    if (appliedAccepted) {
        scheduleRequestUpload();
    }

    onRequestsChanged(remoteRequests);
}

export async function startFirebaseReplacementRequestSync(
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

    stopFirebaseReplacementRequestSync();
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
                    "No se pudo leer solicitudes de reemplazo Firebase.",
                    error
                );
            }
        );

        scheduleRequestUpload();
    } catch (error) {
        console.warn(
            "No se pudo iniciar sincronizacion de solicitudes.",
            error
        );
    }
}

export function stopFirebaseReplacementRequestSync() {
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
    window.addEventListener("proturnos:replacementRequestsSaved", event => {
        if (event.detail?.remote === false) return;
        scheduleRequestUpload();
    });
}
