// Dos cosas del modal de dotacion del inicio.
//
// 1. Para ver otro estamento habia que CERRAR el modal, apretar otra tarjeta y
//    volver a buscar la fecha. La fecha elegida se perdia en cada salto, que es
//    lo caro cuando se esta mirando un dia puntual. Ahora hay chips.
//
// 2. La lista iba en orden alfabetico puro, asi que los horarios quedaban
//    entreverados: en el turno de dia se mezclaba quien sale a las 20:00 con
//    quien sale a las 17:00, y no se veia de un vistazo cuanta gente cubre la
//    tarde. Ahora agrupa por tramo horario y ordena alfabetico dentro del grupo.
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

const { getDotacionDetalle } = await import("../js/home.js");
const { TURNO } = await import("../js/constants.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const home = await read("../js/home.js");
const styles = await read("../styles.css");

const key = date =>
    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

// Un miercoles, para que el Diurno termine a las 17:00 y no a las 16:00.
const MIERCOLES = new Date(2026, 8, 9);

// A proposito los nombres NO estan en orden alfabetico global: si el orden
// siguiera siendo alfabetico puro, Ana (Diurno, sale 17:00) quedaria primera y
// el test lo detecta.
const LARGA_Z = "Zulema Rojas";
const LARGA_B = "Beatriz Rojas";
const DIURNO_A = "Ana Rojas";
const DIURNO_C = "Carlos Rojas";
const NOCHE_X = "Ximena Soto";
const TECNICO = "Tomas Tapia";

function seed() {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify([
        { id: "p-1", name: LARGA_Z, estamento: "Profesional", active: true },
        { id: "p-2", name: LARGA_B, estamento: "Profesional", active: true },
        { id: "p-3", name: DIURNO_A, estamento: "Profesional", active: true },
        { id: "p-4", name: DIURNO_C, estamento: "Profesional", active: true },
        { id: "p-5", name: NOCHE_X, estamento: "Profesional", active: true },
        { id: "p-6", name: TECNICO, estamento: "Técnico", active: true }
    ]));

    const dia = key(MIERCOLES);

    // Dos largas (08:00 a 20:00) y dos diurnos (08:00 a 17:00).
    localStorage.setItem("data_" + LARGA_Z, JSON.stringify({ [dia]: TURNO.LARGA }));
    localStorage.setItem("data_" + LARGA_B, JSON.stringify({ [dia]: TURNO.LARGA }));
    localStorage.setItem("data_" + DIURNO_A, JSON.stringify({ [dia]: TURNO.DIURNO }));
    localStorage.setItem("data_" + DIURNO_C, JSON.stringify({ [dia]: TURNO.DIURNO }));
    localStorage.setItem("data_" + NOCHE_X, JSON.stringify({ [dia]: TURNO.NOCHE }));
    localStorage.setItem("data_" + TECNICO, JSON.stringify({ [dia]: TURNO.LARGA }));
}

test("agrupa por tramo horario y ordena alfabetico dentro del grupo", () => {
    seed();

    const dia = getDotacionDetalle(MIERCOLES).byEstamento["Profesional"].dia;

    assert.deepEqual(
        dia.map(item => `${item.name} ${item.time}`),
        [
            // Primero los de jornada mas larga, alfabeticos entre si.
            `${LARGA_B} 08:00 a 20:00`,
            `${LARGA_Z} 08:00 a 20:00`,
            // Y al final los que salen a las 17:00, tambien alfabeticos.
            `${DIURNO_A} 08:00 a 17:00`,
            `${DIURNO_C} 08:00 a 17:00`
        ]
    );
});

test("con orden alfabetico puro Ana quedaria primera: el grupo manda", () => {
    seed();

    const dia = getDotacionDetalle(MIERCOLES).byEstamento["Profesional"].dia;

    // Ana Rojas es la primera del abecedario entre las cuatro, pero sale a las
    // 17:00, asi que va al final. Es lo que distingue el orden nuevo del viejo.
    assert.notEqual(dia[0].name, DIURNO_A);
    assert.equal(dia[dia.length - 1].name, DIURNO_C);
});

