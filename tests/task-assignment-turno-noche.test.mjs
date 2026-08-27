import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// La fila "TURNO DE NOCHE" junta a quien esta de turno esa noche y no quedo en
// ninguna tarea. No es una tarea: no se edita, no recibe gente y no cuenta para
// la cobertura.

const readSource = () => readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);
const readStyles = () => readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
);

test("la fila existe solo en el tablero de noche", async () => {
    const source = await readSource();

    assert.match(source, /dutyLabel: "TURNO DE NOCHE"/);
    // Se dibuja solo si el turno declara rotulo, y el diurno no lo declara.
    assert.match(source, /config\.dutyLabel\s*\n\s*\? renderDutyRow\(/);
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

test("respeta los filtros de estamento y profesion del panel", async () => {
    const source = await readSource();

    assert.match(
        source,
        /function unassignedOnShift[\s\S]{0,700}profileMatchesFilters\(\s*\n\s*profile,\s*\n\s*selectedRoles,\s*\n\s*selectedProfessions\s*\n\s*\)/
    );
});

test("sus chips son de solo lectura", async () => {
    const source = await readSource();
    const styles = await readStyles();

    // Estar de turno no es una asignacion: no se arrastra, no se quita y no
    // abre el lapiz de predefinidos.
    assert.match(
        source,
        /function renderDutyChip[\s\S]{0,500}task-assignment-worker-chip--duty/
    );
    assert.doesNotMatch(
        source,
        /function renderDutyChip[\s\S]{0,500}data-worker-drag/
    );
    assert.doesNotMatch(
        source,
        /function renderDutyChip[\s\S]{0,500}data-worker-default-config/
    );
    assert.match(
        styles,
        /\.task-assignment-worker-chip--duty \{[^}]*cursor: default;/
    );
});

test("no cuenta para la cobertura ni para el contador de sin cubrir", async () => {
    const source = await readSource();

    // Los totales salen de `columnGroups` sobre las tareas reales, y la fila no
    // es una tarea, asi que queda fuera por construccion. Si algun dia se
    // colara, seria por usar sus celdas: no llevan `data-task-cell`.
    assert.doesNotMatch(
        source,
        /function renderDutyRow[\s\S]{0,900}data-task-cell/
    );
});

test("se ubica bajo las tareas, y respeta el aviso de tablero vacio", async () => {
    const source = await readSource();

    // Sin tareas, la fila 2 la ocupa "Sin tareas registradas".
    assert.match(source, /Math\.max\(sectionTasks\.length, 1\) \+ 2/);
});
