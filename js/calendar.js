import {
    aplicarCambiosTurno,
    fusionarTurnos,
    getTurnoBase,
    siguienteTurnoValido
} from "./turnEngine.js";
import {
    calcularHorasMes,
    calcularHorasMesPerfil,
    renderSummaryHTML,
    calcularCarryMes
} from "./hoursEngine.js";
import {
    getProfileData,
    saveProfileData,
    getCarry,
    saveCarry,
    getBlockedDays,
    getAdminDays,
    getLegalDays,
    getAbsences,
    getCompDays,
    getShiftAssigned,
    getCurrentProfile,
    getProfiles,
    isProfileActive
} from "./storage.js";
import {
    tieneAusencia,
    requiereReemplazoTurnoBase,
    getTurnoExtraAgregado,
    obtenerLabelDia,
    aplicarClasesEspeciales,
    estaBloqueadoModo,
    restarTurnoCubierto,
    turnoExtraCubreTurno
} from "./rulesEngine.js";
import { fetchHolidays } from "./holidays.js";
import {
    calcHours,
    isBusinessDay,
    isWeekend
} from "./calculations.js";
import {
    turnoLabel,
    aplicarClaseTurno
} from "./uiEngine.js";
import { renderTimeline } from "./timeline.js";
import {
    cambioTieneLicenciaEnTurnosBase,
    deshacerCambioTurno,
    getCambioTurnoRecibido
} from "./swaps.js";
import {
    getAbsenceLabelForProfileDate,
    getBackedTurnForWorker,
    getReplacementForCoveredShift,
    getReplacementForWorkerShift,
    renderReplacementLogHTML,
    saveReplacement,
    turnoReplacementLabel,
    workerHasAbsence
} from "./replacements.js";
import {
    hasContractForDate,
    isReplacementProfile
} from "./contracts.js";
import {
    addAuditLog,
    AUDIT_CATEGORY
} from "./auditLog.js";

export let currentDate = new Date();

const CALENDAR_AUDIT_DELAY_MS = 60000;
const calendarAuditTimers = new Map();
const calendarAuditDrafts = new Map();

function key(y, m, d) {
    return `${y}-${m}-${d}`;
}

function scheduleCalendarAuditLog({
    profile,
    keyDay,
    previousTurn,
    nextTurn
}) {
    if (!profile || !keyDay) return;

    const id = `${profile}::${keyDay}`;
    const currentDraft =
        calendarAuditDrafts.get(id);
    const draft = {
        profile,
        keyDay,
        previousTurn: currentDraft
            ? currentDraft.previousTurn
            : previousTurn,
        nextTurn
    };

    calendarAuditDrafts.set(id, draft);

    if (calendarAuditTimers.has(id)) {
        clearTimeout(calendarAuditTimers.get(id));
    }

    calendarAuditTimers.set(
        id,
        setTimeout(() => {
            const finalDraft =
                calendarAuditDrafts.get(id);

            calendarAuditTimers.delete(id);
            calendarAuditDrafts.delete(id);

            if (!finalDraft) return;
            if (
                Number(finalDraft.previousTurn) ===
                Number(finalDraft.nextTurn)
            ) {
                return;
            }

            addAuditLog(
                AUDIT_CATEGORY.CALENDAR,
                "Modifico turno manualmente",
                `${finalDraft.profile}: ${finalDraft.keyDay} paso de ${turnoLabel(finalDraft.previousTurn) || "Libre"} a ${turnoLabel(finalDraft.nextTurn) || "Libre"}.`,
                {
                    profile: finalDraft.profile,
                    keyDay: finalDraft.keyDay,
                    previousTurn: finalDraft.previousTurn,
                    nextTurn: finalDraft.nextTurn,
                    delayed: true
                }
            );
        }, CALENDAR_AUDIT_DELAY_MS)
    );
}

function buildDayCell({
    day,
    month,
    year,
    keyDay,
    label,
    badge,
    title,
    isWeekendDay,
    isHoliday,
    isDraftSelected
}) {
    const div = document.createElement("div");

    div.classList.add("day");
    div.dataset.day = day;
    div.dataset.month = month;
    div.dataset.year = year;

    if (isWeekendDay) {
        div.classList.add("weekend");
    }

    if (isHoliday) {
        div.classList.add("holiday");
    }

    if (isDraftSelected) {
        div.classList.add("draft-selected");
    }

    div.innerHTML = `
        <span class="day-number">${day}</span>
        <span class="day-label-stack">
            <span class="day-label">${label || ""}</span>
            ${badge ? `<span class="day-badge">${badge}</span>` : ""}
        </span>
    `;

    if (title) {
        div.title = title;
    }

    return div;
}

