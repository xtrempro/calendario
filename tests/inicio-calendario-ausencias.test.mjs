// Calendario de ausencias del mes, desde el recuadro "Ausencias del día".
//
// El recuadro contesta por HOY. Este calendario contesta la otra pregunta que el
// supervisor se hace a diario: como viene el mes. Lo que fija este archivo es lo
// que hace util cada casilla: que ausencia hubo y si el turno que se perdio era
// de DIA o de NOCHE, que es lo que decide a quien hay que llamar para cubrir.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(k) { return this.values.has(k) ? this.values.get(k) : null; }
    key(i) { return [...this.values.keys()][i] ?? null; }
    removeItem(k) { this.values.delete(k); }
    setItem(k, v) { this.values.set(k, String(v)); }
}

const noopEl = {
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.alert = () => {};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { setJSON } = await import("../js/persistence.js");
const { buildAbsenceCalendarCells, absenceShiftLabel } =
    await import("../js/home.js");
const { TURNO } = await import("../js/constants.js");

const home = (await readFile(new URL("../js/home.js", import.meta.url), "utf8"))
    .replace(/\r\n/g, "\n");

// Septiembre 2026: el 1 cae martes.
const ANIO = 2026;
const MES = 8;
const DIA = 10;                    // jueves 10 de septiembre
const KEY = `${ANIO}-${MES}-${DIA}`;

// Turno base fijo por trabajador. La rotativa NO puede ser "libre": con ese tipo
// getTurnoBase devuelve 0 antes de mirar baseData, por diseño.
function sembrar(trabajadores) {
    localStorage.clear();
    setJSON("profiles", trabajadores.map(t => ({
        name: t.name,
        contractType: "Planta",
        estamento: "Profesional"
    })));

    trabajadores.forEach(t => {
        setJSON(`rotativa_${t.name}`, {
            type: "diurno",
            start: "2026-01-01",
            firstTurn: "larga"
        });
        setJSON(`baseData_${t.name}`, { [KEY]: t.turno });

        if (t.ausencia === "legal") setJSON(`legal_${t.name}`, { [KEY]: true });
        if (t.ausencia === "admin") setJSON(`admin_${t.name}`, { [KEY]: true });
        if (t.ausencia === "licencia") {
            setJSON(`absences_${t.name}`, { [KEY]: "Licencia Médica" });
        }
    });
}

function celdaDelDia() {
    return buildAbsenceCalendarCells(ANIO, MES)
        .find(cell => cell && cell.day === DIA);
}

beforeEach(() => localStorage.clear());

test("cada ausencia dice si el turno era de dia o de noche", () => {
    sembrar([
        { name: "Ana Dia", turno: TURNO.DIURNO, ausencia: "legal" },
        { name: "Boris Noche", turno: TURNO.NOCHE, ausencia: "legal" },
        { name: "Carla Larga", turno: TURNO.LARGA, ausencia: "admin" }
    ]);

    assert.deepEqual(
        celdaDelDia().items.map(item => [item.name, item.kind]),
        [
            ["Ana Dia", "dia"],
            ["Boris Noche", "noche"],
            // La Larga es jornada diurna extendida, no una noche.
            ["Carla Larga", "dia"]
        ]
    );
});

test("un 24h y un D+N cuentan como dia Y noche", () => {
    // Son los dos casos que una lista de turnos escrita a mano deja a medias:
    // ocupan las dos jornadas, asi que la ausencia descubre las dos.
    sembrar([
        { name: "Delia 24", turno: TURNO.TURNO24, ausencia: "legal" },
        { name: "Elena DN", turno: TURNO.DIURNO_NOCHE, ausencia: "legal" }
    ]);

    assert.deepEqual(
        celdaDelDia().items.map(item => item.kind),
        ["ambos", "ambos"]
    );
    assert.equal(absenceShiftLabel("ambos"), "Día y noche");
    assert.equal(absenceShiftLabel("dia"), "Día");
    assert.equal(absenceShiftLabel("noche"), "Noche");
});

test("cada ausencia trae su tipo, no solo el nombre", () => {
    sembrar([
        { name: "Ana Dia", turno: TURNO.DIURNO, ausencia: "legal" },
        { name: "Boris Noche", turno: TURNO.NOCHE, ausencia: "licencia" }
    ]);

    const items = celdaDelDia().items;

    assert.equal(items[0].categoryKey, "legal");
    assert.equal(items[1].categoryKey, "license");
    assert.ok(items[0].label, "la ausencia debe traer etiqueta");
});

test("los dias sin ausencias quedan vacios", () => {
    sembrar([{ name: "Ana Dia", turno: TURNO.DIURNO, ausencia: "legal" }]);

    const conAusencia = buildAbsenceCalendarCells(ANIO, MES)
        .filter(cell => cell && cell.items.length);

    assert.equal(conAusencia.length, 1);
    assert.equal(conAusencia[0].day, DIA);
});

test("el mes empieza en lunes y respeta su largo", () => {
    sembrar([]);

    const cells = buildAbsenceCalendarCells(ANIO, MES);
    const dias = cells.filter(Boolean);

    // Septiembre tiene 30 dias y el 1 cae martes: un hueco antes del dia 1.
    assert.equal(dias.length, 30);
    assert.equal(cells.length - dias.length, 1);
    assert.equal(cells[0], null);
    assert.equal(cells[1].day, 1);
});

test("un trabajador desactivado no aparece", () => {
    localStorage.clear();
    setJSON("profiles", [
        { name: "Ana Dia", contractType: "Planta", active: false }
    ]);
    setJSON("rotativa_Ana Dia", {
        type: "diurno",
        start: "2026-01-01",
        firstTurn: "larga"
    });
    setJSON("baseData_Ana Dia", { [KEY]: TURNO.DIURNO });
    setJSON("legal_Ana Dia", { [KEY]: true });

    assert.deepEqual(celdaDelDia().items, []);
});

/* ───────── Cableado ───────── */

test("el recuadro de ausencias abre el calendario con su icono", () => {
    assert.match(home, /data-hm="abscal-open"/);
    assert.match(
        home,
        /panelHead\(IC\.users, "Ausencias del día", calBtn\)/
    );
    assert.match(home, /data-hm="abscal-modal"/);
});

test("el mes se puede recorrer y cada dia abrirse", () => {
    assert.match(home, /data-hm="ac-prev"/);
    assert.match(home, /data-hm="ac-next"/);
    assert.match(home, /const next = new Date\(absCalYear, absCalMonth \+ step, 1\);/);
    assert.match(home, /data-hm="abscal-day"/);
    assert.match(home, /function openDayAbsences\(panel, iso\)/);
});

test("los mapas de ausencias se leen una vez por mes, no por dia", () => {
    // Recorrer 30 dias releyendo los cuatro mapas de cada perfil multiplica por
    // 30 el trabajo sin cambiar el resultado.
    assert.match(home, /function absenceMapsFor\(name\)/);
    assert.match(
        home,
        /const perfiles = getProfiles\(\)[\s\S]{0,220}maps: absenceMapsFor\(profile\.name\)/
    );
});
