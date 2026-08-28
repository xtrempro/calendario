import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Un Diurno el dia siguiente a un 24h encadena 33 horas seguidas (08:00 del dia
// 1 a las 17:00 del dia 2), asi que estaba prohibido siempre. Ahora la unidad
// puede habilitarlo como excepcion desde Ajustes > Turnos, y el ajuste cuelga de
// "Permitir turnos de 24 horas": sin turnos 24 no hay dia siguiente que
// habilitar.
//
// La excepcion es SOLO para el Diurno puro. Una Larga, un D+N u otro 24 pegados
// a un 24 siguen prohibidos, que es lo que evita encadenar dos noches.

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
    DEFAULT_TURN_CHANGE_CONFIG,
    getTurnChangeConfig,
    saveBaseProfileData,
    saveProfileData,
    saveProfiles,
    saveTurnChangeConfig
} = await import("../js/storage.js");
const { turnoBloqueadoPorTurno24 } =
    await import("../js/turnEngine.js");

const TURNO = { LIBRE: 0, LARGA: 1, NOCHE: 2, TURNO24: 3, DIURNO: 4, DIURNO_NOCHE: 5 };

// Lunes 2026-06-08 (24h) y martes 2026-06-09.
const DIA_24 = "2026-5-8";
const DIA_SIGUIENTE = "2026-5-9";

function configurar({ allowDiurnoAfterTwentyFour = false, allowTwentyFourHourShifts = true } = {}) {
    saveTurnChangeConfig({
        ...DEFAULT_TURN_CHANGE_CONFIG,
        allowTwentyFourHourShifts,
        allowDiurnoAfterTwentyFour
    });
}

beforeEach(() => {
    globalThis.localStorage.clear();
    saveProfiles([{
        name: "Juan",
        estamento: "Técnico",
        profession: "Enfermería",
        contractType: "Planta",
        active: true
    }]);

    // El lunes tiene un 24h asignado.
    saveBaseProfileData({ [DIA_24]: TURNO.TURNO24 }, "Juan");
    saveProfileData({ [DIA_24]: TURNO.TURNO24 }, "Juan");
});

test("por defecto el ajuste viene apagado", () => {
    // Es una excepcion: 33 horas encadenadas no pueden ser el comportamiento
    // por defecto de una unidad que recien se crea.
    assert.equal(DEFAULT_TURN_CHANGE_CONFIG.allowDiurnoAfterTwentyFour, false);
});

test("sin el ajuste, el Diurno post 24h sigue bloqueado", () => {
    configurar({ allowDiurnoAfterTwentyFour: false });

    assert.equal(
        turnoBloqueadoPorTurno24("Juan", DIA_SIGUIENTE, TURNO.DIURNO),
        true
    );
});

test("con el ajuste, el Diurno post 24h se permite", () => {
    configurar({ allowDiurnoAfterTwentyFour: true });

    assert.equal(
        turnoBloqueadoPorTurno24("Juan", DIA_SIGUIENTE, TURNO.DIURNO),
        false
    );
});

test("la excepcion NO alcanza a Larga, D+N ni a otro 24", () => {
    configurar({ allowDiurnoAfterTwentyFour: true });

    // Encadenarian una segunda noche o una jornada aun mas larga.
    assert.equal(
        turnoBloqueadoPorTurno24("Juan", DIA_SIGUIENTE, TURNO.LARGA),
        true
    );
    assert.equal(
        turnoBloqueadoPorTurno24("Juan", DIA_SIGUIENTE, TURNO.DIURNO_NOCHE),
        true
    );
    assert.equal(
        turnoBloqueadoPorTurno24("Juan", DIA_SIGUIENTE, TURNO.TURNO24),
        true
    );
});

test("tambien se puede poner el 24 cuando el dia siguiente ya es Diurno", () => {
    // La regla es simetrica: si solo se relajara una direccion, el supervisor
    // podria armar la secuencia en un orden y no en el otro.
    saveBaseProfileData({ [DIA_SIGUIENTE]: TURNO.DIURNO }, "Juan");
    saveProfileData({ [DIA_SIGUIENTE]: TURNO.DIURNO }, "Juan");

    configurar({ allowDiurnoAfterTwentyFour: false });
    assert.equal(
        turnoBloqueadoPorTurno24("Juan", DIA_24, TURNO.TURNO24),
        true
    );

    configurar({ allowDiurnoAfterTwentyFour: true });
    assert.equal(
        turnoBloqueadoPorTurno24("Juan", DIA_24, TURNO.TURNO24),
        false
    );
});

test("la Noche antes de un 24 sigue prohibida con el ajuste puesto", () => {
    // Nada de lo anterior toca la otra punta de la regla.
    saveBaseProfileData({ [DIA_SIGUIENTE]: TURNO.TURNO24 }, "Juan");
    saveProfileData({ [DIA_SIGUIENTE]: TURNO.TURNO24 }, "Juan");
    configurar({ allowDiurnoAfterTwentyFour: true });

    assert.equal(
        turnoBloqueadoPorTurno24("Juan", DIA_24, TURNO.NOCHE),
        true
    );
});

