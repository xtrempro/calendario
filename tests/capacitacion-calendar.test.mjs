import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get length() {
        return this.values.size;
    }

    clear() {
        this.values.clear();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    key(index) {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key) {
        this.values.delete(key);
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }
}

globalThis.localStorage = new MemoryStorage();

const { getJSON } = await import("../js/persistence.js");
const {
    aplicarCapacitacion
} = await import("../js/leaveEngine.js");
const {
    esTurnoCapacitacionValido,
    estaBloqueadoModo
} = await import("../js/rulesEngine.js");
const {
    setCurrentProfile,
    saveBaseProfileData,
    getAbsences,
    getBlockedDays,
    setShiftAssigned
} = await import("../js/storage.js");
const {
    cancelReplacementById,
    saveReplacement
} = await import("../js/replacements.js");
const { getClockMarks } = await import("../js/clockMarks.js");
const { calcularHorasMesPerfil } = await import("../js/hoursEngine.js");
const { TURNO } = await import("../js/constants.js");

const PROFILE = "Ana";
const MONDAY = new Date(2026, 7, 24);
const MONDAY_KEY = "2026-7-24";
const TUESDAY = new Date(2026, 7, 25);
const TUESDAY_KEY = "2026-7-25";

beforeEach(() => {
    delete globalThis.window;
    globalThis.document = {
        body: { dataset: {} },
        getElementById() {
            return null;
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };
    globalThis.localStorage.clear();
    setCurrentProfile(PROFILE);
});

test("registra una capacitacion diurna con horas de cobertura personalizadas", async () => {
    let historyPushed = 0;

    saveBaseProfileData({
        [MONDAY_KEY]: TURNO.DIURNO
    }, PROFILE);

    const applied = await aplicarCapacitacion(MONDAY, {
        startTime: "10:00",
        endTime: "17:00",
        scheduledStart: "08:00",
        scheduledEnd: "17:00",
        overtimeHours: { d: 7, n: 0 }
    }, {
        beforeMutation: () => {
            historyPushed++;
        }
    });

    assert.equal(applied, true);
    assert.equal(historyPushed, 1);
    assert.deepEqual(getAbsences()[MONDAY_KEY], {
        type: "training",
        startTime: "10:00",
        endTime: "17:00",
        scheduledStart: "08:00",
        scheduledEnd: "17:00",
        overtimeHours: { d: 7, n: 0 }
    });
    assert.equal(getBlockedDays()[MONDAY_KEY], true);

    const [entry] = getJSON("auditLog", []);

    assert.equal(entry.meta.type, "training");
    assert.deepEqual(entry.meta.overtimeHours, { d: 7, n: 0 });
});

test("rechaza capacitaciones sobre turnos nocturnos", async () => {
    saveBaseProfileData({
        [TUESDAY_KEY]: TURNO.NOCHE
    }, PROFILE);

    const applied = await aplicarCapacitacion(TUESDAY, {
        startTime: "20:00",
        endTime: "08:00",
        scheduledStart: "20:00",
        scheduledEnd: "08:00",
        overtimeHours: { d: 0, n: 10 }
    });

    assert.equal(applied, false);
    assert.deepEqual(getAbsences(), {});
    assert.deepEqual(getBlockedDays(), {});
});

test("el modo capacitacion solo habilita turnos Larga o Diurno", () => {
    assert.equal(esTurnoCapacitacionValido(TURNO.LARGA), true);
    assert.equal(esTurnoCapacitacionValido(TURNO.DIURNO), true);
    assert.equal(esTurnoCapacitacionValido(TURNO.NOCHE), false);
    assert.equal(esTurnoCapacitacionValido(TURNO.TURNO24), false);
    assert.equal(esTurnoCapacitacionValido(TURNO.DIURNO_NOCHE), false);
    assert.equal(esTurnoCapacitacionValido(TURNO.TURNO18), false);

    assert.equal(
        estaBloqueadoModo(
            "training",
            MONDAY_KEY,
            TURNO.DIURNO,
            true,
            {},
            {},
            {},
            {},
            true
        ),
        false
    );
    assert.equal(
        estaBloqueadoModo(
            "training",
            TUESDAY_KEY,
            TURNO.NOCHE,
            true,
            {},
            {},
            {},
            {},
            true
        ),
        true
    );
});

test("el reemplazo de una capacitacion parcial queda con marcaje reducido", async () => {
    saveBaseProfileData({
        [MONDAY_KEY]: TURNO.DIURNO
    }, PROFILE);
    saveBaseProfileData({
        [MONDAY_KEY]: TURNO.LIBRE
    }, "Bruno");
    setShiftAssigned(true, "Bruno");

    await aplicarCapacitacion(MONDAY, {
        startTime: "10:00",
        endTime: "17:00",
        scheduledStart: "08:00",
        scheduledEnd: "17:00",
        overtimeHours: { d: 7, n: 0 }
    });

    const replacement = saveReplacement({
        worker: "Bruno",
        replaced: PROFILE,
        keyDay: MONDAY_KEY,
        turno: TURNO.DIURNO,
        absenceType: "Capacitacion",
        overtimeHours: { d: 7, n: 0 }
    });
    const mark = getClockMarks("Bruno")[MONDAY_KEY];

    assert.equal(mark.segments.diurno.entryTime, "10:00");
    assert.equal(mark.segments.diurno.exitTime, undefined);
    assert.equal(
        mark.segments.diurno.trainingReplacementId,
        replacement.id
    );

    const stats = calcularHorasMesPerfil(
        "Bruno",
        2026,
        7,
        31,
        {},
        {},
        {},
        { d: 0, n: 0 }
    );

    assert.equal(stats.hheeDiurnas, 7);
    assert.equal(stats.hheeNocturnas, 0);

    cancelReplacementById(replacement.id);

    assert.equal(getClockMarks("Bruno")[MONDAY_KEY], undefined);
});

test("la UI conecta capacitacion con modal y horas extra del reemplazo", () => {
    const index = readFileSync("index.html", "utf8");
    const main = readFileSync("js/main.js", "utf8");
    const calendar = readFileSync("js/calendar.js", "utf8");
    const rules = readFileSync("js/rulesEngine.js", "utf8");
    const styles = readFileSync("styles.css", "utf8");

    assert.match(index, /id="trainingBtn"/);
    assert.match(index, /CAPACITACI&Oacute;N/);
    assert.match(main, /openTrainingDialog/);
    assert.match(main, /aplicarCapacitacion/);
    assert.match(main, /selectionMode === "training"/);
    assert.match(rules, /esTurnoCapacitacionValido/);
    assert.match(calendar, /getTrainingCoverageHours/);
    assert.match(calendar, /replacementCandidateCoverageAttrs/);
    assert.match(calendar, /data-overtime-day-hours/);
    assert.match(styles, /\.training-day/);
});
