// Estado en vivo de App Check: cuantas verificaciones se aceptaron y cuantas se
// rechazaron, hora por hora.
//
// Existe por el incidente del 21 y 22 de agosto de 2026: la PWA quedo sin datos
// durante horas porque App Check no consiguio token y Firestore, que lo exige,
// rechazo TODAS las lecturas. Los mensajes en pantalla decian "no tienes
// permiso", que describe mal la causa. Esta es la fuente que si lo dice.
//
// Uso:
//   npm run appcheck:estado              produccion, ultimas 24 h
//   npm run appcheck:estado -- --horas=96
//   npm run appcheck:estado -- --entorno=test
//
// Complementa a verify-live-app-check.mjs, que revisa la CONFIGURACION (clave
// del sitio, dominios, umbrales). Este mira lo que esta pasando ahora.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const ENTORNOS = {
    produccion: "calendarioturnos-7c4d9",
    test: "turnoplus-test-7c4d9"
};

// Por debajo de esto los rechazos son ruido de fondo normal (clientes sueltos,
// rastreadores). El incidente pasaba de 38.000 por hora.
export const RECHAZOS_NORMALES_POR_HORA = 200;

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
        throw new Error("Ejecuta firebase login antes de consultar App Check.");
    }

    const tokens = await auth.getAccessToken(account.tokens.refresh_token, []);

    return tokens.access_token;
}

async function serieDeVerificaciones(projectId, horas) {
    const fin = new Date();
    const inicio = new Date(fin.getTime() - horas * 3600 * 1000);
    const metrica =
        "firebaseappcheck.googleapis.com/services/verification_count";
    const filtro = `metric.type="${metrica}"`;
    const url =
        `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`
        + `?filter=${encodeURIComponent(filtro)}`
        + `&interval.startTime=${inicio.toISOString()}`
        + `&interval.endTime=${fin.toISOString()}`
        + "&aggregation.alignmentPeriod=3600s"
        + "&aggregation.perSeriesAligner=ALIGN_SUM";

    const respuesta = await fetch(url, {
        headers: {
            Authorization: `Bearer ${await accessToken()}`,
            "X-Goog-User-Project": projectId
        }
    });
    const cuerpo = await respuesta.json();

    if (!respuesta.ok) {
        throw new Error(
            `Monitoring respondio ${respuesta.status}: `
            + (cuerpo?.error?.message || "sin detalle")
        );
    }

    return cuerpo.timeSeries || [];
}

// Solo interesa Firestore: es el servicio que exige App Check y el que dejo la
// app sin datos. Storage y el resto se ignoran para no ensuciar la lectura.
export function porHora(series) {
    const horas = new Map();

    for (const serie of series) {
        if (serie.resource?.labels?.service_id !== "firestore.googleapis.com") {
            continue;
        }

        const aceptada = serie.metric?.labels?.result === "ALLOW";

        for (const punto of serie.points || []) {
            const cantidad = Number(punto.value?.int64Value || 0);
            if (!cantidad) continue;

            const clave = punto.interval.endTime;
            const fila = horas.get(clave) || { aceptadas: 0, rechazadas: 0 };

            if (aceptada) fila.aceptadas += cantidad;
            else fila.rechazadas += cantidad;

            horas.set(clave, fila);
        }
    }

    return [...horas.entries()]
        .map(([iso, fila]) => ({ momento: new Date(iso), ...fila }))
        .sort((a, b) => a.momento - b.momento);
}

function mediana(valores) {
    if (!valores.length) return 0;

    const orden = [...valores].sort((a, b) => a - b);

    return orden[Math.floor(orden.length / 2)];
}

export function veredicto(filas) {
    const recientes = filas.slice(-3);
    const rechazos = recientes.reduce((total, f) => total + f.rechazadas, 0);
    const aceptadas = recientes.reduce((total, f) => total + f.aceptadas, 0);

    if (rechazos <= RECHAZOS_NORMALES_POR_HORA * recientes.length) {
        return {
            titulo: "SIN NOVEDAD",
            detalle: "Los rechazos estan en el ruido de fondo habitual."
        };
    }

    // La pregunta que decide que hacer: el resto de los telefonos, funciona?
    const habitual = mediana(filas.map((f) => f.aceptadas).filter(Boolean));
    const aceptadasPorHora = aceptadas / Math.max(recientes.length, 1);

    if (aceptadasPorHora > habitual * 0.1) {
        return {
            titulo: "RECHAZOS ALTOS, PERO NO ES GENERALIZADO",
            detalle:
                "Sigue habiendo verificaciones aceptadas, asi que son uno o pocos "
                + "dispositivos. La PWA se recupera sola. Si alguien reclama, que "
                + "revise fecha y hora automaticas en su telefono. No hay que "
                + "tocar la exigencia."
        };
    }

    return {
        titulo: "GENERALIZADO: ESTAN TODOS AFECTADOS",
        detalle:
            "Las verificaciones aceptadas se cayeron. Si los trabajadores no ven "
            + "sus turnos, en la consola de Firebase: App Check -> APIs -> Cloud "
            + "Firestore -> dejar en NO exigido. Vuelve el servicio al instante. "
            + "Devolverlo a exigido cuando pase."
    };
}

async function main() {
    const entorno = argumento("entorno", "produccion");
    const projectId = ENTORNOS[entorno];
    const horas = Math.max(1, Number(argumento("horas", "24")) || 24);

    if (!projectId) {
        throw new Error(
            `Entorno desconocido: ${entorno}. `
            + `Usa: ${Object.keys(ENTORNOS).join(", ")}`
        );
    }

    const filas = porHora(await serieDeVerificaciones(projectId, horas));

    console.log("");
    console.log(`App Check - Firestore - ${entorno} (${projectId})`);
    console.log(`Ultimas ${horas} h`);
    console.log("");

    if (!filas.length) {
        console.log("  Sin actividad registrada en el periodo.");
        console.log("");
        return;
    }

    console.log("  hora              aceptadas   rechazadas");
    console.log("  ----------------  ---------   ----------");

    for (const fila of filas) {
        const cuando = fila.momento.toLocaleString("es-CL", {
            timeZone: "America/Santiago",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        });
        const alerta = fila.rechazadas > RECHAZOS_NORMALES_POR_HORA
            ? "  <--"
            : "";

        console.log(
            "  " + cuando.padEnd(18)
            + fila.aceptadas.toLocaleString("es-CL").padStart(9)
            + fila.rechazadas.toLocaleString("es-CL").padStart(13)
            + alerta
        );
    }

    const resultado = veredicto(filas);

    console.log("");
    console.log(`  ${resultado.titulo}`);
    console.log(`  ${resultado.detalle}`);
    console.log("");
}

// Solo corre al invocarlo por linea de comandos. Importado desde una prueba,
// expone las funciones puras sin salir a la red.
const invocadoDirecto = process.argv[1]
    && import.meta.url.endsWith(path.basename(process.argv[1]));

if (invocadoDirecto) {
    main().catch((error) => {
        console.error("");
        console.error(`  No se pudo consultar: ${error.message}`);
        console.error("");
        process.exitCode = 1;
    });
}
