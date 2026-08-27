// Un F. Legal aceptado quedaba en el LOG como aceptado y NUNCA aparecia en el
// calendario. Causa: la PWA copia workerLinks.profileName dentro de la
// solicitud, y ese nombre se queda con el valor viejo cuando el perfil se
// renombra (typo corregido, mayusculas). resolveProfileName devolvia ese texto
// tal cual, setCurrentProfile acepta cualquier cadena y el almacenamiento por
// trabajador se indexa por nombre ("legal_<NOMBRE>"), asi que el permiso se
// escribia en un perfil fantasma sin un solo error a la vista.
//
// Caso real: enlace [Luis Ainol Ramirez] contra el perfil
// [LUIS AINOL RAMIREZ]; quedaron vivas las claves legal_/blocked_ del fantasma.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(
    new URL("../js/workerRequests.js", import.meta.url),
    "utf8"
);

function grab(name) {
    let start = src.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `no se encontro ${name}`);
    if (src.slice(start - 6, start) === "async ") start -= 6;

    let paren = 0;
    let i = src.indexOf("(", start);

    for (; i < src.length; i += 1) {
        if (src[i] === "(") paren++;
        else if (src[i] === ")") {
            paren--;
            if (!paren) { i++; break; }
        }
    }

    let depth = 0;

    for (let j = src.indexOf("{", i); j < src.length; j += 1) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") {
            depth--;
            if (!depth) return src.slice(start, j + 1);
        }
    }

    throw new Error(`sin cierre: ${name}`);
}

const PROFILES = [
    { id: "p1", name: "LUIS AINOL RAMIREZ", rut: "17.855.987-7" },
    { id: "p2", name: "PALOMA IGNACIA ARMIJO JIMENEZ", rut: "19.405.315-0" },
    { id: "p3", name: "Ana Soto", rut: "" }
];

function build(profiles = PROFILES) {
    const env = {
        getProfiles: () => profiles,
        normalizeText: value => String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim()
            .toLowerCase()
    };
    const code = `
        ${grab("normalizeRut")}
        ${grab("resolveProfileName")}
        return resolveProfileName;
    `;

    return new Function(...Object.keys(env), code)(...Object.values(env));
}

test("el nombre exacto se devuelve tal cual", () => {
    const resolveProfileName = build();

    assert.equal(
        resolveProfileName({ profile: "Ana Soto" }),
        "Ana Soto"
    );
});

test("un nombre con otras mayusculas cae en el perfil real", () => {
    const resolveProfileName = build();

    assert.equal(
        resolveProfileName({
            profile: "Luis Ainol Ramirez",
            profileRut: "17.855.987-7"
        }),
        "LUIS AINOL RAMIREZ"
    );
});

test("el RUT manda cuando el nombre del enlace tiene un typo", () => {
    const resolveProfileName = build();

    // El enlace quedo con "JIMENZ"; el perfil se corrigio a "JIMENEZ".
    assert.equal(
        resolveProfileName({
            profile: "PALOMA IGNACIA ARMIJO JIMENZ",
            profileRut: "19.405.315-0"
        }),
        "PALOMA IGNACIA ARMIJO JIMENEZ"
    );
});

test("sin RUT, el nombre normalizado tolera tildes y espacios", () => {
    const resolveProfileName = build();

    assert.equal(
        resolveProfileName({ profile: "  ana sóto  " }),
        "Ana Soto"
    );
});

test("cae al profileId cuando no hay nombre ni RUT que calcen", () => {
    const resolveProfileName = build();

    assert.equal(
        resolveProfileName({ profile: "Nadie", profileId: "p3" }),
        "Ana Soto"
    );
});

test("devuelve vacio si el trabajador ya no existe: mejor fallar que escribir en un perfil fantasma", () => {
    const resolveProfileName = build();

    assert.equal(
        resolveProfileName({
            profile: "Trabajador Borrado",
            profileRut: "11.111.111-1"
        }),
        ""
    );
});