test("el turno de noche, con un solo tramo, queda alfabetico", () => {
    seed();

    const noche = getDotacionDetalle(MIERCOLES).byEstamento["Profesional"].noche;

    assert.deepEqual(
        noche.map(item => item.time),
        ["20:00 a 08:00"]
    );
});

test("un viernes el grupo del Diurno sale a las 16:00 y sigue al final", () => {
    seed();

    const viernes = new Date(2026, 8, 11);
    const dia = key(viernes);

    localStorage.setItem("data_" + LARGA_Z, JSON.stringify({ [dia]: TURNO.LARGA }));
    localStorage.setItem("data_" + DIURNO_A, JSON.stringify({ [dia]: TURNO.DIURNO }));

    const lista = getDotacionDetalle(viernes).byEstamento["Profesional"].dia;

    assert.deepEqual(
        lista.map(item => `${item.name} ${item.time}`),
        [
            `${LARGA_Z} 08:00 a 20:00`,
            `${DIURNO_A} 08:00 a 16:00`
        ]
    );
});

test("el detalle expone todos los estamentos con gente ese dia", () => {
    seed();

    // Es lo que alimenta los chips: si solo saliera el abierto, no habria a
    // donde saltar.
    assert.deepEqual(
        getDotacionDetalle(MIERCOLES).estamentos,
        ["Profesional", "Técnico"]
    );
});

test("los chips se dibujan y el activo queda marcado", () => {
    // Un solo estamento no necesita chips: no hay a donde ir.
    assert.match(home, /function dotEstChipsHTML[\s\S]{0,220}if \(estamentos\.length <= 1\) return "";/);
    assert.match(home, /data-hm="dot-est" data-est="\$\{esc\(est\)\}"/);
    assert.match(home, /aria-selected="\$\{activa \? "true" : "false"\}"/);

    // El conteo va en el chip para no tener que entrar a cada estamento.
    assert.match(home, /const total = detalle\.dia\.length \+ detalle\.noche\.length;/);
});

