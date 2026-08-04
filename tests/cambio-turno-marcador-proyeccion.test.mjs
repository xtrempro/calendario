// El engine de proyeccion debe publicar, por cada dia de un cambio de turno
// aplicado, un marcador { type, label } (CCTT/DDTT) para que la PWA del trabajador
// lo muestre igual que el calendario del supervisor. Reutiliza getCambioTurnoCalendario
// (la misma fuente que usa el supervisor).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engineSrc = await readFile(
  new URL("../js/serverEngine.js", import.meta.url),
  "utf8"
);
const swapsSrc = await readFile(
  new URL("../js/swaps.js", import.meta.url),
  "utf8"
);

test("swaps.js expone getCambioTurnoCalendario con etiquetas CCTT/DDTT", () => {
  assert.match(swapsSrc, /export function getCambioTurnoCalendario/);
  assert.match(swapsSrc, /`CCTT \$\{perspective\.changeTurnLabel\}`/);
  assert.match(swapsSrc, /`DDTT \$\{perspective\.returnTurnLabel\}`/);
});

test("el engine importa y usa getCambioTurnoCalendario por dia", () => {
  assert.match(
    engineSrc,
    /import \{ activeMonthlySwapCount, getCambioTurnoCalendario \} from "\.\/swaps\.js"/
  );
  assert.match(engineSrc, /const swapMarker = getCambioTurnoCalendario\(profile\.name, keyDay\)/);
});

test("el dia de la proyeccion incluye swapMarker solo cuando hay cambio", () => {
  assert.match(
    engineSrc,
    /\.\.\.\(swapMarker\s*\n?\s*\? \{ swapMarker: \{ type: swapMarker\.type, label: swapMarker\.label \} \}\s*\n?\s*: \{\}\)/
  );
});

test("un dia con marcador CCTT/DDTT se publica como excepcion", () => {
  // dayDiffersFromBase compara el label del marcador para no perder el cambio
  // cuando el turno coincide con la base.
  assert.match(
    engineSrc,
    /String\(actual\.swapMarker\?\.label \|\| ""\) !== String\(base\.swapMarker\?\.label \|\| ""\)/
  );
});
