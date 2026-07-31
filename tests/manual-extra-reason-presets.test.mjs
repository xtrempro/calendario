import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("los motivos predefinidos de HHEE se editan y sincronizan por entorno", async () => {
    const calendarSource = await readFile(
        new URL("../js/calendar.js", import.meta.url),
        "utf8"
    );
    const stateModulesSource = await readFile(
        new URL("../js/firebaseStateModules.js", import.meta.url),
        "utf8"
    );

    assert.match(
        calendarSource,
        /MANUAL_EXTRA_REASON_PRESETS_KEY = "manualExtraReasonPresets"/
    );
    assert.match(calendarSource, /setJSON\(\s*MANUAL_EXTRA_REASON_PRESETS_KEY/);
    assert.match(calendarSource, /data-manual-reason-presets-edit/);
    assert.match(calendarSource, /data-manual-reason-preset=/);
    assert.match(calendarSource, /appendManualExtraReasonPreset/);
    assert.match(
        stateModulesSource,
        /\["manualExtraReasonPresets", "turnos"\]/
    );
});
