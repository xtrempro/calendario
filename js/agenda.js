import { normalizeText } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import { getJSON, setJSON } from "./persistence.js";
import {
    ATTACHMENT_ACCEPT,
    deleteStoredAttachment,
    openAttachmentFile,
    readAttachmentFile
} from "./attachmentUtils.js";
import { showConfirm } from "./dialogs.js";
import { AGENDA_SEED } from "./agendaSeed.js";

const STORAGE_KEY = "agenda_contacts";
const SEED_FLAG_KEY = "agenda_seeded_v1";
// v3: reemplaza el directorio institucional por la lista actualizada,
// descartando cualquier seed anterior (incluida la version de prueba con
// llamada movil) y conservando solo los contactos creados por el usuario.
const SEED_VERSION = 3;
const NEW_CONTACT = "__new_contact__";

let selectedContactId = null;
let agendaSearch = "";
let agendaUnit = "Todas";
let seedChecked = false;

// Carga inicial (una sola vez por version) del directorio institucional. Agrega
// los contactos del seed que falten (por id estable, sin duplicar) a lo que ya
// tenga el supervisor; luego cada uno edita/borra su propia copia local (la
// agenda no se sincroniza entre usuarios).
function ensureSeeded() {
    if (seedChecked) return;
    seedChecked = true;

    if (Number(getJSON(SEED_FLAG_KEY, 0)) >= SEED_VERSION) return;

    const existing = getJSON(STORAGE_KEY, []);
    const current = (Array.isArray(existing) ? existing : []).map(normalizeContact);
    const userContacts = current.filter(contact =>
        !contact.id.startsWith("agenda_seed") &&
        contact.id !== "agenda_clave_azul"
    );
    const seeded = AGENDA_SEED.map(
        ([unidad, cargo, name, telefono, email], index) =>
            normalizeContact({
                id: `agenda_seed_${index}`,
                unidad,
                cargo,
                name,
                extension: telefono,
                email
            }, index)
    );

    setJSON(STORAGE_KEY, [...seeded, ...userContacts]);
    setJSON(SEED_FLAG_KEY, SEED_VERSION);
}

function normalizeSearch(value) {
    return normalizeText(value);
}

function normalizeAttachment(attachment) {
    if (!attachment?.name) return null;

    return {
        id: String(attachment.id || `agenda_doc_${Date.now()}`),
        name: String(attachment.name || ""),
        type: String(attachment.type || ""),
        size: Number(attachment.size || 0),
        addedAt: attachment.addedAt || new Date().toISOString(),
        dataUrl: attachment.dataUrl || "",
        storagePath: attachment.storagePath || "",
        uploadedByUid: attachment.uploadedByUid || ""
    };
}

function normalizeContact(contact = {}, index = 0) {
    return {
        id: String(
            contact.id ||
                `agenda_${Date.now()}_${index}_${Math.random()
                    .toString(36)
                    .slice(2, 8)}`
        ),
        name: String(contact.name || "").trim(),
        unidad: String(contact.unidad || "").trim(),
        cargo: String(contact.cargo || "").trim(),
        email: String(contact.email || "").trim(),
        extension: String(contact.extension || "").trim(),
        mobile: String(contact.mobile || "").trim(),
        notes: String(contact.notes || "").trim(),
        attachment: normalizeAttachment(contact.attachment),
        createdAt: contact.createdAt || new Date().toISOString(),
        updatedAt:
            contact.updatedAt ||
            contact.createdAt ||
            new Date().toISOString()
    };
}

function hasContactData(contact) {
    return Boolean(contact.name || contact.cargo || contact.unidad);
}

function getContacts() {
    ensureSeeded();

    const raw = getJSON(STORAGE_KEY, []);
    const contacts = Array.isArray(raw) ? raw : [];

    return contacts
        .map(normalizeContact)
        .filter(hasContactData)
        .sort((a, b) =>
            a.name.localeCompare(b.name) ||
            a.unidad.localeCompare(b.unidad) ||
            a.cargo.localeCompare(b.cargo)
        );
}

