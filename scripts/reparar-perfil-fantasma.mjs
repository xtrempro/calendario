// Repara las solicitudes que se aplicaron sobre un PERFIL FANTASMA.
//
// La PWA copia workerLinks.profileName dentro de cada solicitud. Ese campo se
// queda con el nombre viejo cuando el perfil se renombra (typo o mayusculas
// corregidos despues de enlazar), porque proturnos:profileRenamed no tenia
// listener. Como el almacenamiento por trabajador se indexa por nombre
// ("legal_<NOMBRE>"), aceptar una solicitud con el nombre viejo escribia el
// permiso en un perfil que no existe: quedaba aceptada en el LOG y nunca
// aparecia en el calendario.
//
// Ya esta corregido en el codigo (resolveProfileName en js/workerRequests.js
// resuelve por RUT y nombre normalizado; syncWorkerLinkProfileName en
// js/workerAppDataSync.js mantiene el enlace al dia). Este script arregla lo
// que alcanzo a quedar mal en Firestore:
//
//   1. workerLinks.profileName  -> el nombre real del perfil
//   2. workerRequests.profile   -> el nombre real (asi re-aceptar es seguro
//                                  incluso con el build viejo desplegado)
//   3. los dias escritos en las claves fantasma se marcan como borrados
//   4. con --reabrir, las solicitudes mal aplicadas vuelven a "pending"
//
// El LOG NO se toca: es el registro historico de lo que de verdad paso.
//
// Uso:
//   node scripts/reparar-perfil-fantasma.mjs --workspace <ws>
//   node scripts/reparar-perfil-fantasma.mjs --workspace <ws> --apply
//   node scripts/reparar-perfil-fantasma.mjs --workspace <ws> --apply --reabrir
//
// Sin --apply solo muestra lo que haria. Cada escritura se relee para confirmar
// que quedo; el script termina con codigo 1 si alguna no aguanto.
//
// OJO con --reabrir: hay que correrlo con la app del supervisor CERRADA en todas
// las pestanas. mergeRemoteRequest (js/firebaseWorkerRequests.js) hace que una
// solicitud local ya resuelta le gane a un remoto "pending" y el navegador la
// vuelve a subir como estaba. Es una proteccion a proposito.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const arg = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : "";
};

const PROJECT_ID = arg("--project") || "calendarioturnos-7c4d9";
const WORKSPACE = arg("--workspace");
const APPLY = args.includes("--apply");
// Devolver a "pending" una solicitud ya aceptada EXIGE la app del supervisor
// cerrada; con ella abierta, mergeRemoteRequest la vuelve a subir como estaba.
const REOPEN = args.includes("--reabrir");

const DOCUMENTS_ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)/documents";

// Prefijos indexados por nombre de trabajador que puede haber escrito una
// solicitud aceptada sobre el perfil equivocado.
const GHOST_PREFIXES = [
    "legal_",
    "admin_",
    "comp_",
    "blocked_",
    "absences_",
    "data_",
    "noCoverage_",
    "leaveBalances_"
];

let cachedAccessToken = "";

function firebaseToolsModule(relativePath) {
    const npmRoot = process.platform === "win32"
        ? path.join(process.env.APPDATA, "npm", "node_modules")
        : execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();

    return require(path.join(npmRoot, "firebase-tools", "lib", relativePath));
}

async function accessToken() {
    if (cachedAccessToken) return cachedAccessToken;

    const auth = firebaseToolsModule("auth.js");
    const account =
        auth.getProjectDefaultAccount(process.cwd()) ||
        auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) {
        throw new Error("Ejecuta firebase login antes de continuar.");
    }

    const tokens = await auth.getAccessToken(account.tokens.refresh_token, []);
    cachedAccessToken = tokens.access_token;
    return cachedAccessToken;
}

async function api(pathname, options = {}) {
    const token = await accessToken();
    const response = await fetch(DOCUMENTS_ROOT + pathname, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Goog-User-Project": PROJECT_ID
        }
    });
    const text = await response.text();

    if (!response.ok) {
        throw new Error(`${response.status} ${pathname}\n${text.slice(0, 300)}`);
    }

    return text ? JSON.parse(text) : {};
}

// El pageToken se codifica: sin eso Firestore devuelve paginas que se solapan y
// la lista sale con documentos repetidos (y versiones viejas de un documento
// recien escrito, que es como se leyo mal una reparacion anterior).
async function listDocs(collectionPath) {
    const seen = new Map();
    let pageToken = "";

    for (;;) {
        const query =
            `?pageSize=300${
                pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""
            }`;
        const result = await api(collectionPath + query);

        (result.documents || []).forEach(doc => seen.set(doc.name, doc));

        if (!result.nextPageToken) break;
        pageToken = result.nextPageToken;
    }

    return [...seen.values()];
}

const plain = field => field?.stringValue ?? "";

