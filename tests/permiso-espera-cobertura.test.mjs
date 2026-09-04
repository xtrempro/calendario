// Un P. Administrativo, un F. Legal o un F. Compensatorio aplicado DESDE EL
// CALENDARIO no viaja a la PWA del trabajador hasta que el supervisor resuelve
// la cobertura de al menos uno de los turnos comprometidos: le asigna un
// reemplazo o lo marca "no requiere cobertura". Entonces se libera el bloque
// completo (10 F. Legal se publican con UN turno resuelto).
//
// Se prueba el efecto real sobre la proyeccion -que es lo que lee el telefono-,
// no solo la decision. Ver js/leaveHold.js.
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

const { setJSON } = await import("../js/persistence.js");
const storage = await import("../js/storage.js");
const { aplicarAdministrativo, aplicarLegal } =
    await import("../js/leaveEngine.js");
const { saveReplacement, cancelReplacementById } =
    await import("../js/replacements.js");
const {
    getLeaveHolds,
    heldLeaveKeys,
    releaseLeaveHoldsForCoverage
} = await import("../js/leaveHold.js");
const { fetchHolidays, clearHolidaysCache } =
    await import("../js/holidays.js");
const { computeProfileSchedule } = await import("../js/serverEngine.js");

const PROFILE = "Ana";
const COVER = "Beto";
const TURNO_LARGA = 1;

function keyFromDate(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isoFromDate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

/**
 * Un lunes lo bastante adelante como para que el permiso siempre caiga en el
 * futuro, corra el ano que corra esta prueba. Si el bloque de 10 dias habiles
 * (14 corridos) se saliera del ano, se salta al primer lunes de enero: aplicar
 * un F. Legal exige que el bloque termine dentro del mismo ano.
 */
function futureMonday() {
    const cursor = new Date();

    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() + 45);

    while (cursor.getDay() !== 1) {
        cursor.setDate(cursor.getDate() + 1);
    }

    if (cursor.getMonth() === 11 && cursor.getDate() > 10) {
        const january = new Date(cursor.getFullYear() + 1, 0, 1);

        while (january.getDay() !== 1) {
            january.setDate(january.getDate() + 1);
        }

        return january;
    }

    return cursor;
}

function addDays(date, amount) {
    const next = new Date(date);

    next.setDate(next.getDate() + amount);

    return next;
}

function scheduleDay(iso) {
    const profile = storage.getProfiles().find(item => item.name === PROFILE);

    return computeProfileSchedule(profile, new Date()).days[iso];
}

const START = futureMonday();
const START_KEY = keyFromDate(START);
const START_ISO = isoFromDate(START);

beforeEach(async () => {
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
        },
        addEventListener() {}
    };
    globalThis.localStorage.clear();
    clearHolidaysCache();

    // Cache sembrada: evita el fetch de red y deja el bloque sin feriados.
    [START.getFullYear(), START.getFullYear() + 1].forEach(year => {
        setJSON(`holidaysCache_${year}`, { [`${year}-0-1`]: "Ano Nuevo" });
    });

    storage.saveProfiles([
        { id: "p1", name: PROFILE, estamento: "Profesional", activo: true },
        { id: "p2", name: COVER, estamento: "Profesional", activo: true }
    ]);
    storage.setCurrentProfile(PROFILE);
    // Turno largo base en las tres semanas del bloque: son los turnos que el
    // permiso deja comprometidos.
    storage.saveBaseProfileData(
        Object.fromEntries(
            Array.from({ length: 21 }, (_, index) => [
                keyFromDate(addDays(START, index)),
                TURNO_LARGA
            ])
        ),
        PROFILE
    );

    await fetchHolidays(START.getFullYear());
});

test("el P. Administrativo aplicado desde el calendario no llega a la PWA", async () => {
    const aplicado = await aplicarAdministrativo(START, 1, {
        holdUntilCovered: true
    });

    assert.equal(aplicado, true);
    assert.equal(storage.getAdminDays()[START_KEY], 1);
    assert.deepEqual([...heldLeaveKeys(PROFILE)], [START_KEY]);

    // El telefono ve su turno normal, no el permiso.
    const day = scheduleDay(START_ISO);

    assert.equal(day.hasLeave, false);
    assert.equal(day.className, "larga");
    assert.equal(day.displayLabel, "Larga");
    assert.equal(day.leaveCancelType, undefined);
});

