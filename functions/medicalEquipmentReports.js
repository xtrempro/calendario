"use strict";

const { randomBytes } = require("node:crypto");

const ATTACHMENT_ACCEPT =
  ".png,.jpg,.jpeg,.gif,.webp,.bmp,.heic,.heif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx";
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENT_FILES = 10;
const MAX_ATTACHMENT_TOTAL_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(
  ATTACHMENT_ACCEPT.split(",").map((extension) => extension.slice(1))
);
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};
const REPORT_STATUSES = new Set(["open", "review", "resolved", "dismissed"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);

function cleanText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function callableError(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function defaultIdFactory(prefix, uid) {
  const safeUid = safePathSegment(uid, "worker");
  return `${prefix}_${safeUid}_${Date.now()}_${randomBytes(5).toString("hex")}`;
}

function defaultNowISO(nowDate = () => new Date()) {
  return nowDate().toISOString();
}

function fileExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function extensionForMime(type) {
  return Object.entries(MIME_BY_EXTENSION)
    .find(([, mime]) => mime === type)?.[0] || "";
}

function safePathSegment(value, fallback = "item") {
  const clean = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);

  return clean || fallback;
}

function idSafe(value) {
  return cleanText(value, 220).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function normalizeSeverity(value) {
  const severity = cleanText(value, 40);
  return SEVERITIES.has(severity) ? severity : "medium";
}

function normalizeStatus(value) {
  const status = cleanText(value, 40);
  return REPORT_STATUSES.has(status) ? status : "open";
}

function contentTypeFor(name, type) {
  const cleanType = cleanText(type, 160).toLowerCase();
  const extension = fileExtension(name);

  if (ALLOWED_MIME_TYPES.has(cleanType)) return cleanType;
  if (ALLOWED_EXTENSIONS.has(extension)) {
    return MIME_BY_EXTENSION[extension] || "application/octet-stream";
  }

  return "";
}

function decodeAttachment(file, HttpsError) {
  const name = cleanText(file?.name, 180);
  const dataUrl = String(file?.dataUrl || "");
  const base64Value = String(file?.base64 || "");
  const match = dataUrl.match(/^data:([^;,]+)?;base64,(.*)$/s);
  const base64 = (match ? match[2] : base64Value).replace(/\s/g, "");
  const dataUrlType = cleanText(match?.[1], 160).toLowerCase();
  const contentType = contentTypeFor(name, dataUrlType || file?.type);

  if (!name || !base64 || !contentType) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Uno de los adjuntos no tiene un formato permitido."
    );
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No se pudo leer uno de los adjuntos."
    );
  }

  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length || buffer.length > MAX_ATTACHMENT_SIZE) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Cada adjunto debe pesar hasta 10 MB."
    );
  }

  return {
    buffer,
    contentType,
    originalName: name,
    safeName: safePathSegment(
      name,
      `adjunto.${fileExtension(name) || extensionForMime(contentType) || "bin"}`
    )
  };
}

function validateBasePayload(request, HttpsError) {
  const uid = request.auth?.uid || "";

  if (!uid) {
    callableError(
      HttpsError,
      "unauthenticated",
      "Debes iniciar sesion para reportar una falla de equipo."
    );
  }

  const workspaceId = cleanText(request.data?.workspaceId, 160);

  if (!workspaceId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar la unidad."
    );
  }

  return { uid, workspaceId };
}

async function readRequiredWorkerLink(workspaceRef, uid, HttpsError) {
  const snap = await workspaceRef.collection("workerLinks").doc(uid).get();

  if (!snap.exists) {
    callableError(
      HttpsError,
      "permission-denied",
      "Tu cuenta ya no esta enlazada con esta unidad."
    );
  }

  return snap.data() || {};
}

async function readWorkerAppData(workspaceRef, uid) {
  const snap = await workspaceRef.collection("workerAppData").doc(uid).get();
  return snap.exists ? snap.data() || {} : {};
}

function normalizePublishedEquipment(item = {}) {
  const id = cleanText(item.id || item.code, 160);
  const name = cleanText(item.name || "Equipo medico", 180);

  if (!id || !name) return null;

  return {
    id,
    name,
    code: cleanText(item.code, 120),
    brand: cleanText(item.brand, 120),
    model: cleanText(item.model, 120),
    location: cleanText(item.location, 180),
    status: cleanText(item.status || "operational", 40),
    nextMaintenanceAt: cleanText(item.nextMaintenanceAt, 10)
  };
}

async function readPublishedEquipment(workspaceRef, equipmentId, HttpsError) {
  const snap = await workspaceRef
    .collection("published")
    .doc("medicalEquipment")
    .get();
  const items = Array.isArray(snap.data()?.items)
    ? snap.data().items
    : [];
  const equipment = items
    .map(normalizePublishedEquipment)
    .filter(Boolean)
    .find((item) => item.id === equipmentId);

  if (!equipment || equipment.status === "inactive") {
    callableError(
      HttpsError,
      "not-found",
      "El equipo seleccionado ya no esta disponible en tu unidad."
    );
  }

  return equipment;
}

function storageDownloadURL(bucketName, storagePath, token) {
  return [
    "https://firebasestorage.googleapis.com/v0/b/",
    encodeURIComponent(bucketName),
    "/o/",
    encodeURIComponent(storagePath),
    "?alt=media&token=",
    encodeURIComponent(token)
  ].join("");
}

