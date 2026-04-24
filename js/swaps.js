import {
    getSwaps,
    saveSwaps
} from "./storage.js";

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

    swaps.push({
        id: Date.now(),

        from: data.from,
        to: data.to,

        fecha: data.fecha,
        devolucion: data.devolucion,

        turno: data.turno,
        turnoDevuelto: data.turnoDevuelto,

        year: data.year,
        month: data.month
    });

    saveSwaps(swaps);
}

/* =========================================
   BUSCAR CAMBIO POR FECHA
========================================= */
export function getCambioPorFecha(fecha) {

    const swaps = getSwaps();

    return swaps.find(s =>
        (!s.skipFecha && s.fecha === fecha) ||
        (!s.skipDevolucion && s.devolucion === fecha)
    );
}

/* =========================================
   ELIMINAR CAMBIO
========================================= */
export function eliminarCambio(id) {

    const swaps = getSwaps()
        .filter(s => s.id !== id);

    saveSwaps(swaps);
}
