"use strict";

// Temporizador de la cobertura automatica por etapas.
//
// Las etapas son de 24 horas, asi que no pueden depender de que un supervisor
// tenga la pagina abierta: eso es lo que hace esta funcion, que corre cada 15
// minutos y hace avanzar las campañas abiertas de todos los entornos.
//
// El navegador solo arranca la campaña y manda la PRIMERA oleada (para que el
// supervisor vea el resultado del boton en el acto) y la cierra cuando resuelve
// el turno. De la segunda oleada en adelante manda esta funcion.
//
// El calculo NO esta reescrito aqui. Se corre el mismo motor del navegador
// (functions/engine/autoCoverage.mjs, empaquetado desde js/serverAutoCoverage.js)
// sobre un shim de localStorage sembrado con el estado del entorno, igual que
// hace engineHarness.js con la proyeccion. Si las reglas de 24 invertido o el
// tope de horas extras diurnas dieran distinto en los dos lados, el servidor le
// ofreceria a alguien un turno que el navegador le niega.
//
// Reparto de trabajo: cada campaña se "reserva" (leaseUntil/leaseOwner) con una
// transaccion antes de mandar su oleada. Sin eso, dos corridas solapadas -o el
// navegador arrancando la campaña justo cuando pasa el barrido- mandarian la
// misma oleada dos veces a los mismos telefonos.

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
    STATE_MODULES,
    ensureEngineGlobals,
    loadWorkspaceState,
    makeMemoryStorage,
    relevantHolidayYears,
    seedHolidays
} = require("./lib/engineHarness");

const ENGINE_PATH = path.join(__dirname, "engine", "autoCoverage.mjs");
// Cuanto dura la reserva. Tiene que cubrir de sobra lo que tarda una oleada
// (barrido de candidatos de la unidad + escritura), y quedar por debajo del
// intervalo del temporizador para que una corrida caida no bloquee la siguiente.
const LEASE_MS = 5 * 60 * 1000;
// El estado del entorno + "requests", que trae la configuracion de solicitudes
// (si la unidad desactivo pedirle aprobacion al trabajador, no se manda nada).
const AUTO_COVERAGE_STATE_MODULES = [...STATE_MODULES, "requests"];

let enginePromise = null;

function loadEngine() {
    if (!enginePromise) {
        enginePromise = import(pathToFileURL(ENGINE_PATH).href);
    }

    return enginePromise;
}

function docId(value) {
    return encodeURIComponent(String(value || "").trim())
        .replace(/\./g, "%2E");
}

function isoFromKey(keyDay) {
    const parts = String(keyDay || "").split("-");

    if (parts.length !== 3) return "";

    return [
        parts[0],
        String(Number(parts[1]) + 1).padStart(2, "0"),
        String(Number(parts[2])).padStart(2, "0")
    ].join("-");
}

function leaseIsLive(campaign, now) {
    const lease = Date.parse(campaign?.leaseUntil || "");

    return Number.isFinite(lease) && lease > now.getTime();
}

/**
 * Toma la campaña para esta corrida. Devuelve el documento si quedo reservado,
 * o null si otro lo tiene o ya no esta activo.
 */
async function claimCampaign(db, ref, now) {
    try {
        return await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);

            if (!snap.exists) return null;

            const data = snap.data() || {};

            if (data.status !== "active") return null;
            if (leaseIsLive(data, now)) return null;

            tx.update(ref, {
                leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
                leaseOwner: "server"
            });

            return data;
        });
    } catch (error) {
        // Otra corrida gano la carrera por el mismo documento.
        return null;
    }
}

async function releaseCampaign(ref, patch, serverTimestamp) {
    await ref.set(
        {
            ...patch,
            leaseUntil: "",
            leaseOwner: "",
            updatedAt: serverTimestamp()
        },
        { merge: true }
    );
}

/**
 * Caduca las solicitudes que sigan vivas por un turno. Se filtra en memoria
 * sobre las solicitudes que ya se leyeron del entorno: consultarlas por
 * replaced+fecha exigiria un indice compuesto para algo que se resuelve con un
 * filtro.
 */
function expirePendingRequests({
    batch,
    requestDocs,
    replaced,
    keyDay,
    reason,
    nowISO,
    serverTimestamp
}) {
    const iso = isoFromKey(keyDay);
    let expired = 0;

    requestDocs.forEach(({ ref, data }) => {
        if (
            data.status !== "pending" ||
            data.replaced !== replaced ||
            data.date !== iso
        ) {
            return;
        }

        batch.set(
            ref,
            {
                status: "expired",
                expiredAt: nowISO,
                expireReason: reason,
                updatedAt: serverTimestamp()
            },
            { merge: true }
        );
        expired += 1;
    });

    return expired;
}

