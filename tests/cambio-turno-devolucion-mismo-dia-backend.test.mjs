// Cloud Functions del cambio de turno: la devolucion PUEDE caer el mismo dia del
// cambio. Es el cruce en que uno entrega su Noche y recibe la Larga del otro; los
// dos turnos salen y entran el mismo dia, asi que nadie queda con 24h. El
// servidor lo rechazaba de plano y ProTurnos si lo registra.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(
  new URL("../functions/workerSwapRequests.js", import.meta.url),
  "utf8"
);

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

const validateSwapDates = new Function(`
  ${grab("cleanText")}
  ${grab("normalizeISODate")}
  ${grab("parseISODateParts")}
  ${grab("sameMonth")}
  ${grab("callableError")}
  ${grab("validateSwapDates")}
  return validateSwapDates;
`)();

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

test("crear: la devolucion puede ser el mismo dia del cambio", () => {
  assert.doesNotThrow(() =>
    validateSwapDates({
      ownDate: "2026-10-23",
      returnDate: "2026-10-23",
      HttpsError
    })
  );
});

test("crear: la devolucion sigue teniendo que ser del mismo mes", () => {
  assert.throws(
    () =>
      validateSwapDates({
        ownDate: "2026-10-23",
        returnDate: "2026-11-23",
        HttpsError
      }),
    /mismo mes/
  );
});

test("crear: una fecha invalida sigue siendo invalida", () => {
  assert.throws(
    () => validateSwapDates({ ownDate: "no-es-fecha", returnDate: "2026-10-23", HttpsError }),
    /no son validas/
  );
});

test("responder: aceptar un turno abierto ya no exige fechas distintas", () => {
  // El que acepta ofrece su propio turno de ese mismo dia: mismo cruce, visto
  // desde el otro lado.
  assert.doesNotMatch(
    src,
    /changeDate === effectiveReturnDate/,
    "el respond volvia a bloquear el cruce del mismo dia"
  );
  // Pero el mes se sigue validando.
  assert.match(src, /!sameMonth\(changeDate, effectiveReturnDate\)/);
});
