// "Titulares de Turnos": quien pertenece a cada uno de los cuatro grupos del
// 4to turno.
//
// El 4to turno es un ciclo de CUATRO dias -Largo, Noche, Libre, Libre-, asi que
// solo existen cuatro fases posibles y cada trabajador esta en una. Dos
// trabajadores comparten grupo cuando, cualquier dia, van en la misma fase.
//
// La columna NO se lee de la rotativa configurada sino del calendario: se mira
// hacia atras, dia por dia, hasta donde deje de calzar. Asi la pantalla dice lo
// que el trabajador VIENE HACIENDO y no lo que alguien dejo escrito en su ficha.
// La ventana llega hasta tres meses; si el trabajador entro despues, o su
// rotativa empieza mas tarde, se usa lo que haya.
//
// Las letras A-D son FIJAS: se calculan contra una fecha ancla, no contra hoy.
// Si dependieran del turno del dia, cada trabajador cambiaria de columna cada 24
// horas y el listado dejaria de ser un listado de titulares. Lo que si cambia
// cada dia es el subtitulo de la columna ("hoy Largo"), que es lo que permite
// leerla de un vistazo.
//
// Solo entran trabajadores de 4to turno: el diurno no tiene fases y el 3er turno
// tiene un ciclo de seis dias, que serian otras tantas columnas.

import { getProfiles, isProfileActive, getRotativa } from "./storage.js";
import { getTurnoBase } from "./turnEngine.js";
import { rotationStartIndex } from "./rotationUtils.js";
import { keyFromDate } from "./dateUtils.js";
import { runCooperativeRange } from "./mainThreadScheduler.js";
import { escapeHTML } from "./htmlUtils.js";
import { TURNO } from "./constants.js";

// Ciclo del 4to turno, sin rotar. El indice dentro de este arreglo es la "fase".
const CYCLE = [TURNO.LARGA, TURNO.NOCHE, TURNO.LIBRE, TURNO.LIBRE];
const CYCLE_TURN_LABEL = ["Largo", "Noche", "Libre", "Libre"];
export const COLUMN_LETTERS = ["A", "B", "C", "D"];

// Hasta donde se mira hacia atras. Tres meses del requerimiento; se corta antes
// si el trabajador no tiene tanta historia.
const LOOKBACK_DAYS = 92;

// Ancla de las letras. Cualquier fecha fija sirve: lo unico que importa es que
// no se mueva, para que un trabajador conserve su columna manana. Es anterior a
// cualquier rotativa del sistema.
const ANCHOR = new Date(2000, 0, 3);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayDiff(from, to) {
    const fromUTC = Date.UTC(
        from.getFullYear(),
        from.getMonth(),
        from.getDate()
    );
    const toUTC = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());

    return Math.floor((toUTC - fromUTC) / MS_PER_DAY);
}

function mod4(value) {
    return ((value % 4) + 4) % 4;
}

function addDays(date, amount) {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + amount
    );
}

function parseISODate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));

    if (!match) return null;

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Fase del ciclo en `targetDate`, sabiendo que en `baseDate` iba en
 * `basePosition`.
 */
export function cyclePositionAt(basePosition, baseDate, targetDate) {
    return mod4(basePosition + dayDiff(baseDate, targetDate));
}

/* ==========================================================================
   Deteccion de la columna
   ========================================================================== */

/**
 * Ubica a un trabajador de 4to turno en su grupo mirando su calendario hacia
 * atras.
 *
 * Se compara contra el turno BASE y no contra el programado: un reemplazo, un
 * permiso o un turno extra son excepciones de un dia, no un cambio de grupo, y
 * ensuciarian la lectura.
 *
 * Devuelve null si el trabajador no es de 4to turno.
 */