async function readWorkspaceContext(db, workspaceId, now) {
    const [state, requestsSnap, linksSnap, blockedSnap] = await Promise.all([
        loadWorkspaceState(db, workspaceId, AUTO_COVERAGE_STATE_MODULES),
        db.collection("workspaces").doc(workspaceId)
            .collection("replacementRequests").get(),
        db.collection("workspaces").doc(workspaceId)
            .collection("workerLinks").get(),
        db.collection("workspaces").doc(workspaceId)
            .collection("workerBlockedDays").get()
    ]);

    const requestDocs = requestsSnap.docs
        .map((docSnap) => ({ ref: docSnap.ref, data: docSnap.data() || {} }))
        .filter((item) => item.data.id);

    // La coleccion propia manda sobre la foto del modulo compartido: es la que
    // el trabajador responde desde su telefono, y puede ir minutos por delante.
    state.replacementRequests = JSON.stringify(
        requestDocs.map((item) => item.data)
    );

    await seedHolidays(state, relevantHolidayYears(now));

    return {
        state,
        requestDocs,
        workerLinks: linksSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
            uid: String(docSnap.data()?.uid || docSnap.id || "")
        })),
        blockedDays: blockedSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data()
        }))
    };
}

/**
 * Un barrido completo. Devuelve un resumen para la bitacora de la funcion.
 */
async function advanceAutoCoverageCampaigns({
    db,
    logger,
    serverTimestamp,
    now = new Date()
}) {
    const engine = await loadEngine();

    // Consulta de grupo SIN filtro a proposito: filtrar por `status` en el
    // servidor exigiria declarar un indice de alcance "grupo de colecciones",
    // y las campañas se podan a los 45 dias, asi que son pocas. Si algun dia
    // crecen, el filtro con indice es el cambio.
    const snap = await db.collectionGroup("autoCoverageCampaigns").get();
    const byWorkspace = new Map();

    snap.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};

        if (data.status !== "active" || !data.id) return;

        const workspaceId = docSnap.ref.parent.parent?.id;

        if (!workspaceId) return;

        if (!byWorkspace.has(workspaceId)) byWorkspace.set(workspaceId, []);
        byWorkspace.get(workspaceId).push({ ref: docSnap.ref, data });
    });

    const summary = { workspaces: 0, advanced: 0, closed: 0, sent: 0 };

    for (const [workspaceId, campaigns] of byWorkspace) {
        // Antes de leer el estado del entorno -que son varias colecciones- se
        // descarta el trabajo que no hay que hacer. Un entorno con campañas
        // abiertas pero sin ninguna etapa vencida no cuesta ni una lectura mas.
        const pending = campaigns.filter(({ data }) => {
            if (leaseIsLive(data, now)) return false;

            const start = Date.parse(data.shiftStartAt || "");

            if (Number.isFinite(start) && start <= now.getTime()) return true;

            return engine.dueSteps(engine.normalizeCampaign(data), now).length > 0;
        });

        if (!pending.length) continue;

        summary.workspaces += 1;

        let context;

        try {
            context = await readWorkspaceContext(db, workspaceId, now);
        } catch (error) {
            logger.error("cobertura automatica: no se pudo leer el entorno", {
                workspaceId,
                error: error?.message || String(error)
            });
            continue;
        }

        ensureEngineGlobals();
        globalThis.localStorage = makeMemoryStorage(context.state);
        // La cache de feriados es lo unico mutable que el motor guarda entre
        // invocaciones: sin limpiarla, un entorno heredaria los feriados
        // manuales del anterior si la instancia esta caliente.
        engine.clearHolidaysCache();
        engine.seedAutoCoverageContext({
            workerLinks: context.workerLinks,
            blockedDays: context.blockedDays
        });

        for (const { ref, data } of pending) {
            try {
                const advanced = await advanceOneCampaign({
                    db,
                    engine,
                    logger,
                    serverTimestamp,
                    now,
                    workspaceId,
                    ref,
                    campaign: data,
                    requestDocs: context.requestDocs
                });

                if (advanced.closed) summary.closed += 1;
                if (advanced.ran) summary.advanced += 1;
                summary.sent += advanced.sent || 0;
            } catch (error) {
                logger.error("cobertura automatica: fallo una campaña", {
                    workspaceId,
                    campaignId: data.id,
                    error: error?.message || String(error)
                });
            }
        }
    }

    return summary;
}

