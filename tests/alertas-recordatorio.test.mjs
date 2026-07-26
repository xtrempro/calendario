// La Cloud Function de alertas de recordatorio decide que recordatorios avisar
// AHORA (hora de Chile), calcula la ocurrencia segun periodicidad, respeta el
// aviso 1 dia antes y no reenvia (mapa "sent").
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../functions/index.js", import.meta.url), "utf8");

// Salta la lista de parametros (puede tener {} en un default) antes de las llaves.
function grab(name) {
  const start = src.indexOf(`function ${name}(`);
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

const api = new Function(`
  ${grab("addDaysIso")}
  ${grab("parseReminderIso")}
  ${grab("reminderDaysInMonth")}
  ${grab("normalizeReminderPeriodicity")}
  ${grab("isReminderOccurrence")}
  ${grab("remindersDueNow")}
  ${grab("pruneReminderSent")}
  return { addDaysIso, isReminderOccurrence, remindersDueNow, pruneReminderSent };
`)();

test("ocurrencia: una sola vez / semanal / mensual / anual", () => {
  const { isReminderOccurrence } = api;
  assert.equal(isReminderOccurrence({ date: "2026-08-01", periodicity: "Una sola vez" }, "2026-08-01"), true);
  assert.equal(isReminderOccurrence({ date: "2026-08-01", periodicity: "Una sola vez" }, "2026-08-08"), false);

  // 2026-07-08 es miercoles; semanal cae cada miercoles desde esa fecha.
  assert.equal(isReminderOccurrence({ date: "2026-07-08", periodicity: "Semanal" }, "2026-07-15"), true);
  assert.equal(isReminderOccurrence({ date: "2026-07-08", periodicity: "Semanal" }, "2026-07-16"), false);
  assert.equal(isReminderOccurrence({ date: "2026-07-08", periodicity: "Semanal" }, "2026-07-01"), false); // antes del origen

  assert.equal(isReminderOccurrence({ date: "2026-01-31", periodicity: "Mensual" }, "2026-02-28"), true); // clamp a fin de mes
  assert.equal(isReminderOccurrence({ date: "2026-08-15", periodicity: "Anual" }, "2027-08-15"), true);
  assert.equal(isReminderOccurrence({ date: "2026-08-15", periodicity: "Anual" }, "2027-09-15"), false);
});

const now = { iso: "2026-08-01", hhmm: "09:05", tomorrowIso: "2026-08-02" };

test("avisa el mismo dia cuando paso la hora y es ocurrencia", () => {
  const due = api.remindersDueNow(
    [{ id: "r1", title: "Pago", date: "2026-08-01", periodicity: "Una sola vez", alertTime: "09:00" }],
    now, {}
  );
  assert.equal(due.length, 1);
  assert.equal(due[0].key, "r1:2026-08-01:day_of");
  assert.equal(due[0].body, "Pago");
});

test("no avisa antes de la hora configurada", () => {
  const early = { iso: "2026-08-01", hhmm: "08:30", tomorrowIso: "2026-08-02" };
  const due = api.remindersDueNow(
    [{ id: "r1", title: "Pago", date: "2026-08-01", periodicity: "Una sola vez", alertTime: "09:00" }],
    early, {}
  );
  assert.equal(due.length, 0);
});

test("no reenvia si ya fue enviado (mapa sent)", () => {
  const due = api.remindersDueNow(
    [{ id: "r1", title: "Pago", date: "2026-08-01", periodicity: "Una sola vez", alertTime: "09:00" }],
    now, { "r1:2026-08-01:day_of": "2026-08-01" }
  );
  assert.equal(due.length, 0);
});

test("avisa 1 dia antes ademas del mismo dia cuando se activa", () => {
  // Hoy 2026-08-01: manana 2026-08-02 es la ocurrencia (una sola vez).
  const due = api.remindersDueNow(
    [{ id: "r2", title: "Cita", date: "2026-08-02", periodicity: "Una sola vez", alertTime: "09:00", alertDayBefore: true }],
    now, {}
  );
  assert.deepEqual(due.map((d) => d.key), ["r2:2026-08-02:day_before"]);
  assert.match(due[0].body, /Mañana: Cita/);

  // Al dia siguiente (2026-08-02) avisa el mismo dia.
  const nextDay = { iso: "2026-08-02", hhmm: "09:05", tomorrowIso: "2026-08-03" };
  const due2 = api.remindersDueNow(
    [{ id: "r2", title: "Cita", date: "2026-08-02", periodicity: "Una sola vez", alertTime: "09:00", alertDayBefore: true }],
    nextDay, {}
  );
  assert.deepEqual(due2.map((d) => d.key), ["r2:2026-08-02:day_of"]);
});

test("sin alertDayBefore no avisa el dia previo", () => {
  const due = api.remindersDueNow(
    [{ id: "r2", title: "Cita", date: "2026-08-02", periodicity: "Una sola vez", alertTime: "09:00" }],
    now, {}
  );
  assert.equal(due.length, 0);
});

test("prune deja las marcas recientes y descarta las viejas", () => {
  const sent = {
    "r1:2026-08-01:day_of": "x",   // hoy
    "r1:2026-07-25:day_of": "x"    // > 2 dias atras
  };
  const pruned = api.pruneReminderSent(sent, "2026-08-01");
  assert.deepEqual(Object.keys(pruned), ["r1:2026-08-01:day_of"]);
});

test("la funcion programada existe con su schedule y region", () => {
  assert.match(src, /exports\.sendReminderAlerts = onSchedule\(/);
  assert.match(src, /schedule: "every 15 minutes"/);
  assert.match(src, /timeZone: "America\/Santiago"/);
  assert.match(src, /category: "reminders"/);
});
