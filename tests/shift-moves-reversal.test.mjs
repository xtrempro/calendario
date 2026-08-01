import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { TURNO } from "../js/constants.js";

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
    getShiftMoveMarkers,
    getShiftMoves,
    registerShiftMove
} = await import("../js/shiftMoves.js");

const PROFILE = "Ana Rojas";
const SOURCE = "2026-6-10";
const TARGET = "2026-6-12";

beforeEach(() => {
    globalThis.localStorage.clear();
});

test("el movimiento inverso vuelve el turno a base y elimina TTMM", () => {
    const first = registerShiftMove({
        profile: PROFILE,
        sourceKey: SOURCE,
        targetKey: TARGET,
        sourceTurn: TURNO.LARGA,
        destinationTurn: TURNO.LARGA
    });

    assert.ok(first);
    assert.equal(getShiftMoveMarkers(PROFILE, SOURCE).length, 1);
    assert.equal(getShiftMoveMarkers(PROFILE, TARGET).length, 1);

    const reverse = registerShiftMove({
        profile: PROFILE,
        sourceKey: TARGET,
        targetKey: SOURCE,
        sourceTurn: TURNO.LARGA,
        destinationTurn: TURNO.LARGA
    });

    assert.equal(reverse, null);
    assert.deepEqual(getShiftMoves(), []);
    assert.deepEqual(getShiftMoveMarkers(PROFILE, SOURCE), []);
    assert.deepEqual(getShiftMoveMarkers(PROFILE, TARGET), []);
});

test("un cambio de horario que vuelve al horario original no conserva TTMM", () => {
    registerShiftMove({
        profile: PROFILE,
        sourceKey: SOURCE,
        targetKey: SOURCE,
        sourceTurn: TURNO.LARGA,
        destinationTurn: TURNO.NOCHE
    });

    assert.equal(getShiftMoveMarkers(PROFILE, SOURCE).length, 1);

    registerShiftMove({
        profile: PROFILE,
        sourceKey: SOURCE,
        targetKey: SOURCE,
        sourceTurn: TURNO.NOCHE,
        destinationTurn: TURNO.LARGA
    });

    assert.deepEqual(getShiftMoves(), []);
    assert.deepEqual(getShiftMoveMarkers(PROFILE, SOURCE), []);
});

test("no compacta movimientos inversos si el primero formo un 24", () => {
    registerShiftMove({
        profile: PROFILE,
        sourceKey: SOURCE,
        targetKey: TARGET,
        sourceTurn: TURNO.LARGA,
        destinationTurn: TURNO.LARGA,
        combinedInto24: true
    });

    registerShiftMove({
        profile: PROFILE,
        sourceKey: TARGET,
        targetKey: SOURCE,
        sourceTurn: TURNO.LARGA,
        destinationTurn: TURNO.LARGA
    });

    assert.equal(getShiftMoves().length, 2);
});
