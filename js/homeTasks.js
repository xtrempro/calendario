// Tareas diarias del supervisor en el Home.
//
// Persistencia POR USUARIO y por entorno: se guardan en
// users/{uid}/workspaces/{workspaceId}.homeTasks (un campo del doc de membresia
// del usuario, que las reglas ya permiten leer/escribir solo a su dueño). Asi
// cada administrador del entorno ve SUS propias tareas.
//
// Ademas incluye un programador de alertas: cuando llega la hora de una tarea
// (menos el margen configurado) reproduce una alerta sonora y muestra un aviso.

import {
    getFirebaseServices,
    getCurrentFirebaseUser
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import { getJSON, setJSON } from "./persistence.js";

let cache = [];
let unsub = null;
let changeHandler = null;
let currentUid = "";
let currentWid = "";
let idCounter = 0;

function newId() {
    idCounter += 1;
    return `t${Date.now().toString(36)}${idCounter}`;
}

function normalizeTask(task) {
    return {
        id: task && task.id ? String(task.id) : newId(),
        name: String(task?.name || "").trim(),
        time: String(task?.time || "08:00"),
        repeat: String(task?.repeat || "Diario"),
        date: String(task?.date || ""),
        alert: String(task?.alert || "Sin alerta"),
        // Fecha (ISO) en que se marcó como realizada. Se considera "hecha" solo
        // si es hoy, de modo que el visto se reinicia automáticamente cada día.
        doneDate: String(task?.doneDate || "")
    };
}

function normalizeList(list) {
    return (Array.isArray(list) ? list : [])
        .map(normalizeTask)
        .filter(task => task.name);
}

function localKey() {
    return currentUid && currentWid
        ? `homeTasks_${currentUid}_${currentWid}`
        : "homeTasks_local";
}

export function getHomeTasks() {
    return cache.map(task => ({ ...task }));
}

export async function saveHomeTasks(tasks) {
    cache = normalizeList(tasks);
    setJSON(localKey(), cache);

    const user = getCurrentFirebaseUser();
    const workspace = getActiveWorkspace();
    if (!user?.uid || !workspace?.id) return;

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        await firestoreModule.setDoc(
            firestoreModule.doc(
                db, "users", user.uid, "workspaces", workspace.id
            ),
            { homeTasks: cache },
            { merge: true }
        );
    } catch (error) {
        console.warn("No se pudieron guardar las tareas del home.", error);
    }
}

export async function startHomeTasksSync(workspace, onChange) {
    stopHomeTasksSync();
    changeHandler = typeof onChange === "function" ? onChange : null;

    const user = getCurrentFirebaseUser();
    currentUid = user?.uid || "";
    currentWid = workspace?.id || "";

    // Hidrata desde cache local para render inmediato.
    cache = normalizeList(getJSON(localKey(), []));
    changeHandler?.(getHomeTasks());

    if (!currentUid || !currentWid) return;

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const ref = firestoreModule.doc(
            db, "users", currentUid, "workspaces", currentWid
        );
        unsub = firestoreModule.onSnapshot(
            ref,
            snapshot => {
                const data = snapshot.exists() ? snapshot.data() : {};
                cache = normalizeList(data.homeTasks);
                setJSON(localKey(), cache);
                changeHandler?.(getHomeTasks());
            },
            error => {
                console.warn("No se pudieron sincronizar las tareas del home.", error);
            }
        );
    } catch (error) {
        console.warn("No se pudo iniciar la sincronizacion de tareas del home.", error);
    }
}

export function stopHomeTasksSync() {
    if (unsub) {
        try { unsub(); } catch (error) { /* noop */ }
        unsub = null;
    }
    changeHandler = null;
    currentUid = "";
    currentWid = "";
    cache = [];
}

/* =========================================================
   Alertas sonoras
========================================================= */

const ALERT_CHECK_MS = 30000;   // revisa cada 30 s
const ALERT_WINDOW_MIN = 2;     // dispara si estamos dentro de 2 min del momento
let alertTimer = null;
const firedAlerts = new Set();
let audioCtx = null;

