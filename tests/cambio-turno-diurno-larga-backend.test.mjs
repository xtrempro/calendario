// La Cloud Function es la capa autoritativa: aunque la PWA y el supervisor
// dejen crear la solicitud, si `receiverCanCoverDay` la rechaza el cambio no
// entra. Verifica que acepte al companero que ese dia viene en Diurno y extiende
// su jornada a Larga, sin aflojar las reglas del 24.
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

const receiverCanCoverDay = new Function(
  "cleanText", "normalizeTextKey",
  `${grab("shiftLabel")}
   ${grab("shiftClass")}
   ${grab("isFreeTurnDay")}
   ${grab("isDiurnoTurnDay")}
   ${grab("receiverExtendsDiurnoToLarga")}
   ${grab("swapTurnCodeFromDay")}
   ${grab("isComplementary24")}
   ${grab("receiverCanCoverDay")}
   return receiverCanCoverDay;`
)(
  (v, max = 160) => String(v || "").trim().slice(0, max),
  (v) => String(v || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
);

const LARGA = 1;
const NOCHE = 2;
const diurno = { label: "Diurno", className: "diurno" };
const libre = { label: "Libre", className: "libre" };

test("un Diurno puede recibir una Larga aunque la unidad no permita el 24", () => {
  // Extender la jornada no forma un 24, asi que no depende de ese ajuste.
  assert.equal(receiverCanCoverDay(diurno, LARGA, false), true);
  assert.equal(receiverCanCoverDay(diurno, LARGA, true), true);
});

test("un Diurno NO puede recibir una Noche", () => {
  // Diurno + Noche seria un D+N, no una extension de jornada.
  assert.equal(receiverCanCoverDay(diurno, NOCHE, false), false);
  assert.equal(receiverCanCoverDay(diurno, NOCHE, true), false);
});

test("un Diurno con permiso ese dia no recibe nada", () => {
  assert.equal(
    receiverCanCoverDay({ ...diurno, hasLeave: true }, LARGA, true),
    false
  );
});

test("no se aflojaron las reglas que ya existian", () => {
  // Libre siempre recibe.
  assert.equal(receiverCanCoverDay(libre, LARGA, false), true);

  // Complementario solo con el 24 habilitado.
  const noche = { label: "Noche", className: "noche" };
  assert.equal(receiverCanCoverDay(noche, LARGA, true), true);
  assert.equal(receiverCanCoverDay(noche, LARGA, false), false);

  // Mismo turno: sigue sin poder recibir.
  const larga = { label: "Larga", className: "larga" };
  assert.equal(receiverCanCoverDay(larga, LARGA, true), false);
});

test("el mensaje de error nombra el caso nuevo", () => {
  // Si el rechazo sigue diciendo solo "no esta libre", el trabajador no entiende
  // por que su companero diurno no aparece.
  assert.match(src, /ni viene en Diurno para extender su jornada/);
});
