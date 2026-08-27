import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// La impresion de la programacion: hoja carta, sin margen de pagina, y si no
// cabe, segunda hoja repitiendo los titulos de las columnas.

const readSource = () => readFile(
    new URL("../js/taskSchedulePreview.js", import.meta.url),
    "utf8"
);

test("el visor de programacion tiene boton de imprimir", async () => {
    const source = await readSource();

    assert.match(source, /data-preview-print/);
    assert.match(
        source,
        /querySelector\("\[data-preview-print\]"\)\s*\n\s*\.addEventListener\("click", printSchedule\)/
    );
});

test("la hoja es carta apaisada y sin margen de pagina", async () => {
    const source = await readSource();

    assert.match(source, /@page \{ size: letter landscape; margin: 0; \}/);
});

test("deja un colchon minimo para que no se corten las columnas de los bordes", async () => {
    const source = await readSource();

    // Casi ninguna impresora imprime hasta el borde fisico: sin este aire, la
    // primera y la ultima columna salen cortadas.
    assert.match(source, /body \{\s*\n\s*padding: 5mm;/);
});

test("si pasa a una segunda hoja, repite los titulos de las columnas", async () => {
    const source = await readSource();

    assert.match(source, /thead \{ display: table-header-group; \}/);
    // Y ninguna fila se parte por la mitad entre dos hojas.
    assert.match(
        source,
        /tr \{\s*\n\s*break-inside: avoid;\s*\n\s*page-break-inside: avoid;\s*\n\s*\}/
    );
});

test("la tabla se ajusta al ancho de la hoja en vez de desbordarse", async () => {
    const source = await readSource();

    assert.match(
        source,
        /table \{\s*\n\s*width: 100%;\s*\n\s*border-collapse: collapse;\s*\n\s*table-layout: fixed;/
    );
    assert.match(source, /col\.tsp-print-col--task \{ width: 14%; \}/);
});

test("imprime desde un iframe y no desde una ventana emergente", async () => {
    const source = await readSource();

    // Una ventana emergente la bloquea el navegador por defecto. Se busca la
    // LLAMADA, no la palabra: el comentario del codigo la nombra a proposito.
    assert.doesNotMatch(source, /window\.open\(/);
    assert.match(source, /const frame = document\.createElement\("iframe"\)/);
});

test("el iframe se retira despues de imprimir, no antes", async () => {
    const source = await readSource();

    // Quitarlo mientras el dialogo sigue abierto cancela la impresion.
    assert.match(source, /view\.onafterprint = remove;/);
    assert.match(source, /setTimeout\(remove, 60000\)/);
});

test("no se imprime en el load del iframe, que llega en blanco", async () => {
    const source = await readSource();

    // Al insertar el iframe el navegador dispara un `load` por el about:blank
    // inicial: imprimir ahi saca una hoja vacia. Se busca la ASIGNACION, no la
    // palabra, porque el comentario del codigo la nombra a proposito.
    assert.doesNotMatch(source, /frame\.onload\s*=/);
    assert.match(source, /doc\.close\(\);[\s\S]{0,1400}view\.print\(\)/);
});

test("los colores de fondo del encabezado llegan al papel", async () => {
    const source = await readSource();

    // Sin esto los navegadores imprimen las cabeceras en blanco.
    assert.match(source, /print-color-adjust: exact;/);
});