async function uploadAttachments({
  bucket,
  files,
  workspaceId,
  uid,
  equipmentId,
  reportId,
  createdAt,
  HttpsError,
  attachmentIdFactory = () => `attachment_${randomBytes(8).toString("hex")}`
}) {
  if (!files.length) return [];

  if (!bucket) {
    callableError(
      HttpsError,
      "failed-precondition",
      "El almacenamiento de adjuntos no esta disponible."
    );
  }

  let totalSize = 0;
  const decodedFiles = files.map((file) => {
    const decoded = decodeAttachment(file, HttpsError);
    totalSize += decoded.buffer.length;
    return decoded;
  });

  if (totalSize > MAX_ATTACHMENT_TOTAL_SIZE) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Los adjuntos no pueden superar 10 MB en total."
    );
  }

  const ownerId = safePathSegment(equipmentId, "equipment");
  const recordId = safePathSegment(reportId, "equipment_report");
  const attachments = [];

  for (const decoded of decodedFiles) {
    const id = attachmentIdFactory();
    const downloadToken = randomBytes(24).toString("hex");
    const storagePath = [
      "workspaces",
      safePathSegment(workspaceId, "workspace"),
      "attachments",
      "medicalEquipment",
      ownerId,
      recordId,
      `${safePathSegment(id, "attachment")}_${decoded.safeName}`
    ].join("/");

    await bucket.file(storagePath).save(decoded.buffer, {
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=0, no-cache",
        contentType: decoded.contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          workspaceId,
          moduleId: "medicalEquipment",
          ownerId,
          recordId,
          uploadedByUid: uid,
          originalName: decoded.originalName
        }
      }
    });

    attachments.push({
      id,
      name: decoded.originalName,
      type: decoded.contentType,
      size: decoded.buffer.length,
      addedAt: createdAt,
      uploadedByUid: uid,
      storagePath,
      downloadURL: storageDownloadURL(bucket.name, storagePath, downloadToken)
    });
  }

  return attachments;
}

async function createWorkerMedicalEquipmentReportHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    storageBucket,
    idFactory = defaultIdFactory,
    nowISO = defaultNowISO,
    nowDate = () => new Date(),
    attachmentIdFactory
  } = dependencies;
  const { uid, workspaceId } = validateBasePayload(request, HttpsError);
  const equipmentId = cleanText(request.data?.equipmentId, 160);
  const title = cleanText(request.data?.title, 160);
  const detail = cleanText(request.data?.detail || request.data?.note, 3000);
  const severity = normalizeSeverity(request.data?.severity);
  const files = Array.isArray(request.data?.files)
    ? request.data.files.slice(0, MAX_ATTACHMENT_FILES + 1)
    : [];

  if (!equipmentId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Selecciona el equipo que presenta la falla."
    );
  }

  if (!title) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Ingresa un titulo breve para la falla."
    );
  }

  if (!detail) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Describe que ocurre con el equipo."
    );
  }

  if (files.length > MAX_ATTACHMENT_FILES) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Puedes adjuntar hasta 10 archivos."
    );
  }

  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const [link, appData, equipment] = await Promise.all([
    readRequiredWorkerLink(workspaceRef, uid, HttpsError),
    readWorkerAppData(workspaceRef, uid),
    readPublishedEquipment(workspaceRef, equipmentId, HttpsError)
  ]);
  const reportId =
    idSafe(request.data?.reportId) ||
    idFactory("equipment_report", uid);
  const reportRef = workspaceRef
    .collection("medicalEquipmentReports")
    .doc(reportId);
  const existingReport = await reportRef.get();

  if (existingReport.exists) {
    callableError(
      HttpsError,
      "already-exists",
      "Este reporte ya fue enviado."
    );
  }

  const createdAt = cleanText(request.data?.createdAt, 40) ||
    nowISO(nowDate);
  const workerName = cleanText(
    link.profileName || appData.profileName || "Trabajador",
    180
  );
  const workerRut = cleanText(link.profileRut || appData.profileRut || "", 80);
  const createdByEmail = cleanText(
    request.auth?.token?.email || link.workerEmail || appData.workerEmail || "",
    254
  );
  const attachments = await uploadAttachments({
    bucket: storageBucket ? storageBucket() : null,
    files,
    workspaceId,
    uid,
    equipmentId,
    reportId,
    createdAt,
    HttpsError,
    attachmentIdFactory
  });
  const now = serverTimestamp();
  const reportData = {
    id: reportId,
    workspaceId,
    type: "medical_equipment_error",
    source: "worker_app",
    channel: "app",
    status: normalizeStatus(request.data?.status),
    equipmentId,
    equipmentName: equipment.name,
    equipmentCode: equipment.code,
    equipmentBrand: equipment.brand,
    equipmentModel: equipment.model,
    equipmentLocation: equipment.location,
    title,
    detail,
    severity,
    date: cleanText(request.data?.date, 10) || createdAt.slice(0, 10),
    reportedByName: workerName,
    worker: workerName,
    workerRut,
    attachments,
    createdAt: now,
    createdAtISO: createdAt,
    updatedAt: now,
    updatedAtISO: createdAt,
    createdByUid: uid,
    createdByEmail
  };

  if (typeof reportRef.create === "function") {
    await reportRef.create(reportData);
  } else {
    await reportRef.set(reportData, { merge: false });
  }

  return {
    ok: true,
    reportId,
    attachments,
    report: {
      ...reportData,
      createdAt,
      updatedAt: createdAt
    }
  };
}

module.exports = {
  createWorkerMedicalEquipmentReportHandler,
  _private: {
    ATTACHMENT_ACCEPT,
    MAX_ATTACHMENT_FILES,
    MAX_ATTACHMENT_SIZE,
    MAX_ATTACHMENT_TOTAL_SIZE,
    contentTypeFor,
    normalizePublishedEquipment,
    normalizeSeverity
  }
};
