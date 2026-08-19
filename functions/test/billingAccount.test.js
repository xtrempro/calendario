"use strict";

// Un supervisor invitado no tiene documento en accounts/, asi que getAccountUsage
// lo resolvia como plan "free" aunque estuviera trabajando dentro de un entorno
// pagado (perdia adjuntos y descarga de reportes). El plan debe salir de la
// cuenta del dueño del entorno activo.
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveBillingAccountUid } = require("../billingAccount");

function snapshot(data) {
  return {
    exists: data !== undefined,
    data: () => data
  };
}

// db falso con la forma minima que usa el resolver.
function fakeDb({ workspaces = {}, members = {} } = {}) {
  return {
    collection(name) {
      assert.equal(name, "workspaces");

      return {
        doc(workspaceId) {
          return {
            get: async () => snapshot(workspaces[workspaceId]),
            collection(sub) {
              assert.equal(sub, "members");

              return {
                doc(uid) {
                  return {
                    get: async () =>
                      snapshot(members[`${workspaceId}/${uid}`])
                  };
                }
              };
            }
          };
        }
      };
    }
  };
}

const OWNER = "owner-uid";
const INVITED = "invited-uid";
const WS = "ws-1";

const db = fakeDb({
  workspaces: { [WS]: { ownerUid: OWNER } },
  members: {
    [`${WS}/${OWNER}`]: { role: "owner" },
    [`${WS}/${INVITED}`]: {
      role: "member",
      permissions: { turnos: { view: true, edit: true } }
    }
  }
});

test("el miembro invitado factura contra la cuenta del dueño", async () => {
  assert.equal(await resolveBillingAccountUid(db, INVITED, WS), OWNER);
});

test("el dueño sigue facturando contra su propia cuenta", async () => {
  assert.equal(await resolveBillingAccountUid(db, OWNER, WS), OWNER);
});

test("sin entorno activo se usa la cuenta de quien llama", async () => {
  assert.equal(await resolveBillingAccountUid(db, INVITED, ""), INVITED);
  assert.equal(await resolveBillingAccountUid(db, INVITED, null), INVITED);
});

test("un entorno inexistente no entrega el plan de nadie", async () => {
  assert.equal(await resolveBillingAccountUid(db, INVITED, "ws-fantasma"), INVITED);
});

test("quien no es miembro del entorno no hereda su plan", async () => {
  assert.equal(
    await resolveBillingAccountUid(db, "extrano-uid", WS),
    "extrano-uid"
  );
});

test("una membresia sin acceso explicito tampoco hereda el plan", async () => {
  const sinPermisos = fakeDb({
    workspaces: { [WS]: { ownerUid: OWNER } },
    members: { [`${WS}/${INVITED}`]: { role: "member" } }
  });

  assert.equal(await resolveBillingAccountUid(sinPermisos, INVITED, WS), INVITED);
});

test("un entorno sin dueño registrado no cambia la cuenta", async () => {
  const sinDueno = fakeDb({
    workspaces: { [WS]: {} },
    members: { [`${WS}/${INVITED}`]: { role: "member", permissions: {} } }
  });

  assert.equal(await resolveBillingAccountUid(sinDueno, INVITED, WS), INVITED);
});