test("asignar un reemplazo libera el permiso hacia la PWA", async () => {
    await aplicarAdministrativo(START, 1, { holdUntilCovered: true });

    saveReplacement({
        worker: COVER,
        replaced: PROFILE,
        keyDay: START_KEY,
        turno: TURNO_LARGA
    });

    assert.deepEqual(getLeaveHolds(PROFILE), {});

    const day = scheduleDay(START_ISO);

    assert.equal(day.hasLeave, true);
    assert.equal(day.className, "permiso");
    assert.equal(day.leaveCancelType, "admin");
});

test('"no requiere cobertura" tambien libera el permiso', async () => {
    await aplicarAdministrativo(START, 1, { holdUntilCovered: true });

    storage.setNoCoverageDay(PROFILE, START_KEY, true, "Turno sin demanda");
    releaseLeaveHoldsForCoverage(PROFILE);

    assert.deepEqual(getLeaveHolds(PROFILE), {});
    assert.equal(scheduleDay(START_ISO).hasLeave, true);
});

test("un bloque de 10 F. Legal se publica entero al cubrir UN turno", async () => {
    const aplicado = await aplicarLegal(START, 10, { holdUntilCovered: true });

    assert.equal(aplicado, true);

    const blockKeys = Object.keys(storage.getLegalDays());

    // El bloque para en cuanto suma el decimo habil: lunes a viernes, fin de
    // semana, lunes a viernes.
    assert.equal(blockKeys.length, 12, "10 habiles ocupan 12 dias corridos");
    assert.equal(heldLeaveKeys(PROFILE).size, blockKeys.length);
    assert.equal(scheduleDay(START_ISO).hasLeave, false);

    // Se cubre un turno del MEDIO del bloque: basta cualquiera.
    const covered = addDays(START, 8);

    saveReplacement({
        worker: COVER,
        replaced: PROFILE,
        keyDay: keyFromDate(covered),
        turno: TURNO_LARGA
    });

    assert.deepEqual(getLeaveHolds(PROFILE), {});
    assert.equal(heldLeaveKeys(PROFILE).size, 0);
    assert.equal(scheduleDay(START_ISO).hasLeave, true);
    assert.equal(
        scheduleDay(isoFromDate(addDays(START, 11))).hasLeave,
        true
    );
});

test("sin la opcion no hay espera: la aprobacion de una solicitud publica ya", async () => {
    // Es el camino de js/workerRequests.js: el trabajador pidio el permiso, asi
    // que esconderselo no tendria ningun sentido.
    const aplicado = await aplicarAdministrativo(START, 1);

    assert.equal(aplicado, true);
    assert.deepEqual(getLeaveHolds(PROFILE), {});
    assert.equal(scheduleDay(START_ISO).hasLeave, true);
});

test("un permiso que no compromete ningun turno viaja de inmediato", async () => {
    // Sin turnos base, el bloque cae entero sobre dias libres: no hay nada que
    // cubrir, asi que esperar dejaria el permiso escondido para siempre.
    // (Un P. Administrativo no puede llegar a este caso: exige turno Larga o
    // Noche. Un F. Legal si, porque arrasa el rango completo.)
    storage.saveBaseProfileData({}, PROFILE);

    const aplicado = await aplicarLegal(START, 10, { holdUntilCovered: true });

    assert.equal(aplicado, true);
    assert.notDeepEqual(getLeaveHolds(PROFILE), {}, "la anotacion se escribio");
    assert.equal(heldLeaveKeys(PROFILE).size, 0);
    assert.equal(scheduleDay(START_ISO).hasLeave, true);
});

test("un permiso que ya empezo deja de esperar aunque nadie lo cubriera", async () => {
    await aplicarAdministrativo(START, 1, { holdUntilCovered: true });

    assert.equal(heldLeaveKeys(PROFILE).size, 1);
    // Llegado el dia, esconderlo dejaria el calendario del trabajador mintiendo
    // sobre un turno que no trabajo.
    assert.equal(heldLeaveKeys(PROFILE, { today: START }).size, 0);
    assert.equal(heldLeaveKeys(PROFILE, { today: addDays(START, 5) }).size, 0);
});

test("liberar es definitivo: anular el reemplazo no vuelve a esconder el permiso", async () => {
    await aplicarAdministrativo(START, 1, { holdUntilCovered: true });

    const record = saveReplacement({
        worker: COVER,
        replaced: PROFILE,
        keyDay: START_KEY,
        turno: TURNO_LARGA
    });

    cancelReplacementById(record.id);

    assert.equal(heldLeaveKeys(PROFILE).size, 0);
    assert.equal(scheduleDay(START_ISO).hasLeave, true);
});

// ───────── El motor esta duplicado: la regla tiene que estar en las dos copias ─────────

