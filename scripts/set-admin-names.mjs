// Carga los nombres visibles de los administradores de una unidad.
//
// El saludo del inicio mostraba la firma del supervisor a todos, asi que un
// colaborador invitado veia el nombre de otra persona. Ahora cada uno ve el
// nombre que el supervisor le asigno, guardado en el estado del entorno bajo
// "adminDisplayNames" e indexado por correo.
//
// Normalmente esto se hace desde Ajustes -> Usuarios. Este script existe para
// cargar de una vez los administradores que ya estaban invitados antes de que
// el campo existiera.
//
// Uso:
//   node scripts/set-admin-names.mjs --workspace <id>            (simula)
//   node scripts/set-admin-names.mjs --workspace <id> --apply    (escribe)

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
const APPLY = args.includes("--apply");

// Los nombres a cargar, por correo. Editar aca para agregar mas.
const NAMES = {
    "patricia.farias.b@gmail.com": "Patricia Farías",
    "elizabethdelpilar21@gmail.com": "Elizabeth del Pilar",
    "javiera.cornejoch@gmail.com": "Javiera Cornejo",
    "dpma1014@gmail.com": "Daniela Medina"
};

const DOCUMENTS_ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)/documents";
const STATE_PATH = (workspaceId) =>
    `/workspaces/${workspaceId}/stateModules/reports/entries/adminDisplayNames`;

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

    if (!response.ok && response.status !== 404) {
        throw new Error(`${response.status} ${pathname}\n${text.slice(0, 300)}`);
    }

    return response.ok && text ? JSON.parse(text) : null;
}

const asString = (value) => ({ stringValue: String(value) });

async function main() {
    if (!WORKSPACE) {
        console.error("Falta --workspace <workspaceId>.");
        process.exit(1);
    }

    const workspace = await api(`/workspaces/${WORKSPACE}`);

    console.log(`proyecto ${PROJECT_ID}`);
    console.log(
        `unidad   ${WORKSPACE}  "${workspace?.fields?.name?.stringValue || "?"}"\n`
    );

    // Se respeta lo que ya haya: esto agrega, no reemplaza.
    const existing = await api(STATE_PATH(WORKSPACE));
    const current = existing?.fields?.value?.stringValue
        ? JSON.parse(existing.fields.value.stringValue)
        : {};
    const merged = { ...current };

    Object.entries(NAMES).forEach(([email, name]) => {
        const key = email.trim().toLowerCase();
        const antes = current[key];

        merged[key] = name;
        console.log(
            `  ${key.padEnd(34)} ${antes ? `${antes} -> ` : ""}${name}`
        );
    });

    if (!APPLY) {
        console.log("\n(simulacion) Agrega --apply para escribir.");
        return;
    }

    await api(STATE_PATH(WORKSPACE), {
        method: "PATCH",
        body: JSON.stringify({
            fields: {
                storageKey: asString("adminDisplayNames"),
                moduleId: asString("reports"),
                value: asString(JSON.stringify(merged)),
                updatedAtISO: asString(new Date().toISOString()),
                clientId: asString("script")
            }
        })
    });

    console.log(`\nLISTO. ${Object.keys(merged).length} nombres guardados.`);
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
