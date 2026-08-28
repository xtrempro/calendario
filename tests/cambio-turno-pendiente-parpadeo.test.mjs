import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Cuando un trabajador pide un cambio de turno desde su PWA, al supervisor le
// llega la notificacion pero el calendario no mostraba nada: habia que entrar al
// panel de solicitudes para enterarse. Los permisos pendientes si parpadean
// desde hace rato; los cambios de turno no estaban en esa lista
// (`PENDING_LEAVE_REQUEST_TYPES` no incluye "swap"), y lo unico que el
// calendario dibujaba para un cambio era el marcador CCTT/DDTT de los ya
// APROBADOS, que ademas es estatico.
//
// Un cambio toca CUATRO casillas: el dia de cambio y el de devolucion, en el
// calendario de los DOS trabajadores, con roles cruzados.

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get length() {
        return this.values.size;
    }

    clear() {
        this.values.clear();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    key(index) {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key) {
        this.values.delete(key);
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }
}

globalThis.localStorage = new MemoryStorage();

const { saveWorkerRequests } = await import("../js/storage.js");
const {
    SWAP_ROLE,
    getPendingSwapRequestForDate,
    getPendingSwapRequestsForProfile,
    isPendingSwapRequest,
    pendingSwapLabel,
    pendingSwapRoleForDate
} = await import("../js/pendingSwapRequests.js");

const CAMBIO = "2026-06-10";
const DEVOLUCION = "2026-06-12";
const OTRO_DIA = "2026-06-15";

function solicitudDeCambio(extra = {}) {
    // Forma con la que la Cloud Function crea la solicitud del supervisor
    // (functions/index.js, trigger de workerSwapRequests) cuando el colega ya
    // acepto: recien ahi es asunto del supervisor.
    return {
        id: "swap_abc",
        type: "swap",
        title: "Cambio directo",
        status: "pending",
        profile: "Juan",
        from: "Juan",
        to: "Alexis",
        targetProfile: "Alexis",
        source: "worker_app",
        date: CAMBIO,
        fecha: CAMBIO,
        returnDate: DEVOLUCION,
        devolucion: DEVOLUCION,
        createdAt: "2026-06-01T10:00:00.000Z",
        ...extra
    };
}

beforeEach(() => {
    globalThis.localStorage.clear();
    saveWorkerRequests([solicitudDeCambio()]);
});

test("la solicitud alcanza a los DOS trabajadores, no solo al que la pidio", () => {
    assert.equal(getPendingSwapRequestsForProfile("Juan").length, 1);
    assert.equal(getPendingSwapRequestsForProfile("Alexis").length, 1);
    assert.equal(getPendingSwapRequestsForProfile("Otro").length, 0);
});

test("los roles se cruzan entre el dia de cambio y el de devolucion", () => {
    const juanCambio = getPendingSwapRequestForDate("Juan", CAMBIO);
    const alexisCambio = getPendingSwapRequestForDate("Alexis", CAMBIO);
    const juanDevolucion = getPendingSwapRequestForDate("Juan", DEVOLUCION);
    const alexisDevolucion =
        getPendingSwapRequestForDate("Alexis", DEVOLUCION);

    // El dia de cambio lo entrega quien solicito.
    assert.equal(juanCambio.role, SWAP_ROLE.GIVES);
    assert.equal(alexisCambio.role, SWAP_ROLE.RECEIVES);

    // El de devolucion, al reves.
    assert.equal(juanDevolucion.role, SWAP_ROLE.RECEIVES);
    assert.equal(alexisDevolucion.role, SWAP_ROLE.GIVES);
});

test("cada uno ve a su contraparte, no a si mismo", () => {
    assert.equal(
        getPendingSwapRequestForDate("Juan", CAMBIO).counterpart,
        "Alexis"
    );
    assert.equal(
        getPendingSwapRequestForDate("Alexis", CAMBIO).counterpart,
        "Juan"
    );
});

test("un dia ajeno al cambio no parpadea", () => {
    assert.equal(getPendingSwapRequestForDate("Juan", OTRO_DIA), null);
    assert.equal(getPendingSwapRequestForDate("Alexis", OTRO_DIA), null);
});

test("la etiqueta que alterna es la misma que despues del visto bueno", () => {
    // CCTT el dia que entrega, DDTT el que recibe: el supervisor lee lo mismo
    // antes y despues de aprobar, no un vocabulario nuevo.
    assert.equal(pendingSwapLabel(SWAP_ROLE.GIVES), "CCTT");
    assert.equal(pendingSwapLabel(SWAP_ROLE.RECEIVES), "DDTT");
});

