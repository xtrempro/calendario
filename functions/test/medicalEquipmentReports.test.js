"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkerMedicalEquipmentReportHandler
} = require("../medicalEquipmentReports");

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class FakeDocumentSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = value !== undefined;
    this.value = value;
  }

  data() {
    return this.value;
  }
}

class FakeDocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  collection(name) {
    return new FakeCollectionReference(this.db, `${this.path}/${name}`);
  }

  get() {
    return Promise.resolve(this.db.snapshot(this));
  }

  set(value, options = {}) {
    this.db.setData(this.path, value, options);
    return Promise.resolve();
  }

  create(value) {
    if (this.db.documents.has(this.path)) {
      return Promise.reject(new Error("already exists"));
    }

    this.db.setData(this.path, value);
    return Promise.resolve();
  }
}

class FakeCollectionReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  doc(id) {
    return new FakeDocumentReference(this.db, `${this.path}/${id}`);
  }
}

class FakeFirestore {
  constructor(documents = {}) {
    this.documents = new Map(Object.entries(documents));
  }

  collection(name) {
    return new FakeCollectionReference(this, name);
  }

  snapshot(ref) {
    return new FakeDocumentSnapshot(ref, this.documents.get(ref.path));
  }

  setData(path, value, options = {}) {
    const current = this.documents.get(path) || {};
    this.documents.set(
      path,
      options.merge ? { ...current, ...value } : value
    );
  }

  data(path) {
    return this.documents.get(path);
  }
}

class FakeBucket {
  constructor() {
    this.name = "demo-bucket";
    this.uploads = [];
  }

  file(path) {
    return {
      save: async (buffer, options) => {
        this.uploads.push({ path, buffer, options });
      }
    };
  }
}

const WORKSPACE = "workspace-a";
const UID = "worker-a";

function baseDocuments(overrides = {}) {
  return {
    [`workspaces/${WORKSPACE}/workerLinks/${UID}`]: {
      uid: UID,
      workspaceId: WORKSPACE,
      profileName: "Ana Perez",
      profileRut: "12.345.678-9",
      workerEmail: "ana@example.com",
      status: "active"
    },
    [`workspaces/${WORKSPACE}/workerAppData/${UID}`]: {
      uid: UID,
      profileName: "Ana Perez",
      profileRut: "12.345.678-9"
    },
    [`workspaces/${WORKSPACE}/published/medicalEquipment`]: {
      items: [
        {
          id: "scanner-1",
          name: "Scanner sala 1",
          code: "SC-001",
          brand: "Philips",
          model: "Brilliance",
          location: "Scanner"
        }
      ]
    },
    ...overrides
  };
}

function dependencies(db, bucket = new FakeBucket()) {
  return {
    db,
    HttpsError: FakeHttpsError,
    serverTimestamp: () => "server-timestamp",
    storageBucket: () => bucket,
    idFactory: () => "equipment-report-fixed",
    attachmentIdFactory: () => "attachment-fixed",
    nowISO: () => "2026-09-08T12:00:00.000Z",
    nowDate: () => new Date(2026, 8, 8, 12)
  };
}

function request(uid, data) {
  return {
    auth: uid
      ? { uid, token: { email: `${uid}@example.com` } }
      : null,
    data
  };
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test("trabajador crea reporte de equipo con adjunto en Storage", async () => {
  const db = new FakeFirestore(baseDocuments());
  const bucket = new FakeBucket();
  const dataUrl = `data:image/png;base64,${Buffer.from("fake-image").toString("base64")}`;

  const result = await createWorkerMedicalEquipmentReportHandler(
    request(UID, {
      workspaceId: WORKSPACE,
      equipmentId: "scanner-1",
      title: "Error en pantalla",
      detail: "El equipo muestra codigo F12 al iniciar.",
      severity: "high",
      files: [
        {
          name: "pantalla.png",
          type: "image/png",
          size: 10,
          dataUrl
        }
      ]
    }),
    dependencies(db, bucket)
  );

  assert.equal(result.ok, true);
  assert.equal(result.reportId, "equipment-report-fixed");
  assert.equal(bucket.uploads.length, 1);
  assert.match(
    bucket.uploads[0].path,
    /workspaces\/workspace-a\/attachments\/medicalEquipment\/scanner-1\/equipment-report-fixed\/attachment-fixed_pantalla\.png/
  );
  assert.equal(
    bucket.uploads[0].options.metadata.metadata.moduleId,
    "medicalEquipment"
  );

  const stored = db.data(
    `workspaces/${WORKSPACE}/medicalEquipmentReports/equipment-report-fixed`
  );
  assert.equal(stored.type, "medical_equipment_error");
  assert.equal(stored.status, "open");
  assert.equal(stored.equipmentId, "scanner-1");
  assert.equal(stored.equipmentName, "Scanner sala 1");
  assert.equal(stored.equipmentCode, "SC-001");
  assert.equal(stored.reportedByName, "Ana Perez");
  assert.equal(stored.workerRut, "12.345.678-9");
  assert.equal(stored.severity, "high");
  assert.equal(stored.attachments.length, 1);
  assert.equal(stored.attachments[0].storagePath, bucket.uploads[0].path);
});

test("rechaza reporte si el trabajador no esta enlazado", async () => {
  const db = new FakeFirestore(baseDocuments({
    [`workspaces/${WORKSPACE}/workerLinks/${UID}`]: undefined
  }));

  await rejectsWithCode(
    createWorkerMedicalEquipmentReportHandler(
      request(UID, {
        workspaceId: WORKSPACE,
        equipmentId: "scanner-1",
        title: "Error",
        detail: "Detalle del error."
      }),
      dependencies(db)
    ),
    "permission-denied"
  );
});

test("rechaza reporte de equipo no publicado", async () => {
  const db = new FakeFirestore(baseDocuments());

  await rejectsWithCode(
    createWorkerMedicalEquipmentReportHandler(
      request(UID, {
        workspaceId: WORKSPACE,
        equipmentId: "ecografo-99",
        title: "Error",
        detail: "Detalle del error."
      }),
      dependencies(db)
    ),
    "not-found"
  );
});