export function detectHolderPlacement(profileName, today = new Date()) {
    const rotativa = getRotativa(profileName);

    if (rotativa.type !== "4turno") return null;

    const start = parseISODate(rotativa.start);

    // Turnos base observados, de hoy hacia atras. Se corta en el inicio de la
    // rotativa: antes de esa fecha el motor devuelve Libre para todo, y eso no
    // es evidencia de nada.
    const observed = [];

    for (let back = 0; back < LOOKBACK_DAYS; back++) {
        const date = addDays(today, -back);

        if (start && date < start) break;

        observed.push(getTurnoBase(profileName, keyFromDate(date)));
    }

    if (!observed.length) return null;

    // Fase que dice la ficha. Sirve para desempatar y como respaldo cuando el
    // calendario no calza con ninguna (por ejemplo, si le editaron la base de
    // hoy a un turno que no pertenece al ciclo).
    const configured = start
        ? mod4(
            rotationStartIndex("4turno", rotativa.firstTurn) +
            dayDiff(start, today)
        )
        : null;

    let best = null;

    for (let position = 0; position < 4; position++) {
        let streak = 0;

        while (
            streak < observed.length &&
            observed[streak] === CYCLE[mod4(position - streak)]
        ) {
            streak++;
        }

        const isBetter =
            !best ||
            streak > best.streak ||
            // Empate: gana la fase que dice la ficha. Sin este desempate, dos
            // trabajadores del mismo grupo podrian caer en columnas distintas
            // segun el orden del bucle.
            (streak === best.streak && position === configured);

        if (isBetter) best = { position, streak };
    }

    const position = best.streak > 0
        ? best.position
        : (configured ?? best.position);
    const streakDays = best.streak > 0 ? best.streak : 0;
    const letterIndex = cyclePositionAt(position, today, ANCHOR);

    return {
        profileName,
        letterIndex,
        letter: COLUMN_LETTERS[letterIndex],
        position,
        todayTurn: CYCLE[position],
        todayTurnLabel: CYCLE_TURN_LABEL[position],
        streakDays,
        historyDays: observed.length,
        // Cambio de grupo dentro de la ventana: la racha se corta antes de que
        // se acabe la historia disponible.
        changedGroup: streakDays > 0 && streakDays < observed.length,
        // No hay tres meses para mirar (ingreso reciente o rotativa nueva). El
        // requerimiento lo contempla: se usa lo que haya.
        shortHistory: observed.length < LOOKBACK_DAYS,
        unmatched: streakDays === 0
    };
}

/**
 * Cuanto lleva en el grupo, en la unidad que se lee de un vistazo.
 */
export function formatHolderStreak(days) {
    const value = Number(days) || 0;

    if (value <= 0) return "sin coincidencias";
    if (value < 14) return value === 1 ? "1 día" : `${value} días`;

    if (value < 60) {
        const weeks = Math.floor(value / 7);

        return weeks === 1 ? "1 semana" : `${weeks} semanas`;
    }

    const months = Math.round((value / 30.4) * 10) / 10;

    return `${String(months).replace(".", ",")} meses`;
}

/* ==========================================================================
   Colores por estamento / profesion
   ========================================================================== */

const ESTAMENTO_ORDER = [
    "Profesional",
    "Técnico",
    "Administrativo",
    "Auxiliar"
];

function profileEstamento(profile) {
    return String(profile?.estamento || "").trim() || "Sin estamento";
}

function profileProfession(profile) {
    return String(profile?.profession || "").trim() || "Sin profesión";
}

/**
 * Clave de color de un trabajador.
 *
 * Un color por estamento; dentro de Profesional, uno por profesion cuando hay
 * mas de una. Es lo que pidio el requerimiento y tiene sentido practico: en una
 * unidad los "profesionales" pueden ser enfermeria, kinesiologia y matroneria a
 * la vez, y verlos todos del mismo color no dice nada.
 */
export function holderColorKey(profile, splitProfessions) {
    const estamento = profileEstamento(profile);

    if (estamento === "Profesional" && splitProfessions) {
        return `Profesional · ${profileProfession(profile)}`;
    }

    return estamento;
}

/**
 * Posicion del estamento en el orden del listado. Uno fuera del catalogo -dato
 * antiguo- va al final y no al principio, que es lo que haria el -1 de indexOf.
 */
