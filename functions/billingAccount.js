"use strict";

const { memberHasExplicitAccess } = require("./authorization");

// Cuenta contra la que se factura a un usuario dentro de un entorno dado.
//
// El plan vive en la cuenta del dueño (accounts/{ownerUid}) y cubre TODOS los
// miembros de sus entornos, asi que un supervisor invitado hereda el plan del
// dueño del entorno en el que esta trabajando. Sin esto quedaba en "free" -no
// tiene documento propio en accounts- dentro de un entorno pagado, perdiendo
// adjuntos y descarga de reportes.
//
// Ante cualquier duda -sin entorno, entorno inexistente, o quien llama no es
// miembro con acceso explicito- cae a la propia cuenta del que llama: nunca
// entrega el plan de un tercero a quien no pertenece a su unidad.
async function resolveBillingAccountUid(db, uid, workspaceId) {
  const cleanId = String(workspaceId || "").trim();

  if (!cleanId) return uid;

  const workspaceSnap = await db
    .collection("workspaces")
    .doc(cleanId)
    .get();

  if (!workspaceSnap.exists) return uid;

  const ownerUid = String(workspaceSnap.data()?.ownerUid || "");

  if (!ownerUid || ownerUid === uid) return uid;

  const memberSnap = await db
    .collection("workspaces")
    .doc(cleanId)
    .collection("members")
    .doc(uid)
    .get();

  if (
    !memberSnap.exists ||
    !memberHasExplicitAccess(memberSnap.data() || {})
  ) {
    return uid;
  }

  return ownerUid;
}

module.exports = {
  resolveBillingAccountUid
};
