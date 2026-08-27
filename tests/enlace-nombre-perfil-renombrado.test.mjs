// Al renombrar un perfil, workerLinks/{uid}.profileName se quedaba con el nombre
// viejo para siempre: proturnos:profileRenamed no tenia ni un listener. La PWA
// pisa su espejo con ese documento canonico y copia el profileName dentro de
// cada solicitud, asi que el permiso aceptado terminaba escrito en un perfil que
// no existe (el almacenamiento por trabajador se indexa por nombre).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(
    new URL("../js/workerAppDataSync.js", import.meta.url),
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

const normalizeText = value => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

function build({ links, profiles, workspace = { id: "WS1" } }) {
    const written = [];
    const env = {
        workerLinks: links,
        normalizeText,
        getActiveWorkspace: () => workspace,
        // El perfil ya esta guardado con el nombre nuevo cuando llega el evento.
        getWorkerAppLinkForProfile: name => {
            const profile = profiles.find(item => item.name === name);

            if (!profile) return null;

            return links.find(link => {
                if (profile.rut && link.profileRut) {
                    return link.profileRut.replace(/[^0-9kK]/g, "") ===
                        profile.rut.replace(/[^0-9kK]/g, "");
                }

                return normalizeText(link.profileName) ===
                    normalizeText(profile.name);
            }) || null;
        },
        getFirebaseServices: async () => ({
            db: {},
            firestoreModule: {
                doc: (_db, ...path) => ({ path: path.join("/") }),
                serverTimestamp: () => "TS",
                setDoc: async (ref, data, options) => {
                    written.push({ path: ref.path, data, options });
                }
            }
        })
    };
    const code = `
        ${grab("findWorkerLinkForRename")}
        ${grab("syncWorkerLinkProfileName")}
        return syncWorkerLinkProfileName;
    `;
    const sync = new Function(...Object.keys(env), code)(...Object.values(env));

    return { sync, written };
}

const LINK = {
    uid: "UID1",
    profileName: "Luis Ainol Ramirez",
    profileRut: "17.855.987-7"
};

test("corregir las mayusculas del perfil actualiza el enlace", async () => {
    const { sync, written } = build({
        links: [LINK],
        profiles: [{ name: "LUIS AINOL RAMIREZ", rut: "17.855.987-7" }]
    });

    assert.equal(
        await sync("Luis Ainol Ramirez", "LUIS AINOL RAMIREZ"),
        true
    );
    assert.equal(written.length, 1);
    assert.equal(written[0].path, "workspaces/WS1/workerLinks/UID1");
    assert.equal(written[0].data.profileName, "LUIS AINOL RAMIREZ");
    // Las reglas exigen que el uid siga presente en el documento resultante.
    assert.equal(written[0].data.uid, "UID1");
    assert.deepEqual(written[0].options, { merge: true });
});

test("un cambio de nombre grande se ubica por RUT", async () => {
    const { sync, written } = build({
        links: [{
            uid: "UID2",
            profileName: "REINALDO ANDRES ORELLANA REYES",
            profileRut: "17.816.361-2"
        }],
        profiles: [{
            name: "REINALDO ANDRES REYES ORELLANA",
            rut: "17.816.361-2"
        }]
    });

    assert.equal(
        await sync(
            "REINALDO ANDRES ORELLANA REYES",
            "REINALDO ANDRES REYES ORELLANA"
        ),
        true
    );
    assert.equal(written[0].data.profileName, "REINALDO ANDRES REYES ORELLANA");
});

test("sin RUT, el nombre viejo del enlace lo ubica igual", async () => {
    const { sync, written } = build({
        links: [{ uid: "UID3", profileName: "Ana Soto", profileRut: "" }],
        profiles: [{ name: "Ana Soto Vera", rut: "" }]
    });

    assert.equal(await sync("Ana Soto", "Ana Soto Vera"), true);
    assert.equal(written[0].data.profileName, "Ana Soto Vera");
});

test("no escribe si el trabajador no tiene la app enlazada", async () => {
    const { sync, written } = build({
        links: [],
        profiles: [{ name: "Nuevo Nombre", rut: "1-9" }]
    });

    assert.equal(await sync("Viejo Nombre", "Nuevo Nombre"), false);
    assert.equal(written.length, 0);
});

test("no escribe si el enlace ya tiene el nombre correcto", async () => {
    const { sync, written } = build({
        links: [{ uid: "UID4", profileName: "Ana Soto", profileRut: "1-9" }],
        profiles: [{ name: "Ana Soto", rut: "1-9" }]
    });

    assert.equal(await sync("ana soto", "Ana Soto"), false);
    assert.equal(written.length, 0);
});

test("un renombre sin cambio real no gasta una escritura", async () => {
    const { sync, written } = build({
        links: [LINK],
        profiles: [{ name: "LUIS AINOL RAMIREZ", rut: "17.855.987-7" }]
    });

    assert.equal(await sync("Ana", " Ana "), false);
    assert.equal(await sync("Ana", ""), false);
    assert.equal(written.length, 0);
});

test("el listener del renombre esta cableado", () => {
    assert.match(
        src,
        /addEventListener\(\s*"proturnos:profileRenamed"/,
        "proturnos:profileRenamed volvio a quedarse sin listener"
    );
});
