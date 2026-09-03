import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el modal de asignacion usa buscador de trabajadores sin filtro de estamento", async () => {
    const source = await readFile(
        new URL("../js/taskAssignments.js", import.meta.url),
        "utf8"
    );

    assert.doesNotMatch(source, /name=['"]dialogTaskRole['"]/);
    assert.doesNotMatch(source, /dialog-roles/);
    assert.match(source, /data-dialog-worker-search/);
    assert.match(source, /taskAssignmentWorkerOptions/);
    assert.match(source, /getCalendarProfileSearchValue/);
});

test("el selector Del turno / Todos amplia candidatos sin incluir trabajadores con permisos", async () => {
    const source = await readFile(
        new URL("../js/taskAssignments.js", import.meta.url),
        "utf8"
    );

    assert.match(source, /data-dialog-scope="shift"/);
    assert.match(source, /data-dialog-scope="all"/);
    assert.match(source, /if \(hasBlockingAbsence\(profile\.name, keyDay, shift\)\) return false/);
    assert.match(source, /includeWorkersWithoutShift \|\|[\s\S]{0,90}turnScheduledForShift/);
});

test("los multiselect de asignacion incluyen seleccionar todo sin mezclarlo con opciones", async () => {
    const source = await readFile(
        new URL("../js/taskAssignments.js", import.meta.url),
        "utf8"
    );

    assert.match(source, /data-multiselect-select-all/);
    assert.match(source, /<span>Seleccionar todo<\/span>/);
    assert.match(
        source,
        /input\[type='checkbox'\]:not\(\[data-multiselect-select-all\]\)/
    );
    assert.match(source, /input\.checked = nextChecked/);
});
