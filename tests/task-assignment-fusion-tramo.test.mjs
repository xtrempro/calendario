import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// El gesto de fusion: UN punto por casilla, en el borde de abajo, y arrastrarlo
// hasta otra casilla de la columna une TODAS las filas del tramo.

const readSource = () => readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);
const readStyles = () => readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
);

test("hay un solo punto por casilla y es el de abajo", async () => {
    const source = await readSource();
    const styles = await readStyles();

    assert.doesNotMatch(source, /data-merge-port="top"/);
    assert.doesNotMatch(source, /task-assignment-merge-port--top/);
    assert.doesNotMatch(styles, /task-assignment-merge-port--top/);
    assert.match(source, /data-merge-port="bottom"/);
});

test("soltar en otra fila une el tramo completo, no solo las dos puntas", async () => {
    const source = await readSource();

    assert.match(source, /function mergeRangeFor\(from, to\)/);
    assert.match(
        source,
        /const startIndex = Math\.min\(source\.start, target\.start\);\s*\n\s*const endIndex = Math\.max\(source\.end, target\.end\);/
    );
    // Y el enlace se escribe fila por fila a lo largo del tramo.
    assert.match(
        source,
        /for \(let index = startIndex; index < endIndex; index \+= 1\)/
    );
});

test("el tramo se estira para cubrir grupos ya fusionados en las puntas", async () => {
    const source = await readSource();

    // Si una punta ya era un grupo, unir a media altura lo partiria.
    assert.match(
        source,
        /const spanOf = index => \{[\s\S]{0,600}groupForTask\([\s\S]{0,400}start: group\.start,\s*\n\s*end: group\.start \+ group\.taskIds\.length - 1/
    );
});

test("soltar sobre la misma casilla o su propio grupo no une nada", async () => {
    const source = await readSource();

    assert.match(source, /if \(endIndex <= startIndex\) return null;/);
    // Un grupo ya fusionado abarca varias filas: sin este segundo guardia,
    // soltar el punto dentro de su propio grupo abriria el confirmar para
    // rehacer el tramo que ya existe.
    assert.match(
        source,
        /if \(source\.start === target\.start && source\.end === target\.end\) return null;/
    );
});

test("el gesto funciona en los dos sentidos", async () => {
    const source = await readSource();

    // `mergeRangeFor` no mira si el destino esta arriba o abajo: toma el minimo
    // y el maximo, asi que arrastrar hacia arriba une igual.
    assert.doesNotMatch(source, /from\.mergePort === to\.mergePort/);
    assert.doesNotMatch(source, /function mergeCellWithNext/);
    assert.match(source, /function mergeCellRange\(shift, keyDay, startIndex, endIndex\)/);
});

test("la confirmacion dice cuantas casillas entran cuando son mas de dos", async () => {
    const source = await readSource();

    assert.match(
        source,
        /range\.count > 2\s*\n\s*\? `Las \$\{range\.count\} casillas del tramo/
    );
});
