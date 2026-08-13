// El motor publica clockMarkModifications (modificaciones de marcaje del supervisor:
// recuperacion / horas extra netas / reduccion por dia) para que la PWA del
// trabajador las muestre. clockMarkDayDetail arma el detalle estructurado por dia.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../js/hoursReport.js", import.meta.url), "utf8");
const engineSrc = await readFile(new URL("../js/serverEngine.js", import.meta.url), "utf8");

function grab(name) {
  const decl = `function ${name}(`;
  let start = src.indexOf(`export ${decl}`);
  if (start !== -1) start += "export ".length;
  else start = src.indexOf(decl);
  assert.notEqual(start, -1, `no se encontro ${name}`);
  // Saltar la lista de parametros (puede tener `= {}` por defecto) antes del cuerpo.
  let paren = 0, i = src.indexOf("(", start);
  for (; i < src.length; i += 1) { if (src[i] === "(") paren++; else if (src[i] === ")") { paren--; if (!paren) { i++; break; } } }
  let depth = 0;
  for (let j = src.indexOf("{", i); j < src.length; j += 1) {
    if (src[j] === "{") depth += 1;
    else if (src[j] === "}") { depth -= 1; if (!depth) return src.slice(start, j + 1); }
  }
  throw new Error(`sin cierre: ${name}`);
}

function buildDetail(env) {
  return new Function(...Object.keys(env), `${grab("clockMarkDayDetail")} return clockMarkDayDetail;`)(
    ...Object.values(env)
  );
}

const baseEnv = {
  getClockScheduleState: () => 1,
  getScheduledSegmentsForProfile: () => [{ start: 0, end: 100 }]
};

test("un dia con recuperacion Y horas extra trae ambas etiquetas + minutos", () => {
  const fn = buildDetail({
    ...baseEnv,
    getClockMarks: () => ({ K: { segments: [{}] } }),
    findClockMarkEntry: () => ({ value: { entryTime: "08:10", exitTime: "18:30" } }),
    classifyClockMarkSegment: () => ({ recoveryMinutes: 30, netExtraMinutes: 15, uncoveredMinutes: 0, isReduction: false })
  });
  const d = fn("Ana", "K", new Date(), 1, {});
  assert.equal(d.recoveryMinutes, 30);
  assert.equal(d.netExtraMinutes, 15);
  assert.equal(d.entryTime, "08:10");
  assert.equal(d.exitTime, "18:30");
  assert.deepEqual(d.badges, ["Recuperación de horas", "Genera horas extra"]);
});

test("solo reduccion (atraso sin recuperar)", () => {
  const fn = buildDetail({
    ...baseEnv,
    getClockMarks: () => ({ K: { segments: [{}] } }),
    findClockMarkEntry: () => ({ value: { exitTime: "07:20" } }),
    classifyClockMarkSegment: () => ({ recoveryMinutes: 0, netExtraMinutes: 0, uncoveredMinutes: 40, isReduction: true })
  });
  const d = fn("Ana", "K", new Date(), 2, {});
  assert.equal(d.uncoveredMinutes, 40);
  assert.deepEqual(d.badges, ["Reducción de jornada"]);
});

test("marca faltante -> Sin entrada / Sin salida", () => {
  const fn = buildDetail({
    ...baseEnv,
    getClockMarks: () => ({ K: { segments: [{}] } }),
    findClockMarkEntry: () => ({ value: { missingEntry: true, missingExit: true } }),
    classifyClockMarkSegment: () => ({ recoveryMinutes: 0, netExtraMinutes: 0, uncoveredMinutes: 0, isReduction: false })
  });
  const d = fn("Ana", "K", new Date(), 1, {});
  assert.equal(d.missingEntry, true);
  assert.equal(d.missingExit, true);
  assert.deepEqual(d.badges, ["Sin entrada", "Sin salida"]);
});

test("sin marca registrada -> null (no engorda la proyeccion)", () => {
  const fn = buildDetail({ ...baseEnv, getClockMarks: () => ({}), findClockMarkEntry: () => null, classifyClockMarkSegment: () => ({}) });
  assert.equal(fn("Ana", "K", new Date(), 1, {}), null);
});

test("el builder salta dias futuros y el motor publica clockMarkModifications", () => {
  assert.match(src, /export async function buildWorkerClockMarkModifications/);
  assert.match(src, /if \(date > today\) break;/);
  // serverEngine computa y publica el mapa junto a overtimeSummaries.
  assert.match(engineSrc, /buildWorkerClockMarkModifications/);
  assert.match(engineSrc, /clockMarkModifications,/);
});
