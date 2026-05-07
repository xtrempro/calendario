import {
    getCurrentFirebaseUser,
    getFirebaseServices
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";

function cleanText(value, fallback = "") {
    const text = String(value ?? "").trim();

    return text || fallback;
}

function cleanWorkspaceId(value) {
    return cleanText(value).replace(/\//g, "").trim();
}

function workspaceName(workspace) {
    return cleanText(workspace?.name, workspace?.id || "Entorno");
}

function userName(user) {
    return cleanText(user?.displayName, user?.email || "Usuario");
}

function linkDocId(fromWorkspaceId, toWorkspaceId) {
    return `${cleanWorkspaceId(fromWorkspaceId)}__${cleanWorkspaceId(toWorkspaceId)}`;
}

function linkFromSnap(docSnap) {
    return {
        id: docSnap.id,
        ...docSnap.data()
    };
}

function uniqueLinks(snaps) {
    const links = new Map();

    snaps.forEach(snap => {
        snap.docs.forEach(docSnap => {
            links.set(docSnap.id, linkFromSnap(docSnap));
        });
    });

    return [...links.values()].sort((a, b) => {
        const aName = a.fromWorkspaceName || a.toWorkspaceName || a.id;
        const bName = b.fromWorkspaceName || b.toWorkspaceName || b.id;

        return String(aName).localeCompare(String(bName));
    });
}

async function ensureCurrentUserLinkedOperator(
    link,
    workspace,
    db,
    firestoreModule
) {
    const user = getCurrentFirebaseUser();

    if (!user || !workspace?.id || link.status !== "accepted") return;

    const isSource = link.fromWorkspaceId === workspace.id;
    if (isSource) return;

    const linkedWorkspaceId = link.fromWorkspaceId;

    if (!linkedWorkspaceId) return;

    try {
        await firestoreModule.setDoc(
            firestoreModule.doc(
                db,
                "workspaces",
                linkedWorkspaceId,
                "linkedOperators",
                user.uid
            ),
            {
                uid: user.uid,
                fromWorkspaceId: workspace.id,
                fromWorkspaceName: workspaceName(workspace),
                linkId: link.id,
                role: "linked-operator",
                updatedAt: firestoreModule.serverTimestamp()
            },
            { merge: true }
        );
    } catch (error) {
        console.warn(
            "No se pudo reparar permiso tecnico de unidad enlazada.",
            linkedWorkspaceId,
            error
        );
    }
}

export async function requestWorkspaceLink(targetWorkspaceId) {
    const targetId = cleanWorkspaceId(targetWorkspaceId);
    const activeWorkspace = getActiveWorkspace();
    const user = getCurrentFirebaseUser();

    if (!user) {
        throw new Error("Debes iniciar sesion para solicitar enlaces.");
    }

    if (!activeWorkspace?.id) {
        throw new Error("Selecciona un entorno antes de solicitar un enlace.");
    }

    if (!targetId) {
        throw new Error("Ingresa el ID del entorno que quieres enlazar.");
    }

    if (targetId === activeWorkspace.id) {
        throw new Error("No puedes enlazar el entorno activo consigo mismo.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const linkRef = firestoreModule.doc(
        db,
        "workspaceLinks",
        linkDocId(activeWorkspace.id, targetId)
    );
    const now = firestoreModule.serverTimestamp();

    await firestoreModule.setDoc(linkRef, {
        fromWorkspaceId: activeWorkspace.id,
        fromWorkspaceName: workspaceName(activeWorkspace),
        toWorkspaceId: targetId,
        toWorkspaceName: targetId,
        status: "pending",
        requestedByUid: user.uid,
        requestedByName: userName(user),
        createdAt: now,
        updatedAt: now
    });

    return linkRef.id;
}

export async function listWorkspaceLinks(workspace = getActiveWorkspace()) {
    if (!workspace?.id) return [];

    const { db, firestoreModule } = await getFirebaseServices();
    const linksRef =
        firestoreModule.collection(db, "workspaceLinks");
    const [fromSnap, toSnap] = await Promise.all([
        firestoreModule.getDocs(
            firestoreModule.query(
                linksRef,
                firestoreModule.where(
                    "fromWorkspaceId",
                    "==",
                    workspace.id
                )
            )
        ),
        firestoreModule.getDocs(
            firestoreModule.query(
                linksRef,
                firestoreModule.where(
                    "toWorkspaceId",
                    "==",
                    workspace.id
                )
            )
        )
    ]);

    return uniqueLinks([fromSnap, toSnap]);
}

export async function listAcceptedLinkedWorkspaces(
    workspace = getActiveWorkspace()
) {
    const links = await listWorkspaceLinks(workspace);
    const acceptedLinks = links.filter(link =>
        link.status === "accepted" &&
        (
            link.fromWorkspaceId === workspace?.id ||
            link.toWorkspaceId === workspace?.id
        )
    );

    if (acceptedLinks.length) {
        const { db, firestoreModule } = await getFirebaseServices();

        await Promise.all(
            acceptedLinks.map(link =>
                ensureCurrentUserLinkedOperator(
                    link,
                    workspace,
                    db,
                    firestoreModule
                )
            )
        );
    }

    return acceptedLinks
        .map(link => {
            const isSource =
                link.fromWorkspaceId === workspace?.id;
            const linkedWorkspaceId = isSource
                ? link.toWorkspaceId
                : link.fromWorkspaceId;
            const linkedWorkspaceName = isSource
                ? link.toWorkspaceName
                : link.fromWorkspaceName;

            return {
                id: linkedWorkspaceId,
                name: linkedWorkspaceName || linkedWorkspaceId,
                linkId: link.id,
                requestedByUid: link.requestedByUid || "",
                direction: isSource ? "outgoing" : "incoming"
            };
        })
        .filter(workspaceItem => workspaceItem.id);
}

export async function acceptWorkspaceLink(linkId) {
    const activeWorkspace = getActiveWorkspace();
    const user = getCurrentFirebaseUser();

    if (!user) {
        throw new Error("Debes iniciar sesion para aceptar enlaces.");
    }

    if (!activeWorkspace?.id) {
        throw new Error("Selecciona un entorno antes de aceptar enlaces.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const linkRef = firestoreModule.doc(db, "workspaceLinks", linkId);
    const linkSnap = await firestoreModule.getDoc(linkRef);

    if (!linkSnap.exists()) {
        throw new Error("La solicitud de enlace ya no existe.");
    }

    const link = linkSnap.data() || {};

    if (link.toWorkspaceId !== activeWorkspace.id) {
        throw new Error("Solo el entorno invitado puede aceptar este enlace.");
    }

    const now = firestoreModule.serverTimestamp();
    const batch = firestoreModule.writeBatch(db);

    batch.update(linkRef, {
        status: "accepted",
        toWorkspaceName: workspaceName(activeWorkspace),
        acceptedAt: now,
        acceptedByUid: user.uid,
        acceptedByName: userName(user),
        updatedAt: now
    });

    batch.set(
        firestoreModule.doc(
            db,
            "workspaces",
            activeWorkspace.id,
            "linkedOperators",
            link.requestedByUid
        ),
        {
            uid: link.requestedByUid,
            fromWorkspaceId: link.fromWorkspaceId,
            fromWorkspaceName: link.fromWorkspaceName || "",
            linkId,
            role: "linked-operator",
            acceptedByUid: user.uid,
            acceptedByName: userName(user),
            createdAt: now,
            updatedAt: now
        },
        { merge: true }
    );

    batch.set(
        firestoreModule.doc(
            db,
            "workspaces",
            link.fromWorkspaceId,
            "linkedOperators",
            user.uid
        ),
        {
            uid: user.uid,
            fromWorkspaceId: activeWorkspace.id,
            fromWorkspaceName: workspaceName(activeWorkspace),
            linkId,
            role: "linked-operator",
            acceptedByUid: user.uid,
            acceptedByName: userName(user),
            createdAt: now,
            updatedAt: now
        },
        { merge: true }
    );

    await batch.commit();
}

export async function rejectWorkspaceLink(linkId) {
    const activeWorkspace = getActiveWorkspace();
    const user = getCurrentFirebaseUser();

    if (!activeWorkspace?.id) {
        throw new Error("Selecciona un entorno antes de rechazar enlaces.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const linkRef = firestoreModule.doc(db, "workspaceLinks", linkId);
    const linkSnap = await firestoreModule.getDoc(linkRef);

    if (!linkSnap.exists()) {
        throw new Error("La solicitud de enlace ya no existe.");
    }

    const link = linkSnap.data() || {};

    if (link.toWorkspaceId !== activeWorkspace.id) {
        throw new Error("Solo el entorno invitado puede rechazar este enlace.");
    }

    await firestoreModule.updateDoc(linkRef, {
        status: "rejected",
        rejectedAt: firestoreModule.serverTimestamp(),
        rejectedByUid: user?.uid || "",
        rejectedByName: userName(user),
        updatedAt: firestoreModule.serverTimestamp()
    });
}
