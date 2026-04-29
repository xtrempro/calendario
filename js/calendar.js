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
    getRotativa,
    isProfileActive
} from "./storage.js";
import {
    tieneAusencia,
    requiereReemplazoTurnoBase,
    getTurnoExtraAgregado,
    obtenerLabelDia,
    aplicarClasesEspeciales,
    estaBloqueadoModo,
    getTurnoComponentes,
    restarTurnoCubierto,
    turnoDesdeComponentes,
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
    getClockExtraBackupForWorker,
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
import {
    getClockExtraHours,
    hasClockExtra,
    hasSevereClockIncident,
    hasSimpleClockIncident
} from "./clockMarks.js";

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

function getManualBackupSections(pendingTurn, matchesByTurn) {
    return getTurnoComponentes(pendingTurn)
        .map(component => {
            const turn = turnoDesdeComponentes([component]);

            return {
                id: component,
                turn,
                label: turnoReplacementLabel(turn),
                matches: matchesByTurn.get(turn) || []
            };
        })
        .filter(section => section.turn);
}

function formatClockHoursForDialog(hours) {
    const d = Math.round((Number(hours?.d) || 0) * 2) / 2;
    const n = Math.round((Number(hours?.n) || 0) * 2) / 2;
    const parts = [];

    if (d) parts.push(`${d}h diurnas`);
    if (n) parts.push(`${n}h nocturnas`);

    return parts.length ? parts.join(" / ") : "0h";
}

function extraReasonDialogHTML({
    profileName,
    pendingTurn,
    manualSections,
    clockHours,
    hasClockSection
}) {
    const hasManualSection = Boolean(pendingTurn);
    const hasMultipleManualSections =
        (manualSections || []).length > 1;
    const savesMultipleBackups =
        hasMultipleManualSections ||
        (hasClockSection && hasManualSection);
    const manualItems = (manualSections || [])
        .map(section => {
            const items = section.matches.length
                ? section.matches.map((match, index) => `
                    <button
                        class="replacement-candidate"
                        type="button"
                        data-section-id="${section.id}"
                        data-match-index="${index}"
                    >
                        <span>
                            <strong>${match.profile.name}</strong>
                            <small>${match.absenceType} | ${turnoReplacementLabel(match.coveredTurn)}</small>
                        </span>
                        <span>${match.exactMatch ? "Coincide" : "Parcial"}</span>
                    </button>
                `).join("")
                : `
                    <div class="empty-state empty-state--compact">
                        No hay vacaciones o licencias compatibles con este tramo.
                    </div>
                `;

            return `
                <div class="overtime-backup-subsection" data-manual-section="${section.id}">
                    <div class="overtime-backup-subsection__head">
                        <span>${section.label}</span>
                    </div>
                    <div class="replacement-candidate-list">
                        ${items}
                    </div>
                    <label class="extra-reason-field">
                        <span>Motivo manual para ${section.label}</span>
                        <textarea rows="3" data-manual-reason="${section.id}" placeholder="Ej: Campana de Invierno, Estacion de Trabajo"></textarea>
                    </label>
                </div>
            `;
        })
        .join("");
    const clockSection = hasClockSection
        ? `
            <section class="overtime-backup-section" data-section="clock">
                <div class="overtime-backup-section__head">
                    <span>Horas por marcaje modificado</span>
                    <small>${formatClockHoursForDialog(clockHours)}</small>
                </div>
                <p>
                    Respalda las horas extras generadas por modificar la entrada
                    o salida del turno.
                </p>
                <label class="extra-reason-field">
                    <span>Motivo del marcaje</span>
                    <textarea rows="3" data-clock-reason placeholder="Ej: Apoyo previo al turno, continuidad de atencion, emergencia del servicio"></textarea>
                </label>
            </section>
        `
        : "";
    const manualSection = hasManualSection
        ? `
            <section class="overtime-backup-section" data-section="manual">
                <div class="overtime-backup-section__head">
                    <span>Turno extra agregado</span>
                    <small>${turnoReplacementLabel(pendingTurn)}</small>
                </div>
                <p>
                    Puedes asociar cada tramo a una ausencia compatible o escribir
                    un motivo manual por separado.
                </p>
                ${manualItems}
            </section>
        `
        : "";

    return `
        <div class="turn-change-dialog replacement-dialog extra-reason-dialog overtime-backup-dialog" role="dialog" aria-modal="true" aria-labelledby="extraReasonDialogTitle">
            <strong id="extraReasonDialogTitle">Respaldar horas extras</strong>
            <p>
                ${profileName} tiene horas extras pendientes de respaldo.
                Completa ${savesMultipleBackups ? "las secciones" : "el motivo"} para validar el pago.
            </p>
            ${clockSection}
            ${manualSection}
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
                <button class="primary-button" type="button" data-action="save-reason">
                    ${savesMultipleBackups ? "Guardar respaldos" : "Guardar motivo"}
                </button>
            </div>
        </div>
    `;
}

async function openExtraReasonDialog(
    profileName,
    keyDay,
    pendingTurn,
    options = {}
) {
    if ((!pendingTurn && !options.forceClock) || window.selectionMode) {
        return;
    }

    const profileData = getProfileData(profileName);
    const actualState = options.state ||
        aplicarCambiosTurno(
            profileName,
            keyDay,
            Number(profileData[keyDay]) || 0
        );
    const [year, month, day] = String(keyDay)
        .split("-")
        .map(Number);
    const date = new Date(year, month, day);
    const holidays = await fetchHolidays(year);
    const hasClockSection =
        hasClockExtra(
            profileName,
            keyDay,
            date,
            actualState,
            holidays
        ) &&
        !getClockExtraBackupForWorker(profileName, keyDay);
    const clockHours = hasClockSection
        ? getClockExtraHours(
            profileName,
            keyDay,
            date,
            actualState,
            holidays
        )
        : null;

    if (!pendingTurn && !hasClockSection) {
        return;
    }

    const matchesByTurn = new Map();
    const manualSections = pendingTurn
        ? getManualBackupSections(pendingTurn, matchesByTurn)
        : [];

    if (pendingTurn) {
        manualSections.forEach(section => {
            const matches = getExtraReasonMatches(
                profileName,
                keyDay,
                section.turn
            );

            matchesByTurn.set(section.turn, matches);
            section.matches = matches;
        });
    }

    const backdrop = document.createElement("div");
    const selectedMatches = new Map();

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = extraReasonDialogHTML({
        profileName,
        pendingTurn,
        manualSections,
        clockHours,
        hasClockSection
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

    const saveBackups = async () => {
        const clockReason = backdrop
            .querySelector("[data-clock-reason]")
            ?.value
            .trim() || "";
        const manualBackups = manualSections.map(section => {
            const selectedIndex = selectedMatches.get(section.id);
            const selectedMatch = selectedIndex !== undefined
                ? section.matches[selectedIndex]
                : null;
            const reason = backdrop
                .querySelector(`[data-manual-reason="${section.id}"]`)
                ?.value
                .trim() || "";

            return {
                section,
                selectedMatch,
                reason
            };
        });
        const missingManualBackup = manualBackups.find(backup =>
            !backup.selectedMatch && !backup.reason
        );

        if (hasClockSection && !clockReason) {
            alert("Indica el motivo de las horas extras generadas por el marcaje.");
            backdrop.querySelector("[data-clock-reason]")?.focus();
            return;
        }

        if (pendingTurn && missingManualBackup) {
            alert(`Selecciona una ausencia compatible o escribe el motivo del turno ${missingManualBackup.section.label}.`);
            backdrop
                .querySelector(`[data-manual-reason="${missingManualBackup.section.id}"]`)
                ?.focus();
            return;
        }

        if (typeof window.pushUndoState === "function") {
            window.pushUndoState("Respaldar horas extras");
        }

        if (hasClockSection) {
            saveReplacement({
                worker: profileName,
                keyDay,
                turno: actualState,
                reason: clockReason,
                absenceType: "Marcaje reloj control",
                source: "clock_extra",
                addsShift: false,
                clockLabel: "Marcaje reloj control",
                clockHours
            });
        }

        manualBackups.forEach(backup => {
            saveReplacement({
                worker: profileName,
                keyDay,
                turno: backup.selectedMatch
                    ? backup.selectedMatch.coveredTurn
                    : backup.section.turn,
                replaced: backup.selectedMatch?.profile.name || "",
                reason: backup.selectedMatch ? "" : backup.reason,
                absenceType: backup.selectedMatch
                    ? backup.selectedMatch.absenceType
                    : "Motivo manual",
                source: "manual_extra",
                addsShift: false
            });
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
                const sectionId = button.dataset.sectionId;

                selectedMatches.set(
                    sectionId,
                    Number(button.dataset.matchIndex)
                );

                backdrop
                    .querySelectorAll(
                        `[data-match-index][data-section-id="${sectionId}"]`
                    )
                    .forEach(item => {
                        const selected =
                            Number(item.dataset.matchIndex) ===
                            selectedMatches.get(sectionId);

                        item.classList.toggle("is-selected", selected);
                        item.setAttribute(
                            "aria-pressed",
                            selected ? "true" : "false"
                        );
                    });

                const manualTextarea = backdrop
                    .querySelector(`[data-manual-reason="${sectionId}"]`);

                if (manualTextarea) {
                    manualTextarea.value = "";
                }
            };
        });

    backdrop
        .querySelectorAll("[data-manual-reason]")
        .forEach(textarea => {
            textarea.addEventListener("input", event => {
                if (!event.target.value.trim()) return;

                const sectionId = event.target.dataset.manualReason;

                selectedMatches.delete(sectionId);
                backdrop
                    .querySelectorAll(
                        `[data-match-index][data-section-id="${sectionId}"]`
                    )
                    .forEach(item => {
                        item.classList.remove("is-selected");
                        item.setAttribute("aria-pressed", "false");
                    });
            });
        });

    backdrop
        .querySelector("[data-action='save-reason']")
        .onclick = saveBackups;

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);

    (
        backdrop.querySelector("[data-clock-reason]") ||
        backdrop.querySelector("[data-match-index]") ||
        backdrop.querySelector("[data-manual-reason]")
    )?.focus();
}

window.openExtraReasonDialog = openExtraReasonDialog;

async function openClockExtraReasonDialog(
    profileName,
    keyDay,
    state
) {
    return openExtraReasonDialog(profileName, keyDay, 0, {
        forceClock: true,
        state
    });
}

window.openClockExtraReasonDialog = openClockExtraReasonDialog;

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
        const severeClockIncident =
            hasSevereClockIncident(activeProfile, keyDay);
        const simpleClockIncident =
            !severeClockIncident &&
            hasSimpleClockIncident(activeProfile, keyDay);
        const clockExtra =
            hasClockExtra(
                activeProfile,
                keyDay,
                date,
                state,
                holidays
            );
        const showClockExtraReason =
            clockExtra &&
            !getClockExtraBackupForWorker(activeProfile, keyDay);
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
            : severeClockIncident
                ? "!!!"
                : needsReplacement
                    ? "!"
                    : showExtraReason || showClockExtraReason
                    ? "?"
                    : simpleClockIncident
                        ? "*"
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
                        : showClockExtraReason
                            ? " | Requiere motivo por horas extras de marcaje"
                            : severeClockIncident
                                ? " | Incidencia grave de marcaje"
                                : simpleClockIncident
                                    ? " | Incidencia de marcaje"
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

        if (showClockExtraReason) {
            div.classList.add("needs-extra-reason");
            div.classList.add("clock-extra-day");
        }

        if (severeClockIncident) {
            div.classList.add("clock-severe-day");
        } else if (simpleClockIncident) {
            div.classList.add("clock-incident-day");
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
                rotativa: getRotativa(activeProfile),
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
                showClockExtraReason &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                return openClockExtraReasonDialog(
                    activeProfile,
                    keyDay,
                    state
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
