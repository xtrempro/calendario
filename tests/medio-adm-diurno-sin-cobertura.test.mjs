// Un 1/2 ADM (Manana o Tarde) sobre una rotativa DIURNA no deja hueco que
// cubrir: el trabajador hace igual la otra mitad de su jornada. Por eso su
// casilla del calendario y su celda del timeline ya no muestran el "!" de
// pendiente de cobertura. En 3er/4to turno la mitad de la Larga si se cubre,
// asi que ahi el permiso sigue pidiendo reemplazo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { requiereReemplazoTurnoBase } from "../js/rulesEngine.js";
import { TURNO } from "../js/constants.js";

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const calendar = await read("../js/calendar.js");
const timeline = await read("../js/timeline.js");

const K = "2026-7-14";

function requiere({
    baseTurn = TURNO.LARGA,
    admin = {},
    legal = {},
    comp = {},
    absences = {},
    rotativa = ""
} = {}) {
    return requiereReemplazoTurnoBase(
        K,
        baseTurn,
        admin,
        legal,
        comp,
        absences,
        rotativa
    );
}

test("1/2 ADM manana o tarde en rotativa diurna: no pide cobertura", () => {
    assert.equal(
        requiere({
            baseTurn: TURNO.DIURNO,
            admin: { [K]: "0.5M" },
            rotativa: "diurno"
        }),
        false
    );
    assert.equal(
        requiere({
            baseTurn: TURNO.DIURNO,
            admin: { [K]: "0.5T" },
            rotativa: "diurno"
        }),
        false
    );
});

test("el 1/2 ADM antiguo (0.5, sin manana/tarde) tambien queda cubierto", () => {
    assert.equal(
        requiere({
            baseTurn: TURNO.DIURNO,
            admin: { [K]: 0.5 },
            rotativa: "diurno"
        }),
        false
    );
});

test("en 3er y 4to turno el 1/2 ADM sigue pidiendo cobertura", () => {
    assert.equal(
        requiere({ admin: { [K]: "0.5M" }, rotativa: "3turno" }),
        true
    );
    assert.equal(
        requiere({ admin: { [K]: "0.5T" }, rotativa: "3turno" }),
        true
    );
    assert.equal(
        requiere({ admin: { [K]: "0.5T" }, rotativa: "4turno" }),
        true
    );
});

test("sin rotativa configurada no cambia nada: el permiso sigue pidiendo cobertura", () => {
    assert.equal(requiere({ admin: { [K]: "0.5M" } }), true);
    assert.equal(
        requiere({ admin: { [K]: "0.5M" }, rotativa: "reemplazo" }),
        true
    );
    assert.equal(
        requiere({ admin: { [K]: "0.5M" }, rotativa: "libre" }),
        true
    );
});

test("la excepcion es SOLO del medio dia: el ADM completo se cubre igual", () => {
    assert.equal(
        requiere({
            baseTurn: TURNO.DIURNO,
            admin: { [K]: 1 },
            rotativa: "diurno"
        }),
        true
    );
});

test("red de seguridad: con otra ausencia encima el turno queda descubierto", () => {
    // La app no deja aplicar dos permisos al mismo turno (con el 1/2 ADM puesto
    // el dia sale bloqueado para un FL), asi que este caso no deberia existir.
    // Se cubre igual por datos antiguos o sincronizados: si conviven, el turno
    // si queda sin nadie y el "!" tiene que salir.
    const base = {
        baseTurn: TURNO.DIURNO,
        admin: { [K]: "0.5T" },
        rotativa: "diurno"
    };

    assert.equal(requiere({ ...base, legal: { [K]: 1 } }), true);
    assert.equal(requiere({ ...base, comp: { [K]: 1 } }), true);
    assert.equal(
        requiere({ ...base, absences: { [K]: "license" } }),
        true
    );
});

test("un dia libre por rotativa nunca pide cobertura", () => {
    assert.equal(
        requiere({
            baseTurn: TURNO.LIBRE,
            admin: { [K]: "0.5M" },
            rotativa: "3turno"
        }),
        false
    );
});

test("calendario y timeline le pasan la rotativa a la regla", () => {
    // Sin este argumento la regla no puede distinguir diurno de 3er/4to turno y
    // el "!" volveria a salir en las dos superficies.
    assert.match(calendar, /activeRotativa\.type/);
    assert.match(calendar, /getRotativa\(profileName\)\.type/);
    assert.match(timeline, /getRotativa\(nombre\)\.type/);
    assert.match(timeline, /const rotativaType = getRotativa\(profileName\)\.type/);
});
