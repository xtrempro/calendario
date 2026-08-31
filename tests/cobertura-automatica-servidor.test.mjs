// El temporizador de la cobertura automatica corre en una Cloud Function
// (functions/autoCoverageScheduler.js), no en el navegador: las etapas son de 24
// horas y tienen que avanzar aunque nadie tenga la aplicacion abierta.
//
// Aca se ejercita el barrido completo contra un Firestore de mentira: que
// reserve la campaña antes de mandar nada, que no lea el estado del entorno
// cuando no hay trabajo, y que al cerrar caduquen las solicitudes que seguian
// vivas en los telefonos.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
    advanceAutoCoverageCampaigns,
    isoFromKey,
    leaseIsLive
} = require("../functions/autoCoverageScheduler.js");

const SERVER_TS = "SERVER_TS";
const serverTimestamp = () => SERVER_TS;
const silentLogger = { info() {}, warn() {}, error() {} };

/* ======================================================================
   Firestore de mentira
   ====================================================================== */

class FakeRef {
    constructor(db, segments) {
        this.db = db;
        this.segments = segments;
        this.path = segments.join("/");
        this.id = segments[segments.length - 1];
    }

    collection(name) {
        return new FakeCollection(this.db, [...this.segments, name]);
    }

    get parent() {
        return new FakeCollection(this.db, this.segments.slice(0, -1));
    }

    async set(data, options = {}) {
        const current = options.merge ? (this.db.docs.get(this.path) || {}) : {};

        this.db.docs.set(this.path, { ...current, ...data });
        this.db.writes.push({ path: this.path, data, merge: options.merge });
    }
}

class FakeCollection {
    constructor(db, segments) {
        this.db = db;
        this.segments = segments;
        this.path = segments.join("/");
    }

    doc(id) {
        return new FakeRef(this.db, [...this.segments, id]);
    }

    // El `parent` de una coleccion es el documento que la contiene; para una
    // coleccion raiz es null. Es lo que usa el barrido para saber de que
    // entorno es cada campaña.
    get parent() {
        if (this.segments.length <= 1) return null;

        return new FakeRef(this.db, this.segments.slice(0, -1));
    }

    async get() {
        this.db.reads.push(this.path);

        const prefix = `${this.path}/`;
        const docs = [...this.db.docs.entries()]
            .filter(([path]) =>
                path.startsWith(prefix) &&
                !path.slice(prefix.length).includes("/")
            )
            .map(([path, data]) => this.db.snapshot(path, data));

        return { docs, empty: docs.length === 0, size: docs.length };
    }
}

class FakeBatch {
    constructor(db) {
        this.db = db;
        this.ops = [];
    }

    set(ref, data, options = {}) {
        this.ops.push({ ref, data, options });
    }

    async commit() {
        for (const op of this.ops) {
            await op.ref.set(op.data, op.options);
        }

        this.db.commits += 1;
    }
}

class FakeDb {
    constructor(seed = {}) {
        this.docs = new Map(Object.entries(seed));
        this.reads = [];
        this.writes = [];
        this.commits = 0;
        this.transactions = 0;
    }

    snapshot(path, data) {
        const ref = new FakeRef(this, path.split("/"));

        return {
            id: ref.id,
            ref,
            exists: true,
            data: () => data
        };
    }

    collection(name) {
        return new FakeCollection(this, [name]);
    }

    collectionGroup(name) {
        const self = this;

        return {
            async get() {
                self.reads.push(`group:${name}`);

                const docs = [...self.docs.entries()]
                    .filter(([path]) => {
                        const parts = path.split("/");

                        return parts[parts.length - 2] === name;
                    })
                    .map(([path, data]) => self.snapshot(path, data));

                return { docs, empty: docs.length === 0, size: docs.length };
            }
        };
    }

    batch() {
        return new FakeBatch(this);
    }

    async runTransaction(handler) {
        this.transactions += 1;

        return handler({
            get: async (ref) => {
                const data = this.docs.get(ref.path);

                return {
                    exists: data !== undefined,
                    data: () => data
                };
            },
            update: (ref, data) => {
                this.docs.set(ref.path, {
                    ...(this.docs.get(ref.path) || {}),
                    ...data
                });
                this.writes.push({ path: ref.path, data, merge: true });
            }
        });
    }
}

/* ======================================================================
   Semillas
   ====================================================================== */

const WS = "WS1";
const KEY_DAY = "2026-8-5";           // 5 de septiembre de 2026
const ISO = isoFromKey(KEY_DAY);

// El estado del entorno viaja partido en "chunks" de JSON (ver
// js/firebaseAppState.js). Para la prueba basta un chunk por modulo.
function stateChunk(moduleId, snapshot) {
    return {
        [`workspaces/${WS}/stateModules/${moduleId}/chunks/c0`]: {
            index: 0,
            text: JSON.stringify(snapshot)
        }
    };
}

