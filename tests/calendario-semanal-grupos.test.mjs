// La letra del grupo del 4to turno en el Calendario Semanal.
//
// Detectarla mira hasta 92 dias de calendario POR TRABAJADOR. En una unidad de
// 60 personas eso son miles de consultas al motor de turnos, y la pantalla se
// repinta cada vez que se cambia de semana o se toca un chip: preguntarlo por
// celda la dejaria congelada.
//
// Por eso el mapa se calcula una vez y se guarda, y se tira cuando cambia algo
// que pueda mover a alguien de grupo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

const listeners = new Map();

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener(type, handler) {
        listeners.set(type, [...(listeners.get(type) || []), handler]);
    },
    removeEventListener() {},
    location: { hostname: "localhost" },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    visibilityState: "hidden", hidden: true,
    body: { dataset: {} }, documentElement: { dataset: {} },
    createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} } }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.alert = () => {};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    getShiftGroupMap,
    invalidateShiftGroupMap
} = await import("../js/shiftHolders.js");

const emitir = (type, detail) =>
    (listeners.get(type) || []).forEach(handler => handler({ detail }));

const HOY = new Date(2026, 8, 10);   // 10 de septiembre de 2026

function sembrar(workers) {
    localStorage.clear();
    invalidateShiftGroupMap();
    localStorage.setItem("profiles", JSON.stringify(
        workers.map(worker => ({
            id: worker.name,
            name: worker.name,
            estamento: worker.estamento || "Técnico",
            profession: worker.profession || "Técnico en Enfermería",
            active: worker.active !== false
        }))
    ));

    workers.forEach(worker => {
        localStorage.setItem(`rotativa_${worker.name}`, JSON.stringify({
            type: worker.type || "4turno",
            start: worker.start || "2026-01-05",
            firstTurn: worker.firstTurn || "larga"
        }));
    });
}

/* ======================================================================
   Que devuelve
   ====================================================================== */

test("cada trabajador de 4to turno trae su letra", () => {
    sembrar([
        { name: "Ana", start: "2026-01-05" },
        { name: "Beto", start: "2026-01-06" }
    ]);

    const map = getShiftGroupMap(HOY);

    assert.ok(["A", "B", "C", "D"].includes(map.get("Ana")));
    assert.ok(["A", "B", "C", "D"].includes(map.get("Beto")));
    // Un dia de desfase es otro grupo.
    assert.notEqual(map.get("Ana"), map.get("Beto"));
});

test("dos con la misma rotativa comparten letra", () => {
    sembrar([
        { name: "Ana", start: "2026-01-05" },
        { name: "Beto", start: "2026-01-05" }
    ]);

    const map = getShiftGroupMap(HOY);

    assert.equal(map.get("Ana"), map.get("Beto"));
});

test("quien no hace 4to turno no aparece", () => {
    // El diurno no tiene fases y el 3er turno tiene un ciclo de seis dias.
    sembrar([
        { name: "Ana", start: "2026-01-05" },
        { name: "Diurna", type: "diurno" },
        { name: "Tercera", type: "3turno" }
    ]);

    const map = getShiftGroupMap(HOY);

    assert.ok(map.has("Ana"));
    assert.equal(map.has("Diurna"), false);
    assert.equal(map.has("Tercera"), false);
});

test("los inactivos tampoco", () => {
    sembrar([
        { name: "Ana", start: "2026-01-05" },
        { name: "Retirado", start: "2026-01-05", active: false }
    ]);

    const map = getShiftGroupMap(HOY);

    assert.ok(map.has("Ana"));
    assert.equal(map.has("Retirado"), false);
});

/* ======================================================================
   Que no se recalcule de mas
   ====================================================================== */

test("dos llamadas seguidas devuelven el MISMO mapa", () => {
    // Es lo que evita que la pantalla se congele: la segunda no vuelve a
    // barrer 92 dias por trabajador.
    sembrar([{ name: "Ana", start: "2026-01-05" }]);

    assert.equal(getShiftGroupMap(HOY), getShiftGroupMap(HOY));
});

test("un cambio de rotativa lo tira", () => {
    sembrar([{ name: "Ana", start: "2026-01-05" }]);

    const antes = getShiftGroupMap(HOY);

    emitir("proturnos:persistenceChanged", { keys: ["rotativa_Ana"] });

    assert.notEqual(getShiftGroupMap(HOY), antes);
});

test("y tambien un cambio de calendario o de perfiles", () => {
    [
        "data_Ana",
        "baseData_Ana",
        "shift_Ana",
        "shiftAssignmentHistory_Ana",
        "profiles",
        "swaps",
        "shiftMoves"
    ].forEach(key => {
        sembrar([{ name: "Ana", start: "2026-01-05" }]);

        const antes = getShiftGroupMap(HOY);

        emitir("proturnos:persistenceChanged", { keys: [key] });
        assert.notEqual(getShiftGroupMap(HOY), antes, key);
    });
});

test("lo que no tiene nada que ver no lo tira", () => {
    // Rehacerlo es caro: no se hace por cualquier cosa.
    sembrar([{ name: "Ana", start: "2026-01-05" }]);

    const antes = getShiftGroupMap(HOY);

    ["memos", "auditLog", "agenda_contacts", "attendanceMarks"].forEach(key => {
        emitir("proturnos:persistenceChanged", { keys: [key] });
    });

    assert.equal(getShiftGroupMap(HOY), antes);
});

test("los cambios de otro supervisor tambien lo tiran", () => {
    sembrar([{ name: "Ana", start: "2026-01-05" }]);

    const antes = getShiftGroupMap(HOY);

    emitir("proturnos:firebaseAppState", {
        type: "app-state-entries-applied",
        keys: ["rotativa_Ana"]
    });

    assert.notEqual(getShiftGroupMap(HOY), antes);
});

test("otro dia se recalcula solo", () => {
    sembrar([{ name: "Ana", start: "2026-01-05" }]);

    const hoy = getShiftGroupMap(HOY);
    const manana = getShiftGroupMap(new Date(2026, 8, 11));

    assert.notEqual(hoy, manana);
    // Pero la letra no se mueve de un dia para otro: esta anclada.
    assert.equal(hoy.get("Ana"), manana.get("Ana"));
});

/* ======================================================================
   Que este cableado en el calendario
   ====================================================================== */

test("el calendario pide el mapa una vez, con la fecha de hoy", async () => {
    const source = (await readFile(
        new URL("../js/staffing.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    // Con la fecha de la celda serian siete calculos completos por semana.
    assert.match(source, /const groupByWorker = getShiftGroupMap\(currentDate\);/);
    assert.match(source, /group: groupByWorker\.get\(profile\.name\) \|\| ""/);
    assert.match(
        source,
        /import \{ getShiftGroupMap, getShiftGroupGaps \} from "\.\/shiftHolders\.js"/
    );
    // Y se pinta al lado del nombre.
    assert.match(source, /class="staffing-weekly-group"/);
});

test("la tarjeta es una fila, no una columna", async () => {
    // Apilada, la letra y las marcas se leerian como parte del cargo.
    const css = (await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.match(
        css,
        /\.staffing-weekly-person \{[\s\S]{0,160}display: flex;/
    );
    assert.ok(css.includes(".staffing-weekly-group {"));
    // El aviso de reemplazo ya no se coloca por rejilla.
    assert.doesNotMatch(
        css,
        /\.staffing-weekly-replacement-alert \{[\s\S]{0,200}grid-column: 2;/
    );
});
