// Cuando la solicitud de cobertura ya salio a las PWA, el turno deja de estar
// "sin cubrir" y pasa a "en espera": marcador de celular en el calendario, en el
// timeline y en la tarjeta de cobertura del inicio, y un modal que dice a quien
// se le pidio y cuanto le queda a la solicitud antes de caducar.
//
// Ademas la caducidad preestablecida sube de 60 minutos a 24 horas: una hora
// vencia de noche o en el turno siguiente, antes de que el trabajador alcanzara
// a mirar el telefono.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

const noopEl = {
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.alert = () => {};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    buildPendingRequestIndex,
    getPendingRequestsFromIndex,
    formatRequestTimeLeft,
    applyAcceptedReplacementRequests,
    getReplacementForCoveredShift
} = await import("../js/replacements.js");
const { getReplacementRequestConfig } = await import("../js/storage.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const calendar = await read("../js/calendar.js");
const timeline = await read("../js/timeline.js");
const home = await read("../js/home.js");
const settings = await read("../js/systemSettings.js");
const workerRequests = await read("../js/workerRequests.js");
const styles = await read("../styles.css");

const REPLACED = "Hugo Rojas Tapia";
const DAY_ISO = "2026-08-13";
const AHORA = new Date("2026-08-12T09:00:00");

function sembrar(requests) {
    localStorage.clear();
    localStorage.setItem("replacementRequests", JSON.stringify(requests));
}

const solicitud = extra => ({
    id: "r1",
    replaced: REPLACED,
    worker: "Mariana Rojas Bravo",
    date: DAY_ISO,
    turno: "N",
    status: "pending",
    channel: "app",
    // Vence bastante despues de AHORA salvo que el caso diga otra cosa.
    expiresAt: "2026-08-13T09:00:00",
    ...extra
});

/* =========================================================
   Caducidad preestablecida
========================================================= */

test("la caducidad preestablecida es de 24 horas", () => {
    localStorage.clear();

    assert.equal(getReplacementRequestConfig().expiresMinutes, 24 * 60);
});

test("el ajuste del entorno recomienda el mismo valor", () => {
    // Si el texto siguiera diciendo 60, el default y la recomendacion se
    // contradirian en la misma pantalla.
    assert.match(settings, /Number\(config\.expiresMinutes\) \|\| 24 \* 60/);
    assert.match(settings, /Valor recomendado: 1440 \(24 horas\)/);
});

test("una caducidad ya guardada en el entorno se respeta", () => {
    // Cambiar el default no puede pisar lo que el entorno eligio a mano.
    localStorage.clear();
    localStorage.setItem(
        "replacementRequestConfig",
        JSON.stringify({ expiresMinutes: 90 })
    );

    assert.equal(getReplacementRequestConfig().expiresMinutes, 90);
});

/* =========================================================
   Tiempo restante
========================================================= */

test("el tiempo restante se dice en la unidad que se entiende", () => {
    // Con 24 h de caducidad, "1440 min" no le sirve a nadie.
    const desde = iso => formatRequestTimeLeft(iso, AHORA);

    assert.equal(desde("2026-08-13T09:00:00"), "1 d 0 h");
    assert.equal(desde("2026-08-12T20:30:00"), "11 h 30 min");
    assert.equal(desde("2026-08-12T09:45:00"), "45 min");
});

test("una solicitud vencida se dice vencida", () => {
    assert.equal(formatRequestTimeLeft("2026-08-12T08:00:00", AHORA), "Expirada");
    // Y un minuto largo no se redondea a cero: nunca muestra "0 min".
    assert.equal(formatRequestTimeLeft("2026-08-12T09:00:30", AHORA), "1 min");
});

/* =========================================================
   Indice de solicitudes pendientes
========================================================= */

test("el indice agrupa por trabajador ausente y fecha", () => {
    sembrar([
        solicitud({ id: "a", worker: "Mariana Rojas Bravo" }),
        solicitud({ id: "b", worker: "Elena Diaz Soto" }),
        solicitud({ id: "c", worker: "Otro", date: "2026-08-20" })
    ]);

    const index = buildPendingRequestIndex(AHORA);
    const delDia = getPendingRequestsFromIndex(index, REPLACED, DAY_ISO);

    assert.deepEqual(
        delDia.map(request => request.worker),
        ["Mariana Rojas Bravo", "Elena Diaz Soto"]
    );
    assert.equal(
        getPendingRequestsFromIndex(index, REPLACED, "2026-08-20").length,
        1
    );
    // Un dia sin solicitudes devuelve lista vacia, no undefined.
    assert.deepEqual(getPendingRequestsFromIndex(index, REPLACED, "2026-08-25"), []);
});

test("solo cuentan las pendientes", () => {
    sembrar([
        solicitud({ id: "a", status: "pending" }),
        solicitud({ id: "b", status: "rejected", worker: "Rechazo" }),
        solicitud({ id: "c", status: "accepted", worker: "Acepto" })
    ]);

    const index = buildPendingRequestIndex(AHORA);

    assert.equal(getPendingRequestsFromIndex(index, REPLACED, DAY_ISO).length, 1);
});

test("una solicitud vencida deja de estar pendiente", () => {
    // El barrido de caducidad corre dentro del indice: si no, un turno seguiria
    // mostrando "en espera" para siempre.
    sembrar([
        solicitud({ id: "a", expiresAt: "2026-08-12T08:00:00" })
    ]);

    const index = buildPendingRequestIndex(AHORA);

    assert.deepEqual(getPendingRequestsFromIndex(index, REPLACED, DAY_ISO), []);
});

/* =========================================================
   El celular en las tres superficies
========================================================= */

test("el calendario principal muestra el celular", () => {
    assert.match(calendar, /const REQUEST_PENDING_BADGE = "request-pending";/);
    assert.match(calendar, /day-badge--request/);
    // Gana sobre el "!" de sin cubrir: no es lo mismo un turno que nadie ha
    // pedido que uno que ya salio a los telefonos.
    assert.match(
        calendar,
        /pendingRequests\.length\s*\n\s*\? REQUEST_PENDING_BADGE\s*\n\s*: needsReplacement\s*\n\s*\? "!"/
    );
});

test("el timeline muestra el celular", () => {
    assert.match(timeline, /const TIMELINE_REQUEST_MARKER = /);
    assert.match(
        timeline,
        /waitingForRequest\s*\n\s*\? TIMELINE_REQUEST_MARKER\s*\n\s*: needsReplacement\s*\n\s*\? "!"/
    );
    // Y la casilla deja de pintarse como "sin cubrir".
    assert.match(timeline, /!preassignedCovered && !waitingForRequest \? "needs-replacement"/);
});

test("la tarjeta de cobertura del inicio muestra el celular", () => {
    // El icono va pegado al texto dentro del mismo boton.
    assert.match(home, /svg\(IC\.phone[^)]*\)\}En espera\.\.</);
    assert.match(home, /hm-cob-status--espera/);
    assert.match(home, /phone:/);
    // Y en vez de "Podria cubrir" dice a quien ya se le pidio.
    assert.match(home, /Solicitud enviada a:/);
});