// Los feriados se siembran para que seedHolidays no salga a la red.
function holidaySeed() {
    const year = new Date().getFullYear();
    const seed = {};

    [year - 1, year, year + 1, year + 2].forEach(item => {
        seed[`holidaysCache_${item}`] = JSON.stringify({});
    });

    return seed;
}

function campaignDoc(overrides = {}) {
    return {
        id: "ac_1",
        replaced: "Ana Perez",
        keyDay: KEY_DAY,
        date: ISO,
        turno: 2,
        turnoLabel: "Noche",
        absenceType: "Licencia",
        path: "full",
        status: "active",
        createdAt: "2026-09-01T09:00:00.000Z",
        shiftStartAt: "2026-09-05T20:00:00.000Z",
        alertFiredAt: "",
        leaseUntil: "",
        leaseOwner: "",
        steps: [
            {
                stage: 1,
                kind: "third",
                third: 1,
                at: "2026-09-01T09:00:00.000Z",
                ranAt: "2026-09-01T09:00:05.000Z",
                sent: ["Beto"],
                requestIds: ["r1"]
            },
            {
                stage: 2,
                kind: "third",
                third: 2,
                at: "2026-09-02T09:00:00.000Z"
            },
            {
                stage: 3,
                kind: "mass",
                at: "2026-09-03T09:00:00.000Z",
                alert: true
            }
        ],
        ...overrides
    };
}

function pendingRequestDoc(overrides = {}) {
    return {
        id: "r1",
        status: "pending",
        worker: "Beto",
        replaced: "Ana Perez",
        date: ISO,
        turno: "N",
        channel: "app",
        workerUid: "UID_BETO",
        ...overrides
    };
}

/* ======================================================================
   Pruebas
   ====================================================================== */

test("una reserva viva deja la campaña para el proximo barrido", async () => {
    // Sin esto, dos barridos solapados mandarian la misma oleada dos veces a
    // los mismos telefonos.
    const now = new Date("2026-09-02T10:00:00.000Z");
    const db = new FakeDb({
        [`workspaces/${WS}/autoCoverageCampaigns/ac_1`]: campaignDoc({
            leaseUntil: "2026-09-02T10:04:00.000Z",
            leaseOwner: "browser"
        })
    });

    const summary = await advanceAutoCoverageCampaigns({
        db,
        logger: silentLogger,
        serverTimestamp,
        now
    });

    assert.deepEqual(summary, {
        workspaces: 0,
        advanced: 0,
        closed: 0,
        sent: 0
    });
    assert.equal(db.transactions, 0, "no se intenta reservar");
    assert.equal(db.writes.length, 0);
});

test("sin etapas vencidas no se lee el estado del entorno", async () => {
    // Leer el estado son varias colecciones por entorno: no se paga por una
    // campaña que todavia no tiene nada que hacer.
    const now = new Date("2026-09-01T10:00:00.000Z");
    const db = new FakeDb({
        [`workspaces/${WS}/autoCoverageCampaigns/ac_1`]: campaignDoc()
    });

    await advanceAutoCoverageCampaigns({
        db,
        logger: silentLogger,
        serverTimestamp,
        now
    });

    assert.deepEqual(db.reads, ["group:autoCoverageCampaigns"]);
    assert.equal(db.transactions, 0);
});

test("un turno ya cubierto cierra la campaña y caduca lo pendiente", async () => {
    // Es el punto del requerimiento: si el supervisor lo cubre en cualquier
    // etapa, las solicitudes realizadas y pendientes deben caducar.
    const now = new Date("2026-09-02T10:00:00.000Z");
    const db = new FakeDb({
        [`workspaces/${WS}/autoCoverageCampaigns/ac_1`]: campaignDoc(),
        [`workspaces/${WS}/replacementRequests/r1`]: pendingRequestDoc(),
        // Otro turno del mismo trabajador: no lo tiene que tocar.
        [`workspaces/${WS}/replacementRequests/r9`]: pendingRequestDoc({
            id: "r9",
            date: "2026-09-30"
        }),
        ...stateChunk("turnos", {
            replacements: JSON.stringify([
                {
                    worker: "Carla",
                    replaced: "Ana Perez",
                    date: ISO,
                    turno: 2
                }
            ]),
            ...holidaySeed()
        })
    });

    const summary = await advanceAutoCoverageCampaigns({
        db,
        logger: silentLogger,
        serverTimestamp,
        now
    });

    assert.equal(summary.closed, 1);
    assert.equal(summary.advanced, 0);

    const campaign = db.docs.get(`workspaces/${WS}/autoCoverageCampaigns/ac_1`);

    assert.equal(campaign.status, "covered");
    assert.equal(campaign.closeReason, "covered");
    assert.equal(campaign.leaseUntil, "", "la reserva se suelta al cerrar");

    // La solicitud viva del turno cubierto caduca...
    const expirada = db.docs.get(`workspaces/${WS}/replacementRequests/r1`);

    assert.equal(expirada.status, "expired");
    assert.equal(expirada.expireReason, "auto_coverage_covered");

    // ...y la de otra fecha queda intacta.
    assert.equal(
        db.docs.get(`workspaces/${WS}/replacementRequests/r9`).status,
        "pending"
    );
});

