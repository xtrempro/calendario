import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
    return readFile(new URL(path, import.meta.url), "utf8");
}

test("Informaciones queda enganchado al panel supervisor y a permisos", async () => {
    const [
        html,
        main,
        navigation,
        permissions,
        modules,
        attachments,
        css
    ] = await Promise.all([
        read("../index.html"),
        read("../js/main.js"),
        read("../js/navigation.js"),
        read("../js/workspacePermissions.js"),
        read("../js/firebaseStateModules.js"),
        read("../js/attachmentUtils.js"),
        read("../styles.css")
    ]);

    assert.match(html, /data-target="informationsPanel"[\s\S]{0,900}INFORMACIONES/);
    assert.match(html, /<section id="informationsPanel" class="panel informations-panel"><\/section>/);
    assert.match(navigation, /targetId === "informationsPanel"[\s\S]{0,80}return "informations";/);
    assert.match(main, /renderInformationsPanel/);
    assert.match(main, /nextView === "informations"[\s\S]{0,100}renderInformationsPanel\(\)/);
    assert.match(permissions, /key: "informations"[\s\S]{0,90}target: "informationsPanel"/);
    assert.match(modules, /informations:\s*\{\s*permission:\s*"informations"\s*\}/);
    assert.match(modules, /\["informations",\s*"informations"\]/);
    assert.match(attachments, /"informations"/);
    assert.match(css, /body:not\(\[data-active-view="informations"\]\) #informationsPanel/);
    assert.match(css, /\.actionbar \.nav-tile\[data-target="informationsPanel"\]\s*\{[\s\S]{0,80}order:\s*15/);
});

test("Informaciones publica a trabajadores enlazados con reglas dedicadas", async () => {
    const firestoreRules = await read("../firebase.rules");
    const storageRules = await read("../storage.rules");
    const source = await read("../js/informations.js");

    assert.match(source, /"workspaces",[\s\S]{0,120}"published",[\s\S]{0,80}PUBLISHED_DOC_ID/);
    assert.match(source, /moduleId:\s*"informations"[\s\S]{0,120}ownerId:\s*"published"/);
    assert.match(source, /publicInformationsPayload/);
    assert.doesNotMatch(source, /dataUrl:[\s\S]{0,80}publicAttachmentPayload/);

    assert.match(firestoreRules, /function canViewInformationsMenu\(workspaceId\)/);
    assert.match(firestoreRules, /function canEditInformationsMenu\(workspaceId\)/);
    assert.match(firestoreRules, /!\("informations" in permissions\)[\s\S]{0,80}memberCanEditSomething\(workspaceId\)/);
    assert.match(firestoreRules, /docId == "informations" && canViewInformationsMenu\(workspaceId\)/);
    assert.match(firestoreRules, /docId == "informations" && canEditInformationsMenu\(workspaceId\)/);
    assert.match(firestoreRules, /moduleId == "informations" && canViewInformationsMenu\(workspaceId\)/);
    assert.match(firestoreRules, /moduleId == "informations" && canEditInformationsMenu\(workspaceId\)/);

    assert.match(storageRules, /function isPublishedInformationAttachment\(moduleId, ownerId\)/);
    assert.match(storageRules, /moduleId == "informations"[\s\S]{0,80}ownerId == "published"/);
    assert.match(storageRules, /function canPublishInformationAttachment\(workspaceId\)/);
    assert.match(storageRules, /!\("informations" in permissions\)[\s\S]{0,80}memberRequiresMfa\(workspaceId\)/);
    assert.match(storageRules, /isPublishedInformationAttachment\(moduleId, ownerId\)[\s\S]{0,160}canPublishInformationAttachment\(workspaceId\)[\s\S]{0,80}allowedFile\(\)/);
    assert.match(storageRules, /isPublishedInformationAttachment\(moduleId, ownerId\)[\s\S]{0,180}workerLinks/);
});
