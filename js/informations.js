import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    ATTACHMENT_ACCEPT,
    MAX_ATTACHMENT_FILES,
    attachmentStorageErrorMessage,
    canPreviewAttachment,
    deleteStoredAttachment,
    hasAttachmentContent,
    openAttachmentFile,
    readAttachmentFiles
} from "./attachmentUtils.js";
import {
    getCurrentFirebaseUser,
    getFirebaseServices,
    isFirebaseConfigured
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import { canEditMenu } from "./workspacePermissions.js";
import { showConfirm } from "./dialogs.js";

export const INFORMATIONS_KEY = "informations";
const PUBLISHED_DOC_ID = "informations";
const MAX_TITLE_LENGTH = 140;
const MAX_BODY_LENGTH = 5000;
const MAX_ITEMS = 200;

let editingInformationId = "";
let savingInformation = false;

function makeId(prefix = "info") {
    return globalThis.crypto?.randomUUID?.() ||
        `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
}

function clampText(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
}

function normalizeAttachment(attachment = {}) {
    const name = clampText(attachment.name, 240);
    const dataUrl = String(attachment.dataUrl || "");
    const storagePath = String(attachment.storagePath || "");
    const downloadURL = String(attachment.downloadURL || "");

    if (!name || (!dataUrl && !storagePath && !downloadURL)) return null;

    return {
        id: String(attachment.id || makeId("info_file")),
        name,
        type: String(attachment.type || "application/octet-stream")
            .toLowerCase(),
        size: Number(attachment.size) || 0,
        addedAt: String(
            attachment.addedAt ||
            attachment.attachedAt ||
            new Date().toISOString()
        ),
        dataUrl,
        storagePath,
        downloadURL,
        uploadedByUid: String(attachment.uploadedByUid || "")
    };
}

function isImageAttachment(attachment = {}) {
    const type = String(attachment.type || "").toLowerCase();
    const name = String(attachment.name || "").toLowerCase();

    return type.startsWith("image/") ||
        /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/.test(name);
}

function informationType(item = {}) {
    const attachments = Array.isArray(item.attachments)
        ? item.attachments
        : [];

    if (attachments.some(isImageAttachment)) return "image";
    if (attachments.length) return "document";

    return "announcement";
}

function informationTypeLabel(type) {
    if (type === "image") return "Imagen";
    if (type === "document") return "Documento";
    return "Anuncio";
}

function informationTypeTone(type) {
    if (type === "image") return "green";
    if (type === "document") return "blue";
    return "orange";
}

function normalizeInformation(item = {}) {
    const createdAt = String(item.createdAt || new Date().toISOString());
    const updatedAt = String(item.updatedAt || item.publishedAt || createdAt);
    const attachments = Array.isArray(item.attachments)
        ? item.attachments.map(normalizeAttachment).filter(Boolean)
        : [];
    const normalized = {
        id: String(item.id || makeId()),
        title: clampText(item.title || "Informacion", MAX_TITLE_LENGTH),
        body: clampText(item.body || item.message || "", MAX_BODY_LENGTH),
        pinned: Boolean(item.pinned),
        status: "published",
        createdAt,
        updatedAt,
        publishedAt: String(item.publishedAt || updatedAt),
        createdByUid: String(item.createdByUid || ""),
        updatedByUid: String(item.updatedByUid || ""),
        attachments
    };

    normalized.type = informationType(normalized);

    return normalized;
}

function sortInformations(a, b) {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

    return new Date(b.publishedAt || b.updatedAt || b.createdAt) -
        new Date(a.publishedAt || a.updatedAt || a.createdAt);
}

export function normalizeInformations(value = []) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeInformation)
        .filter(item => item.title || item.body || item.attachments.length)
        .sort(sortInformations)
        .slice(0, MAX_ITEMS);
}

export function getInformations() {
    return normalizeInformations(getJSON(INFORMATIONS_KEY, []));
}

function publicAttachmentPayload(attachment = {}) {
    const normalized = normalizeAttachment(attachment);

    if (!normalized) return null;

    return {
        id: normalized.id,
        name: normalized.name,
        type: normalized.type,
        size: normalized.size,
        addedAt: normalized.addedAt,
        storagePath: normalized.storagePath,
        downloadURL: normalized.downloadURL,
        uploadedByUid: normalized.uploadedByUid
    };
}

export function publicInformationsPayload(items = getInformations()) {
    return normalizeInformations(items).map(item => ({
        id: item.id,
        title: item.title,
        body: item.body,
        type: informationType(item),
        pinned: item.pinned,
        status: "published",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        publishedAt: item.publishedAt,
        createdByUid: item.createdByUid,
        updatedByUid: item.updatedByUid,
        attachments: item.attachments
            .map(publicAttachmentPayload)
            .filter(attachment =>
                attachment &&
                (attachment.storagePath || attachment.downloadURL)
            )
    }));
}

function dispatchInformationsChanged() {
    if (typeof window === "undefined") return;

    window.dispatchEvent(new CustomEvent("proturnos:informationsChanged"));
}

export async function publishInformationsToWorkers(items = getInformations()) {
    const workspace = getActiveWorkspace();

    if (!isFirebaseConfigured() || !workspace?.id) {
        return false;
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const now = new Date().toISOString();
    const payload = publicInformationsPayload(items);
    const ref = firestoreModule.doc(
        db,
        "workspaces",
        workspace.id,
        "published",
        PUBLISHED_DOC_ID
    );

    await firestoreModule.setDoc(ref, {
        workspaceId: workspace.id,
        workspaceName: workspace.name || "",
        items: payload,
        updatedAt: typeof firestoreModule.serverTimestamp === "function"
            ? firestoreModule.serverTimestamp()
            : now,
        updatedAtISO: now,
        updatedByUid: getCurrentFirebaseUser()?.uid || ""
    }, { merge: true });

    return true;
}

async function saveInformations(items, options = {}) {
    const normalized = normalizeInformations(items);

    setJSON(INFORMATIONS_KEY, normalized);
    dispatchInformationsChanged();

    if (options.publish !== false) {
        await publishInformationsToWorkers(normalized);
    }

    return normalized;
}

function formatDateTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Sin fecha";

    return date.toLocaleString("es-CL", {
        dateStyle: "short",
        timeStyle: "short"
    });
}

function formatBytes(value) {
    const bytes = Number(value) || 0;

    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileButtonsHTML(item, attachment) {
    const preview = canPreviewAttachment(attachment);

    return `
        <span class="information-file">
            <span class="information-file__meta">
                <strong>${escapeHTML(attachment.name)}</strong>
                <small>${escapeHTML(formatBytes(attachment.size))}</small>
            </span>
            <button class="information-file__button" type="button" data-info-open="${escapeAttribute(item.id)}" data-info-file="${escapeAttribute(attachment.id)}">
                ${preview ? "Ver" : "Abrir"}
            </button>
            <button class="information-file__button ghost" type="button" data-info-download="${escapeAttribute(item.id)}" data-info-file="${escapeAttribute(attachment.id)}">
                Descargar
            </button>
            ${canEditMenu("informations") ? `
                <button class="information-file__remove" type="button" data-info-remove-file="${escapeAttribute(item.id)}" data-info-file="${escapeAttribute(attachment.id)}" aria-label="Quitar ${escapeAttribute(attachment.name)}">
                    &times;
                </button>
            ` : ""}
        </span>
    `;
}

function informationCardHTML(item) {
    const type = informationType(item);
    const attachments = Array.isArray(item.attachments)
        ? item.attachments
        : [];
    const editable = canEditMenu("informations");

    return `
        <article class="information-card ${item.pinned ? "is-pinned" : ""}">
            <div class="information-card__head">
                <div>
                    <span class="worker-request-type information-type information-type--${escapeAttribute(informationTypeTone(type))}">
                        ${escapeHTML(informationTypeLabel(type))}
                    </span>
                    <h4>${escapeHTML(item.title)}</h4>
                    <small>${escapeHTML(formatDateTime(item.publishedAt || item.updatedAt))}</small>
                </div>
                ${item.pinned ? `<span class="information-pin">Fijado</span>` : ""}
            </div>
            ${item.body ? `<p class="information-body">${escapeHTML(item.body)}</p>` : ""}
            <div class="information-files">
                ${attachments.length
                    ? attachments.map(attachment =>
                        fileButtonsHTML(item, attachment)
                    ).join("")
                    : `<small>Sin archivos adjuntos.</small>`}
            </div>
            ${editable ? `
                <div class="information-actions">
                    <button class="secondary-button" type="button" data-info-edit="${escapeAttribute(item.id)}">Editar</button>
                    <button class="danger-action" type="button" data-info-delete="${escapeAttribute(item.id)}">Eliminar</button>
                </div>
            ` : ""}
        </article>
    `;
}

function editorHTML(items) {
    const editable = canEditMenu("informations");

    if (!editable) {
        return `
            <section class="panel information-editor information-editor--readonly">
                <strong>Solo lectura</strong>
                <p>Tu usuario puede revisar las informaciones publicadas, pero no modificarlas.</p>
            </section>
        `;
    }

    const editing = editingInformationId
        ? items.find(item => item.id === editingInformationId)
        : null;

    return `
        <section class="panel information-editor">
            <div class="information-editor__head">
                <div>
                    <h3>${editing ? "Editar informacion" : "Nueva informacion"}</h3>
                    <p>Publica anuncios, imagenes o documentos visibles en la PWA.</p>
                </div>
                ${editing ? `
                    <button class="ghost-button" type="button" data-info-new>Cancelar edicion</button>
                ` : ""}
            </div>
            <form class="information-form" data-info-form data-edit-id="${escapeAttribute(editing?.id || "")}">
                <label>
                    <span>Titulo</span>
                    <input name="title" type="text" maxlength="${MAX_TITLE_LENGTH}" value="${escapeAttribute(editing?.title || "")}" placeholder="Titulo de la publicacion" ${savingInformation ? "disabled" : ""} required>
                </label>
                <label>
                    <span>Anuncio</span>
                    <textarea name="body" rows="5" maxlength="${MAX_BODY_LENGTH}" placeholder="Escribe el anuncio para los trabajadores" ${savingInformation ? "disabled" : ""}>${escapeHTML(editing?.body || "")}</textarea>
                </label>
                <label class="information-file-input">
                    <span>Imagenes o documentos</span>
                    <input name="files" type="file" multiple accept="${ATTACHMENT_ACCEPT}" ${savingInformation ? "disabled" : ""}>
                    <small>Hasta ${MAX_ATTACHMENT_FILES} archivos. Imagenes, PDF, texto, Word o Excel.</small>
                </label>
                <label class="information-pin-toggle">
                    <input name="pinned" type="checkbox" ${editing?.pinned ? "checked" : ""} ${savingInformation ? "disabled" : ""}>
                    <span>Fijar arriba</span>
                </label>
                <div class="information-editor__actions">
                    <button class="primary-button" type="submit" ${savingInformation ? "disabled" : ""}>
                        ${savingInformation ? "Publicando..." : editing ? "Guardar cambios" : "Publicar"}
                    </button>
                    <button class="secondary-button" type="button" data-info-new ${savingInformation ? "disabled" : ""}>Limpiar</button>
                </div>
            </form>
        </section>
    `;
}

export function renderInformationsPanel() {
    if (typeof document === "undefined") return;

    const panel = document.getElementById("informationsPanel");

    if (!panel) return;

    const items = getInformations();
    const publishedFiles = items.reduce(
        (count, item) => count + (item.attachments?.length || 0),
        0
    );

    panel.innerHTML = `
        <div class="information-root">
            <div class="section-head section-head--with-action information-head">
                <span class="section-head__title">
                    <h3>Informaciones</h3>
                    <small>Publicaciones visibles para trabajadores en la PWA TurnoPlus.</small>
                </span>
                <span class="worker-request-counter">
                    ${items.length} publicacion(es) / ${publishedFiles} archivo(s)
                </span>
            </div>
            <div class="information-grid">
                ${editorHTML(items)}
                <section class="panel information-list-panel">
                    <div class="information-list-head">
                        <h3>Publicado</h3>
                        <small>Los trabajadores enlazados pueden ver y descargar estos archivos.</small>
                    </div>
                    <div class="information-list">
                        ${items.length
                            ? items.map(informationCardHTML).join("")
                            : `
                                <div class="empty-state empty-state--compact">
                                    Aun no hay informaciones publicadas.
                                </div>
                            `}
                    </div>
                </section>
            </div>
        </div>
    `;

    bindInformationsPanel(panel);
}

async function uploadInformationFiles(files, informationId) {
    if (!files?.length) return [];

    return readAttachmentFiles(files, {
        moduleId: "informations",
        ownerId: "published",
        recordId: informationId
    });
}

async function handleSubmit(form) {
    const title = clampText(form.elements.title?.value, MAX_TITLE_LENGTH);
    const body = clampText(form.elements.body?.value, MAX_BODY_LENGTH);
    const editId = String(form.dataset.editId || "");
    const items = getInformations();
    const current = editId
        ? items.find(item => item.id === editId)
        : null;
    const id = current?.id || makeId();
    const files = Array.from(form.elements.files?.files || []);

    if (!title) {
        alert("Ingresa un titulo para publicar.");
        return;
    }

    if (!body && !files.length && !current?.attachments?.length) {
        alert("Agrega un anuncio o al menos un archivo.");
        return;
    }

    savingInformation = true;
    Array.from(form.querySelectorAll("input, textarea, button")).forEach(control => {
        control.disabled = true;
    });

    try {
        const uploaded = await uploadInformationFiles(files, id);
        const now = new Date().toISOString();
        const user = getCurrentFirebaseUser();
        const nextItem = normalizeInformation({
            ...(current || {}),
            id,
            title,
            body,
            pinned: Boolean(form.elements.pinned?.checked),
            createdAt: current?.createdAt || now,
            publishedAt: now,
            updatedAt: now,
            createdByUid: current?.createdByUid || user?.uid || "",
            updatedByUid: user?.uid || "",
            attachments: [
                ...(current?.attachments || []),
                ...uploaded
            ]
        });
        const nextItems = current
            ? items.map(item => item.id === current.id ? nextItem : item)
            : [nextItem, ...items];

        await saveInformations(nextItems);
        editingInformationId = "";
    } catch (error) {
        console.error("No se pudo publicar la informacion.", error);
        alert(
            error?.attachmentStorageMessage || String(error?.code || "").startsWith("storage/")
                ? attachmentStorageErrorMessage(error, "subir")
                : error?.message ||
                    "No se pudo publicar la informacion. Revisa la conexion e intenta nuevamente."
        );
    } finally {
        savingInformation = false;
        renderInformationsPanel();
    }
}

function findInformationAttachment(infoId, attachmentId) {
    const item = getInformations().find(information =>
        information.id === infoId
    );
    const attachment = item?.attachments?.find(file =>
        file.id === attachmentId
    );

    return { item, attachment };
}

async function openInformationAttachment(button, { newTab = true } = {}) {
    const { attachment } = findInformationAttachment(
        button.dataset.infoOpen || button.dataset.infoDownload,
        button.dataset.infoFile
    );

    if (!hasAttachmentContent(attachment)) return;

    button.disabled = true;
    try {
        await openAttachmentFile(attachment, { newTab });
    } catch (error) {
        alert(
            error?.attachmentStorageMessage
                ? error.message
                : error?.message || "No se pudo abrir el archivo."
        );
    } finally {
        button.disabled = false;
    }
}

async function removeInformationFile(button) {
    const infoId = button.dataset.infoRemoveFile;
    const fileId = button.dataset.infoFile;
    const items = getInformations();
    const item = items.find(information => information.id === infoId);
    const attachment = item?.attachments?.find(file => file.id === fileId);

    if (!item || !attachment) return;

    const ok = await showConfirm(
        `Se quitara el archivo "${attachment.name}" de la publicacion.`,
        {
            title: "Quitar archivo",
            tone: "danger",
            confirmText: "Quitar",
            destructive: true
        }
    );

    if (!ok) return;

    try {
        await deleteStoredAttachment(attachment);
        await saveInformations(items.map(information =>
            information.id === infoId
                ? normalizeInformation({
                    ...information,
                    attachments: information.attachments.filter(file =>
                        file.id !== fileId
                    ),
                    updatedAt: new Date().toISOString()
                })
                : information
        ));
    } catch (error) {
        console.error("No se pudo quitar el archivo.", error);
        alert(
            error?.attachmentStorageMessage
                ? error.message
                : "No se pudo quitar el archivo. Intenta nuevamente."
        );
    } finally {
        renderInformationsPanel();
    }
}

async function deleteInformation(id) {
    const items = getInformations();
    const item = items.find(information => information.id === id);

    if (!item) return;

    const ok = await showConfirm(
        "Se eliminara la publicacion y sus archivos adjuntos.",
        {
            title: "Eliminar informacion",
            tone: "danger",
            confirmText: "Eliminar",
            destructive: true
        }
    );

    if (!ok) return;

    try {
        await Promise.allSettled(
            (item.attachments || []).map(deleteStoredAttachment)
        );
        await saveInformations(items.filter(information =>
            information.id !== id
        ));

        if (editingInformationId === id) editingInformationId = "";
    } catch (error) {
        console.error("No se pudo eliminar la informacion.", error);
        alert(
            error?.message ||
            "No se pudo eliminar la informacion. Intenta nuevamente."
        );
    } finally {
        renderInformationsPanel();
    }
}

function bindInformationsPanel(panel) {
    const form = panel.querySelector("[data-info-form]");

    if (form) {
        form.onsubmit = event => {
            event.preventDefault();
            void handleSubmit(form);
        };
    }

    panel.querySelectorAll("[data-info-new]").forEach(button => {
        button.onclick = () => {
            editingInformationId = "";
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-edit]").forEach(button => {
        button.onclick = () => {
            editingInformationId = button.dataset.infoEdit || "";
            renderInformationsPanel();
        };
    });

    panel.querySelectorAll("[data-info-delete]").forEach(button => {
        button.onclick = () => {
            void deleteInformation(button.dataset.infoDelete);
        };
    });

    panel.querySelectorAll("[data-info-open]").forEach(button => {
        button.onclick = () => {
            void openInformationAttachment(button, { newTab: true });
        };
    });

    panel.querySelectorAll("[data-info-download]").forEach(button => {
        button.onclick = () => {
            void openInformationAttachment(button, { newTab: false });
        };
    });

    panel.querySelectorAll("[data-info-remove-file]").forEach(button => {
        button.onclick = () => {
            void removeInformationFile(button);
        };
    });
}

export function initInformationsPanel() {
    if (typeof window === "undefined") return;

    window.addEventListener("proturnos:informationsChanged", () => {
        if (document.body.dataset.activeView === "informations") {
            renderInformationsPanel();
        }
    });

    window.addEventListener("proturnos:persistenceChanged", event => {
        const keys = event.detail?.keys || [];

        if (
            keys.includes(INFORMATIONS_KEY) &&
            document.body.dataset.activeView === "informations"
        ) {
            renderInformationsPanel();
        }
    });

    window.addEventListener("proturnos:firebaseAppState", event => {
        const keys = event.detail?.keys || [];

        if (
            keys.includes(INFORMATIONS_KEY) &&
            document.body.dataset.activeView === "informations"
        ) {
            renderInformationsPanel();
        }
    });

    window.addEventListener("proturnos:workspacePermissionsChanged", () => {
        if (document.body.dataset.activeView === "informations") {
            renderInformationsPanel();
        }
    });
}
