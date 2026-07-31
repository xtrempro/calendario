import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const {
  findWorkerLinkForProfile,
  normalizeProjectionRut,
  profilesFromState
} = require("../functions/lib/engineHarness.js");

const serverEngineSrc = await readFile(
  new URL("../js/serverEngine.js", import.meta.url),
  "utf8"
);

function grab(name) {
  const start = serverEngineSrc.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `no se encontro ${name}`);
  const paramsEnd = serverEngineSrc.indexOf(") {", start);
  assert.notEqual(paramsEnd, -1, `no se encontro el cuerpo de ${name}`);
  let depth = 0;
  for (let i = paramsEnd + 2; i < serverEngineSrc.length; i += 1) {
    if (serverEngineSrc[i] === "{") depth += 1;
    else if (serverEngineSrc[i] === "}") {
      depth -= 1;
      if (!depth) return serverEngineSrc.slice(start, i + 1);
    }
  }
  throw new Error(`sin cierre de ${name}`);
}

function makeResolveProjectionProfile(profiles) {
  const normalizeText = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  return new Function(
    "getProfiles",
    "normalizeText",
    `${grab("normalizeProjectionRut")}
${grab("resolveProjectionProfile")}
return resolveProjectionProfile;`
  )(() => profiles, normalizeText);
}

test("normaliza RUT para comparar enlaces y perfiles", () => {
  assert.equal(normalizeProjectionRut("17.816.632-8"), "178166328");
  assert.equal(normalizeProjectionRut("12.345.678-k"), "12345678K");
  assert.equal(normalizeProjectionRut(""), "");
});

test("el harness encuentra workerLink por RUT aunque el nombre del link sea distinto", () => {
  const profiles = [
    {
      name: "Francisca Olave Salinas",
      rut: "17.816.632-8"
    }
  ];
  const links = [
    {
      uid: "uid-francisca",
      profileName: "FRANCISCA ANASTASIA OLAVE SALINAS",
      profileRut: "178166328"
    }
  ];

  const link = findWorkerLinkForProfile(
    "Francisca Olave Salinas",
    profiles,
    links
  );

  assert.equal(link.uid, "uid-francisca");
});

test("el motor resuelve el perfil real por RUT antes de caer en profile_not_found", () => {
  const profiles = [
    {
      name: "Francisca Olave Salinas",
      rut: "17.816.632-8"
    }
  ];
  const resolveProjectionProfile = makeResolveProjectionProfile(profiles);
  const profile = resolveProjectionProfile(
    "FRANCISCA ANASTASIA OLAVE SALINAS",
    {
      profileName: "FRANCISCA ANASTASIA OLAVE SALINAS",
      profileRut: "178166328"
    }
  );

  assert.equal(profile.name, "Francisca Olave Salinas");
});

test("profilesFromState lee perfiles desde el estado serializado", () => {
  assert.deepEqual(
    profilesFromState({
      profiles: JSON.stringify([{ name: "A", rut: "1-9" }])
    }),
    [{ name: "A", rut: "1-9" }]
  );
});
