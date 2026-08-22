// Repara UNA solicitud que quedo en "pending" pese a haberse aceptado.
//
// Lo causaba una carrera en la sincronizacion: la resolucion se guardaba local,
// la subida iba con 650 ms de retraso, y cualquier snapshot que llegara en esa
// ventana devolvia la lista completa al estado remoto -pendiente-. La subida
// siguiente cementaba la vuelta atras. Ya esta corregido en
// js/firebaseWorkerRequests.js (mergeRemoteRequests), pero las solicitudes que
// alcanzaron a revertirse quedaron mal en Firestore y hay que moverlas a mano.
//
// Solo toca los campos de estado; el resto del documento queda igual.
//
// Uso:
//   node scripts/reparar-solicitud-revertida.mjs --workspace <ws> --request <id>
//   node scripts/reparar-solicitud-revertida.mjs --workspace <ws> --request <id> --apply
//
// Sin --apply solo muestra en que estado esta. Este script deja de hacer falta
// una vez reparadas las solicitudes afectadas; se puede borrar.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const arg = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : "";
};

const PROJECT_ID = arg("--project") || "calendarioturnos-7c4d9";
const WORKSPACE = arg("--workspace");
const REQUEST = arg("--request");
const STATUS = arg("--status") || "accepted";
const APPLY = args.includes("--apply");

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

const asString = (value) => ({ stringValue: String(value) });
const plain = (field) => field?.stringValue ?? "";

async function main() {
    if (!WORKSPACE || !REQUEST) {
        console.error(
            "Faltan --workspace <workspaceId> y --request <requestId>."
        );
        process.exit(1);
    }

    const docPath =
        `/workspaces/${WORKSPACE}/workerRequests/${encodeURIComponent(REQUEST)}`;
    const before = await api(docPath);

    console.log(`proyecto  ${PROJECT_ID}`);
    console.log(`solicitud ${REQUEST}`);
    console.log(`  tipo    ${plain(before.fields?.type)}`);
    console.log(`  perfil  ${plain(before.fields?.profile)}`);
    console.log(`  estado  ${plain(before.fields?.status)}`);

    if (plain(before.fields?.status) !== "pending") {
        console.log("\nYa no esta pendiente: no hay nada que reparar.");
        return;
    }

    if (!APPLY) {
        console.log(`\n(simulacion) pasaria a "${STATUS}". Agrega --apply.`);
        return;
    }

    const now = new Date().toISOString();
    const fields = {
        status: asString(STATUS),
        updatedAt: asString(now)
    };

    if (STATUS === "accepted") {
        fields.acceptedAt = asString(now);
        fields.appliedAt = asString(now);
    } else {
        fields.rejectedAt = asString(now);
    }

    const mask = Object.keys(fields)
        .map(field => `updateMask.fieldPaths=${field}`)
        .join("&");

    await api(`${docPath}?${mask}`, {
        method: "PATCH",
        body: JSON.stringify({ fields })
    });

    const after = await api(docPath);

    console.log(`\nLISTO. estado ahora: ${plain(after.fields?.status)}`);
    console.log(
        "Nota: la fecha de aceptacion es la de esta reparacion, no la " +
        "original, que no quedo guardada en ninguna parte."
    );
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
