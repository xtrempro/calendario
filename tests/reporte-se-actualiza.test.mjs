// El reporte se repinta solo cuando cambian los datos de los que depende.
//
// Antes habia que cambiar de mes y volver: refreshAll repintaba turnos,
// timeline, dashboard, log, memos y clockmarks, pero no tenia rama para
// reportes. Al cargar las marcas del reloj, o al mover la hora de ingreso con
// el boton de marcajes, la pantalla quedaba con los datos viejos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function leer(ruta) {
    const fuente = await readFile(new URL(ruta, import.meta.url), "utf8");

    return fuente.replace(/\r\n/g, "\n");
}

const refresh = await leer("../js/refresh.js");
const main = await leer("../js/main.js");
const marcajes = await leer("../js/clockMarks.js");

test("refreshAll ahora repinta tambien el reporte", () => {
    assert.match(
        refresh,
        /activeView === "reports" &&\s*\n\s*typeof window\.renderReportsDetail === "function"/
    );
    assert.match(refresh, /void window\.renderReportsDetail\(\);/);
});

test("main expone el renderizador que refreshAll necesita", () => {
    // Mismo puente que usan dashboard y clockmarks: refresh.js no puede
    // importar de main.js sin cerrar un ciclo.
    assert.match(main, /^window\.renderReportsDetail = renderReportsDetail;$/m);
});

test("cargar las marcas dispara ese repintado", () => {
    // La importacion ya llamaba a refreshAll; lo que faltaba era la rama.
    assert.match(
        main,
        /const result = await importAttendanceFile\(file\);[\s\S]{0,700}refreshAll\(\);/
    );
});

test("modificar un marcaje repinta el reporte si esta a la vista", () => {
    assert.match(
        main,
        /addEventListener\("proturnos:clockMarksChanged"[\s\S]{0,900}if \(document\.body\.dataset\.activeView === "reports"\) \{\s*\n\s*void renderReportsDetail\(\);/
    );
});

test("el aviso sale de guardar el marcaje, no del dialogo", () => {
    // Asi cubre cualquier via que modifique un marcaje, no solo el boton del
    // calendario.
    assert.match(
        marcajes,
        /export function saveClockMarks\(profile, marks\) \{[\s\S]{0,900}proturnos:clockMarksChanged/
    );
});

test("no se repinta el reporte cuando no esta a la vista", () => {
    // Armar el reporte no es gratis: recorre el mes entero por trabajador.
    assert.doesNotMatch(
        refresh,
        /window\.renderReportsDetail\(\);\s*\n\s*\}\s*\n\s*else/
    );
});
