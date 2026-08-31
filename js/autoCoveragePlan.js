// Reglas de la cobertura automatica por etapas, sin estado ni entorno.
//
// Aqui esta el QUE decide la campaña: cuando le toca a cada etapa, a quien le
// llega y como se lee el tiempo que queda. Nada de localStorage, Firestore, DOM
// ni relojes propios: todo entra por parametro.
//
// Existe separado de autoCoverage.js porque lo corren DOS lados y tienen que
// decidir IDENTICO:
//
//   - el navegador (js/autoCoverage.js), que arranca la campaña y manda la
//     primera oleada apenas el supervisor aprieta el boton;
//   - la Cloud Function que hace avanzar las etapas siguientes cuando nadie
//     tiene la aplicacion abierta (functions/index.js con
//     functions/engine/autoCoverage.mjs).
//
// El plan de la campaña:
//
//   Con mas de 72 h para el turno:
//     t=0    A  primer tercio con MENOS horas extras del mes DEL TURNO
//     t=24h  B  segundo tercio
//     t=48h  C  masiva a todos + D alerta sonora al supervisor
//
//   Con menos de 72 h: se entra directo en C, y D sale 24 h despues o a la
//   mitad del tiempo que falta para el turno, lo que ocurra primero. Sin ese
//   tope, un turno que empieza en 6 horas nunca alcanzaria a generar la alerta.
//
// Filtros por etapa (los numeros son los del requerimiento):
//     1. dia bloqueado por el trabajador desde su PWA  -> A y B
//     2. turno de dia al dia siguiente (tarjeta amarilla del modal de
//        sugerencias) -> A y B
//     3. tercio con menos horas extras -> A y B (C manda a todos)
//     4. tope mensual de horas extras DIURNAS -> SIEMPRE, incluida la masiva
//
// Los puntos 3 y 4 se miden contra el mes DEL TURNO A CUBRIR, no contra el mes
// en curso. Eso no se resuelve aca sino en replacementCandidates.js, que arma el
// mes desde el keyDay; este modulo solo consume `hhee` y `exceedsDiurnalLimit`
// ya calculados con ese mes.

export const HOUR_MS = 60 * 60 * 1000;
export const STAGE_MS = 24 * HOUR_MS;
// Umbral del requerimiento: por debajo de esto no hay tiempo para repartir la
// solicitud por tercios y se entra directo en la masiva.
export const AUTO_COVERAGE_DIRECT_MASS_HOURS = 72;
// Piso de la alerta acortada del camino corto: si el turno empieza en 20
// minutos, avisar "en 10 minutos" no le sirve a nadie, pero avisar de inmediato
// tampoco deja margen a que alguien conteste.
export const MIN_SHORT_ALERT_MS = 5 * 60 * 1000;

/* ==========================================================================
   Forma de los datos
   ========================================================================== */

export function normalizeStep(step = {}) {
    return {
        stage: Number(step.stage) || 0,
        kind: String(step.kind || ""),
        third: Number(step.third) || 0,
        at: String(step.at || ""),
        ranAt: String(step.ranAt || ""),
        skipped: step.skipped === true,
        alert: step.alert === true,
        groupId: String(step.groupId || ""),
        sent: Array.isArray(step.sent) ? step.sent.map(String) : [],
        requestIds: Array.isArray(step.requestIds)
            ? step.requestIds.map(String)
            : [],
        poolSize: Number(step.poolSize) || 0,
        overLimit: Number(step.overLimit) || 0,
        note: String(step.note || "")
    };
}

export function normalizeCampaign(campaign = {}) {
    if (!campaign?.id || !campaign?.replaced || !campaign?.keyDay) return null;

    return {
        id: String(campaign.id),
        replaced: String(campaign.replaced),
        keyDay: String(campaign.keyDay),
        date: String(campaign.date || ""),
        turno: Number(campaign.turno) || 0,
        turnoLabel: String(campaign.turnoLabel || ""),
        absenceType: String(campaign.absenceType || ""),
        path: campaign.path === "short" ? "short" : "full",
        status: String(campaign.status || "active"),
        createdAt: String(campaign.createdAt || new Date().toISOString()),
        shiftStartAt: String(campaign.shiftStartAt || ""),
        closedAt: String(campaign.closedAt || ""),
        closeReason: String(campaign.closeReason || ""),
        alertFiredAt: String(campaign.alertFiredAt || ""),
        // Reserva del turno de avance. Evita que dos supervisores -o el
        // servidor y un navegador- manden la misma oleada dos veces.
        leaseUntil: String(campaign.leaseUntil || ""),
        leaseOwner: String(campaign.leaseOwner || ""),
        steps: (Array.isArray(campaign.steps) ? campaign.steps : [])
            .map(normalizeStep)
    };
}

