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

function appShareURL() {
    if (typeof window === "undefined") return "";

    const url = new URL(window.location.href);

    url.search = "";
    url.hash = "";

    return url.toString();
}

function workspaceInviteURL(workspace) {
    const baseURL = appShareURL();

    if (!baseURL) return "";

    const url = new URL(baseURL);

    url.searchParams.set("joinWorkspace", workspace.id);

    return url.toString();
}

function pendingJoinWorkspaceId() {
    if (typeof window === "undefined") return "";

    return new URL(window.location.href)
        .searchParams
        .get("joinWorkspace") || "";
}

function clearPendingJoinWorkspaceId() {
    if (
        typeof window === "undefined" ||
        !window.history?.replaceState
    ) {
        return;
    }

    const url = new URL(window.location.href);

    if (!url.searchParams.has("joinWorkspace")) return;

    url.searchParams.delete("joinWorkspace");
    window.history.replaceState(
        {},
        "",
        `${url.pathname}${url.search}${url.hash}`
    );
}

function workspaceById(workspaceId) {
    return workspaceList.find(workspace =>
        workspace.id === workspaceId
    );
}

function workspaceInvitationText(workspace) {
    const inviteURL = workspaceInviteURL(workspace);

    return [
        `Te invito a unirte al entorno "${workspace.name || workspace.id}" en ProTurnos.`,
        "",
        inviteURL ? `Abre esta invitacion: ${inviteURL}` : "",
        "Inicia sesion con Google.",
        "Si el ID no aparece automaticamente, pegalo en Unirse a entorno existente:",
        workspace.id
    ].filter(Boolean).join("\n");
}

async function copyTextToClipboard(text) {
    if (
        navigator.clipboard &&
        window.isSecureContext
    ) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textArea = document.createElement("textarea");

    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    textArea.remove();
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
                Siguiente etapa: iniciar sesion, crear un entorno y sincronizar el estado completo del sistema.
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

    return workspaceList.map(workspace => {
        const isActive = currentWorkspace?.id === workspace.id;

        return `
            <article class="firebase-workspace-item ${isActive ? "is-active" : ""}">
                <div class="firebase-workspace-main">
                    <span>
                        <strong>${escapeHTML(workspace.name || workspace.id)}</strong>
                        <small>${escapeHTML(workspace.role || "member")}</small>
                    </span>
                    ${isActive ? `
                        <em>Activo</em>
                    ` : `
                        <button class="secondary-button firebase-workspace-use" type="button" data-workspace-select="${escapeHTML(workspace.id)}">
                            Usar
                        </button>
                    `}
                </div>

                <label class="firebase-workspace-id">
                    <span>ID del entorno</span>
                    <input type="text" readonly value="${escapeHTML(workspace.id)}">
                </label>

                <div class="firebase-workspace-actions">
                    <button class="secondary-button" type="button" data-action="copy-workspace-id" data-workspace-ref="${escapeHTML(workspace.id)}">
                        Copiar ID
                    </button>
                    <button class="secondary-button" type="button" data-action="copy-workspace-invite" data-workspace-ref="${escapeHTML(workspace.id)}">
                        Copiar invitacion
                    </button>
                    <button class="primary-button" type="button" data-action="email-workspace-invite" data-workspace-ref="${escapeHTML(workspace.id)}">
                        Enviar correo
                    </button>
                </div>
            </article>
        `;
    }).join("");
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

function friendlyFirebaseError(error) {
    const code = error?.code || "";

    if (code === "auth/unauthorized-domain") {
        const hostname =
            typeof window !== "undefined"
                ? window.location.hostname
                : "este dominio";

        return [
            `Firebase no permite iniciar sesion desde ${hostname}.`,
            "Agrega ese dominio en Firebase Console > Authentication > Settings > Authorized domains.",
            "Si estas usando ProTurnos localmente, agrega 127.0.0.1 y localhost, sin puerto."
        ].join(" ");
    }

    return error?.message || "No se pudo completar la accion.";
}

function migrationPanelHTML() {
    if (!currentWorkspace) {
        return `
            <div class="firebase-migration-panel">
                <strong>Sincronizacion del entorno</strong>
                <p>
                    Selecciona o crea un entorno para activar la sincronizacion
                    completa del sistema.
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
        "Guardando..." :
        isConfirming ?
        "Confirmar copia" :
        "Guardar copia manual";

    return `
        <div class="firebase-migration-panel">
            <strong>Sincronizacion del entorno</strong>
            <p>
                El entorno <b>${escapeHTML(currentWorkspace.name)}</b> sincroniza
                automaticamente el estado completo del sistema. Puedes crear ademas
                una copia manual con <b>${keyCount}</b> registros locales como respaldo.
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
    const pendingWorkspaceId = pendingJoinWorkspaceId();

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
                    <input id="firebaseJoinWorkspaceId" type="text" placeholder="Pega el ID del entorno" value="${escapeHTML(pendingWorkspaceId)}">
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
                Hasta iniciar sesion y elegir un entorno, el sistema seguira trabajando en este equipo.
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

async function handleAction(action, backdrop, sourceButton = null) {
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
                    "Confirma solo si este es el entorno correcto. Esto guarda una copia manual adicional; la sincronizacion automatica ya sigue activa."
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

        if (action === "copy-workspace-id") {
            const workspace = workspaceById(
                sourceButton?.dataset.workspaceRef
            );

            if (!workspace) return;

            await copyTextToClipboard(workspace.id);
            migrationState = {
                mode: "success",
                message: "ID del entorno copiado al portapapeles."
            };
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "copy-workspace-invite") {
            const workspace = workspaceById(
                sourceButton?.dataset.workspaceRef
            );

            if (!workspace) return;

            await copyTextToClipboard(
                workspaceInvitationText(workspace)
            );
            migrationState = {
                mode: "success",
                message: "Invitacion copiada al portapapeles."
            };
            renderSignedInModal(backdrop);
            return;
        }

        if (action === "email-workspace-invite") {
            const workspace = workspaceById(
                sourceButton?.dataset.workspaceRef
            );

            if (!workspace) return;

            const subject = encodeURIComponent(
                `Invitacion a ProTurnos - ${workspace.name || workspace.id}`
            );
            const body = encodeURIComponent(
                workspaceInvitationText(workspace)
            );

            window.location.href =
                `mailto:?subject=${subject}&body=${body}`;
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
            clearPendingJoinWorkspaceId();
            await refreshWorkspaces();
            migrationState = { mode: "idle", message: "" };
            updateTopbar();
            options.onWorkspaceChange?.(currentWorkspace);
            renderSignedInModal(backdrop);
        }
    } catch (error) {
        alert(friendlyFirebaseError(error));
    }
}

function bindModalActions(backdrop) {
    backdrop.querySelectorAll("[data-action]").forEach(button => {
        button.onclick = () =>
            handleAction(button.dataset.action, backdrop, button);
    });

    backdrop.querySelectorAll("[data-workspace-select]").forEach(button => {
        button.onclick = () => {
            const workspace = workspaceList.find(item =>
                item.id === button.dataset.workspaceSelect
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
