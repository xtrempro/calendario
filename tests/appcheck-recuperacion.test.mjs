// La PWA se recupera sola cuando App Check se queda sin token.
//
// El 21 y 22 de agosto de 2026 la app del trabajador quedo sin datos por horas:
// App Check fallo, y como Firestore lo exige, TODAS las lecturas se rechazaron.
// Lo que se veia en pantalla era cache.
//
// La falla de fondo pudo durar segundos. Lo que la alargo fue el SDK: ante un
// error espera cada vez mas antes de reintentar, hasta 4 horas (ante un 403,
// un dia entero). Estas pruebas cubren el mecanismo que deshace esa espera.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function leer(ruta) {
    const fuente = await readFile(new URL(ruta, import.meta.url), "utf8");

    return fuente.replace(/\r\n/g, "\n");
}

const pwa = await leer("../../APP TurnoPlus/www/js/app.js");
const config = await leer("../../APP TurnoPlus/www/js/firebaseConfig.js");

function contiene(texto, trozo, mensaje) {
    assert.ok(texto.includes(trozo), mensaje || `Falta en el fuente:\n${trozo}`);
}

/* =========================================================
   El mecanismo, contra el SDK de verdad

   No se da por supuesto que tocar _throttleData sirva: se comprueba.
========================================================= */

test("la espera del SDK bloquea, y limpiarla la levanta", async () => {
    const { ReCaptchaEnterpriseProvider } = await import("@firebase/app-check");
    const proveedor = new ReCaptchaEnterpriseProvider("clave-de-prueba");

    // Asi queda el proveedor tras un fallo: bloqueado por una hora.
    proveedor._throttleData = {
        allowRequestsAfter: Date.now() + 60 * 60 * 1000,
        httpStatus: 401,
        backoffCount: 5
    };

    const bloqueado = await proveedor.getToken().then(
        () => null,
        (error) => error
    );

    assert.equal(bloqueado?.code, "appCheck/throttled");

    // Y al limpiarlo vuelve a INTENTAR de verdad: ya no se queja de la espera,
    // sino de reCAPTCHA, que es lo que corresponde fuera del navegador.
    proveedor._throttleData = null;

    const libre = await proveedor.getToken().then(
        () => null,
        (error) => error
    );

    assert.notEqual(libre?.code, "appCheck/throttled");
    assert.equal(libre?.code, "appCheck/recaptcha-error");
});

test("el campo interno sigue existiendo en un proveedor recien creado", () => {
    // Es un campo privado del SDK. Si una version lo renombra, esta prueba
    // avisa: el codigo ya tiene respaldo (recargar), pero conviene enterarse.
    const { ReCaptchaEnterpriseProvider } = require("@firebase/app-check");

    assert.ok("_throttleData" in new ReCaptchaEnterpriseProvider("k"));
});

test("la version instalada es la misma que baja la PWA", () => {
    // Sin esto, las dos pruebas de arriba probarian un SDK distinto al que
    // corre en el telefono y no valdrian de nada.
    const instalada = require("firebase/package.json").version;

    contiene(
        config,
        `https://www.gstatic.com/firebasejs/${instalada}`,
        `La PWA no carga la version ${instalada} que hay en node_modules.`
    );
});

/* =========================================================
   Como lo usa la PWA
========================================================= */

test("se guarda el proveedor, que es la unica via para alcanzarlo", () => {
    // initializeAppCheck devuelve SIEMPRE la misma instancia aunque se le pase
    // un proveedor nuevo (compara solo la clave del sitio), asi que si no se
    // guarda esta referencia el bloqueo queda fuera de alcance.
    contiene(pwa, "appCheckProvider = new appCheckModule.ReCaptchaEnterpriseProvider(");
    contiene(pwa, "provider: appCheckProvider,");
});

test("no se toca el campo privado sin comprobar que existe", () => {
    contiene(pwa, 'if (!("_throttleData" in appCheckProvider)) return false;');
    contiene(pwa, "appCheckProvider._throttleData = null;");
});

test("se distingue un rechazo real de uno por App Check", () => {
    // Pedir algo que no te corresponde tambien responde "permission denied".
    // Por eso no se adivina por la forma del error: se le pregunta a App Check.
    contiene(pwa, "await services.appCheckModule.getToken(services.appCheck, false);");
    contiene(pwa, 'code === "appCheck/throttled"');
    contiene(pwa, 'code === "appCheck/initial-throttle"');
});

test("toda lectura rechazada arma la recuperacion", () => {
    // isPermissionDenied es el unico punto por donde pasan las nueve lecturas.
    contiene(pwa, "if (denegado) void recoverAppCheck();");
});

test("al recuperar el token se rearman las suscripciones", () => {
    // Sin esto el token vuelve pero la pantalla sigue mostrando cache.
    contiene(pwa, "resyncWorkerRealtimeSubscriptions();");
});

test("volver a la app reintenta", () => {
    contiene(pwa, 'document.addEventListener("visibilitychange"');
    contiene(pwa, "void recoverAppCheck();");
    contiene(pwa, "setupAppCheckRecovery();");
});

