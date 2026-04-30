import { getFirebaseServices } from "./firebaseClient.js";
import {
    getProfiles,
    saveProfiles,
    setCurrentProfile,
    getCurrentProfile
} from "./storage.js";

let activeWorkspaceId = "";
let unsubscribeProfiles = null;
let applyingRemoteProfiles = false;
let syncTimer = null;
let syncInFlight = false;
let servicesCache = null;
let onProfilesChanged = () => {};

function profileDocId(name) {
    return encodeURIComponent(String(name || "").trim())
        .replace(/\./g, "%2E");
}

function stripProfileDocuments(profile = {}) {
    const docs = Array.isArray(profile.docs)
        ? profile.docs
        : [];
    const docsMeta = docs.map(doc => ({
        name: String(doc.name || ""),
        type: String(doc.type || ""),
        size: Number(doc.size) || 0,
        addedAt: String(doc.addedAt || "")
    }));
    const {
        docs: _docs,
        ...rest
    } = profile;

    return {
        ...rest,
        docsMeta
    };
}

function restoreLocalDocuments(remoteProfile, localProfile) {
    const {
        docsMeta: _docsMeta,
        ...profile
    } = remoteProfile;

    return {
        ...profile,
        docs: Array.isArray(localProfile?.docs)
            ? localProfile.docs
            : []
    };
}

function profilesCollection(db, firestoreModule, workspaceId) {
    return firestoreModule.collection(
        db,
        "workspaces",
        workspaceId,
        "profiles"
    );
}

function dispatchStatus(detail) {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
        new CustomEvent("proturnos:firebaseProfiles", {
            detail
        })
    );
}

async function services() {
    if (!servicesCache) {
        servicesCache = await getFirebaseServices();
    }

    return servicesCache;
}

async function uploadProfiles(profiles) {
    if (!activeWorkspaceId || applyingRemoteProfiles) return;
    if (syncInFlight) {
        scheduleProfileUpload();
        return;
    }

    syncInFlight = true;

    try {
        const {
            db,
            firestoreModule
        } = await services();
        const batch = firestoreModule.writeBatch(db);

        profiles.forEach(profile => {
            if (!profile?.name) return;

            const ref = firestoreModule.doc(
                db,
                "workspaces",
                activeWorkspaceId,
                "profiles",
                profileDocId(profile.name)
            );

            batch.set(
                ref,
                {
                    ...stripProfileDocuments(profile),
                    updatedAt: firestoreModule.serverTimestamp()
                },
                { merge: true }
            );
        });

        await batch.commit();
        dispatchStatus({
            type: "profiles-uploaded",
            count: profiles.length
        });
    } catch (error) {
        console.warn("No se pudieron sincronizar perfiles.", error);
        dispatchStatus({
            type: "profiles-error",
            message: error.message || "Error sincronizando perfiles"
        });
    } finally {
        syncInFlight = false;
    }
}

function scheduleProfileUpload() {
    if (!activeWorkspaceId || applyingRemoteProfiles) return;

    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        uploadProfiles(getProfiles());
    }, 650);
}

function applyRemoteSnapshot(snapshot) {
    const localProfiles = getProfiles();
    const localByName = new Map(
        localProfiles.map(profile => [profile.name, profile])
    );
    const remoteProfiles = snapshot.docs
        .map(docSnap =>
            restoreLocalDocuments(
                docSnap.data(),
                localByName.get(docSnap.data()?.name)
            )
        )
        .filter(profile => profile.name)
        .sort((a, b) => a.name.localeCompare(b.name));

    if (!remoteProfiles.length) {
        if (localProfiles.length) {
            scheduleProfileUpload();
        }
        return;
    }

    applyingRemoteProfiles = true;

    try {
        saveProfiles(remoteProfiles, { silent: true });

        const current = getCurrentProfile();
        if (
            current &&
            !remoteProfiles.some(profile => profile.name === current)
        ) {
            setCurrentProfile(remoteProfiles[0]?.name || null);
        }
    } finally {
        applyingRemoteProfiles = false;
    }

    onProfilesChanged(remoteProfiles);
}

export async function deleteRemoteProfile(profileName) {
    if (!activeWorkspaceId || !profileName) return;

    try {
        const {
            db,
            firestoreModule
        } = await services();

        await firestoreModule.deleteDoc(
            firestoreModule.doc(
                db,
                "workspaces",
                activeWorkspaceId,
                "profiles",
                profileDocId(profileName)
            )
        );
    } catch (error) {
        console.warn("No se pudo eliminar perfil remoto.", error);
    }
}

export async function startFirebaseProfileSync(
    workspace,
    options = {}
) {
    const workspaceId = workspace?.id || "";

    onProfilesChanged =
        typeof options.onChange === "function"
            ? options.onChange
            : () => {};

    if (activeWorkspaceId === workspaceId && unsubscribeProfiles) {
        return;
    }

    stopFirebaseProfileSync();
    activeWorkspaceId = workspaceId;

    if (!activeWorkspaceId) return;

    try {
        const {
            db,
            firestoreModule
        } = await services();
        const collectionRef = profilesCollection(
            db,
            firestoreModule,
            activeWorkspaceId
        );

        unsubscribeProfiles = firestoreModule.onSnapshot(
            collectionRef,
            applyRemoteSnapshot,
            error => {
                console.warn("No se pudo leer perfiles Firebase.", error);
            }
        );

        scheduleProfileUpload();
    } catch (error) {
        console.warn("No se pudo iniciar sincronizacion de perfiles.", error);
    }
}

export function stopFirebaseProfileSync() {
    clearTimeout(syncTimer);
    syncTimer = null;

    if (unsubscribeProfiles) {
        unsubscribeProfiles();
        unsubscribeProfiles = null;
    }

    activeWorkspaceId = "";
    applyingRemoteProfiles = false;
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:profilesSaved", event => {
        if (event.detail?.remote === false) return;
        scheduleProfileUpload();
    });

    window.addEventListener("proturnos:profileRenamed", event => {
        const oldName = event.detail?.oldName;
        const newName = event.detail?.newName;

        if (oldName && oldName !== newName) {
            deleteRemoteProfile(oldName);
        }

        scheduleProfileUpload();
    });
}
