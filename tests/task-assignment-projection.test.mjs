import assert from "node:assert/strict";
import test from "node:test";

import { TURNO } from "../js/constants.js";

function createMemoryStorage() {
    const entries = new Map();

    return {
        get length() {
            return entries.size;
        },
        clear() {
            entries.clear();
        },
        getItem(key) {
            const cleanKey = String(key);

            return entries.has(cleanKey) ? entries.get(cleanKey) : null;
        },
        key(index) {
            return Array.from(entries.keys())[index] || null;
        },
        removeItem(key) {
            entries.delete(String(key));
        },
        setItem(key, value) {
            entries.set(String(key), String(value));
        }
    };
}

function setJSON(key, value) {
    globalThis.localStorage.setItem(key, JSON.stringify(value));
}

function scheduleForWeek() {
    return {
        days: {
            "2026-07-20": { iso: "2026-07-20" },
            "2026-07-21": { iso: "2026-07-21" },
            "2026-07-22": { iso: "2026-07-22" },
            "2026-07-23": { iso: "2026-07-23" },
            "2026-07-24": { iso: "2026-07-24" }
        }
    };
}

function taskTitles(projected, iso) {
    return projected.days[iso].taskAssignments?.map(item => item.title) || [];
}

test("proyecta tareas predefinidas para cada turno y solo diurnos habiles", async () => {
    globalThis.localStorage = createMemoryStorage();

    const {
        addTaskAssignmentsToSchedule,
        TASK_ASSIGNMENT_ENTRIES_KEY,
        TASK_ASSIGNMENT_TASKS_KEY
    } = await import("../js/taskAssignmentProjection.js");

    setJSON("baseData_Ana", {
        "2026-6-20": TURNO.LARGA,
        "2026-6-21": TURNO.NOCHE,
        "2026-6-22": TURNO.LARGA,
        "2026-6-23": TURNO.NOCHE,
        "2026-6-24": TURNO.LARGA
    });
    setJSON(TASK_ASSIGNMENT_ENTRIES_KEY, {});
    setJSON(TASK_ASSIGNMENT_TASKS_KEY, [
        {
            id: "task_every_turn",
            shift: "both",
            title: "Control de stock",
            order: 1,
            defaultWorkerRules: [{
                workerName: "Ana",
                interval: 1,
                anchorKeyDay: "2026-6-20",
                habilOnly: false
            }]
        },
        {
            id: "task_day_business",
            shift: "both",
            title: "Revision diurna habil",
            order: 2,
            defaultWorkerRules: [{
                workerName: "Ana",
                interval: 2,
                anchorKeyDay: "2026-6-20",
                habilOnly: true
            }]
        }
    ]);

    const projected = addTaskAssignmentsToSchedule(
        { name: "Ana" },
        scheduleForWeek()
    );

    assert.deepEqual(
        taskTitles(projected, "2026-07-20"),
        ["Control de stock", "Revision diurna habil"]
    );
    assert.deepEqual(
        taskTitles(projected, "2026-07-21"),
        ["Control de stock"]
    );
    assert.deepEqual(
        taskTitles(projected, "2026-07-22"),
        ["Control de stock"]
    );
    assert.deepEqual(
        taskTitles(projected, "2026-07-23"),
        ["Control de stock"]
    );
    assert.deepEqual(
        taskTitles(projected, "2026-07-24"),
        ["Control de stock", "Revision diurna habil"]
    );
    assert.equal(
        projected.days["2026-07-21"].taskAssignments[0].shiftLabel,
        "Noche"
    );
    assert.equal(
        projected.days["2026-07-24"].taskAssignments[1].shiftLabel,
        "Diurno"
    );
});

test("ignora turnos extra al crear predefinidos y al contar frecuencia", async () => {
    globalThis.localStorage = createMemoryStorage();

    const {
        addTaskAssignmentsToSchedule,
        TASK_ASSIGNMENT_ENTRIES_KEY,
        TASK_ASSIGNMENT_TASKS_KEY
    } = await import("../js/taskAssignmentProjection.js");

    setJSON("baseData_Ana", {
        "2026-6-20": TURNO.LARGA,
        "2026-6-22": TURNO.LARGA,
        "2026-6-24": TURNO.LARGA
    });
    setJSON("replacements", [{
        id: "extra_ana_2026_07_21",
        worker: "Ana",
        replaced: "Bea",
        date: "2026-07-21",
        turno: "L",
        canceled: false
    }]);
    setJSON(TASK_ASSIGNMENT_ENTRIES_KEY, {});
    setJSON(TASK_ASSIGNMENT_TASKS_KEY, [
        {
            id: "task_every_base_turn",
            shift: "both",
            title: "Control de stock",
            order: 1,
            defaultWorkerRules: [{
                workerName: "Ana",
                interval: 1,
                anchorKeyDay: "2026-6-20",
                habilOnly: false
            }]
        },
        {
            id: "task_every_two_business_days",
            shift: "both",
            title: "Revision diurna habil",
            order: 2,
            defaultWorkerRules: [{
                workerName: "Ana",
                interval: 2,
                anchorKeyDay: "2026-6-20",
                habilOnly: true
            }]
        }
    ]);

    const projected = addTaskAssignmentsToSchedule(
        { name: "Ana" },
        scheduleForWeek()
    );

    assert.deepEqual(
        taskTitles(projected, "2026-07-20"),
        ["Control de stock", "Revision diurna habil"]
    );
    assert.deepEqual(taskTitles(projected, "2026-07-21"), []);
    assert.deepEqual(
        taskTitles(projected, "2026-07-22"),
        ["Control de stock"]
    );
    assert.deepEqual(
        taskTitles(projected, "2026-07-24"),
        ["Control de stock", "Revision diurna habil"]
    );
});

test("limpia tareas antiguas cuando se elimina el catalogo de predefinidos", async () => {
    globalThis.localStorage = createMemoryStorage();

    const {
        addTaskAssignmentsToSchedule,
        TASK_ASSIGNMENT_ENTRIES_KEY,
        TASK_ASSIGNMENT_TASKS_KEY
    } = await import("../js/taskAssignmentProjection.js");

    setJSON(TASK_ASSIGNMENT_ENTRIES_KEY, {});
    setJSON(TASK_ASSIGNMENT_TASKS_KEY, []);

    const projected = addTaskAssignmentsToSchedule(
        { name: "Ana" },
        {
            days: {
                "2026-07-20": {
                    iso: "2026-07-20",
                    taskAssignments: [{
                        id: "old_task",
                        title: "Tarea anterior"
                    }]
                }
            }
        }
    );

    assert.equal(
        Object.hasOwn(projected.days["2026-07-20"], "taskAssignments"),
        false
    );
});
