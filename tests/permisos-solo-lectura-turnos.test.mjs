// Un miembro invitado con permiso de solo lectura en Turnos podia editar desde
// el timeline: sus casillas abren los cuadros de reemplazo / motivo de HH.EE por
// globales de window y ninguna de esas rutas comprobaba el permiso del menu (la
// unica barrera era clickDia, que solo cubre el calendario). El cambio se
// guardaba en local y despues la sincronizacion lo rechazaba en silencio.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSource(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

function functionBody(source, signature) {
    const start = source.indexOf(signature);

    assert.notEqual(start, -1, `no se encontro: ${signature}`);

    const end = source.indexOf("\n}", start);

    assert.notEqual(end, -1, `no se encontro el cierre de: ${signature}`);

    return source.slice(start, end);
}

const permissions = await readSource("../js/workspacePermissions.js");
const timeline = await readSource("../js/timeline.js");
const calendar = await readSource("../js/calendar.js");

test("ensureCanEditTarget avisa y bloquea cuando el menu es de solo lectura", () => {
    const guard = functionBody(
        permissions,
        "export function ensureCanEditTarget(targetId) {"
    );

    assert.match(guard, /if \(canEditTarget\(targetId\)\) return true;/);
    assert.match(guard, /alert\(/);
    assert.match(guard, /return false;/);
});

test("el timeline exige permiso antes de abrir los cuadros que escriben", () => {
    const delegation = functionBody(
        timeline,
        "function ensureTimelineCellDelegation(container) {"
    );

    [
        ["replacementProfile", "openReplacementDialog"],
        ["extraProfile", "openExtraReasonDialog"],
        ["clockExtraProfile", "openClockExtraReasonDialog"]
    ].forEach(([dataset, dialog]) => {
        const branch = delegation.slice(
            delegation.indexOf(`cell.dataset.${dataset}`),
            delegation.indexOf(`window.${dialog}`)
        );

        assert.notEqual(branch, "", `no se encontro la rama de ${dataset}`);
        assert.match(
            branch,
            /ensureCanEditTarget\("calendarPanel"\)/,
            `${dialog} se abre sin comprobar el permiso de Turnos`
        );
    });
});

test("asignar reemplazo y el motivo de HH.EE comprueban el permiso en su origen", () => {
    // Segunda barrera: cubre tambien los badges del calendario, las alertas de
    // dotacion y el calendario semanal, que llaman a los mismos globales.
    assert.match(
        functionBody(
            calendar,
            "async function openReplacementDialog(profileName, keyDay, options"
        ),
        /ensureCanEditTarget\("calendarPanel"\)/
    );
    assert.match(
        functionBody(calendar, "async function openExtraReasonDialog("),
        /ensureCanEditTarget\("calendarPanel"\)/
    );
});

test("el cuadro de marcaje reusa el de HH.EE, asi que hereda el guard", () => {
    assert.match(
        functionBody(calendar, "async function openClockExtraReasonDialog("),
        /return openExtraReasonDialog\(profileName, keyDay, 0, \{/
    );
});

test("los cuadros informativos se consultan sin sus acciones de escritura", () => {
    const detail = functionBody(
        calendar,
        "async function openReplacementDetailDialog("
    );

    assert.match(detail, /const canEdit = canEditTarget\("calendarPanel"\);/);
    // Un dia puede tener varios turnos asignados: el boton de anular va por
    // registro dentro de la lista, y ademas en el pie cuando hay uno solo. Los
    // dos siguen detras de canEdit.
    assert.match(
        detail,
        /\$\{canEdit \? `[\s\S]{0,80}<button[\s\S]{0,160}data-action="undo"/
    );
    assert.match(
        detail,
        /\$\{canEdit && !multiple \? `[\s\S]{0,80}<button[\s\S]{0,160}data-action="undo"/
    );
    // Sin boton no hay handler que enlazar: la asignacion directa reventaba. Al
    // recorrer una NodeList eso ya no puede pasar aunque no haya ninguno.
    assert.match(
        detail,
        /querySelectorAll\("\[data-action='undo'\]"\)/
    );

    const preassign = functionBody(
        calendar,
        "function openPreassignmentDialog({ profile, keyDay }) {"
    );

    assert.match(preassign, /const canEdit = canEditTarget\("calendarPanel"\);/);
    assert.match(
        preassign,
        /\$\{canEdit \? `\n\s*<button class="primary-button" type="button" data-action="confirm">/
    );
});
