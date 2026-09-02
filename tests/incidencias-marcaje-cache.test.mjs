// Las incidencias de marcaje del inicio se guardan calculadas porque tardan,
// pero la copia estaba indexada SOLO por mes: una vez calculado un mes, no se
// volvia a calcular pasara lo que pasara con los datos.
//
// El caso real: a un trabajador le figuraba "sin marcaje de entrada" el 01/08
// porque ese dia le faltaba aplicar un cambio de turno. Al aplicarlo el dia
// quedo Libre -el detalle ya lo mostraba asi, porque se recalcula al abrirlo-
// pero la lista seguia contandolo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const home = (await readFile(
    new URL("../js/home.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

// Extrae una funcion por llaves equilibradas, saltando la lista de parametros.
function grab(name) {
    const start = home.search(
        new RegExp(`^(?:async )?function ${name}\\(`, "m")
    );

    assert.notEqual(start, -1, `no se encontro: ${name}`);

    let depth = 0;
    let i = home.indexOf("(", start);

    for (; i < home.length; i += 1) {
        if (home[i] === "(") depth += 1;
        else if (home[i] === ")") {
            depth -= 1;
            if (!depth) break;
        }
    }

    depth = 0;

    for (i = home.indexOf("{", i); i < home.length; i += 1) {
        if (home[i] === "{") depth += 1;
        else if (home[i] === "}") {
            depth -= 1;
            if (!depth) return home.slice(start, i + 1);
        }
    }

    throw new Error(`sin cierre: ${name}`);
}

const decide = new Function(
    `${home.slice(
        home.indexOf("const INCIDENT_STATE_PREFIXES"),
        home.indexOf("/**\n * Tira la lista guardada")
    )}\nreturn affectsAttendanceIncidents;`
)();

/* ======================================================================
   Que cambios obligan a recalcular
   ====================================================================== */

test("un cambio de turno invalida las incidencias", () => {
    // Es el caso reportado: aplicar el cambio deja el dia Libre y la incidencia
    // deja de existir.
    assert.equal(decide(["swaps"]), true);
});

test("tambien los turnos, permisos y marcajes del trabajador", () => {
    [
        "data_ANA",
        "baseData_ANA",
        "admin_ANA",
        "legal_ANA",
        "comp_ANA",
        "absences_ANA",
        "clockMarks_ANA",
        "rotativa_ANA",
        "shift_ANA",
        "shiftAssignmentHistory_ANA"
    ].forEach(key => {
        assert.equal(decide([key]), true, key);
    });
});

test("y lo compartido que cambia lo que se espera de un dia", () => {
    [
        "shiftMoves",
        "replacements",
        "attendanceMarks",
        "workerSchedules",
        "profiles",
        "manualHolidays",
        "turnChangeConfig"
    ].forEach(key => {
        assert.equal(decide([key]), true, key);
    });
});

test("lo que no tiene nada que ver, no obliga a recalcular", () => {
    // Recalcular el mes entero es caro: no se hace por cualquier cosa.
    [
        "memos",
        "agenda_contacts",
        "kanban_private_x",
        "auditLog",
        "staffing_applicants",
        "weekly_task_assignment_entries"
    ].forEach(key => {
        assert.equal(decide([key]), false, key);
    });

    assert.equal(decide([]), false);
});

test("basta con que UNA de las claves cambiadas importe", () => {
    assert.equal(decide(["memos", "swaps"]), true);
    assert.equal(decide(["memos", "auditLog"]), false);
});

/* ======================================================================
   Que la invalidacion este realmente cableada
   ====================================================================== */

test("la copia guardada se tira cuando cambian los datos", () => {
    assert.match(home, /export function invalidateAttendanceIncidents\(\) \{\s*\n\s*incidenciasCache = null;/);
    assert.match(home, /window\.addEventListener\("proturnos:persistenceChanged", alCambiarEstado\)/);
});

test("los cambios de otro supervisor tambien la tiran", () => {
    // Llegan por el estado remoto, no por una edicion local.
    assert.match(
        home,
        /"proturnos:firebaseAppState"[\s\S]{0,200}app-state-entries-applied[\s\S]{0,160}alCambiarEstado/
    );
});

test("solo se repinta si el inicio esta a la vista", () => {
    // Si no lo esta, ya se recalcula al entrar: no hay que pagar el barrido.
    assert.match(
        home,
        /activeView === "home"[\s\S]{0,140}cargarIncidencias\(panel\)/
    );
});

test("el cuadro de detalle abierto se repinta con lo recien calculado", () => {
    // Sin esto seguiria mostrando la incidencia que acaba de dejar de existir.
    const refresco = grab("refrescarDetalleIncidencias");

    assert.match(refresco, /if \(!modal \|\| modal\.hidden\) return;/);
    assert.match(refresco, /incidenciasDetalleHTML\(kind\)/);
    // El tipo abierto queda anotado al abrirlo, que es lo que permite repintar.
    assert.match(home, /cuerpo\.dataset\.kind = kind;/);
    assert.match(grab("cargarIncidencias"), /refrescarDetalleIncidencias\(panel\)/);
});

test("la copia sigue sirviendo mientras nada cambie", () => {
    // El calculo tarda: sin copia, cada pintada del inicio barreria el mes.
    assert.match(
        grab("cargarIncidencias"),
        /if \(incidenciasCache\?\.key === incidenciasMesKey\(incidenciasMes\)\) \{/
    );
});