// ID REAL del documento, sin decodificar. Las entradas de stateModules se
// guardan con la clave percent-encoded COMO ID (entryDocId en
// js/firebaseAppState.js), o sea que el id lleva "%20" literales.
const rawId = doc => doc.name.split("/").pop();

// Nombre legible, solo para mostrar.
const docId = doc => decodeURIComponent(rawId(doc));

// Segmento de URL que apunta al documento cuyo id es `rawId`. Va codificado
// OTRA VEZ: el REST decodifica el segmento antes de buscar el documento, asi que
// mandar el id tal cual apunta a "blocked_Luis Ainol Ramirez" (con espacios de
// verdad) y crea un documento nuevo en vez de tocar el que existe.
const pathSegment = doc => encodeURIComponent(rawId(doc));
// Rango de tildes combinantes (U+0300-U+036F) armado con new RegExp para que el
// archivo no dependa de caracteres invisibles.
const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
const normalizeText = value => String(value || "")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .trim()
    .toLowerCase();
const normalizeRut = value => String(value || "")
    .replace(/[^0-9kK]/g, "")
    .toUpperCase();

async function patch(pathname, fields) {
    const mask = Object.keys(fields)
        .map(field => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
        .join("&");

    await api(`${pathname}?${mask}`, {
        method: "PATCH",
        body: JSON.stringify({ fields })
    });
}

async function readProfiles() {
    const entries = await listDocs(
        `/workspaces/${WORKSPACE}/stateModules/profile/entries`
    );
    const doc = entries.find(entry => docId(entry) === "profiles");

    if (!doc) throw new Error("La unidad no tiene perfiles.");

    let json = doc.fields?.value?.stringValue;

    if (json === undefined) {
        const items = doc.fields.items.mapValue.fields;
        json = Object.keys(items)
            .sort((a, b) => Number(a) - Number(b))
            .map(key => items[key].stringValue)
            .join("");
    }

    return JSON.parse(json);
}

function resolveRealName(profiles, name, rut) {
    if (profiles.some(profile => profile.name === name)) return name;

    const wantedRut = normalizeRut(rut);

    if (wantedRut) {
        const byRut = profiles.find(profile =>
            normalizeRut(profile.rut) === wantedRut
        );

        if (byRut) return byRut.name;
    }

    const wantedName = normalizeText(name);

    return profiles.find(profile =>
        normalizeText(profile.name) === wantedName
    )?.name || "";
}

async function main() {
    if (!WORKSPACE) {
        console.error("Falta --workspace <workspaceId>.");
        process.exit(1);
    }

    const profiles = await readProfiles();
    const realNames = new Set(profiles.map(profile => profile.name));
    const plan = [];

    console.log(`proyecto  ${PROJECT_ID}`);
    console.log(`unidad    ${WORKSPACE}`);
    console.log(`perfiles  ${profiles.length}\n`);

    // 1. enlaces con el nombre viejo
    const links = await listDocs(`/workspaces/${WORKSPACE}/workerLinks`);

    links.forEach(link => {
        const name = plain(link.fields?.profileName);

        if (!name || realNames.has(name)) return;

        const real = resolveRealName(
            profiles,
            name,
            plain(link.fields?.profileRut)
        );

        if (!real) {
            console.log(`  OJO enlace [${name}] sin perfil que calce: se omite`);
            return;
        }

        plan.push({
            what: `enlace    [${name}] -> [${real}]`,
            path: `/workspaces/${WORKSPACE}/workerLinks/${pathSegment(link)}`,
            check: fields => plain(fields?.profileName) === real,
            fields: { profileName: { stringValue: real } }
        });
    });

    // 2. solicitudes con el nombre viejo, y las que se aplicaron al fantasma
    const requests = await listDocs(`/workspaces/${WORKSPACE}/workerRequests`);
    const ghostNames = new Set();

    requests.forEach(request => {
        const name = plain(request.fields?.profile);

        if (!name || realNames.has(name)) return;

        const real = resolveRealName(
            profiles,
            name,
            plain(request.fields?.profileRut)
        );

        if (!real) return;

        ghostNames.add(name);

        const id = docId(request);
        const status = plain(request.fields?.status);
        const fields = { profile: { stringValue: real } };
        const checks = [f => plain(f?.profile) === real];
        let what = `solicitud ${id} [${name}] -> [${real}] (${status})`;

        // Aceptada con el nombre viejo = aplicada sobre el fantasma. Volverla a
        // "pending" es la unica forma de que el motor la aplique completa
        // (saldo, memo, proyeccion), pero SOLO funciona con la app del
        // supervisor cerrada: mergeRemoteRequest (js/firebaseWorkerRequests.js)
        // decide que una solicitud local ya resuelta le gana a un remoto
        // "pending", y el navegador la vuelve a subir tal como estaba, nombre
        // viejo incluido. Es una proteccion a proposito, no un bug.
        if (status === "accepted" && REOPEN) {
            fields.status = { stringValue: "pending" };
            fields.acceptedAt = { nullValue: null };
            fields.appliedAt = { nullValue: null };
            fields.updatedAt = { stringValue: new Date().toISOString() };
            checks.push(f => plain(f?.status) === "pending");
            what += "  + VUELVE A PENDIENTE";
        } else if (status === "accepted") {
            what += "  (aceptada sobre el fantasma: ver --reabrir)";
        }

        plan.push({
            what,
            path: `/workspaces/${WORKSPACE}/workerRequests/${pathSegment(request)}`,
            check: f => checks.every(fn => fn(f)),
            fields
        });
    });

    // 3. dias escritos en claves fantasma -> marcados como borrados
    const turnos = await listDocs(
        `/workspaces/${WORKSPACE}/stateModules/turnos/entries`
    );

    turnos.forEach(entry => {
        const key = docId(entry);
        const fields = entry.fields || {};

        // Basura de una reparacion mal codificada: entradas sin storageKey ni
        // moduleId ni clientId. El cliente las ignora (readRemoteModuleEntries
        // corta con "if (!base.storageKey) return []"), pero no pintan nada.
        if (
            !plain(fields.storageKey) &&
            !plain(fields.moduleId) &&
            !plain(fields.clientId)
        ) {
            plan.push({
                what: `basura    [${key}] se elimina (entrada sin storageKey)`,
                method: "DELETE",
                path:
                    `/workspaces/${WORKSPACE}/stateModules/turnos/entries/` +
                    pathSegment(entry)
            });
            return;
        }

        const prefix = GHOST_PREFIXES.find(item => key.startsWith(item));

        if (!prefix) return;

        const name = key.slice(prefix.length);

        if (realNames.has(name) || !ghostNames.has(name)) return;

        const items = fields.items?.mapValue?.fields || {};
        const deleted = fields.deletedItems?.mapValue?.fields || {};
        const live = Object.keys(items).filter(itemKey =>
            deleted[itemKey]?.booleanValue !== true &&
            items[itemKey].stringValue !== "null"
        );

        if (!live.length) return;

        // Mismo formato con que la app borra un dia: items["<fecha>"] = "null"
        // y deletedItems["<fecha>"] = true, para que el snapshot lo saque
        // tambien del localStorage de quien tenga la unidad abierta.
        const nextItems = {};
        const nextDeleted = {};

        Object.keys(items).forEach(itemKey => {
            const isLive = live.includes(itemKey);

            nextItems[itemKey] = isLive
                ? { stringValue: "null" }
                : items[itemKey];
            nextDeleted[itemKey] = {
                booleanValue: isLive ||
                    deleted[itemKey]?.booleanValue === true
            };
        });

        plan.push({
            what: `fantasma  [${key}] borra ${JSON.stringify(
                live.map(decodeURIComponent)
            )}`,
            path:
                `/workspaces/${WORKSPACE}/stateModules/turnos/entries/` +
                pathSegment(entry),
            check: f => {
                const after = f?.items?.mapValue?.fields || {};
                return live.every(itemKey =>
                    after[itemKey]?.stringValue === "null"
                );
            },
            fields: {
                items: { mapValue: { fields: nextItems } },
                deletedItems: { mapValue: { fields: nextDeleted } },
                updatedAtISO: { stringValue: new Date().toISOString() }
            }
        });
    });

    if (!plan.length) {
        console.log("Nada que reparar.");
        return;
    }

    plan.forEach(step => console.log(`  ${step.what}`));

    if (!APPLY) {
        console.log(`\n(simulacion) ${plan.length} cambios. Agrega --apply.`);
        return;
    }

    // Cada cambio se RELEE. Sin esto una escritura puede "salir bien" y no haber
    // tocado el documento que se creia (id mal codificado), o revertirla el
    // navegador del supervisor un instante despues.
    const failed = [];

    for (const step of plan) {
        if (step.method === "DELETE") {
            await api(step.path, { method: "DELETE" });
            continue;
        }

        await patch(step.path, step.fields);

        const after = await api(step.path);

        if (step.check && !step.check(after.fields)) {
            failed.push(step.what);
        }
    }

    console.log(`\n${plan.length - failed.length} de ${plan.length} confirmados.`);

    if (failed.length) {
        console.log("\nNO quedaron aplicados:");
        failed.forEach(what => console.log(`  ${what}`));
        console.log(
            "\nSi son solicitudes, casi seguro las revirtio el navegador del\n" +
            "supervisor: cierra la app en TODAS las pestanas y vuelve a correr."
        );
        process.exitCode = 1;
        return;
    }

    console.log(
        "\nLas solicitudes que volvieron a PENDIENTE hay que aceptarlas de nuevo\n" +
        "desde el panel de solicitudes: ahi recien se descuenta el saldo y se\n" +
        "publica el permiso al calendario y a la PWA."
    );
}

main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
