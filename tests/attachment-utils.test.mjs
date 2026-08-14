import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    attachmentStorageErrorMessage,
    canPreviewAttachment,
    MAX_ATTACHMENT_FILES,
    MAX_ATTACHMENT_SIZE,
    MAX_ATTACHMENT_TOTAL_SIZE,
    validateAttachmentFile,
    validateAttachmentFiles
} from "../js/attachmentUtils.js";

test("los adjuntos permiten hasta 10 MB por archivo", () => {
    assert.equal(MAX_ATTACHMENT_SIZE, 10 * 1024 * 1024);
    assert.equal(MAX_ATTACHMENT_TOTAL_SIZE, MAX_ATTACHMENT_SIZE * MAX_ATTACHMENT_FILES);

    const allowed = new File(
        [new Uint8Array(MAX_ATTACHMENT_SIZE)],
        "respaldo.pdf",
        { type: "application/pdf" }
    );
    const progressiveJpeg = new File(
        [new Uint8Array(4)],
        "programacion.jpg",
        { type: "image/pjpeg" }
    );
    const tooLarge = new File(
        [new Uint8Array(MAX_ATTACHMENT_SIZE + 1)],
        "muy-grande.pdf",
        { type: "application/pdf" }
    );

    assert.equal(validateAttachmentFile(allowed), allowed);
    assert.equal(validateAttachmentFile(progressiveJpeg), progressiveJpeg);
    assert.throws(
        () => validateAttachmentFile(tooLarge),
        /10 MB/
    );
    assert.throws(
        () => validateAttachmentFiles(
            Array.from({ length: MAX_ATTACHMENT_FILES + 1 }, (_, index) =>
                new File([new Uint8Array(1)], `archivo-${index}.pdf`, {
                    type: "application/pdf"
                })
            )
        ),
        /Puedes adjuntar hasta/
    );
});

test("Storage Rules conservan limite de 10 MB por objeto", () => {
    const rules = readFileSync("storage.rules", "utf8");

    assert.match(rules, /request\.resource\.size <= 10 \* 1024 \* 1024/);
    assert.doesNotMatch(rules, /request\.resource\.size <= 5 \* 1024 \* 1024/);
});

test("la programacion publicada usa Storage de tareas y solo imagenes", () => {
    const source = readFileSync(
        fileURLToPath(new URL("../js/taskAssignments.js", import.meta.url)),
        "utf8"
    );
    const syncSource = readFileSync(
        fileURLToPath(new URL("../js/workerAppDataSync.js", import.meta.url)),
        "utf8"
    );
    const engineSource = readFileSync(
        fileURLToPath(new URL("../js/serverEngine.js", import.meta.url)),
        "utf8"
    );
    const functionsSource = readFileSync("functions/index.js", "utf8");
    const rules = readFileSync("storage.rules", "utf8");

    assert.match(source, /SCHEDULE_ATTACHMENT_KEY = "weekly_task_schedule_attachment"/);
    assert.match(source, /data-task-schedule-attach>Adjuntar Programaci&oacute;n/);
    assert.match(source, /Formatos aceptados: PNG, JPG, JPEG, GIF, WEBP, BMP, HEIC o HEIF\. M&aacute;ximo 10 MB\./);
    assert.match(source, /createScheduleAttachment\(file\)/);
    assert.match(source, /compressedScheduleDataUrl\(file\)/);
    assert.match(source, /httpsCallable\([\s\S]*"uploadScheduleAttachment"/);
    assert.match(source, /normalizeScheduleOcr\(value\.ocr\)/);
    assert.match(source, /Publicando y leyendo OCR/);
    assert.doesNotMatch(source, /storageFallbackReason/);
    assert.doesNotMatch(source, /inlineScheduleAttachment/);
    assert.match(source, /publishWorkerScheduleAttachmentNow\(getScheduleAttachment\(\)\)/);
    assert.match(functionsSource, /exports\.uploadScheduleAttachment = onCall/);
    assert.match(functionsSource, /automaticScheduleImageOcr\(decoded/);
    assert.match(functionsSource, /DOCUMENT_TEXT_DETECTION/);
    assert.match(functionsSource, /reviewRequired: false/);
    assert.match(functionsSource, /ocr/);
    assert.match(functionsSource, /enforceAppCheck: ENFORCE_APP_CHECK/);
    assert.match(functionsSource, /SCHEDULE_ATTACHMENT_MODULE_ID = "tasks"/);
    assert.match(functionsSource, /SCHEDULE_ATTACHMENT_OWNER_ID = "weekly-schedule"/);
    assert.match(functionsSource, /SCHEDULE_ATTACHMENT_RECORD_ID = "published-schedule"/);
    assert.match(functionsSource, /firebaseStorageDownloadTokens/);
    assert.match(functionsSource, /downloadURL: storageDownloadURL/);
    assert.match(syncSource, /export async function publishWorkerScheduleAttachmentNow\(attachment\)/);
    assert.match(syncSource, /weeklyScheduleAttachment: payload/);
    assert.match(syncSource, /weeklyScheduleAttachment: firestoreModule\.deleteField\(\)/);
    assert.match(syncSource, /downloadURL/);
    assert.match(syncSource, /writeBatch\(db\)/);
    assert.match(engineSource, /weeklyScheduleAttachment: getPublishedScheduleAttachment\(\)/);
    assert.match(engineSource, /downloadURL/);
    assert.match(rules, /function allowedScheduleImage\(\)/);
    assert.match(rules, /function isPublishedScheduleAttachment\(moduleId, ownerId, recordId\)/);
    assert.match(rules, /workerLinks\/\$\(request\.auth\.uid\)/);
    assert.match(rules, /moduleId != "tasks"/);
});

test("solo archivos previsualizables abren pestana", () => {
    assert.equal(canPreviewAttachment({
        name: "contrato.pdf",
        type: "application/pdf"
    }), true);
    assert.equal(canPreviewAttachment({
        name: "foto.jpg",
        type: "image/jpeg"
    }), true);
    assert.equal(canPreviewAttachment({
        name: "planilla.xlsx",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }), false);
    assert.equal(canPreviewAttachment({
        name: "documento.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }), false);
});

test("los adjuntos de Storage se abren por URL de descarga, no con getBlob", () => {
    // getBlob hace un fetch del binario que exige CORS del bucket y se cuelga
    // ~2 min (retry-limit-exceeded). Abrir con getDownloadURL por navegacion lo
    // evita. Esta guarda impide reintroducir getBlob para abrir adjuntos.
    const source = readFileSync(
        fileURLToPath(new URL("../js/attachmentUtils.js", import.meta.url)),
        "utf8"
    );

    assert.match(source, /getDownloadURL\(/);
    assert.doesNotMatch(source, /storageModule\.getBlob\(/);
});

test("errores tecnicos de Firebase Storage se traducen a mensajes utiles", () => {
    assert.equal(
        attachmentStorageErrorMessage({
            code: "storage/retry-limit-exceeded",
            message: "Firebase Storage: Max retry time for operation exceeded"
        }, "abrir"),
        "Firebase Storage no pudo abrir el archivo. Revisa la conexion, recarga TurnoPlus e intenta nuevamente."
    );
    assert.equal(
        attachmentStorageErrorMessage({ code: "storage/object-not-found" }, "abrir"),
        "El archivo adjunto ya no esta disponible en TurnoPlus."
    );
    assert.equal(
        attachmentStorageErrorMessage({ code: "storage/unauthorized" }, "subir"),
        "No tienes permisos para subir este archivo adjunto en la unidad activa."
    );
});
