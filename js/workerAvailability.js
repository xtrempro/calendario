// Listener de los dias bloqueados por el trabajador desde su PWA.
//
// El registro en memoria y la consulta viven en workerBlockedDays.js, que no
// depende de Firestore: asi el motor del servidor puede evaluar el mismo filtro
// sembrando la lista a mano. Aqui queda solo la suscripcion.

import { getFirebaseServices } from "./firebaseClient.js";
import {
    getBlockedDayForProfile,
    getWorkerBlockedDays,
    normalizeBlockedDay,
    setWorkerBlockedDays
} from "./workerBlockedDays.js";

let unsubscribeBlockedDays = null;

// Se reexportan para no tocar a quienes ya los importaban desde aqui.
export { getBlockedDayForProfile, getWorkerBlockedDays };

export function stopWorkerAvailabilitySync() {
    if (unsubscribeBlockedDays) {
        unsubscribeBlockedDays();
        unsubscribeBlockedDays = null;
    }

    setWorkerBlockedDays([]);
}

export async function startWorkerAvailabilitySync(workspace, options = {}) {
    stopWorkerAvailabilitySync();

    if (!workspace?.id) {
        options.onChange?.([]);
        return;
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const ref = firestoreModule.collection(
        db,
        "workspaces",
        workspace.id,
        "workerBlockedDays"
    );

    unsubscribeBlockedDays = firestoreModule.onSnapshot(
        ref,
        snap => {
            setWorkerBlockedDays(
                snap.docs
                    .map(docSnap => normalizeBlockedDay(docSnap.id, docSnap.data()))
                    .filter(Boolean)
            );
            options.onChange?.(getWorkerBlockedDays());
        },
        error => {
            console.warn("No se pudieron cargar dias bloqueados de trabajadores.", error);
            setWorkerBlockedDays([]);
            options.onChange?.(getWorkerBlockedDays());
        }
    );
}
