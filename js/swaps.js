import {
    getBaseProfileData,
    getBlockedDays,
    getProfileData,
    getSwaps,
    saveBlockedDays,
    saveProfileData,
    saveSwaps
} from "./storage.js";
import { getJSON } from "./persistence.js";
import { getAbsenceType } from "./rulesEngine.js";
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

function isMedicalLicense(absence) {
    const type = getAbsenceType(absence);

    return (
        type === "license" ||
        type === "professional_license"
    );
}

export function cambioEstaAnulado(swap) {
    return Boolean(
        swap?.canceled ||
        swap?.anulado ||
        swap?.status === "canceled" ||
        swap?.status === "anulado"
    );
}

function resetDayToBase(profile, keyDay) {
    const data = getProfileData(profile);
    const baseData = getBaseProfileData(profile);
    const blocked = getBlockedDays(profile);
    const hasBase =
        Object.prototype.hasOwnProperty.call(baseData, keyDay);

    if (!hasBase) {
        return;
    }

    const baseTurno = Number(baseData[keyDay]) || 0;

    if (baseTurno) {
        data[keyDay] = baseTurno;
        blocked[keyDay] = true;
    } else {
        delete data[keyDay];
        delete blocked[keyDay];
    }

    saveProfileData(data, profile);
    saveBlockedDays(blocked, profile);
}

/* =========================================
   OBTENER CAMBIOS DEL MES
========================================= */
export function cambiosDelMes(year, month) {

    const swaps = getSwaps();

    return swaps.filter(s =>
        Number(s.year) === Number(year) &&
        Number(s.month) === Number(month)
    );
}

/* =========================================
   REGISTRAR CAMBIO
========================================= */
export function registrarCambio(data) {

    const swaps = getSwaps();
    const id = Date.now();

    swaps.push({
        id,

        from: data.from,
        to: data.to,

        fecha: data.fecha,
        devolucion: data.devolucion,

        turno: data.turno,
        turnoDevuelto: data.turnoDevuelto,

        year: data.year,
        month: data.month,

        canceled: false
    });

    saveSwaps(swaps);
    addAuditLog(
        AUDIT_CATEGORY.TURN_CHANGES,
        "Registro cambio de turno",
        `${data.from} -> ${data.to}: cambio ${data.fecha}, devolucion ${data.devolucion}.`,
        {
            profile: data.from,
            swapId: id,
            from: data.from,
            to: data.to
        }
    );
}

/* =========================================
   BUSCAR CAMBIO POR FECHA
========================================= */
export function getCambioPorFecha(fecha) {

    const swaps = getSwaps();

    return swaps.find(s =>
        !cambioEstaAnulado(s) &&
        (
            (!s.skipFecha && s.fecha === fecha) ||
            (!s.skipDevolucion && s.devolucion === fecha)
        )
    );
}

export function getCambioTurnoRecibido(nombre, keyDay) {
    const fecha = isoFromKey(keyDay);

    return getSwaps().find(swap =>
        !cambioEstaAnulado(swap) &&
        (
            !swap.skipFecha &&
            swap.to === nombre &&
            swap.fecha === fecha
        ) ||
        (
            !swap.skipDevolucion &&
            swap.from === nombre &&
            swap.devolucion === fecha
        )
    ) || null;
}

export function cambioTieneLicenciaEnTurnosBase(swap) {
    if (!swap) return false;

    const checks = [];

    if (!swap.skipFecha && swap.from && swap.fecha) {
        checks.push({
            profile: swap.from,
            key: keyFromISO(swap.fecha)
        });
    }

    if (!swap.skipDevolucion && swap.to && swap.devolucion) {
        checks.push({
            profile: swap.to,
            key: keyFromISO(swap.devolucion)
        });
    }

    return checks.some(({ profile, key }) => {
        const absences = getJSON(`absences_${profile}`, {});

        return isMedicalLicense(absences[key]);
    });
}

export function deshacerCambioTurno(swap) {
    if (!swap) return;

    const fechaKey = keyFromISO(swap.fecha);
    const devolucionKey = keyFromISO(swap.devolucion);

    [
        swap.from,
        swap.to
    ].forEach(profile => {
        if (!profile) return;

        resetDayToBase(profile, fechaKey);
        resetDayToBase(profile, devolucionKey);
    });

    const swaps = getSwaps().map(item =>
        item.id === swap.id
            ? {
                ...item,
                canceled: true,
                canceledAt: new Date().toISOString()
            }
            : item
    );

    saveSwaps(swaps);
    addAuditLog(
        AUDIT_CATEGORY.TURN_CHANGES,
        "Anulo cambio de turno",
        `${swap.from} -> ${swap.to}: cambio ${swap.fecha}, devolucion ${swap.devolucion}.`,
        {
            profile: swap.from,
            swapId: swap.id,
            from: swap.from,
            to: swap.to
        }
    );
}

/* =========================================
   ELIMINAR CAMBIO
========================================= */
export function eliminarCambio(id) {

    const swaps = getSwaps()
        .filter(s => s.id !== id);

    saveSwaps(swaps);
    addAuditLog(
        AUDIT_CATEGORY.TURN_CHANGES,
        "Elimino cambio de turno",
        `ID de cambio eliminado: ${id}.`,
        { swapId: id }
    );
}