const engineSrc = await readFile(
    new URL("../js/serverEngine.js", import.meta.url),
    "utf8"
);
const clientSrc = await readFile(
    new URL("../js/workerAppDataSync.js", import.meta.url),
    "utf8"
);

for (const [nombre, src] of [
    ["serverEngine.js (Cloud Function)", engineSrc],
    ["workerAppDataSync.js (cliente supervisor)", clientSrc]
]) {
    test(`${nombre}: quita de los mapas los permisos en espera`, () => {
        assert.match(src, /import \{ heldLeaveKeys \} from "\.\/leaveHold\.js";/);
        assert.match(src, /const held = heldLeaveKeys\(profileName\);/);
        assert.match(src, /admin: omitLeaveKeys\(maps\.admin, held\)/);
        assert.match(src, /legal: omitLeaveKeys\(maps\.legal, held\)/);
        assert.match(src, /comp: omitLeaveKeys\(maps\.comp, held\)/);
    });

    test(`${nombre}: el saldo de F. Legal tampoco delata el permiso en espera`, () => {
        assert.match(src, /const legal = profileLeaveMaps\(profileName\)\.legal;/);
    });
}

test("la Cloud Function recibe la cobertura y la espera al recalcular", () => {
    // Sin vaciar estas dos claves antes del `projectionRequest`, el servidor
    // calcularia con datos viejos. Ver la nota de vaciado-previo-a-la-proyeccion.
    const list = clientSrc.slice(
        clientSrc.indexOf("WORKER_APP_PROJECTION_PROFILE_STATE_PREFIXES"),
        clientSrc.indexOf("WORKER_APP_PROJECTION_GLOBAL_STATE_KEYS")
    );

    assert.match(list, /"noCoverage_"/);
    assert.match(list, /"leaveHold_"/);
});

test("el aviso del permiso se calla mientras esta en espera", () => {
    assert.match(
        clientSrc,
        /function shouldSilenceHeldLeaveCalendarEvent\(metadata, profileName\)/
    );
    assert.match(
        clientSrc,
        /if \(!shouldSilenceHeldLeaveCalendarEvent\(/
    );
});

test("la espera ya esta anotada cuando `admin_` avisa del cambio", async () => {
    // El aviso al trabajador se decide DENTRO del evento de persistencia de
    // `admin_`. Si la anotacion se escribiera despues, la notificacion saldria
    // igual y el permiso se delataria solo. Aqui se prueba ese orden.
    const listeners = new Map();

    globalThis.window = {
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            listeners.set(
                type,
                (listeners.get(type) || []).filter(item => item !== fn)
            );
        },
        dispatchEvent(event) {
            (listeners.get(event.type) || []).forEach(fn => fn(event));
            return true;
        }
    };

    const seen = [];

    globalThis.window.addEventListener("proturnos:persistenceChanged", event => {
        const keys = event?.detail?.keys || [];

        if (!keys.includes(`admin_${PROFILE}`)) return;

        seen.push([...heldLeaveKeys(PROFILE)]);
    });

    try {
        await aplicarAdministrativo(START, 1, { holdUntilCovered: true });
    } finally {
        delete globalThis.window;
    }

    assert.equal(seen.length, 1, "el evento de admin_ se emitio una vez");
    assert.deepEqual(seen[0], [START_KEY]);
});

test("leaveHold_ viaja con los permisos y sobrevive al renombre del perfil", async () => {
    const modulesSrc = await readFile(
        new URL("../js/firebaseStateModules.js", import.meta.url),
        "utf8"
    );
    const storageSrc = await readFile(
        new URL("../js/storage.js", import.meta.url),
        "utf8"
    );

    assert.match(modulesSrc, /\["leaveHold_", "turnos"\]/);
    assert.match(
        storageSrc.slice(storageSrc.indexOf("const keysToMove = [")),
        /"leaveHold_"/
    );
});

test("el calendario aplica el P. Administrativo en espera y abre las sugerencias", async () => {
    const mainSrc = await readFile(
        new URL("../js/main.js", import.meta.url),
        "utf8"
    );

    assert.match(
        mainSrc,
        /await aplicarAdministrativo\(fecha, cantidad, \{\s*\n\s*holdUntilCovered: true\s*\n\s*\}\)/
    );
    assert.match(
        mainSrc,
        /await openReplacementSuggestionsForLeaveBlock\(\s*\n\s*profile,\s*\n\s*leaveBlockKeys\(fecha, cantidad\)\s*\n\s*\)/
    );
    // Los otros dos tipos tambien esperan cobertura.
    assert.match(mainSrc, /aplicarLegal\(fecha, legalCantidad, \{/);
    assert.match(mainSrc, /aplicarComp\(fecha, compCantidad, \{/);
});