function saveContacts(contacts) {
    setJSON(
        STORAGE_KEY,
        contacts
            .map(normalizeContact)
            .filter(hasContactData)
    );
}

function getInitials(name) {
    const parts = String(name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

function avatarClass(contact) {
    const source = contact.id || contact.name || "";
    let hash = 0;
    for (let i = 0; i < source.length; i++) {
        hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
    }
    return `ag-av-${(hash % 6) + 1}`;
}

function displayName(contact) {
    return contact.name || contact.cargo || contact.unidad || "Contacto";
}

async function openAttachment(attachment) {
    try {
        await openAttachmentFile(attachment, { newTab: true });
    } catch (error) {
        alert(error?.message || "No se pudo abrir el adjunto.");
    }
}

function matchesSearch(contact, query) {
    if (!query) return true;
    return [
        contact.name,
        contact.cargo,
        contact.unidad,
        contact.email,
        contact.extension,
        contact.mobile
    ].some(value => {
        const raw = String(value || "");
        return normalizeSearch(raw).includes(query) ||
            raw.replace(/\s+/g, "").includes(query.replace(/\s+/g, ""));
    });
}

function filterContacts(contacts) {
    const query = normalizeSearch(agendaSearch);
    return contacts.filter(contact =>
        (agendaUnit === "Todas" || contact.unidad === agendaUnit) &&
        matchesSearch(contact, query)
    );
}

function getUnits(contacts) {
    const counts = new Map();
    contacts.forEach(contact => {
        const unit = contact.unidad || "Sin unidad";
        counts.set(unit, (counts.get(unit) || 0) + 1);
    });
    return [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]));
}

function getSelectedContact(contacts) {
    return (
        contacts.find(contact => contact.id === selectedContactId) ||
        filterContacts(contacts)[0] ||
        contacts[0] ||
        null
    );
}

/* ---------- Iconos ---------- */
function svg(paths) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
const IC = {
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 16.9z"/>',
    mail: '<path d="M4 4h16v16H4z"/><path d="m4 6 8 6 8-6"/>',
    anexo: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 8v8M11 8v8M15 12h2"/>',
    unit: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>'
};

/* ---------- Render ---------- */
function renderChips(contacts) {
    const total = contacts.length;
    const unitList = getUnits(contacts); // alfabetico [ [unit, count] ]
    const countMap = new Map(unitList.map(([u, c]) => [u, c]));
    const byCount = [...unitList].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
    // La unidad activa siempre visible (primera despues de "Todas").
    const activeUnit =
        agendaUnit !== "Todas" && countMap.has(agendaUnit) ? agendaUnit : null;
    const ordered = activeUnit
        ? [[activeUnit, countMap.get(activeUnit)], ...byCount.filter(([u]) => u !== activeUnit)]
        : byCount;

    const chip = (unit, count, label) =>
        `<button class="ag-chip ${agendaUnit === unit ? "is-active" : ""}" type="button" data-ag-unit="${escapeHTML(unit)}"><span class="ag-chip-dot"></span>${escapeHTML(label || unit)}<span class="ag-chip-count">${count}</span></button>`;

    const barChips = [
        chip("Todas", total, "Todas"),
        ...ordered.map(([u, c]) => chip(u, c))
    ].join("");

    const moreBtn = `<button class="ag-chip ag-chip--more" type="button" data-ag-more hidden>Más unidades <span class="ag-chip-count" data-ag-more-count></span></button>`;

    const popItems = unitList.map(([u, c]) =>
        `<button class="ag-more-item ${agendaUnit === u ? "is-active" : ""}" type="button" data-ag-unit="${escapeHTML(u)}"><span>${escapeHTML(u)}</span><span class="ag-chip-count">${c}</span></button>`
    ).join("");

    return `
        <div class="ag-chips-wrap" data-ag-chips-wrap>
            <div class="ag-chips" data-ag-chips>${barChips}${moreBtn}</div>
            <div class="ag-more-pop" data-ag-more-pop hidden>
                <label class="ag-more-search">${svg(IC.search)}<input data-ag-more-search type="search" placeholder="Buscar unidad..."></label>
                <div class="ag-more-list" data-ag-more-list>${popItems}</div>
            </div>
        </div>
    `;
}

