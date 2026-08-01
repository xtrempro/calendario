import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("kanban crea tarjetas desde botones por columna con modal", async () => {
    const source = await readFile(
        new URL("../js/kanban.js", import.meta.url),
        "utf8"
    );

    assert.doesNotMatch(source, /data-kanban-form/);
    assert.match(source, /KANBAN_CREATABLE_COLUMNS = new Set\(\["pending", "progress"\]\)/);
    assert.match(source, /data-kanban-add-status/);
    assert.match(source, /function openCreateCardDialog\(status\)/);
    assert.match(source, /data-kanban-create-form/);
    assert.match(source, /name="title"[\s\S]{0,80}required/);
    assert.match(source, /name="detail"[\s\S]{0,80}textarea/);
    assert.match(source, /status: column\.key/);
});
