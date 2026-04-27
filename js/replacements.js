import {
    getProfiles,
    getReplacements,
    saveReplacements
} from "./storage.js";
import { getJSON } from "./persistence.js";
import { TURNO, TURNO_LABEL } from "./constants.js";
import {
    getTurnoComponentes,
    getAbsenceType,
    turnoDesdeComponentes,
    tieneAusencia
} from "./rulesEngine.js";
import { calcHours } from "./calculations.js";
import {
    addAuditLog,
    AUDIT_CATEGORY
} from "./auditLog.js";

function keyFromISO(value) {
    const parts = String(value || "").split("-");

    return `${parts[0]}-${Number(parts[1]) - 1}-${Number(parts[2])}`;
}

function isoFromKey(key) {
    const parts = String(key || "").split("-");

    return `${parts[0]}-${String(Number(parts[1]) + 1).padStart(2, "0")}-${String(Number(parts[2])).padStart(2, "0")}`;
}

function parseKey(key) {
    const parts = String(key || "").split("-");

    return new Date(
        Number(parts[0]),
        Number(parts[1]),
        Number(parts[2])
    );
}

export function codeToTurno(code) {
    if (code === "L") return TURNO.LARGA;
    if (code === "N") return TURNO.NOCHE;
    if (code === "24") return TURNO.TURNO24;
    if (code === "D") return TURNO.DIURNO;
    if (code === "D+N") return TURNO.DIURNO_NOCHE;

    return TURNO.LIBRE;
}

export function turnoToCode(turno) {
    const state = Number(turno) || TURNO.LIBRE;

    if (state === TURNO.LARGA) return "L";
    if (state === TURNO.NOCHE) return "N";
    if (state === TURNO.TURNO24) return "24";
    if (state === TURNO.DIURNO) return "D";
    if (state === TURNO.DIURNO_NOCHE) return "D+N";

    return "";
}

export function turnoReplacementLabel(turno) {
    return TURNO_LABEL[Number(turno) || TURNO.LIBRE] || "";
}

export function replacementActive(replacement) {
    return Boolean(replacement) && !replacement.canceled;
}

function replacementAddsShift(replacement) {
    return replacementActive(replacement) &&
        replacement.addsShift !== false;
}

function mergeTurns(currentTurn, nextTurn) {
    return turnoDesdeComponentes([
        ...getTurnoComponentes(currentTurn),
        ...getTurnoComponentes(nextTurn)
    ]);
}

export function getReplacementForCoveredShift(profile, keyDay) {
    const iso = isoFromKey(keyDay);

    return getReplacements().find(replacement =>
        replacementActive(replacement) &&
        replacement.replaced === profile &&
        replacement.date === iso
    ) || null;
}

export function getReplacementForWorkerShift(profile, keyDay) {
    return getReplacementsForWorkerShift(
        profile,
        keyDay
    )[0] || null;
}

export function getReplacementsForWorkerShift(profile, keyDay) {
    const iso = isoFromKey(keyDay);

    return getReplacements().filter(replacement =>
        replacementActive(replacement) &&
        replacement.worker === profile &&
        replacement.date === iso
    );
}

export function getReplacementTurnForWorker(profile, keyDay) {
    return getReplacementsForWorkerShift(profile, keyDay)
        .filter(replacementAddsShift)
        .reduce(
            (turno, replacement) =>
                mergeTurns(turno, codeToTurno(replacement.turno)),
            TURNO.LIBRE
        );
}

export function getBackedTurnForWorker(profile, keyDay) {
    return getReplacementsForWorkerShift(profile, keyDay)
        .reduce(
            (turno, replacement) =>
                mergeTurns(turno, codeToTurno(replacement.turno)),
            TURNO.LIBRE
        );
}

export function getReplacementLogForWorkerMonth(profile, year, month) {
    return getReplacements()
        .filter(replacement =>
            replacementActive(replacement) &&
            replacement.worker === profile &&
            Number(replacement.year) === Number(year) &&
            Number(replacement.month) === Number(month)
        )
        .sort((a, b) => a.date.localeCompare(b.date));
}

