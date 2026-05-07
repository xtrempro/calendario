import { getFirebaseServices } from "./firebaseClient.js";
import { isInternalKey } from "./persistence.js";

const CHUNK_SIZE = 450000;

function stateDocPath(workspaceId) {
    return [
        "workspaces",
        workspaceId,
        "system",
        "appState"
    ];
}

function chunkDocId(index) {
    return `part_${String(index).padStart(4, "0")}`;
}

function chunksCollection(db, firestoreModule, workspaceId) {
    return firestoreModule.collection(
        db,
        "workspaces",
        workspaceId,
        "appStateChunks"
    );
}

function stableSnapshotString(snapshot = {}) {
    const ordered = {};

    Object.keys(snapshot)
        .filter(key => !isInternalKey(key))
        .sort()
        .forEach(key => {
            ordered[key] = snapshot[key];
        });

    return JSON.stringify(ordered);
}

function hashString(value) {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return `${value.length}-${(hash >>> 0).toString(36)}`;
}

function splitChunks(value) {
    const chunks = [];

    for (let index = 0; index < value.length; index += CHUNK_SIZE) {
        chunks.push(value.slice(index, index + CHUNK_SIZE));
    }

    return chunks.length ? chunks : [""];
}

export async function readFirebaseWorkspaceState(workspaceId) {
    if (!workspaceId) return null;

    const { db, firestoreModule } = await getFirebaseServices();
    const manifestSnap = await firestoreModule.getDoc(
        firestoreModule.doc(db, ...stateDocPath(workspaceId))
    );

    if (!manifestSnap.exists()) return null;

    const manifest = manifestSnap.data() || {};
    const expectedChunkCount = Number(manifest.chunkCount) || 0;
    const chunksSnap = await firestoreModule.getDocs(
        chunksCollection(db, firestoreModule, workspaceId)
    );
    const chunks = chunksSnap.docs
        .map(docSnap => ({
            id: docSnap.id,
            index: Number(docSnap.data()?.index) || 0,
            text: String(docSnap.data()?.text || "")
        }))
        .sort((a, b) =>
            a.index - b.index ||
            a.id.localeCompare(b.id)
        );

    if (expectedChunkCount && chunks.length < expectedChunkCount) {
        throw new Error(
            "El entorno enlazado aun no tiene una copia viva completa."
        );
    }

    return JSON.parse(chunks.map(chunk => chunk.text).join("") || "{}");
}

export async function writeFirebaseWorkspaceState(
    workspaceId,
    snapshot = {}
) {
    if (!workspaceId) {
        throw new Error("Falta el entorno Firebase de destino.");
    }

    const stateString = stableSnapshotString(snapshot);
    const stateHash = hashString(stateString);
    const chunks = splitChunks(stateString);
    const nextChunkIds = new Set(
        chunks.map((_chunk, index) => chunkDocId(index))
    );
    const { db, firestoreModule } = await getFirebaseServices();
    const batch = firestoreModule.writeBatch(db);
    const existingChunks = await firestoreModule.getDocs(
        chunksCollection(db, firestoreModule, workspaceId)
    );

    chunks.forEach((chunk, index) => {
        batch.set(
            firestoreModule.doc(
                db,
                "workspaces",
                workspaceId,
                "appStateChunks",
                chunkDocId(index)
            ),
            {
                index,
                text: chunk,
                updatedAt: firestoreModule.serverTimestamp()
            }
        );
    });

    existingChunks.docs.forEach(docSnap => {
        if (!nextChunkIds.has(docSnap.id)) {
            batch.delete(docSnap.ref);
        }
    });

    batch.set(
        firestoreModule.doc(db, ...stateDocPath(workspaceId)),
        {
            chunkCount: chunks.length,
            charCount: stateString.length,
            hash: stateHash,
            clientId: "linked_workspace_update",
            updatedAtISO: new Date().toISOString(),
            updatedAt: firestoreModule.serverTimestamp()
        },
        { merge: true }
    );

    await batch.commit();

    return {
        chunkCount: chunks.length,
        hash: stateHash
    };
}
