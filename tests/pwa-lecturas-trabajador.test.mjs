// Lecturas que hace la PWA del trabajador contra las reglas de Firestore.
//
// Reproducen dos fallos vistos en produccion: al abrir la app aparecia "No
// tienes permiso para leer solicitudes de turnos extra" y "No tienes permiso
// para leer trabajadores enlazados", y la lista de destinatarios de mensajes
// quedaba vacia.
//
// Un trabajador NO es miembro del entorno: entra por su documento en
// workerLinks. Cualquier regla que consulte members/{uid} sin comprobar antes
// que exista lo deja fuera.
//
// Requieren el emulador: `npm run test:rules:pwa`.
import fs from "node:fs";
import test from "node:test";
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    setDoc,
    where
} from "firebase/firestore";

const PROJECT_ID = "demo-proturnos";
const WORKSPACE_ID = "ws-pwa";
const WORKER_UID = "worker-pwa";
const RULES_PATH = new URL("../firebase.rules", import.meta.url);

test("lecturas de la PWA del trabajador", async (t) => {
    let env;

    try {
        env = await initializeTestEnvironment({
            projectId: PROJECT_ID,
            firestore: { rules: fs.readFileSync(RULES_PATH, "utf8") }
        });
    } catch (error) {
        t.skip(
            "Requiere el emulador de Firestore (usa: npm run test:rules:pwa). " +
            (error?.message || error)
        );
        return;
    }

    await env.clearFirestore();

    // El trabajador esta ENLAZADO, no es miembro del entorno: es la situacion
    // real de cualquiera que use la PWA.
    await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();

        await setDoc(doc(db, "workspaces", WORKSPACE_ID), {
            name: "Imagenologia",
            ownerUid: "owner"
        });
        await setDoc(
            doc(db, "workspaces", WORKSPACE_ID, "workerLinks", WORKER_UID),
            {
                uid: WORKER_UID,
                profileName: "Trabajador PWA",
                status: "active"
            }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "workerMessageDirectory",
                WORKER_UID
            ),
            {
                uid: WORKER_UID,
                workspaceId: WORKSPACE_ID,
                profileName: "Trabajador PWA",
                status: "active"
            }
        );
        await setDoc(
            doc(db, "workspaces", WORKSPACE_ID, "replacementRequests", "req-1"),
            {
                id: "req-1",
                workerUid: WORKER_UID,
                status: "pending",
                date: "2026-08-20"
            }
        );
    });

    const worker = env.authenticatedContext(WORKER_UID, {
        email: "trabajador@example.com"
    });
    const db = worker.firestore();

    await t.test("puede leer su propio enlace", async () => {
        // Control: si esto fallara, el problema seria del enlace y no de las
        // reglas que se estan probando.
        await assertSucceeds(
            getDoc(doc(db, "workspaces", WORKSPACE_ID, "workerLinks", WORKER_UID))
        );
    });

    await t.test("puede leer el directorio de mensajes", async () => {
        // Es la lista de destinatarios. Sin ella, la pantalla de Mensajes queda
        // vacia y muestra "No tienes permiso para leer trabajadores enlazados".
        await assertSucceeds(
            getDocs(
                collection(
                    db,
                    "workspaces",
                    WORKSPACE_ID,
                    "workerMessageDirectory"
                )
            )
        );
    });

    await t.test("puede leer sus solicitudes de turno extra", async () => {
        // La PWA filtra por su propio uid; la regla permite exactamente eso.
        await assertSucceeds(
            getDocs(
                query(
                    collection(
                        db,
                        "workspaces",
                        WORKSPACE_ID,
                        "replacementRequests"
                    ),
                    where("workerUid", "==", WORKER_UID)
                )
            )
        );
    });

    await t.test("no puede leer las solicitudes de otro", async () => {
        // La contraparte: el filtro por su uid no es una formalidad.
        await assertFails(
            getDocs(
                collection(
                    db,
                    "workspaces",
                    WORKSPACE_ID,
                    "replacementRequests"
                )
            )
        );
    });

    await env.cleanup();
});