// Deja en la barra solo los chips que caben en una fila; el resto pasa al
// botón "Más unidades" (se recalcula al renderizar y al cambiar el ancho).
function collapseChips(root) {
    const bar = root.querySelector("[data-ag-chips]");
    if (!bar) return;
    const more = bar.querySelector("[data-ag-more]");
    const chips = [...bar.querySelectorAll(".ag-chip:not(.ag-chip--more)")];
    chips.forEach(c => { c.style.display = ""; });
    if (more) more.hidden = true;

    const barWidth = bar.clientWidth;
    if (!barWidth || !chips.length) return;

    const gap = 8;
    const widths = chips.map(c => c.offsetWidth);
    const fitCount = budget => {
        let used = 0;
        let n = 0;
        for (let i = 0; i < chips.length; i++) {
            const w = widths[i] + (i > 0 ? gap : 0);
            if (used + w <= budget) { used += w; n++; } else break;
        }
        return n;
    };

    if (fitCount(barWidth) >= chips.length) return; // caben todos

    if (more) more.hidden = false;
    const reserve = (more ? more.offsetWidth : 0) + gap;
    const n = Math.max(1, fitCount(barWidth - reserve));
    chips.slice(n).forEach(c => { c.style.display = "none"; });
    if (more) {
        more.hidden = false;
        const countEl = more.querySelector("[data-ag-more-count]");
        if (countEl) countEl.textContent = chips.length - n;
    }
}

function renderContactItem(contact) {
    const active = contact.id === selectedContactId;
    const meta = [contact.cargo, contact.unidad].filter(Boolean).join(" · ")
        || contact.email || "Sin datos";
    return `
        <div class="ag-item ${active ? "is-active" : ""}" data-ag-contact="${escapeHTML(contact.id)}">
            <span class="ag-avatar ${avatarClass(contact)}">${escapeHTML(getInitials(displayName(contact)))}</span>
            <div class="ag-item__body">
                <div class="ag-item__name">${escapeHTML(displayName(contact))}</div>
                <div class="ag-item__meta">${escapeHTML(meta)}</div>
            </div>
            <div class="ag-item__actions">
                ${contact.mobile
                    ? `<a class="ag-mini call" href="tel:${escapeHTML(contact.mobile)}" title="Llamar" data-ag-stop>${svg(IC.phone)}</a>`
                    : ""}
                ${contact.email
                    ? `<a class="ag-mini mail" href="mailto:${escapeHTML(contact.email)}" title="Correo" data-ag-stop>${svg(IC.mail)}</a>`
                    : ""}
            </div>
        </div>
    `;
}

function renderListMarkup(contacts) {
    const visible = filterContacts(contacts);
    if (!contacts.length) {
        return `<div class="ag-empty">Sin contactos registrados.</div>`;
    }
    if (!visible.length) {
        return `<div class="ag-empty">Sin contactos que coincidan con la búsqueda.</div>`;
    }
    return visible.map(renderContactItem).join("");
}