test("solo parpadea lo que espera al supervisor", () => {
    // Mientras el colega no acepta, el cambio esta en "pending_colleague" y no
    // es asunto del supervisor: no debe parpadearle nada.
    saveWorkerRequests([
        solicitudDeCambio({ status: "pending_colleague" })
    ]);
    assert.equal(getPendingSwapRequestForDate("Juan", CAMBIO), null);

    // Ni una ya resuelta.
    saveWorkerRequests([solicitudDeCambio({ status: "approved" })]);
    assert.equal(getPendingSwapRequestForDate("Juan", CAMBIO), null);

    saveWorkerRequests([solicitudDeCambio({ status: "rejected" })]);
    assert.equal(getPendingSwapRequestForDate("Juan", CAMBIO), null);
});

test("una solicitud que no es de cambio no entra por aca", () => {
    saveWorkerRequests([
        { ...solicitudDeCambio(), type: "admin" }
    ]);

    assert.equal(getPendingSwapRequestForDate("Juan", CAMBIO), null);
    assert.equal(isPendingSwapRequest({ type: "admin", status: "pending" }), false);
});

test("tolera la solicitud sin los alias de campo", () => {
    // La Cloud Function escribe date/fecha y returnDate/devolucion duplicados,
    // pero una solicitud vieja puede traer solo uno de los dos.
    saveWorkerRequests([
        {
            id: "swap_viejo",
            type: "swap",
            status: "pending",
            profile: "Juan",
            to: "Alexis",
            date: CAMBIO,
            returnDate: DEVOLUCION,
            createdAt: "2026-06-01T10:00:00.000Z"
        }
    ]);

    assert.equal(
        getPendingSwapRequestForDate("Juan", CAMBIO).role,
        SWAP_ROLE.GIVES
    );
    assert.equal(
        getPendingSwapRequestForDate("Alexis", DEVOLUCION).role,
        SWAP_ROLE.GIVES
    );
});

test("pendingSwapRoleForDate no inventa rol para un tercero", () => {
    assert.equal(
        pendingSwapRoleForDate(solicitudDeCambio(), "Otro", CAMBIO),
        null
    );
});

test("el calendario y el timeline reutilizan la maquinaria del permiso", async () => {
    const [calendar, timeline, blink, css] = await Promise.all([
        readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
        readFile(new URL("../js/timeline.js", import.meta.url), "utf8"),
        readFile(new URL("../js/pendingLeaveBlinkSync.js", import.meta.url), "utf8"),
        readFile(new URL("../styles.css", import.meta.url), "utf8")
    ]);

    // Reutilizar las clases del permiso es lo que mantiene los dos tipos de
    // solicitud parpadeando EN FASE: el sincronizador alinea por selector, asi
    // que una clase propia habria quedado desfasada del resto.
    assert.match(blink, /\.pending-leave-color-overlay/);
    assert.match(blink, /\.timeline-leave-overlay/);
    assert.match(calendar, /div\.classList\.add\("pending-leave-request-day"\);\s*\n\s*div\.classList\.add\("pending-swap-request-day"\)/);
    assert.match(timeline, /timeline-leave-pending timeline-swap-pending/);

    // El color es lo unico propio, para distinguirlo del permiso de un vistazo.
    assert.match(css, /\.day\.pending-swap-request-day,\s*\n\s*td\.mini\.timeline-swap-pending \{/);

    // Si coinciden permiso y cambio el mismo dia, manda el permiso.
    assert.match(calendar, /const pendingSwap = pendingLeaveRequest\s*\n\s*\? null/);
    assert.match(timeline, /const pendingSwap = pendingLeave\s*\n\s*\? null/);
});

test("el timeline repinta cuando llega la solicitud", async () => {
    const main = await readFile(
        new URL("../js/main.js", import.meta.url),
        "utf8"
    );

    // El calendario ya se actualizaba solo; el timeline limpiaba su cache pero
    // nadie le pedia repintar, asi que la solicitud recien llegada no aparecia
    // hasta cambiar de mes o de menu.
    assert.match(
        main,
        /workerRequestsChanged[\s\S]{0,900}activeView === "timeline"[\s\S]{0,120}renderTimeline\(\{ skipCache: true \}\)/
    );
});
