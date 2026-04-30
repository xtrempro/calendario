import {
    isFirebaseConfigured,
    onFirebaseAuthChanged,
    signInWithGoogle,
    signOutFirebase
} from "./firebaseClient.js";
import {
    createWorkspace,
    ensureFirebaseUser,
    getActiveWorkspace,
    joinWorkspace,
    listUserWorkspaces,
    setActiveWorkspace
} from "./workspaces.js";
import {
    buildLocalMigrationSnapshot,
    uploadLocalSnapshotToActiveWorkspace
} from "./firebaseMigration.js";

let currentUser = null;
let currentWorkspace = getActiveWorkspace();
let workspaceList = [];
let options = {};
let migrationState = {
    mode: "idle",
    message: ""
};

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function displayUserName(user) {
    if (!isFirebaseConfigured()) return "Modo local";
    if (!user) return "Iniciar sesion";

    return user.displayName || user.email || "Usuario";
}

function workspaceText() {
    if (!isFirebaseConfigured()) return "Datos en localStorage";
    if (!currentUser) return "Sin sesion";
    if (!currentWorkspace) return "Sin entorno";

    return `Entorno: ${currentWorkspace.name}`;
}

function updateTopbar() {
    if (options.userName) {
        options.userName.textContent =
            displayUserName(currentUser);
    }

    if (options.userChip) {
        options.userChip.title = workspaceText();
        options.userChip.classList.toggle(
            "user-chip--firebase",
            Boolean(currentUser)
        );
    }
}

function closeModal(backdrop) {
    backdrop?.remove();
}

function createModal() {
    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";
    document.body.appendChild(backdrop);

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            closeModal(backdrop);
        }
    });

    return backdrop;
}

function renderDisabledModal() {
    const backdrop = createModal();

    backdrop.innerHTML = `
        <section class="turn-change-dialog firebase-dialog">
            <strong>Firebase aun no esta activo</strong>
            <p>
                El sistema sigue trabajando en modo local. Para activar login con Gmail
                y entornos compartidos, completa <code>js/firebaseConfig.js</code>
                con los datos de tu proyecto Firebase y cambia
                <code>FIREBASE_ENABLED</code> a <code>true</code>.
            </p>
            <div class="firebase-dialog-note">
                Siguiente etapa: migrar los datos locales al entorno Firebase seleccionado.
            </div>
            <div class="turn-change-dialog__actions">
                <button class="primary-button" type="button" data-action="close">Entendido</button>
                <button class="secondary-button" type="button" data-action="keep-local">Seguir local</button>
            </div>
        </section>
    `;

    backdrop.querySelectorAll("[data-action]").forEach(button => {
        button.onclick = () => closeModal(backdrop);
    });
}

function workspaceListHTML() {
    if (!workspaceList.length) {
        return `
            <div class="firebase-empty">
                Aun no perteneces a ningun entorno.
            </div>
        `;
    }

    return workspaceList.map(workspace => `
        <button class="firebase-workspace-item ${currentWorkspace?.id === workspace.id ? "is-active" : ""}" type="button" data-workspace-id="${escapeHTML(workspace.id)}">
            <span>
                <strong>${escapeHTML(workspace.name || workspace.id)}</strong>
                <small>${escapeHTML(workspace.role || "member")} | ID: ${escapeHTML(workspace.id)}</small>
            </span>
            <em>${currentWorkspace?.id === workspace.id ? "Activo" : "Usar"}</em>
        </button>
    `).join("");
}

function localSnapshotKeyCount() {
    try {
        const snapshot = buildLocalMigrationSnapshot();

        return Object.keys(snapshot.data || {}).length;
    } catch {
        return 0;
    }
}

function migrationStatusHTML() {
    if (!migrationState.message) return "";

    return `
        <div class="firebase-migration-status firebase-migration-status--${escapeHTML(migrationState.mode)}">
            ${escapeHTML(migrationState.message)}
        </div>
    `;
}

