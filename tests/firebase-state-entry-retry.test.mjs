import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Un cambio local que se encola sin timer no da error: simplemente nunca sube.
// El usuario lo ve aplicado, y cuando vence su proteccion local de 30 minutos
// el estado remoto lo pisa y "desaparece solo". Estas pruebas sujetan los tres
// puntos donde eso podia pasar.

const readSource = () => readFile(
    new URL("../js/firebaseAppState.js", import.meta.url),
    "utf8"
);

test("encolar un cambio con el estado remoto aplicandose deja un reintento", async () => {
    const source = await readSource();

    assert.match(
        source,
        /function queuePartialStateEntries[\s\S]{0,500}if \(applyingRemoteState \|\| waitingInitialState\) \{\s*\n\s*scheduleEntrySyncRetry\(\);/
    );
});

test("el envio bloqueado se reprograma en vez de devolver en silencio", async () => {
    const source = await readSource();

    assert.match(
        source,
        /async function flushPartialStateEntries[\s\S]{0,400}if \(applyingRemoteState \|\| waitingInitialState \|\| entrySyncInFlight\) \{\s*\n\s*scheduleEntrySyncRetry\(\);/
    );
});

test("al terminar el apply remoto se le devuelve el turno al envio local", async () => {
    const source = await readSource();

    // El apply remoto es justo la condicion que bloquea el envio local: si al
    // terminar no avisa, lo encolado se queda sin nadie que lo reintente.
    assert.match(
        source,
        /remoteApplyInFlight = false;[\s\S]{0,800}if \(pendingStateEntries\.size\) \{\s*\n\s*scheduleEntrySyncRetry\(\);/
    );
});

test("el reintento existe aparte porque scheduleEntrySync descarta la programacion", async () => {
    const source = await readSource();

    // `scheduleEntrySync` sigue abandonando ante las condiciones transitorias;
    // por eso el reintento programa el timer por su cuenta.
    assert.match(source, /function scheduleEntrySyncRetry\(delay = ENTRY_BLOCKED_RETRY_MS\)/);
    assert.match(
        source,
        /function scheduleEntrySyncRetry[\s\S]{0,300}entrySyncTimer = setTimeout\(flushPartialStateEntries, delay\)/
    );
    assert.match(source, /const ENTRY_BLOCKED_RETRY_MS = \d+;/);
});

test("el reintento no se programa si no hay nada encolado ni workspace", async () => {
    const source = await readSource();

    // Sin este guardia el timer se reprogramaria solo para siempre.
    assert.match(
        source,
        /function scheduleEntrySyncRetry[\s\S]{0,200}if \(!pendingStateEntries\.size \|\| !activeWorkspaceId\) return;/
    );
});
