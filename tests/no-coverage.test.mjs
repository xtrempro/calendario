// "No requiere cobertura": el supervisor puede marcar un turno con permiso para
// que no vuelva a pedir reemplazo (se suprime el "!" en calendario/timeline/
// staffing). Ademas se agrupan las opciones del modal bajo "+ opciones".
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

const { isNoCoverageDay, setNoCoverageDay, getNoCoverageDays } =
    await import("../js/storage.js");

test("setNoCoverageDay / isNoCoverageDay persisten el override", () => {
    localStorage.clear();

    assert.equal(isNoCoverageDay("Ana", "2026-7-13"), false);

    setNoCoverageDay("Ana", "2026-7-13", true);
    assert.equal(isNoCoverageDay("Ana", "2026-7-13"), true);
    assert.deepEqual(getNoCoverageDays("Ana"), { "2026-7-13": true });

    setNoCoverageDay("Ana", "2026-7-13", false);
    assert.equal(isNoCoverageDay("Ana", "2026-7-13"), false);
    assert.deepEqual(getNoCoverageDays("Ana"), {});
});

test("el '!' se suprime con isNoCoverageDay en calendario, timeline y staffing", async () => {
    const [calendar, timeline, staffing, modules] = await Promise.all([
        readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
        readFile(new URL("../js/timeline.js", import.meta.url), "utf8"),
        readFile(new URL("../js/staffing.js", import.meta.url), "utf8"),
        readFile(new URL("../js/firebaseStateModules.js", import.meta.url), "utf8")
    ]);
    const calls = source => (source.match(/isNoCoverageDay\(/g) || []).length;

    assert.ok(calls(calendar) >= 3, "calendar debe suprimir en 3 sitios");
    assert.ok(calls(timeline) >= 2, "timeline debe suprimir en 2 sitios");
    assert.ok(calls(staffing) >= 2, "staffing debe suprimir en 2 sitios");
    // Se sincroniza entre dispositivos como el resto de datos de turnos.
    assert.match(modules, /\["noCoverage_", "turnos"\]/);
});

test("el modal agrupa opciones, agrega No requiere cobertura y renombra", async () => {
    const calendar = await readFile(
        new URL("../js/calendar.js", import.meta.url),
        "utf8"
    );

    // Icono (esquina superior derecha) que despliega el panel colapsable.
    assert.match(calendar, /data-action="toggle-options"/);
    assert.match(calendar, /replacement-options-icon/);
    assert.match(calendar, /REPLACEMENT_OPTIONS_ICON/);
    assert.match(calendar, /replacement-options-panel/);
    // Buscador que filtra candidatos, visible solo cuando el listado desborda.
    assert.match(calendar, /data-replacement-search/);
    assert.match(calendar, /class="replacement-candidate"/);
    assert.match(calendar, /is-search-hidden/);
    assert.match(
        calendar,
        /candidateList\.scrollHeight > candidateList\.clientHeight/
    );
    // Nuevo boton "No requiere cobertura".
    assert.match(calendar, /data-action="no-coverage"/);
    assert.match(calendar, /No requiere cobertura/);
    assert.match(calendar, /setNoCoverageDay\(profileName, keyDay, true\)/);
    // Rename del toggle.
    assert.match(calendar, /Solicitar aprobación del trabajador/);
    assert.doesNotMatch(calendar, /Solicitar aceptacion al trabajador/);
});

test("se puede revertir desde el detalle del permiso (Sí requiere cobertura)", async () => {
    const [calendar, audit] = await Promise.all([
        readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
        readFile(new URL("../js/auditLog.js", import.meta.url), "utf8")
    ]);

    // Al marcar sin cobertura se registra en el LOG (quien/cuando).
    assert.match(calendar, /"Marco sin cobertura"/);
    assert.match(audit, /export function getNoCoverageAuditInfo\(profile, keyDay\)/);

    // El modal de detalle del permiso muestra la seccion y el boton de revertir.
    assert.match(calendar, /getNoCoverageAuditInfo\(profile, keyDay\)/);
    assert.match(calendar, /Marcado como "No requiere cobertura"/);
    assert.match(calendar, /data-action="require-coverage"/);
    assert.match(calendar, /Sí requiere cobertura/);
    // El handler revierte (setNoCoverageDay false) y registra la reactivacion.
    assert.match(calendar, /setNoCoverageDay\(profile, keyDay, false\)/);
    assert.match(calendar, /"Reactivo cobertura"/);
});

test("el footer Anular/Cancelar queda en 2 columnas", async () => {
    const css = await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    );

    assert.match(
        css,
        /\.replacement-dialog \.turn-change-dialog__actions \{\s*grid-template-columns: 1fr 1fr/
    );
});
