// Los modales de detalle del calendario decian QUE paso y CUANDO, pero no
// QUIEN: con varios administradores en un entorno, ver un turno movido o un
// cambio de turno no dejaba manera de saber a quien preguntarle.
//
// El dato sale del LOG de auditoria, no del propio movimiento/cambio: los
// registros viejos no lo guardaron, y de ahi tomarlo evita inventarlo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const calendar = await read("../js/calendar.js");
const auditLog = await read("../js/auditLog.js");

test("el traslado se busca por origen+destino, no por keyDay", () => {
    // `latestCalendarActionInfo` no sirve: el traslado guarda el par
    // sourceKey/targetKey y no `meta.keyDay`, asi que ese helper nunca
    // encontraria el registro.
    assert.match(auditLog, /export function getShiftMoveAuditInfo\(profile, sourceKey, targetKey\)/);
    assert.match(
        auditLog,
        /String\(item\?\.meta\?\.sourceKey \|\| ""\) === source &&\s*\n\s*String\(item\?\.meta\?\.targetKey \|\| ""\) === target/
    );
    // Y contra la accion que efectivamente registra el traslado.
    assert.match(auditLog, /String\(item\?\.action \|\| ""\) === "Movio turno base"/);
});

test("el cambio de turno se busca por su id", () => {
    // Las fechas de un swap pueden coincidir con las de otro; el id no.
    assert.match(auditLog, /export function getSwapAuditInfo\(swapId\)/);
    assert.match(auditLog, /String\(item\?\.meta\?\.swapId \|\| ""\) === id/);
    assert.match(
        auditLog,
        /String\(item\?\.action \|\| ""\) === "Registro cambio de turno"/
    );
});

test("las acciones buscadas existen tal cual en el codigo que las registra", async () => {
    // Si alguien renombra la accion del log, el modal deja de mostrar el autor
    // en silencio. Esto ata las dos puntas.
    const main = await read("../js/main.js");
    const swaps = await read("../js/swaps.js");

    assert.match(main, /"Movio turno base"/);
    assert.match(swaps, /"Registro cambio de turno"/);
});

test("el modal de turno movido muestra quien lo hizo", () => {
    assert.match(calendar, /\["Movido por", audit\.actorName\]/);
    assert.match(
        calendar,
        /getShiftMoveAuditInfo\(\s*\n\s*move\.profile,\s*\n\s*move\.sourceKey,\s*\n\s*move\.targetKey\s*\n\s*\)/
    );
});

test("el modal de cambio de turno muestra quien lo registro", () => {
    assert.match(calendar, /const audit = getSwapAuditInfo\(swap\.id\);/);
    assert.match(calendar, /<span>Registrado por<\/span>/);
});

test("sin registro en el log no se inventa un autor: se omite la fila", () => {
    // Un traslado anterior a esta pantalla, o cuyo log ya fue evicto, no tiene
    // a quien atribuirse. Mostrar un nombre equivocado seria peor que no
    // mostrar ninguno.
    assert.match(calendar, /return audit \? \["Movido por", audit\.actorName\] : null;/);
    // En el de cambio de turno, la fila entera es condicional y cae a vacio.
    const swapBlock = calendar.slice(
        calendar.indexOf("const audit = getSwapAuditInfo(swap.id);"),
        calendar.indexOf("const audit = getSwapAuditInfo(swap.id);") + 400
    );

    assert.match(swapBlock, /return audit \? `/);
    assert.match(swapBlock, /` : "";/);
});

test("el nombre sale del actor del log, con respaldo si falta", () => {
    // logActorName recorre las formas en que quedo guardado el actor segun la
    // epoca del registro.
    assert.match(auditLog, /actorName: logActorName\(log\) \|\| "No registrado"/);
});
