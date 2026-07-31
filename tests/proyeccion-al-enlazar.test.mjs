// Al crear o actualizar el enlace del trabajador (acepta/reacepta la invitacion)
// se encola su proyeccion sin depender del navegador del supervisor. Antes, un
// trabajador enlazado con el supervisor desconectado o con un link reutilizado
// se quedaba sin turnos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../functions/workerAppProjection.js", import.meta.url), "utf8");

// Extrae el handler async (event) => {...} de un export dado.
function extractHandler(exportName) {
  const anchor = src.indexOf(`exports.${exportName} =`);
  assert.notEqual(anchor, -1, `no se encontro ${exportName}`);
  const start = src.indexOf("async (event) => {", anchor);
  assert.notEqual(start, -1, "no se encontro el handler");
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (!depth) return src.slice(src.indexOf("async (event) =>", anchor), i + 1);
    }
  }
  throw new Error("sin cierre del handler");
}

function extractFunction(functionName) {
  const anchor = src.indexOf(`function ${functionName}(`);
  assert.notEqual(anchor, -1, `no se encontro ${functionName}`);
  let depth = 0;
  for (let i = src.indexOf("{", anchor); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (!depth) return src.slice(anchor, i + 1);
    }
  }
  throw new Error(`sin cierre de ${functionName}`);
}

function makeRun(added) {
  const db = {
    collection: () => db,
    doc: () => db,
    add: async (payload) => { added.push(payload); return { id: "req-x" }; }
  };
  const admin = {
    firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => "TS" } })
  };
  const logger = { info() {}, warn() {}, error() {} };
  const handlerSrc = extractHandler("requestProjectionOnWorkerLink");
  const helpers = [
    extractFunction("snapshotExists"),
    extractFunction("snapshotData"),
    extractFunction("workerLinkProjectionPlan")
  ].join("\n");
  // eslint-disable-next-line no-new-func
  return new Function(
    "admin",
    "logger",
    "WORKER_LINK_PROJECTION_FIELDS",
    `${helpers}\nreturn (${handlerSrc});`
  )(admin, logger, [
    "profileName",
    "profileRut",
    "profileId",
    "inviteId",
    "uid",
    "workerEmail",
    "status"
  ]);
}

function snap(data) {
  return {
    exists: true,
    data: () => data
  };
}

test("dispara sobre workerLinks/{workerUid}", () => {
  assert.match(src, /document: "workspaces\/\{workspaceId\}\/workerLinks\/\{workerUid\}"/);
});

test("encola un projectionRequest con el perfil del enlace", async () => {
  const added = [];
  const run = makeRun(added);
  await run({
    params: { workspaceId: "ws1", workerUid: "uidA" },
    data: {
      after: snap({ profileName: "Daniela Velarde", uid: "uidA" })
    }
  });

  assert.equal(added.length, 1);
  assert.deepEqual(added[0].profiles, ["Daniela Velarde"]);
  assert.equal(added[0].source, "worker_link_created");
  assert.equal(added[0].requestedAt, "TS");
});

test("si el workerLink existente cambia, vuelve a encolar proyeccion", async () => {
  const added = [];
  const run = makeRun(added);
  await run({
    params: { workspaceId: "ws1", workerUid: "uidA" },
    data: {
      before: snap({
        profileName: "Daniela Velarde",
        uid: "uidA",
        inviteId: "old"
      }),
      after: snap({
        profileName: "Daniela Velarde",
        uid: "uidA",
        inviteId: "new"
      })
    }
  });

  assert.equal(added.length, 1);
  assert.deepEqual(added[0].profiles, ["Daniela Velarde"]);
  assert.equal(added[0].source, "worker_link_updated");
});

test("ignora actualizaciones sin cambios relevantes", async () => {
  const added = [];
  const run = makeRun(added);
  const link = {
    profileName: "Daniela Velarde",
    uid: "uidA",
    inviteId: "inv"
  };
  await run({
    params: { workspaceId: "ws1", workerUid: "uidA" },
    data: {
      before: snap({ ...link, lastSeenAt: "old" }),
      after: snap({ ...link, lastSeenAt: "new" })
    }
  });

  assert.equal(added.length, 0);
});

test("sin profileName no encola nada (no rompe)", async () => {
  const added = [];
  const run = makeRun(added);
  await run({
    params: { workspaceId: "ws1", workerUid: "uidA" },
    data: {
      after: snap({ uid: "uidA" })
    }
  });

  assert.equal(added.length, 0);
});

test("el modulo exporta la nueva funcion y la de proyeccion", () => {
  assert.match(src, /exports\.requestProjectionOnWorkerLink = onDocumentWritten\(/);
  assert.match(src, /exports\.buildWorkerAppProjection = onDocumentCreated\(/);
});