function migrationPanelHTML() {
    if (!currentWorkspace) {
        return `
            <div class="firebase-migration-panel">
                <strong>Migracion inicial</strong>
                <p>
                    Selecciona o crea un entorno antes de subir los datos locales.
                </p>
            </div>
        `;
    }

    const keyCount = localSnapshotKeyCount();
    const isConfirming = migrationState.mode === "confirm";
    const isLoading = migrationState.mode === "loading";
    const primaryAction = isConfirming ?
        "upload-local-snapshot" :
        "prepare-local-snapshot-upload";
    const primaryLabel = isLoading ?
        "Subiendo..." :
        isConfirming ?
        "Confirmar subida" :
        "Subir datos locales";

    return `
        <div class="firebase-migration-panel">
            <strong>Migracion inicial</strong>
            <p>
                Se subiran <b>${keyCount}</b> registros locales al entorno
                <b>${escapeHTML(currentWorkspace.name)}</b>. Esto crea una copia
                de respaldo en Firebase y no cambia aun el uso principal del sistema.
            </p>
            ${migrationStatusHTML()}
            <div class="firebase-migration-actions">
                <button class="primary-button" type="button" data-action="${primaryAction}" ${isLoading ? "disabled" : ""}>
                    ${primaryLabel}
                </button>
                ${isConfirming ? `
                    <button class="secondary-button" type="button" data-action="cancel-local-snapshot-upload">
                        Cancelar
                    </button>
                ` : ""}
            </div>
        </div>
    `;
}

function renderSignedInModal(backdrop) {
    backdrop.innerHTML = `
        <section class="turn-change-dialog firebase-dialog">
            <strong>Cuenta y entornos</strong>
            <p>
                ${escapeHTML(currentUser.displayName || currentUser.email || "Usuario")}
                ${currentWorkspace ? `trabajando en ${escapeHTML(currentWorkspace.name)}.` : "sin entorno activo."}
            </p>

            <div class="firebase-dialog-grid">
                <label class="firebase-field">
                    <span>Crear entorno nuevo</span>
                    <input id="firebaseCreateWorkspaceName" type="text" placeholder="Ej: UCI Hospital Central">
                    <button class="primary-button" type="button" data-action="create-workspace">Crear entorno</button>
                </label>

                <label class="firebase-field">
                    <span>Unirse a entorno existente</span>
                    <input id="firebaseJoinWorkspaceId" type="text" placeholder="Pega el ID del entorno">
                    <button class="secondary-button" type="button" data-action="join-workspace">Unirme</button>
                </label>
            </div>

            <div class="firebase-workspace-list">
                ${workspaceListHTML()}
            </div>

            ${migrationPanelHTML()}

            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="sign-out">Cerrar sesion</button>
                <button class="primary-button" type="button" data-action="close">Cerrar</button>
            </div>
        </section>
    `;

    bindModalActions(backdrop);
}

function renderSignedOutModal(backdrop) {
    backdrop.innerHTML = `
        <section class="turn-change-dialog firebase-dialog">
            <strong>Iniciar sesion</strong>
            <p>
                Ingresa con tu cuenta Google para crear un entorno de trabajo
                o unirte a uno existente.
            </p>
            <div class="firebase-dialog-note">
                Hasta configurar Firebase, el sistema seguira usando localStorage.
            </div>
            <div class="turn-change-dialog__actions">
                <button class="primary-button" type="button" data-action="sign-in">Ingresar con Google</button>
                <button class="secondary-button" type="button" data-action="close">Cancelar</button>
            </div>
        </section>
    `;

    bindModalActions(backdrop);
}

async function refreshWorkspaces() {
    if (!currentUser || !isFirebaseConfigured()) {
        workspaceList = [];
        return;
    }

    workspaceList = await listUserWorkspaces(currentUser);
    currentWorkspace = getActiveWorkspace();
}

