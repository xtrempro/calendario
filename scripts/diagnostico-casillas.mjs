// SOLO LECTURA. Radiografia de las casillas de una semana.
//
// Responde: cuantas casillas tienen gente, cuantas solo traen nota o
// `removedDefaults`, y -lo importante- si sus taskId calzan con los del
// catalogo. Un taskId que no calza deja la casilla invisible: el tablero
// dibuja recorriendo el catalogo, no las casillas.
//
// Uso:
//   node scripts/diagnostico-casillas.mjs
//   node scripts/diagnostico-casillas.mjs --semana 2026-08-31

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function arg(name, fallback = "") {
    const index = process.argv.indexOf(name);

    return index !== -1 && process.argv[index + 1]
        ? process.argv[index + 1]
        : fallback;
}

const PROJECT_ID = arg("--project", "calendarioturnos-7c4d9");
const WORKSPACE_ID = arg("--workspace", "Boh7mvO5ku9quFFsPcIq");
const WEEK = arg("--semana", "2026-08-31");
const AT = arg("--instante", "");

const DOCUMENTS_ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)/documents";

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

async function api(url) {
    const token = await accessToken();
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Goog-User-Project": PROJECT_ID
        }
    });
    const text = await response.text();

    if (response.status === 404) return null;

    if (!response.ok) {
        throw new Error(`${response.status} ${url}\n${text.slice(0, 400)}`);
    }

    return text ? JSON.parse(text) : {};
}

function entryUrl(storageKey) {
    const url =
        `${DOCUMENTS_ROOT}/workspaces/${WORKSPACE_ID}` +
        `/stateModules/tasks/entries/${encodeURIComponent(storageKey)}`;

    return AT ? `${url}?readTime=${encodeURIComponent(AT)}` : url;
}

