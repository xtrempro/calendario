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
  // El universo de compatibilidad va deduplicado.
  assert.match(fn, /primaryProfiles\s*\n/);
});

test("dedup por perfil: conserva el enlace mas reciente y retira los duplicados", () => {
  const fn = grab("publishLinkedWorkerDocs");
  // Agrupa por perfil eligiendo el mas reciente.
  assert.match(fn, /const primaryByProfile = new Map\(\)/);
  assert.match(fn, /workerLinkRecency\(item\.link\) >= workerLinkRecency\(existing\.link\)/);
  // Retira los docs derivados de los uids duplicados.
  assert.match(fn, /const duplicates = linkedProfiles\.filter\(item => !primaryUids\.has\(item\.link\.uid\)\)/);
  assert.match(fn, /retireDuplicateWorkerLinkDocs\(item\.link\.uid, workspace\.id\)/);

  const retire = grab("retireDuplicateWorkerLinkDocs");
  assert.match(retire, /"workerMessageDirectory", uid/);
  assert.match(retire, /status: "unlinked"/);
  assert.match(retire, /"workerSwapCandidates", uid/);
  assert.match(retire, /status: "inactive"/);
});

test("se dispara en el arranque (primer snapshot) y en cada publicacion", () => {
  // En el arranque tambien se republica la programacion del workspace, para
  // que un documento publicado con el formato anterior se corrija solo, sin
  // obligar al supervisor a editar el tablero.
  assert.match(
    src,
    /if \(initial\) \{\s*\n\s*void publishLinkedWorkerDocs\(\);[\s\S]{0,420}void publishSharedScheduleNow\(\);\s*\n\s*return;\s*\n\s*\}/
  );
  assert.match(grab("publishHotNow"), /void publishLinkedWorkerDocs\(\);/);
  assert.match(grab("publishHotNow"), /void publishSharedScheduleNow\(\);/);
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