export function getAbsenceLabelForProfileDate(profile, keyDay) {
    const admin = getJSON(`admin_${profile}`, {});
    const legal = getJSON(`legal_${profile}`, {});
    const comp = getJSON(`comp_${profile}`, {});
    const absences = getJSON(`absences_${profile}`, {});

    if (admin[keyDay] === 1) return "P. Administrativo";
    if (admin[keyDay] === "0.5M") return "1/2 ADM Ma\u00f1ana";
    if (admin[keyDay] === "0.5T") return "1/2 ADM Tarde";
    if (admin[keyDay] === 0.5) return "1/2 ADM";
    if (legal[keyDay]) return "F. Legal";
    if (comp[keyDay]) return "F. Compensatorio";

    const absenceType = getAbsenceType(absences[keyDay]);

    if (absenceType === "professional_license") {
        return "LM Profesional";
    }

    if (absenceType === "unpaid_leave") {
        return "Permiso sin Goce";
    }

    if (absenceType === "license") {
        return "Licencia Medica";
    }

    if (absenceType) {
        return "Ausencia Injustificada";
    }

    return "Ausencia";
}

export function workerHasAbsence(profile, keyDay) {
    return Boolean(
        tieneAusencia(
            keyDay,
            getJSON(`admin_${profile}`, {}),
            getJSON(`legal_${profile}`, {}),
            getJSON(`comp_${profile}`, {}),
            getJSON(`absences_${profile}`, {})
        )
    );
}

export function saveReplacement(data) {
    const date = parseKey(data.keyDay);
    const replacements = getReplacements();
    const hasReplacedWorker = Boolean(data.replaced);
    const absenceType =
        data.absenceType ||
        (
            hasReplacedWorker
                ? getAbsenceLabelForProfileDate(
                    data.replaced,
                    data.keyDay
                )
                : ""
        );

    const id = Date.now();

    replacements.push({
        id,
        worker: data.worker,
        replaced: data.replaced || "",
        reason: String(data.reason || "").trim(),
        source: data.source || "replacement",
        addsShift: data.addsShift !== false,
        date: isoFromKey(data.keyDay),
        turno: turnoToCode(data.turno),
        absenceType,
        year: date.getFullYear(),
        month: date.getMonth(),
        createdAt: new Date().toISOString(),
        canceled: false
    });

    saveReplacements(replacements);
    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        data.source === "manual_extra"
            ? "Respaldo horas extras manuales"
            : "Asigno reemplazo de turno",
        hasReplacedWorker
            ? `${data.worker} reemplaza a ${data.replaced} el ${isoFromKey(data.keyDay)} por ${absenceType || "ausencia"}.`
            : `${data.worker}: ${String(data.reason || absenceType || "sin motivo").trim()} el ${isoFromKey(data.keyDay)}.`,
        {
            profile: data.worker,
            replacementId: id,
            worker: data.worker,
            replaced: data.replaced || "",
            source: data.source || "replacement"
        }
    );
}

function formatDate(value) {
    const key = keyFromISO(value);
    const parts = key.split("-");

    return `${String(Number(parts[2])).padStart(2, "0")}-${String(Number(parts[1]) + 1).padStart(2, "0")}-${parts[0]}`;
}

function formatHours(hours) {
    const d = Math.round(Number(hours.d) || 0);
    const n = Math.round(Number(hours.n) || 0);
    const chunks = [];

    if (d) chunks.push(`${d}h diurnas`);
    if (n) chunks.push(`${n}h nocturnas`);

    return chunks.length ? chunks.join(" / ") : "0h";
}

export function renderReplacementLogHTML(profile, year, month, holidays = {}) {
    const records =
        getReplacementLogForWorkerMonth(profile, year, month);

    if (!records.length) {
        return `
            <div class="replacement-log replacement-log--empty">
                Sin respaldos de HHEE registrados en este mes.
            </div>
        `;
    }

    const profiles = getProfiles();

    return `
        <div class="replacement-log">
            <strong>Respaldos de HHEE</strong>
            ${records.map(record => {
                const key = keyFromISO(record.date);
                const date = parseKey(key);
                const turno = codeToTurno(record.turno);
                const hours = calcHours(date, turno, holidays);
                const replacedProfile = profiles.find(
                    profileItem => profileItem.name === record.replaced
                );
                const estamento = replacedProfile?.estamento
                    ? ` · ${replacedProfile.estamento}`
                    : "";

                const detail = record.replaced
                    ? `Reemplaza a ${record.replaced}${estamento} por ${record.absenceType || "ausencia"}.`
                    : `Motivo: ${record.reason || record.absenceType || "sin detalle"}.`;

                return `
                    <div class="replacement-log__item">
                        <span>${formatDate(record.date)} · ${turnoReplacementLabel(turno)}</span>
                        <span>${formatHours(hours)}</span>
                        <small>${detail}</small>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}
