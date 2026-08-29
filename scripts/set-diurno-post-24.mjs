// Activa (o desactiva) "Permitir agregar turno diurno post 24h" en un entorno,
// escribiendo directo su `turnChangeConfig`.
//
// Existe porque ese ajuste solo se toca desde Ajustes > Turnos, y Ajustes es
// solo para el supervisor del entorno: un administrador colaborador no llega,
// aunque sea dueño de la plataforma.
//
// OJO: el flag depende de los turnos 24. Si el entorno los tiene apagados, el
// normalizador del cliente (`normalizeTurnChangeConfig`, js/storage.js) fuerza
// el flag a false al leer, asi que escribirlo solo no sirve de nada. El script
// avisa y no escribe en ese caso, salvo que se pase --habilitar-24.
//
// Uso:
//   node scripts/set-diurno-post-24.mjs --workspace <id>            (simula)
//   node scripts/set-diurno-post-24.mjs --workspace <id> --apply    (escribe)
//
// Opcionales:
//   --off              lo desactiva en vez de activarlo
//   --habilitar-24     enciende tambien "Permitir turnos de 24 horas"
//   --project <id>     proyecto Firebase (por defecto, produccion)

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
const WORKSPACE_ID = arg("--workspace");
const APPLY = args.includes("--apply");
const TURN_OFF = args.includes("--off");
const ENABLE_24 = args.includes("--habilitar-24");

if (!WORKSPACE_ID) {
    console.error("Falta --workspace <id>.");
    process.exit(1);
}

// Copia de DEFAULT_TURN_CHANGE_CONFIG (js/storage.js): un entorno que nunca
// guardo su configuracion arranca de aca.
const DEFAULTS = {
    allowSwaps: true,
    allowDifferentTurnTypes: true,
    allowTwentyFourHourShifts: true,
    allowInvertedTwentyFourHourShifts: true,
    allowDiurnoAfterTwentyFour: false,
    limitMonthlySwaps: false,
    monthlySwapLimit: 2
};

const DOCUMENTS_ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)/documents";
const CONFIG_PATH =
    `/workspaces/${WORKSPACE_ID}/stateModules/swap/entries/turnChangeConfig`;
const WORKSPACE_PATH = `/workspaces/${WORKSPACE_ID}`;

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
    const workspace = await api(WORKSPACE_PATH);

    if (!workspace) {
        throw new Error(`No existe el entorno ${WORKSPACE_ID}.`);
    }

    const workspaceName =
        workspace.fields?.name?.stringValue || "(sin nombre)";

    console.log(`Entorno: ${workspaceName}  [${WORKSPACE_ID}]`);
    console.log(`Proyecto: ${PROJECT_ID}\n`);

    const doc = await api(CONFIG_PATH);
    const raw = doc?.fields?.value?.stringValue
        ? JSON.parse(doc.fields.value.stringValue)
        : null;
    const current = { ...DEFAULTS, ...(raw || {}) };

    if (!raw) {
        console.log("  (el entorno no tenia configuracion propia guardada)");
    }

    const next = {
        ...current,
        allowDiurnoAfterTwentyFour: !TURN_OFF
    };

    if (ENABLE_24) next.allowTwentyFourHourShifts = true;

    // El cliente fuerza el flag a false si los turnos 24 estan apagados. Sin
    // este chequeo, el script diria "listo" y el ajuste no haria nada.
    if (next.allowDiurnoAfterTwentyFour && !next.allowTwentyFourHourShifts) {
        console.error(
            "Este entorno tiene los turnos de 24 horas DESACTIVADOS.\n" +
            "El ajuste depende de ellos: el cliente lo fuerza a false al leer,\n" +
            "asi que escribirlo solo no cambiaria nada.\n\n" +
            "Agrega --habilitar-24 si tambien quieres encender los turnos 24."
        );
        process.exit(1);
    }

    const before = current.allowDiurnoAfterTwentyFour === true;
    const after = next.allowDiurnoAfterTwentyFour === true;

    console.log("  Permitir turnos de 24 horas:          " +
        `${current.allowTwentyFourHourShifts !== false ? "si" : "NO"}` +
        `${ENABLE_24 && current.allowTwentyFourHourShifts === false ? " -> si" : ""}`);
    console.log("  Permitir turno diurno post 24h:       " +
        `${before ? "si" : "no"} -> ${after ? "si" : "no"}`);

    if (before === after && !ENABLE_24) {
        console.log("\nYa estaba asi. No hay nada que escribir.");
        return;
    }

    if (!APPLY) {
        console.log("\nSimulacion. Agrega --apply para escribir.");
        return;
    }

    await api(CONFIG_PATH, {
        method: "PATCH",
        body: JSON.stringify({
            fields: {
                storageKey: asString("turnChangeConfig"),
                moduleId: asString("swap"),
                value: asString(JSON.stringify(next)),
                updatedAtISO: asString(new Date().toISOString()),
                clientId: asString("script")
            }
        })
    });

    console.log("\nEscrito. Las sesiones abiertas lo reciben por onSnapshot.");
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
