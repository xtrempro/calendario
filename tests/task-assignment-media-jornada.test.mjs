import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TURNO } from "../js/constants.js";

// Media jornada y extension horaria en la asignacion de tareas.
//
// Antes cualquier permiso administrativo -incluido el 1/2 ADM- contaba como
// ausencia del dia completo: el trabajador desaparecia del tablero y de la
// programacion aunque viniera media jornada. Y la extension horaria sobre la
// noche (turno de 18 horas) no citaba a nadie al tablero diurno, aunque ese
// tramo -14:00 a 20:00- es de dia.

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

function readSource() {
    return readFile(
        new URL("../js/taskAssignments.js", import.meta.url),
        "utf8"
    );
}

const readStyles = () => readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
);

// Semana del lunes 2026-07-20 al viernes 2026-07-24. Las claves internas van
// con mes 0-based (`2026-6-20`).
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

test("el 1/2 ADM deja las tareas del dia; el administrativo entero no", async () => {
    globalThis.localStorage = createMemoryStorage();

    const {
        addTaskAssignmentsToSchedule,
        TASK_ASSIGNMENT_ENTRIES_KEY,
        TASK_ASSIGNMENT_TASKS_KEY
    } = await import("../js/taskAssignmentProjection.js");

    setJSON("baseData_Ana", {
        "2026-6-20": TURNO.LARGA,
        "2026-6-21": TURNO.LARGA,
        "2026-6-22": TURNO.LARGA,
        "2026-6-23": TURNO.LARGA,
        "2026-6-24": TURNO.LARGA
    });
    setJSON("admin_Ana", {
        // Media jornada: viene igual, de 08:00 al corte.
        "2026-6-21": "0.5T",
        // Media jornada: entra en el corte y se queda hasta el final.
        "2026-6-22": "0.5M",
        // Permiso administrativo completo: ese dia no viene.
        "2026-6-23": 1
    });
    setJSON(TASK_ASSIGNMENT_ENTRIES_KEY, {});
    setJSON(TASK_ASSIGNMENT_TASKS_KEY, [{
        id: "task_stock",
        shift: "both",
        title: "Control de stock",
        order: 1,
        defaultWorkerRules: [{
            workerName: "Ana",
            interval: 1,
            anchorKeyDay: "2026-6-20",
            habilOnly: false
        }]
    }]);

    const projected = addTaskAssignmentsToSchedule(
        { name: "Ana" },
        scheduleForWeek()
    );

    assert.deepEqual(taskTitles(projected, "2026-07-20"), ["Control de stock"]);
    assert.deepEqual(taskTitles(projected, "2026-07-21"), ["Control de stock"]);
    assert.deepEqual(taskTitles(projected, "2026-07-22"), ["Control de stock"]);
    assert.deepEqual(taskTitles(projected, "2026-07-23"), []);
});

test("la extension horaria sobre la noche cita al tablero diurno", async () => {
    globalThis.localStorage = createMemoryStorage();

    const {
        addTaskAssignmentsToSchedule,
        TASK_ASSIGNMENT_ENTRIES_KEY,
        TASK_ASSIGNMENT_TASKS_KEY
    } = await import("../js/taskAssignmentProjection.js");

    setJSON("baseData_Beto", {
        // Noche pelada: solo tareas de noche.
        "2026-6-20": TURNO.NOCHE,
        // Noche con extension horaria (18 horas): el tramo 14:00 a 20:00 es
        // diurno, asi que ese dia esta citado en los dos tableros.
        "2026-6-21": TURNO.TURNO18
    });
    setJSON(TASK_ASSIGNMENT_ENTRIES_KEY, {});
    setJSON(TASK_ASSIGNMENT_TASKS_KEY, [
        {
            id: "task_day",
            shift: "day",
            title: "Ronda diurna",
            order: 1,
            defaultWorkerRules: [{
                workerName: "Beto",
                interval: 1,
                anchorKeyDay: "2026-6-20",
                habilOnly: false
            }]
        },
        {
            id: "task_night",
            shift: "night",
            title: "Ronda nocturna",
            order: 2,
            defaultWorkerRules: [{
                workerName: "Beto",
                interval: 1,
                anchorKeyDay: "2026-6-20",
                habilOnly: false
            }]
        }
    ]);

    const projected = addTaskAssignmentsToSchedule(
        { name: "Beto" },
        scheduleForWeek()
    );

    assert.deepEqual(
        taskTitles(projected, "2026-07-20"),
        ["Ronda nocturna"]
    );
    assert.deepEqual(
        taskTitles(projected, "2026-07-21"),
        ["Ronda diurna", "Ronda nocturna"]
    );
});

