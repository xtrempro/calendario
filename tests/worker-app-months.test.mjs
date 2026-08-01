import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
    monthScheduleBounds,
    normalizeProfileTargets,
    splitDaysByMonth
} from "../js/workerAppMonths.js";
import { TURNO, TURNO_LABEL } from "../js/constants.js";

test("separa el calendario PWA en documentos mensuales", () => {
    const days = {
        "2026-06-29": { turno: 1 },
        "2026-06-30": { turno: 2 },
        "2026-07-01": { turno: 0 },
        invalido: { turno: 3 }
    };

    assert.deepEqual(splitDaysByMonth(days), {
        "2026-06": {
            "2026-06-29": { turno: 1 },
            "2026-06-30": { turno: 2 }
        },
        "2026-07": {
            "2026-07-01": { turno: 0 }
        }
    });
});

test("calcula los limites de cada documento mensual", () => {
    assert.deepEqual(monthScheduleBounds({
        "2026-06-30": {},
        "2026-06-01": {},
        "2026-06-15": {}
    }), {
        start: "2026-06-01",
        end: "2026-06-30"
    });
});

test("normaliza perfiles dirigidos sin duplicar", () => {
    assert.deepEqual(
        normalizeProfileTargets([" Ana ", "", "Ana", "Luis"]),
        ["Ana", "Luis"]
    );
});

test("el turno de 24 horas se publica y muestra como 24h", async () => {
    const [rotationBaseSource, swapsSource, swapUiSource] =
        await Promise.all([
            readFile(new URL("../js/rotationBase.js", import.meta.url), "utf8"),
            readFile(new URL("../js/swaps.js", import.meta.url), "utf8"),
            readFile(new URL("../js/swapUI.js", import.meta.url), "utf8")
        ]);

    assert.equal(TURNO_LABEL[TURNO.TURNO24], "24h");
    assert.match(rotationBaseSource, /3:\s*"24h"/);
    assert.match(swapsSource, /if \(code === "24"\) return "24h"/);
    assert.match(swapUiSource, /if \(turno === 3\) return "24h"/);
});

test("la sincronizacion cliente no contiene una ruta de publicacion fria global", async () => {
    const source = await readFile(
        new URL("../js/workerAppDataSync.js", import.meta.url),
        "utf8"
    );

    assert.doesNotMatch(source, /dirtyAll/);
    assert.doesNotMatch(source, /scheduleColdPublish|publishColdNow/);
    assert.doesNotMatch(source, /SCHEDULE_MONTHS_(BACK|FORWARD)/);
    assert.match(source, /hotScheduleRange\(today\)/);
    assert.match(source, /writeWorkerAppMonths/);
});

test("los documentos mensuales se reemplazan completos para borrar tareas obsoletas", async () => {
    const source = await readFile(
        new URL("../js/workerAppDataSync.js", import.meta.url),
        "utf8"
    );
    const writeMonths = source.match(
        /async function writeWorkerAppMonths[\s\S]*?async function writeWorkerAppProjection/
    )?.[0] || "";
    const writeProjection = source.match(
        /async function writeWorkerAppProjection[\s\S]*?async function writeWorkerSwapCandidate/
    )?.[0] || "";

    assert.match(source, /WORKER_APP_MONTH_REPLACE_VERSION/);
    assert.match(writeProjection, /canTrustPreviousMonthHashes/);
    assert.doesNotMatch(writeMonths, /\{\s*merge:\s*true\s*\}/);
});

test("la PWA reutiliza resumenes HH.EE y los refresca en segundo plano", async () => {
    const source = await readFile(
        new URL("../js/workerAppDataSync.js", import.meta.url),
        "utf8"
    );

    assert.match(source, /OVERTIME_SUMMARY_CACHE_VERSION/);
    assert.match(source, /function buildOvertimeSummarySignature\(profile, schedule\)/);
    assert.match(source, /previousPayload\?\.overtimeSummaries/);
    assert.match(source, /source: "stale-cache"/);
    assert.match(source, /scheduleColdOvertimeSummaryRefresh/);
    assert.match(source, /refreshWorkerOvertimeSummariesCold/);
    assert.match(source, /overtimeSummariesStatus: "fresh"/);
});

test("la publicacion PWA incluye vigencia contractual por fecha", async () => {
    const source = await readFile(
        new URL("../js/workerAppDataSync.js", import.meta.url),
        "utf8"
    );
    const serverSource = await readFile(
        new URL("../js/serverEngine.js", import.meta.url),
        "utf8"
    );

    assert.match(source, /function buildContractTimeline\(profile = \{\}\)/);
    assert.match(source, /contractTimeline/);
    assert.match(source, /getCompensationProfileAt\(profile\.name, new Date\(\)\)/);
    assert.match(source, /"gradeHistory_"/);
    assert.match(source, /"contractHistory_"/);
    assert.match(serverSource, /function buildContractTimeline\(profile = \{\}\)/);
    assert.match(serverSource, /contractTimeline/);
    assert.match(serverSource, /getCompensationProfileAt\(profile\.name, today\)/);
});

test("Perfil pagina la lista y Timeline renderiza la profesion completa", async () => {
    const [mainSource, timelineSource] = await Promise.all([
        readFile(new URL("../js/main.js", import.meta.url), "utf8"),
        readFile(new URL("../js/timeline.js", import.meta.url), "utf8")
    ]);

    assert.match(mainSource, /PROFILE_LIST_PAGE_SIZE\s*=\s*30/);
    assert.match(mainSource, /visibles\.slice\(0, profileListLimit\)/);
    // El timeline pagina por viewport: primera pagina + carga por scroll
    // (armTimelineLazyLoad), en vez de renderizar las ~32 filas de golpe.
    assert.match(timelineSource, /visibleGroup = context\.orderedGroup\.slice\(0, timelineRowLimit\)/);
    assert.match(timelineSource, /armTimelineLazyLoad\(container\)/);
    assert.doesNotMatch(timelineSource, /const visibleGroup = context\.orderedGroup;/);
});
