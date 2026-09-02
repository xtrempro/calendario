// Columnas de marcaje del reporte.
//
// Una celda puede llevar dos marcas apiladas -un turno con noche deja entrada
// hoy y salida manana- y cada hora puede traer su simbolo: el asterisco de la
// salida traida del dia siguiente, o el aviso de incidencia.
//
// Las celdas apiladas se dibujan con `pre-line` para respetar ese salto, pero
// eso hace que CUALQUIER espacio pueda partirse: el asterisco de "08:00 *" se
// iba solo a la linea de abajo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const report = await read("../js/hoursReport.js");
const css = await read("../styles.css");

// El armador de la celda: hora mas sus simbolos.
const withMarks = new Function(
    `${report.slice(
        report.indexOf("function withMarks("),
        report.indexOf("/**", report.indexOf("function withMarks("))
    )}\nreturn withMarks;`
)();

const NBSP = "\u00a0";

test("el simbolo no se separa de su hora", () => {
    const celda = withMarks("08:00", "*");

    assert.equal(celda, `08:00${NBSP}*`);
    assert.doesNotMatch(celda, / /, "no puede quedar un espacio partible");
});

test("con varios simbolos, tampoco", () => {
    const celda = withMarks("07:56", "⚠", "*");

    assert.equal(celda, `07:56${NBSP}⚠${NBSP}*`);
    assert.doesNotMatch(celda, / /);
});

test("una hora sin simbolos queda tal cual", () => {
    assert.equal(withMarks("17:09"), "17:09");
    assert.equal(withMarks("17:09", null, false), "17:09");
});

test("sin hora no se inventa nada", () => {
    assert.equal(withMarks("", "*"), "");
});

test("las dos marcas de un turno con noche siguen apiladas", () => {
    // El salto entre marcas es un \n de verdad y debe sobrevivir: lo que no
    // debe partirse es la hora de su simbolo.
    const apilada = [withMarks("20:00"), withMarks("08:00", "*")].join("\n");

    assert.equal(apilada, `20:00\n08:00${NBSP}*`);
    assert.equal(apilada.split("\n").length, 2);
});

/* ======================================================================
   Ancho de las columnas
   ====================================================================== */

test("cada celda dice a que columna pertenece", () => {
    // Sin esto el CSS solo podia apuntarles por posicion, que cambia segun la
    // tabla.
    assert.match(report, /<td data-col="\$\{escapeHTML\(column\.key\)\}"/);
    assert.match(report, /<th data-col="\$\{escapeHTML\(column\.key\)\}"/);
});

test("las columnas de marcaje son mas anchas y no parten la linea", () => {
    assert.match(
        css,
        /\.report-table td\[data-col="entrada"\][\s\S]{0,400}min-width: 6\.5rem;[\s\S]{0,60}white-space: nowrap;/
    );
    // Sin regex: dentro de un template literal el backslash se pierde y los
    // corchetes pasarian a ser una clase de caracteres.
    ["entrada", "salida", "atrasos"].forEach(col => {
        assert.ok(
            css.includes(`.report-table td[data-col="${col}"]`),
            `falta la columna ${col}`
        );
    });
});

test("pero una celda apilada conserva su salto propio", () => {
    assert.match(
        css,
        /td\[data-col="entrada"\]\.report-cell--stacked[\s\S]{0,220}white-space: pre-line;/
    );
});
