// Los valores hora por grado cambian una vez al año, asi que ya no puede haber
// UNA sola tabla: un informe de 2025 tiene que seguir calculandose con los
// valores de 2025 aunque hoy rijan otros.
//
// La configuracion pasa a ser una lista de periodos a mes cerrado. Y como
// consecuencia, el cambio de grado de un trabajador tambien se ancla al mes:
// antes podia empezar a mitad de mes y partia el mes en dos valores distintos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    DEFAULT_GRADE_HOUR_CONFIG,
    getGradeHourConfig,
    getGradeHourPeriodAt,
    getGradeHourValue,
    saveGradeHourConfig
} = await import("../js/storage.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const main = await read("../js/main.js");
const settings = await read("../js/systemSettings.js");

// Dos periodos, como los del ejemplo del usuario: febrero a enero.
function sembrarPeriodos() {
    localStorage.clear();
    saveGradeHourConfig({
        periods: [
            {
                from: "2025-02",
                to: "2026-01",
                professional: { "10": 1000 },
                general: { "12": 500 }
            },
            {
                from: "2026-02",
                to: "2027-01",
                professional: { "10": 1100 },
                general: { "12": 550 }
            }
        ]
    });
}

/* =========================================================
   Los periodos
========================================================= */

test("cada periodo aplica en su rango", () => {
    sembrarPeriodos();

    assert.equal(
        getGradeHourValue("Profesional", "10", new Date(2025, 5, 15)),
        1000
    );
    assert.equal(
        getGradeHourValue("Profesional", "10", new Date(2026, 5, 15)),
        1100
    );
});

test("los bordes del rango pertenecen al periodo", () => {
    sembrarPeriodos();

    // Febrero 2025 es el primer mes del primero; enero 2026, el ultimo.
    assert.equal(getGradeHourValue("Profesional", "10", new Date(2025, 1, 1)), 1000);
    assert.equal(getGradeHourValue("Profesional", "10", new Date(2026, 0, 31)), 1000);
    // Y febrero 2026 ya es del segundo.
    assert.equal(getGradeHourValue("Profesional", "10", new Date(2026, 1, 1)), 1100);
});

test("el estamento elige la tabla correcta dentro del periodo", () => {
    sembrarPeriodos();

    assert.equal(getGradeHourValue("Tecnico", "12", new Date(2025, 5, 1)), 500);
    assert.equal(getGradeHourValue("Tecnico", "12", new Date(2026, 5, 1)), 550);
});

test("una fecha fuera de todo periodo NO devuelve cero", () => {
    // Dejar el valor hora en cero silenciaria el pago de un mes entero. Se cae
    // al periodo aplicable mas cercano, que es como se comportaba la tabla
    // unica de antes.
    sembrarPeriodos();

    // Antes del primero: usa el primero.
    assert.equal(getGradeHourValue("Profesional", "10", new Date(2024, 5, 1)), 1000);
    // Despues del ultimo: usa el ultimo.
    assert.equal(getGradeHourValue("Profesional", "10", new Date(2030, 5, 1)), 1100);
});

test("un periodo sin termino es el vigente", () => {
    localStorage.clear();
    saveGradeHourConfig({
        periods: [
            { from: "2025-02", to: "2026-01", professional: { "10": 1000 } },
            { from: "2026-02", to: "", professional: { "10": 1200 } }
        ]
    });

    assert.equal(getGradeHourValue("Profesional", "10", new Date(2029, 8, 1)), 1200);
});

test("un rango al reves se descarta en vez de quedar imposible", () => {
    localStorage.clear();
    saveGradeHourConfig({
        periods: [
            { from: "2026-02", to: "2025-01", professional: { "10": 900 } }
        ]
    });

    // El "to" invalido se limpia: el periodo queda abierto y sigue aplicando.
    assert.equal(getGradeHourConfig().periods[0].to, "");
    assert.equal(getGradeHourValue("Profesional", "10", new Date(2027, 0, 1)), 900);
});

/* =========================================================
   Compatibilidad con lo ya guardado
========================================================= */

test("lo guardado tambien se puede leer SIN el codigo de periodos", () => {
    // Una version del app que aun no conoce los periodos lee professional y
    // general de la RAIZ. Si solo se guardara "periods", no encontraria nada y
    // caeria a los valores por defecto, mostrando cifras equivocadas sin
    // avisar. Paso de verdad al escribir el primer periodo desde un script.
    localStorage.clear();
    saveGradeHourConfig({
        periods: [
            { from: "2025-02", to: "2026-01", professional: { "10": 1000 } },
            { from: "2026-02", to: "", professional: { "10": 1200 } }
        ]
    });

    const guardado = JSON.parse(localStorage.getItem("gradeHourConfig"));

    assert.ok(guardado.periods, "los periodos siguen ahi");
    // La raiz refleja el periodo VIGENTE, que es el que un cliente antiguo
    // deberia estar usando hoy.
    assert.equal(guardado.professional["10"], 1200);
    assert.ok(guardado.general, "tambien la tabla general");
});

test("la configuracion vieja sin fechas se migra sola", () => {
    // Era { professional, general } sin periodos. Tiene que seguir aplicando a
    // todo el historico exactamente como antes.
    localStorage.clear();
    localStorage.setItem(
        "gradeHourConfig",
        JSON.stringify({ professional: { "10": 777 }, general: { "12": 333 } })
    );

    const config = getGradeHourConfig();

    assert.equal(config.periods.length, 1);
    assert.equal(config.periods[0].from, "");
    assert.equal(config.periods[0].to, "");
    assert.equal(getGradeHourValue("Profesional", "10", new Date(2020, 0, 1)), 777);
    assert.equal(getGradeHourValue("Profesional", "10", new Date(2030, 0, 1)), 777);
});

test("sin fecha se resuelve el periodo vigente", () => {
    sembrarPeriodos();

    // No romperse cuando el llamador no pasa fecha: se asume hoy.
    assert.ok(getGradeHourPeriodAt());
    assert.ok(getGradeHourValue("Profesional", "10") > 0);
});

test("profesionales incluye grado 16 por defecto", () => {
    localStorage.clear();

    assert.equal(DEFAULT_GRADE_HOUR_CONFIG.professional["16"], 6072.8);
    assert.equal(getGradeHourValue("Profesional", "16"), 6072.8);
});

/* =========================================================
   El cambio de grado, a mes cerrado
========================================================= */

test("el cambio de grado se pide por MES, no por fecha", () => {
    // Antes un grado podia empezar el 17: el mes quedaba partido en dos valores
    // hora distintos y no habia forma de cuadrar el pago.
    assert.match(main, /async function requestGradeEffectiveDate/);
    assert.match(main, /inputType: "month"/);
    assert.match(main, /return `\$\{month\}-01`;/);
    // Y ya no existe el campo de fecha libre.
    assert.doesNotMatch(main, /data-grade-effective-date/);
});

test("solo acepta un mes valido", () => {
    assert.match(main, /if \(\/\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$\/\.test\(month\)\)/);
    assert.match(main, /Selecciona un mes valido para la vigencia/);
});

/* =========================================================
   La pantalla de Ajustes
========================================================= */

test("Ajustes permite definir los periodos", () => {
    assert.match(settings, /data-grade-period-add/);
    assert.match(settings, /data-grade-period-from/);
    assert.match(settings, /data-grade-period-to/);
    assert.match(settings, /type="month" data-grade-period-from/);
    // Deja claro que el "hasta" vacio es el periodo vigente.
    assert.match(settings, /Deja "Hasta" en blanco/);
});

test("el periodo nuevo copia los valores del ultimo", () => {
    // Casi siempre es un reajuste sobre la tabla vigente, no una tabla desde
    // cero: obligar a reescribir 20 grados a mano seria una fuente de errores.
    assert.match(
        settings,
        /professional: \{ \.\.\.\(last\?\.professional \|\| \{\}\) \}/
    );
});

test("cambiar de periodo no pierde lo que se estaba escribiendo", () => {
    // preserveActiveDraft lee las tablas antes de repintar.
    assert.match(
        settings,
        /const periodTab = event\.target\.closest\("\[data-grade-period\]"\);[\s\S]{0,120}preserveActiveDraft\(backdrop\)/
    );
    // Y el rango tambien se lee de la pantalla: si no, cambiar solo las fechas
    // y guardar no guardaria nada.
    assert.match(settings, /if \(from\) period\.from = String\(from\.value \|\| ""\)\.trim\(\);/);
});

test("nunca se queda sin periodos", () => {
    // Con cero periodos no habria ninguna tabla y todos los valores hora
    // caerian a cero.
    assert.match(settings, /if \(config\.periods\.length > 1\) \{/);
});