test("el corte de la media jornada lo fija la rotativa, no el permiso", async () => {
    globalThis.localStorage = createMemoryStorage();

    const { getPartialShiftWindow, partialShiftLabel } = await import(
        "../js/partialShift.js"
    );

    // 4to turno: base Larga de 08:00 a 20:00, la mitad cae a las 14:00.
    setJSON("rotativa_Ana", { type: "4turno", start: "2026-01-01" });
    setJSON("admin_Ana", { "2026-6-21": "0.5M" });
    // Diurno: termina a las 17:00 y parte a las 12:30, salvo el viernes, que
    // termina a las 16:00 y parte a las 12:00.
    setJSON("rotativa_Beto", { type: "diurno", start: "2026-01-01" });
    setJSON("admin_Beto", {
        "2026-6-21": "0.5T",
        "2026-6-24": "0.5T"
    });

    assert.equal(
        partialShiftLabel(
            getPartialShiftWindow("Ana", "2026-6-21", "day", TURNO.LARGA)
        ),
        "desde las 14:00"
    );
    assert.equal(
        partialShiftLabel(
            getPartialShiftWindow("Beto", "2026-6-21", "day", TURNO.DIURNO)
        ),
        "hasta las 12:30"
    );
    assert.equal(
        partialShiftLabel(
            getPartialShiftWindow("Beto", "2026-6-24", "day", TURNO.DIURNO)
        ),
        "hasta las 12:00"
    );
    // Forma compacta: es la que viaja pegada al nombre en la programacion.
    assert.equal(
        partialShiftLabel(
            getPartialShiftWindow("Ana", "2026-6-21", "day", TURNO.LARGA),
            { compact: true }
        ),
        "desde 14:00"
    );
});

test("la noche no se parte y la jornada completa no lleva etiqueta", async () => {
    globalThis.localStorage = createMemoryStorage();

    const { getPartialShiftWindow } = await import("../js/partialShift.js");

    setJSON("admin_Ana", { "2026-6-21": "0.5M" });

    assert.equal(
        getPartialShiftWindow("Ana", "2026-6-21", "night", TURNO.NOCHE),
        null
    );
    assert.equal(
        getPartialShiftWindow("Ana", "2026-6-20", "day", TURNO.LARGA),
        null
    );
    // Turno de 18 horas: el tramo diurno es la extension, la noche va entera.
    assert.deepEqual(
        getPartialShiftWindow("Beto", "2026-6-20", "day", TURNO.TURNO18),
        { boundary: "from", time: "14:00" }
    );
    assert.equal(
        getPartialShiftWindow("Beto", "2026-6-20", "night", TURNO.TURNO18),
        null
    );
});

test("el chip del tablero rotula la franja junto al nombre", async () => {
    const source = await readSource();
    const styles = await readStyles();

    assert.match(source, /task-assignment-worker-chip__when/);
    assert.match(
        source,
        /const partial = partialShiftText\(\s*profileName,\s*keyDay,\s*task\.shift,\s*\{ compact: true \}\s*\)/
    );
    assert.match(styles, /\.task-assignment-worker-chip__when \{/);
});

test("la programacion publicada lleva la franja pegada al nombre", async () => {
    const source = await readSource();

    assert.match(source, /function scheduleWorkerName\(profileName, keyDay, shift\)/);
    assert.match(source, /partial \? `\$\{name\} \(\$\{partial\}\)` : name/);
});
