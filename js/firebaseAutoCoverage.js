// Sincroniza las campañas de cobertura automatica con
// workspaces/{ws}/autoCoverageCampaigns.
//
// Coleccion propia y no estado compartido (stateModules) porque quien hace
// avanzar las etapas es la Cloud Function: si la campaña viajara dentro de la
// foto del modulo `requests`, cualquier navegador con una copia de hace un rato
// devolveria la campaña a la etapa anterior al subir la suya.
//
// Es el mismo patron de firebaseReplacementRequests.js, con la misma precaucion:
// una campaña solo AVANZA -etapas corridas y cierre-, nunca retrocede, asi que
// al fusionar gana la version mas adelantada.

import { getFirebaseServices } from "./firebaseClient.js";
import {
    applyRemoteAutoCoverageCampaigns,
    getAutoCoverageCampaigns
} from "./autoCoverage.js";

let activeWorkspaceId = "";
let unsubscribeCampaigns = null;
let applyingRemote = false;
let syncTimer = null;
let syncInFlight = false;
let servicesCache = null;
let onCampaignsChanged = () => {};

function campaignDocId(campaign) {
    return encodeURIComponent(String(campaign?.id || "").trim())
        .replace(/\./g, "%2E");
}

async function services() {
    if (!servicesCache) {
        servicesCache = await getFirebaseServices();
    }

    return servicesCache;
}

async function uploadCampaigns(campaigns) {
    if (!activeWorkspaceId || applyingRemote) return;
    if (!campaigns.length) return;

    if (syncInFlight) {
        scheduleCampaignUpload();
        return;
    }

    syncInFlight = true;

    try {
        const { db, firestoreModule } = await services();
        const batch = firestoreModule.writeBatch(db);

        campaigns.forEach(campaign => {
            if (!campaign?.id) return;

            const ref = firestoreModule.doc(
                db,
                "workspaces",
                activeWorkspaceId,
                "autoCoverageCampaigns",
                campaignDocId(campaign)
            );

            batch.set(
                ref,
                {
                    ...campaign,
                    workspaceId: activeWorkspaceId,
                    updatedAt: firestoreModule.serverTimestamp()
                },
                { merge: true }
            );
        });

        await batch.commit();
    } catch (error) {
        console.warn(
            "No se pudieron sincronizar las campañas de cobertura.",
            error
        );
    } finally {
        syncInFlight = false;
    }
}

function scheduleCampaignUpload(campaigns = null) {
    if (!activeWorkspaceId || applyingRemote) return;

    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        uploadCampaigns(campaigns || getAutoCoverageCampaigns());
    }, 650);
}

function campaignProgress(campaign) {
    return (campaign?.steps || [])
        .filter(step => step.ranAt || step.skipped).length;
}

/**
 * Una campaña solo avanza. Si una de las dos copias ya esta cerrada, esa manda;
 * si las dos siguen abiertas, manda la que tiene mas etapas resueltas.
 */
export function mergeRemoteCampaign(local, remote) {
    if (!local) return remote;
    if (!remote) return local;

    if (local.status !== "active" && remote.status === "active") return local;
    if (remote.status !== "active" && local.status === "active") return remote;

    return campaignProgress(remote) >= campaignProgress(local)
        ? remote
        : local;
}

export function mergeRemoteCampaigns(localCampaigns, remoteCampaigns) {
    const localById = new Map(
        (localCampaigns || []).map(campaign => [String(campaign.id), campaign])
    );

    return (remoteCampaigns || []).map(remote =>
        mergeRemoteCampaign(localById.get(String(remote.id)), remote)
    );
}

function applyRemoteSnapshot(snapshot) {
    const remoteCampaigns = snapshot.docs
        .map(docSnap => docSnap.data())
        .filter(campaign => campaign?.id);
    const merged = mergeRemoteCampaigns(
        getAutoCoverageCampaigns(),
        remoteCampaigns
    );

    applyingRemote = true;

    let hasLocalOnly = false;

    try {
        hasLocalOnly = applyRemoteAutoCoverageCampaigns(merged);
    } finally {
        applyingRemote = false;
    }

    if (hasLocalOnly) scheduleCampaignUpload();

    onCampaignsChanged(merged);
}

export async function startFirebaseAutoCoverageSync(workspace, options = {}) {
    const workspaceId = workspace?.id || "";

    onCampaignsChanged =
        typeof options.onChange === "function"
            ? options.onChange
            : () => {};

    if (activeWorkspaceId === workspaceId && unsubscribeCampaigns) {
        return;
    }

    stopFirebaseAutoCoverageSync();
    activeWorkspaceId = workspaceId;

    if (!activeWorkspaceId) return;

    try {
        const { db, firestoreModule } = await services();
        const collectionRef = firestoreModule.collection(
            db,
            "workspaces",
            activeWorkspaceId,
            "autoCoverageCampaigns"
        );

        unsubscribeCampaigns = firestoreModule.onSnapshot(
            collectionRef,
            applyRemoteSnapshot,
            error => {
                console.warn(
                    "No se pudo leer las campañas de cobertura.",
                    error
                );
            }
        );

        scheduleCampaignUpload();
    } catch (error) {
        console.warn(
            "No se pudo iniciar sincronizacion de cobertura automatica.",
            error
        );
    }
}

export function stopFirebaseAutoCoverageSync() {
    clearTimeout(syncTimer);
    syncTimer = null;

    if (unsubscribeCampaigns) {
        unsubscribeCampaigns();
        unsubscribeCampaigns = null;
    }

    activeWorkspaceId = "";
    applyingRemote = false;
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:autoCoverageSaved", event => {
        // Solo lo que cambio: subir la lista entera en cada cierre gastaria una
        // escritura por campaña viva.
        scheduleCampaignUpload(event.detail?.changed || null);
    });
}
