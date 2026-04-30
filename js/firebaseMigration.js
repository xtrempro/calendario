import {
    exportLocalSnapshot,
    importLocalSnapshot
} from "./persistence.js";
import { getFirebaseServices } from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";

function migrationDocPath(workspaceId) {
    return [
        "workspaces",
        workspaceId,
        "system",
        "localStorageSnapshot"
    ];
}

export function buildLocalMigrationSnapshot() {
    return {
        createdAt: new Date().toISOString(),
        data: exportLocalSnapshot()
    };
}

export async function uploadLocalSnapshotToActiveWorkspace() {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) {
        throw new Error("Selecciona un entorno Firebase antes de migrar.");
    }

    const snapshot = buildLocalMigrationSnapshot();
    const { db, firestoreModule } = await getFirebaseServices();
    const ref = firestoreModule.doc(
        db,
        ...migrationDocPath(workspace.id)
    );

    await firestoreModule.setDoc(
        ref,
        {
            ...snapshot,
            updatedAt: firestoreModule.serverTimestamp()
        },
        { merge: true }
    );

    return {
        workspaceId: workspace.id,
        createdAt: snapshot.createdAt,
        keyCount: Object.keys(snapshot.data || {}).length
    };
}

export async function downloadSnapshotFromActiveWorkspace() {
    const workspace = getActiveWorkspace();

    if (!workspace?.id) {
        throw new Error("Selecciona un entorno Firebase antes de descargar.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const ref = firestoreModule.doc(
        db,
        ...migrationDocPath(workspace.id)
    );
    const snap = await firestoreModule.getDoc(ref);

    if (!snap.exists()) {
        throw new Error("El entorno no tiene una copia migrada.");
    }

    return snap.data();
}

export async function restoreSnapshotToLocalStorage() {
    const snapshot = await downloadSnapshotFromActiveWorkspace();

    importLocalSnapshot(snapshot.data || {});
}
