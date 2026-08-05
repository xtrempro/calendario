// Sincroniza el parpadeo de las solicitudes de permiso pendientes: TODAS las
// celdas que parpadean (calendario principal y timeline) comparten el mismo
// ciclo/fase, sin desfase.
//
// Cada elemento arranca su animacion CSS al insertarse en el DOM (a distinto
// tiempo segun cuando se renderiza), lo que las dejaba parpadeando desfasadas.
// Aqui se alinean todas a un mismo reloj: un animation-delay NEGATIVO igual a
// -(Date.now() % periodo). Con esa formula, un elemento aplicado en el instante
// t queda en la fase global (t mod periodo); como todos usan la misma formula y
// el mismo periodo, quedan en la MISMA fase sin importar cuando se crearon, y
// las cuatro animaciones coordinadas (nombre primario/alterno + color en el
// calendario y en el timeline) mantienen su coordinacion entre si.
//
// Re-aplicar el delay es transparente: alinea a la fase global actual, que es la
// que un elemento ya sincronizado tiene; uno nuevo salta a fase al instante.

const BLINK_PERIOD_MS = 1750;
const BLINK_SELECTOR = [
    ".day-label__primary",
    ".day-label__alternate",
    ".pending-leave-color-overlay",
    ".timeline-leave-overlay"
].join(",");

let scheduled = false;

export function syncPendingLeaveBlink() {
    if (typeof document === "undefined") return;

    const elements = document.querySelectorAll(BLINK_SELECTOR);

    if (!elements.length) return;

    // Cambiar animation-delay a una animacion ya en curso NO la reposiciona (el
    // delay solo aplica al inicio). Para forzar la fase hay que REINICIAR la
    // animacion: se apaga en todos, se fuerza un reflow y se restaura con el
    // mismo delay. Al reiniciar todos en el mismo instante t con el mismo delay
    // -(t % periodo), quedan en la fase global (t % periodo) y siguen en fase
    // (misma duracion, infinita). Reiniciar a esa fase es transparente: es la
    // que un elemento ya sincronizado tiene, y uno nuevo salta a ella al vuelo.
    const delay = `-${Date.now() % BLINK_PERIOD_MS}ms`;

    elements.forEach(element => {
        element.style.animation = "none";
    });

    // Un solo reflow para que el navegador vea el reinicio.
    void document.documentElement.offsetWidth;

    elements.forEach(element => {
        element.style.animation = "";
        element.style.animationDelay = delay;
    });
}

function scheduleSync() {
    if (scheduled) return;

    scheduled = true;

    const run = () => {
        scheduled = false;
        syncPendingLeaveBlink();
    };

    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(run);
    } else {
        setTimeout(run, 16);
    }
}

export function initPendingLeaveBlinkSync() {
    if (
        typeof document === "undefined" ||
        typeof MutationObserver !== "function"
    ) {
        return;
    }

    // Re-sincroniza cuando el calendario o el timeline cambian su DOM (cualquier
    // render/actualizacion incremental crea o recrea las celdas que parpadean,
    // incluidas las filas cacheadas del timeline). Se agrupan las mutaciones en
    // un solo pase por frame.
    const observer = new MutationObserver(scheduleSync);
    const observe = element => {
        if (element) {
            observer.observe(element, { childList: true, subtree: true });
        }
    };

    observe(document.getElementById("calendar"));
    observe(document.getElementById("teamTimeline"));

    // Alinea lo que ya este presente al iniciar.
    scheduleSync();
}
