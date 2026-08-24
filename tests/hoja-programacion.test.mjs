// Que hoja del Excel se publica.
//
// El servidor la busca por el nombre: tiene que traer el dia Y el mes en
// palabras de esa semana. Antes, cuando la busqueda fallaba, publicaba la
// ULTIMA hoja del libro sin avisar, y eso podia dejar publicada la semana
// equivocada -en la PWA se ve como turnos que no corresponden-. Ahora ese caso
// se devuelve como ambiguo para que el supervisor elija.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function leer(ruta) {
    const fuente = await readFile(new URL(ruta, import.meta.url), "utf8");

    return fuente.replace(/\r\n/g, "\n");
}

const backend = await leer("../functions/index.js");
const cliente = await leer("../js/taskAssignments.js");
const estilos = await leer("../styles.css");

/* =========================================================
   La decision, en el servidor
========================================================= */

test("solo cuentan las hojas con datos", () => {
    assert.match(
        backend,
        /const sheets = \(workbook\.worksheets \|\| \[\]\)\.filter\(\s*\n\s*\(ws\) => ws && \(ws\.rowCount \|\| 0\) > 1\s*\n\s*\);/
    );
});

test("la eleccion del supervisor manda sobre la corazonada", () => {
    assert.match(
        backend,
        /const exact = sheets\.find\(\(ws\) => String\(ws\.name\)\.trim\(\) === chosen\);/
    );
    // Y si esa hoja ya no esta, se avisa en vez de publicar otra.
    assert.match(backend, /\? \{ worksheet: exact, sheets \}\s*\n\s*: \{ sheets, notFound: true \};/);
});

test("con una sola hoja no se pregunta nada", () => {
    assert.match(
        backend,
        /if \(sheets\.length === 1\) return \{ worksheet: sheets\[0\], sheets \};/
    );
});

test("la busqueda por nombre exige el dia Y el mes", () => {
    assert.match(backend, /function guessScheduleWorksheet\(sheets, weekStartISO\)/);
    assert.match(
        backend,
        /return dayRe\.test\(t\) && \(!monthName \|\| t\.includes\(monthName\)\);/
    );
});

test("si la corazonada falla YA NO se publica la ultima hoja", () => {
    // Es el cambio de fondo: antes terminaba en sheets[sheets.length - 1].
    assert.doesNotMatch(backend, /return sheets\[sheets\.length - 1\];/);
    assert.match(
        backend,
        /return guess\s*\n\s*\? \{ worksheet: guess, sheets \}\s*\n\s*: \{ sheets, ambiguous: true \};/
    );
});

test("el caso ambiguo devuelve la lista en vez de fallar", () => {
    // No es un error: el cliente necesita los nombres para preguntar.
    assert.match(
        backend,
        /return \{\s*\n\s*needsSheet: true,\s*\n\s*sheets: choice\.sheets\.map\(\(ws\) => String\(ws\.name\)\)\s*\n\s*\};/
    );
});

test("la respuesta dice que hoja se publico", () => {
    // Asi una corazonada equivocada se puede ver, en vez de quedar silenciosa.
    assert.match(backend, /sheetName: publishedSheet,/);
});

test("un HttpsError propio no se disfraza de error de formato", () => {
    // El catch de alrededor convierte todo en "no se pudo leer el Excel"; el
    // aviso de la hoja que ya no esta tiene que llegar tal cual.
    assert.match(backend, /if \(error instanceof HttpsError\) throw error;/);
});

/* =========================================================
   La pregunta, en el cliente
========================================================= */

test("se pregunta solo cuando el servidor lo pide", () => {
    assert.match(cliente, /if \(result\?\.data\?\.needsSheet\) \{/);
    assert.match(cliente, /result = await upload\(\{ \.\.\.payload, sheetName \}\);/);
});

test("cancelar no publica nada", () => {
    assert.match(cliente, /if \(!sheetName\) return null;/);
    // Y el dialogo queda utilizable, no bloqueado en "Publicando...".
    assert.match(
        cliente,
        /if \(!attachment\) \{\s*\n\s*submit\.disabled = false;/
    );
});

test("el dialogo lista las hojas y trae una marcada", () => {
    assert.match(cliente, /function askScheduleSheet\(sheets, weekLabel\)/);
    assert.match(cliente, /\$\{index === 0 \? "checked" : ""\}/);
    assert.match(cliente, /input\[name='scheduleSheet'\]:checked/);
    assert.match(estilos, /\.task-schedule-sheet-list \{/);
});

test("cerrar el dialogo por fuera cuenta como cancelar", () => {
    assert.match(cliente, /if \(event\.target === backdrop\) finish\(""\);/);
});
