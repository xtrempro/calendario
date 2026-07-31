// Regresion: al retirar el pipeline hot legacy se perdio la publicacion de dos
// docs livianos por trabajador enlazado — workerMessageDirectory (listado de
// Mensajes) y workerSwapCandidates (compatibilidad de cambio de turno). Sin ellos,
// el trabajador no aparecia en Mensajes y compatibleWorkerUids quedaba vacio. Se
// restauro en publishLinkedWorkerDocs (bootstrap + cada publicacion).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../js/workerAppDataSync.js", import.meta.url), "utf8");

function grab(name) {
  let start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `no se encontro ${name}`);
  if (src.slice(start - 6, start) === "async ") start -= 6;
  let paren = 0, i = src.indexOf("(", start);
  for (; i < src.length; i += 1) { if (src[i] === "(") paren++; else if (src[i] === ")") { paren--; if (!paren) { i++; break; } } }
  let depth = 0;
  for (let j = src.indexOf("{", i); j < src.length; j += 1) {
    if (src[j] === "{") depth += 1;
    else if (src[j] === "}") { depth -= 1; if (!depth) return src.slice(start, j + 1); }
  }
  throw new Error(`sin cierre: ${name}`);
}

test("publishLinkedWorkerDocs publica directorio de mensajes Y candidato por enlazado", () => {
  const fn = grab("publishLinkedWorkerDocs");
  assert.match(fn, /workerLinks\s*\n?\s*\.map\(link => \(\{ link, profile: findProfileForLink\(link, profiles\) \}\)\)/);
  // Directorio de mensajes.
  assert.match(fn, /writeWorkerMessageDirectoryEntry\(\s*\n\s*buildWorkerMessageDirectoryPayload\(/);
  // Candidato de cambio de turno.
  assert.match(fn, /writeWorkerSwapCandidate\(\s*\n\s*buildSwapCandidatePayload\(/);
  assert.match(fn, /linkedProfiles\s*\n\s*\),/);
});

test("se dispara en el arranque (primer snapshot) y en cada publicacion", () => {
  assert.match(src, /if \(initial\) \{\s*\n\s*void publishLinkedWorkerDocs\(\);\s*\n\s*return;\s*\n\s*\}/);
  assert.match(grab("publishHotNow"), /void publishLinkedWorkerDocs\(\);/);
});

test("buildSwapCandidatePayload sigue publicando compatibilidad y la config del 24", () => {
  const fn = grab("buildSwapCandidatePayload");
  assert.match(fn, /compatibleWorkerUids/);
  assert.match(fn, /canSwapProfiles\(profile\.name, item\.profile\.name\)/);
  assert.match(fn, /allowTwentyFourHourShifts:\s*\n\s*getTurnChangeConfig\(\)\.allowTwentyFourHourShifts !== false/);
});

test("buildWorkerMessageDirectoryPayload arma el doc del directorio", () => {
  const fn = grab("buildWorkerMessageDirectoryPayload");
  assert.match(fn, /uid/);
  assert.match(fn, /profileName/);
});
