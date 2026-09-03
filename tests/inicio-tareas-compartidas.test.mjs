// Una tarea diaria del inicio se puede compartir.
//
// Antes esto solo existia en los recordatorios del resumen RRHH (menu Turnos):
// alli se elegia con quien se comparte, y las tareas diarias eran siempre
// privadas. Al mover esa funcion a las tareas hay tres cosas que no se pueden
// romper, y son las que fija este archivo:
//
//   1. Lo de por defecto sigue siendo privado. Una tarea es de quien la escribe
//      mientras no diga lo contrario.
//   2. Cada casa guarda lo suyo: lo privado en el documento del usuario, lo
//      compartido en la clave de la unidad. Y el VISTO nunca se comparte, o un
//      administrador veria hecha una tarea que no hizo.
//   3. Lo dirigido a trabajadores llega a la PWA por las DOS copias del motor
//      (js/serverEngine.js -la que corre en la Cloud Function- y la de
//      js/workerAppDataSync.js): cablearlo en una sola fue lo que ya dejo un
//      campo sin llegar al telefono.
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
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { dataset: {} }
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    HOME_SHARED_TASKS_KEY,
    buildSharedHomeTaskReminders,
    homeTaskTargetsProfile,
    homeTaskVisibilityBadge,
    homeTaskVisibilityLabel,
    isSharedHomeTask,
    isValidHomeTaskVisibility
} = await import("../js/homeSharedTasks.js");
const { applyDoneMap } = await import("../js/homeTasks.js");
const { stateModuleForKey, stateModulePermission } =
    await import("../js/firebaseStateModules.js");

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const homeTasks = await leer("../js/homeTasks.js");
const home = await leer("../js/home.js");
const serverEngine = await leer("../js/serverEngine.js");
const workerSync = await leer("../js/workerAppDataSync.js");
const rules = await leer("../firebase.rules");
const harness = await leer("../functions/lib/engineHarness.js");

function guardarCompartidas(tasks) {
    localStorage.setItem(HOME_SHARED_TASKS_KEY, JSON.stringify(tasks));
}

/* ───────── 1. Lo de por defecto es privado ───────── */

test("una tarea sin visibilidad queda privada", () => {
    const [tarea] = applyDoneMap([{ id: "t1", name: "Revisar agenda" }], {});

    assert.equal(tarea.visibility, "private");
    assert.equal(isSharedHomeTask(tarea), false);
});

test("el modal de agregar abre en 'sólo yo'", () => {
    // La primera opcion de la lista y la que se fuerza al abrir: si el modal se
    // abriera en otra, compartir con la unidad seria el descuido por defecto.
    assert.match(home, /\["private", "Sólo yo \(sólo quien la crea\)"\]/);
    assert.match(
        home,
        /modal\.querySelector\('\[data-hm="nt-visibility"\]'\)\.value = "private";/
    );

    const inicio = home.indexOf("const VISIBILITY_OPTS");
    const privada = home.indexOf('["private"', inicio);
    const unidad = home.indexOf('["all"', inicio);

    assert.ok(privada > -1 && unidad > privada);
});

test("las cuatro opciones son las mismas de los recordatorios", () => {
    assert.equal(isValidHomeTaskVisibility("private"), true);
    assert.equal(isValidHomeTaskVisibility("all"), true);
    assert.equal(isValidHomeTaskVisibility("workers"), true);
    assert.equal(isValidHomeTaskVisibility("estamento:Técnico"), true);
    assert.equal(isValidHomeTaskVisibility("estamento:Inventado"), false);
    assert.equal(isValidHomeTaskVisibility("cualquiera"), false);

    assert.equal(homeTaskVisibilityLabel("private"), "Sólo quien lo crea");
    assert.equal(
        homeTaskVisibilityLabel("all"),
        "Todos los usuarios administradores de la unidad"
    );
    assert.equal(homeTaskVisibilityLabel("workers"), "Todos los trabajadores");
    assert.equal(
        homeTaskVisibilityLabel("estamento:Auxiliar"),
        "Trabajadores: Auxiliar"
    );
    assert.equal(homeTaskVisibilityBadge("estamento:Auxiliar"), "Auxiliar");
    assert.equal(homeTaskVisibilityBadge("private"), "");
});

/* ───────── 2. Cada casa guarda lo suyo ───────── */

