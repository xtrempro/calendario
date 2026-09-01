// El hueco del Calendario Semanal dice como va la cobertura automatica.
//
// La campaña ya corre por etapas en el servidor, pero hasta ahora eso solo se
// veia en Inicio, que es justo donde el supervisor NO esta cuando planifica la
// semana. El hueco tampoco decia a quien le falta ni por que: era un signo de
// admiracion suelto.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (await readFile(
    new URL("../js/staffing.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const css = (await readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

/** Extrae una funcion por llaves equilibradas, saltando los parametros. */
function grab(name) {
    const start = source.search(
        new RegExp(`^(?:async )?function ${name}\\(`, "m")
    );

    assert.notEqual(start, -1, `no se encontro: ${name}`);

    let depth = 0;
    let i = source.indexOf("(", start);

    for (; i < source.length; i += 1) {
        if (source[i] === "(") depth += 1;
        else if (source[i] === ")") {
            depth -= 1;
            if (!depth) break;
        }
    }

    depth = 0;

    for (i = source.indexOf("{", i); i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") {
            depth -= 1;
            if (!depth) return source.slice(start, i + 1);
        }
    }

    throw new Error(`sin cierre: ${name}`);
}

/* ======================================================================
   Lo que muestra
   ====================================================================== */

const weeklyCampaignHTML = new Function(
    "getActiveCampaignForShift",
    "campaignStatusLabel",
    "formatCoverageTimeLeft",
    "stageLabel",
    "escapeHTML",
    `${grab("weeklyCampaignHTML")}\nreturn weeklyCampaignHTML;`
);

/** Arma la funcion con una campaña de mentira detras. */
function conCampana(campaign) {
    return weeklyCampaignHTML(
        () => campaign,
        () => "Cobertura automática · segundo tercio (2/4)",
        ms => (ms > 0 ? "19 horas" : "El turno ya empezó"),
        step => (step?.kind === "mass" ? "solicitud masiva" : "segundo tercio"),
        text => String(text)
    );
}

const CAMPAÑA = {
    steps: [
        { kind: "third", third: 1, ranAt: "2026-09-01T10:00:00.000Z" },
        { kind: "third", third: 2, ranAt: "2026-09-02T10:00:00.000Z" },
        { kind: "mass" },
        { kind: "alert" }
    ],
    shiftStartAt: new Date(Date.now() + 19 * 3600 * 1000).toISOString()
};

test("sin campaña no se dibuja nada", () => {
    // El hueco existe igual: no toda ausencia arranca una busqueda automatica.
    assert.equal(conCampana(null)("Ana", "2026-8-1"), "");
});

test("con campaña dice en que etapa va y cuanto queda", () => {
    const html = conCampana(CAMPAÑA)("Ana", "2026-8-1");

    assert.match(html, /segundo tercio/);
    assert.match(html, /quedan 19 horas/);
});

test("los puntos son las etapas ya hechas", () => {
    const html = conCampana(CAMPAÑA)("Ana", "2026-8-1");

    // Cuatro etapas, dos corridas.
    assert.equal((html.match(/<i /g) || []).length, 4);
    assert.equal((html.match(/class="is-done"/g) || []).length, 2);
});

test("las saltadas tambien cuentan como hechas", () => {
    // Una etapa puede saltarse -por ejemplo si no queda nadie elegible- y aun
    // asi la busqueda avanzo.
    const html = conCampana({
        ...CAMPAÑA,
        steps: [
            { kind: "third", third: 1, ranAt: "2026-09-01T10:00:00.000Z" },
            { kind: "third", third: 2, skipped: true },
            { kind: "mass" },
            { kind: "alert" }
        ]
    })("Ana", "2026-8-1");

    assert.equal((html.match(/class="is-done"/g) || []).length, 2);
});

test("una campaña recien creada no miente sobre su etapa", () => {
    // Ninguna oleada salio todavia.
    const html = conCampana({
        steps: [{ kind: "third", third: 1 }, { kind: "mass" }],
        shiftStartAt: CAMPAÑA.shiftStartAt
    })("Ana", "2026-8-1");

    assert.match(html, /en curso/);
    assert.equal((html.match(/class="is-done"/g) || []).length, 0);
});

test("sin hora de inicio no se inventa un tiempo restante", () => {
    const html = conCampana({
        steps: [{ kind: "mass", ranAt: "2026-09-01T10:00:00.000Z" }],
        shiftStartAt: ""
    })("Ana", "2026-8-1");

    assert.doesNotMatch(html, /quedan/);
});

test("el detalle completo va en el titulo", () => {
    // La columna es angosta: en pantalla va la version corta.
    const html = conCampana(CAMPAÑA)("Ana", "2026-8-1");

    assert.match(html, /title="Cobertura automática · segundo tercio \(2\/4\)"/);
});

/* ======================================================================
   Que este cableado
   ====================================================================== */

test("el hueco dice a quien le falta y por que", () => {
    // Antes era un signo de admiracion suelto: decia que pasaba algo, pero no
    // a quien ni por que.
    const chip = grab("renderWeeklyProfileChip");

    assert.match(chip, /<strong>Falta 1<\/strong>/);
    assert.match(chip, /item\.absence\?\.label \? ` · \$\{escapeHTML\(item\.absence\.label\)\}`/);
    assert.match(chip, /weeklyCampaignHTML\(item\.profile\.name, item\.keyDay\)/);
});

test("la campaña se consulta con el buscador de siempre", () => {
    assert.match(
        source,
        /import \{ getActiveCampaignForShift \} from "\.\/autoCoverage\.js"/
    );
    assert.match(source, /formatCoverageTimeLeft/);
    assert.match(source, /stageLabel/);
});

test("el hueco tiene estilo de caja, no de boton suelto", () => {
    assert.ok(css.includes(".staffing-weekly-replacement-slot__badge"));
    assert.ok(css.includes(".staffing-weekly-slot__stage"));
    assert.ok(css.includes(".staffing-weekly-slot__dots i.is-done"));
});

test("al pasar el mouse se marca mas, no menos", () => {
    // El fondo del hover quedo mas claro que el normal al cambiar la base.
    const hover = css.slice(
        css.indexOf(".staffing-weekly-replacement-slot:hover {"),
        css.indexOf("}", css.indexOf(".staffing-weekly-replacement-slot:hover {"))
    );

    assert.match(hover, /background: rgba\(248, 113, 113, 0\.16\)/);
});

test("el hueco se puede alcanzar con el teclado", () => {
    assert.ok(css.includes(".staffing-weekly-replacement-slot:focus-visible"));
});
