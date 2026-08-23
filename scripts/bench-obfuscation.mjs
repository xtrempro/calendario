// Mide cuanto cuesta la ofuscacion en tiempo de ejecucion.
//
// No sirve opinar: aunque las transformaciones caras esten apagadas, el resto
// tambien cuesta. Esto compara el modulo original contra varias configuraciones
// sobre la misma carga de trabajo.
//
// POR QUE TODO EN UN SOLO PROCESO E INTERCALADO: medir cada variante en su
// propio proceso daba resultados que se contradecian entre corridas. La
// variacion entre procesos -escalado de frecuencia del CPU, carga de fondo,
// niveles del JIT- es mayor que la diferencia que se quiere medir. Midiendo
// todas las variantes en la misma corrida, por rondas alternadas y quedandose
// con el minimo de cada una, esa deriva afecta a todas por igual.
//
// Uso: node scripts/bench-obfuscation.mjs

import obfuscator from "javascript-obfuscator";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { OBFUSCATOR_OPTIONS } from "./obfuscate-engine.mjs";

const WORK_DIR = path.join("node_modules", ".turnoplus-bench");
const WORK_JS = path.join(WORK_DIR, "js");
const ITERACIONES = 2000;
const RONDAS = 9;

// Un mes completo de fechas por los 9 estados de turno: la forma de la carga
// real cuando el calendario proyecta.
const FECHAS = Array.from(
    { length: 31 },
    (_, index) => new Date(2026, 7, index + 1)
);
const ESTADOS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const VARIANTES = [
    { nombre: "original", options: null },
    { nombre: "config actual", options: {} },
    {
        nombre: "sin numbersToExpressions",
        options: { numbersToExpressions: false }
    },
    {
        nombre: "sin numbers + sin splitStrings",
        options: { numbersToExpressions: false, splitStrings: false }
    },
    {
        nombre: "sin numbers + splitStrings + objectKeys",
        options: {
            numbersToExpressions: false,
            splitStrings: false,
            transformObjectKeys: false
        }
    },
    {
        // La propuesta: todo menos el arreglo de textos.
        nombre: "PROPUESTA motor caliente",
        options: { stringArray: false }
    },
    {
        nombre: "solo renombrar (sin stringArray)",
        options: {
            numbersToExpressions: false,
            splitStrings: false,
            transformObjectKeys: false,
            stringArray: false
        }
    }
];

function carga(api) {
    return () => {
        let total = 0;

        for (const date of FECHAS) {
            for (const state of ESTADOS) {
                const hours = api.calcHours(date, state, {});

                total += hours.d + hours.n;
            }
        }

        return total;
    };
}

async function main() {
    rmSync(WORK_DIR, { recursive: true, force: true });
    mkdirSync(WORK_DIR, { recursive: true });
    cpSync("js", WORK_JS, { recursive: true });

    const modulo = "js/calculations.js";
    const source = readFileSync(modulo, "utf8");
    const casos = [];

    for (const [index, variante] of VARIANTES.entries()) {
        let href;

        if (!variante.options) {
            href = pathToFileURL(path.resolve(modulo)).href;
        } else {
            const target = path.join(WORK_JS, `calculations-${index}.js`);
            const options = { ...OBFUSCATOR_OPTIONS, ...variante.options };

            writeFileSync(
                target,
                obfuscator.obfuscate(source, options).getObfuscatedCode(),
                "utf8"
            );
            href = pathToFileURL(path.resolve(target)).href;
        }

        const api = await import(href);

        casos.push({
            nombre: variante.nombre,
            run: carga(api),
            mejor: Infinity,
            bytes: variante.options
                ? readFileSync(
                    path.join(WORK_JS, `calculations-${index}.js`)
                ).length
                : source.length
        });
    }

    // Calentamiento parejo.
    casos.forEach(caso => {
        for (let i = 0; i < 500; i++) caso.run();
    });

    // Rondas alternadas: si el CPU baja de frecuencia a mitad de camino, le baja
    // a todas las variantes, no solo a la ultima.
    for (let ronda = 0; ronda < RONDAS; ronda++) {
        for (const caso of casos) {
            const inicio = process.hrtime.bigint();

            for (let i = 0; i < ITERACIONES; i++) caso.run();

            caso.mejor = Math.min(
                caso.mejor,
                Number(process.hrtime.bigint() - inicio) / 1e6
            );
        }
    }

    const base = casos[0].mejor;

    console.log(
        `calcHours sobre ${FECHAS.length} dias x ${ESTADOS.length} turnos, ` +
        `${ITERACIONES} veces, mejor de ${RONDAS} rondas alternadas:\n`
    );

    for (const caso of casos) {
        const factor = (caso.mejor / base).toFixed(2);
        const porMes = (caso.mejor / ITERACIONES * 1000).toFixed(0);

        console.log(
            `  ${caso.nombre.padEnd(40)} ${caso.mejor.toFixed(0).padStart(6)} ms  ` +
            `${factor.padStart(5)}x  ${porMes.padStart(4)} us/mes  ` +
            `${(caso.bytes / 1024).toFixed(0)} KB`
        );
    }

    rmSync(WORK_DIR, { recursive: true, force: true });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
