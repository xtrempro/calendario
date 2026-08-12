// Un dia con marcaje modificado muestra un icono de reloj (no un asterisco); al
// presionarlo se abre un modal de detalle (fecha/usuario de la modificacion,
// recuperacion/horas extra y motivo) con un boton para reabrir el editor de
// marcaje.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [calendar, main, audit, timeline] = await Promise.all([
    readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
    readFile(new URL("../js/main.js", import.meta.url), "utf8"),
    readFile(new URL("../js/auditLog.js", import.meta.url), "utf8"),
    readFile(new URL("../js/timeline.js", import.meta.url), "utf8")
]);

test("el badge del marcaje es un icono de reloj, no un asterisco", () => {
    // El asterisco fue reemplazado por un centinela que rinde el SVG del reloj.
    assert.match(calendar, /simpleClockIncident\s*\n?\s*\?\s*CLOCK_MARK_BADGE/);
    assert.match(calendar, /const CLOCK_MARK_BADGE = "clock-mark"/);
    assert.match(calendar, /const CLOCK_MARK_BADGE_ICON =/);
    assert.match(
        calendar,
        /item === CLOCK_MARK_BADGE[\s\S]{0,160}day-badge--clock/
    );
    // Ya no se usa el asterisco como badge del marcaje.
    assert.doesNotMatch(calendar, /simpleClockIncident\s*\n?\s*\?\s*"\*"/);
});

test("el timeline tambien usa el icono de reloj (no asterisco)", () => {
    assert.match(timeline, /const TIMELINE_CLOCK_MARKER =/);
    assert.match(timeline, /simpleClockIncident\s*\n?\s*\?\s*TIMELINE_CLOCK_MARKER/);
    assert.doesNotMatch(timeline, /simpleClockIncident\s*\n?\s*\?\s*"\*"/);
});

test("el click en un dia con marcaje abre el modal de detalle", () => {
    assert.match(calendar, /function openClockMarkDetailDialog\(/);
    // Routing: dia con marcaje simple, sin '?' pendiente y fuera de un modo de
    // seleccion.
    assert.match(
        calendar,
        /if \(\s*simpleClockIncident &&\s*!showClockExtraReason &&\s*!window\.selectionMode\s*\)/
    );
    assert.match(calendar, /return openClockMarkDetailDialog\(\{/);
});

test("el modal muestra fecha/usuario y tiene boton Modificar marcaje", () => {
    // Fecha y usuario de la modificacion (del LOG) + fallback a updatedAt.
    assert.match(calendar, /getClockMarkAuditInfo\(profile, keyDay\)/);
    assert.match(calendar, /mark\.updatedAt/);
    // Recuperacion / horas extra / motivo.
    assert.match(calendar, /classifyClockMarkSegment\(/);
    assert.match(calendar, /Recuperación de horas/);
    assert.match(calendar, /Motivo horas extras:/);
    // Boton que reabre el editor de marcaje.
    assert.match(calendar, /data-action='edit'/);
    assert.match(calendar, /window\.openClockMarkEditorForDate\?\.\(date\)/);
});

test("main expone el editor de marcaje y auditLog el helper de auditoria", () => {
    assert.match(
        main,
        /window\.openClockMarkEditorForDate = handleClockMarkSelection/
    );
    assert.match(audit, /export function getClockMarkAuditInfo\(profile, keyDay\)/);
    assert.match(audit, /"Modifico marcaje reloj control"/);
});
