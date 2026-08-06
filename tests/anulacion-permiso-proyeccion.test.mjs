// Para que el trabajador pueda solicitar la anulacion de un permiso APLICADO por el
// supervisor (sin solicitud previa), el motor publica el tipo cancelable por dia
// (leaveCancelType). Debe estar en AMBAS copias del motor: serverEngine.js (Cloud
// Function) y workerAppDataSync.js (cliente supervisor). Y el filtro del panel debe
// mostrar SIEMPRE las pendientes (la anulacion se archiva por fecha de creacion).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engineSrc = await readFile(new URL("../js/serverEngine.js", import.meta.url), "utf8");
const clientSrc = await readFile(new URL("../js/workerAppDataSync.js", import.meta.url), "utf8");
const requestsSrc = await readFile(new URL("../js/workerRequests.js", import.meta.url), "utf8");

// El helper es puro: se evalua para verificar el mapeo de tipos cancelables.
function grabHelper(src) {
  const start = src.indexOf("function cancelableLeaveTypeForDay(");
  assert.notEqual(start, -1, "no se encontro cancelableLeaveTypeForDay");
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error("sin cierre");
}

for (const [nombre, src] of [
  ["serverEngine.js (Cloud Function)", engineSrc],
  ["workerAppDataSync.js (cliente supervisor)", clientSrc]
]) {
  test(`${nombre}: publica leaveCancelType cuando el permiso es cancelable`, () => {
    assert.match(src, /function cancelableLeaveTypeForDay\(maps, keyDay\)/);
    assert.match(
      src,
      /hasLeave && cancelableLeaveTypeForDay\(maps, keyDay\)\s*\n?\s*\? \{ leaveCancelType: cancelableLeaveTypeForDay\(maps, keyDay\) \}/
    );
  });

  test(`${nombre}: mapea admin/half/legal/comp/gremial/sin-goce; licencia NO`, () => {
    const fn = new Function(`${grabHelper(src)}; return cancelableLeaveTypeForDay;`)();
    const m = (admin, legal, comp, absences) =>
      fn({ admin: { d: admin }, legal: { d: legal }, comp: { d: comp }, absences: { d: absences } }, "d");

    assert.equal(m(1, 0, 0, ""), "admin");
    assert.equal(m("0.5M", 0, 0, ""), "half_admin_morning");
    assert.equal(m("0.5T", 0, 0, ""), "half_admin_afternoon");
    assert.equal(m(0, 1, 0, ""), "legal");
    assert.equal(m(0, 0, 1, ""), "comp");
    assert.equal(m(0, 0, 0, "union_leave"), "union_leave");
    assert.equal(m(0, 0, 0, "unpaid_leave"), "unpaid_leave");
    // Licencia medica / injustificada NO son cancelables por el trabajador.
    assert.equal(m(0, 0, 0, "license"), "");
    assert.equal(m(0, 0, 0, "unjustified_absence"), "");
    assert.equal(m(0, 0, 0, ""), "");
  });
}

test("el panel del supervisor muestra SIEMPRE las pendientes (sin importar el mes)", () => {
  assert.match(
    requestsSrc,
    /request\.status === "pending" && !monthRequests\.includes\(request\)/
  );
});
