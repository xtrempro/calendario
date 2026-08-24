/**
 * Editor del horario propio de un trabajador.
 *
 * Se abre desde su perfil. Muestra solo los tramos que su rotativa usa: un
 * diurno configura su turno diurno; el de tercer o cuarto turno, sus Largas y
 * sus Noches.
 */
import { escapeHTML } from "./htmlUtils.js";
import { getRotativa } from "./storage.js";
import {
    getWorkerSchedule,
    saveWorkerSchedule,
    scheduleSegmentsForRotativa
} from "./workerSchedule.js";

function campo(segmentKey, name, label, value, placeholder) {
    return `
        <label class="ws-field">
            <span>${escapeHTML(label)}</span>
            <input type="time" name="${segmentKey}.${name}"
                value="${escapeHTML(value || "")}"
                placeholder="${escapeHTML(placeholder)}">
        </label>`;
}

function segmentoHTML(segment, schedule) {
    const actual = schedule[segment.key] || {};

    return `
        <fieldset class="ws-segment">
            <legend>${escapeHTML(segment.label)}</legend>
            <div class="ws-fields">
                ${campo(segment.key, "entry", "Entrada", actual.entry, "08:00")}
                ${campo(segment.key, "exit", "Salida", actual.exit, "17:00")}
                ${segment.hasFriday
                    ? campo(
                        segment.key,
                        "exitFriday",
                        "Salida los viernes",
                        actual.exitFriday,
                        "16:00"
                    )
                    : ""}
            </div>
            ${segment.fridayNote
                ? `<p class="ws-note">${escapeHTML(segment.fridayNote)}</p>`
                : ""}
        </fieldset>`;
}

/**
 * Abre el editor. Resuelve true si se guardo algo.
 *
 * @param {string} profile
 * @returns {Promise<boolean>}
 */
export function openWorkerScheduleDialog(profile) {
    return new Promise(resolve => {
        const segments = scheduleSegmentsForRotativa(
            getRotativa(profile).type
        );

        if (!segments.length) {
            resolve(false);
            return;
        }

        const schedule = getWorkerSchedule(profile);
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <section class="turn-change-dialog ws-dialog" role="dialog"
                aria-modal="true" aria-label="Horario propio">
                <strong>Horarios de entrada y salida</strong>
                <p class="ws-intro">
                    ${escapeHTML(profile)} — sus atrasos e incidencias se
                    medirán con este horario en vez del general.
                </p>
                <form data-ws-form>
                    ${segments.map(segment => segmentoHTML(segment, schedule)).join("")}
                    <p class="ws-note">
                        Deja un campo vacío para que ese tramo use el horario
                        del turno.
                    </p>
                    <div class="turn-change-dialog__actions">
                        <button class="primary-button" type="submit">Guardar</button>
                        <button class="ghost-button" type="button" data-ws-clear>
                            Quitar horario propio
                        </button>
                        <button class="ghost-button" type="button" data-ws-close>
                            Cancelar
                        </button>
                    </div>
                </form>
            </section>`;

        const close = (saved) => {
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            resolve(saved);
        };
        const onKeydown = (event) => {
            if (event.key === "Escape") close(false);
        };

        backdrop.querySelector("[data-ws-form]").addEventListener(
            "submit",
            event => {
                event.preventDefault();

                const next = {};

                new FormData(event.currentTarget).forEach((value, name) => {
                    const [segmentKey, field] = name.split(".");

                    next[segmentKey] = next[segmentKey] || {};
                    next[segmentKey][field] = String(value || "");
                });

                saveWorkerSchedule(profile, next);
                close(true);
            }
        );

        backdrop.querySelector("[data-ws-clear]").addEventListener("click", () => {
            saveWorkerSchedule(profile, {});
            close(true);
        });
        backdrop.querySelector("[data-ws-close]")
            .addEventListener("click", () => close(false));
        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) close(false);
        });

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);
    });
}

/**
 * Resumen del horario propio, para mostrarlo en el perfil sin abrir el editor.
 */
export function workerScheduleSummary(profile) {
    const schedule = getWorkerSchedule(profile);
    const segments = scheduleSegmentsForRotativa(getRotativa(profile).type);
    const partes = segments
        .map(segment => {
            const actual = schedule[segment.key];

            if (!actual?.entry && !actual?.exit) return "";

            const viernes = actual.exitFriday
                ? ` (viernes hasta ${actual.exitFriday})`
                : "";

            return `${segment.label}: ${actual.entry || "—"} a `
                + `${actual.exit || "—"}${viernes}`;
        })
        .filter(Boolean);

    return partes.join(" · ");
}
