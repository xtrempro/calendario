import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Lo que el trabajador abre en "Programación" es la asignacion de tareas del
// supervisor, no el Excel. Viaja en el documento COMPARTIDO del workspace, que
// ya se publica de forma diferida.

const readSync = () => readFile(
    new URL("../js/workerAppDataSync.js", import.meta.url),
    "utf8"
);
const readTasks = () => readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);

test("la grilla de tareas se suma a lo que se publica", async () => {
    const sync = await readSync();

    assert.match(sync, /function taskScheduleAttachments\(\)/);
    assert.match(
        sync,
        /taskScheduleAttachments\(\)\.forEach\(entry => \{\s*\n\s*attachments\[entry\.weekStartISO\] = entry;/
    );
});

test("donde hay tareas repartidas, pisan al Excel de esa semana", async () => {
    const sync = await readSync();

    // El orden importa: si se mezclara antes del adjunto, el Excel viejo
    // ganaria y el trabajador seguiria viendo la programacion equivocada.
    const legacy = sync.indexOf("attachments[legacy.weekStartISO] = legacy;");
    const tasks = sync.indexOf("attachments[entry.weekStartISO] = entry;");

    assert.ok(legacy !== -1 && tasks !== -1);
    assert.ok(legacy < tasks, "la grilla de tareas debe mezclarse despues");
});

test("se publica una ventana acotada de semanas", async () => {
    const sync = await readSync();

    // El documento se escribe entero en cada publicacion: publicar todas las
    // semanas de la historia lo haria crecer sin techo.
    assert.match(sync, /const TASK_SCHEDULE_PUBLISHED_WEEKS = \[-1, 0, 1\];/);
});

test("el proveedor se registra en vez de importarse, para no cerrar un ciclo", async () => {
    const sync = await readSync();
    const tasks = await readTasks();

    // `taskAssignments` YA importa `workerAppDataSync`: importarlo de vuelta
    // cerraria un ciclo de imports.
    assert.match(sync, /export function registerTaskScheduleGridProvider\(provider\)/);
    assert.doesNotMatch(sync, /from "\.\/taskAssignments\.js"/);
    assert.match(tasks, /registerTaskScheduleGridProvider\(taskScheduleGrid\);/);
});

test("si la grilla falla, la publicacion no se cae", async () => {
    const sync = await readSync();

    // Publicar es lo que mantiene al dia el telefono del trabajador: un error
    // armando una semana no puede tumbar el resto del payload.
    assert.match(
        sync,
        /try \{\s*\n\s*grid = taskScheduleGridProvider\(start\);\s*\n\s*\} catch \(error\) \{/
    );
});

test("la publicacion sigue siendo diferida y agrupada", async () => {
    const tasks = await readTasks();
    const sync = await readSync();

    // No hace falta un boton de publicar: cada cambio reprograma el mismo
    // temporizador, asi que una tanda de ediciones sale en UNA publicacion.
    assert.match(tasks, /const TASK_ASSIGNMENT_PUBLISH_DELAY_MS = 3000;/);
    assert.match(
        sync,
        /clearTimeout\(hotPublishTimer\);\s*\n\s*hotPublishTimer = setTimeout\(\(\) => publishHotNow\(\), delay\);/
    );
});
