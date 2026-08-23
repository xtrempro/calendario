// Comprueba que ofuscar los motores no cambia lo que calculan.
//
// Es la red de seguridad del paso de ofuscacion: la suite de tests corre contra
// el codigo FUENTE, no contra el bundle, asi que sin esto se estaria publicando
// codigo transformado que nadie verifico. Aca se importa el modulo original y
// el ofuscado y se comparan sus resultados sobre las mismas entradas.
//
// Se ejecuta solo, o como parte de npm run build.

import obfuscator from "javascript-obfuscator";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { optionsFor, PROTECTED_MODULES } from "./obfuscate-engine.mjs";

// Los motores importan storage y utilidades que esperan un navegador. Se les da
// lo minimo para poder cargarlos y comparar su superficie publica.
class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const WORK_DIR = path.join("node_modules", ".turnoplus-obf-check");
// La copia se hace dentro de js/ para que los imports relativos de cada motor
// sigan resolviendo a sus vecinos sin tocar rutas.
const WORK_JS = path.join(WORK_DIR, "js");

function obfuscateToFile(sourcePath, targetPath) {
    const source = readFileSync(sourcePath, "utf8");
    // Las mismas opciones que usara el build para ese modulo, no unas genericas.
    const result = obfuscator.obfuscate(source, optionsFor(sourcePath));

    writeFileSync(targetPath, result.getObfuscatedCode(), "utf8");
}

// Casos de prueba por modulo: entradas y la funcion que produce el resultado
// comparable. Se agregan a medida que se protegen mas motores.
const CHECKS = [
    {
        module: "js/overtimeRules.js",
        run: (api) => {
            const rows = [];

            for (let day = 1; day <= 31; day++) {
                const date = new Date(2026, 7, day);

                rows.push([
                    api.diurnoExtraDayHours(date, () => true),
                    api.diurnoExtraDayHoursWithHolidays(date, {}),
                    api.diurnoExtraDayHoursWithHolidays(date, { "2026-7-25": "x" })
                ]);
            }

            rows.push([api.AVERAGE_DIURNAL_WORKDAY_HOURS]);

            return rows;
        }
    },
    {
        module: "js/calculations.js",
        run: (api) => {
            const rows = [];

            for (let day = 1; day <= 31; day++) {
                const date = new Date(2026, 7, day);

                for (let state = 0; state <= 8; state++) {
                    const hours = api.calcHours(date, state, {});

                    rows.push([
                        state,
                        hours.d,
                        hours.n,
                        api.isBusinessDay(date, {}),
                        api.isWeekend(date)
                    ]);
                }
            }

            return rows;
        }
    }
];

// Los modulos con resultados comparables se verifican a fondo; del resto se
// comprueba al menos que ofuscarlos no cambie lo que exportan, que es el fallo
// que romperia el bundle entero.
function allChecks() {
    const deep = new Map(CHECKS.map(check => [check.module, check]));

    return PROTECTED_MODULES.map(module =>
        deep.get(module) || { module, run: null }
    );
}

async function main() {
    rmSync(WORK_DIR, { recursive: true, force: true });
    mkdirSync(WORK_DIR, { recursive: true });
    cpSync("js", WORK_JS, { recursive: true });

    let failures = 0;

    for (const check of allChecks()) {
        const name = path.basename(check.module);
        const target = path.join(WORK_JS, path.relative("js", check.module));

        obfuscateToFile(check.module, target);

        const [original, obfuscated] = await Promise.all([
            import(pathToFileURL(path.resolve(check.module)).href),
            import(pathToFileURL(path.resolve(target)).href)
        ]);

        const exportsOriginal = Object.keys(original).sort().join(",");
        const exportsObfuscated = Object.keys(obfuscated).sort().join(",");

        if (exportsOriginal !== exportsObfuscated) {
            failures++;
            console.error(
                `  ${name}: los exports no coinciden\n` +
                `    original: ${exportsOriginal}\n` +
                `    ofuscado: ${exportsObfuscated}`
            );
            continue;
        }

        if (check.run) {
            const before = JSON.stringify(check.run(original));
            const after = JSON.stringify(check.run(obfuscated));

            if (before !== after) {
                failures++;
                console.error(`  ${name}: los resultados CAMBIAN al ofuscar.`);
                continue;
            }
        }

        const sizeBefore = readFileSync(check.module).length;
        const sizeAfter = readFileSync(target).length;
        const growth = ((sizeAfter / sizeBefore - 1) * 100).toFixed(0);

        console.log(
            `  ${name.padEnd(22)} ${check.run ? "resultados y exports" : "exports"} ` +
            `iguales (${(sizeBefore / 1024).toFixed(0)} KB -> ` +
            `${(sizeAfter / 1024).toFixed(0)} KB, +${growth}%)`
        );
    }

    rmSync(WORK_DIR, { recursive: true, force: true });

    if (failures) {
        console.error(
            `\nLa ofuscacion altera ${failures} modulo(s). No se publica.`
        );
        process.exit(1);
    }

    console.log("\nOfuscacion verificada: mismos exports, mismos resultados.");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
