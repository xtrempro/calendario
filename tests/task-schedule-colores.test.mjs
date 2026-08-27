import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Colores de la programacion: pastel por fila, barajable, y vuelta a blanco y
// negro. Lo que se ve en el visor es lo que sale impreso.

const readSource = () => readFile(
    new URL("../js/taskSchedulePreview.js", import.meta.url),
    "utf8"
);
const readStyles = () => readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
);

test("arranca en blanco y negro", async () => {
    const source = await readSource();

    assert.match(source, /let colorSeed = 0;/);
    // Sin semilla no se escribe ningun fondo.
    assert.match(source, /function rowTint[\s\S]{0,160}if \(!colorSeed\) return "";/);
    assert.match(source, /function rowLabelTint[\s\S]{0,160}if \(!colorSeed\) return "";/);
});

test("dos filas seguidas nunca caen en el mismo tono", async () => {
    const source = await readSource();

    // Con tonos al azar puro, en una tabla de veinte filas se repiten y quedan
    // dos vecinas iguales. El angulo aureo los reparte.
    assert.match(source, /\(colorSeed \+ index \* 137\.508\) % 360/);
});

test("barajar cambia la tanda y nunca cae en blanco y negro por accidente", async () => {
    const source = await readSource();

    // El 0 significa blanco y negro: si la semilla aleatoria pudiera valer 0,
    // barajar apagaria los colores de vez en cuando.
    assert.match(source, /colorSeed = 1 \+ Math\.floor\(Math\.random\(\) \* 3599\)/);
    assert.match(source, /function clearColors\(\) \{\s*\n\s*colorSeed = 0;/);
});

test("el color llega igual al visor y a la hoja impresa", async () => {
    const source = await readSource();

    // `rowCellsHTML` la comparten las dos superficies.
    assert.match(source, /function rowCellsHTML\(row, rowIndex = 0\)/);
    assert.match(source, /const tint = rowTint\(rowIndex\);/);
    // Y las dos pasan el indice de la fila.
    assert.equal(source.match(/rowCellsHTML\(row, rowIndex\)/g)?.length, 2);
    assert.equal(source.match(/rowLabelTint\(rowIndex\)/g)?.length, 2);
});

test("el nombre de la tarea sigue legible sobre el pastel en tema oscuro", async () => {
    const source = await readSource();
    const styles = await readStyles();

    // El fondo va inline, pero el nombre y su detalle tienen color por clase:
    // en tema oscuro son claros y sobre pastel no se leerian.
    assert.match(source, /tsp-row--tinted/);
    assert.match(
        styles,
        /\.ws-table tr\.tsp-row--tinted \.ws-role strong \{ color: #111827; \}/
    );
    assert.match(
        styles,
        /\.ws-table tr\.tsp-row--tinted \.ws-role span \{ color: #334155; \}/
    );
});

test("los botones cambian segun el estado", async () => {
    const source = await readSource();

    // En blanco y negro sobra un boton "B/N" que no haria nada.
    assert.match(
        source,
        /function colorControlsHTML\(\)[\s\S]{0,400}if \(!colorSeed\) \{[\s\S]{0,300}data-preview-color/
    );
    assert.match(source, /data-preview-mono/);
    // Se repintan en cada render, asi que sus listeners se rearman ahi mismo.
    assert.match(
        source,
        /controls\.innerHTML = colorControlsHTML\(\);[\s\S]{0,400}addEventListener\("click", shuffleColors\)/
    );
});

test("los fondos de color llegan al papel", async () => {
    const source = await readSource();

    // Sin esto el navegador imprime los pastel en blanco.
    assert.match(source, /print-color-adjust: exact;/);
});
