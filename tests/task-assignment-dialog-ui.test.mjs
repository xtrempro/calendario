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

test("el checkbox amplia candidatos sin incluir trabajadores con permisos", async () => {
    const source = await readFile(
        new URL("../js/taskAssignments.js", import.meta.url),
        "utf8"
    );

    assert.match(source, /data-dialog-include-free-workers/);
    assert.match(source, /if \(hasBlockingAbsence\(profile\.name, keyDay\)\) return false/);
    assert.match(source, /includeWorkersWithoutShift \|\|[\s\S]{0,90}turnScheduledForShift/);
});