test("cambiar de estamento CONSERVA la fecha elegida", () => {
    // Es todo el punto: `irADia` no se toca y no se reinicia dotacionDate, asi
    // que el dia que se estaba mirando sigue ahi.
    assert.match(
        home,
        /const chip = target\.closest\('\[data-hm="dot-est"\]'\);\s*\n\s*\n?\s*if \(chip\) \{\s*\n\s*dotacionEst = chip\.dataset\.est;\s*\n\s*renderDotacion\(panel\);/
    );
    assert.doesNotMatch(
        home,
        /if \(chip\) \{[\s\S]{0,200}dotacionDate = new Date\(\)/
    );
});

test("los chips tienen estilo propio y estado activo", () => {
    assert.match(styles, /\.hm-dot-chips \{/);
    assert.match(styles, /\.hm-dot-chip \{/);
    assert.match(styles, /\.hm-dot-chip\.is-active \{/);
});

test("el calendario marca los inhabiles con el mismo criterio del app", () => {
    // Fin de semana o feriado, vía isBusinessBay compartido: inventar el
    // criterio aca lo dejaria desalineado del resto del sistema.
    assert.match(home, /import \{ isBusinessDay \} from "\.\/calculations\.js";/);
    assert.match(
        home,
        /const holidays = getCachedHolidays\(year\);/
    );
    assert.match(
        home,
        /isBusinessDay\(date, holidays\) \? "" : "is-inhabil"/
    );
});

test("un inhabil se puede elegir igual: es una pista, no un bloqueo", () => {
    // Mirar la dotacion de un domingo es justamente uno de los usos del modal,
    // asi que el boton no se deshabilita: solo se tine el numero.
    assert.doesNotMatch(home, /is-inhabil[^\n]*disabled/);
    assert.match(styles, /\.hm-dp-cell\.is-inhabil \{ color: #dc2626; \}/);
});

test("el calendario es compacto y no se estira a lo ancho del modal", () => {
    // Antes cada dia era un boton con borde y fondo propio, y la grilla ocupaba
    // mas alto que la lista de trabajadores que uno viene a mirar.
    assert.match(styles, /\.hm-dp \{\s*\n\s*width: max-content;/);
    assert.match(styles, /\.hm-dp-grid \{ display: grid; grid-template-columns: repeat\(7, 38px\);/);
    assert.match(styles, /\.hm-dp-cell \{\s*\n\s*height: 35px;[\s\S]{0,80}border: 1px solid transparent;/);
});

test("el calendario se superpone colgando del boton, sin empujar la info", () => {
    // Vivia en el cuerpo del modal y empujaba la lista hacia abajo: se abria
    // para elegir una fecha y de paso tapaba lo que uno venia a mirar.
    assert.match(home, /<div class="hm-dp-anchor">/);
    assert.match(
        home,
        /data-hm="dot-cal"[\s\S]{0,160}<div class="hm-dp-pop" data-hm="dot-picker" hidden><\/div>/
    );
    // Y ya no queda un hueco reservado en el cuerpo.
    assert.doesNotMatch(
        home,
        /<div class="hm-modal-body">\s*\n\s*<div data-hm="dot-picker"/
    );

    assert.match(styles, /\.hm-dp-anchor \{ position: relative;/);
    assert.match(styles, /\.hm-dp-pop \{\s*\n\s*position: absolute;\s*\n\s*top: calc\(100% \+ 8px\);\s*\n\s*right: 0;/);
});

test("el calendario puede salirse del modal sin quedar cortado", () => {
    // Con el `overflow-y: auto` del modal, el calendario quedaba cortado a la
    // mitad del mes cuando habia pocos trabajadores: se veia hasta la tercera
    // semana y se perdia el resto. position:fixed no sirve porque el backdrop
    // tiene backdrop-filter y eso lo vuelve bloque contenedor.
    assert.match(styles, /\.hm-modal--dotacion \{\s*\n\s*overflow: visible;/);
    // El scroll se muda al cuerpo, o el modal crece sin limite.
    assert.match(
        styles,
        /\.hm-modal--dotacion \.hm-modal-body \{ overflow-y: auto; min-height: 0; \}/
    );
});

test("al superponerse, un click fuera lo cierra", () => {
    // Dejarlo abierto tapando la lista es justo lo que se venia a evitar.
    assert.match(
        home,
        /if \(dotacionPickerOpen && !target\.closest\('\[data-hm="dot-picker"\]'\)\) \{\s*\n\s*dotacionPickerOpen = false;/
    );
});

test("el ancla no rompe la fila de botones del encabezado", () => {
    // Se metio entre las flechas y el boton de cerrar: sin heredar las reglas
    // de margen del boton que envuelve, el `margin-left: auto` suelto del cerrar
    // abria un hueco.
    assert.match(styles, /\.hm-bday-nav \+ \.hm-dp-anchor \{ margin-left: 0; \}/);
    assert.match(styles, /\.hm-dp-anchor \+ \.hm-modal-close \{ margin-left: 0; \}/);
});

test("si los feriados de ese año no estaban, se cargan y repinta", () => {
    // Al saltar de año con las flechas, la cache puede no tenerlos: sin esto el
    // calendario marcaria solo los fines de semana para siempre en ese año.
    assert.match(
        home,
        /if \(dotacionPickerOpen\) \{\s*\n\s*void ensureHolidaysLoaded\(\s*\n\s*dotacionPickerMonth\.getFullYear\(\)/
    );
});

test("el dia elegido gana al rojo del inhabil", () => {
    // Sin esto, elegir un domingo dejaba el numero rojo sobre el fondo azul.
    assert.match(
        styles,
        /\.hm-dp-cell\.is-sel,\s*\n\.hm-dp-cell\.is-sel\.is-inhabil \{/
    );
});
