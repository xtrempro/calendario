// El importador de Excel arma la grilla de la programación (mismo contrato que
// consume la PWA) de forma DINÁMICA desde una hoja de Excel (celdas + merges),
// sin OCR. Se testea contra un fixture del plan real (17–23 de agosto).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scheduleGridFromSheet } from "../js/scheduleGridFromSheet.js";

const fx = JSON.parse(
    await readFile(new URL("./fixtures/schedule-plan.fixture.json", import.meta.url), "utf8")
);
const grid = scheduleGridFromSheet({
    cells: fx.cells,
    merges: fx.merges,
    maxRow: fx.maxRow,
    maxCol: fx.maxCol
});
const rowBy = (t) => grid.rows.find((r) => r.title.toLowerCase().includes(t));

test("título, semana y días se leen dinámicamente del encabezado", () => {
    assert.match(grid.title, /PLAN SEMANAL 17 AL 23 DE AGOSTO/);
    assert.match(grid.weekLabel, /17 AL 23 DE AGOSTO/);
    assert.equal(grid.days.length, 7);
    assert.equal(grid.days[0], "LUNES 17");
    assert.equal(grid.days[6], "DOMINGO 23");
});

test("un servicio parte título/detalle y trae una celda por día hábil", () => {
    const resonador = rowBy("resonador");
    assert.ok(resonador, "falta RESONADOR");
    assert.equal(resonador.detail, "Colación 12:45 hrs.");
    assert.equal(resonador.cells[0], "P.ARMIJO-D.MARINAO");
});

test("el fin de semana se representa con rowSpan (bloque vertical combinado)", () => {
    const resonador = rowBy("resonador");
    // Lun-Vie = 5 celdas de texto + Sáb/Dom = 2 celdas con rowSpan (G3:G18, H3:H18).
    assert.equal(resonador.cells.length, 7);
    const sat = resonador.cells[5];
    const sun = resonador.cells[6];
    assert.equal(typeof sat, "object");
    assert.equal(sat.rowSpan, 16);
    assert.match(sat.text, /TURNO DIA/);
    assert.equal(sun.rowSpan, 16);
    // Una fila cubierta por ese merge NO emite celdas de fin de semana.
    const rmRelevo = rowBy("rm relevo");
    assert.equal(rmRelevo.cells.length, 5);
    // El TURNO NOCHE tiene su propio bloque de fin de semana (G20:G22).
    const noche = grid.rows.find((r) => /^turno noche/i.test(r.title));
    assert.equal(noche.cells[5].rowSpan, 3);
});

test("la RONDA es full-width y preserva sus líneas", () => {
    const ronda = grid.rows.find((r) => r.fullWidth);
    assert.ok(ronda, "falta la fila full-width (RONDA)");
    assert.match(ronda.title, /RONDA/);
    assert.match(ronda.fullText, /RONDA RX PORT/);
    assert.match(ronda.fullText, /URGENCIAS/);
    assert.ok(ronda.fullText.includes("\n"), "el full-text debe conservar los saltos de línea");
});

test("no parte mal títulos con '/' que no son detalle", () => {
    assert.ok(grid.rows.some((r) => /^FERIADO LEGAL\/D\.COMPEN/i.test(r.title)));
    assert.ok(grid.rows.some((r) => /^CUMPLEAÑOS Y\/O FESTIVIDADES/i.test(r.title)));
    // Un horario suelto SÍ se separa como detalle.
    const apoyo = rowBy("apoyo turno");
    assert.equal(apoyo.title, "APOYO TURNO");
    assert.match(apoyo.detail, /17:00 - 20:00 hrs\./);
});
