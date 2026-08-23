// Ofuscacion SELECTIVA de los modulos que son la propiedad intelectual del
// programa: los motores de calculo.
//
// Por que selectiva y no todo el bundle: aplanar el flujo de 1,1 MB de codigo
// cuesta entre 30% y 100% de rendimiento, y la proyeccion del calendario es
// justo el codigo caliente. Ofuscando solo los motores se protege lo que
// importa sin pagar ese precio en la interfaz.
//
// Que NO es esto: no es cifrado. El navegador tiene que poder ejecutarlo, asi
// que el codigo esta ahi y alguien con tiempo lo recupera. Lo que se compra es
// costo: pasar de "copio el archivo" a "necesito semanas de ingenieria
// inversa".
//
// Como funciona: se copia js/ a una carpeta temporal, se ofuscan ahi los
// archivos elegidos, y esbuild empaqueta desde esa copia. El codigo fuente
// nunca se toca.

import obfuscator from "javascript-obfuscator";
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from "fs";
import path from "path";

// Los motores. Cada uno que se agregue aca queda protegido en el proximo build,
// que es la forma de ir avanzando sin rehacer nada.
export const PROTECTED_MODULES = [
    "js/hoursEngine.js",
    "js/turnEngine.js",
    "js/rulesEngine.js",
    "js/calculations.js",
    "js/overtimeRules.js",
    "js/hoursReport.js"
];

// Modulos que corren EN BUCLE: la proyeccion del calendario y el timeline los
// llaman una vez por celda, por trabajador y por dia.
//
// A estos se les apaga el arreglo de textos. Medido con
// scripts/bench-obfuscation.mjs sobre calcHours (31 dias x 9 turnos):
//
//   original                  1,00x
//   con arreglo de textos     3,71x   <- cada literal pasa por funcion + indice
//   sin arreglo de textos     1,04x
//
// Y lo que se pierde es poco: los literales de estos modulos son claves
// internas, no el valor del programa. Lo que si los protege -renombrado de
// identificadores y numbersToExpressions, que esconde las constantes del
// dominio como 8,8 o 12- se conserva y sale gratis.
const HOT_ENGINE_MODULES = new Set([
    "js/hoursEngine.js",
    "js/turnEngine.js",
    "js/rulesEngine.js",
    "js/calculations.js",
    "js/overtimeRules.js"
]);

/**
 * Opciones para un modulo. hoursReport se arma bajo demanda, no en bucle, asi
 * que ahi el arreglo de textos sale barato y vale la pena: es el modulo con mas
 * texto visible al usuario.
 */
export function optionsFor(module) {
    return HOT_ENGINE_MODULES.has(module)
        ? { ...OBFUSCATOR_OPTIONS, stringArray: false }
        : OBFUSCATOR_OPTIONS;
}

// Configuracion deliberadamente conservadora.
//
// controlFlowFlattening y deadCodeInjection quedan APAGADOS: son los que dan
// mas proteccion y tambien los que cuestan rendimiento y tamano. Se pueden
// encender por modulo mas adelante, midiendo.
//
// debugProtection queda apagado tambien: rompe la depuracion legitima de
// errores en produccion y se evade sin dificultad.
export const OBFUSCATOR_OPTIONS = {
    compact: true,
    // Renombra identificadores locales; los nombres exportados se conservan
    // porque esbuild necesita resolverlos al empaquetar.
    identifierNamesGenerator: "mangled",
    renameGlobals: false,
    // Lo que de verdad estorba a quien lee: los textos dejan de estar a la
    // vista y buscar "hheeDiurnas" en el bundle no encuentra nada.
    stringArray: true,
    stringArrayThreshold: 1,
    stringArrayEncoding: ["base64"],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersType: "function",
    splitStrings: true,
    splitStringsChunkLength: 8,
    numbersToExpressions: true,
    simplify: true,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
    // Apagados a proposito (ver arriba).
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    selfDefending: false,
    disableConsoleOutput: false,
    // El bundle es ESM.
    target: "browser"
};

/**
 * Prepara una copia de js/ con los motores ofuscados.
 * @param {string} workDir carpeta temporal de trabajo
 * @returns {{entry: string, obfuscated: string[]}}
 */
export function buildObfuscatedTree(workDir) {
    rmSync(workDir, { recursive: true, force: true });
    cpSync("js", path.join(workDir, "js"), { recursive: true });

    const obfuscated = [];

    for (const relative of PROTECTED_MODULES) {
        const target = path.join(workDir, relative);

        if (!existsSync(target)) {
            throw new Error(
                `No existe ${relative}: revisa PROTECTED_MODULES en ` +
                "scripts/obfuscate-engine.mjs."
            );
        }

        const source = readFileSync(target, "utf8");
        const result = obfuscator.obfuscate(source, optionsFor(relative));

        writeFileSync(target, result.getObfuscatedCode(), "utf8");
        obfuscated.push(relative);
    }

    return {
        entry: path.join(workDir, "js", "main.js"),
        obfuscated
    };
}