function alertOffsetMinutes(alert) {
    switch (alert) {
        case "Al momento": return 0;
        case "5 minutos antes": return 5;
        case "15 minutos antes": return 15;
        case "30 minutos antes": return 30;
        case "1 hora antes": return 60;
        default: return null; // "Sin alerta"
    }
}

function parseISODate(iso) {
    const parts = String(iso || "").split("-");
    if (parts.length !== 3) return null;
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return Number.isNaN(date.getTime()) ? null : date;
}

function monthsBetween(from, to) {
    return (to.getFullYear() - from.getFullYear()) * 12 +
        (to.getMonth() - from.getMonth());
}

function isTaskActiveOn(task, date) {
    const anchor = parseISODate(task.date);
    if (!anchor) {
        // Sin fecha de inicio solo tiene sentido la recurrencia diaria.
        return task.repeat === "Diario";
    }

    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    if (day < start) return false;

    switch (task.repeat) {
        case "Una sola vez": return day.getTime() === start.getTime();
        case "Diario": return true;
        case "Semanal": return day.getDay() === start.getDay();
        case "Mensual": return day.getDate() === start.getDate();
        case "Trimestral":
            return day.getDate() === start.getDate() &&
                monthsBetween(start, day) % 3 === 0;
        case "Cuatrimestral":
            return day.getDate() === start.getDate() &&
                monthsBetween(start, day) % 4 === 0;
        case "Anual":
            return day.getDate() === start.getDate() &&
                day.getMonth() === start.getMonth();
        default: return false;
    }
}

function ensureAudioContext() {
    if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        try { audioCtx = new Ctx(); } catch (error) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => { /* noop */ });
    }
    return audioCtx;
}

function playBeep() {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const start = ctx.currentTime;
    [880, 1175, 880].forEach((freq, i) => {
        const at = start + i * 0.2;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.28, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.18);
    });
}

function showToast(task) {
    if (typeof document === "undefined") return;

    let host = document.getElementById("hmAlertToasts");
    if (!host) {
        host = document.createElement("div");
        host.id = "hmAlertToasts";
        host.className = "hm-alert-toasts";
        document.body.appendChild(host);
    }

    const toast = document.createElement("div");
    toast.className = "hm-alert-toast";
    toast.setAttribute("role", "alert");
    toast.innerHTML = `
        <span class="hm-alert-toast__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.7 21a2 2 0 0 1-3.4 0"></path></svg>
        </span>
        <span class="hm-alert-toast__body">
            <strong>Tarea: ${task.time}</strong>
            <span></span>
        </span>
        <button class="hm-alert-toast__close" type="button" aria-label="Cerrar">&times;</button>
    `;
    // El nombre va como texto (evita inyeccion de HTML).
    toast.querySelector(".hm-alert-toast__body span").textContent = task.name;
    toast.querySelector(".hm-alert-toast__close")
        .addEventListener("click", () => toast.remove());
    host.appendChild(toast);

    setTimeout(() => toast.remove(), 9000);
}

function fireAlert(task) {
    playBeep();
    showToast(task);
}

function checkAlerts() {
    if (!cache.length) return;

    const now = new Date();
    const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    cache.forEach(task => {
        const offset = alertOffsetMinutes(task.alert);
        if (offset === null) return;
        if (!isTaskActiveOn(task, now)) return;

        const [h, m] = String(task.time || "").split(":").map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) return;

        const fireMinutes = h * 60 + m - offset;
        if (fireMinutes < 0) return;

        const key = `${task.id}|${dayKey}`;
        if (firedAlerts.has(key)) return;

        if (nowMinutes >= fireMinutes && nowMinutes < fireMinutes + ALERT_WINDOW_MIN) {
            firedAlerts.add(key);
            fireAlert(task);
        }
    });
}

export function startTaskAlertScheduler() {
    stopTaskAlertScheduler();

    // Habilita el audio tras la primera interaccion del usuario (política de
    // autoplay de los navegadores).
    const unlock = () => ensureAudioContext();
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });

    alertTimer = setInterval(checkAlerts, ALERT_CHECK_MS);
    checkAlerts();
}

export function stopTaskAlertScheduler() {
    if (alertTimer) {
        clearInterval(alertTimer);
        alertTimer = null;
    }
}
