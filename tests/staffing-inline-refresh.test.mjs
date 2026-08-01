import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el resumen RRHH inline refresca dias afectados por reemplazos sin depender del perfil actual", async () => {
    const source = await readFile(
        new URL("../js/staffing.js", import.meta.url),
        "utf8"
    );

    assert.match(source, /function immediateInlineStaffingDaysFromPersistence/);
    assert.match(source, /keys\.includes\("replacements"\)/);
    assert.match(source, /changedStaffingReplacementDays/);
    assert.match(source, /staffingReplacementDateKey/);
    assert.match(source, /updateInlineStaffingDays\(immediateDays\)/);

    const helperStart = source.indexOf(
        "function immediateInlineStaffingDaysFromPersistence"
    );
    const helperEnd = source.indexOf(
        "if (typeof window !== \"undefined\")",
        helperStart
    );
    const helperBlock = source.slice(helperStart, helperEnd);

    assert.doesNotMatch(helperBlock, /getCurrentProfile/);
});