function detailField(icoClass, icon, label, value, opts = {}) {
    if (!value) return "";
    const link = opts.href
        ? `href="${escapeHTML(opts.href)}"`
        : "";
    const valueTag = opts.href
        ? `<a class="ag-field__value ${opts.num ? "num" : ""}" ${link}>${escapeHTML(value)}</a>`
        : `<div class="ag-field__value ${opts.num ? "num" : ""}">${escapeHTML(value)}</div>`;
    return `
        <div class="ag-field">
            <span class="ag-field__ico ${icoClass}">${svg(icon)}</span>
            <div class="ag-field__body">
                <div class="ag-field__label">${escapeHTML(label)}</div>
                ${valueTag}
            </div>
            <button class="ag-copy" type="button" title="Copiar" data-ag-copy="${escapeHTML(value)}">${svg(IC.copy)}</button>
        </div>
    `;
}

function renderDetailMarkup(contact) {
    if (!contact) {
        return `
            <div class="ag-detail-empty">
                <span class="ag-avatar ag-av-1">${svg(IC.users)}</span>
                <p>Selecciona un contacto o crea uno nuevo.</p>
            </div>
        `;
    }

    const attachment = contact.attachment
        ? `
            <div class="ag-attach">
                ${svg(IC.download)}
                <span>${escapeHTML(contact.attachment.name)}</span>
                <button class="ag-attach-btn" type="button" data-ag-view-attachment>Ver</button>
                <button class="ag-attach-btn ghost" type="button" data-ag-remove-attachment>Quitar</button>
            </div>
        `
        : `<div class="ag-attach ag-attach--empty">${svg(IC.download)} Sin archivo adjunto.</div>`;

    return `
        <div class="ag-detail__top">
            <span class="ag-avatar ${avatarClass(contact)}">${escapeHTML(getInitials(displayName(contact)))}</span>
            <div class="ag-detail__id">
                <h2>${escapeHTML(displayName(contact))}</h2>
                ${contact.cargo ? `<span class="ag-tag">${escapeHTML(contact.cargo)}</span>` : ""}
                ${contact.unidad ? `<div class="ag-detail__unit">${svg(IC.unit)} ${escapeHTML(contact.unidad)}</div>` : ""}
            </div>
        </div>

        <div class="ag-actions">
            ${contact.mobile ? `<a class="ag-btn ag-btn--call" href="tel:${escapeHTML(contact.mobile)}">${svg(IC.phone)} Llamar</a>` : ""}
            ${contact.email ? `<a class="ag-btn ag-btn--mail" href="mailto:${escapeHTML(contact.email)}">${svg(IC.mail)} Enviar correo</a>` : ""}
            <button class="ag-btn ag-btn--ghost" type="button" data-ag-edit>${svg(IC.edit)} Editar</button>
            <button class="ag-btn ag-btn--ghost" type="button" data-ag-delete>${svg(IC.trash)} Eliminar</button>
        </div>

        <div class="ag-fields">
            ${detailField("ico-mail", IC.mail, "Correo", contact.email, { href: `mailto:${contact.email}` })}
            ${detailField("ico-phone", IC.phone, "Celular", contact.mobile, { href: `tel:${contact.mobile}`, num: true })}
            ${detailField("ico-anexo", IC.anexo, "Anexo", contact.extension, { num: true })}
            ${detailField("ico-unit", IC.unit, "Unidad", contact.unidad)}
        </div>

        <div class="ag-notes">
            <div class="ag-notes__label">Notas</div>
            <div class="ag-notes__box">${contact.notes ? escapeHTML(contact.notes) : "Sin notas."}</div>
        </div>

        ${attachment}
    `;
}

