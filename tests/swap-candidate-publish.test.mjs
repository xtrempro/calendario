// Regresion: la publicacion de workerSwapCandidates se habia perdido al retirar
// el pipeline hot legacy, dejando compatibleWorkerUids vacio (el trabajador no veia
// colegas para cambiar turno). Se restauro en el sync (bootstrap + cambios).
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

test("publishSwapCandidatesNow publica el doc de cada trabajador enlazado", () => {
  const fn = grab("publishSwapCandidatesNow");
  assert.match(fn, /workerLinks\s*\n?\s*\.map\(link => \(\{ link, profile: findProfileForLink\(link, profiles\) \}\)\)/);
  assert.match(fn, /writeWorkerSwapCandidate\(\s*\n\s*buildSwapCandidatePayload\(/);
  // Pasa todos los enlazados como universo de compatibilidad.
  assert.match(fn, /linkedProfiles\s*\n\s*\),/);
});

test("se dispara en el arranque (primer snapshot) y en cada publicacion", () => {
  // Bootstrap: primer snapshot de enlaces refresca candidatos (aunque no
  // regenere la proyeccion pesada).
  assert.match(src, /if \(initial\) \{\s*\n\s*void publishSwapCandidatesNow\(\);\s*\n\s*return;\s*\n\s*\}/);
  // Y al publicar (cambios de datos).
  assert.match(grab("publishHotNow"), /void publishSwapCandidatesNow\(\);/);
});

test("buildSwapCandidatePayload sigue publicando compatibilidad y la config del 24", () => {
  const fn = grab("buildSwapCandidatePayload");
  assert.match(fn, /compatibleWorkerUids/);
  assert.match(fn, /canSwapProfiles\(profile\.name, item\.profile\.name\)/);
  assert.match(fn, /allowTwentyFourHourShifts:\s*\n\s*getTurnChangeConfig\(\)\.allowTwentyFourHourShifts !== false/);
});
