// El modal "Respaldar horas extras" (el del signo ? sobre un turno extra).
//
// Un turno extra puede tener DOS tramos -por ejemplo un 24h sobre una base
// Diurno, que se descompone en Larga y Noche- y cada uno necesita su propio
// respaldo. El modal los apilaba uno debajo del otro y cortaba la informacion:
// el supervisor asociaba la ausencia al primero, no veia el segundo, y recien
// al guardar se enteraba de que faltaba. Ademas habia que bajar hasta el fondo
// para llegar al boton de guardar, incluso con un solo tramo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const calendar = await read("../js/calendar.js");
const css = await read("../styles.css");

// Extrae una funcion del fuente por llaves equilibradas. Primero salta la lista
// de parametros contando parentesis: esta funcion recibe un objeto
// desestructurado, y sus llaves no son el cuerpo.
function grab(name) {
    const start = calendar.indexOf(`function ${name}(`);

    assert.notEqual(start, -1, `no se encontro: ${name}`);

    let depth = 0;
    let i = calendar.indexOf("(", start);

    for (; i < calendar.length; i += 1) {
        if (calendar[i] === "(") depth += 1;
        else if (calendar[i] === ")") {
            depth -= 1;
            if (!depth) break;
        }
    }

    depth = 0;

    for (i = calendar.indexOf("{", i); i < calendar.length; i += 1) {
        if (calendar[i] === "{") depth += 1;
        else if (calendar[i] === "}") {
            depth -= 1;
            if (!depth) return calendar.slice(start, i + 1);
        }
    }

    throw new Error(`sin cierre: ${name}`);
}

// El armador del HTML solo necesita cuatro ayudantes; se le pasan de mentira.
const env = {
    escapeHTML: value => String(value ?? ""),
    turnoReplacementLabel: turno => ({ 1: "Larga", 2: "Noche", 3: "24h" })[turno] || "",
    manualExtraReasonPresetButtonsHTML: () => "<button>Estación de Trabajo</button>",
    formatClockHoursForDialog: () => "2 h"
};
const construir = new Function(
    ...Object.keys(env),
    `${grab("extraReasonDialogHTML")}\nreturn extraReasonDialogHTML;`
)(...Object.values(env));

const tramo = (id, label, matches = []) => ({ id, label, matches });
const coincidencia = nombre => ({
    profile: { name: nombre },
    coveredTurn: 2,
    absenceType: "F. Legal",
    exactMatch: true
});

const UN_TRAMO = {
    profileName: "YESSICA",
    pendingTurn: 2,
    manualSections: [tramo("N", "Noche", [coincidencia("FERNANDA")])],
    clockHours: null,
    hasClockSection: false
};
const DOS_TRAMOS = {
    profileName: "YESSICA",
    pendingTurn: 3,
    manualSections: [
        tramo("L", "Larga"),
        tramo("N", "Noche", [coincidencia("FERNANDA")])
    ],
    clockHours: null,
    hasClockSection: false
};

/* ======================================================================
   Dos tramos, dos columnas
   ====================================================================== */

test("con dos tramos el modal se ensancha y los reparte en dos columnas", () => {
    const html = construir(DOS_TRAMOS);

    assert.match(html, /overtime-backup-dialog--split/);
    assert.match(html, /overtime-backup-grid--split/);
    // Los dos tramos estan, cada uno con su caja de motivo.
    assert.match(html, /data-manual-section="L"/);
    assert.match(html, /data-manual-section="N"/);
    assert.match(html, /data-manual-reason="L"/);
    assert.match(html, /data-manual-reason="N"/);
});

test("con un solo tramo no se ensancha ni se parte", () => {
    const html = construir(UN_TRAMO);

    assert.doesNotMatch(html, /overtime-backup-dialog--split/);
    assert.doesNotMatch(html, /overtime-backup-grid--split/);
    assert.match(html, /overtime-backup-grid/);
});