/* ==========================================================================
   Cuando empieza el turno
   ========================================================================== */

/**
 * Instante en que empieza el turno. Es lo que decide si quedan mas o menos de
 * 72 horas y lo que se muestra como "tiempo restante" en la alerta.
 *
 * `entryTime` es la hora de ingreso del turno ("HH:MM"), que el llamador saca de
 * scheduledEntryTime. Cuando el turno no tiene horario fijo definido -24h, D+N,
 * 1/2M, extension horaria, 18 horas- se cae a la mañana o a la tarde segun por
 * donde parte: en una cuenta regresiva de dias vale mucho mas eso que dejarla en
 * blanco.
 */
export function shiftStartInstant(keyDay, entryTime, startsInTheMorning = true) {
    const parts = String(keyDay || "").split("-").map(Number);

    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;

    const date = new Date(parts[0], parts[1], parts[2]);

    if (Number.isNaN(date.getTime())) return null;

    const time = entryTime || (startsInTheMorning ? "08:00" : "14:00");
    const [hours, minutes] = String(time).split(":").map(Number);

    date.setHours(
        Number.isFinite(hours) ? hours : 8,
        Number.isFinite(minutes) ? minutes : 0,
        0,
        0
    );

    return date;
}

/* ==========================================================================
   Plan de etapas
   ========================================================================== */

export function buildPlan(now, shiftStartAt) {
    const leadMs = shiftStartAt
        ? shiftStartAt.getTime() - now.getTime()
        : Number.POSITIVE_INFINITY;

    if (leadMs > AUTO_COVERAGE_DIRECT_MASS_HOURS * HOUR_MS) {
        return {
            path: "full",
            steps: [
                {
                    stage: 1,
                    kind: "third",
                    third: 1,
                    at: new Date(now.getTime()).toISOString()
                },
                {
                    stage: 2,
                    kind: "third",
                    third: 2,
                    at: new Date(now.getTime() + STAGE_MS).toISOString()
                },
                {
                    // C y D caen juntas: a las 48 h se abre la solicitud a
                    // todos y en ese mismo momento se levanta la alerta del
                    // supervisor, que asi conserva al menos 24 h de margen.
                    stage: 3,
                    kind: "mass",
                    at: new Date(now.getTime() + 2 * STAGE_MS).toISOString(),
                    alert: true
                }
            ]
        };
    }

    // Camino corto: masiva ahora y alerta acotada al tiempo que queda.
    const halfLead = Number.isFinite(leadMs) ? leadMs / 2 : STAGE_MS;
    const alertDelay = Math.min(
        STAGE_MS,
        Math.max(halfLead, MIN_SHORT_ALERT_MS)
    );

    return {
        path: "short",
        steps: [
            {
                stage: 3,
                kind: "mass",
                at: new Date(now.getTime()).toISOString()
            },
            {
                stage: 4,
                kind: "alert",
                at: new Date(now.getTime() + alertDelay).toISOString(),
                alert: true
            }
        ]
    };
}

/**
 * Etapas vencidas de una campaña, en orden.
 *
 * Si la sesion estuvo cerrada dos dias hay varias vencidas a la vez: solo se
 * corre la ULTIMA. Mandar el primer tercio y la masiva con un segundo de
 * diferencia no ayuda a nadie y duplica los avisos, asi que las anteriores se
 * marcan como saltadas.
 */
export function dueSteps(campaign, now) {
    const at = now instanceof Date ? now.getTime() : Number(now);

    return (campaign?.steps || [])
        .map((step, index) => ({ step, index }))
        .filter(({ step }) =>
            !step.ranAt &&
            !step.skipped &&
            new Date(step.at).getTime() <= at
        );
}

export function stageLabel(step) {
    if (step?.kind === "third") {
        return step.third === 1
            ? "primer tercio con menos horas extras"
            : "segundo tercio";
    }

    return step?.kind === "mass"
        ? "solicitud masiva"
        : "alerta al supervisor";
}

/* ==========================================================================
   Seleccion de destinatarios
   ========================================================================== */

function candidateOvertime(candidate) {
    return Number(candidate?.hhee) || 0;
}

/**
 * Base comun a todas las etapas.
 *
 * - `isForced`: no cumple el perfil del ausente. Un reemplazo cruzado sigue
 *   siendo decision manual del supervisor en el modal de sugerencias; ofrecerlo
 *   en automatico dejaria que alguien acepte un turno que no le corresponde.
 * - `isLinked`: es de otra unidad y va por el prestamo entre unidades, que
 *   tiene su propio circuito de autorizacion.
 * - `exceedsDiurnalLimit`: es la regla 4, y no se levanta en ninguna etapa,
 *   tampoco en la masiva.
 */
