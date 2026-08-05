// El parpadeo de las solicitudes de permiso pendientes (calendario + timeline)
// se sincroniza alineando cada elemento a un reloj comun: animation-delay
// negativo = -(Date.now() % 1750). Asi todos quedan en la misma fase sin
// importar cuando se crearon.
import test from "node:test";
import assert from "node:assert/strict";

const makeEl = () => ({ style: {} });

test("syncPendingLeaveBlink alinea todos los elementos al mismo delay", async () => {
    const elements = [makeEl(), makeEl(), makeEl(), makeEl()];
    let selector = "";

    globalThis.document = {
        documentElement: { offsetWidth: 0 },
        querySelectorAll(sel) {
            selector = sel;
            return elements;
        }
    };

    const { syncPendingLeaveBlink } = await import(
        "../js/pendingLeaveBlinkSync.js"
    );

    syncPendingLeaveBlink();

    // Cubre las cuatro clases animadas (nombre primario/alterno + color de
    // calendario y de timeline).
    assert.match(selector, /\.day-label__primary/);
    assert.match(selector, /\.day-label__alternate/);
    assert.match(selector, /\.pending-leave-color-overlay/);
    assert.match(selector, /\.timeline-leave-overlay/);

    const delays = elements.map(element => element.style.animationDelay);

    // Todos con el MISMO delay (misma fase global) y negativo dentro del periodo.
    assert.ok(
        delays.every(delay => delay === delays[0]),
        "todos los elementos deben compartir el mismo animation-delay"
    );
    assert.match(delays[0], /^-\d+ms$/);

    const ms = Number(delays[0].replace(/[-ms]/g, ""));
    assert.ok(ms >= 0 && ms < 1750, "el delay debe caer dentro del periodo 1750");
});

test("main.js inicializa la sincronizacion del parpadeo", async () => {
    const { readFile } = await import("node:fs/promises");
    const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");

    assert.match(
        main,
        /import \{ initPendingLeaveBlinkSync \} from "\.\/pendingLeaveBlinkSync\.js"/
    );
    assert.match(main, /initPendingLeaveBlinkSync\(\)/);
});
