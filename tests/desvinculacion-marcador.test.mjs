// Cloud Function markWorkerLinkUnlinked: al desvincular a un trabajador (se borra
// workspaces/{ws}/workerLinks/{uid}), deja un marcador EXPLICITO en el unico lugar
// que el trabajador siempre puede leer (users/{uid}/workerLinks/{ws}, status
// "unlinked"). Asi la PWA se desvincula de forma deterministica y no por un
// permission-denied transitorio (conexion inestable).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(
  new URL("../functions/getAccountsAndUnits.js", import.meta.url),
  "utf8"
);

function grab(name) {
  const marker = `const ${name} = onDocumentDeleted(`;
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `no se encontro ${name}`);
  // Cierra en ");" del onDocumentDeleted(...).
  let depth = 0;
  for (let i = src.indexOf("(", start); i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") { depth -= 1; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error(`sin cierre: ${name}`);
}

test("el trigger se dispara al borrarse el workerLink del workspace", () => {
  assert.match(src, /onDocumentDeleted/);
  assert.match(src, /require\("firebase-functions\/v2\/firestore"\)/);
  const fn = grab("markWorkerLinkUnlinked");
  assert.match(fn, /document: "workspaces\/\{workspaceId\}\/workerLinks\/\{workerUid\}"/);
});

test("escribe el marcador 'unlinked' en el doc propio del trabajador", () => {
  const fn = grab("markWorkerLinkUnlinked");
  assert.match(
    fn,
    /\.collection\("users"\)\s*\n?\s*\.doc\(workerUid\)\s*\n?\s*\.collection\("workerLinks"\)\s*\n?\s*\.doc\(workspaceId\)/
  );
  assert.match(fn, /status: "unlinked"/);
  assert.match(fn, /unlinkedBy: "supervisor"/);
});

test("no deja marcadores huerfanos en un teardown en cascada", () => {
  const fn = grab("markWorkerLinkUnlinked");
  // Solo escribe si tanto el workspace como el usuario siguen existiendo.
  assert.match(fn, /db\.collection\("workspaces"\)\.doc\(workspaceId\)\.get\(\)/);
  assert.match(fn, /db\.collection\("users"\)\.doc\(workerUid\)\.get\(\)/);
  assert.match(fn, /if \(!workspaceSnap\.exists \|\| !userSnap\.exists\) return;/);
});

test("el trigger queda exportado (se despliega)", () => {
  assert.match(src, /^\s*markWorkerLinkUnlinked,?$/m);
});
