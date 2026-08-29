import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

const {
    getProfileData,
    saveProfileData,
    saveProfileDayTurn
} = await import("../js/storage.js");

const PROFILE = "Ana";
const FIRST_DAY = "2026-6-10";
const SECOND_DAY = "2026-6-11";

beforeEach(() => {
    globalThis.localStorage.clear();
});

test("cada edicion directa conserva los cambios recientes de otras casillas", () => {
    saveProfileData({
        [FIRST_DAY]: 1,
        [SECOND_DAY]: 2
    }, PROFILE);

    const staleSnapshot = getProfileData(PROFILE);

    saveProfileDayTurn(FIRST_DAY, 3, PROFILE);
    assert.equal(staleSnapshot[FIRST_DAY], 1);

    saveProfileDayTurn(SECOND_DAY, 4, PROFILE);

    assert.deepEqual(getProfileData(PROFILE), {
        [FIRST_DAY]: 3,
        [SECOND_DAY]: 4
    });
});

test("el calendario relee el turno y guarda solo la fecha pulsada", async () => {
    const source = await readFile(
        new URL("../js/calendar.js", import.meta.url),
        "utf8"
    );
    const mainSource = await readFile(
        new URL("../js/main.js", import.meta.url),
        "utf8"
    );

    assert.match(
        source,
        /currentState = Number\.isFinite\(previewState\)[\s\S]{0,120}: getActualState\(profileName, keyDay\)/
    );
    assert.match(
        source,
        /saveProfileDayTurn\(keyDay, turnToStore, profileName\)/
    );
    assert.match(
        source,
        /Number\(nuevo\) === Number\(currentState\)[\s\S]{0,120}return;/
    );
    assert.match(
        source,
        /recordCalendarDirectEditChange\(\{[\s\S]{0,180}previousTurn: currentState,[\s\S]{0,80}nextTurn: nuevo/
    );
    assert.match(
        source,
        /proturnos:calendarProfilesChanged/
    );
    assert.match(
        mainSource,
        /CALENDAR_DIRECT_EDIT_IDLE_TIMEOUT_MS = 10 \* 60 \* 1000/
    );
    assert.match(
        mainSource,
        /beforeunload[\s\S]{0,120}commitBeforeExit/
    );
    assert.doesNotMatch(source, /data\[keyDay\] = nuevo/);
});

// Si el supervisor abre la edicion, cicla una casilla y la deja como estaba, al
// trabajador no hay que avisarle nada: su calendario no cambio. El guardia de
// `recordCalendarDirectEditChange` solo descarta el click individual que no
// cambia nada; el NETO de varios clicks sobre la misma casilla quedaba en el
// mapa con previousTurn === nextTurn y generaba la notificacion igual.
async function loadChangedKeys() {
    const source = await readFile(
        new URL("../js/calendar.js", import.meta.url),
        "utf8"
    );
    const start = source.indexOf("function calendarDirectEditChangedKeys(");

    assert.notEqual(start, -1, "no se encontro calendarDirectEditChangedKeys");

    let depth = 0;

    for (let i = source.indexOf("{", start); i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") {
            depth -= 1;
            if (!depth) {
                return new Function(
                    `${source.slice(start, i + 1)}
                     return calendarDirectEditChangedKeys;`
                )();
            }
        }
    }

    throw new Error("sin cierre");
}

test("una casilla que vuelve a su turno original no cuenta como cambio", async () => {
    const changedKeys = await loadChangedKeys();
    const changes = new Map([
        // Ciclada y devuelta a Larga: neto sin cambio.
        [FIRST_DAY, { keyDay: FIRST_DAY, previousTurn: 1, nextTurn: 1 }],
        // Esta si quedo distinta.
        [SECOND_DAY, { keyDay: SECOND_DAY, previousTurn: 1, nextTurn: 2 }]
    ]);

    assert.deepEqual(changedKeys(changes), [SECOND_DAY]);
});

test("sin ningun cambio neto no queda nada que notificar", async () => {
    const changedKeys = await loadChangedKeys();
    const changes = new Map([
        [FIRST_DAY, { keyDay: FIRST_DAY, previousTurn: 2, nextTurn: 2 }],
        [SECOND_DAY, { keyDay: SECOND_DAY, previousTurn: 0, nextTurn: 0 }]
    ]);

    // Lista vacia -> el batch se descarta por `affectedDates.length` y no se
    // despacha `calendarProfilesChanged`, que es lo que dispara el aviso.
    assert.deepEqual(changedKeys(changes), []);
});

test("el consumo de cambios usa el filtro y descarta perfiles sin cambios", async () => {
    const source = await readFile(
        new URL("../js/calendar.js", import.meta.url),
        "utf8"
    );

    assert.match(
        source,
        /const affectedKeys = calendarDirectEditChangedKeys\(changes\);/
    );
    // El batch vacio se cae aca, y sin batches no se despacha nada.
    assert.match(source, /\.filter\(batch => batch\.affectedDates\.length\)/);
    assert.match(
        source,
        /if \(\s*\n\s*!batches\.length \|\|[\s\S]{0,80}return batches;/
    );
});

test("la etiqueta No disp. conserva estilo gris aunque el dia pida motivo", async () => {
    const [calendarSource, stylesSource] = await Promise.all([
        readFile(new URL("../js/calendar.js", import.meta.url), "utf8"),
        readFile(new URL("../styles.css", import.meta.url), "utf8")
    ]);

    assert.match(
        calendarSource,
        /item === "No disp\."\s*\?\s*"day-badge day-badge--worker-blocked"/
    );

    const alertBadgeIndex = stylesSource.indexOf(
        ".day.needs-extra-reason .day-badge"
    );
    const blockedBadgeIndex = stylesSource.lastIndexOf(
        ".day.worker-blocked-day .day-badge--worker-blocked"
    );

    assert.ok(blockedBadgeIndex > alertBadgeIndex);
    assert.match(
        stylesSource.slice(blockedBadgeIndex),
        /background: rgba\(100, 116, 139, 0\.9\);[\s\S]{0,180}font-size: 0\.65rem;/
    );
});
