import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../js/workerRequests.js", import.meta.url),
  "utf8"
);

test("las solicitudes de marcaje conservan adjuntos al aplicarse al reloj", () => {
  assert.match(source, /function normalizeClockRequestDocuments\(request = \{\}\)/);
  assert.match(source, /if \(Array\.isArray\(segment\.documents\)\)/);
  assert.match(source, /attachRequestDocumentsToClockMark\(mark, request\)/);
  assert.match(source, /segment\.documents = \[\.\.\.currentDocuments, \.\.\.documents\]/);
});

test("la tarjeta del supervisor muestra que la incidencia trae adjuntos", () => {
  assert.match(source, /request\.type === "missing_clock"/);
  assert.match(source, /request\.type === "clock_incident"/);
  assert.match(source, /const documentCount = normalizeClockRequestDocuments\(request\)\.length/);
  assert.match(source, /pieces\.push\(`\$\{documentCount\} adjunto\(s\)`\)/);
});