function renderModal() {
    return `
        <div class="ag-modal-backdrop" data-ag-modal hidden>
            <div class="ag-modal" role="dialog" aria-modal="true" aria-label="Contacto">
                <div class="ag-modal__head">
                    <span class="ag-modal__ico">${svg(IC.users)}</span>
                    <h3 data-ag-modal-title>Nuevo contacto</h3>
                    <button class="ag-modal__close" type="button" data-ag-modal-close aria-label="Cerrar">&times;</button>
                </div>
                <form class="ag-modal__body" data-ag-form autocomplete="off">
                    <div class="ag-form-grid">
                        <label class="ag-full">Nombre
                            <input name="name" type="text" maxlength="120" placeholder="Nombre del contacto">
                        </label>
                        <label>Unidad
                            <input name="unidad" type="text" maxlength="160" placeholder="Unidad" list="agUnitOptions">
                        </label>
                        <label>Cargo
                            <input name="cargo" type="text" maxlength="160" placeholder="Cargo">
                        </label>
                        <label>Correo
                            <input name="email" type="email" maxlength="160" placeholder="correo@ejemplo.cl">
                        </label>
                        <label>Celular
                            <input name="mobile" type="tel" maxlength="40" placeholder="+569...">
                        </label>
                        <label>Anexo
                            <input name="extension" type="text" maxlength="40" placeholder="Anexo">
                        </label>
                        <label>Archivo adjunto
                            <input name="attachment" type="file" accept="${ATTACHMENT_ACCEPT}">
                        </label>
                        <label class="ag-full">Notas
                            <textarea name="notes" rows="4" maxlength="900" placeholder="Notas del contacto"></textarea>
                        </label>
                    </div>
                    <datalist id="agUnitOptions"></datalist>
                    <div class="ag-modal__foot">
                        <button class="ag-btn ag-btn--ghost" type="button" data-ag-modal-close>Cancelar</button>
                        <button class="ag-btn ag-btn--primary" type="submit">Guardar contacto</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderView() {
    const contacts = getContacts();
    const selected = getSelectedContact(contacts);
    if (selected) selectedContactId = selected.id;
    const visibleCount = filterContacts(contacts).length;

    return `
        <div class="ag-root">
            <div class="ag-head">
                <div class="ag-title">
                    <span class="ag-mk">${svg(IC.users)}</span>
                    <div>
                        <h1>Contactos</h1>
                        <p>Agenda de la unidad · ${contacts.length} contactos</p>
                    </div>
                </div>
                <label class="ag-search">
                    ${svg(IC.search)}
                    <input data-ag-search type="search" placeholder="Buscar por nombre, cargo o número..." value="${escapeHTML(agendaSearch)}">
                </label>
                <button class="ag-new" type="button" data-ag-new>${svg(IC.plus)} Nuevo contacto</button>
            </div>

            ${renderChips(contacts)}

            <div class="ag-grid">
                <section class="panel ag-list-panel">
                    <div class="ag-list-head">
                        <h2>Directorio</h2>
                        <span data-ag-count>${visibleCount} de ${contacts.length}</span>
                    </div>
                    <div class="ag-list" data-ag-list>${renderListMarkup(contacts)}</div>
                </section>

                <section class="panel ag-detail" data-ag-detail>${renderDetailMarkup(selected)}</section>
            </div>
        </div>
        ${renderModal()}
    `;
}

/* ---------- Modal open/close ---------- */
function fillUnitOptions(root) {
    const list = root.querySelector("#agUnitOptions");
    if (!list) return;
    const units = getUnits(getContacts()).map(([unit]) => unit);
    list.innerHTML = units
        .map(unit => `<option value="${escapeHTML(unit)}"></option>`)
        .join("");
}

function openContactModal(root, contact) {
    const modal = root.querySelector("[data-ag-modal]");
    const form = root.querySelector("[data-ag-form]");
    if (!modal || !form) return;

    form.dataset.editId = contact ? contact.id : NEW_CONTACT;
    root.querySelector("[data-ag-modal-title]").textContent =
        contact ? "Editar contacto" : "Nuevo contacto";

    form.elements.name.value = contact?.name || "";
    form.elements.unidad.value =
        contact?.unidad || (agendaUnit !== "Todas" ? agendaUnit : "");
    form.elements.cargo.value = contact?.cargo || "";
    form.elements.email.value = contact?.email || "";
    form.elements.mobile.value = contact?.mobile || "";
    form.elements.extension.value = contact?.extension || "";
    form.elements.notes.value = contact?.notes || "";
    if (form.elements.attachment) form.elements.attachment.value = "";

    fillUnitOptions(root);
    modal.hidden = false;
    form.elements.name.focus();
}

function closeContactModal(root) {
    const modal = root.querySelector("[data-ag-modal]");
    if (modal) modal.hidden = true;
}

/* ---------- Eventos ---------- */
function refreshList(root) {
    const contacts = getContacts();
    const list = root.querySelector("[data-ag-list]");
    const count = root.querySelector("[data-ag-count]");
    if (list) list.innerHTML = renderListMarkup(contacts);
    if (count) {
        count.textContent = `${filterContacts(contacts).length} de ${contacts.length}`;
    }
}

async function handleSave(root, form) {
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const cargo = String(data.get("cargo") || "").trim();
    const unidad = String(data.get("unidad") || "").trim();

    if (!name && !cargo && !unidad) {
        alert("Ingresa al menos nombre, cargo o unidad.");
        return;
    }

    const editId = form.dataset.editId;
    const contacts = getContacts();
    const current = editId && editId !== NEW_CONTACT
        ? contacts.find(contact => contact.id === editId)
        : null;
    const now = new Date().toISOString();
    const file = form.elements.attachment?.files?.[0];
    const previousAttachment = current?.attachment || null;
    let attachment = current?.attachment || null;

    try {
        if (file) {
            attachment = await readAttachmentFile(file, {
                moduleId: "agenda",
                ownerId: current?.id || "new-contact",
                recordId: "contact-attachment"
            });
        }
    } catch (error) {
        alert(error?.planBlocked
            ? error.message
            : "No se pudo leer el archivo adjunto. Intenta nuevamente con otro documento.");
        return;
    }

    const nextContact = normalizeContact({
        ...(current || {}),
        id: current?.id ||
            `agenda_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        unidad,
        cargo,
        email: data.get("email"),
        extension: data.get("extension"),
        mobile: data.get("mobile"),
        notes: data.get("notes"),
        attachment,
        createdAt: current?.createdAt || now,
        updatedAt: now
    });

    const nextContacts = current
        ? contacts.map(contact => contact.id === current.id ? nextContact : contact)
        : [...contacts, nextContact];

    saveContacts(nextContacts);

    if (
        file &&
        previousAttachment?.storagePath &&
        previousAttachment.storagePath !== attachment?.storagePath
    ) {
        await deleteStoredAttachment(previousAttachment).catch(error => {
            console.warn("No se pudo eliminar el adjunto reemplazado.", error);
        });
    }

    selectedContactId = nextContact.id;
    renderAgendaPanel();
}

