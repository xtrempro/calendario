// Un permiso/ausencia sobre un dia LIBRE por rotativa (sin turno base) se pinta al
// 50% de transparencia (clase leave-free-day). Con turno base se mantiene solido.
// Ademas legal/comp ahora siempre usan su color solido (la transparencia va aparte).
import test from "node:test";
import assert from "node:assert/strict";
import { aplicarClasesEspeciales } from "../js/rulesEngine.js";

function fakeDiv() {
  const classes = new Set();
  return {
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x))
    },
    style: { setProperty: () => {} },
    has: (x) => classes.has(x)
  };
}

const K = "2026-12-8";

function run({ maps = {}, baseTurn = 0, state = 0 }) {
  const div = fakeDiv();
  aplicarClasesEspeciales(
    div, K, state, true, false, false,
    maps.admin || {}, maps.legal || {}, maps.comp || {}, maps.absences || {},
    () => {}, baseTurn, null
  );
  return div;
}

test("compensatorio sobre dia LIBRE (baseTurn 0): color solido + 50% transparencia", () => {
  const div = run({ maps: { comp: { [K]: 1 } }, baseTurn: 0 });
  assert.equal(div.has("comp-day"), true, "color solido");
  assert.equal(div.has("comp-soft"), false, "ya no usa el soft antiguo");
  assert.equal(div.has("leave-free-day"), true, "transparencia por dia libre");
});

test("compensatorio sobre dia CON turno base (>0): solido, sin transparencia", () => {
  const div = run({ maps: { comp: { [K]: 1 } }, baseTurn: 2 });
  assert.equal(div.has("comp-day"), true);
  assert.equal(div.has("leave-free-day"), false);
});

test("aplica a todos los tipos (legal, admin, ausencia) cuando el dia es libre", () => {
  assert.equal(run({ maps: { legal: { [K]: 1 } }, baseTurn: 0 }).has("leave-free-day"), true);
  assert.equal(run({ maps: { admin: { [K]: 1 } }, baseTurn: 0 }).has("leave-free-day"), true);
  assert.equal(run({ maps: { absences: { [K]: "union_leave" } }, baseTurn: 0 }).has("leave-free-day"), true);
});

test("sin permiso no se agrega la transparencia aunque el dia sea libre", () => {
  assert.equal(run({ baseTurn: 0 }).has("leave-free-day"), false);
});

test("el CSS del supervisor define la transparencia en calendario y timeline", async () => {
  const css = await (await import("node:fs/promises")).readFile(
    new URL("../styles.css", import.meta.url), "utf8"
  );
  assert.match(css, /\.day\.leave-free-day,\s*\n\s*\.mini\.leave-free-day \{\s*\n?\s*opacity: 0\.5;/);
});

test("el timeline tambien aplica la transparencia (dia libre dentro de un permiso)", async () => {
  const timeline = await (await import("node:fs/promises")).readFile(
    new URL("../js/timeline.js", import.meta.url), "utf8"
  );
  assert.match(timeline, /const isLeaveFreeDay = hasLeave && \(Number\(baseTurn\) \|\| 0\) === 0;/);
  assert.match(timeline, /\$\{isLeaveFreeDay \? "leave-free-day" : ""\}/);
});
