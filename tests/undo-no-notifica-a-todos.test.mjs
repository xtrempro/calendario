// Regresion: deshacer (undo/redo) restauraba el storage de TODOS los perfiles,
// disparando el detector de cambios y notificando a cada trabajador enlazado un
// "cambio" en su calendario que nunca ocurrio. Ahora restore() solo reescribe los
// perfiles que realmente cambiaron.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../js/history.js", import.meta.url), "utf8");

function grab(name) {
  let start = src.indexOf(`function ${name}(`);
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

const equals = new Function(`
  const PROFILE_SNAPSHOT_KEYS = ${src.match(/const PROFILE_SNAPSHOT_KEYS = (\[[\s\S]*?\]);/)[1]};
  ${grab("profileSnapshotEquals")}
  return profileSnapshotEquals;
`)();

test("profileSnapshotEquals: iguales -> true; distinta clave -> false", () => {
  const a = { data: "{}", admin: "{}", legal: "{}", abs: "{}" };
  assert.equal(equals({ ...a }, { ...a }), true);
  assert.equal(equals({ ...a, admin: '{"2026-08-01":1}' }, { ...a }), false);
  assert.equal(equals({ ...a, abs: '{"x":1}' }, { ...a }), false);
  assert.equal(equals(null, a), false);
});

test("restore() solo reescribe el perfil si su estado realmente cambio", () => {
  const restore = grab("restore");
  assert.match(restore, /if \(!profileSnapshotEquals\(snapshotProfile\(profile\), profileState\)\) \{\s*\n\s*restoreProfile\(profile, profileState\);/);
});