/* =========================================================
   Los frenos de la recarga

   Es el plan B y reinicia la app entera: mal dosificada, seria peor que el
   problema que arregla.
========================================================= */

test("la recarga esta limitada en numero y separada en el tiempo", () => {
    contiene(pwa, "const APP_CHECK_RELOAD_MAX_PER_HOUR = 3;");
    contiene(pwa, "const APP_CHECK_RELOAD_MIN_GAP_MS = 5 * 60 * 1000;");
    contiene(pwa, "if (recientes.length >= APP_CHECK_RELOAD_MAX_PER_HOUR) return false;");
});

test("no se recarga con la app de fondo ni con texto a medias", () => {
    // Recargar borra lo que el trabajador escribio y no envio.
    contiene(pwa, 'if (document.visibilityState !== "visible") return false;');
    contiene(pwa, "if (hasUnsavedWorkerInput()) return false;");
});

test("dos lecturas rechazadas seguidas no disparan dos recuperaciones", () => {
    contiene(pwa, "if (appCheckRecoveryRunning) return;");
    contiene(pwa, "if (ahora - appCheckLastRecoveryAt < APP_CHECK_RETRY_MIN_MS) return;");
});

/* =========================================================
   Lo que ve el trabajador
========================================================= */

test("se avisa una vez, en vez de nueve errores de permisos", () => {
    // Los mensajes "No tienes permiso para leer..." describen mal la causa:
    // parecen un problema de permisos y son de verificacion del dispositivo.
    contiene(pwa, "if (appCheckBlocked && !offline) {");
    contiene(pwa, "Reintentando verificar el dispositivo");
    contiene(pwa, 'data-action="reload-app"');
});

/* =========================================================
   El comando de estado

   Se prueba con las cifras reales de los dos dias del incidente, porque el
   veredicto es lo que decide si hay que hacer algo o no.
========================================================= */

const { veredicto, porHora } = await import("../scripts/appcheck-estado.mjs");

function horasNormales(cantidad) {
    return Array.from({ length: cantidad }, () => ({
        momento: new Date(),
        aceptadas: 3000,
        rechazadas: 0
    }));
}

test("un dia tranquilo no dispara nada", () => {
    const filas = [...horasNormales(20)];

    filas[11].rechazadas = 18; // ruido de fondo real del 23 de agosto

    assert.equal(veredicto(filas).titulo, "SIN NOVEDAD");
});

test("el viernes 21: rechazos enormes pero el resto funcionaba", () => {
    // 15:00, 16:00 y 17:00 de ese dia. Seguia habiendo miles de aceptadas, o
    // sea eran uno o pocos telefonos. La respuesta correcta era NO hacer nada.
    const filas = [
        ...horasNormales(12),
        { momento: new Date(), aceptadas: 6085, rechazadas: 38460 },
        { momento: new Date(), aceptadas: 6981, rechazadas: 41432 },
        { momento: new Date(), aceptadas: 7678, rechazadas: 43486 }
    ];

    assert.equal(
        veredicto(filas).titulo,
        "RECHAZOS ALTOS, PERO NO ES GENERALIZADO"
    );
});

test("si las aceptadas se caen, hay que actuar", () => {
    // Este caso NO ocurrio, y por eso ninguna alerta habria requerido accion.
    // Es el que justifica dejar escrito donde se quita la exigencia.
    const filas = [
        ...horasNormales(12),
        { momento: new Date(), aceptadas: 20, rechazadas: 17066 },
        { momento: new Date(), aceptadas: 12, rechazadas: 56436 },
        { momento: new Date(), aceptadas: 8, rechazadas: 53091 }
    ];

    const resultado = veredicto(filas);

    assert.equal(resultado.titulo, "GENERALIZADO: ESTAN TODOS AFECTADOS");
    assert.ok(resultado.detalle.includes("NO exigido"));
});

test("solo se mira Firestore, que es el servicio que exige App Check", () => {
    const series = [
        {
            resource: { labels: { service_id: "firestore.googleapis.com" } },
            metric: { labels: { result: "DENY" } },
            points: [{
                interval: { endTime: "2026-08-21T18:00:00Z" },
                value: { int64Value: "38460" }
            }]
        },
        {
            resource: { labels: { service_id: "firebasestorage.googleapis.com" } },
            metric: { labels: { result: "DENY" } },
            points: [{
                interval: { endTime: "2026-08-21T18:00:00Z" },
                value: { int64Value: "999" }
            }]
        }
    ];

    const filas = porHora(series);

    assert.equal(filas.length, 1);
    assert.equal(filas[0].rechazadas, 38460);
});

test("aceptadas y rechazadas de la misma hora se juntan en una fila", () => {
    const hora = "2026-08-21T18:00:00Z";
    const serie = (result, cantidad) => ({
        resource: { labels: { service_id: "firestore.googleapis.com" } },
        metric: { labels: { result } },
        points: [{
            interval: { endTime: hora },
            value: { int64Value: String(cantidad) }
        }]
    });

    const filas = porHora([serie("ALLOW", 6085), serie("DENY", 38460)]);

    assert.equal(filas.length, 1);
    assert.equal(filas[0].aceptadas, 6085);
    assert.equal(filas[0].rechazadas, 38460);
});
