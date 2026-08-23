// Un modal se cerraba al seleccionar texto arrastrando dentro de un campo.
//
// Al soltar el mouse fuera del campo, el navegador dispara un "click" cuyo
// target es el ancestro comun de donde se presiono y donde se solto, que suele
// ser el fondo del modal. Como los modales cierran cuando el target del click
// es el fondo, se cerraban solos y se perdia lo escrito.
//
// El arreglo va en UN solo lugar -un listener en fase de captura- y no en los
// 37 sitios que comprueban el fondo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
    shouldIgnoreBackdropClick,
    MODAL_BACKDROP_GUARD_INTERNALS
} = await import("../js/modalBackdropGuard.js");

const { hasBackdropName, isOverlayElement } = MODAL_BACKDROP_GUARD_INTERNALS;

const guard = (await readFile(
    new URL("../js/modalBackdropGuard.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
const main = (await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

// En los tests la "capa" se marca a mano: la deteccion real mira estilos
// calculados, que no existen fuera de un navegador.
const esCapa = (element) => Boolean(element?.esCapa);

// Elementos de mentira, con lo minimo que mira el guardia.
function element(className, children = [], esCapa = false) {
    const node = {
        nodeType: 1,
        className,
        children,
        esCapa,
        contains(other) {
            if (other === node) return true;

            return children.some(child =>
                child === other ||
                (child.contains ? child.contains(other) : false)
            );
        }
    };

    return node;
}

/* =========================================================
   Que cuenta como fondo
========================================================= */

test("reconoce los fondos de todos los modales del app", () => {
    [
        "turn-change-dialog-backdrop",
        "hm-modal-backdrop",
        "hm-modal-backdrop hm-modal-backdrop--over",
        "app-dialog-backdrop",
        "ag-modal-backdrop",
        "task-assignment-dialog-backdrop"
    ].forEach(className => {
        assert.equal(
            hasBackdropName(element(className)),
            true,
            `no reconocio "${className}"`
        );
    });
});

test("no confunde otros elementos con un fondo", () => {
    ["hm-modal", "settings-card", "day", ""].forEach(className => {
        assert.equal(hasBackdropName(element(className)), false, className);
    });
    // Y no se cae con cosas que no son elementos.
    assert.equal(hasBackdropName(null), false);
    assert.equal(hasBackdropName({ nodeType: 3 }), false);
});

test("una capa que NO se llama backdrop igual se detecta", async () => {
    // El fallo real: el buscador de trabajadores usa "profile-search-modal",
    // sin la palabra "backdrop", asi que la deteccion por nombre no lo cubria y
    // el modal se seguia cerrando. La señal buena es estructural.
    const html = (await readFile(
        new URL("../index.html", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");
    const styles = (await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    // Hay cuatro buscadores con esa clase y ninguno dice "backdrop".
    assert.ok(
        (html.match(/class="profile-search-modal"/g) || []).length >= 4
    );
    assert.equal(hasBackdropName(element("profile-search-modal")), false);
    // Pero su capa es fija y cubre la pantalla, que es lo que ahora se mira.
    assert.match(
        styles,
        /\.profile-search-modal \{[\s\S]{0,80}position: fixed;[\s\S]{0,20}inset: 0;/
    );
    assert.match(guard, /getComputedStyle\(element\)\.position !== "fixed"/);
    assert.match(guard, /rect\.width >= view\.innerWidth \* 0\.9/);
});

/* =========================================================
   La regla
========================================================= */

test("arrastrar desde un campo y soltar en el fondo NO cierra", () => {
    // El caso reportado: seleccionar texto en un combobox y soltar afuera.
    const input = element("search-input");
    const backdrop = element("hm-modal-backdrop", [
        element("hm-modal", [input])
    ], true);

    assert.equal(shouldIgnoreBackdropClick(backdrop, input, esCapa), true);
});

test("un click de verdad en el fondo SI cierra", () => {
    // Presionar y soltar sobre el fondo: es la forma de cerrar y debe seguir
    // funcionando.
    const backdrop = element("hm-modal-backdrop", [], true);

    assert.equal(shouldIgnoreBackdropClick(backdrop, backdrop, esCapa), false);
});

test("un arrastre que viene de OTRO modal si cierra", () => {
    // Si la pulsacion empezo fuera de este modal, soltar sobre su fondo es un
    // click al fondo legitimo.
    const otro = element("otro-modal");
    const backdrop = element("hm-modal-backdrop", [element("hm-modal")], true);

    assert.equal(shouldIgnoreBackdropClick(backdrop, otro, esCapa), false);
});

test("sin pulsacion previa no se ignora nada", () => {
    const backdrop = element("hm-modal-backdrop", [], true);

    assert.equal(shouldIgnoreBackdropClick(backdrop, null, esCapa), false);
});

test("un click que no termina en un fondo nunca se toca", () => {
    // El guardia no puede tragarse clicks normales de la app.
    const boton = element("primary-button");
    const modal = element("hm-modal", [boton]);

    assert.equal(shouldIgnoreBackdropClick(modal, boton, esCapa), false);
});

/* =========================================================
   Como esta instalado
========================================================= */

test("corre en fase de captura, antes que los modales", () => {
    // Los handlers estan en el propio fondo; un listener de captura sobre
    // document corre antes y puede detener el evento. En fase de burbuja seria
    // demasiado tarde.
    assert.match(guard, /"pointerdown",[\s\S]{0,120}true\s*\n\s*\);/);
    assert.match(guard, /"click",[\s\S]{0,200}true\s*\n\s*\);/);
    assert.match(guard, /event\.stopPropagation\(\);/);
});

test("se instala una sola vez al arrancar", () => {
    assert.match(main, /installModalBackdropGuard\(\);/);
    // Instalarlo dos veces duplicaria los listeners.
    assert.match(guard, /if \(!root \|\| root\.dataset\?\.backdropGuard === "1"\) return;/);
});

test("la pulsacion NO se limpia en pointerup", () => {
    // El orden es pointerdown -> pointerup -> click, pero el click llega en
    // otra tarea: limpiar en pointerup podia correr antes y dejar al guardia
    // sin la referencia justo cuando la necesita. Cada pulsacion nueva
    // sobrescribe la anterior, asi que no hace falta limpiarla.
    assert.doesNotMatch(guard, /addEventListener\("pointerup"/);
    assert.match(guard, /pressTarget = event\.target;/);
});
