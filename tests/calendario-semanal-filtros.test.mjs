// La barra del Calendario Semanal.
//
// Los tres desplegables pasaron a chips: se ven sin abrir nada y se COMBINAN
// -Larga y Noche juntos, que es la pregunta del 4to turno-, cosa que una
// opcion unica no permitia.
//
// La seleccion sigue viajando como un string separado por comas porque es lo
// que entra en la firma de la cache y en los overrides de render.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (await readFile(
    new URL("../js/staffing.js", import.meta.url),
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

const WEEKLY_SHIFTS = [
    { key: "diurno", label: "Diurno" },
    { key: "larga", label: "Larga" },
    { key: "noche", label: "Noche" }
];

const load = names => new Function(
    "WEEKLY_SHIFTS",
    "WEEKLY_ALL_LEAVES",
    "WEEKLY_NO_ESTAMENTO",
    "STAFFING_ESTAMENTOS",
    "normalizeStaffingEstamento",
    "weeklyProfileProfession",
    `${names.map(grab).join("\n")}\nreturn { ${names.join(", ")} };`
)(
    WEEKLY_SHIFTS,
    "leaves",
    "__sin__",
    ["Profesional", "Técnico", "Administrativo", "Auxiliar"],
    value => String(value || "").trim(),
    profile => String(profile?.profession || "").trim()
);

const { weeklyTokens, weeklyToggleToken } = load([
    "weeklyTokens",
    "weeklyToggleToken"
]);

/* ======================================================================
   Un filtro que guarda varios
   ====================================================================== */

test("sin nada marcado, el filtro esta en Todos", () => {
    assert.deepEqual(weeklyTokens("Todos", "Todos"), []);
    assert.deepEqual(weeklyTokens("", "Todos"), []);
    assert.deepEqual(weeklyTokens(undefined, "Todos"), []);
    // "Todas" es el vacio del filtro de profesion.
    assert.deepEqual(weeklyTokens("Todas", "Todas"), []);
});

test("marcar uno lo deja solo", () => {
    assert.equal(weeklyToggleToken("Todos", "shift:larga", "Todos"), "shift:larga");
});

test("marcar dos los deja a los dos", () => {
    const uno = weeklyToggleToken("Todos", "shift:larga", "Todos");
    const dos = weeklyToggleToken(uno, "shift:noche", "Todos");

    assert.deepEqual(weeklyTokens(dos, "Todos"), ["shift:larga", "shift:noche"]);
});

test("volver a tocarlo lo apaga", () => {
    const dos = weeklyToggleToken("shift:larga", "shift:noche", "Todos");

    assert.equal(weeklyToggleToken(dos, "shift:noche", "Todos"), "shift:larga");
});

test("apagar el ultimo vuelve a Todos", () => {
    // Y no a una lista vacia, que significaria "no mostrar nada".
    assert.equal(weeklyToggleToken("shift:larga", "shift:larga", "Todos"), "Todos");
    assert.equal(weeklyToggleToken("Enfermería", "Enfermería", "Todas"), "Todas");
});

test("un chip no se marca dos veces", () => {
    const uno = weeklyToggleToken("Todos", "Técnico", "Todos");
    const otra = weeklyToggleToken(uno, "Administrativo", "Todos");

    assert.equal(weeklyTokens(otra, "Todos").length, 2);
});

/* ======================================================================
   A quien deja pasar
   ====================================================================== */

const { weeklyProfileMatchesFilters } = load([
    "weeklyTokens",
    "weeklyProfileMatchesFilters"
]);

const perfil = (estamento, profession = "") => ({ estamento, profession });

test("sin filtros pasan todos", () => {
    assert.equal(
        weeklyProfileMatchesFilters(perfil("Técnico"), "Todos", "Todas"),
        true
    );
});

test("con un estamento marcado pasa solo ese", () => {
    assert.equal(
        weeklyProfileMatchesFilters(perfil("Técnico"), "Técnico", "Todas"),
        true
    );
    assert.equal(
        weeklyProfileMatchesFilters(perfil("Profesional"), "Técnico", "Todas"),
        false
    );
});

test("con dos marcados pasan los dos", () => {
    const filtro = "Profesional,Técnico";

    assert.equal(weeklyProfileMatchesFilters(perfil("Profesional"), filtro), true);
    assert.equal(weeklyProfileMatchesFilters(perfil("Técnico"), filtro), true);
    assert.equal(weeklyProfileMatchesFilters(perfil("Auxiliar"), filtro), false);
});

test("quien tiene la ficha incompleta tiene su propio chip", () => {
    // Sin el, al marcar cualquier estamento desaparecia y no habia forma de
    // llegar a el.
    assert.equal(weeklyProfileMatchesFilters(perfil(""), "__sin__"), true);
    assert.equal(weeklyProfileMatchesFilters(perfil("Matrona"), "__sin__"), true);
    assert.equal(weeklyProfileMatchesFilters(perfil("Técnico"), "__sin__"), false);
    // Y no se cuela cuando no esta marcado.
    assert.equal(weeklyProfileMatchesFilters(perfil(""), "Técnico"), false);
});

test("la profesion afina, no reemplaza", () => {
    const enfermera = perfil("Profesional", "Enfermería");
    const kine = perfil("Profesional", "Kinesiología");

    assert.equal(weeklyProfileMatchesFilters(enfermera, "Profesional", "Enfermería"), true);
    assert.equal(weeklyProfileMatchesFilters(kine, "Profesional", "Enfermería"), false);
    assert.equal(
        weeklyProfileMatchesFilters(kine, "Profesional", "Enfermería,Kinesiología"),
        true
    );
});