test("lo compartido va a la clave de la unidad y lo privado al usuario", () => {
    // saveHomeTasks parte la lista en dos: lo compartido a writeSharedTasks
    // (clave de la unidad) y lo privado al documento del usuario.
    assert.match(
        homeTasks,
        /writeSharedTasks\(\s*intended\.filter\(isSharedHomeTask\),/
    );
    assert.match(
        homeTasks,
        /applyLocal\(intended\.filter\(task => !isSharedHomeTask\(task\)\)\);/
    );
    assert.match(homeTasks, /const payload = \{ homeTasks: ownTasks \};/);
});

test("la clave compartida es un modulo que ve toda la unidad", () => {
    // El inicio no tiene permiso de menu propio: si la clave cayera en un
    // modulo con permiso (weekly, tasks...), un administrador sin ese menu no
    // veria las tareas que le compartieron.
    assert.equal(stateModuleForKey("home_shared_tasks"), "home");
    assert.equal(stateModulePermission("home"), "home");
    assert.match(rules, /\(moduleId == "home" && isMember\(workspaceId\)\)/);

    const lecturas = rules.split("canWriteStateModule")[0];
    assert.match(lecturas, /moduleId == "home"/);
});

test("el visto no viaja con la tarea compartida", () => {
    // Es lo que separa "compartir la tarea" de "compartir el trabajo hecho":
    // cada administrador marca su propia copia, en su propio documento.
    assert.match(
        homeTasks,
        /function sharedTaskForStorage\(task\) \{\s*return \{ \.\.\.task, doneDates: \[\] \};/
    );
    assert.match(homeTasks, /\.map\(sharedTaskForStorage\)/);
    // El visto sigue escribiendose en el documento del usuario, tarea a tarea.
    assert.match(homeTasks, /homeTaskDone: \{ \[id\]: value \}/);
});

test("guardar lo propio no borra lo que otro acaba de compartir", () => {
    // Mismo rescate que ya protegia la lista del usuario: lo que esta en la
    // unidad y esta copia no conoce no se pierde por omision.
    assert.match(homeTasks, /const rescued = current\.filter\(task => \{/);
    assert.match(homeTasks, /!knownIds\.has\(id\) && !removedIds\.has\(id\)/);
});

test("una tarea compartida solo la edita o borra su autor", () => {
    assert.match(homeTasks, /export function canEditHomeTask\(task\)/);
    assert.match(
        home,
        /function canModifyTask\(task\) \{\s*return canAuthorTasks\(\) && canEditHomeTask\(task\);/
    );
    // Guardar y eliminar preguntan lo mismo que el modal, no cada uno lo suyo.
    assert.match(home, /if \(task && canModifyTask\(task\)\) \{/);
    assert.match(home, /const editable = canModifyTask\(task\);/);
});

test("un miembro de solo lectura no agrega, edita ni comparte tareas", () => {
    // El inicio no tiene menu con permiso propio, asi que la pregunta es la
    // misma que hacen las reglas del modulo compartido: si puede editar ALGO.
    assert.match(home, /function canAuthorTasks\(\) \{\s*return canEditAnyMenu\(\);/);
    // No se le ofrece el boton que despues se le iba a negar (ni en la tarjeta
    // ni en el listado del dia).
    assert.match(home, /const addBtn = canAuthorTasks\(\)/);
    assert.match(home, /\$\{canAuthorTasks\(\) \? `<button class="hm-modal-action" type="button" data-hm="dt-add"/);
    assert.match(home, /if \(!modal \|\| !canAuthorTasks\(\)\) return;/);
    assert.match(home, /if \(!canAuthorTasks\(\)\) \{ closeTaskAdd\(\); return; \}/);
    // Y la capa de datos no escribe aunque la llamen igual.
    assert.match(
        homeTasks,
        /export async function saveHomeTasks\([\s\S]{0,500}if \(!canEditAnyMenu\(\)\) return;/
    );

    // Las reglas dicen lo mismo del lado del servidor.
    assert.match(
        rules,
        /moduleId == "home" &&\s*isMember\(workspaceId\) &&\s*memberCanEditSomething\(workspaceId\)/
    );
    // Pero LEER solo pide ser miembro: hay que ver lo que le compartieron.
    const lecturas = rules.split("function canWriteStateModule")[0];
    assert.match(lecturas, /\(moduleId == "home" && isMember\(workspaceId\)\)/);
});

test("marcar el visto sigue siendo de cada uno", () => {
    // Es lo unico que un miembro de solo lectura si puede hacer con una tarea
    // compartida: se escribe en SU documento, no en el estado de la unidad.
    assert.doesNotMatch(
        homeTasks,
        /export async function toggleTaskDone\([\s\S]{0,900}canEditAnyMenu\(\)/
    );
    assert.match(home, /puedes marcarla como realizada, pero no modificarla/);
});

test("un cambio de otro administrador repinta la lista", () => {
    // Lo compartido no llega por el listener del documento del usuario: entra
    // por el sync del estado de la unidad.
    assert.match(homeTasks, /function affectsSharedTasks\(detail\)/);
    assert.match(
        homeTasks,
        /return \(detail\.keys \|\| \[\]\)\.includes\(HOME_SHARED_TASKS_KEY\);/
    );
    assert.match(homeTasks, /window\.addEventListener\("proturnos:firebaseAppState"/);
});

/* ───────── 3. Lo dirigido a trabajadores llega a la PWA ───────── */

test("solo lo dirigido a trabajadores le toca a un trabajador", () => {
    // "all" es para los administradores del entorno, igual que en los
    // recordatorios: al telefono no baja.
    assert.equal(homeTaskTargetsProfile({ visibility: "workers" }, "Técnico"), true);
    assert.equal(homeTaskTargetsProfile({ visibility: "all" }, "Técnico"), false);
    assert.equal(homeTaskTargetsProfile({ visibility: "private" }, "Técnico"), false);
    assert.equal(
        homeTaskTargetsProfile({ visibility: "estamento:Técnico" }, "Tecnico"),
        true
    );
    assert.equal(
        homeTaskTargetsProfile({ visibility: "estamento:Técnico" }, "Auxiliar"),
        false
    );
});

test("la tarea compartida llega con la forma que la PWA ya entiende", () => {
    guardarCompartidas([
        {
            id: "t1",
            name: "Entrega de turno",
            date: "2026-09-01",
            repeat: "Diario",
            visibility: "workers"
        },
        {
            id: "t2",
            name: "Solo para tecnicos",
            date: "2026-09-02",
            repeat: "Semanal",
            visibility: "estamento:Técnico"
        },
        {
            id: "t3",
            name: "Solo administradores",
            date: "2026-09-03",
            repeat: "Diario",
            visibility: "all"
        },
        {
            id: "t4",
            name: "Sin fecha",
            date: "",
            repeat: "Diario",
            visibility: "workers"
        }
    ]);

    const paraTecnico = buildSharedHomeTaskReminders(
        { estamento: "Técnico" },
        new Date(2026, 8, 3)
    );

    assert.deepEqual(paraTecnico.map(item => item.id), ["t1", "t2"]);
    assert.deepEqual(paraTecnico[0], {
        id: "t1",
        date: "2026-09-01",
        title: "Entrega de turno",
        description: "Tarea compartida por el supervisor.",
        periodicity: "Diaria",
        source: "Supervisor"
    });
    assert.equal(paraTecnico[1].periodicity, "Semanal");

    const paraAuxiliar = buildSharedHomeTaskReminders(
        { estamento: "Auxiliar" },
        new Date(2026, 8, 3)
    );

    assert.deepEqual(paraAuxiliar.map(item => item.id), ["t1"]);
});

test("una tarea habil se manda diaria y una trimestral por fechas sueltas", () => {
    // La PWA no conoce ni los feriados de la unidad ni la recurrencia
    // trimestral. "Diario Hábil" cae en la diaria (avisar de mas es mejor que
    // callarla) y lo trimestral se expande en fechas concretas del proximo año.
    guardarCompartidas([
        {
            id: "h1",
            name: "Ronda habil",
            date: "2026-09-01",
            repeat: "Diario Hábil",
            visibility: "workers"
        },
        {
            id: "q1",
            name: "Inventario",
            date: "2026-01-31",
            repeat: "Trimestral",
            visibility: "workers"
        }
    ]);

    const items = buildSharedHomeTaskReminders(
        { estamento: "Técnico" },
        new Date(2026, 8, 3)
    );

    assert.equal(items[0].periodicity, "Diaria");

    const trimestral = items.filter(item => item.id.startsWith("q1"));

    assert.ok(trimestral.length >= 3);
    trimestral.forEach(item => {
        assert.equal(item.periodicity, "Una sola vez");
        assert.ok(item.date >= "2026-09-03");
    });
    // 31 de enero cada tres meses: el dia se recorta al ultimo del mes.
    assert.deepEqual(
        trimestral.map(item => item.date).slice(0, 3),
        ["2026-10-31", "2027-01-31", "2027-04-30"]
    );
});

test("las DOS copias del motor publican las tareas compartidas", () => {
    // El motor esta duplicado y la Cloud Function corre el de serverEngine.js:
    // cablearlo en una sola copia ya dejo un campo sin llegar al telefono.
    [serverEngine, workerSync].forEach(source => {
        assert.match(
            source,
            /import \{ buildSharedHomeTaskReminders \} from "\.\/homeSharedTasks\.js";/
        );
        assert.match(source, /\.\.\.buildSharedHomeTaskReminders\(profile, today\)/);
    });

    // Y el estado que necesitan tiene que estar entre lo que la Function lee.
    assert.match(harness, /"home"/);
});

test("sin tareas compartidas no cambia nada de lo que ya se publicaba", () => {
    localStorage.removeItem(HOME_SHARED_TASKS_KEY);

    assert.deepEqual(
        buildSharedHomeTaskReminders({ estamento: "Técnico" }, new Date()),
        []
    );
});
