// Cloud Function del cambio directo: el receptor puede cubrir un dia si esta
// LIBRE, o si tiene el turno complementario (queda con 24) y la unidad permite el
// 24. El 24 invertido y la materializacion los valida el motor del supervisor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../functions/workerSwapRequests.js", import.meta.url), "utf8");

function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `no se encontro ${name}`);
  let paren = 0, i = src.indexOf("(", start);
  for (; i < src.length; i += 1) { if (src[i] === "(") paren++; else if (src[i] === ")") { paren--; if (!paren) { i++; break; } } }
  let depth = 0;
  for (let j = src.indexOf("{", i); j < src.length; j += 1) {
    if (src[j] === "{") depth += 1;
    else if (src[j] === "}") { depth -= 1; if (!depth) return src.slice(start, j + 1); }
  }
  throw new Error(`sin cierre: ${name}`);
}

const api = new Function(`
  const SWAP_TURN_CLASSES = new Set(["larga", "noche"]);
  ${grab("cleanText")}
  ${grab("normalizeTextKey")}
  ${grab("shiftLabel")}
  ${grab("shiftClass")}
  ${grab("isFreeTurnDay")}
  ${grab("swapTurnCodeFromDay")}
  ${grab("isComplementary24")}
  ${grab("receiverCanCoverDay")}
  return { swapTurnCodeFromDay, isComplementary24, receiverCanCoverDay };
`)();

test("swapTurnCodeFromDay: Larga=1, Noche=2, resto 0", () => {
  assert.equal(api.swapTurnCodeFromDay({ label: "Larga" }), 1);
  assert.equal(api.swapTurnCodeFromDay({ label: "Noche" }), 2);
  assert.equal(api.swapTurnCodeFromDay({ className: "larga" }), 1);
  assert.equal(api.swapTurnCodeFromDay({ label: "Libre" }), 0);
  assert.equal(api.swapTurnCodeFromDay({ label: "Noche", hasLeave: true }), 0);
});

test("isComplementary24: solo Larga+Noche", () => {
  assert.equal(api.isComplementary24(1, 2), true);
  assert.equal(api.isComplementary24(2, 1), true);
  assert.equal(api.isComplementary24(1, 1), false);
  assert.equal(api.isComplementary24(0, 2), false);
});

test("receiverCanCoverDay: libre siempre; complementario solo con 24 permitido", () => {
  const libre = { label: "Libre", className: "libre" };
  const noche = { label: "Noche", className: "noche" };
  const larga = { label: "Larga", className: "larga" };

  // Libre: siempre.
  assert.equal(api.receiverCanCoverDay(libre, 1, false), true);
  // Entrego Larga (1), receptor Noche (2): 24 permitido -> cubre.
  assert.equal(api.receiverCanCoverDay(noche, 1, true), true);
  // Mismo caso pero 24 no permitido -> no cubre.
  assert.equal(api.receiverCanCoverDay(noche, 1, false), false);
  // Receptor con el mismo turno (Larga): no es complementario.
  assert.equal(api.receiverCanCoverDay(larga, 1, true), false);
});

test("assertReceiverCanCoverDate recibe giverTurn + allowTwentyFour y publica la config", () => {
  assert.match(src, /allowTwentyFour: allowsTwentyFour\(targetCandidate\)/);
  assert.match(src, /allowTwentyFour: allowsTwentyFour\(acceptedCandidate\)/);
  assert.match(src, /candidate\?\.allowTwentyFourHourShifts === true/);
});
