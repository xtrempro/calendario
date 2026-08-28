// Tres cosas que compartian el mismo defecto: informacion que el sistema tenia
// pero no dejaba ver.
//
// 1. La programacion semanal publicada solo se veia en la PWA del trabajador.
//    El menu de tareas la sube y dice "Tabla leida del Excel · 34 filas", pero
//    no la dibuja. Ahora el inicio tiene un boton que la muestra igual que la
//    ve el trabajador.
// 2. El modal de dotacion recortaba los nombres y sacaba scroll lateral en vez
//    de ensancharse.
// 3. Los adjuntos de los registros del perfil eran texto: el archivo se subia y
//    no habia forma de volver a abrirlo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const {
    addDays,
    weekHeading,
    weekStartMonday
} = await import("../js/weeklySchedulePreview.js");

const preview = await read("../js/weeklySchedulePreview.js");
const home = await read("../js/home.js");
const main = await read("../js/main.js");
const recordsView = await read("../js/profileRecordsView.js");
const tasks = await read("../js/taskAssignments.js");
const styles = await read("../styles.css");

/* =========================================================
   La semana
========================================================= */

test("la semana empieza el lunes", () => {
    // 22 de agosto de 2026 es sabado; su semana parte el lunes 17.
    const sabado = new Date(2026, 7, 22);
    const lunes = weekStartMonday(sabado);

    assert.equal(lunes.getDate(), 17);
    assert.equal(lunes.getDay(), 1);
    // Un domingo pertenece a la semana que ya empezo, no a la siguiente.
    assert.equal(weekStartMonday(new Date(2026, 7, 23)).getDate(), 17);
    // Y un lunes es su propio inicio.
    assert.equal(weekStartMonday(new Date(2026, 7, 24)).getDate(), 24);
});

test("el titulo dice en que mes se esta parado", () => {
    // Es lo que permite orientarse mientras se avanza semana a semana.
    assert.equal(
        weekHeading(new Date(2026, 7, 24)),
        "24 al 30 de agosto de 2026"
    );
});

test("una semana a caballo entre dos meses nombra los dos", () => {
    // Del 31 de agosto al 6 de septiembre: decir solo "septiembre" confundiria.
    assert.equal(
        weekHeading(new Date(2026, 7, 31)),
        "31 de agosto al 6 de septiembre de 2026"
    );
});

test("avanzar de a siete dias cruza el mes solo", () => {
    const semana = addDays(new Date(2026, 7, 31), 7);

    assert.equal(semana.getMonth(), 8);
    assert.equal(semana.getDate(), 7);
});

/* =========================================================
   El visor
========================================================= */