export function baseEligible(candidates) {
    return (candidates || []).filter(candidate =>
        !candidate.isForced &&
        !candidate.isLinked &&
        !candidate.exceedsDiurnalLimit
    );
}

export function stageEligible(candidates, step) {
    const base = baseEligible(candidates);

    // La masiva quita los filtros 1 y 2 y el tercio; solo conserva la regla 4.
    if (step?.kind === "mass") return base;

    return base.filter(candidate =>
        !candidate.blockedDay &&
        !candidate.nextDayMorningShift
    );
}

/**
 * Tercio `index` (1-based) ordenando de MENOS a MAS horas extras del mes del
 * turno. El corte se calcula con Math.ceil para que con 4 candidatos el primer
 * tercio sean 2 y no 1: dejar el reparto en cero por redondeo hacia abajo seria
 * peor que pasarse por uno.
 *
 * El desempate por nombre no es cosmetico: sin el, dos corridas del mismo tercio
 * podrian mandarle la solicitud a personas distintas.
 */
export function overtimeThird(candidates, index) {
    const sorted = [...(candidates || [])].sort((left, right) =>
        candidateOvertime(left) - candidateOvertime(right) ||
        String(left.profile?.name || "").localeCompare(
            String(right.profile?.name || "")
        )
    );

    if (!sorted.length) return [];

    const size = Math.ceil(sorted.length / 3);

    return sorted.slice((index - 1) * size, index * size);
}

/**
 * A quien le toca esta etapa.
 *
 * `hasApp` responde si el trabajador tiene la PWA enlazada para recibirla, y
 * `pending` son los que ya tienen una solicitud viva por este mismo turno
 * (mandarles otra les duplicaria el aviso en el telefono).
 *
 * Devuelve tambien `overLimit`: cuantos podian cubrir el turno y quedaron fuera
 * SOLO por la regla 4. El supervisor necesita distinguir "nadie puede cubrirlo"
 * de "todos se pasarian del tope", que se resuelven distinto.
 */
export function selectStageTargets(campaign, step, candidates, {
    hasApp = () => true,
    pending = new Set()
} = {}) {
    // Nadie recibe dos veces la misma solicitud por los tercios. Entre una
    // oleada y la siguiente el reparto se recalcula -las horas extras cambian
    // solas cuando alguien toma otro turno- y sin esto un trabajador del primer
    // tercio podia caer en el segundo y que le llegara de nuevo. La masiva SI
    // vuelve a preguntarles: para eso es masiva.
    const alreadySent = new Set(
        (campaign?.steps || []).flatMap(previous => previous.sent || [])
    );
    // El tercio se corta sobre el ranking COMPLETO y recien despues se descarta
    // a los ya contactados. Al reves -sacarlos antes de cortar- el segundo
    // tercio se calcularia sobre una lista ya sin el primero y se saltaria justo
    // a la gente que le tocaba.
    const eligible = stageEligible(candidates, step);
    const selected = (
        step?.kind === "third"
            ? overtimeThird(eligible, step.third)
            : eligible
    ).filter(candidate =>
        step?.kind === "mass" ||
        !alreadySent.has(candidate.profile.name)
    );
    const targets = selected.filter(candidate =>
        hasApp(candidate.profile.name) &&
        !pending.has(candidate.profile.name)
    );
    const overLimit = (candidates || []).filter(candidate =>
        !candidate.isForced &&
        !candidate.isLinked &&
        candidate.exceedsDiurnalLimit
    ).length;

    return { eligible, selected, targets, overLimit };
}

/* ==========================================================================
   Presentacion
   ========================================================================== */

/**
 * Cuanto falta para el turno, en la unidad que pide el requerimiento: dias
 * cuando quedan mas de 2 dias, horas cuando queda menos.
 */
export function formatCoverageTimeLeft(msLeft) {
    if (!Number.isFinite(msLeft)) return "";
    if (msLeft <= 0) return "El turno ya empezó";

    const hours = msLeft / HOUR_MS;

    if (hours > 48) {
        const days = Math.floor(hours / 24);

        return `${days} días`;
    }

    const whole = Math.floor(hours);

    if (whole >= 1) {
        return whole === 1 ? "1 hora" : `${whole} horas`;
    }

    const minutes = Math.max(1, Math.round(msLeft / 60000));

    return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

/**
 * Etiqueta corta del estado de una campaña para la fila de cobertura del
 * inicio.
 */
export function campaignStatusLabel(campaign) {
    if (!campaign) return "";

    const done = campaign.steps
        .filter(step => step.ranAt || step.skipped).length;
    const total = campaign.steps.length;
    const current = [...campaign.steps]
        .reverse()
        .find(step => step.ranAt);

    if (!current) return "Cobertura automática iniciada";

    return `Cobertura automática · ${stageLabel(current)} (${done}/${total})`;
}