/* ======================================================================
   Lo que ya no existe se suelta
   ====================================================================== */

const { normalizeWeeklyTypeFilter } = load([
    "weeklyTokens",
    "normalizeWeeklyTypeFilter"
]);

test("un turno marcado sobrevive", () => {
    assert.equal(
        normalizeWeeklyTypeFilter("shift:noche", []),
        "shift:noche"
    );
});

test("un tipo de ausencia que esta semana no tiene a nadie se suelta", () => {
    // Arrastrarlo dejaria la pantalla en blanco sin decir por que.
    assert.equal(
        normalizeWeeklyTypeFilter("leave:license", [{ key: "training" }]),
        "Todos"
    );
    assert.equal(
        normalizeWeeklyTypeFilter("leave:license", [{ key: "license" }]),
        "leave:license"
    );
});

test("se suelta solo lo que sobra", () => {
    assert.equal(
        normalizeWeeklyTypeFilter(
            "shift:larga,leave:license,leave:training",
            [{ key: "training" }]
        ),
        "shift:larga,leave:training"
    );
});

test("basura queda en Todos", () => {
    assert.equal(normalizeWeeklyTypeFilter("cualquier,cosa", []), "Todos");
    assert.equal(normalizeWeeklyTypeFilter("", []), "Todos");
});

/* ======================================================================
   Que este cableado
   ====================================================================== */

test("ya no quedan desplegables", () => {
    assert.doesNotMatch(source, /staffingWeeklyFilterRole/);
    assert.doesNotMatch(source, /staffingWeeklyFilterProfession/);
    assert.doesNotMatch(source, /staffingWeeklyFilterType/);
    assert.doesNotMatch(source, /renderWeeklyTypeFilterOptions/);
});

test("la seleccion vive en el contenedor, no en los chips", () => {
    // Los chips se vuelven a dibujar en cada pintada: leerla de ellos la
    // perderia.
    assert.match(source, /target\?\.dataset\?\.staffingWeeklyRole/);
    assert.match(source, /target\.dataset\.staffingWeeklyRole = view\.roleFilter/);
    assert.match(source, /target\.dataset\.staffingWeeklyType = view\.typeFilter/);
    assert.match(source, /target\.dataset\.staffingWeeklyTrouble = view\.onlyTrouble/);
});

test("cada chip sabe a que filtro pertenece", () => {
    assert.match(source, /data-weekly-chip-group="\$\{escapeHTML\(group\)\}"/);
    assert.match(source, /querySelectorAll\("\[data-weekly-chip\]"\)/);
    assert.match(source, /group === "role"/);
    assert.match(source, /group === "profession"/);
});

test("los tipos de ausencia aparecen solo al pedir verlas", () => {
    // Son varios y en la vista de siempre no aportan; asi no se pierde poder
    // llegar a uno solo.
    assert.match(
        source,
        /const leaveChips = \(allLeavesPicked \|\| pickedLeaves\.length\)/
    );
});

test("la profesion aparece solo con un estamento marcado", () => {
    // Antes seria la lista de profesiones de la unidad entera.
    assert.match(
        source,
        /roleTokens\.length === 1 && availableProfessions\.length > 1/
    );
});

test("un tipo de ausencia marcado manda sobre el chip general", () => {
    // Si alguien pidio ver solo las licencias, no se le devuelven todas.
    assert.match(source, /const visibleLeaveRows = pickedLeaves\.length/);
});

test("la semana actual se reconoce y se puede volver a ella", () => {
    assert.match(
        source,
        /const isCurrentWeek =\s*\n\s*staffingWeeklyStartISO\(weekDate\) ===\s*\n\s*staffingWeeklyStartISO\(currentDate\)/
    );
    assert.match(source, /data-staffing-week-today/);
    assert.match(source, /staffingWeekDate = weekStartMonday\(currentDate\)/);
});

test("el filtro de problemas apaga las celdas sin hueco, no las esconde", () => {
    // Con display:none la rejilla correria las columnas y la semana perderia
    // la alineacion.
    assert.match(source, /if \(onlyTrouble && summary\.status\.key !== "gap"\)/);
    assert.match(source, /staffing-weekly-cell--quiet/);
    // Y las filas de ausencia no aportan: no son un hueco.
    assert.match(source, /\$\{\(onlyTrouble \? \[\] : visibleLeaveRows\)\.map/);
});

test("el filtro nuevo entra en la firma de la cache", () => {
    // Sin esto, prenderlo mostraria la version guardada sin filtrar.
    assert.match(source, /onlyTrouble \? "1" : "0"/);
});

test("el boton lleva el mismo signo con que se marca un hueco", () => {
    assert.match(source, /class="staffing-weekly-button__badge" aria-hidden="true">!</);
});

test("los chips y la barra tienen estilo", async () => {
    const css = (await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.ok(css.includes(".staffing-weekly-chip {"));
    assert.ok(css.includes('.staffing-weekly-chip[aria-pressed="true"]'));
    assert.ok(css.includes(".staffing-weekly-weeknav__arrow"));
    assert.ok(css.includes(".staffing-weekly-button__badge"));
    assert.ok(css.includes(".staffing-weekly-cell--quiet"));
    // La barra vieja se fue entera.
    assert.ok(!css.includes(".staffing-weekly-nav "));
    assert.ok(!css.includes(".staffing-weekly-filters label"));
});