test("el acceso es un widget de la fila de dotacion y abre en la semana de hoy", () => {
    // Dejo de ser un boton del encabezado: ahora es una tarjeta mas de la fila
    // de widgets, junto a la dotacion.
    assert.match(home, /data-hm="open-weekly"/);
    assert.match(home, />Programación semanal</);
    assert.match(
        home,
        /return dotacion \+ programacionWidget\(\) \+ notasWidget\(\);/
    );
    // No queda donde estaba la vez anterior: se entra por "hoy".
    assert.match(
        home,
        /function openWeeklySchedule\(target\) \{[\s\S]{0,200}weeklyScheduleWeek = weekStartMonday\(new Date\(\)\)/
    );
});

test("sin programacion adjunta el widget no aparece", () => {
    // Un acceso que lleva a una pantalla vacia solo estorba.
    assert.match(home, /if \(!semanas\.length\) return "";/);
});

test("el widget muestra cuando se actualizo cada semana", () => {
    assert.match(home, /label: "Esta semana"/);
    assert.match(home, /label: "Próxima semana", start: addScheduleDays\(estaSemana, 7\)/);
    // Solo las semanas que tienen tareas repartidas.
    assert.match(home, /const updatedAtISO = taskScheduleUpdatedAt\(semana\.start\);/);
    assert.match(home, /return updatedAtISO\s*\n\s*\? \{ label: semana\.label, \.\.\.actualizacion\(updatedAtISO\) \}\s*\n\s*: null;/);
});

test("desde el inicio ya no se adjunta ningun Excel", () => {
    // La unica programacion posible viene del tablero de tareas.
    assert.doesNotMatch(home, /data-hm="ws-attach"/);
    assert.doesNotMatch(home, /openScheduleAttachmentDialog/);
    // Y no queda camino para resolver imagenes de Storage.
    assert.doesNotMatch(home, /resolveAttachmentUrl/);
    assert.doesNotMatch(home, /loadWeeklyScheduleImage/);
});

test("se puede recorrer semana a semana y volver a hoy", () => {
    assert.match(home, /data-hm="ws-prev"/);
    assert.match(home, /data-hm="ws-next"/);
    assert.match(home, /data-hm="ws-today"/);
    assert.match(home, /paso\.dataset\.hm === "ws-next" \? 7 : -7/);
});

test("las semanas publicadas del mes estan a un click", () => {
    // Sin esto habria que avanzar de a una para descubrir cuales tienen algo.
    assert.match(preview, /export function publishedWeeksOfMonth/);
    assert.match(home, /data-hm="ws-week"/);
    // Una semana que cruza el cambio de mes tiene que salir en los dos meses.
    assert.match(
        preview,
        /const end = addDays\(date, 6\);[\s\S]{0,260}end\.getMonth\(\) === month/
    );
});

test("adjuntar Excel dejo de existir en el menu de tareas", () => {
    // Se elimino por completo: la unica programacion posible es la que sale del
    // tablero. Si algo de esto reaparece, volvieron las dos verdades.
    assert.doesNotMatch(tasks, /getScheduleAttachment/);
    assert.doesNotMatch(tasks, /openScheduleAttachmentDialog/);
    assert.doesNotMatch(tasks, /createScheduleWorkbookAttachment/);
    assert.doesNotMatch(tasks, /data-task-schedule-attach/);
    assert.doesNotMatch(tasks, /SCHEDULE_WORKBOOK_ACCEPT/);
});

test("dibuja la asignacion de tareas, no el Excel que sube el supervisor", () => {
    // Antes se dibujaba el adjunto: eso obligaba a mantener dos verdades -lo
    // repartido en el tablero y lo subido a mano- y a que no coincidieran.
    assert.match(preview, /const grid = taskScheduleGrid\(weekStart\);/);
    assert.match(preview, /gridTableHTML\(grid\)/);
    assert.match(preview, /Todavía no hay tareas asignadas en esta semana/);

    // Y ya no se resuelve ninguna imagen de Storage: no hay nada que dibujar
    // con ella.
    assert.doesNotMatch(preview, /ws-image-scroll/);
});

test("muestra cuando fue la ultima modificacion", () => {
    // Sin esto, una programacion vieja y una recien tocada se ven igual.
    assert.match(preview, /export function scheduleUpdatedHTML\(updatedAtISO\)/);
    assert.match(preview, /Última modificación:/);
    assert.match(styles, /\.ws-updated \{/);
});

test("respeta las celdas combinadas del fin de semana", () => {
    // Los bloques de fin de semana ocupan varias filas (rowSpan). Si no se
    // llevara la cuenta de que columnas siguen ocupadas, las celdas de las
    // filas de abajo se correrian de lugar.
    assert.match(preview, /const active = new Array\(dayCount\)\.fill\(0\)/);
    assert.match(preview, /active\[col\] = rowSpan - 1;/);
    assert.match(preview, /if \(active\[col\] > 0\) \{[\s\S]{0,60}active\[col\] -= 1;[\s\S]{0,30}continue;/);
});

test("la tabla scrollea en su caja, no arrastra el modal", () => {
    // Regla de un solo selector: `.ws-image-scroll` se fue con el Excel.
    assert.match(styles, /\.ws-table-scroll \{[\s\S]{0,80}overflow: auto;/);
    assert.doesNotMatch(styles, /ws-image-scroll/);
    // Y la columna de roles queda fija: sin ella no se sabe de quien es la fila.
    assert.match(styles, /\.ws-table \.ws-role \{[\s\S]{0,120}position: sticky;[\s\S]{0,40}left: 0;/);
    // El modal se ensancha para que quepan los 7 dias.
    assert.match(styles, /\.hm-modal--weekly \{ width: min\(1400px, 100%\); \}/);
    // Y se achica en pantalla angosta.
    assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]{0,220}\.ws-cell \{ min-width: 86px; \}/);
});

/* =========================================================
   El modal de dotacion
========================================================= */

test("la dotacion se ensancha en vez de recortar los nombres", () => {
    assert.match(styles, /\.hm-modal--dotacion \{ width: min\(1080px, 100%\); \}/);
    // La causa del scroll lateral: sin min-width:0 la columna de la grilla no
    // puede encoger y es el nombre largo el que empuja el modal.
    assert.match(styles, /\.hm-dot-col \{ min-width: 0; \}/);
    // El nombre completo, en dos lineas si hace falta.
    assert.match(styles, /\.hm-dot-name \{[\s\S]{0,140}overflow-wrap: anywhere;/);
    assert.doesNotMatch(styles, /\.hm-dot-name \{[\s\S]{0,140}text-overflow: ellipsis/);
});

/* =========================================================
   Los adjuntos del perfil
========================================================= */

test("el adjunto de un registro se puede abrir", () => {
    assert.match(recordsView, /data-record-attachment=/);
    assert.match(main, /await openAttachmentFile\(entry\.file, \{ newTab: true \}\)/);
    // Sirve para TODOS los recuadros del perfil, no solo evaluaciones: todos
    // pintan sus entradas con el mismo renderRecordEntry.
    assert.match(recordsView, /renderAttachmentName\(entry, config\.key\)/);
    assert.match(main, /button\.dataset\.recordKey/);
});

test("un registro viejo sin archivo no finge que se puede abrir", () => {
    // Los mas antiguos guardaron solo el nombre; ahi no hay nada que abrir.
    assert.match(recordsView, /const abrible = Boolean\(file\.storagePath \|\| file\.dataUrl\);/);
    assert.match(recordsView, /pf-rec-clip--gone/);
    assert.match(styles, /\.pf-rec-clip--gone \{ cursor: default;/);
});