function confirmUndoTurnChange(swap) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <div class="turn-change-dialog" role="dialog" aria-modal="true" aria-labelledby="turnChangeDialogTitle">
                <strong id="turnChangeDialogTitle">Cambio de turno aplicado</strong>
                <p>
                    Para modificar el turno de este dia debes deshacer el cambio de turno aplicado.
                </p>
                <div class="turn-change-dialog__meta">
                    ${swap.from} -> ${swap.to}
                </div>
                <div class="turn-change-dialog__actions">
                    <button class="secondary-button" type="button" data-action="cancel">
                        Cancelar
                    </button>
                    <button class="primary-button" type="button" data-action="undo">
                        Deshacer
                    </button>
                </div>
            </div>
        `;

        const close = value => {
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            resolve(value);
        };

        const onKeydown = event => {
            if (event.key === "Escape") {
                close(false);
            }
        };

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close(false);
            }
        });

        backdrop
            .querySelector("[data-action='cancel']")
            .onclick = () => close(false);

        backdrop
            .querySelector("[data-action='undo']")
            .onclick = () => close(true);

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);

        backdrop
            .querySelector("[data-action='undo']")
            .focus();
    });
}

async function handleTurnChangeDayClick(swap) {
    const shouldUndo =
        await confirmUndoTurnChange(swap);

    if (!shouldUndo) {
        return true;
    }

    if (cambioTieneLicenciaEnTurnosBase(swap)) {
        alert(
            "No se puede deshacer el cambio de turno porque existe una Licencia Medica o LM Profesional en uno de los turnos base del trabajador."
        );
        return true;
    }

    if (typeof window.pushUndoState === "function") {
        window.pushUndoState("Deshacer cambio de turno");
    }

    deshacerCambioTurno(swap);
    await renderCalendar();

    return true;
}

function sameRoleProfiles(profileName) {
    const profiles = getProfiles();
    const base = profiles.find(profile =>
        profile.name === profileName
    );

    if (!base || !isProfileActive(base)) return [];

    return profiles.filter(profile =>
        profile.name !== profileName &&
        isProfileActive(profile) &&
        profile.estamento === base.estamento
    );
}

function getActualState(profileName, keyDay) {
    const data = getProfileData(profileName);

    return aplicarCambiosTurno(
        profileName,
        keyDay,
        Number(data[keyDay]) || 0
    );
}

function canCoverShift(currentState, neededTurn) {
    if (!neededTurn) return false;

    return fusionarTurnos(
        currentState,
        neededTurn
    ) !== currentState;
}

function getPendingManualExtraTurn(
    profileName,
    keyDay,
    profileData
) {
    const baseWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
    const actualWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        Number(profileData[keyDay]) || 0,
        { includeReplacements: false }
    );
    const extraTurn = getTurnoExtraAgregado(
        baseWithSwaps,
        actualWithSwaps
    );

    return restarTurnoCubierto(
        extraTurn,
        getBackedTurnForWorker(profileName, keyDay)
    );
}

async function getReplacementCandidates(profileName, keyDay) {
    const date = new Date(
        Number(keyDay.split("-")[0]),
        Number(keyDay.split("-")[1]),
        Number(keyDay.split("-")[2])
    );
    const y = date.getFullYear();
    const m = date.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const holidays = await fetchHolidays(y);
    const neededTurn = getTurnoBase(profileName, keyDay);

    return sameRoleProfiles(profileName)
        .map(profile => {
            const currentState =
                getActualState(profile.name, keyDay);
            const stats = calcularHorasMesPerfil(
                profile.name,
                y,
                m,
                days,
                holidays,
                getProfileData(profile.name),
                {},
                { d: 0, n: 0 }
            );

            return {
                profile,
                currentState,
                isFree: currentState === 0,
                hhee:
                    (Number(stats.hheeDiurnas) || 0) +
                    (Number(stats.hheeNocturnas) || 0)
            };
        })
        .filter(candidate =>
            !workerHasAbsence(candidate.profile.name, keyDay) &&
            canCoverShift(candidate.currentState, neededTurn)
        )
        .sort((a, b) => {
            if (a.isFree !== b.isFree) {
                return a.isFree ? -1 : 1;
            }

            if (a.hhee !== b.hhee) {
                return a.hhee - b.hhee;
            }

            return a.profile.name.localeCompare(b.profile.name);
        });
}

function replacementDialogHTML({
    profileName,
    keyDay,
    neededTurn,
    absenceType,
    candidates
}) {
    const items = candidates.length
        ? candidates.map(candidate => `
            <button class="replacement-candidate" type="button" data-worker="${candidate.profile.name}">
                <span>
                    <strong>${candidate.profile.name}</strong>
                    <small>${candidate.isFree ? "Libre ese dia" : `Turno actual: ${turnoReplacementLabel(candidate.currentState)}`}</small>
                </span>
                <span>${candidate.hhee} HHEE</span>
            </button>
        `).join("")
        : `
            <div class="empty-state empty-state--compact">
                No hay trabajadores disponibles para este reemplazo.
            </div>
        `;

    return `
        <div class="turn-change-dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacementDialogTitle">
            <strong id="replacementDialogTitle">Seleccionar reemplazo</strong>
            <p>
                ${profileName} requiere cobertura para ${turnoReplacementLabel(neededTurn)}
                por ${absenceType}.
            </p>
            <div class="replacement-candidate-list">
                ${items}
            </div>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

