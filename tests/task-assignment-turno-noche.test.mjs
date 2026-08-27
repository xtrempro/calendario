import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// La fila "TURNO DE NOCHE" junta a quien esta de turno esa noche y no quedo en
// ninguna tarea. Vive SOLO en la programacion -el visor y la hoja impresa-, no
// en el tablero: al supervisor que reparte le estorba, pero quien lee la
// programacion necesita ver a todos los que estan citados.

const readSource = () => readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);
const readStyles = () => readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
);

test("la fila no existe en el tablero", async () => {
    const source = await readSource();
    const styles = await readStyles();

    // Ni markup ni estilos en el panel: si reaparecieran, la fila volveria a
    // dibujarse donde el usuario pidio que NO estuviera.
    assert.doesNotMatch(source, /renderDutyRow/);
    assert.doesNotMatch(source, /renderDutyChip/);
    assert.doesNotMatch(source, /task-assignment-duty/);
    assert.doesNotMatch(styles, /task-assignment-duty/);
    assert.doesNotMatch(styles, /task-assignment-worker-chip--duty/);
});

test("la fila se agrega al armar la programacion", async () => {
    const source = await readSource();

    assert.match(source, /dutyLabel: "TURNO DE NOCHE"/);
    assert.match(
        source,
        /function getTaskScheduleWeek[\s\S]{0,4000}section\.rows\.push\(\{\s*\n\s*taskId: `duty_\$\{section\.shift\}`,\s*\n\s*title: dutyLabel,/
    );
});

test("solo la noche declara la fila", async () => {
    const source = await readSource();

    assert.match(source, /const dutyLabel = SHIFT_CONFIG\[section\.shift\]\.dutyLabel;\s*\n\s*\n\s*if \(!dutyLabel\) return;/);
    assert.doesNotMatch(
        source,
        /label: "Tareas diurnas",[\s\S]{0,160}dutyLabel/
    );
});

test("junta a los de turno que no estan en ninguna tarea", async () => {
    const source = await readSource();

    assert.match(source, /function unassignedOnShift\(shift, keyDay, tasks, assignments\)/);
    assert.match(source, /\.filter\(profile => !assigned\.has\(profile\.name\)\)/);
    // De turno de verdad: citado ese dia y sin permiso que lo bloquee.
    assert.match(
        source,
        /\.filter\(profile => isAvailableForShift\(profile, keyDay, shift\)\)/
    );
});

test("los nombres van en el mismo formato que el resto de la programacion", async () => {
    const source = await readSource();

    assert.match(
        source,
        /\.map\(profile => shortWorkerName\(profile\.name, \{ compact: true \}\)\)/
    );
});

test("se agrega despues de las filas reales, fuera de la fusion de casillas", async () => {
    const source = await readSource();

    // Si entrara antes, la fusion de casillas la tomaria por una tarea y le
    // calcularia rowspans que no le corresponden.
    const push = source.indexOf("section.rows.push({");
    const merge = source.indexOf("columnGroups(assignments, section.shift, tasks, keyFromDate(day))");

    assert.ok(push !== -1 && merge !== -1);
    assert.ok(push < merge, "la fila debe agregarse antes del calculo de rowspan");
});

test("si nadie queda suelto, la fila no aparece", async () => {
    const source = await readSource();

    assert.match(source, /if \(!cells\.some\(cell => cell\.workers\.length\)\) return;/);
});
