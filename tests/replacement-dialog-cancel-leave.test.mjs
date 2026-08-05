// El modal "Seleccionar reemplazo" incluye un boton "Anular permiso" que quita
// el permiso/ausencia del trabajador ausente y le restablece su turno original,
// reutilizando el mismo camino que el modal de detalle de permiso
// (undoAuditLogEntry) con una limpieza manual de respaldo cuando el permiso no
// tiene un registro undoable en el LOG.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const calendar = await readFile(
    new URL("../js/calendar.js", import.meta.url),
    "utf8"
);
const main = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);
const timeline = await readFile(
    new URL("../js/timeline.js", import.meta.url),
    "utf8"
);

test("el modal de reemplazo ofrece el boton Anular permiso", () => {
    assert.match(
        calendar,
        /data-action="cancel-leave"[\s\S]{0,80}Anular permiso/
    );
});

test("el handler del boton confirma y llama a cancelReplacedProfileLeave", () => {
    assert.match(
        calendar,
        /\[data-action='cancel-leave'\]/
    );
    assert.match(
        calendar,
        /cancelReplacedProfileLeave\(\s*profileName,\s*keyDay\s*\)/
    );
    // Refresca la vista tras anular: casilla, timeline y calendario visible.
    assert.match(calendar, /updateDayCell\(profileName, keyDay\)/);
    // Refresca la fila del ausente y de cada trabajador que dejo de cubrir.
    assert.match(
        calendar,
        /const affectedProfiles = new Set\(\[\s*profileName,\s*\.\.\.\(result\.coveringWorkers \|\| \[\]\)/
    );
    assert.match(
        calendar,
        /affectedProfiles\.forEach\(worker => \{\s*updateTimelineCells\(worker\)/
    );
    assert.match(
        calendar,
        /updateVisibleCalendarDays\(\{ updateSummary: true \}\)/
    );
});

test("cancelReplacedProfileLeave reporta a los trabajadores que cubrian", () => {
    const start = calendar.indexOf(
        "async function cancelReplacedProfileLeave("
    );
    const body = calendar.slice(start, start + 5000);

    // Captura determinista de quienes cubren ANTES de cancelar (no depende de la
    // salida del undo, que no siempre reporta a esos trabajadores).
    assert.match(body, /const coveringBefore = new Set\(/);
    assert.match(body, /replacement\.replaced === profileName/);
    // Camino con LOG: parte de coveringBefore y suma lo que reporta el undo.
    assert.match(body, /const coveringWorkers = new Set\(coveringBefore\)/);
    assert.match(body, /result\.canceledReplacements \|\| \[\]/);
    assert.match(body, /return \{ ok: true, type, coveringWorkers \}/);
    // Camino manual: anula los reemplazos del dia y los recopila.
    assert.match(body, /replacement\.replaced === profileName &&\s*replacement\.date === iso/);
    assert.match(body, /coveringWorkers\.add\(worker\)/);
    assert.match(body, /saveReplacements\(nextReplacements\)/);
});

test("cancelReplacedProfileLeave reutiliza el undo del LOG", () => {
    const start = calendar.indexOf(
        "async function cancelReplacedProfileLeave("
    );
    assert.notEqual(start, -1, "no se encontro cancelReplacedProfileLeave");
    const body = calendar.slice(start, start + 5000);

    assert.match(body, /leaveTypeForDay\(keyDay, admin, legal, comp, absences\)/);
    assert.match(
        body,
        /undoAuditLogEntry\(\s*info\.logId,\s*\{\s*source: "calendar"\s*\}\s*\)/
    );
});

test("cancelReplacedProfileLeave limpia manualmente el mapa y el bloqueo", () => {
    const start = calendar.indexOf(
        "async function cancelReplacedProfileLeave("
    );
    const body = calendar.slice(start, start + 5000);

    // Borra el permiso del mapa correspondiente al dia.
    assert.match(body, /delete sourceMap\[keyDay\]/);
    // Persiste cada mapa segun el tipo de permiso.
    assert.match(body, /setJSON\(`admin_\$\{profileName\}`, admin\)/);
    assert.match(body, /setJSON\(`legal_\$\{profileName\}`, legal\)/);
    assert.match(body, /setJSON\(`comp_\$\{profileName\}`, comp\)/);
    assert.match(body, /setJSON\(`absences_\$\{profileName\}`, absences\)/);
    // Libera el bloqueo del dia solo si ya no queda ninguna ausencia.
    assert.match(body, /delete blocked\[keyDay\]/);
    assert.match(body, /setJSON\(`blocked_\$\{profileName\}`, blocked\)/);
});

test("el listener auditUndoApplied refresca las filas de quienes cubrian", () => {
    const start = main.indexOf(
        'window.addEventListener("proturnos:auditUndoApplied"'
    );
    assert.notEqual(start, -1, "no se encontro el listener auditUndoApplied");
    const body = main.slice(start, start + 1400);

    // Ademas del ausente, refresca el timeline de cada trabajador cuyo reemplazo
    // se cancelo, para que su turno extra y su resumen de HH.EE se actualicen.
    assert.match(body, /canceledReplacements/);
    assert.match(body, /\.forEach\(worker => updateTimelineCells\(worker\)\)/);
});

test("el refresco por persistenceChanged recomputa HH.EE frescas", () => {
    const start = timeline.indexOf(
        'window.addEventListener("proturnos:persistenceChanged"'
    );
    assert.notEqual(start, -1, "no se encontro el listener persistenceChanged");
    const body = timeline.slice(start, start + 1600);

    // Sin forceFreshMetrics, el resumen de HH.EE de los perfiles afectados se
    // servia del caché/resumen publicado stale tras anular un permiso.
    assert.match(
        body,
        /refreshVisibleTimelineRows\(affectedProfiles,\s*\{\s*forceFreshMetrics: true\s*\}\s*\)/
    );
    // Marca a los editados como "dirty" para no volver a hidratar su publicado.
    assert.match(body, /timelineLocallyDirtyProfiles\.add\(name\)/);
});

test("el publicado no se hidrata para perfiles editados localmente", () => {
    assert.match(timeline, /const timelineLocallyDirtyProfiles = new Set\(\)/);
    // hydrateTimelineHheeFromPublished salta los perfiles marcados dirty.
    const start = timeline.indexOf(
        "async function hydrateTimelineHheeFromPublished("
    );
    assert.notEqual(start, -1, "no se encontro hydrateTimelineHheeFromPublished");
    const body = timeline.slice(start, start + 1600);

    assert.match(
        body,
        /if \(timelineLocallyDirtyProfiles\.has\(profile\.name\)\) continue/
    );
});

test("updateTimelineCells captura la fila ANTES de reemplazar casillas", () => {
    const start = timeline.indexOf(
        "export function updateTimelineCells("
    );
    assert.notEqual(start, -1, "no se encontro updateTimelineCells");
    const body = timeline.slice(start, start + 3200);

    // Regresion: sin claves se reemplazan TODAS las casillas (incluida rowCell),
    // que quedaria desprendida; su .closest() daria null y las HH.EE no se
    // recalculaban. La fila se captura antes del loop y se reutiliza.
    const rowDecl = body.indexOf(
        'const timelineRow = rowCell.closest("[data-timeline-row]")'
    );
    const loopStart = body.indexOf("targetKeys.forEach");
    assert.notEqual(rowDecl, -1, "no se captura timelineRow");
    assert.notEqual(loopStart, -1, "no se encontro el loop de casillas");
    assert.ok(
        rowDecl < loopStart,
        "timelineRow debe capturarse ANTES del loop de casillas"
    );
    assert.match(
        body,
        /refreshTimelineRowHheeCells\(\s*timelineRow,/
    );
});

test("restoreLeaveBalanceFromUndo es idempotente por logId", () => {
    const start = main.indexOf("function restoreLeaveBalanceFromUndo(");
    assert.notEqual(start, -1, "no se encontro restoreLeaveBalanceFromUndo");
    const body = main.slice(start, start + 900);

    // Guarda: cada anulacion (logId) restaura el saldo una sola vez.
    assert.match(body, /restoredBalanceLogIds\.has\(logId\)/);
    assert.match(body, /restoredBalanceLogIds\.add\(logId\)/);
    assert.match(
        main,
        /const restoredBalanceLogIds = new Set\(\)/
    );
});
