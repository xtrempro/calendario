// Botones de turno del menu Turnos: "Diurno", "Larga" y "Noche".
//
// El supervisor elige el turno en el boton y despues marca el dia, sin pasar por
// el switch de "Editar". Lo que este archivo fija es la regla que decide QUE
// casillas se iluminan y en que queda el dia al marcarlas, porque de ella cuelga
// todo lo demas: si iluminara una casilla que despues rechaza el guardado, el
// supervisor haria click y no pasaria nada.
//
// La regla no se reinventa: es la misma suma de turnos de la edicion directa
// (fusionarTurnos) limitada a los turnos que admite el dia. Por eso el caso que
// pidio el usuario -Diurno sobre un dia hábil con Noche deja D+N- sale solo.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(k) { return this.values.has(k) ? this.values.get(k) : null; }
    key(i) { return [...this.values.keys()][i] ?? null; }
    removeItem(k) { this.values.delete(k); }
    setItem(k, v) { this.values.set(k, String(v)); }
}

globalThis.localStorage = new MemoryStorage();

const { setJSON } = await import("../js/persistence.js");
const { getAddTurnResult } = await import("../js/turnEngine.js");
const { TURNO } = await import("../js/constants.js");

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const html = await leer("../index.html");
const main = await leer("../js/main.js");
const calendar = await leer("../js/calendar.js");

const NOMBRE = "Trabajadora";
// Julio 2026: el 1 cae miercoles. Lunes 6 (hábil), sabado 11 (no hábil).
const LUNES = "2026-6-6";
const SABADO = "2026-6-11";

function sembrar() {
    localStorage.clear();
    setJSON("profiles", [
        { name: NOMBRE, contractType: "Planta", estamento: "Profesional" }
    ]);
    setJSON("rotativa_" + NOMBRE, { type: "libre" });
}

beforeEach(sembrar);

// Atajo: pregunta por un dia con un turno ya puesto y otro elegido en el boton.
function poner(elegido, { actual = TURNO.LIBRE, base = actual, isHab = true, key = LUNES } = {}) {
    return getAddTurnResult(NOMBRE, key, elegido, isHab, {
        effectiveBaseTurn: base,
        actualState: actual,
        replacementTurn: TURNO.LIBRE
    });
}

/* ───────── El caso que pidio el usuario ───────── */

test("Diurno sobre un dia hábil con Noche deja D+N", () => {
    const r = poner(TURNO.DIURNO, { actual: TURNO.NOCHE });

    assert.equal(r.allowed, true);
    assert.equal(r.nextVisibleTurn, TURNO.DIURNO_NOCHE);
    assert.equal(r.nextStoredTurn, TURNO.DIURNO_NOCHE);
});

test("ese mismo dia, en fin de semana, NO se ilumina", () => {
    // D+N solo existe en dia hábil: en sabado el boton Diurno no debe ofrecer
    // esa casilla, o el supervisor marcaria un turno que el motor no admite.
    const r = poner(TURNO.DIURNO, { actual: TURNO.NOCHE, isHab: false, key: SABADO });

    assert.equal(r.allowed, false);
});

/* ───────── Dia libre: el turno entra tal cual ───────── */

test("en un dia libre cada boton pone su propio turno", () => {
    assert.deepEqual(
        [TURNO.DIURNO, TURNO.LARGA, TURNO.NOCHE].map(t => {
            const r = poner(t);
            return [r.allowed, r.nextVisibleTurn];
        }),
        [
            [true, TURNO.DIURNO],
            [true, TURNO.LARGA],
            [true, TURNO.NOCHE]
        ]
    );
});

test("un dia libre de fin de semana admite Larga y Noche, pero no Diurno", () => {
    const opciones = { isHab: false, key: SABADO };

    assert.equal(poner(TURNO.LARGA, opciones).allowed, true);
    assert.equal(poner(TURNO.NOCHE, opciones).allowed, true);
    // El ciclo de la edicion directa tampoco ofrece Diurno en dia no hábil.
    assert.equal(poner(TURNO.DIURNO, opciones).allowed, false);
});

/* ───────── Sumas sobre un turno ya puesto ───────── */

