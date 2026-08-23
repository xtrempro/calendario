// Crea (o actualiza) la alerta que avisa cuando App Check empieza a rechazar
// lecturas de Firestore.
//
// Por que hacia falta otra: ya existe "TurnoPlus - App Check invalido", pero esa
// vigila cloud_run_revision, o sea los callables de Functions. El incidente del
// 21 y 22 de agosto de 2026 fue en FIRESTORE, y esa alerta ni se entero. Son
// superficies distintas y se necesitan las dos.
//
// Uso:
//   node scripts/appcheck-alerta.mjs              muestra que haria
//   node scripts/appcheck-alerta.mjs --aplicar    lo aplica
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const ENTORNOS = {
    produccion: "calendarioturnos-7c4d9",
    test: "turnoplus-test-7c4d9"
};

const NOMBRE = "TurnoPlus - App Check rechaza lecturas de Firestore";

// El fondo normal son 12 a 38 rechazos POR HORA, y muchas horas van en cero.
// Durante el incidente hubo entre 3.200 y 4.700 cada cinco minutos. 500 queda
// muy por encima del ruido y muy por debajo de un episodio real.
const RECHAZOS_POR_VENTANA = 500;
const VENTANA_SEGUNDOS = 300;

// Que hacer cuando llegue el correo. Va DENTRO de la alerta a proposito: en el
// momento en que suena, nadie se acuerda de donde estaba escrito.
const INSTRUCTIVO = [
    "App Check esta rechazando lecturas de Firestore. Mientras dure, la PWA de",
    "los trabajadores muestra datos de cache y mensajes de \"no tienes permiso\",",
    "que describen mal la causa.",
    "",
    "1. Mira el detalle:  npm run appcheck:estado",
    "",
    "2. Decide con UN dato, si las verificaciones ACEPTADAS siguen normales:",
    "",
    "   - Siguen normales -> son uno o pocos telefonos. La PWA se recupera",
    "     sola (limpia la espera del SDK y reintenta). No hay que hacer nada.",
    "     Si alguien reclama, que revise fecha y hora automaticas en su equipo.",
    "",
    "   - Se cayeron a casi cero -> estan todos afectados. En la consola de",
    "     Firebase: App Check -> APIs -> Cloud Firestore -> dejar en NO",
    "     exigido. El servicio vuelve al instante. Devolverlo a exigido",
    "     cuando pase el episodio.",
    "",
    "Detalle completo en PROJECT_CONTEXT.md, seccion App Check."
].join("\n");

function argumento(nombre, porDefecto) {
    const encontrado = process.argv
        .slice(2)
        .find((valor) => valor.startsWith(`--${nombre}=`));

    return encontrado ? encontrado.split("=")[1] : porDefecto;
}

function firebaseToolsModule(relativePath) {
    const npmRoot = process.platform === "win32"
        ? path.join(process.env.APPDATA, "npm", "node_modules")
        : execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();

    return require(path.join(npmRoot, "firebase-tools", "lib", relativePath));
}

async function accessToken() {
    const auth = firebaseToolsModule("auth.js");
    const account =
        auth.getProjectDefaultAccount(process.cwd()) ||
        auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) {
        throw new Error("Ejecuta firebase login antes de configurar la alerta.");
    }

    const tokens = await auth.getAccessToken(account.tokens.refresh_token, []);

    return tokens.access_token;
}

async function api(projectId, ruta, opciones = {}) {
    const url = ruta.startsWith("https://")
        ? ruta
        : `https://monitoring.googleapis.com/v3/projects/${projectId}/${ruta}`;
    const respuesta = await fetch(url, {
        ...opciones,
        headers: {
            Authorization: `Bearer ${await accessToken()}`,
            "X-Goog-User-Project": projectId,
            "Content-Type": "application/json",
            ...(opciones.headers || {})
        }
    });
    const texto = await respuesta.text();
    const cuerpo = texto ? JSON.parse(texto) : {};

    if (!respuesta.ok) {
        throw new Error(
            `Monitoring respondio ${respuesta.status}: `
            + (cuerpo?.error?.message || texto.slice(0, 200))
        );
    }

    return cuerpo;
}

function politica(canales) {
    const filtro = [
        'metric.type="firebaseappcheck.googleapis.com/services/verification_count"',
        'resource.type="firebaseappcheck.googleapis.com/Service"',
        'metric.label.result="DENY"',
        'resource.label.service_id="firestore.googleapis.com"'
    ].join(" AND ");

    return {
        displayName: NOMBRE,
        combiner: "OR",
        enabled: true,
        notificationChannels: canales,
        documentation: {
            content: INSTRUCTIVO,
            mimeType: "text/markdown"
        },
        conditions: [
            {
                displayName: "Rechazos de App Check sobre Firestore",
                conditionThreshold: {
                    filter: filtro,
                    aggregations: [
                        {
                            alignmentPeriod: `${VENTANA_SEGUNDOS}s`,
                            perSeriesAligner: "ALIGN_SUM",
                            crossSeriesReducer: "REDUCE_SUM"
                        }
                    ],
                    comparison: "COMPARISON_GT",
                    thresholdValue: RECHAZOS_POR_VENTANA,
                    // Sostenido, para no avisar por un pico de un minuto.
                    duration: `${VENTANA_SEGUNDOS}s`
                }
            }
        ],
        alertStrategy: { autoClose: "86400s" }
    };
}

async function main() {
    const entorno = argumento("entorno", "produccion");
    const projectId = ENTORNOS[entorno];
    const aplicar = process.argv.includes("--aplicar");

    if (!projectId) {
        throw new Error(`Entorno desconocido: ${entorno}.`);
    }

    const canales = await api(projectId, "notificationChannels");
    const correos = (canales.notificationChannels || [])
        .filter((canal) => canal.type === "email" && canal.enabled !== false);

    if (!correos.length) {
        throw new Error(
            "El proyecto no tiene canal de correo en Cloud Monitoring. "
            + "Crealo en la consola (Monitoring -> Alerting -> Notification "
            + "channels) y vuelve a ejecutar."
        );
    }

    const existentes = await api(projectId, "alertPolicies");
    const previa = (existentes.alertPolicies || [])
        .find((p) => p.displayName === NOMBRE);

    const cuerpo = politica(correos.map((canal) => canal.name));

    console.log("");
    console.log(`Alerta: ${NOMBRE}`);
    console.log(`Proyecto: ${projectId}`);
    console.log(
        `Umbral: mas de ${RECHAZOS_POR_VENTANA} rechazos en `
        + `${VENTANA_SEGUNDOS / 60} min, sostenido`
    );
    console.log(`Avisa a: ${correos.map((c) => c.labels.email_address).join(", ")}`);
    console.log(`Accion: ${previa ? "actualizar la existente" : "crear nueva"}`);

    if (!aplicar) {
        console.log("");
        console.log("  (simulacion: agrega --aplicar para hacerlo de verdad)");
        console.log("");
        return;
    }

    const resultado = previa
        ? await api(
            projectId,
            `https://monitoring.googleapis.com/v3/${previa.name}`,
            { method: "PATCH", body: JSON.stringify(cuerpo) }
        )
        : await api(
            projectId,
            "alertPolicies",
            { method: "POST", body: JSON.stringify(cuerpo) }
        );

    console.log("");
    console.log(`  Listo: ${resultado.name}`);
    console.log("");
}

main().catch((error) => {
    console.error("");
    console.error(`  No se pudo configurar: ${error.message}`);
    console.error("");
    process.exitCode = 1;
});
