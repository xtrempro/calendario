// Cada turno sin cubrir de la tarjeta de inicio trae dos acciones: ver el dia en
// el calendario, y "cobertura automatica", que manda la solicitud de reemplazo a
// todos los candidatos con la app enlazada (lo mismo que abrir el cuadro de
// sugerencias, activar "Solicitar aprobacion" y marcar a todos).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const home = await read("../js/home.js");
const calendar = await read("../js/calendar.js");
const main = await read("../js/main.js");

function block(source, signature, length = 4000) {
    const start = source.indexOf(signature);

    assert.notEqual(start, -1, `no se encontro: ${signature}`);

    return source.slice(start, start + length);
}

test("los turnos sin cubrir traen los dos botones", () => {
    assert.match(home, />VER EN CALENDARIO</);
    // El rotulo del segundo depende del estado: pasa a "SOLICITUD ENVIADA" y se
    // deshabilita mientras haya solicitudes vivas, para no mandar dos tandas a
    // los mismos telefonos (ver solicitud-cobertura-en-espera.test.mjs).
    assert.match(home, /"SOLICITUD ENVIADA" : "COBERTURA AUTOMÁTICA"/);
    // Solo en los sin cubrir: un preasignado ya tiene sus propias acciones.
    assert.match(home, /kind === "sincubrir" && item\.keyDay/);
    // La fila carga el dia en los dos formatos que necesita cada accion.
    assert.match(home, /keyDay,\s*\n\s*iso: isoFromKey\(keyDay\)/);
});

test("ver en calendario reusa el salto que ya existia", () => {
    // El mismo evento de "ver en el calendario" de las solicitudes: salta al
    // mes, selecciona al trabajador y abre Turnos.
    assert.match(
        home,
        /proturnos:viewWorkerRequestInCalendar[\s\S]{0,220}profile: button\.dataset\.cobProfile[\s\S]{0,80}date: button\.dataset\.cobIso/
    );
    assert.match(main, /addEventListener\(\s*\n\s*"proturnos:viewWorkerRequestInCalendar"/);
});

test("la cobertura automatica usa el motor real de candidatos", () => {
    const auto = block(calendar, "window.runAutomaticCoverage = async");

    // NO la heuristica del inicio: mandar solicitudes con una lista aproximada
    // seria peor que no mandarlas.
    assert.match(auto, /await getReplacementCandidates\(name, keyDay\)/);
    assert.doesNotMatch(auto, /getAvailableCandidates/);
    // Y respeta el turno que realmente hay que cubrir.
    assert.match(auto, /getReplacementNeededTurn\(name, keyDay\)/);
});

test("solo se envia a quien puede cubrir y tiene la app", () => {
    const auto = block(calendar, "window.runAutomaticCoverage = async");

    // Forzados, dias bloqueados y unidades enlazadas quedan fuera del masivo.
    assert.match(auto, /!candidate\.isForced/);
    assert.match(auto, /!candidate\.blockedDay/);
    assert.match(auto, /!candidate\.isLinked/);
    // El filtro por app enlazada es el que pidio el usuario.
    assert.match(auto, /getWorkerAppLinkForProfile\(candidate\.profile\.name\)/);
    // Y no se duplica una solicitud ya pendiente.
    assert.match(auto, /getPendingReplacementRequestsForShift\(name, keyDay, neededTurn\)/);
    assert.match(auto, /!pending\.has\(candidate\.profile\.name\)/);
});

test("crea las solicitudes con el mismo contrato que el cuadro", () => {
    const auto = block(calendar, "window.runAutomaticCoverage = async");

    assert.match(auto, /createReplacementRequests\(/);
    assert.match(auto, /source: "replacement_request"/);
    assert.match(auto, /replaced: name/);
    assert.match(auto, /turno: neededTurn/);
    // La cobertura diurno-larga viaja por trabajador, como en el cuadro.
    assert.match(auto, /diurnoLongCoverageWorkers: targets/);
    assert.match(auto, /workerCoverage: Object\.fromEntries\(/);
});

test("respeta la configuracion del entorno", () => {
    const auto = block(calendar, "window.runAutomaticCoverage = async");

    // Si el entorno desactivo la solicitud de aprobacion, no se envia nada.
    assert.match(
        auto,
        /getReplacementRequestConfig\(\)\.enableWorkerAcceptanceRequest === false/
    );
    assert.match(auto, /return \{ status: "disabled" \};/);
});

test("cada resultado tiene su propio aviso", () => {
    const announce = block(home, "function announceAutomaticCoverage(result)", 2600);

    // "No se envio nada" por falta de candidatos no es lo mismo que porque
    // ninguno tiene la app, ni que porque ya tenian solicitud.
    assert.match(announce, /No hay trabajadores que puedan cubrir ese turno/);
    assert.match(announce, /ya tienen una solicitud pendiente/);
    assert.match(announce, /Ninguno de los candidatos tiene la app enlazada/);
    assert.match(announce, /Solicitud enviada a \$\{result\.sent\}/);
    assert.match(announce, /status === "disabled"/);
});

test("el boton se bloquea mientras envia", () => {
    // Sin esto un doble click mandaba dos veces la misma solicitud.
    assert.match(home, /button\.disabled = true;\s*\n\s*button\.textContent = "ENVIANDO\.\.\.";/);
    assert.match(home, /finally \{\s*\n\s*button\.disabled = false;/);
});
