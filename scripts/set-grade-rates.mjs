// Actualiza valores hora por grado en TODOS los entornos.
//
// Escribe sobre el periodo de vigencia que rige HOY, conservando el resto de
// los grados y los demas periodos tal como estan. Un entorno que nunca guardo
// su tabla queda con los valores por defecto mas estos cambios.
//
// Uso:
//   node scripts/set-grade-rates.mjs            (simula: muestra antes -> despues)
//   node scripts/set-grade-rates.mjs --apply    (escribe)
//
// Opcionales:
//   --workspace <id>   un solo entorno, en vez de todos
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
const ONLY_WORKSPACE = arg("--workspace");
const APPLY = args.includes("--apply");

// Los valores a fijar. "professional" es el estamento Profesional; "general"
// agrupa Tecnicos, Administrativos y Auxiliares.
const RATES = {
    professional: {
        12: 8568,
        15: 6666.67
    },
    general: {
        16: 3889.5,
        22: 2791.2
    }
};

// Copia de DEFAULT_GRADE_HOUR_CONFIG (js/storage.js): un entorno que nunca
// guardo su tabla arranca de aca.
const DEFAULTS = {
    professional: {
        10: 9378.56, 11: 8605.85, 12: 7897.38,
        13: 7272.24, 14: 6663.65, 15: 6107.22
    },
    general: {
        12: 4420.99, 13: 4205.87, 14: 4002.53, 15: 3784.87,
        16: 3550.55, 17: 3392.09, 18: 3230.79, 19: 3085.6,
        20: 2902.88, 21: 2751.67, 22: 2550.45, 23: 2330.32,
        24: 2148.73
    }
};

const DOCUMENTS_ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)/documents";
const CONFIG_PATH = (workspaceId) =>
    `/workspaces/${workspaceId}/stateModules/hours/entries/gradeHourConfig`;

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

async function listWorkspaces() {
    const docs = [];
    let pageToken = "";

    do {
        const result = await api(
            `/workspaces?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`
        );

        (result?.documents || []).forEach((doc) => {
            docs.push({
                id: doc.name.split("/").pop(),
                name: doc.fields?.name?.stringValue || "(sin nombre)"
            });
        });

        pageToken = result?.nextPageToken || "";
    } while (pageToken);

    return docs;
}

const asString = (value) => ({ stringValue: String(value) });

function monthKey(date = new Date()) {
    return `${date.getFullYear()}-` +
        `${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Misma regla que js/storage.js: la tabla vieja sin fechas es un unico periodo
// abierto.
function normalizeConfig(raw) {
    const periods = Array.isArray(raw?.periods) && raw.periods.length
        ? raw.periods
        : [{
            from: "",
            to: "",
            professional: raw?.professional,
            general: raw?.general
        }];

    return {
        periods: periods.map((period) => ({
            ...period,
            from: String(period.from || ""),
            to: String(period.to || ""),
            professional: { ...DEFAULTS.professional, ...(period.professional || {}) },
            general: { ...DEFAULTS.general, ...(period.general || {}) }
        }))
    };
}

// El periodo que rige hoy. Si ninguno cubre el mes actual se toma el ultimo
// que empieza antes, igual que hace la app.
function currentPeriodIndex(periods) {
    const month = monthKey();
    const exact = periods.findIndex((period) =>
        (!period.from || period.from <= month) &&
        (!period.to || month <= period.to)
    );

    if (exact >= 0) return exact;

    let fallback = 0;

    periods.forEach((period, index) => {
        if (!period.from || period.from <= month) fallback = index;
    });

    return fallback;
}

async function main() {
    const workspaces = ONLY_WORKSPACE
        ? [{ id: ONLY_WORKSPACE, name: "(indicado)" }]
        : await listWorkspaces();

    console.log(`proyecto ${PROJECT_ID}`);
    console.log(`entornos ${workspaces.length}`);
    console.log(APPLY ? "\n*** ESCRIBIENDO ***\n" : "\n(simulacion)\n");

    let changed = 0;

    for (const workspace of workspaces) {
        const doc = await api(CONFIG_PATH(workspace.id));
        const raw = doc?.fields?.value?.stringValue
            ? JSON.parse(doc.fields.value.stringValue)
            : null;
        const config = normalizeConfig(raw);
        const index = currentPeriodIndex(config.periods);
        const period = config.periods[index];
        const cambios = [];

        Object.entries(RATES).forEach(([group, grades]) => {
            Object.entries(grades).forEach(([grade, value]) => {
                const before = Number(period[group][grade]);

                if (before === value) return;

                period[group][grade] = value;
                cambios.push(
                    `${group === "professional" ? "Prof" : "Tec"} ${grade}: ` +
                    `${before} -> ${value}`
                );
            });
        });

        const rango = period.from || period.to
            ? `${period.from || "inicio"}..${period.to || "vigente"}`
            : "sin fechas";

        // Tambien se reescribe si los valores ya estan pero falta la copia de
        // compatibilidad en la raiz.
        const faltaRaiz = Object.entries(RATES).some(([group, grades]) =>
            Object.entries(grades).some(([grade, value]) =>
                Number(raw?.[group]?.[grade]) !== value
            )
        );

        if (!cambios.length && !faltaRaiz) {
            console.log(`  ${workspace.name.padEnd(28)} sin cambios`);
            continue;
        }

        if (!cambios.length) cambios.push("solo copia de compatibilidad");

        changed++;
        console.log(
            `  ${workspace.name.padEnd(28)} [${rango}] ${cambios.join(" | ")}` +
            `${raw ? "" : "  (no tenia tabla propia)"}`
        );

        if (!APPLY) continue;

        // La tabla del periodo vigente va TAMBIEN en la raiz, con el formato
        // antiguo: una version del app que aun no conoce los periodos lee de
        // ahi, y sin eso caeria a los valores por defecto sin avisar.
        const compatible = {
            ...config,
            professional: { ...period.professional },
            general: { ...period.general }
        };

        await api(CONFIG_PATH(workspace.id), {
            method: "PATCH",
            body: JSON.stringify({
                fields: {
                    storageKey: asString("gradeHourConfig"),
                    moduleId: asString("hours"),
                    value: asString(JSON.stringify(compatible)),
                    updatedAtISO: asString(new Date().toISOString()),
                    clientId: asString("script")
                }
            })
        });
    }

    console.log(
        `\n${changed} entorno(s) ${APPLY ? "actualizados" : "cambiarian"}.`
    );

    if (!APPLY) console.log("Agrega --apply para escribir.");
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
