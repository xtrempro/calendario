// Anulacion de un permiso ACEPTADO a pedido del trabajador. Lo critico: ubicar
// el registro correcto del LOG (perfil + fecha + tipo) para no revertir el
// permiso equivocado, y reutilizar undoAuditLogEntry (revierte calendario,
// saldos y reemplazos).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../js/workerRequests.js", import.meta.url), "utf8");

function grab(name) {
  let start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `no se encontro ${name}`);
  if (src.slice(start - 6, start) === "async ") start -= 6;
  let paren = 0, i = src.indexOf("(", start);
  for (; i < src.length; i += 1) { if (src[i] === "(") paren++; else if (src[i] === ")") { paren--; if (!paren) { i++; break; } } }
  let depth = 0;
  for (let j = src.indexOf("{", i); j < src.length; j += 1) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (!depth) return src.slice(start, j + 1); }
  }
  throw new Error(`sin cierre: ${name}`);
}

const LEAVE = "leave_absence";
const logs = [
  { id: "L1", category: LEAVE, profile: "Juan Perez", meta: { date: "2026-09-11", type: "legal" } },
  { id: "L2", category: LEAVE, profile: "Juan Perez", meta: { date: "2026-10-01", type: "admin" } },
  { id: "L3", category: LEAVE, profile: "Ana Soto", meta: { date: "2026-09-11", type: "legal" } },
  { id: "L4", category: LEAVE, profile: "Juan Perez", meta: { date: "2026-11-01", type: "legal" }, canceledAt: "x" }
];

function build(extra = {}) {
  const undone = [];
  const patched = [];
  const env = {
    AUDIT_CATEGORY: { LEAVE_ABSENCE: LEAVE },
    getAuditLogs: () => logs,
    resolveProfileName: (r) => r.profile,
    undoAuditLogEntry: async (id) => { undone.push(id); return { ok: extra.undoOk !== false }; },
    saveUpdatedRequest: (id, patch) => patched.push({ id, patch })
  };
  const code = `
    const LEAVE_CANCEL_TYPES = new Set(["admin","half_admin_morning","half_admin_afternoon","legal","comp","union_leave","unpaid_leave"]);
    ${grab("leaveLogCoversDate")}
    ${grab("findLeaveApplicationLog")}
    ${grab("applyLeaveCancellation")}
    return { findLeaveApplicationLog, applyLeaveCancellation, leaveLogCoversDate };
  `;
  const api = new Function(...Object.keys(env), code)(...Object.values(env));
  return { ...api, undone, patched };
}

test("ubica el LOG unico por perfil + fecha + tipo", () => {
  const { findLeaveApplicationLog } = build();
  assert.equal(findLeaveApplicationLog("Juan Perez", "2026-09-11", "legal")?.id, "L1");
  // Otro perfil con misma fecha/tipo no se confunde.
  assert.equal(findLeaveApplicationLog("Ana Soto", "2026-09-11", "legal")?.id, "L3");
});

test("no ubica nada si esta anulado, no existe o falta dato", () => {
  const { findLeaveApplicationLog } = build();
  assert.equal(findLeaveApplicationLog("Juan Perez", "2026-11-01", "legal"), null); // L4 canceled
  assert.equal(findLeaveApplicationLog("Juan Perez", "2026-09-11", "admin"), null); // tipo no calza
  assert.equal(findLeaveApplicationLog("", "2026-09-11", "legal"), null);
});

test("aceptar la anulacion revierte via undo y marca el permiso original", async () => {
  const box = build();
  const res = await box.applyLeaveCancellation({
    profile: "Juan Perez", leaveType: "legal", date: "2026-09-11", originalRequestId: "REQ-1"
  });

  assert.deepEqual(res, { ok: true });
  assert.deepEqual(box.undone, ["L1"], "se anulo el LOG correcto");
  assert.equal(box.patched[0].id, "REQ-1");
  assert.equal(box.patched[0].patch.status, "canceled");
});

test("si no se encuentra el permiso, no revierte nada y avisa", async () => {
  const box = build();
  const res = await box.applyLeaveCancellation({
    profile: "Juan Perez", leaveType: "comp", date: "2026-09-11", originalRequestId: "REQ-9"
  });

  assert.equal(res.ok, false);
  assert.match(res.message, /manualmente desde el LOG/);
  assert.deepEqual(box.undone, [], "no se toca ningun LOG");
  assert.deepEqual(box.patched, []);
});

test("tipo de permiso no valido se rechaza", async () => {
  const box = build();
  const res = await box.applyLeaveCancellation({ profile: "Juan", leaveType: "swap", date: "2026-09-11" });
  assert.equal(res.ok, false);
  assert.deepEqual(box.undone, []);
});

test("permiso multi-dia: ubica el LOG si se toca un dia intermedio (cobertura)", () => {
  const { leaveLogCoversDate } = build();
  const log = { meta: { date: "2026-09-10", amount: 5 } }; // 10..14
  assert.equal(leaveLogCoversDate(log, "2026-09-10"), true); // inicio
  assert.equal(leaveLogCoversDate(log, "2026-09-12"), true); // intermedio
  assert.equal(leaveLogCoversDate(log, "2026-09-14"), true); // fin
  assert.equal(leaveLogCoversDate(log, "2026-09-15"), false); // fuera
  assert.equal(leaveLogCoversDate(log, "2026-09-09"), false); // antes
});

test("el dispatcher enruta leave_cancel y trae etiqueta", () => {
  assert.match(src, /if \(request\.type === "leave_cancel"\) \{\s*\n\s*return applyLeaveCancellation\(request\);/);
  assert.match(src, /leave_cancel: "Anulación de permiso"/);
  // Notifica al trabajador al aceptar y al rechazar.
  assert.match(src, /aprobó la anulación de tu/);
  assert.match(src, /no aprobó la anulación de tu/);
});
