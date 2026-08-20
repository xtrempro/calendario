// Marcar un turno como "No requiere cobertura" quedaba mudo: meses despues
// nadie recordaba con que criterio se habia ocultado esa alerta. Ahora un
// segundo modal pide un comentario OPCIONAL, con motivos predefinidos propios
// ("Dotacion completa", "Dotacion cubierta por funcionario de 3er turno"...)
// editables por el usuario, en una lista aparte de la de turnos extra.
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

globalThis.localStorage = new MemoryStorage();

const {
    isNoCoverageDay,
    getNoCoverageReason,
    setNoCoverageDay
} = await import("../js/storage.js");

const calendar = (await readFile(
    new URL("../js/calendar.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
const modules = (await readFile(
    new URL("../js/firebaseStateModules.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const NAME = "Ana";
const DAY = "2026-7-10";

test("la marca guarda el motivo y lo devuelve limpio", () => {
    localStorage.clear();
    setNoCoverageDay(NAME, DAY, true, "  Dotación completa  ");

    assert.equal(isNoCoverageDay(NAME, DAY), true);
    assert.equal(getNoCoverageReason(NAME, DAY), "Dotación completa");
});

test("el comentario es opcional: sin motivo la marca vale igual", () => {
    localStorage.clear();
    setNoCoverageDay(NAME, DAY, true);

    assert.equal(isNoCoverageDay(NAME, DAY), true);
    assert.equal(getNoCoverageReason(NAME, DAY), "");
});

test("las marcas antiguas guardadas como true siguen valiendo", () => {
    // isNoCoverageDay comparaba contra `true`; con el objeto { reason } habria
    // dejado de reconocer las marcas nuevas, y al reves las viejas.
    localStorage.clear();
    localStorage.setItem(
        `noCoverage_${NAME}`,
        JSON.stringify({ [DAY]: true })
    );

    assert.equal(isNoCoverageDay(NAME, DAY), true);
    assert.equal(getNoCoverageReason(NAME, DAY), "");
});

test("desmarcar borra la marca y su motivo", () => {
    localStorage.clear();
    setNoCoverageDay(NAME, DAY, true, "Dotación completa");
    setNoCoverageDay(NAME, DAY, false);

    assert.equal(isNoCoverageDay(NAME, DAY), false);
    assert.equal(getNoCoverageReason(NAME, DAY), "");
});

test("el segundo modal pide el comentario con motivos predefinidos", () => {
    assert.match(calendar, /function openNoCoverageReasonDialog\(profileName, keyDay\)/);
    // Reemplaza al showConfirm anterior.
    assert.match(calendar, /const result = await openNoCoverageReasonDialog\(/);
    assert.match(calendar, /if \(!result\) return;/);
    assert.match(calendar, /data-no-coverage-reason/);
    assert.match(calendar, /data-no-coverage-preset=/);
    // El lapiz abre el editor de la lista, apuntando a SU clave.
    assert.match(calendar, /data-action="edit-no-coverage-presets"/);
    assert.match(
        calendar,
        /openManualExtraReasonPresetsDialog\(\s*\n\s*NO_COVERAGE_REASON_PRESETS_KEY/
    );
});

test("la lista de motivos es propia y se sincroniza por entorno", () => {
    assert.match(
        calendar,
        /NO_COVERAGE_REASON_PRESETS_KEY = "noCoverageReasonPresets"/
    );
    // Los acentos van escapados en el fuente, igual que en la lista de HHEE.
    assert.match(calendar, /Dotaci(ó|\\u00f3)n completa/);
    assert.match(
        calendar,
        /Dotaci(ó|\\u00f3)n cubierta por funcionario de 3er turno/
    );
    // No se mezcla con la de turnos extra.
    assert.notEqual(
        calendar.indexOf("DEFAULT_NO_COVERAGE_REASON_PRESETS"),
        calendar.indexOf("DEFAULT_MANUAL_EXTRA_REASON_PRESETS")
    );
    assert.match(modules, /\["noCoverageReasonPresets", "turnos"\]/);
});

test("el detalle del dia muestra el motivo registrado", () => {
    assert.match(calendar, /const noCoverageReason = noCoverage/);
    assert.match(
        calendar,
        /\$\{noCoverageReason\s*\n\s*\? `<div><span>Motivo<\/span><b>\$\{escapeHTML\(noCoverageReason\)\}<\/b><\/div>`/
    );
});