async function openReplacementDialog(profileName, keyDay) {
    const existing = getReplacementForCoveredShift(
        profileName,
        keyDay
    );

    if (existing || window.selectionMode) {
        return;
    }

    const neededTurn = getTurnoBase(profileName, keyDay);
    const absenceType =
        getAbsenceLabelForProfileDate(profileName, keyDay);
    const candidates =
        await getReplacementCandidates(profileName, keyDay);

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = replacementDialogHTML({
        profileName,
        keyDay,
        neededTurn,
        absenceType,
        candidates
    });

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    backdrop
        .querySelector("[data-action='cancel']")
        .onclick = close;

    backdrop
        .querySelectorAll(".replacement-candidate")
        .forEach(button => {
            button.onclick = async () => {
                if (typeof window.pushUndoState === "function") {
                    window.pushUndoState("Asignar reemplazo");
                }

                saveReplacement({
                    worker: button.dataset.worker,
                    replaced: profileName,
                    keyDay,
                    turno: neededTurn,
                    absenceType
                });

                close();
                await renderCalendar();
            };
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);

    (
        backdrop.querySelector(".replacement-candidate") ||
        backdrop.querySelector("[data-action='cancel']")
    )?.focus();
}

window.openReplacementDialog = openReplacementDialog;

function getExtraReasonMatches(
    profileName,
    keyDay,
    pendingTurn
) {
    return sameRoleProfiles(profileName)
        .map(profile => {
            const coveredTurn = getTurnoBase(
                profile.name,
                keyDay
            );

            return {
                profile,
                coveredTurn,
                absenceType:
                    getAbsenceLabelForProfileDate(
                        profile.name,
                        keyDay
                    ),
                exactMatch:
                    Number(coveredTurn) === Number(pendingTurn)
            };
        })
        .filter(match =>
            workerHasAbsence(match.profile.name, keyDay) &&
            !getReplacementForCoveredShift(
                match.profile.name,
                keyDay
            ) &&
            turnoExtraCubreTurno(
                pendingTurn,
                match.coveredTurn
            )
        )
        .sort((a, b) => {
            if (a.exactMatch !== b.exactMatch) {
                return a.exactMatch ? -1 : 1;
            }

            return a.profile.name.localeCompare(b.profile.name);
        });
}

function extraReasonDialogHTML({
    profileName,
    pendingTurn,
    matches
}) {
    const items = matches.length
        ? matches.map((match, index) => `
            <button class="replacement-candidate" type="button" data-match-index="${index}">
                <span>
                    <strong>${match.profile.name}</strong>
                    <small>${match.absenceType} | ${turnoReplacementLabel(match.coveredTurn)}</small>
                </span>
                <span>${match.exactMatch ? "Coincide" : "Parcial"}</span>
            </button>
        `).join("")
        : `
            <div class="empty-state empty-state--compact">
                No hay vacaciones o licencias compatibles con este turno.
            </div>
        `;

    return `
        <div class="turn-change-dialog replacement-dialog extra-reason-dialog" role="dialog" aria-modal="true" aria-labelledby="extraReasonDialogTitle">
            <strong id="extraReasonDialogTitle">Respaldar horas extras</strong>
            <p>
                ${profileName} tiene un turno extra ${turnoReplacementLabel(pendingTurn)}
                sin respaldo. Puedes asociarlo a una ausencia compatible o escribir el motivo.
            </p>
            <div class="replacement-candidate-list">
                ${items}
            </div>
            <label class="extra-reason-field">
                <span>Motivo manual</span>
                <textarea rows="3" placeholder="Ej: Campana de Invierno, Estacion de Trabajo"></textarea>
            </label>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
                <button class="primary-button" type="button" data-action="save-reason">
                    Guardar motivo
                </button>
            </div>
        </div>
    `;
}

async function openExtraReasonDialog(
    profileName,
    keyDay,
    pendingTurn
) {
    if (!pendingTurn || window.selectionMode) {
        return;
    }

    const matches = getExtraReasonMatches(
        profileName,
        keyDay,
        pendingTurn
    );
    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = extraReasonDialogHTML({
        profileName,
        pendingTurn,
        matches
    });

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    const saveBackup = async payload => {
        if (typeof window.pushUndoState === "function") {
            window.pushUndoState("Respaldar horas extras");
        }

        saveReplacement({
            worker: profileName,
            keyDay,
            turno: payload.turno,
            replaced: payload.replaced || "",
            reason: payload.reason || "",
            absenceType: payload.absenceType || "",
            source: "manual_extra",
            addsShift: false
        });

        close();
        await renderCalendar();
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    backdrop
        .querySelector("[data-action='cancel']")
        .onclick = close;

    backdrop
        .querySelectorAll("[data-match-index]")
        .forEach(button => {
            button.onclick = () => {
                const match = matches[
                    Number(button.dataset.matchIndex)
                ];

                if (!match) return;

                saveBackup({
                    turno: match.coveredTurn,
                    replaced: match.profile.name,
                    absenceType: match.absenceType
                });
            };
        });

    backdrop
        .querySelector("[data-action='save-reason']")
        .onclick = () => {
            const reason = backdrop
                .querySelector(".extra-reason-field textarea")
                .value
                .trim();

            if (!reason) {
                alert("Indica el motivo de las horas extras para guardar el respaldo.");
                return;
            }

            saveBackup({
                turno: pendingTurn,
                reason,
                absenceType: "Motivo manual"
            });
        };

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);

    (
        backdrop.querySelector("[data-match-index]") ||
        backdrop.querySelector(".extra-reason-field textarea")
    )?.focus();
}

window.openExtraReasonDialog = openExtraReasonDialog;

async function clickDia(
    keyDay,
    state,
    isHab,
    data,
    admin,
    legal,
    comp,
    absences
) {
    if (!isProfileActive(getCurrentProfile())) {
        alert("Este perfil esta desactivado. Reactivalo desde Perfil para modificar su calendario.");
        return true;
    }

    const turnChange =
        getCambioTurnoRecibido(getCurrentProfile(), keyDay);

    if (turnChange) {
        return handleTurnChangeDayClick(turnChange);
    }

    if (window.selectionMode === "halfadmin") return;
    if (window.selectionMode) return;

    const needsReplacement =
        requiereReemplazoTurnoBase(
            keyDay,
            getTurnoBase(getCurrentProfile(), keyDay),
            admin,
            legal,
            comp,
            absences
        ) &&
        !getReplacementForCoveredShift(
            getCurrentProfile(),
            keyDay
        );

    if (needsReplacement) {
        return openReplacementDialog(
            getCurrentProfile(),
            keyDay
        );
    }

    if (
        tieneAusencia(
            keyDay,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        return;
    }

    const baseTurno = getTurnoBase(
        getCurrentProfile(),
        keyDay
    );
    const nuevo = siguienteTurnoValido(
        getCurrentProfile(),
        keyDay,
        state,
        isHab,
        {
            baseTurno
        }
    );

    if (typeof window.pushUndoState === "function") {
        window.pushUndoState(
            `Cambio ${keyDay}: ${turnoLabel(state)} -> ${turnoLabel(nuevo)}`
        );
    }

    data[keyDay] = nuevo;
    saveProfileData(data);
    scheduleCalendarAuditLog({
        profile: getCurrentProfile(),
        keyDay,
        previousTurn: state,
        nextTurn: nuevo
    });

    await renderCalendar();
}

export async function renderCalendar() {
    const cal = document.getElementById("calendar");
    const summary = document.getElementById("summary");
    const monthYear = document.getElementById("monthYear");

    if (!cal) return;

    cal.replaceChildren();

    const activeProfile = getCurrentProfile();
    const activeProfileEnabled =
        isProfileActive(activeProfile);
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const holidays = await fetchHolidays(y);
    const first =
        (new Date(y, m, 1).getDay() + 6) % 7;
    const days =
        new Date(y, m + 1, 0).getDate();
    const draftKey =
        typeof window.getProfileDraftSelectionKey === "function"
            ? window.getProfileDraftSelectionKey()
            : "";

    if (monthYear) {
        monthYear.innerText = currentDate.toLocaleString(
            "es-CL",
            {
                month: "long",
                year: "numeric"
            }
        );
    }

    for (let i = 0; i < first; i++) {
        cal.innerHTML += "<div class=\"calendar-spacer\"></div>";
    }

    if (!activeProfile) {
        for (let d = 1; d <= days; d++) {
            const keyDay = key(y, m, d);
            const date = new Date(y, m, d);

            const div = buildDayCell({
                day: d,
                month: m,
                year: y,
                keyDay,
                label: "",
                title: "Selecciona una fecha para la nueva rotativa.",
                isWeekendDay: isWeekend(date),
                isHoliday: Boolean(holidays[keyDay]),
                isDraftSelected: draftKey === keyDay
            });

            cal.appendChild(div);
        }

        if (summary) {
            summary.innerHTML = `
                <div class="empty-state empty-state--compact">
                    Aun no hay horas extras para mostrar.
                </div>
            `;
        }

        renderTimeline();

        if (typeof window.renderDashboardState === "function") {
            window.renderDashboardState();
        }

        return;
    }

    const data = getProfileData();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const carryIn = getCarry(y, m);

    for (let d = 1; d <= days; d++) {
        const keyDay = key(y, m, d);
        const baseState = getTurnoBase(activeProfile, keyDay);

        let state = Number(data[keyDay]) || 0;

        state = aplicarCambiosTurno(
            activeProfile,
            keyDay,
            state
        );

        const date = new Date(y, m, d);
        const isWeekendDay = isWeekend(date);
        const isHoliday = holidays[keyDay];
        const isHab = isBusinessDay(date, holidays);

        const label = obtenerLabelDia(
            keyDay,
            state,
            admin,
            legal,
            comp,
            absences,
            turnoLabel
        );
        const turnChange =
            getCambioTurnoRecibido(activeProfile, keyDay);
        const coveredReplacement =
            getReplacementForCoveredShift(activeProfile, keyDay);
        const workerReplacement =
            getReplacementForWorkerShift(activeProfile, keyDay);
        const replacementContractError =
            isReplacementProfile(activeProfile) &&
            state > 0 &&
            !hasContractForDate(activeProfile, keyDay);
        const pendingManualExtra =
            getPendingManualExtraTurn(
                activeProfile,
                keyDay,
                data
            );
        const showTurnChangeBadge =
            Boolean(turnChange) &&
            state > 0 &&
            label === turnoLabel(state);
        const needsReplacement =
            requiereReemplazoTurnoBase(
                keyDay,
                baseState,
                admin,
                legal,
                comp,
                absences
            ) &&
            !coveredReplacement;
        const showExtraReason =
            !needsReplacement &&
            !turnChange &&
            !replacementContractError &&
            pendingManualExtra;
        const badge = replacementContractError
            ? "X"
            : needsReplacement
                ? "!"
                : showExtraReason
                    ? "?"
                    : workerReplacement
                        ? (workerReplacement.reason ? "Motivo" : "Reemplazo")
                        : (showTurnChangeBadge ? "CCTT" : "");
        const replacementTitle = workerReplacement
            ? (
                workerReplacement.replaced
                    ? `Reemplazo de ${workerReplacement.replaced} por ${workerReplacement.absenceType || "ausencia"}.`
                    : `Motivo HHEE: ${workerReplacement.reason || workerReplacement.absenceType || "sin detalle"}.`
            )
            : "";

        const div = buildDayCell({
            day: d,
            month: m,
            year: y,
            keyDay,
            label,
            badge,
            title: (() => {
                const hrs = calcHours(date, state, holidays);
                if (!activeProfileEnabled) {
                    return "Perfil desactivado: calendario solo lectura.";
                }

                const suffix = needsReplacement
                    ? " | Requiere reemplazo de turno base"
                    : showExtraReason
                        ? " | Requiere motivo de horas extras"
                        : replacementContractError
                            ? " | No tiene contrato vigente en la fecha seleccionada"
                            : "";

                if (showExtraReason) {
                    return `Diurnas: ${hrs.d} | Nocturnas: ${hrs.n}${suffix}`;
                }

                if (replacementContractError) {
                    return "No tiene contrato vigente en la fecha seleccionada.";
                }

                return replacementTitle ||
                    `Diurnas: ${hrs.d} | Nocturnas: ${hrs.n}${suffix}`;
            })(),
            isWeekendDay,
            isHoliday: Boolean(isHoliday),
            isDraftSelected: draftKey === keyDay
        });

        if (showTurnChangeBadge) {
            div.classList.add("turn-change-day");
            div.dataset.swapId = String(turnChange.id);
        }

        if (!activeProfileEnabled) {
            div.classList.add("inactive-profile-day");
        }

        if (needsReplacement) {
            div.classList.add("needs-replacement");
        }

        if (showExtraReason) {
            div.classList.add("needs-extra-reason");
        }

        if (replacementContractError) {
            div.classList.add("contract-error-day");
        }

        if (workerReplacement) {
            div.classList.add("replacement-day");
        }

        aplicarClasesEspeciales(
            div,
            keyDay,
            state,
            isHab,
            isWeekendDay,
            isHoliday,
            admin,
            legal,
            comp,
            absences,
            aplicarClaseTurno
        );

        const bloqueado = estaBloqueadoModo(
            window.selectionMode,
            keyDay,
            window.selectionMode === "admin"
                ? getTurnoBase(activeProfile, keyDay)
                : state,
            isHab,
            admin,
            legal,
            comp,
            absences,
            getShiftAssigned(),
            {
                compCantidad: window.compCantidad || 0,
                licenseCantidad: window.licenseCantidad || 0,
                licenseType: window.licenseType || "license",
                holidays
            }
        );

        if (window.selectionMode || !activeProfileEnabled) {
            div.classList.add(
                bloqueado || !activeProfileEnabled
                    ? "mpa-disabled"
                    : "mpa-enabled"
            );
        }

        div.onclick = async event => {
            if (!activeProfileEnabled) {
                event.stopPropagation();
                alert("Este perfil esta desactivado. Reactivalo desde Perfil para modificar su calendario.");
                return;
            }

            if (
                replacementContractError &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                window.startReplacementContractEdit?.(
                    activeProfile,
                    keyDay
                );
                return;
            }

            if (
                showExtraReason &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                return openExtraReasonDialog(
                    activeProfile,
                    keyDay,
                    showExtraReason
                );
            }

            if (
                turnChange ||
                needsReplacement
            ) {
                event.stopPropagation();
            }

            await clickDia(
                keyDay,
                state,
                isHab,
                data,
                admin,
                legal,
                comp,
                absences
            );
        };

        cal.appendChild(div);
    }

    const carryOut = calcularCarryMes(
        y,
        m,
        days,
        holidays,
        data
    );

    const next = new Date(y, m + 1, 1);

    saveCarry(
        next.getFullYear(),
        next.getMonth(),
        carryOut
    );

    const stats = calcularHorasMes(
        y,
        m,
        days,
        holidays,
        data,
        blocked,
        carryIn
    );

    if (summary) {
        summary.innerHTML =
            renderSummaryHTML(stats) +
            renderReplacementLogHTML(
                activeProfile,
                y,
                m,
                holidays
            );
    }

    renderTimeline();

    if (typeof window.renderDashboardState === "function") {
        window.renderDashboardState();
    }
}

function syncShellPanels() {
    if (typeof window.renderSwapPanel === "function") {
        window.renderSwapPanel();
    }

    if (typeof window.renderStaffingAnalysis === "function") {
        window.renderStaffingAnalysis();
    }

    if (typeof window.renderDashboardState === "function") {
        window.renderDashboardState();
    }
}

export function prevMonth() {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
    syncShellPanels();
}

export function nextMonth() {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
    syncShellPanels();
}