/* =========================================================
   El modal
========================================================= */

test("el modal lista trabajadores y cuanto queda", () => {
    assert.match(calendar, /function openPendingRequestsDialog\(\{ profile, keyDay \}\)/);
    assert.match(calendar, /formatRequestTimeLeft\(request\.expiresAt\)/);
    assert.match(calendar, /request-wait-worker/);
    // La cuenta regresiva se refresca sola: con 24 h el modal puede quedar
    // abierto un buen rato.
    assert.match(calendar, /const ticker = setInterval\(/);
    assert.match(calendar, /clearInterval\(ticker\);/);
});

test("las tres superficies abren el mismo modal", () => {
    assert.match(calendar, /window\.openPendingRequestsDialog = openPendingRequestsDialog;/);
    // Calendario: la casilla en espera abre el detalle, no el de sugerencias.
    assert.match(
        calendar,
        /if \(getPendingReplacementRequestsForShift\(profileName, keyDay\)\.length\) \{\s*\n\s*return openPendingRequestsDialog/
    );
    // Timeline: por data-attribute, como los demas cuadros de la casilla.
    assert.match(timeline, /data-request-wait-profile/);
    assert.match(timeline, /cell\.dataset\.requestWaitProfile/);
    // Inicio: la pastilla "En espera.." es el boton.
    assert.match(home, /data-hm="cob-espera"/);
    assert.match(home, /window\.openPendingRequestsDialog\?\./);
});

test("desde el modal se llega a las sugerencias", () => {
    // Si nadie responde, el supervisor tiene que poder insistir sin dar la
    // vuelta por el calendario.
    assert.match(calendar, /data-action="suggestions"/);
    assert.match(calendar, /void openReplacementDialog\(profile, keyDay\);/);
});

test("consultar quien tiene la solicitud no exige permiso de edicion", () => {
    // Es informacion, como el detalle de la preasignacion. El boton de
    // sugerencias, que si escribe, queda tras canEditTarget.
    assert.match(calendar, /const canEdit = canEditTarget\("calendarPanel"\);/);
    assert.doesNotMatch(
        timeline,
        /cell\.dataset\.requestWaitProfile\) \{[\s\S]{0,220}ensureCanEditTarget/
    );
});

/* =========================================================
   El boton de cobertura automatica no se puede disparar dos veces
========================================================= */

test("cobertura automatica queda deshabilitada mientras la solicitud vive", () => {
    // Volver a apretarlo mandaria una segunda tanda a los mismos telefonos.
    assert.match(home, /waiting \? `disabled title=/);
    assert.match(home, /waiting \? "SOLICITUD ENVIADA" : "COBERTURA AUTOMÁTICA"/);
});

test("el bloqueo sale del dato, no de una marca local", () => {
    // Si fuera una variable en memoria, recargar la pagina lo soltaria; y no
    // sabria cuando caduco la solicitud. Sale de las pendientes del turno.
    assert.match(
        home,
        /const waiting = kind === "sincubrir" && \(item\.pendingRequests\?\.length \|\| 0\) > 0;/
    );
});

/* =========================================================
   Cuando alguien acepta, el requerimiento desaparece
========================================================= */

test("aceptar crea el reemplazo y apaga las demas solicitudes", () => {
    // Es lo que hace desaparecer la fila de cobertura: isShiftUncovered deja de
    // ser verdadera en cuanto existe el reemplazo.
    sembrar([
        solicitud({
            id: "a", worker: "Mariana Rojas Bravo", groupId: "g1",
            status: "accepted", acceptedAt: "2026-08-12T10:00:00",
            keyDay: "2026-7-13"
        }),
        solicitud({ id: "b", worker: "Elena Diaz Soto", groupId: "g1" }),
        solicitud({ id: "c", worker: "Otro Mas", groupId: "g1" })
    ]);
    localStorage.setItem("replacements", JSON.stringify([]));

    assert.equal(applyAcceptedReplacementRequests(), true);

    // El turno quedo cubierto...
    const replacement = getReplacementForCoveredShift(REPLACED, "2026-7-13");

    assert.ok(replacement, "deberia existir el reemplazo");
    assert.equal(replacement.worker, "Mariana Rojas Bravo");

    // ...y ninguna solicitud sigue pendiente, asi que se apaga el "en espera"
    // y el boton de cobertura automatica vuelve a habilitarse.
    const index = buildPendingRequestIndex(AHORA);

    assert.deepEqual(getPendingRequestsFromIndex(index, REPLACED, DAY_ISO), []);
});

/* =========================================================
   El listado del modal
========================================================= */

test("el cuadro de sugerencias tampoco corta la lista de enviadas", () => {
    // El mismo problema en el otro modal: con 15 o 20 solicitudes pendientes la
    // lista empujaba a los candidatos y a los botones fuera de la pantalla.
    assert.match(
        styles,
        /\.replacement-request-list \{[\s\S]{0,260}max-height: min\(300px, 34vh\);[\s\S]{0,60}overflow: auto;/
    );
    // Dos columnas en escritorio, en la misma regla que ya lo hacia con los
    // candidatos: las dos listas del modal tienen que comportarse igual.
    assert.match(
        styles,
        /\.replacement-dialog \.replacement-candidate-list,[\s\S]{0,80}\.replacement-dialog \.replacement-request-list \{[\s\S]{0,40}grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/
    );
});

test("el listado va en dos columnas y con scroll propio", () => {
    // Un turno puede salir a 15 o 20 trabajadores: en una columna el modal se
    // pasaba de largo de la pantalla.
    assert.match(
        styles,
        /\.request-wait-list \{[\s\S]{0,220}grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/
    );
    assert.match(styles, /\.request-wait-list \{[\s\S]{0,260}overflow-y: auto;/);
    // El scroll lo lleva la lista, no el modal entero: el titulo y los botones
    // tienen que quedar siempre a la vista.
    assert.match(styles, /\.turn-change-dialog\.request-wait-dialog \{[\s\S]{0,120}max-height: 86vh;/);
    // En pantalla angosta vuelve a una columna.
    assert.match(styles, /\.request-wait-list \{ grid-template-columns: 1fr;/);
});

/* =========================================================
   Anular una solicitud desde el menu Solicitudes
========================================================= */

test("las solicitudes enviadas se pueden anular desde el menu", () => {
    // Antes no traian ninguna accion: "pending" excluye a proposito a las de
    // reemplazo, asi que quedaban solo para mirar.
    assert.match(
        workerRequests,
        /isReplacementRequest\(request\) && request\.status === "pending"/
    );
    assert.match(workerRequests, /data-worker-request-action="cancel-replacement"/);
    assert.match(workerRequests, /Anular solicitud/);
});

test("anular pregunta antes y usa el dialogo del app", () => {
    // Es irreversible y le llega al telefono del trabajador.
    assert.match(workerRequests, /const confirmed = await showConfirm\(/);
    assert.match(workerRequests, /destructive: true/);
    assert.match(workerRequests, /if \(!confirmed\) return;/);
    // Y no el confirm del navegador, que el app no usa en ninguna otra parte.
    assert.doesNotMatch(workerRequests, /window\.confirm\(/);
});

test("anular escribe por la via que ya sincroniza", () => {
    // cancelReplacementRequest guarda y el sync lo sube: asi desaparece de la
    // PWA del trabajador y el turno vuelve a pedir cobertura.
    assert.match(workerRequests, /cancelReplacementRequest\(request\.id\);/);
    assert.match(
        workerRequests,
        /import \{ cancelReplacementRequest \} from "\.\/replacements\.js";/
    );
});
