// Un trabajador invitado que nunca abrio el enlace se veia igual que uno al que
// nadie invito: el perfil solo distinguia "enlazado" de "no enlazado". Como la
// mensajeria y los candidatos de cambio de turno exigen enlace, esa gente
// desaparecia de ambas listas sin ninguna señal (caso real: un TM con dos
// invitaciones pendientes -una vencida- que nadie noto por semanas).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

function block(source, signature, length = 3000) {
    const start = source.indexOf(signature);

    assert.notEqual(start, -1, `no se encontro: ${signature}`);

    return source.slice(start, start + length);
}

const invites = await read("../js/workerAppInvites.js");
const main = await read("../js/main.js");
const html = await read("../index.html");
const backend = await read("../functions/index.js");

test("el estado de enlace tiene tres niveles, no dos", () => {
    assert.match(invites, /export const WORKER_LINK_STATE = \{/);
    assert.match(invites, /LINKED: "linked"/);
    assert.match(invites, /PENDING: "pending"/);
    assert.match(invites, /NONE: "none"/);

    const state = block(invites, "export function getWorkerLinkState(");

    // Enlazado manda sobre invitado: si ya uso el enlace, la invitacion sobra.
    assert.match(state, /getWorkerAppLinkForProfile\(profile\)[\s\S]*?LINKED/);
    assert.match(state, /getPendingWorkerInviteForProfile\(profile\)/);
});

test("la invitacion pendiente se empareja por RUT antes que por nombre", () => {
    const match = block(invites, "function inviteMatchesProfile(", 600);

    // El RUT es el ancla de identidad; el nombre solo sirve si falta en alguno.
    assert.match(match, /if \(inviteRut && profileRut\) return inviteRut === profileRut;/);
    assert.match(match, /normalizeInviteName\(invite\?\.profileName\)/);
});

test("el panel de pendientes ordena primero lo que necesita accion", () => {
    const list = block(invites, "export function listWorkerLinkStates(", 1200);

    assert.match(list, /\[WORKER_LINK_STATE\.NONE\]: 0/);
    assert.match(list, /\[WORKER_LINK_STATE\.PENDING\]: 1/);
    assert.match(list, /\[WORKER_LINK_STATE\.LINKED\]: 2/);
    // Solo perfiles activos: un perfil desactivado no necesita la app.
    assert.match(list, /filter\(profile => profile\?\.active !== false\)/);
    // Entre pendientes, primero el mas antiguo.
    assert.match(list, /a\.invitedAtMs - b\.invitedAtMs/);
});

test("al invitar de nuevo se anulan las invitaciones pendientes anteriores", () => {
    const create = block(invites, "async function createWorkerAppInvite(", 9000);

    assert.match(create, /findPendingInvitesForProfile\(/);
    assert.match(create, /status: "superseded"/);
    assert.match(create, /supersededByToken: token/);
    // El espejo por correo es lo que consulta la PWA: si queda vivo, la
    // invitacion anulada se sigue viendo como valida.
    assert.match(create, /deleteWorkerEmailInviteMirror\([\s\S]*?invite\.id/);

    const find = block(invites, "async function findPendingInvitesForProfile(", 1200);

    assert.match(find, /where\("status", "==", "pending"\)/);
    assert.match(find, /invite\.id !== exceptToken/);
});

test("la cache de pendientes se refresca en los momentos que cambia", () => {
    // Crear invitacion, desenlazar y cambiar de unidad.
    assert.match(invites, /await refreshPendingWorkerInvites\(workspace\);/);
    assert.match(invites, /await refreshPendingWorkerInvites\(\);/);
    assert.match(main, /void refreshPendingWorkerInvites\(workspace\);/);
    assert.match(main, /addEventListener\("proturnos:workerInvitesChanged"/);
});

test("el boton del perfil pinta el tercer estado", () => {
    const render = block(main, "if (DOM.workerAppInviteBtn) {", 2000);

    assert.match(render, /state === WORKER_LINK_STATE\.PENDING/);
    assert.match(render, /\$\{PF_BTN_LINK\} Invitado/);
    assert.match(render, /is-invite-pending/);
    // El title explica que falta para completar el enlace.
    assert.match(render, /Invitacion enviada el \$\{workerInviteDateLabel\(invite\)\}/);
});

test("existe el panel de enlaces y su boton", () => {
    assert.match(html, /id="workerLinkStatusBtn"/);
    assert.match(main, /DOM\.workerLinkStatusBtn\.onclick = openWorkerLinkStatusPanel;/);

    const panel = block(main, "function openWorkerLinkStatusPanel(", 4000);

    assert.match(panel, /listWorkerLinkStates\(\)/);
    assert.match(panel, /Sin invitar/);
    assert.match(panel, /Invitados, pendientes de abrir el enlace/);
    assert.match(panel, /Enlazados/);
});

test("el backend explica que el enlace fue reemplazado", () => {
    assert.match(backend, /inviteStatus === "superseded"/);
    assert.match(backend, /Este enlace fue reemplazado por uno mas nuevo/);
    // Y sigue rechazando cualquier otro estado que no sea pendiente.
    assert.match(backend, /if \(inviteStatus !== "pending"\) \{/);
});