function bindAgendaEvents(root) {
    const search = root.querySelector("[data-ag-search]");
    if (search) {
        search.oninput = () => {
            agendaSearch = search.value;
            refreshList(root);
        };
    }

    const chipsWrap = root.querySelector("[data-ag-chips-wrap]");
    const morePop = root.querySelector("[data-ag-more-pop]");
    chipsWrap?.addEventListener("click", event => {
        if (event.target.closest("[data-ag-more]")) {
            if (morePop) {
                morePop.hidden = !morePop.hidden;
                if (!morePop.hidden) {
                    morePop.querySelector("[data-ag-more-search]")?.focus();
                }
            }
            return;
        }
        const chip = event.target.closest("[data-ag-unit]");
        if (!chip) return;
        agendaUnit = chip.dataset.agUnit;
        renderAgendaPanel();
    });

    const moreSearch = root.querySelector("[data-ag-more-search]");
    if (moreSearch) {
        moreSearch.oninput = () => {
            const query = normalizeSearch(moreSearch.value);
            root.querySelectorAll("[data-ag-more-list] .ag-more-item")
                .forEach(item => {
                    const text = normalizeSearch(item.textContent);
                    item.style.display = !query || text.includes(query) ? "" : "none";
                });
        };
    }

    root.querySelector("[data-ag-list]")?.addEventListener("click", event => {
        if (event.target.closest("[data-ag-stop]")) return; // llamar/correo directo
        const item = event.target.closest("[data-ag-contact]");
        if (!item) return;
        selectedContactId = item.dataset.agContact;
        renderAgendaPanel();
    });

    root.querySelector("[data-ag-new]")?.addEventListener("click", () => {
        openContactModal(root, null);
    });

    // Detalle: editar / eliminar / adjuntos / copiar.
    const detail = root.querySelector("[data-ag-detail]");
    detail?.addEventListener("click", async event => {
        const contacts = getContacts();
        const selected = getSelectedContact(contacts);

        if (event.target.closest("[data-ag-edit]")) {
            if (selected) openContactModal(root, selected);
            return;
        }
        if (event.target.closest("[data-ag-view-attachment]")) {
            openAttachment(selected?.attachment);
            return;
        }
        const copyBtn = event.target.closest("[data-ag-copy]");
        if (copyBtn) {
            navigator.clipboard?.writeText(copyBtn.dataset.agCopy).catch(() => {});
            return;
        }
        if (event.target.closest("[data-ag-remove-attachment]")) {
            if (!selected) return;
            saveContacts(getContacts().map(contact =>
                contact.id === selected.id
                    ? { ...contact, attachment: null, updatedAt: new Date().toISOString() }
                    : contact
            ));
            await deleteStoredAttachment(selected.attachment).catch(() => {});
            renderAgendaPanel();
            return;
        }
        if (event.target.closest("[data-ag-delete]")) {
            if (!selected) return;
            const ok = await showConfirm(
                "Se eliminará el contacto y sus datos asociados.",
                {
                    title: "Eliminar contacto",
                    tone: "danger",
                    confirmText: "Eliminar",
                    destructive: true
                }
            );
            if (!ok) return;
            saveContacts(getContacts().filter(contact => contact.id !== selected.id));
            await deleteStoredAttachment(selected.attachment).catch(() => {});
            selectedContactId = null;
            renderAgendaPanel();
        }
    });

    // Modal.
    const modal = root.querySelector("[data-ag-modal]");
    const form = root.querySelector("[data-ag-form]");
    modal?.addEventListener("click", event => {
        if (event.target === modal || event.target.closest("[data-ag-modal-close]")) {
            closeContactModal(root);
        }
    });
    if (form) {
        form.onsubmit = event => {
            event.preventDefault();
            void handleSave(root, form);
        };
    }
}

