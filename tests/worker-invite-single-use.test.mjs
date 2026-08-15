import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const functionsSrc = await readFile(
  new URL("../functions/index.js", import.meta.url),
  "utf8"
);
const rulesSrc = await readFile(
  new URL("../firebase.rules", import.meta.url),
  "utf8"
);

test("la aceptacion de invitacion de trabajador vive en callable transaccional", () => {
  assert.match(functionsSrc, /exports\.acceptWorkerAppInvite = onCall/);
  assert.match(functionsSrc, /acceptWorkerAppInviteImpl/);
  assert.match(functionsSrc, /db\.runTransaction/);
  assert.match(functionsSrc, /String\(invite\.status \|\| ""\) !== "pending"/);
  assert.match(functionsSrc, /Esta invitacion ya fue utilizada/);
});

test("al aceptar una invitacion se revocan enlaces activos del mismo trabajador", () => {
  assert.match(functionsSrc, /workerLinkMatchesInviteIdentity/);
  assert.match(functionsSrc, /normalizeRutForBackup\(invite\.profileRut\)/);
  assert.match(functionsSrc, /const duplicateDocs = linksSnap\.docs\.filter/);
  assert.match(functionsSrc, /transaction\.delete\(docSnap\.ref\)/);
  assert.match(functionsSrc, /unlinkedBy: "duplicate_worker_invite"/);
});

test("las reglas ya no permiten aceptar invitaciones ni crear enlaces desde cliente", () => {
  assert.match(rulesSrc, /function workerInviteCanBeOpened\(\) \{\s*return resource\.data\.status == "pending";\s*\}/);
  assert.match(rulesSrc, /allow update: if canManageProfiles\(workspaceId\);/);
  assert.match(rulesSrc, /allow create, update: if canManageProfiles\(workspaceId\) &&\s*request\.resource\.data\.uid == userId;/);
  assert.doesNotMatch(rulesSrc, /canAcceptWorkerInvite\(workspaceId, inviteId\);/);
  assert.doesNotMatch(rulesSrc, /acceptedWorkerInviteAfter/);
});