async function advanceOneCampaign({
    db,
    engine,
    logger,
    serverTimestamp,
    now,
    workspaceId,
    ref,
    campaign: raw,
    requestDocs
}) {
    const claimed = await claimCampaign(db, ref, now);

    if (!claimed) return { skipped: true };

    const campaign = engine.normalizeCampaign(claimed);
    const nowISO = now.toISOString();

    if (!campaign) {
        await releaseCampaign(ref, {}, serverTimestamp);
        return { skipped: true };
    }

    const close = async (reason) => {
        const batch = db.batch();
        const expired = expirePendingRequests({
            batch,
            requestDocs,
            replaced: campaign.replaced,
            keyDay: campaign.keyDay,
            reason: `auto_coverage_${reason}`,
            nowISO,
            serverTimestamp
        });

        batch.set(
            ref,
            {
                status: reason === "covered" ? "covered" : "closed",
                closedAt: nowISO,
                closeReason: reason,
                leaseUntil: "",
                leaseOwner: "",
                updatedAt: serverTimestamp()
            },
            { merge: true }
        );

        await batch.commit();

        logger.info("cobertura automatica: campaña cerrada", {
            workspaceId,
            campaignId: campaign.id,
            reason,
            expired
        });

        return { closed: true };
    };

    // El supervisor ya lo resolvio (reemplazo, preasignacion o "no requiere
    // cobertura"), o el turno ya empezo.
    if (!engine.shiftStillNeedsCoverage(campaign.replaced, campaign.keyDay)) {
        return close("covered");
    }

    const start = Date.parse(campaign.shiftStartAt || "");

    if (Number.isFinite(start) && start <= now.getTime()) {
        return close("past");
    }

    const due = engine.dueSteps(campaign, now);

    if (!due.length) {
        await releaseCampaign(ref, {}, serverTimestamp);
        return { skipped: true };
    }

    // Si nadie corrio el barrido en dos dias hay varias etapas vencidas a la
    // vez. Solo se corre la ULTIMA: mandar el primer tercio y la masiva con un
    // segundo de diferencia no ayuda a nadie y duplica los avisos.
    const steps = campaign.steps.map((step) => ({ ...step }));

    due.slice(0, -1).forEach(({ index }) => {
        steps[index].skipped = true;
        steps[index].note = "etapa vencida sin nadie que la corriera";
    });

    const target = due[due.length - 1];
    const result = await engine.runAutoCoverageStep(
        { ...campaign, steps },
        steps[target.index]
    );

    if (result.closed) return close("covered");

    if (!result.ran) {
        // El motor no pudo resolver candidatos ahora. Se guardan los saltos ya
        // decididos y se reintenta en el proximo barrido.
        await releaseCampaign(ref, { steps }, serverTimestamp);
        return { skipped: true };
    }

    steps[target.index] = result.ran;

    const batch = db.batch();

    (result.requests || []).forEach((request) => {
        if (!request?.id) return;

        batch.set(
            db.collection("workspaces").doc(workspaceId)
                .collection("replacementRequests").doc(docId(request.id)),
            {
                ...request,
                updatedAt: serverTimestamp()
            },
            { merge: true }
        );
    });

    const alertFiredAt = result.ran.alert && !campaign.alertFiredAt
        ? result.ran.ranAt
        : campaign.alertFiredAt;
    // Sin etapas pendientes y sin alerta que mostrar no queda nada por hacer.
    const remaining = steps.some((step) => !step.ranAt && !step.skipped);
    const patch = {
        steps,
        alertFiredAt,
        leaseUntil: "",
        leaseOwner: "",
        updatedAt: serverTimestamp()
    };

    if (!remaining && !alertFiredAt) {
        patch.status = "done";
        patch.closedAt = result.ran.ranAt;
        patch.closeReason = "sin-etapas";
    }

    batch.set(ref, patch, { merge: true });

    await batch.commit();

    logger.info("cobertura automatica: etapa avanzada", {
        workspaceId,
        campaignId: campaign.id,
        stage: result.ran.stage,
        etapa: engine.stageLabel(result.ran),
        enviadas: result.ran.sent?.length || 0,
        alerta: Boolean(alertFiredAt && !campaign.alertFiredAt)
    });

    return {
        ran: true,
        sent: result.ran.sent?.length || 0
    };
}

module.exports = {
    advanceAutoCoverageCampaigns,
    // Se exportan para las pruebas.
    claimCampaign,
    expirePendingRequests,
    isoFromKey,
    leaseIsLive
};
