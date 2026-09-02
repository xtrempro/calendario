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
  const fn = grab("publishLinkedWorkerDocsNow");
  assert.match(fn, /getWorkerAppLinkList\(\)\s*\n?\s*\.map\(link => \(\{ link, profile: findProfileForLink\(link, profiles\) \}\)\)/);
  // Directorio de mensajes.
  assert.match(fn, /collection: "workerMessageDirectory",[\s\S]{0,120}payload: buildWorkerMessageDirectoryPayload\(/);
  // Candidato de cambio de turno.
  assert.match(fn, /collection: "workerSwapCandidates",[\s\S]{0,120}payload: buildSwapCandidatePayload\(/);
  // El universo de compatibilidad va deduplicado.
  assert.match(fn, /primaryProfiles\s*\n/);
});

// Publicarlos de a uno costaba ~132 `setDoc` y mas de 60 s por una sola edicion
// de turno, y terminaba en `resource-exhausted: Write stream exhausted maximum
// allowed queued writes`. Tienen que viajar agrupados.
test("los docs de los enlazados se envian por lotes, no de a uno", () => {
  const fn = grab("publishLinkedWorkerDocsNow");
  assert.match(fn, /await commitWorkerDocBatches\(documents, workspace\.id\)/);
  assert.doesNotMatch(fn, /await writeWorker/);

  const commit = grab("commitWorkerDocBatches");
  assert.match(commit, /firestoreModule\.writeBatch\(db\)/);
  assert.match(commit, /offset \+= WORKER_DOC_BATCH_SIZE/);
  // Se cede el hilo entre lotes, nunca por documento.
  assert.match(commit, /waitWorkerAppIdle\(/);
});

// Se llama con `void` desde dos sitios y la corrida tarda segundos: dos
// ediciones seguidas dejaban dos bucles escribiendo a la vez.
test("no puede haber dos publicaciones de enlazados a la vez", () => {
  const fn = grab("publishLinkedWorkerDocs");
  assert.match(fn, /if \(linkedWorkerDocsRun\)/);
  // Una edicion durante la corrida no se descarta: se repite al terminar.
  assert.match(fn, /linkedWorkerDocsRerun = true/);
  assert.match(fn, /while \(linkedWorkerDocsRerun\)/);
  assert.match(fn, /finally \{[\s\S]{0,160}linkedWorkerDocsRun = null/);
});

test("dedup por perfil: conserva el enlace mas reciente y retira los duplicados", () => {
  const fn = grab("publishLinkedWorkerDocsNow");
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
  // El arranque publica a TODOS (sin objetivos); la publicacion caliente solo a
  // los perfiles tocados. Republicar los 66 enlazados por editar un turno
  // costaba ~132 documentos y tumbaba el stream de escritura.
  assert.match(grab("publishHotNow"), /void publishLinkedWorkerDocs\(dirtyNames\);/);
  assert.match(grab("publishHotNow"), /void publishSharedScheduleNow\(\);/);
});

test("solo se republica a quien cambio, salvo que cambie la compatibilidad", () => {
  const fn = grab("publishLinkedWorkerDocsNow");
  // El universo para compatibleWorkerUids sigue siendo TODOS...
  assert.match(fn, /swapCompatibilitySignature\(workspace, primaryProfiles\)/);
  assert.match(fn, /payload: buildSwapCandidatePayload\([\s\S]{0,400}primaryProfiles/);
  // ...pero solo se escriben los objetivos.
  assert.match(fn, /const targets = wanted/);
  assert.match(fn, /documents\.push/);
  assert.match(fn, /targets\.forEach/);
  // Sin objetivos, o si la compatibilidad cambio, se publica completo.
  assert.match(fn, /targetNames\?\.size && !compatibilityChanged/);

  // La firma cubre los insumos de canSwapProfiles: si alguno cambia, la lista de
  // compatibles de TODOS queda vieja y hay que republicar entero.
  const firma = grab("swapCompatibilitySignature");
  ["estamento", "profession", "getRotativa", "allowSwaps"].forEach(campo => {
    assert.match(firma, new RegExp(campo), `la firma ignora ${campo}`);
  });

  // Y solo se da por cubierta si la escritura salio bien.
  assert.match(
    fn,
    /await commitWorkerDocBatches\([\s\S]{0,400}lastSwapCompatibilitySignature = signature/
  );
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