test("un turno que ya empezo cierra la campaña", async () => {
    const now = new Date("2026-09-06T10:00:00.000Z");
    const db = new FakeDb({
        [`workspaces/${WS}/autoCoverageCampaigns/ac_1`]: campaignDoc(),
        [`workspaces/${WS}/replacementRequests/r1`]: pendingRequestDoc(),
        ...stateChunk("turnos", holidaySeed())
    });

    const summary = await advanceAutoCoverageCampaigns({
        db,
        logger: silentLogger,
        serverTimestamp,
        now
    });

    assert.equal(summary.closed, 1);

    const campaign = db.docs.get(`workspaces/${WS}/autoCoverageCampaigns/ac_1`);

    assert.equal(campaign.status, "closed");
    assert.equal(campaign.closeReason, "past");
    assert.equal(
        db.docs.get(`workspaces/${WS}/replacementRequests/r1`).status,
        "expired"
    );
});

test("una campaña ya cerrada no se vuelve a tocar", async () => {
    const now = new Date("2026-09-02T10:00:00.000Z");
    const db = new FakeDb({
        [`workspaces/${WS}/autoCoverageCampaigns/ac_1`]: campaignDoc({
            status: "covered",
            closedAt: "2026-09-01T12:00:00.000Z"
        })
    });

    const summary = await advanceAutoCoverageCampaigns({
        db,
        logger: silentLogger,
        serverTimestamp,
        now
    });

    assert.equal(summary.workspaces, 0);
    assert.equal(db.writes.length, 0);
});

test("sin candidatos que puedan cubrirlo, la etapa igual queda corrida", async () => {
    // El entorno no tiene mas perfiles que el ausente: no hay a quien mandarle
    // nada, pero la etapa tiene que quedar marcada o el barrido la reintentaria
    // cada 15 minutos para siempre.
    const now = new Date("2026-09-02T10:00:00.000Z");
    const db = new FakeDb({
        [`workspaces/${WS}/autoCoverageCampaigns/ac_1`]: campaignDoc(),
        ...stateChunk("profile", {
            profiles: JSON.stringify([
                { id: "p1", name: "Ana Perez", estamento: "Técnico", active: true }
            ])
        }),
        ...stateChunk("turnos", {
            "absences_Ana Perez": JSON.stringify({
                [KEY_DAY]: { type: "license" }
            }),
            ...holidaySeed()
        })
    });

    const summary = await advanceAutoCoverageCampaigns({
        db,
        logger: silentLogger,
        serverTimestamp,
        now
    });

    const campaign = db.docs.get(`workspaces/${WS}/autoCoverageCampaigns/ac_1`);
    const segunda = campaign.steps?.[1];

    // O bien corrio la etapa sin destinatarios, o bien cerro por no quedar nada
    // que cubrir. Lo que NO puede pasar es quedarse en el limbo.
    assert.ok(
        Boolean(segunda?.ranAt) || campaign.status !== "active",
        "la campaña avanzo o se cerro"
    );
    assert.equal(campaign.leaseUntil, "", "la reserva siempre se suelta");
    assert.equal(summary.sent, 0);
    // Y se llego a correr el motor de verdad: se leyo el estado del entorno.
    assert.ok(
        db.reads.some(path => path.includes("stateModules")),
        "se cargo el estado del entorno"
    );
    assert.equal(db.transactions, 1, "la campaña se reservo antes de calcular");
});

test("leaseIsLive distingue una reserva vencida de una viva", () => {
    const now = new Date("2026-09-02T10:00:00.000Z");

    assert.equal(leaseIsLive({ leaseUntil: "" }, now), false);
    assert.equal(leaseIsLive({ leaseUntil: "no-es-fecha" }, now), false);
    assert.equal(
        leaseIsLive({ leaseUntil: "2026-09-02T09:59:00.000Z" }, now),
        false,
        "vencida hace un minuto"
    );
    assert.equal(
        leaseIsLive({ leaseUntil: "2026-09-02T10:01:00.000Z" }, now),
        true
    );
});

test("la clave interna y la ISO del turno se traducen igual que en el cliente", () => {
    // El mes de la clave interna es 0-based; el de la ISO, 1-based.
    assert.equal(isoFromKey("2026-8-5"), "2026-09-05");
    assert.equal(isoFromKey("2026-0-1"), "2026-01-01");
    assert.equal(isoFromKey(""), "");
});