function parsedValue(doc) {
    const raw = doc?.fields?.value?.stringValue;

    if (typeof raw !== "string") return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function splitCellKey(value) {
    const [shift, taskId, keyDay] = String(value).split("|");

    return { shift, taskId, keyDay };
}

async function main() {
    console.log(`unidad   ${WORKSPACE_ID}`);
    console.log(`semana   ${WEEK}`);
    console.log(`instante ${AT || "en vivo"}\n`);

    const tasksDoc = await api(entryUrl("weekly_task_assignment_tasks"));
    const entriesDoc = await api(entryUrl("weekly_task_assignment_entries"));
    const tasks = parsedValue(tasksDoc);
    const all = parsedValue(entriesDoc);
    const week = all?.[WEEK];

    // Cuando se escribio cada documento por ultima vez. Si el de asignaciones
    // es viejo, la nube esta intacta y lo desactualizado es el navegador.
    console.log(`catalogo   updatedAt ${tasksDoc?.fields?.updatedAtISO?.stringValue || "?"}`);
    console.log(`asignacs.  updatedAt ${entriesDoc?.fields?.updatedAtISO?.stringValue || "?"}`);
    console.log(`asignacs.  deleted   ${entriesDoc?.fields?.deleted?.booleanValue}`);

    // Los DOS formatos. Si hay `items`, ahi vive el estado por elemento y el
    // `value` puede ser una foto vieja: leer solo `value` engaña.
    const itemFields = entriesDoc?.fields?.items?.mapValue?.fields || null;
    const deletedFields = entriesDoc?.fields?.deletedItems?.mapValue?.fields || null;

    console.log(`asignacs.  campos    ${Object.keys(entriesDoc?.fields || {}).join(", ")}`);
    console.log(`asignacs.  items     ${itemFields ? Object.keys(itemFields).length : "no tiene"}`);

    if (itemFields) {
        Object.keys(itemFields).sort().forEach(itemKey => {
            const text = itemFields[itemKey]?.stringValue;
            const isDeleted = deletedFields?.[itemKey]?.booleanValue === true;
            let cells = 0;
            let names = 0;

            try {
                const parsed = JSON.parse(String(text ?? "null"));

                Object.values(parsed || {}).forEach(entry => {
                    cells += 1;
                    names += (entry?.workers || []).filter(Boolean).length;
                });
            } catch {
                cells = -1;
            }

            console.log(
                `    ${itemKey.padEnd(14)} ${isDeleted ? "BORRADO" : "activo "} ` +
                `${String(cells).padStart(4)} casillas, ${String(names).padStart(4)} nombres`
            );
        });
    }

    console.log("");

    if (!Array.isArray(tasks)) throw new Error("Catalogo ilegible.");
    if (!week) throw new Error(`La semana ${WEEK} no existe en las asignaciones.`);

    const catalogIds = new Set(tasks.map(task => task.id));

    console.log(`catalogo: ${tasks.length} tareas`);
    console.log(`casillas guardadas en la semana: ${Object.keys(week).length}\n`);

    let withWorkers = 0;
    let workerTotal = 0;
    let onlyNote = 0;
    let onlyRemoved = 0;
    let empty = 0;
    const orphanIds = new Map();
    const shifts = {};

    Object.entries(week).forEach(([cellKey, entry]) => {
        const { shift, taskId } = splitCellKey(cellKey);
        const workers = Array.isArray(entry?.workers)
            ? entry.workers.filter(Boolean)
            : [];

        if (!catalogIds.has(taskId)) {
            orphanIds.set(taskId, (orphanIds.get(taskId) || 0) + workers.length);
        }

        if (workers.length) {
            withWorkers += 1;
            workerTotal += workers.length;
            shifts[shift] = (shifts[shift] || 0) + workers.length;
        } else if (String(entry?.note || "").trim()) {
            onlyNote += 1;
        } else if (Array.isArray(entry?.removedDefaults) && entry.removedDefaults.length) {
            onlyRemoved += 1;
        } else {
            empty += 1;
        }
    });

    console.log(`casillas CON gente:        ${withWorkers}  (${workerTotal} nombres)`);
    console.log(`  por turno: ${JSON.stringify(shifts)}`);
    console.log(`casillas solo con nota:    ${onlyNote}`);
    console.log(`casillas solo removedDef.: ${onlyRemoved}`);
    console.log(`casillas vacias:           ${empty}\n`);

    if (orphanIds.size) {
        console.log(`taskId que NO estan en el catalogo: ${orphanIds.size}`);
        [...orphanIds.entries()].forEach(([id, names]) => {
            console.log(`  ${id}  (${names} nombres atrapados)`);
        });
        console.log("");
    } else {
        console.log("Todos los taskId calzan con el catalogo.\n");
    }

    // Los dias reales guardados en esta semana. El tablero busca la casilla por
    // `shift|taskId|keyDay` con keyDay en formato `YYYY-M-D` y MES 0-BASED, asi
    // que un desfase aqui deja las casillas invisibles aunque existan.
    const byDay = new Map();

    Object.entries(week).forEach(([cellKey, entry]) => {
        const { keyDay } = splitCellKey(cellKey);
        const workers = Array.isArray(entry?.workers)
            ? entry.workers.filter(Boolean)
            : [];
        const current = byDay.get(keyDay) || { cells: 0, names: 0 };

        current.cells += 1;
        current.names += workers.length;
        byDay.set(keyDay, current);
    });

    console.log("dias guardados en esta semana (keyDay -> casillas/nombres):");
    [...byDay.entries()].sort().forEach(([keyDay, count]) => {
        const [year, month, day] = keyDay.split("-").map(Number);
        const date = new Date(year, month, day);
        const legible = Number.isNaN(date.getTime())
            ? "fecha invalida"
            : date.toISOString().slice(0, 10);

        console.log(
            `  ${keyDay.padEnd(12)} = ${legible}  ` +
            `${String(count.cells).padStart(3)} casillas, ${String(count.names).padStart(3)} nombres`
        );
    });
    console.log("");

    const sample = Object.entries(week)
        .filter(([, entry]) => (entry?.workers || []).length)
        .slice(0, 3);

    console.log("muestra de casillas con gente:");
    sample.forEach(([cellKey, entry]) => {
        console.log(`  ${cellKey}`);
        console.log(`     workers: ${JSON.stringify(entry.workers)}`);
        console.log(`     otros campos: ${Object.keys(entry).join(", ")}`);
    });
    console.log("");

    // Trabajadores predefinidos: la otra fuente de gente en el tablero.
    const withRules = tasks.filter(task =>
        Array.isArray(task.defaultWorkerRules) && task.defaultWorkerRules.length
    );

    console.log(`tareas con trabajador predefinido: ${withRules.length} de ${tasks.length}`);
    withRules.forEach(task => {
        const names = task.defaultWorkerRules.map(rule => rule.workerName);

        console.log(`  ${String(task.title).padEnd(22)} ${names.join(", ")}`);
    });
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