function estamentoRank(profile) {
    const index = ESTAMENTO_ORDER.indexOf(profileEstamento(profile));

    return index === -1 ? ESTAMENTO_ORDER.length : index;
}

/**
 * Orden dentro de la columna: primero el estamento -profesionales, tecnicos,
 * administrativos y al final auxiliares-, dentro de cada uno por profesion, y
 * dentro de la profesion por abecedario.
 *
 * Es el mismo criterio con el que se reparten los colores, asi que la columna se
 * lee por bloques de color en vez de alternarlos linea por linea.
 */
export function compareHolders(left, right) {
    return (
        estamentoRank(left.profile) - estamentoRank(right.profile) ||
        profileProfession(left.profile).localeCompare(
            profileProfession(right.profile),
            "es"
        ) ||
        String(left.profile.name).localeCompare(
            String(right.profile.name),
            "es"
        )
    );
}

/**
 * Asigna un indice de paleta a cada clave presente, en un orden estable: los
 * estamentos en el orden de siempre y, dentro de Profesional, las profesiones
 * alfabeticamente. Sin esto, agregar un trabajador podria recolorear la
 * pantalla entera.
 */
export function buildColorAssignments(profiles) {
    const professions = [...new Set(
        profiles
            .filter(profile => profileEstamento(profile) === "Profesional")
            .map(profileProfession)
    )].sort((left, right) => left.localeCompare(right, "es"));
    const splitProfessions = professions.length > 1;
    const keys = [];

    ESTAMENTO_ORDER.forEach(estamento => {
        const present = profiles.some(profile =>
            profileEstamento(profile) === estamento
        );

        if (!present) return;

        if (estamento === "Profesional" && splitProfessions) {
            professions.forEach(profession => {
                keys.push(`Profesional · ${profession}`);
            });
            return;
        }

        keys.push(estamento);
    });

    // Estamentos fuera del catalogo (datos antiguos) al final, para que no
    // desordenen los colores de los conocidos.
    [...new Set(profiles.map(profileEstamento))]
        .filter(estamento => !ESTAMENTO_ORDER.includes(estamento))
        .sort((left, right) => left.localeCompare(right, "es"))
        .forEach(estamento => keys.push(estamento));

    const colors = new Map();

    keys.forEach((key, index) => colors.set(key, index));

    return { colors, splitProfessions };
}

/* ==========================================================================
   Armado del tablero
   ========================================================================== */

/**
 * Recorre los trabajadores de 4to turno y los reparte en las cuatro columnas.
 *
 * El barrido cede el hilo entre trabajador y trabajador: cada uno mira hasta 92
 * dias de calendario, y en una unidad grande hacerlo de corrido congelaria la
 * pagina.
 */
export async function buildShiftHolders(today = new Date()) {
    const profiles = getProfiles().filter(isProfileActive);
    const placements = [];

    await runCooperativeRange(0, profiles.length - 1, index => {
        const profile = profiles[index];
        const placement = detectHolderPlacement(profile.name, today);

        if (placement) placements.push({ ...placement, profile });
    });

    const { colors, splitProfessions } = buildColorAssignments(
        placements.map(item => item.profile)
    );
    const columns = COLUMN_LETTERS.map((letter, letterIndex) => {
        const workers = placements
            .filter(item => item.letterIndex === letterIndex)
            .map(item => ({
                ...item,
                colorKey: holderColorKey(item.profile, splitProfessions),
                colorIndex: colors.get(
                    holderColorKey(item.profile, splitProfessions)
                ) ?? 0
            }))
            .sort(compareHolders);
        // El turno de hoy se saca de cualquiera de sus integrantes: por
        // definicion todos van en la misma fase. Si la columna esta vacia se
        // proyecta desde el ancla, para que el encabezado no quede mudo.
        const position = workers.length
            ? workers[0].position
            : cyclePositionAt(letterIndex, ANCHOR, today);

        return {
            letter,
            letterIndex,
            todayTurnLabel: CYCLE_TURN_LABEL[position],
            todayTurn: CYCLE[position],
            workers
        };
    });

    return {
        columns,
        total: placements.length,
        legend: [...colors.entries()]
            .sort((left, right) => left[1] - right[1])
            .map(([key, index]) => ({ key, index })),
        splitProfessions
    };
}