async function handleAction(action, backdrop) {
    try {
        if (action === "close") {
            closeModal(backdrop);
            return;
        }

        if (action === "sign-in") {
            await signInWithGoogle();
            closeModal(backdrop);
            return;
        }

        if (action === "sign-out") {
            await signOutFirebase();
            setActiveWorkspace(null);
            currentWorkspace = null;
            workspaceList = [];
            migrationState = { mode: "idle", message: "" };
            closeModal(backdrop);
            updateTopbar();
            options.onWorkspaceChange?.(currentWorkspace);
            return;
        }

        if (action === "prepare-local-snapshot-upload") {
            if (!currentWorkspace) {
                throw new Error(
                    "Selecciona un entorno antes de subir los datos locales."
                );
            }

            migrationState = {
                mode: "confirm",
                message:
                    "Confirma solo si este es el entorno correcto. La copia local se mantendra intacta."
            };
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "cancel-local-snapshot-upload") {
            migrationState = { mode: "idle", message: "" };
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "upload-local-snapshot") {
            migrationState = {
                mode: "loading",
                message: "Subiendo copia local a Firebase..."
            };
            renderSignedInModal(backdrop);

            const result = await uploadLocalSnapshotToActiveWorkspace();

            migrationState = {
                mode: "success",
                message:
                    `Copia subida correctamente (${result.keyCount} registros locales).`
            };
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "create-workspace") {
            const input = backdrop.querySelector(
                "#firebaseCreateWorkspaceName"
            );

            currentWorkspace =
                await createWorkspace(currentUser, input?.value);
            await refreshWorkspaces();
            migrationState = { mode: "idle", message: "" };
            updateTopbar();
            options.onWorkspaceChange?.(currentWorkspace);
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "join-workspace") {
            const input = backdrop.querySelector(
                "#firebaseJoinWorkspaceId"
            );

            currentWorkspace =
                await joinWorkspace(currentUser, input?.value);
            await refreshWorkspaces();
            migrationState = { mode: "idle", message: "" };
            updateTopbar();
            options.onWorkspaceChange?.(currentWorkspace);
            renderSignedInModal(backdrop);
        }
    } catch (error) {
        alert(error.message || "No se pudo completar la accion.");
    }
}

function bindModalActions(backdrop) {
    backdrop.querySelectorAll("[data-action]").forEach(button => {
        button.onclick = () =>
            handleAction(button.dataset.action, backdrop);
    });

    backdrop.querySelectorAll("[data-workspace-id]").forEach(button => {
        button.onclick = () => {
            const workspace = workspaceList.find(item =>
                item.id === button.dataset.workspaceId
            );

            if (!workspace) return;

            currentWorkspace = workspace;
            setActiveWorkspace(workspace);
            migrationState = { mode: "idle", message: "" };
            updateTopbar();
            options.onWorkspaceChange?.(currentWorkspace);
            renderSignedInModal(backdrop);
        };
    });
}

async function openFirebaseModal() {
    if (!isFirebaseConfigured()) {
        renderDisabledModal();
        return;
    }

    const backdrop = createModal();

    if (!currentUser) {
        renderSignedOutModal(backdrop);
        return;
    }

    await refreshWorkspaces();
    renderSignedInModal(backdrop);
}

export async function initFirebaseShell(initOptions = {}) {
    options = initOptions;

    updateTopbar();

    options.userChip?.addEventListener("click", () => {
        openFirebaseModal();
    });

    if (!isFirebaseConfigured()) return;

    try {
        await onFirebaseAuthChanged(async user => {
            currentUser = user;

            if (user) {
                await ensureFirebaseUser(user);
                await refreshWorkspaces();
            } else {
                workspaceList = [];
                currentWorkspace = null;
            }

            updateTopbar();
            options.onAuthChange?.(user);
            options.onWorkspaceChange?.(currentWorkspace);
        });
    } catch (error) {
        console.warn("No se pudo inicializar Firebase.", error);
        updateTopbar();
    }
}