// Listeners a nivel documento/ventana: se atan una sola vez (bindAgendaEvents
// corre en cada render, así que aquí evitamos acumularlos).
let agendaGlobalBound = false;
function bindAgendaGlobalListeners() {
    if (agendaGlobalBound) return;
    agendaGlobalBound = true;

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        const root = document.getElementById("agendaPanel");
        if (!root) return;
        const modal = root.querySelector("[data-ag-modal]");
        if (modal && !modal.hidden) { modal.hidden = true; return; }
        const pop = root.querySelector("[data-ag-more-pop]");
        if (pop && !pop.hidden) pop.hidden = true;
    });

    document.addEventListener("click", event => {
        const root = document.getElementById("agendaPanel");
        if (!root) return;
        const pop = root.querySelector("[data-ag-more-pop]");
        if (pop && !pop.hidden && !event.target.closest("[data-ag-chips-wrap]")) {
            pop.hidden = true;
        }
    });

    window.addEventListener("resize", () => {
        const root = document.getElementById("agendaPanel");
        if (root && document.body.dataset.activeView === "agenda") {
            collapseChips(root);
        }
    });
}

export function renderAgendaPanel() {
    const root = document.getElementById("agendaPanel");
    if (!root) return;

    root.innerHTML = renderView();
    bindAgendaEvents(root);
    bindAgendaGlobalListeners();
    requestAnimationFrame(() => collapseChips(root));
}
