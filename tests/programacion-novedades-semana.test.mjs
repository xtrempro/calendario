import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    COMMEMORATIVE_DAYS,
    commemorativeDaysForDate
} from "../js/commemorativeDays.js";

// La tabla de novedades de la semana -ausencias y permisos, cumpleanos y
// efemerides- que va DEBAJO de las tareas de noche en "Ver programacion" y en
// la hoja impresa.

const readTasks = () => readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
);
const readPreview = () => readFile(
    new URL("../js/taskSchedulePreview.js", import.meta.url),
    "utf8"
);

test("las efemerides se buscan por mes y dia, sin año", () => {
    // 12 de mayo, en dos años distintos: la efemeride es la misma.
    assert.deepEqual(
        commemorativeDaysForDate(new Date(2026, 4, 12)),
        ["Día Internacional de la Enfermería"]
    );
    assert.deepEqual(
        commemorativeDaysForDate(new Date(2031, 4, 12)),
        ["Día Internacional de la Enfermería"]
    );
});

test("un dia sin efemeride no inventa ninguna", () => {
    assert.deepEqual(commemorativeDaysForDate(new Date(2026, 4, 13)), []);
});

test("una fecha invalida no rompe", () => {
    assert.deepEqual(commemorativeDaysForDate(new Date("no es fecha")), []);
    assert.deepEqual(commemorativeDaysForDate(null), []);
});

test("dos efemerides el mismo dia salen las dos", () => {
    const table = [
        { date: "12-03", title: "Primera" },
        { date: "12-03", title: "Segunda" },
        { date: "12-04", title: "Otra" }
    ];

    assert.deepEqual(
        commemorativeDaysForDate(new Date(2026, 11, 3), table),
        ["Primera", "Segunda"]
    );
});

test("la tabla esta bien formada", () => {
    COMMEMORATIVE_DAYS.forEach(item => {
        assert.match(
            item.date,
            /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
            `fecha invalida: ${item.date}`
        );
        assert.ok(item.title.trim().length, "toda efemeride necesita titulo");
    });
});

test("las novedades NO entran en la programacion que se publica", async () => {
    const source = await readTasks();

    // getTaskScheduleWeek alimenta taskScheduleGrid, y ese es el que viaja a la
    // PWA del trabajador. Las licencias y permisos de la unidad entera no
    // pueden terminar en el telefono de cualquiera: por eso las novedades van
    // en una funcion aparte.
    const week = source.indexOf("export function getTaskScheduleWeek(");
    const events = source.indexOf("export function getTaskScheduleWeekEvents(");
    const grid = source.indexOf("export function taskScheduleGrid(");

    assert.ok(week !== -1 && events !== -1 && grid !== -1);

    const weekBody = source.slice(week, source.indexOf("\n}", week));
    const gridBody = source.slice(grid, source.indexOf("\n}", grid));

    assert.doesNotMatch(weekBody, /absenceProfiles|birthdayProfiles|commemorative/i);
    assert.doesNotMatch(gridBody, /absenceProfiles|birthdayProfiles|commemorative/i);
});

test("las tres filas salen sin los filtros del tablero", async () => {
    const source = await readTasks();

    // La programacion impresa muestra a todos, igual que las filas de tareas.
    assert.match(source, /absenceProfiles\(day, \{ filtered: false \}\)/);
    assert.match(source, /birthdayProfiles\(day, \{ filtered: false \}\)/);
    // Nombre abreviado, como el resto de la hoja impresa.
    assert.match(source, /shortWorkerName\(item\.profile\.name, \{ compact: true \}\)/);
    assert.match(source, /shortWorkerName\(profile\.name, \{ compact: true \}\)/);
    assert.match(source, /title: "AUSENCIAS Y PERMISOS"/);
    assert.match(source, /title: "CUMPLEAÑOS"/);
    assert.match(source, /title: "EFEMÉRIDES"/);
});

test("una fila sin nada en toda la semana no se dibuja", async () => {
    const source = await readTasks();

    assert.match(
        source,
        /\.filter\(row => row\.cells\.some\(cell => cell\.lines\.length\)\)/
    );
});

test("el visor y la hoja impresa dibujan la tabla debajo de las tareas", async () => {
    const preview = await readPreview();

    // Misma funcion de seccion que las tablas de tareas: si se dibujara aparte,
    // el ensayo y la hoja impresa dejarian de verse iguales.
    assert.match(preview, /function bodyHTML\(week, events\)/);
    assert.match(preview, /function printDocumentHTML\(week, events\)/);
    assert.match(preview, /events \? sectionHTML\(events, week\.days\) : ""/);
    assert.match(preview, /events \? printTableHTML\(events, week\.days\) : ""/);

    // Debajo, no encima.
    assert.match(preview, /\.join\(""\) \+ eventsHTML;/);
    assert.match(preview, /const body = tables \+ \(events/);
});

test("las novedades se ven aunque la semana no tenga tareas repartidas", async () => {
    const preview = await readPreview();

    assert.match(
        preview,
        /Todavía no hay trabajadores asignados en esta semana\.<\/div>\$\{eventsHTML\}/
    );
});

test("una casilla de novedades pone un renglon por novedad", async () => {
    const preview = await readPreview();

    // Los nombres de las tareas se juntan con guiones en un renglon; las
    // novedades necesitan uno por linea.
    assert.match(preview, /if \(cell\.lines\?\.length\) lines\.push\(\.\.\.cell\.lines\)/);
    assert.match(preview, /if \(cell\.workers\?\.length\)/);
});