test("Noche sobre Larga deja 24h", () => {
    const r = poner(TURNO.NOCHE, { actual: TURNO.LARGA });

    assert.equal(r.allowed, true);
    assert.equal(r.nextVisibleTurn, TURNO.TURNO24);
});

test("Larga sobre un Diurno extiende la jornada a Larga", () => {
    const r = poner(TURNO.LARGA, { actual: TURNO.DIURNO });

    assert.equal(r.allowed, true);
    assert.equal(r.nextVisibleTurn, TURNO.LARGA);
});

test("el turno que ya esta puesto no ilumina su casilla", () => {
    // Sin esto la casilla se iluminaria y el click no haria nada visible.
    assert.equal(poner(TURNO.DIURNO, { actual: TURNO.DIURNO }).allowed, false);
    assert.equal(poner(TURNO.NOCHE, { actual: TURNO.NOCHE }).allowed, false);
    assert.equal(poner(TURNO.LARGA, { actual: TURNO.LARGA }).allowed, false);
});

test("un dia cerrado en 24h o D+N no admite nada mas", () => {
    [TURNO.TURNO24, TURNO.DIURNO_NOCHE].forEach(actual => {
        [TURNO.DIURNO, TURNO.LARGA, TURNO.NOCHE].forEach(elegido => {
            assert.equal(
                poner(elegido, { actual }).allowed,
                false,
                `${elegido} sobre ${actual}`
            );
        });
    });
});

/* ───────── El 24h respeta su interruptor ───────── */

test("sin turnos de 24h permitidos, Noche sobre Larga no se ofrece", () => {
    setJSON("turnChangeConfig", { allowTwentyFourHourShifts: false });

    assert.equal(poner(TURNO.NOCHE, { actual: TURNO.LARGA }).allowed, false);
});

/* ───────── Cableado ───────── */

test("los tres botones viven en el espacio del menu Turnos", () => {
    const panel = html.slice(
        html.indexOf('id="turnosSidePanel"'),
        html.indexOf("</section>", html.indexOf('id="turnosSidePanel"'))
    );

    assert.match(panel, /data-add-turn="diurno"/);
    assert.match(panel, /data-add-turn="larga"/);
    assert.match(panel, /data-add-turn="noche"/);
});

test("un boton pone un turno y despues el modo se apaga solo", () => {
    // Lo eligio el usuario: dejar el modo armado invita a marcar un dia sin
    // querer.
    assert.match(
        main,
        /async function handleAddTurnSelection\([\s\S]{0,900}\/\/ Un boton, un turno\.\s*\r?\n\s*clearSelectionMode\(\);/
    );
});

test("la casilla que se ilumina y el turno que se guarda salen del mismo sitio", () => {
    // Si el pintado usara una regla propia, podria iluminar una casilla que el
    // guardado despues rechaza.
    assert.match(calendar, /export function canAddTurnToDay\(/);
    assert.match(calendar, /export function addTurnToDay\(/);
    assert.match(
        calendar,
        /function canAddTurnToDay\([\s\S]{0,1200}return getAddTurnResult\(/
    );
    assert.match(
        calendar,
        /function addTurnToDay\([\s\S]{0,1200}getAddTurnResult\(/
    );
    assert.match(calendar, /if \(!result\.allowed\) return false;/);
});

test("un dia con permiso o devolucion de horas no se toca desde el boton", () => {
    assert.match(
        calendar,
        /function canAddTurnToDay\([\s\S]{0,900}tieneAusencia\(keyDay, admin, legal, comp, absences\) \|\|\s*\r?\n\s*hourReturns\?\.\[keyDay\]/
    );
});

test("guardar el turno pasa por el mismo sitio que la edicion directa", () => {
    // La cola de guardado (bitacora, respaldos de turno extra, marcas del reloj)
    // vive en una sola funcion: duplicarla dejaria basura en una de las dos vias.
    assert.match(calendar, /function commitCalendarTurnChange\(\{/);
    assert.match(calendar, /commitCalendarTurnChange\(\{[\s\S]{0,400}historyLabel: `Edicion directa/);
    assert.match(calendar, /commitCalendarTurnChange\(\{[\s\S]{0,400}historyLabel: `Turno agregado/);
});
