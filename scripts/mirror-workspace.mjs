// Copia PUNTUAL del estado de una unidad hacia un entorno espejo ya creado.
//
// El espejo sirve para MIRAR una unidad sin ser miembro de ella. Se crea desde
// la app con la cuenta que sera su dueña (asi el ownerUid lo pone Firebase y se
// respetan las reglas) y este script lo llena.
//
// Copia SOLO los stateModules: perfiles, calendario, horas, marcajes, cambios de
// turno, calendario semanal y tareas.
//
// NO copia nada que conecte con personas reales -workerLinks, workerAppData,
// invitaciones, mensajes, tokens push, solicitudes-. Si el espejo llevara los
// enlaces de PWA, publishLinkedWorkerDocs empezaria a publicar turnos y
// notificaciones a los telefonos de los trabajadores desde una SEGUNDA unidad:
// verian turnos duplicados y mensajes de un entorno que no conocen.
//
// Es una foto: no se mantiene al dia. Para refrescarlo hay que vaciar el espejo
// y volver a correrlo.
//
// Uso:
//   node scripts/mirror-workspace.mjs --target <workspaceId>            (simula)
//   node scripts/mirror-workspace.mjs --target <workspaceId> --apply    (escribe)
//
// Opcionales:
//   --source <workspaceId>   unidad de origen (por defecto, Imagenologia)
//   --project <projectId>    proyecto Firebase (por defecto, produccion)

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
const SOURCE = arg("--source") || "Boh7mvO5ku9quFFsPcIq";
const TARGET = arg("--target");
const APPLY = args.includes("--apply");

// Los modulos de estado que definen lo que se ve en la app (ver
// js/firebaseStateModules.js). "system" queda fuera: es configuracion del dueño.
const MODULES = [
    "profile",
    "turnos",
    "clockmarks",
    "swap",
    "hours",
    "weekly",
    "tasks"
];

// Colecciones deliberadamente excluidas, con el motivo.
const EXCLUDED = {
    workerLinks: "enlaces a las PWA de trabajadores reales",
    workerAppData: "datos publicados a las PWA",
    workerAppInvites: "invitaciones vivas a correos reales",
    workerPushTokens: "notificaciones a dispositivos reales",
    workerMessages: "conversaciones reales",
    workerPeerThreads: "conversaciones reales",
    workerMessageDirectory: "directorio de mensajeria",
    workerSwapCandidates: "candidatos publicados a las PWA",
    workerSwapRequests: "solicitudes vivas",
    workerRequests: "solicitudes vivas",
    workerNotifications: "notificaciones vivas",
    workerBlockedDays: "peticiones de trabajadores reales",
    supervisorInvites: "invitaciones de supervisor",
    rrhhSummaries: "resumenes publicados",
    calendarEvents: "eventos del entorno original"
};

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

async function api(pathOrUrl, options = {}) {
    const token = await accessToken();
    const url = pathOrUrl.startsWith("http")
        ? pathOrUrl
        : DOCUMENTS_ROOT + pathOrUrl;
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Goog-User-Project": PROJECT_ID,
            ...(options.headers || {})
        }
    });
    const text = await response.text();

    if (!response.ok) {
        throw new Error(`${response.status} ${url}\n${text.slice(0, 300)}`);
    }

    return text ? JSON.parse(text) : {};
}

function plainValue(value) {
    if (!value || typeof value !== "object") return value;
    if ("stringValue" in value) return value.stringValue;
    if ("booleanValue" in value) return value.booleanValue;
    if ("integerValue" in value) return Number(value.integerValue);
    return value;
}

async function listDocs(collectionPath, pageSize = 300) {
    const docs = [];
    let pageToken = "";

    do {
        const query =
            `?pageSize=${pageSize}${pageToken ? `&pageToken=${pageToken}` : ""}`;
        const result = await api(collectionPath + query);

        (result.documents || []).forEach((doc) => {
            const item = { id: doc.name.split("/").pop() };

            Object.entries(doc.fields || {}).forEach(([key, value]) => {
                item[key] = plainValue(value);
            });

            docs.push(item);
        });

        pageToken = result.nextPageToken || "";
    } while (pageToken);

    return docs;
}

const asString = (value) => ({ stringValue: String(value) });

async function main() {
    if (!TARGET) {
        console.error(
            "Falta --target <workspaceId> del entorno espejo (creado desde la app)."
        );
        process.exit(1);
    }

    if (TARGET === SOURCE) {
        console.error("El destino no puede ser el origen.");
        process.exit(1);
    }

    const target = await api(`/workspaces/${TARGET}`);
    const source = await api(`/workspaces/${SOURCE}`);

    console.log(`proyecto ${PROJECT_ID}`);
    console.log(`origen   ${SOURCE}  "${plainValue(source.fields?.name)}"`);
    console.log(
        `destino  ${TARGET}  "${plainValue(target.fields?.name)}"` +
        `  owner=${plainValue(target.fields?.ownerUid)}`
    );

    // Salvaguarda: no se sobreescribe un espejo que ya tiene datos. Para
    // refrescarlo hay que vaciarlo primero, a proposito.
    for (const moduleId of MODULES) {
        const existing = await listDocs(
            `/workspaces/${TARGET}/stateModules/${moduleId}/entries`
        );

        if (existing.length) {
            console.error(
                `\nABORTA: el destino ya tiene ${existing.length} entradas en ` +
                `"${moduleId}". Vacialo antes de volver a copiar.`
            );
            process.exit(1);
        }
    }

    console.log(APPLY ? "\n*** ESCRIBIENDO ***\n" : "\n(simulacion: no escribe)\n");

    const nowISO = new Date().toISOString();
    let copied = 0;
    let bytes = 0;
    let failed = 0;

    for (const moduleId of MODULES) {
        const entries = await listDocs(
            `/workspaces/${SOURCE}/stateModules/${moduleId}/entries`
        );
        let moduleCopied = 0;

        for (const entry of entries) {
            if (entry.deleted || typeof entry.value !== "string") continue;

            bytes += entry.value.length;
            moduleCopied++;

            if (!APPLY) continue;

            try {
                await api(
                    `/workspaces/${TARGET}/stateModules/${moduleId}` +
                    `/entries/${encodeURIComponent(entry.id)}`,
                    {
                        method: "PATCH",
                        body: JSON.stringify({
                            fields: {
                                storageKey: asString(entry.storageKey),
                                moduleId: asString(moduleId),
                                value: asString(entry.value),
                                updatedAtISO: asString(nowISO),
                                clientId: asString("mirror")
                            }
                        })
                    }
                );
            } catch (error) {
                failed++;
                console.error(
                    `  fallo ${moduleId}/${entry.id}: ${error.message.slice(0, 90)}`
                );
            }
        }

        copied += moduleCopied;
        console.log(`  ${moduleId.padEnd(11)} ${moduleCopied} de ${entries.length}`);
    }

    console.log(
        `\ncopiado: ${copied} documentos, ` +
        `${(bytes / 1024).toFixed(0)} KB, ${failed} fallos`
    );
    console.log("\nno se copia (a proposito):");
    Object.entries(EXCLUDED).forEach(([collection, reason]) => {
        console.log(`  ${collection.padEnd(24)} ${reason}`);
    });

    console.log(
        APPLY
            ? "\nLISTO. Entra con la cuenta dueña del espejo y selecciona ese entorno."
            : "\nSimulacion terminada. Agrega --apply para escribir."
    );
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
