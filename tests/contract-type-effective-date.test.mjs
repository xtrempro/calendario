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
const {
    getContractTypeAt,
    getGradeHourValue,
    getValorHora
} = await import("../js/storage.js");
const contracts = await import("../js/contracts.js");
const { getTurnoBase } = await import("../js/turnEngine.js");
const { TURNO } = await import("../js/constants.js");

const PROFILE = "Francisca";

function seedHonorariosToContrata() {
    localStorage.clear();
    setJSON("profiles", [
        {
            name: PROFILE,
            contractType: "Contrata",
            estamento: "Profesional",
            grade: "12"
        }
    ]);
    setJSON(`contractHistory_${PROFILE}`, [
        {
            id: "contract-change",
            createdAt: "2026-07-20T12:00:00.000Z",
            effectiveDate: "2026-08-01",
            summary: "Cambio de datos contractuales",
            changes: [
                {
                    field: "contractType",
                    label: "Tipo de contrato",
                    from: "Honorarios",
                    to: "Contrata",
                    effectiveDate: "2026-08-01"
                }
            ]
        }
    ]);
    setJSON(`honorariaContracts_${PROFILE}`, [
        {
            id: "honoraria-1",
            start: "2026-07-01",
            end: "2026-08-31",
            hourlyRate: 5000,
            maxWeeklyHours: 44
        }
    ]);
    setJSON(`rotativa_${PROFILE}`, {
        type: "diurno",
        start: "2026-08-01",
        firstTurn: "larga"
    });
    setJSON(`baseData_${PROFILE}`, {
        "2026-6-10": TURNO.DIURNO
    });
}

beforeEach(() => localStorage.clear());

test("el tipo de contrato efectivo cambia desde la fecha indicada", () => {
    seedHonorariosToContrata();

    assert.equal(
        getContractTypeAt(PROFILE, new Date(2026, 6, 10)),
        "Honorarios"
    );
    assert.equal(
        getContractTypeAt(PROFILE, new Date(2026, 7, 1)),
        "Contrata"
    );
});

test("honorarios solo aplica antes de la vigencia del nuevo contrato", () => {
    seedHonorariosToContrata();

    assert.equal(
        contracts.isHonorariaProfile(PROFILE, "2026-6-10"),
        true
    );
    assert.equal(
        contracts.getHonorariaContractForDate(PROFILE, "2026-6-10")
            ?.hourlyRate,
        5000
    );
    assert.equal(
        contracts.isHonorariaProfile(PROFILE, "2026-7-10"),
        false
    );
    assert.equal(
        contracts.getHonorariaContractForDate(PROFILE, "2026-7-10"),
        null
    );
});

test("las horas usan honorarios antes y grado contrata desde la vigencia", () => {
    seedHonorariosToContrata();

    assert.equal(getValorHora(PROFILE, new Date(2026, 6, 10)), 5000);
    assert.equal(
        getValorHora(PROFILE, new Date(2026, 7, 10)),
        getGradeHourValue("Profesional", "12")
    );
});

test("la rotativa base vuelve a calcularse cuando deja de ser honorarios", () => {
    seedHonorariosToContrata();

    assert.equal(getTurnoBase(PROFILE, "2026-6-10"), TURNO.DIURNO);
    assert.equal(getTurnoBase(PROFILE, "2026-7-10"), TURNO.DIURNO);
});

test("el guardado de perfil pide vigencia al cambiar tipo de contrato", async () => {
    const mainSource = await readFile(
        new URL("../js/main.js", import.meta.url),
        "utf8"
    );

    assert.match(mainSource, /hasContractTypeValueChanged/);
    assert.match(mainSource, /Vigencia del nuevo contrato/);
    assert.match(mainSource, /compensationValuesChanged/);
    assert.match(mainSource, /recordProfileContractHistory\([\s\S]*compensationEffectiveDate/);
});

test("la proyeccion PWA publica el tipo de contrato efectivo", async () => {
    const [workerAppSource, serverEngineSource] = await Promise.all([
        readFile(
            new URL("../js/workerAppDataSync.js", import.meta.url),
            "utf8"
        ),
        readFile(
            new URL("../js/serverEngine.js", import.meta.url),
            "utf8"
        )
    ]);

    assert.match(workerAppSource, /getCompensationProfileAt\(profile\.name, new Date\(\)\)/);
    assert.match(workerAppSource, /effectiveContractType/);
    assert.match(workerAppSource, /scheduledContractType/);
    assert.match(serverEngineSource, /getCompensationProfileAt\(profile\.name, today\)/);
    assert.match(serverEngineSource, /effectiveContractType/);
    assert.match(serverEngineSource, /scheduledContractType/);
});
