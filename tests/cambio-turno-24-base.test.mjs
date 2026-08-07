// La Cloud Function de cambios acepta un dia 24 y entrega el turno BASE (el extra
// queda). Verifica el cableado: acepta el 24 como dia intercambiable, deriva el
// giverTurn/etiqueta desde el base, y lo aplica al dia propio y al de devolucion.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(
  new URL("../functions/workerSwapRequests.js", import.meta.url),
  "utf8"
);

function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `no se encontro ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error(`sin cierre: ${name}`);
}

// giverTurnCodeFromDay es puro (usa shiftClass/shiftLabel/normalizeTextKey/
// swapTurnCodeFromDay). Se evalua con stubs para comprobar el base en un 24.
const giverTurnCodeFromDay = new Function(
  "shiftClass", "shiftLabel", "normalizeTextKey", "swapTurnCodeFromDay",
  `${grab("isTwentyFourDay")}
   ${grab("giverTurnCodeFromDay")}
   return giverTurnCodeFromDay;`
)(
  (d) => String(d?.className || "").toLowerCase(),
  (d) => String(d?.label || ""),
  (x) => String(x || "").toLowerCase(),
  (d) => {
    const l = String(d?.label || "").toLowerCase();
    return l === "larga" ? 1 : l === "noche" ? 2 : 0;
  }
);

test("giverTurnCodeFromDay: en un 24 devuelve el turno BASE", () => {
  // base Noche (2) + extra Larga -> 2.
  assert.equal(giverTurnCodeFromDay({ className: "turno24", baseTurn: 2 }), 2);
  // base Larga (1) -> 1.
  assert.equal(giverTurnCodeFromDay({ className: "turno24", baseTurn: 1 }), 1);
  // base libre (0) -> 0.
  assert.equal(giverTurnCodeFromDay({ className: "turno24", baseTurn: 0 }), 0);
  // dia normal Larga -> 1.
  assert.equal(giverTurnCodeFromDay({ label: "Larga", className: "larga" }), 1);
  // con permiso -> 0.
  assert.equal(giverTurnCodeFromDay({ label: "Noche", hasLeave: true }), 0);
});

test("el dia propio y el de devolucion aceptan un 24 (isSwappableTurnDay)", () => {
  assert.match(src, /function isSwappableTurnDay\(day\) \{\s*\n\s*return isSwapTurnDay\(day\) \|\| giverTurnCodeFromDay\(day\) !== 0;/);
  // assertOwnSwapDate y assertReturnSwapDate usan isSwappableTurnDay.
  const count = (src.match(/if \(!isSwappableTurnDay\(day\)\)/g) || []).length;
  assert.ok(count >= 2, "assertOwnSwapDate y assertReturnSwapDate deben usarlo");
});

test("la compatibilidad y las etiquetas usan el turno base del 24", () => {
  assert.match(src, /giverTurn: giverTurnCodeFromDay\(ownDay\)/);
  assert.match(src, /const ownTurnLabel = giverTurnLabel\(ownDay\)/);
  assert.match(src, /const returnTurnLabel = giverTurnLabel\(returnDay\)/);
  assert.match(src, /const ownTurnClassName = giverTurnClassName\(ownDay\)/);
});

test("no se puede devolver un turno en un dia de permiso del solicitante", () => {
  assert.match(src, /const requesterReturnDay = dayFor\(requesterCandidate, returnDate\)/);
  assert.match(src, /if \(requesterReturnDay && requesterReturnDay\.hasLeave === true\)/);
  assert.match(src, /No puedes devolver un turno un dia en que tienes un permiso o vacaciones/);
});
