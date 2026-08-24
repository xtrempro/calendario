// Notas de RRHH que rotan en el inicio.
//
// Son las reglas que mas se preguntan y que no estan a la vista en ninguna
// pantalla: el orden de FC y FL, en que dias se puede pedir cada permiso, y a
// que hora entra quien pide medio administrativo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function leer(ruta) {
    const fuente = await readFile(new URL(ruta, import.meta.url), "utf8");

    return fuente.replace(/\r\n/g, "\n");
}

const home = await leer("../js/home.js");
const estilos = await leer("../styles.css");

/* =========================================================
   Las notas
========================================================= */

test("estan las catorce notas que pidio el usuario", () => {
    const bloque = home.slice(
        home.indexOf("const NOTAS_RRHH = ["),
        home.indexOf("const NOTA_MS")
    );
    const notas = bloque.match(/^\s{4}"/gm) || [];

    assert.equal(notas.length, 14);
});

test("cada nota lleva un simbolo delante", () => {
    // El usuario los pidio para que se vean mas llamativas.
    const bloque = home.slice(
        home.indexOf("const NOTAS_RRHH = ["),
        home.indexOf("const NOTA_MS")
    );

    (bloque.match(/^\s{4}"(.+)",?$/gm) || []).forEach(linea => {
        assert.doesNotMatch(
            linea,
            /^\s{4}"[A-Za-zÁÉÍÓÚÑáéíóúñ¿¡]/,
            `esta nota empieza sin simbolo: ${linea.trim()}`
        );
    });
});

test("las reglas concretas quedaron tal cual", () => {
    assert.match(home, /el orden recomendado es FC primero y luego FL/);
    assert.match(home, /deberán pasar 90 días desde el último FL/);
    assert.match(home, /Los atrasos solo se miden en los turnos base/);
    assert.match(home, /no puede hacer ningún turno ese día, ni siquiera noche/);
    assert.match(home, /los 20 días continuos/);
    assert.match(home, /un bloque de 10 FL continuos/);
    assert.match(home, /No se puede pedir un FL en un día inhábil/);
    assert.match(home, /deben comenzar siempre en un día hábil/);
});

test("las horas del medio administrativo calzan con el motor", () => {
    // Si estas notas dijeran otra hora que la que aplica el sistema, serian
    // peor que no tenerlas.
    assert.match(home, /marca su entrada a las 12:30 \(12:00 los viernes\)/);
    assert.match(home, /marca su entrada a las 14:00/);
});

/* =========================================================
   La rotacion
========================================================= */

test("cada nota alcanza a leerse", () => {
    // "Un par de segundos" no da para la nota mas larga: son casi 20 palabras.
    const ms = Number(/const NOTA_MS = (\d+);/.exec(home)?.[1]);

    assert.ok(ms >= 5000, `${ms} ms es poco para leer la nota mas larga`);
});

test("empieza en una nota al azar", () => {
    // Entrando y saliendo del inicio, partir siempre de la primera haria que
    // las ultimas no se vieran nunca.
    assert.match(
        home,
        /const inicio = Math\.floor\(Math\.random\(\) \* NOTAS_RRHH\.length\);/
    );
});

test("rota en circulo, sin quedarse en la ultima", () => {
    assert.match(
        home,
        /\(Number\(tarjeta\.dataset\.index\) \+ 1\) % NOTAS_RRHH\.length/
    );
});

test("se detiene con el mouse encima", () => {
    // Para poder terminar de leer una nota larga sin que se escape.
    assert.match(home, /addEventListener\("mouseenter", \(\) => \{ detenido = true; \}\)/);
    assert.match(home, /if \(detenido \|\| !texto\.isConnected\) return;/);
});

/* =========================================================
   Que no queden temporizadores sueltos
========================================================= */

test("el ciclo anterior se limpia en cada repintado", () => {
    // renderHomePanel reemplaza el panel entero: sin esto, cada visita al
    // inicio dejaria un intervalo mas escribiendo en nodos ya sueltos.
    assert.match(home, /^let notasTimer = null;$/m);
    assert.match(
        home,
        /if \(notasTimer\) \{\s*\n\s*clearInterval\(notasTimer\);\s*\n\s*notasTimer = null;\s*\n\s*\}/
    );
    assert.match(home, /iniciarNotas\(panel\);/);
});

test("sin la tarjeta en pantalla no se arma ningun ciclo", () => {
    assert.match(home, /if \(!tarjeta \|\| !texto\) return;/);
});

/* =========================================================
   Estilos
========================================================= */

test("la tarjeta tiene color propio y no se confunde con la dotacion", () => {
    assert.match(estilos, /\.hm-stat--indigo \{/);
    assert.match(estilos, /\.hm-nota \{/);
    // El desvanecido se apaga para quien pide menos movimiento.
    assert.match(
        estilos,
        /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.hm-nota \{ transition: none; \}/
    );
});
