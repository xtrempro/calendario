import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// La programacion que se MUESTRA sale de la asignacion de tareas, no del Excel
// que sube el supervisor. `taskScheduleGrid` la entrega con la misma forma de
// `grid` que ya renderizan el widget de Inicio y la PWA del trabajador.

const readTasks = () => readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);

test("la grilla reusa la forma que las dos superficies ya saben dibujar", async () => {
    const source = await readTasks();

    assert.match(source, /export function taskScheduleGrid\(start = currentWeekStart\)/);
    // days + rows{title, detail, cells}: la misma forma del Excel importado.
    assert.match(source, /days: week\.days\.map\(day =>/);
    assert.match(source, /title: row\.title,\s*\n\s*detail: row\.detail,/);
});

test("las casillas tapadas por un rowspan no se emiten", async () => {
    const source = await readTasks();

    // El renderer lleva su propia cuenta de columnas ocupadas: si se emitieran,
    // todas las celdas de esa fila se correrian de lugar.
    assert.match(source, /\.filter\(cell => !cell\.covered\)/);
    assert.match(source, /\? \{ text, rowSpan: cell\.rowSpan \}/);
});

test("el nombre del turno viaja como fila de ancho completo", async () => {
    const source = await readTasks();

    assert.match(
        source,
        /fullWidth: true,\s*\n\s*fullText: section\.label\.toUpperCase\(\)/
    );
});

test("la semana se puede pedir, no esta clavada en la actual", async () => {
    const source = await readTasks();

    // El widget de Inicio navega entre semanas, asi que todo el camino tiene
    // que aceptar la semana: dias, asignaciones y guardado.
    assert.match(source, /export function getTaskScheduleWeek\(start = currentWeekStart\)/);
    assert.match(source, /const days = weekDays\(start\);/);
    assert.match(
        source,
        /function cleanAssignmentsForWeek\(days, tasks, start = currentWeekStart\)/
    );
    assert.match(source, /weekStart: new Date\(start\),/);
});

test("la marca de ultima modificacion no salta con solo mirar el tablero", async () => {
    const source = await readTasks();

    // El saneado corre en CADA pintado y guarda cuando aplica predefinidos o
    // limpia restos. Si eso marcara la semana, la fecha cambiaria sola.
    assert.match(
        source,
        /function saveWeekAssignments\(assignments, start = currentWeekStart, \{ touch = true \} = \{\}\)/
    );
    assert.match(
        source,
        /if \(changed\) saveWeekAssignments\(assignments, start, \{ touch: false \}\)/
    );
    assert.match(source, /export function taskScheduleUpdatedAt\(start = currentWeekStart\)/);
});

test("la marca viaja con el resto del modulo de tareas", async () => {
    const modules = await readFile(
        new URL("../js/firebaseStateModules.js", import.meta.url),
        "utf8"
    );

    // Sin registrarla, la fecha se quedaria en el navegador que la escribio.
    assert.match(modules, /\["weekly_task_assignment_updated", "tasks"\]/);
});
