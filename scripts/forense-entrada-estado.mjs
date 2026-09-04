// SOLO LECTURA. Vuelca TODOS los campos de una entrada de stateModule en uno o
// varios instantes, usando Point-in-Time Recovery.
//
// Es la herramienta para preguntarle a la nube "que habia aqui antes y quien lo
// escribio". Muestra los dos formatos de una entrada -el campo `value` con el
// JSON entero y el mapa `items` por elemento- porque discrepan mas seguido de
// lo que parece, y leer solo uno lleva a conclusiones falsas.
//
// Uso:
//   node scripts/forense-entrada-estado.mjs --clave weekly_task_assignment_tasks
//   node scripts/forense-entrada-estado.mjs --clave <k> --instantes 2026-09-03T16:50:00Z,2026-09-03T16:51:00Z

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
const MODULE_ID = arg("--modulo", "tasks");
const STORAGE_KEY = arg("--clave", "weekly_task_assignment_tasks");
const INSTANTS = arg("--instantes", "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

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
        throw new Error(`${response.status}\n${text.slice(0, 300)}`);
    }

    return text ? JSON.parse(text) : {};
}

function entryUrl(readTime = "") {
    const url =
        `${DOCUMENTS_ROOT}/workspaces/${WORKSPACE_ID}` +
        `/stateModules/${MODULE_ID}/entries/${encodeURIComponent(STORAGE_KEY)}`;

    return readTime ? `${url}?readTime=${encodeURIComponent(readTime)}` : url;
}

function summarize(raw) {
    if (typeof raw !== "string") return "(sin value)";

    try {
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) return `array de ${parsed.length}`;
        if (parsed && typeof parsed === "object") {
            return `objeto con ${Object.keys(parsed).length} claves`;
        }

        return `escalar ${JSON.stringify(parsed)}`;
    } catch {
        return `texto ilegible (${raw.length} chars)`;
    }
}

async function dump(readTime) {
    const doc = await api(entryUrl(readTime));

    console.log(`--- ${readTime || "EN VIVO"} ---`);

    if (!doc) {
        console.log("  documento inexistente\n");
        return;
    }

    const fields = doc.fields || {};

    console.log(`  updateTime   ${doc.updateTime || "?"}`);
    console.log(`  clientId     ${fields.clientId?.stringValue ?? "-"}`);
    console.log(`  deleted      ${fields.deleted?.booleanValue ?? "-"}`);
    console.log(`  updatedAtISO ${fields.updatedAtISO?.stringValue ?? "-"}`);
    console.log(`  value        ${summarize(fields.value?.stringValue)}`);

    const items = fields.items?.mapValue?.fields;
    const deletedItems = fields.deletedItems?.mapValue?.fields || {};

    if (!items) {
        console.log("  items        (no tiene)\n");
        return;
    }

    const keys = Object.keys(items).sort();
    const marked = keys.filter(
        key => deletedItems[key]?.booleanValue === true
    );

    console.log(`  items        ${keys.length} elementos, ${marked.length} marcados como borrados`);

    if (marked.length) console.log(`    borrados: ${marked.join(", ")}`);

    console.log("");
}

async function main() {
    console.log(`unidad ${WORKSPACE_ID}`);
    console.log(`clave  ${MODULE_ID}/${STORAGE_KEY}\n`);

    await dump("");

    for (const instant of INSTANTS) {
        await dump(instant);
    }
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
