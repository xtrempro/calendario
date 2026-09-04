// Incidencias de marcaje en la casilla del calendario.
//
// Son los errores que trae el reporte del reloj control -atrasos, entradas o
// salidas sin marca, marcas en dia libre-, los mismos que cuenta el recuadro
// "Incidencias de marcaje" del inicio. Hasta ahora solo se veian ahi: en el
// calendario del trabajador no habia nada que dijera que ese dia tuvo un error.
//
// Lo que fija este archivo, sobre todo, es que este icono NO se confunda con el
// de reloj que ya existia: ese dice que el supervisor movio la hora a mano, y
// este que la planilla trajo un error. Son dos cosas distintas y se leen
// distinto.
import test from "node:test";
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
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { dataset: {} }
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    affectsAttendanceIncidents,
    getAttendanceIncidentsForDay,
    hasAttendanceIncidentsForDay,
    invalidateAttendanceIncidentIndex
} = await import("../js/attendanceIncidentIndex.js");

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const calendar = await leer("../js/calendar.js");
const indice = await leer("../js/attendanceIncidentIndex.js");
const home = await leer("../js/home.js");
const css = await leer("../styles.css");

/* ───────── El icono nuevo no se confunde con el que ya existia ───────── */

test("el icono de incidencia es distinto del de marcaje modificado", () => {
    assert.match(calendar, /const CLOCK_MARK_BADGE = "clock-mark";/);
    assert.match(
        calendar,
        /const ATTENDANCE_INCIDENT_BADGE = "attendance-incident";/
    );
    // Cada uno con su propia clase, su propio icono y su propio title.
    assert.match(calendar, /day-badge--clock" title="Marcaje reloj control modificado"/);
    assert.match(
        calendar,
        /day-badge--attendance-incident"[\s\S]{0,120}data-attendance-incident="1"/
    );
    assert.match(css, /\.day-badge--attendance-incident \{/);
});

test("el icono se agrega ADEMAS de la insignia principal", () => {
    // Un dia sin cubrir que ademas quedo sin marca de salida necesita mostrar
    // las dos cosas: si compitiera con el "!" se perderia una.
    assert.match(
        calendar,
        /\.\.\.\(attendanceIncidents\.length\s*\n\s*\? \[ATTENDANCE_INCIDENT_BADGE\]\s*\n\s*: \[\]\),/
    );
});

/* ───────── Al pulsarlo se abre el detalle ───────── */

test("pulsar el icono abre el detalle y no hace nada mas", () => {
    assert.match(calendar, /function openAttendanceIncidentDialog\(\s*\n\s*profileName,\s*\n\s*keyDay,/);
    // Va primero y corta: si no, el click caeria en lo que hace el resto de la
    // casilla (ciclo de turnos, cuadros de permiso).
    assert.match(
        calendar,
        /if \(event\.target\.closest\("\[data-attendance-incident\]"\)\) \{\s*\n\s*event\.stopPropagation\(\);\s*\n\s*openAttendanceIncidentDialog\(activeProfile, keyDay\);\s*\n\s*return;/
    );
});

test("el detalle muestra la descripcion de cada incidencia", () => {
    assert.match(calendar, /attendance-incident-kind">\$\{escapeHTML\(attendanceIncidentLabel\(incident\.kind\)\)\}/);
    assert.match(calendar, /escapeHTML\(incident\.detail \|\| "Sin detalle\."\)/);
});

/* ───────── Una sola regla, la del reporte ───────── */

test("las incidencias salen del mismo calculo que el reporte", () => {
    // Una segunda version de la regla acabaria contando cosas distintas y el
    // supervisor no sabria a cual creerle.
    assert.match(indice, /import \{ buildAttendanceIncidents \} from "\.\/hoursReport\.js";/);
    assert.match(
        calendar,
        /import \{\s*\n\s*ATTENDANCE_INCIDENT_KINDS,\s*\n\s*attendanceDayMarks\s*\n\} from "\.\/hoursReport\.js";/
    );
});

test("el inicio y el calendario comparten que datos invalidan lo calculado", () => {
    // Antes la lista vivia solo en home.js. Con dos copias, una se queda atras
    // y un mes sigue mostrando incidencias que ya no existen.
    assert.match(indice, /export function affectsAttendanceIncidents\(keys = \[\]\)/);
    assert.match(
        home,
        /import \{\s*\n\s*affectsAttendanceIncidents,\s*\n\s*invalidateAttendanceIncidentIndex\s*\n\} from "\.\/attendanceIncidentIndex\.js";/
    );
    assert.doesNotMatch(home, /const INCIDENT_STATE_PREFIXES = \[/);
});

test("una planilla nueva del reloj invalida lo calculado", () => {
    assert.equal(affectsAttendanceIncidents(["attendanceMarks"]), true);
    assert.equal(affectsAttendanceIncidents(["attendanceMarksImportedAt"]), true);
    assert.equal(affectsAttendanceIncidents(["data_Ana"]), true);
    assert.equal(affectsAttendanceIncidents(["clockMarks_Ana"]), true);
    // Y algo que no tiene nada que ver, no.
    assert.equal(affectsAttendanceIncidents(["memos"]), false);
    assert.equal(affectsAttendanceIncidents([]), false);
});

/* ───────── El pintado no espera al calculo ───────── */

test("sin el mes calculado, la casilla se pinta sin icono", () => {
    invalidateAttendanceIncidentIndex();

    assert.deepEqual(getAttendanceIncidentsForDay("Ana", "2026-8-10"), []);
    assert.equal(hasAttendanceIncidentsForDay("Ana", "2026-8-10"), false);
    // Y una clave mal formada tampoco revienta.
    assert.deepEqual(getAttendanceIncidentsForDay("Ana", ""), []);
    assert.deepEqual(getAttendanceIncidentsForDay("", "2026-8-10"), []);
});

test("el calculo no bloquea el pintado y repinta al terminar", () => {
    // Con await, abrir un mes esperaria el calculo de las incidencias antes de
    // mostrar un solo dia.
    assert.match(
        calendar,
        /void ensureAttendanceIncidentIndex\(\s*\n\s*getProfiles\(\)\.find\(profile => profile\.name === activeProfile\),/
    );
    assert.match(
        calendar,
        /onAttendanceIncidentIndexReady\(\(\{ profileName, year, month \}\) => \{[\s\S]{0,320}updateVisibleCalendarDays\(/
    );
});

test("un mes pedido dos veces se calcula una sola", () => {
    assert.match(indice, /if \(cache\.has\(clave\)\) return false;/);
    assert.match(indice, /if \(pending\.has\(clave\)\) return pending\.get\(clave\);/);
});

/* =========================================================
   El marcaje del dia, al abrir la casilla

   La insignia llevaba al problema y en ninguna parte se veian las HORAS que lo
   explican: para entender un dia habia que ir al reporte. Ahora el modal es
   uno solo -las marcas arriba, la incidencia debajo- y se llega tambien desde
   la casilla, no solo desde la insignia.
========================================================= */

test("el modal muestra las marcas del reloj, no solo la incidencia", () => {
    assert.match(calendar, /<div class="attendance-marks" data-attendance-marks>/);
    assert.match(calendar, /function attendanceMarkRowHTML\(mark\)/);
    assert.match(calendar, /mark\.type === "out" \? "Salida" : "Entrada"/);
});

test("las marcas salen del reporte, no se leen aparte", () => {
    // Es la misma razon de siempre: una segunda lectura del archivo del reloj
    // acabaria diciendo algo distinto a la fila del reporte.
    assert.match(calendar, /await attendanceDayMarks\(/);
});

test("la marca traida del dia siguiente dice de que dia es", () => {
    // Una salida a las 08:06 dentro de un turno de noche se lee como si fuera
    // de la manana anterior si no se dice la fecha.
    assert.match(calendar, /mark\.iso\s*\n\s*\? `<em>\$\{escapeHTML\(replacementDetailDateLabel\(mark\.iso\)\)\}<\/em>`/);
    assert.match(css, /\.attendance-mark em \{/);
});

test("el modal no bloquea: se abre con la incidencia y las marcas entran despues", () => {
    // Resolver feriados y turno tarda; con la incidencia a la vista ya se puede
    // leer lo que se venia a leer.
    assert.match(calendar, /void fillAttendanceMarks\(backdrop, profileName, keyDay\);/);
    assert.match(calendar, /if \(!host\.isConnected\) return;/);
});

test("con el switch de Editar apagado, la casilla abre su marcaje", () => {
    // Con el switch ENCENDIDO el click cicla el turno, y quedarse sin esa via
    // seria peor que no tener el detalle.
    assert.match(
        calendar,
        /openAttendanceIncidentDialog\(profileName, keyDay, \{\s*\n\s*requireIncidents: false\s*\n\s*\}\);/
    );
});

test("pero el turno agregado a mano sigue mandando", () => {
    // Ese click ya ofrecia quitarlo, y es lo unico accionable del dia.
    assert.match(
        calendar,
        /if \(manualExtraForDay\(profileName, keyDay\)\.extra\) \{\s*\n\s*await offerManualExtraRemoval/
    );
});

test("un dia sin marcas ni incidencias no abre un modal vacio", () => {
    assert.match(calendar, /function dayHasClockMarks\(profileName, keyDay\)/);
    assert.match(
        calendar,
        /if \(!incidents\.length && !dayHasClockMarks\(profileName, keyDay\)\) \{\s*\n\s*return false;/
    );
});
