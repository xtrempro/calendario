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

const { isBackdrop } = MODAL_BACKDROP_GUARD_INTERNALS;

const guard = (await readFile(
    new URL("../js/modalBackdropGuard.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
const main = (await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

// Elementos de mentira, con lo minimo que mira el guardia.
function element(className, children = []) {
    const node = {
        nodeType: 1,
        className,
        children,
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
            isBackdrop(element(className)),
            true,
            `no reconocio "${className}"`
        );
    });
});

test("no confunde otros elementos con un fondo", () => {
    ["hm-modal", "settings-card", "day", ""].forEach(className => {
        assert.equal(isBackdrop(element(className)), false, className);
    });
    // Y no se cae con cosas que no son elementos.
    assert.equal(isBackdrop(null), false);
    assert.equal(isBackdrop({ nodeType: 3 }), false);
});

/* =========================================================
   La regla
========================================================= */

test("arrastrar desde un campo y soltar en el fondo NO cierra", () => {
    // El caso reportado: seleccionar texto en un combobox y soltar afuera.
    const input = element("search-input");
    const backdrop = element("hm-modal-backdrop", [
        element("hm-modal", [input])
    ]);

    assert.equal(shouldIgnoreBackdropClick(backdrop, input), true);
});

test("un click de verdad en el fondo SI cierra", () => {
    // Presionar y soltar sobre el fondo: es la forma de cerrar y debe seguir
    // funcionando.
    const backdrop = element("hm-modal-backdrop", []);

    assert.equal(shouldIgnoreBackdropClick(backdrop, backdrop), false);
});

test("un arrastre que viene de OTRO modal si cierra", () => {
    // Si la pulsacion empezo fuera de este modal, soltar sobre su fondo es un
    // click al fondo legitimo.
    const otro = element("otro-modal");
    const backdrop = element("hm-modal-backdrop", [element("hm-modal")]);

    assert.equal(shouldIgnoreBackdropClick(backdrop, otro), false);
});

test("sin pulsacion previa no se ignora nada", () => {
    const backdrop = element("hm-modal-backdrop");

    assert.equal(shouldIgnoreBackdropClick(backdrop, null), false);
});

test("un click que no termina en un fondo nunca se toca", () => {
    // El guardia no puede tragarse clicks normales de la app.
    const boton = element("primary-button");
    const modal = element("hm-modal", [boton]);

    assert.equal(shouldIgnoreBackdropClick(modal, boton), false);
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
