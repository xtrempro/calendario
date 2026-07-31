import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    isMoveShiftAvailable
} from "../js/supervisorActionAvailability.js";

function windowForHost(hostname) {
    return {
        location: { hostname },
        matchMedia: () => ({ matches: true }),
        navigator: { standalone: true }
    };
}

test("muestra Mover turno en TurnoPlus incluso como PWA instalada", () => {
    assert.equal(isMoveShiftAvailable(windowForHost("turnoplus.cl")), true);
    assert.equal(
        isMoveShiftAvailable(windowForHost("calendarioturnos-7c4d9.web.app")),
        true
    );
});

test("no habilita Mover turno en hosts ajenos", () => {
    assert.equal(isMoveShiftAvailable(windowForHost("example.com")), false);
});

test("el boton Mover turno no queda marcado como solo web", () => {
    const html = readFileSync("index.html", "utf8");
    const match = html.match(/<button[^>]+id="moveShiftBtn"[^>]*>/);

    assert.ok(match, "No se encontro el boton Mover turno.");
    assert.doesNotMatch(match[0], /\bdata-web-only\b/);
    assert.doesNotMatch(match[0], /\bweb-only-action\b/);
});

test("el modo PWA solo oculta el boton de instalacion", () => {
    const css = readFileSync("styles.css", "utf8");

    assert.match(css, /@media \(display-mode: standalone\)/);
    assert.doesNotMatch(css, /\[data-web-only\]/);
});
