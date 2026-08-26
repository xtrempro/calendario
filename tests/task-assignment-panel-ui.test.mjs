import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Invariantes del panel de Asignacion de Tareas que se rompen en silencio: no
// dan error, solo dejan de funcionar. Se comprueban sobre el fuente porque el
// proyecto no tiene DOM en los tests.

const readSource = () => readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);
const readStyles = () => readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
);

test("el tablero de 8 columnas cabe en pantalla sin scroll lateral", async () => {
    const styles = await readStyles();

    // El minimo viejo (230 + 7x155 + huecos = 1371 px) no entraba en un
    // portatil de 1440 y siempre dejaba tablero por el costado.
    assert.doesNotMatch(styles, /minmax\(230px, 270px\) repeat\(7, minmax\(155px/);
    assert.match(
        styles,
        /grid-template-columns: clamp\(132px, 13vw, 250px\) repeat\(7, minmax\(116px, 1fr\)\)/
    );
});

test("los dos tableros y la fila de Novedades comparten la regla de columnas", async () => {
    const styles = await readStyles();

    // Si se separan en dos reglas, las columnas dejan de alinearse entre el
    // turno diurno, el de noche y las novedades.
    assert.match(
        styles,
        /\.task-assignment-board,\s*\n\.task-assignment-events-grid \{[^}]*grid-template-columns:/
    );
});

test("plegar un turno oculta su tablero pese al display: grid", async () => {
    const styles = await readStyles();

    // `.task-assignment-board` declara `display: grid`, que gana al atributo
    // `hidden`: sin esta regla el boton de plegar no oculta nada.
    assert.match(styles, /\.task-assignment-board\[hidden\] \{\s*display: none;/);
});

test("el dia abreviado es solo de las grillas, no del Excel ni de lo publicado", async () => {
    const source = await readSource();

    assert.match(source, /function formatWeekdayShort/);
    // El Excel y los datos que consume la aplicacion del trabajador siguen con
    // el nombre largo: ahi sobra el ancho y el formato ya estaba acordado.
    assert.match(source, /<th>\$\{escapeHTML\(formatWeekday\(day\)\)\}/);
    assert.match(source, /weekday: formatWeekday\(day\)/);
});

test("repetir la semana no asigna a quien ese dia libra o tiene permiso", async () => {
    const source = await readSource();

    assert.match(source, /function repeatAssignmentForWeek/);
    // Sin este filtro, repetir a ciegas asignaria a alguien con licencia.
    assert.match(
        source,
        /return profile && isAvailableForShift\(profile, nextKey, shift\)/
    );
    // Y las columnas fusionadas tienen su propia casilla duena: no se tocan.
    assert.match(source, /if \(group && group\.taskIds\.length > 1\) return;/);
});

test("una casilla sin cubrir se mide por la asignacion real, no por la filtrada", async () => {
    const source = await readSource();

    // Los filtros de estamento y profesion son de vista: si el contador mirara
    // los chips visibles, filtrar inventaria huecos que no existen.
    assert.match(source, /const uncovered = !assigned\.length;/);
});

test("el selector rapido de la casilla sobrevive a su propio scroll y a su propio boton", async () => {
    const source = await readSource();

    // El scroll llega en fase de captura tambien desde la lista de candidatos:
    // sin este guardia, recorrer los candidatos cierra el panel.
    assert.match(
        source,
        /if \(event\.target instanceof Node && node\.contains\(event\.target\)\) return;/
    );
    // Y el boton que lo abrio lo alterna por su cuenta: si el cierre por clic
    // fuera lo tomara, el clic siguiente lo reabriria y nunca se cerraria.
    assert.match(source, /event\.target\.closest\("\[data-cell-assign\]"\)/);
});

test("quitar a alguien desde el selector lo anota como quitado", async () => {
    const source = await readSource();

    // Si no se anota, la regla de trabajador predefinido lo repone sola y el
    // supervisor no logra sacarlo de la casilla.
    assert.match(
        source,
        /function setCellWorkers[\s\S]{0,700}const removedDefaults = defaultWorkersForCell\(task, keyDay, shift\)\s*\n\s*\.filter\(worker => !nextWorkers\.includes\(worker\)\)/
    );
});
