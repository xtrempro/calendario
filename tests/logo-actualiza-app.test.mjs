// El logo tiene que actualizar la app a la ultima version desplegada, igual que
// el boton de actualizar: es el gesto que la gente intenta primero cuando ve
// algo desactualizado. Sin desregistrar el service worker y limpiar las caches,
// recargar sirve el build viejo y el usuario no ve los cambios.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(url) {
    const source = await readFile(url, "utf8");

    return source.replace(/\r\n/g, "\n");
}

const main = await read(new URL("../js/main.js", import.meta.url));
const html = await read(new URL("../index.html", import.meta.url));

// La PWA del trabajador vive en un repo aparte.
const PWA = new URL(
    "../../APP TurnoPlus/www/",
    import.meta.url
);
const pwaApp = await read(new URL("js/app.js", PWA));
const pwaHtml = await read(new URL("index.html", PWA));
const pwaSw = await read(new URL("sw.js", PWA));

function reloadBody(source) {
    const start = source.indexOf("async function reloadAppToLatestVersion(");

    assert.notEqual(start, -1, "falta reloadAppToLatestVersion");

    return source.slice(start, start + 1400);
}

test("supervisor: el logo dispara la misma actualizacion que el boton", () => {
    assert.match(html, /id="appBrandReload"/);
    assert.match(html, /role="button"/);
    assert.match(html, /tabindex="0"/);

    assert.match(main, /appReloadBtn\.onclick = \(\) => reloadAppToLatestVersion\(appReloadBtn\)/);
    assert.match(main, /appBrandReload\.addEventListener\("click"/);
    // Accesible con teclado, porque no es un <button>.
    assert.match(main, /appBrandReload\.addEventListener\("keydown"/);
    assert.match(main, /event\.key !== "Enter" && event\.key !== " "/);
});

test("supervisor: la actualizacion limpia service worker y caches", () => {
    const body = reloadBody(main);

    assert.match(body, /registrations\(\)|getRegistrations\(\)/);
    assert.match(body, /\.unregister\(\)/);
    assert.match(body, /caches\.delete\(/);
    assert.match(body, /window\.location\.reload\(\)/);
    // Un solo ciclo a la vez: doble click no dispara dos recargas.
    assert.match(body, /if \(appReloadInFlight\) return;/);
});

test("PWA: el logo actualiza en vez de solo navegar", () => {
    assert.match(pwaHtml, /class="brand-button" type="button" data-app-reload/);
    assert.doesNotMatch(pwaHtml, /class="brand-button" type="button" data-screen/);
    // La rama del reload va ANTES que la de data-screen en la delegacion.
    const delegation = pwaApp.slice(
        pwaApp.indexOf('const button = event.target.closest("button");')
    ).slice(0, 600);

    assert.match(delegation, /\[data-app-reload\][\s\S]*?reloadAppToLatestVersion\(\)/);
    assert.equal(
        delegation.indexOf("data-app-reload") < delegation.indexOf("dataset.screen"),
        true
    );
});

test("PWA: la actualizacion limpia service worker y caches", () => {
    const body = reloadBody(pwaApp);

    assert.match(body, /getRegistrations\(\)/);
    assert.match(body, /\.unregister\(\)/);
    assert.match(body, /caches\.delete\(/);
    assert.match(body, /window\.location\.reload\(\)/);
    assert.match(body, /if \(appReloadInFlight\) return;/);
});

test("PWA: la version de cache subio en sw.js y en index.html", () => {
    // Convencion critica del proyecto: sin subir la version, el service worker
    // sigue sirviendo el build cacheado y nadie recibe el cambio.
    const swVersion = pwaSw.match(/CACHE_NAME = "turnoplus-worker-v(\d+)"/)?.[1];

    assert.ok(swVersion, "falta CACHE_NAME versionado");
    assert.equal(Number(swVersion) >= 264, true);

    const swAssetVersions = [...pwaSw.matchAll(/\?v=(\d+)/g)].map(m => m[1]);
    const htmlVersions = [...pwaHtml.matchAll(/\?v=(\d+)/g)].map(m => m[1]);

    assert.equal(swAssetVersions.length > 0, true);
    assert.equal(htmlVersions.length > 0, true);
    // Todo apuntando a la misma version que el CACHE_NAME.
    [...swAssetVersions, ...htmlVersions].forEach(version => {
        assert.equal(version, swVersion);
    });
});