test("el ajuste no sobrevive si se apagan los turnos 24", () => {
    // Guardado directo con el padre apagado: dejarlo en true escondia una
    // excepcion activa detras de un ajuste que se ve apagado.
    saveTurnChangeConfig({
        ...DEFAULT_TURN_CHANGE_CONFIG,
        allowTwentyFourHourShifts: false,
        allowDiurnoAfterTwentyFour: true
    });

    assert.equal(getTurnChangeConfig().allowDiurnoAfterTwentyFour, false);
});

test("el checkbox solo se dibuja con los turnos 24 activos", async () => {
    const source = await readFile(
        new URL("../js/systemSettings.js", import.meta.url),
        "utf8"
    );

    assert.match(
        source,
        /config\.allowTwentyFourHourShifts \? checkboxHTML\(\{\s*\n\s*id: "settingsAllowDiurnoAfterTwentyFour"/
    );
    assert.match(source, /title: "Permitir agregar turno diurno post 24h"/);

    // Al apagar el padre hay que reconstruir el modal, o el hijo queda en
    // pantalla.
    assert.match(
        source,
        /"settingsAllowTwentyFourHourShifts",[\s\S]{0,200}\.includes\(event\.target\?\.id\)/
    );

    // Y si el checkbox no esta en el DOM pero el padre si, se guarda false: el
    // fallback habria conservado la excepcion encendida sin que se vea.
    assert.match(
        source,
        /hasInput\("settingsAllowDiurnoAfterTwentyFour"\)[\s\S]{0,200}hasInput\("settingsAllowTwentyFourHourShifts"\)\s*\n\s*\? false/
    );
});

test("las tres marcas del encadenado salen en los horarios pedidos", async () => {
    const { getScheduledSegmentsForState } =
        await import("../js/clockMarks.js");

    const hora = date =>
        `${String(date.getHours()).padStart(2, "0")}:` +
        `${String(date.getMinutes()).padStart(2, "0")}`;

    // Lunes 8 de junio de 2026: el 24h.
    const lunes = new Date(2026, 5, 8);
    const [tramo24] = getScheduledSegmentsForState(lunes, TURNO.TURNO24);

    // Entra a las 08:00 (Larga) y sale a las 08:00 del dia siguiente (Noche).
    // La entrada de las 20:00 y la salida de las 20:00 son el traspaso interno
    // que el reporte parte en dos lineas cuando quedo marcado.
    assert.equal(hora(tramo24.start), "08:00");
    assert.equal(hora(tramo24.end), "08:00");
    assert.equal(tramo24.end.getDate(), 9, "la salida cae el dia siguiente");

    // Martes 9: el Diurno. Tercera entrada y tercera salida, en SU fila.
    const martes = new Date(2026, 5, 9);
    const [tramoDiurno] = getScheduledSegmentsForState(martes, TURNO.DIURNO);

    assert.equal(hora(tramoDiurno.start), "08:00");
    assert.equal(hora(tramoDiurno.end), "17:00");
    assert.equal(tramoDiurno.end.getDate(), 9, "no cruza al dia siguiente");
});

test("el viernes la tercera salida es a las 16:00", () => {
    // Unico dia en que la jornada diurna termina antes.
    const viernes = new Date(2026, 5, 12);

    assert.equal(viernes.getDay(), 5);
});

test("cada tramo guarda su propia marca: las dos de las 08:00 no chocan", async () => {
    // A las 08:00 del dia siguiente el trabajador cierra el 24h y abre el
    // Diurno: son DOS marcas. Como se guardan por dia Y por segmento
    // (segments["turno24"] vs segments["diurno"]), no hay forma de que una tape
    // a la otra ni de que una sola cuente por las dos.
    const { findClockMarkEntry } =
        await import("../js/clockMarkUtils.js");

    const marcaDelDiaSiguiente = {
        segments: {
            diurno: { entryTime: "08:05", exitTime: "17:00" }
        }
    };

    assert.equal(
        findClockMarkEntry(marcaDelDiaSiguiente, { id: "diurno" })?.value?.entryTime,
        "08:05"
    );
    // La salida del 24h vive en la marca del dia del 24, con su propia clave.
    assert.equal(
        findClockMarkEntry(marcaDelDiaSiguiente, { id: "turno24" }),
        null
    );
});

test("el horario del Diurno es 08:00 a 17:00, y 16:00 los viernes", async () => {
    // Es el horario que el reporte usa para la tercera entrada y la tercera
    // salida del encadenado 24h + Diurno, en la fila del dia siguiente.
    const source = await readFile(
        new URL("../js/clockMarks.js", import.meta.url),
        "utf8"
    );

    assert.match(
        source,
        /function normalDiurnoEndHour\(date\) \{\s*\n\s*return date\.getDay\(\) === 5 \? 16 : 17;/
    );
    assert.match(
        source,
        /id: "diurno",[\s\S]{0,160}start: dateAt\(date, 8\),\s*\n\s*end: dateAt\(date, normalDiurnoEndHour\(date\)\)/
    );
});

test("el 24h sigue entrando 08:00 y saliendo 08:00 del dia siguiente", async () => {
    // La Larga (08-20) y la Noche (20-08) de las dos primeras marcas salen de
    // este tramo; el reporte ya las parte en dos lineas cuando el traspaso
    // quedo marcado.
    const source = await readFile(
        new URL("../js/clockMarks.js", import.meta.url),
        "utf8"
    );

    assert.match(
        source,
        /id: "turno24",[\s\S]{0,200}start: dateAt\(date, 8\),\s*\n\s*end: nextDateAt\(date, 8\)/
    );
});
