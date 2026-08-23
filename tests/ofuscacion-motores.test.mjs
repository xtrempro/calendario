// Ofuscacion selectiva de los motores de calculo.
//
// Lo que se protege aca no es el build en si sino las DECISIONES: que se
// ofusca, que opciones quedan apagadas y por que. Son las que hacen la
// diferencia entre proteger el codigo y romper la app en produccion.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const {
    PROTECTED_MODULES,
    OBFUSCATOR_OPTIONS
} = await import("../scripts/obfuscate-engine.mjs");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const build = await read("../build.mjs");
const packageJson = JSON.parse(await read("../package.json"));

test("se protegen los motores, no toda la app", () => {
    // Ofuscar 1,1 MB costaria rendimiento en la interfaz sin proteger nada que
    // valga la pena. Se cubre lo que es propiedad intelectual.
    assert.deepEqual(PROTECTED_MODULES, [
        "js/hoursEngine.js",
        "js/turnEngine.js",
        "js/rulesEngine.js",
        "js/calculations.js",
        "js/overtimeRules.js",
        "js/hoursReport.js"
    ]);
});

test("todos los modulos de la lista existen", async () => {
    PROTECTED_MODULES.forEach(module => {
        assert.ok(existsSync(module), `no existe ${module}`);
    });

    // Un nombre mal escrito dejaria ese motor sin proteger en silencio, asi que
    // el paso de ofuscacion falla en vez de seguir de largo.
    const script = await read("../scripts/obfuscate-engine.mjs");

    assert.match(script, /if \(!existsSync\(target\)\) \{[\s\S]{0,200}throw new Error\(/);
});

test("las transformaciones caras quedan apagadas", () => {
    // controlFlowFlattening cuesta entre 30% y 100% de rendimiento, y la
    // proyeccion del calendario es codigo caliente. deadCodeInjection infla el
    // bundle. Se pueden encender por modulo mas adelante, midiendo.
    assert.equal(OBFUSCATOR_OPTIONS.controlFlowFlattening, false);
    assert.equal(OBFUSCATOR_OPTIONS.deadCodeInjection, false);
});

test("no se rompe la depuracion de produccion", () => {
    // debugProtection y selfDefending impiden diagnosticar un error real y se
    // evaden sin dificultad: cuestan mas de lo que protegen.
    assert.equal(OBFUSCATOR_OPTIONS.debugProtection, false);
    assert.equal(OBFUSCATOR_OPTIONS.selfDefending, false);
    assert.equal(OBFUSCATOR_OPTIONS.disableConsoleOutput, false);
});

test("los textos quedan fuera de la vista", () => {
    // Es lo que de verdad estorba a quien lee: buscar un nombre de funcion o un
    // literal en el bundle deja de encontrar nada.
    assert.equal(OBFUSCATOR_OPTIONS.stringArray, true);
    assert.equal(OBFUSCATOR_OPTIONS.stringArrayThreshold, 1);
    assert.deepEqual(OBFUSCATOR_OPTIONS.stringArrayEncoding, ["base64"]);
});

test("los nombres exportados se conservan", () => {
    // Si se renombraran, esbuild no podria resolver los imports y el bundle no
    // arrancaria. El verificador lo comprueba modulo por modulo.
    assert.equal(OBFUSCATOR_OPTIONS.renameGlobals, false);
});

test("el codigo fuente nunca se toca", () => {
    // Se ofusca una COPIA en node_modules; js/ queda intacto para trabajar.
    assert.match(build, /const OBF_DIR = path\.join\("node_modules", "\.turnoplus-build"\);/);
    assert.match(build, /buildObfuscatedTree\(OBF_DIR\)/);
    // Y la copia se borra al terminar.
    assert.match(build, /rmSync\(OBF_DIR, \{ recursive: true, force: true \}\);/);
});

test("el build verifica antes de empaquetar", () => {
    // La suite corre contra el codigo fuente, no contra el bundle: sin este
    // paso se publicaria codigo transformado que nadie comprobo.
    assert.equal(
        packageJson.scripts.build,
        "node scripts/verify-obfuscated-engine.mjs && node build.mjs"
    );
    assert.equal(packageJson.scripts["verify:obfuscation"], "node scripts/verify-obfuscated-engine.mjs");
});

test("hay una salida para depurar, y avisa", () => {
    // Un bundle legible publicado por accidente seria peor que no ofuscar.
    assert.equal(packageJson.scripts["build:legible"], "node build.mjs --legible");
    assert.match(build, /const OBFUSCATE = !process\.argv\.includes\("--legible"\);/);
    assert.match(build, /No publicar asi/);
});

test("el ofuscador es una dependencia de desarrollo", () => {
    // No puede terminar en el bundle que se sirve.
    assert.ok(packageJson.devDependencies["javascript-obfuscator"]);
    assert.equal(packageJson.dependencies, undefined);
});
