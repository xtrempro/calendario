// Evita que un modal se cierre al soltar el mouse sobre su fondo cuando el
// arrastre EMPEZO adentro.
//
// El caso: se hace click dentro de un campo de texto y se arrastra para
// seleccionar; al soltar, el puntero quedo fuera del campo. El navegador
// dispara entonces un "click" cuyo target es el ancestro comun de donde se
// presiono y donde se solto, que suele ser el fondo del modal. Los modales
// cierran cuando el target del click es el fondo, asi que se cerraban solos y
// se perdia lo que se estaba escribiendo.
//
// Se arregla en UN solo lugar y no en los 37 sitios que comprueban el fondo:
// un listener en fase de captura sobre document corre ANTES que los handlers
// del modal, asi que detener ahi el evento los deja sin efecto.
//
// El click legitimo al fondo -presionar y soltar sobre el fondo- no se toca:
// ahi el elemento donde se presiono y el target del click son el mismo.

const BACKDROP_PATTERN = /(^|\s)[\w-]*backdrop([\w-]*)?(\s|$)/;

let pressTarget = null;

function hasBackdropName(element) {
    return Boolean(
        element &&
        element.nodeType === 1 &&
        typeof element.className === "string" &&
        BACKDROP_PATTERN.test(element.className)
    );
}

/**
 * Una capa que cubre la pantalla y que, al recibir un click sobre si misma,
 * cierra el modal que contiene.
 *
 * La primera version miraba SOLO el nombre de la clase, y por eso no arreglaba
 * el buscador de trabajadores: su capa se llama "profile-search-modal", sin la
 * palabra "backdrop". Ahora la señal principal es estructural -posicion fija
 * cubriendo la pantalla-, que no depende de como se llame nada y sirve para
 * cualquier modal que se agregue despues.
 */
function isOverlayElement(element) {
    if (!element || element.nodeType !== 1) return false;
    if (hasBackdropName(element)) return true;

    const view = element.ownerDocument?.defaultView;

    if (!view?.getComputedStyle || !element.getBoundingClientRect) return false;

    if (view.getComputedStyle(element).position !== "fixed") return false;

    const rect = element.getBoundingClientRect();

    // "Casi toda la pantalla": un 90% evita que un margen o un borde dejen
    // fuera a una capa que en la practica cubre todo.
    return rect.width >= view.innerWidth * 0.9 &&
        rect.height >= view.innerHeight * 0.9;
}

/**
 * Decide si un click sobre la capa hay que descartar.
 *
 * Exportada, y con el detector de capa inyectable, para poder probarla sin un
 * navegador.
 *
 * @param {EventTarget} target elemento donde termino el click
 * @param {EventTarget} pressed elemento donde empezo la pulsacion
 * @param {(element: any) => boolean} [isOverlay]
 * @returns {boolean}
 */
export function shouldIgnoreBackdropClick(
    target,
    pressed,
    isOverlay = isOverlayElement
) {
    if (!pressed || pressed === target) return false;
    if (!isOverlay(target)) return false;

    // Solo si el arrastre venia de DENTRO de ese mismo modal. Si empezo en otra
    // parte de la pantalla, cerrar es lo correcto.
    return typeof target.contains === "function" && target.contains(pressed);
}

export function installModalBackdropGuard(root = document) {
    if (!root || root.dataset?.backdropGuard === "1") return;

    if (root.dataset) root.dataset.backdropGuard = "1";

    root.addEventListener(
        "pointerdown",
        event => {
            pressTarget = event.target;
        },
        true
    );

    // NO se limpia en "pointerup". El orden es pointerdown -> pointerup ->
    // click, pero el click llega en otra tarea: un setTimeout en pointerup
    // podria correr antes y dejar el guardia sin la referencia justo cuando la
    // necesita.
    //
    // No hace falta: cada pulsacion nueva sobrescribe la anterior, asi que
    // pressTarget siempre es la del gesto en curso. Un click de teclado (Enter
    // sobre un boton) tampoco molesta, porque su target es el boton y nunca un
    // fondo.

    root.addEventListener(
        "click",
        event => {
            if (!shouldIgnoreBackdropClick(event.target, pressTarget)) return;

            event.stopPropagation();
            event.preventDefault();
        },
        true
    );
}

export const MODAL_BACKDROP_GUARD_INTERNALS = {
    hasBackdropName,
    isOverlayElement
};
