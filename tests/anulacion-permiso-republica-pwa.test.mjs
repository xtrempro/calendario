// Al anular un permiso (a pedido del trabajador o desde el LOG), el listener
// proturnos:auditUndoApplied debe RE-PUBLICAR la proyeccion de los afectados. Sin
// esto el dia seguia pintado con el permiso en la PWA aunque el supervisor ya lo
// habia quitado. Cubre al dueno del permiso y a quienes se les anulo el reemplazo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../js/main.js", import.meta.url), "utf8");

// Extrae el cuerpo del listener de auditUndoApplied.
function auditUndoListener() {
  const anchor = 'window.addEventListener("proturnos:auditUndoApplied"';
  const start = src.indexOf(anchor);
  assert.notEqual(start, -1, "no se encontro el listener auditUndoApplied");
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error("sin cierre del listener");
}

test("el listener auditUndoApplied re-publica la proyeccion del dueno del permiso", () => {
  const fn = auditUndoListener();
  assert.match(fn, /if \(detail\.profile\) scheduleWorkerAppDataPublish\(300, detail\.profile\);/);
});

test("tambien re-publica a quienes se les anulo el reemplazo", () => {
  const fn = auditUndoListener();
  // El set de trabajadores de reemplazo se reutiliza para timeline y re-publish.
  assert.match(fn, /const affectedReplacementWorkers = new Set\(/);
  assert.match(
    fn,
    /affectedReplacementWorkers\.forEach\(worker =>\s*\n?\s*scheduleWorkerAppDataPublish\(300, worker\)\s*\n?\s*\);/
  );
});

test("scheduleWorkerAppDataPublish esta importado en main.js", () => {
  assert.match(src, /scheduleWorkerAppDataPublish/);
});