test("el texto avisa que son DOS respaldos, no uno", () => {
    // Es lo que el supervisor no alcanzaba a ver.
    assert.match(construir(DOS_TRAMOS), /DOS tramos y cada uno necesita su respaldo/);
    assert.doesNotMatch(construir(UN_TRAMO), /DOS tramos/);
});

/* ======================================================================
   Cada tramo dice si le falta
   ====================================================================== */

test("cada tramo nace marcado como pendiente", () => {
    const html = construir(DOS_TRAMOS);

    assert.match(html, /data-section-state="L"[^>]*>Falta</);
    assert.match(html, /data-section-state="N"[^>]*>Falta</);
});

test("el indicador se actualiza al elegir ausencia o al escribir el motivo", () => {
    // La marca la mueven los mismos manejadores que ya existian.
    assert.match(calendar, /const setSectionState = \(sectionId, done\) => \{/);
    // Tres estados desde que un tramo se puede apartar con "Sin motivo aun".
    assert.match(calendar, /chip\.textContent = skipped/);
    assert.match(calendar, /\(done \? "Listo" : "Falta"\)/);
    assert.match(calendar, /setSectionState\(sectionId, true\);/);
    // Y borrar el motivo escrito devuelve el tramo a "Falta", salvo que haya
    // una ausencia elegida.
    assert.match(
        calendar,
        /setSectionState\(\s*\n\s*sectionId,\s*\n\s*selectedMatches\.has\(sectionId\)\s*\n\s*\);/
    );
});

test("al guardar, el tramo que falta se marca y se trae a la vista", () => {
    // Con dos tramos, el que falta puede ser justo el que quedo fuera de
    // pantalla: avisar sin mostrarlo no sirve de nada.
    assert.match(calendar, /pendiente\?\.classList\.add\("is-missing"\)/);
    assert.match(calendar, /pendiente\?\.scrollIntoView\(\{ block: "nearest" \}\)/);
    assert.match(calendar, /Falta respaldar el tramo \$\{missingManualBackup\.section\.label\}/);
});

/* ======================================================================
   El boton de guardar no se va con el scroll
   ====================================================================== */

test("el cuerpo va en su propio contenedor, separado de las acciones", () => {
    const html = construir(DOS_TRAMOS);
    const cuerpo = html.indexOf('class="overtime-backup-body"');
    // El pie lleva ademas overtime-backup-actions desde que hay un tercer boton
    // ("Quitar turno extra"), asi que se busca por el prefijo de la clase.
    const acciones = html.indexOf('class="turn-change-dialog__actions');

    assert.notEqual(cuerpo, -1, "falta el contenedor del cuerpo");
    assert.ok(cuerpo < acciones, "las acciones van despues del cuerpo");
    // Y fuera de el: si estuvieran dentro, se irian con el scroll.
    const fin = html.indexOf("</div>", html.indexOf("overtime-backup-body"));

    assert.ok(acciones > fin, "las acciones quedaron dentro del cuerpo");
});

test("scrollea el cuerpo, no el modal entero", () => {
    // Es lo que obligaba a bajar hasta el fondo para guardar, aun con un tramo.
    assert.match(
        css,
        /\.overtime-backup-dialog \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*overflow: hidden;[^}]*\}/s
    );
    assert.match(
        css,
        /\.overtime-backup-body \{[^}]*overflow: auto;[^}]*\}/s
    );
    assert.match(
        css,
        /\.overtime-backup-dialog \.turn-change-dialog__actions \{[^}]*flex: none;[^}]*\}/s
    );
});

test("los motivos predefinidos tienen scroll propio", () => {
    // Son catorce botones POR TRAMO: eran los que estiraban el modal.
    assert.match(
        css,
        /\.overtime-backup-subsection \.replacement-dialog-toolbar \{[^}]*max-height: 168px;[^}]*overflow: auto;[^}]*\}/s
    );
});

test("en pantalla angosta las dos columnas vuelven a una", () => {
    assert.match(
        css,
        /@media \(max-width: 820px\) \{\s*\n\s*\.overtime-backup-grid--split \{\s*\n\s*grid-template-columns: minmax\(0, 1fr\);/
    );
});