/* ==========================================================================
   Render
   ========================================================================== */

function turnClass(turno) {
    if (Number(turno) === TURNO.LARGA) return "larga";
    if (Number(turno) === TURNO.NOCHE) return "noche";

    return "libre";
}

function workerCardHTML(worker) {
    const profession = profileProfession(worker.profile);
    const notes = [];

    if (worker.unmatched) {
        notes.push("sin calce con el ciclo");
    } else {
        notes.push(formatHolderStreak(worker.streakDays));
    }

    if (worker.changedGroup) notes.push("cambió de grupo");

    const warn = worker.changedGroup || worker.unmatched || worker.shortHistory;

    return `
        <li class="tt-worker tt-color-${worker.colorIndex}">
            <span class="tt-worker-name">${escapeHTML(worker.profile.name)}</span>
            <span class="tt-worker-meta">${escapeHTML(profession)}</span>
            <span class="tt-worker-note ${warn ? "is-warn" : ""}">${
                warn ? "⚠ " : ""
            }${escapeHTML(notes.join(" · "))}</span>
        </li>`;
}

function columnHTML(column) {
    const body = column.workers.length
        ? `<ul class="tt-list">${column.workers.map(workerCardHTML).join("")}</ul>`
        : `<p class="tt-empty">Sin titulares en este grupo.</p>`;

    return `
        <section class="tt-column">
            <header class="tt-column-head tt-column-head--${turnClass(column.todayTurn)}">
                <span class="tt-letter">${escapeHTML(column.letter)}</span>
                <span class="tt-today">hoy ${escapeHTML(column.todayTurnLabel)}</span>
                <span class="tt-count">${column.workers.length}</span>
            </header>
            ${body}
        </section>`;
}

function legendHTML(legend) {
    if (!legend.length) return "";

    return `
        <div class="tt-legend">
            ${legend.map(item => `
                <span class="tt-legend-item tt-color-${item.index}">
                    <i class="tt-legend-dot"></i>${escapeHTML(item.key)}
                </span>`).join("")}
        </div>`;
}

function boardHTML(board, today) {
    const fecha = today.toLocaleDateString("es-CL", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });

    if (!board.total) {
        return `
            <div class="tt-root">
                <header class="tt-head">
                    <h2>Titulares de Turnos</h2>
                    <p>Sin trabajadores de 4° turno activos en la unidad.</p>
                </header>
            </div>`;
    }

    return `
        <div class="tt-root">
            <header class="tt-head">
                <h2>Titulares de Turnos</h2>
                <p>
                    Los cuatro grupos del 4° turno, según la rotativa que cada
                    trabajador viene haciendo en los últimos 3 meses.
                    <span class="tt-head-date">${escapeHTML(fecha)}</span>
                </p>
            </header>
            ${legendHTML(board.legend)}
            <div class="tt-board">
                ${board.columns.map(columnHTML).join("")}
            </div>
            <p class="tt-note">
                Las letras no cambian: un trabajador conserva su columna aunque
                el turno del día rote. El subtítulo dice qué le toca hoy a cada
                grupo.
            </p>
        </div>`;
}

export async function renderShiftHoldersPanel() {
    const root = document.getElementById("shiftHoldersPanel");

    if (!root) return;

    root.innerHTML = `<div class="tt-root"><p class="tt-loading">Revisando el calendario de los últimos 3 meses…</p></div>`;

    const today = new Date();
    const board = await buildShiftHolders(today);
    const node = document.getElementById("shiftHoldersPanel");

    // La vista pudo cambiar mientras se calculaba.
    if (!node) return;

    node.innerHTML = boardHTML(board, today);
}
