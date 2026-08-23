// Importacion de marcas del reloj control desde el Excel del sistema de
// asistencia.
//
// El archivo trae una fila por marca, con el RUT del trabajador, la fecha y
// hora, y si fue Entrada o Salida. Aca se convierte eso en un indice por RUT y
// fecha que el reporte consulta para llenar las columnas Entrada y Salida.
//
// El archivo se puede subir las veces que haga falta: cada marca trae un
// Checksum unico y se usa como identidad, asi que volver a cargar un periodo
// que se solapa con otro no duplica nada.

import { getJSON, setJSON } from "./persistence.js";
import { readXlsRows, dateFromExcelSerial } from "./xlsReader.js";

const STORAGE_KEY = "attendanceMarks";

// Encabezados que se buscan, en minusculas y sin acentos. El sistema los puede
// traducir o reordenar, asi que las columnas se ubican por NOMBRE y nunca por
// posicion.
const COLUMN_ALIASES = {
    rut: ["rut", "run"],
    name: ["nombre", "trabajador", "funcionario"],
    timestamp: ["fecha/hora", "fecha hora", "fechahora", "fecha y hora", "fecha"],
    type: ["tipo registro", "tipo de registro", "tipo", "movimiento"],
    id: ["checksum", "id", "codigo registro"]
};

function stripAccents(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
}

/**
 * RUT sin puntos y con guion, en mayusculas: "17.816.632-8" -> "17816632-8".
 * Es la forma en que se compara con el RUT del perfil, que se escribe de
 * cualquier manera.
 */
export function normalizeRut(value) {
    const clean = String(value || "")
        .replace(/[^0-9kK]/g, "")
        .toUpperCase();

    if (clean.length < 2) return "";

    return `${clean.slice(0, -1)}-${clean.slice(-1)}`;
}

function toISODate(date) {
    return `${date.getFullYear()}-` +
        `${String(date.getMonth() + 1).padStart(2, "0")}-` +
        `${String(date.getDate()).padStart(2, "0")}`;
}

function toHHMM(date) {
    return `${String(date.getHours()).padStart(2, "0")}:` +
        `${String(date.getMinutes()).padStart(2, "0")}`;
}

// "Entrada" / "Salida", tolerando variantes del sistema de asistencia.
function normalizeMarkType(value) {
    const text = stripAccents(value);

    if (!text) return "";
    if (text.startsWith("entrada") || text === "in" || text === "e") return "in";
    if (text.startsWith("salida") || text === "out" || text === "s") return "out";

    return "";
}

/**
 * Ubica la fila de encabezado y mapea cada campo a su columna.
 *
 * El Excel trae titulo, rango de fechas y nombre de la empresa antes de la
 * tabla, asi que la fila de encabezado no es la primera.
 */
export function findHeader(rows) {
    for (let index = 0; index < Math.min(rows.length, 40); index++) {
        const row = rows[index] || [];
        const headers = row.map(stripAccents);
        const columns = {};

        Object.entries(COLUMN_ALIASES).forEach(([field, aliases]) => {
            const column = headers.findIndex(header =>
                header && aliases.includes(header)
            );

            if (column >= 0) columns[field] = column;
        });

        // Con RUT y fecha/hora ya se puede trabajar; lo demas es opcional.
        if (columns.rut !== undefined && columns.timestamp !== undefined) {
            return { row: index, columns };
        }
    }

    return null;
}

/**
 * Convierte las filas del Excel en marcas normalizadas.
 * @returns {{marks: Array<Object>, skipped: number}}
 */
export function parseAttendanceRows(rows) {
    const header = findHeader(rows);

    if (!header) {
        throw new Error(
            "No se encontraron las columnas RUT y Fecha/Hora en el archivo. " +
            "Revisa que sea el informe de registros de asistencia."
        );
    }

    const { columns } = header;
    const marks = [];
    let skipped = 0;

    for (let index = header.row + 1; index < rows.length; index++) {
        const row = rows[index] || [];
        const rut = normalizeRut(row[columns.rut]);
        const raw = row[columns.timestamp];
        // La fecha viaja como numero de serie de Excel; si el sistema la
        // exportara como texto, se intenta leer igual.
        const date = typeof raw === "number"
            ? dateFromExcelSerial(raw)
            : (raw ? new Date(String(raw).replace(" ", "T")) : null);

        if (!rut || !date || Number.isNaN(date.getTime())) {
            skipped++;
            continue;
        }

        marks.push({
            rut,
            name: String(row[columns.name] ?? "").replace(/\s+/g, " ").trim(),
            date: toISODate(date),
            time: toHHMM(date),
            type: normalizeMarkType(row[columns.type]),
            id: String(row[columns.id] ?? "").trim()
        });
    }

    return { marks, skipped };
}

export function getAttendanceMarks() {
    const stored = getJSON(STORAGE_KEY, {});

    return stored && typeof stored === "object" ? stored : {};
}

export function saveAttendanceMarks(marks) {
    setJSON(STORAGE_KEY, marks || {});
}

// Identidad de una marca. El Checksum del reloj es unico por marca; si el
// archivo no lo trajera, se compone con hora y tipo, que para un mismo
// trabajador y dia tampoco se repiten.
function markIdentity(mark) {
    return mark.id || `${mark.time}|${mark.type}`;
}

/**
 * Guarda las marcas nuevas y descarta las que ya estaban.
 *
 * @param {Array<Object>} marks
 * @returns {{added: number, duplicated: number, workers: number, dates: string[]}}
 */
export function mergeAttendanceMarks(marks) {
    const store = getAttendanceMarks();
    const dates = new Set();
    const workers = new Set();
    let added = 0;
    let duplicated = 0;

    marks.forEach(mark => {
        const byDate = store[mark.rut] || (store[mark.rut] = {});
        const list = byDate[mark.date] || (byDate[mark.date] = []);
        const identity = markIdentity(mark);

        if (list.some(existing => markIdentity(existing) === identity)) {
            duplicated++;
            return;
        }

        list.push({
            time: mark.time,
            type: mark.type,
            id: mark.id
        });
        list.sort((a, b) => a.time.localeCompare(b.time));
        added++;
        dates.add(mark.date);
        workers.add(mark.rut);
    });

    if (added) saveAttendanceMarks(store);

    return {
        added,
        duplicated,
        workers: workers.size,
        dates: [...dates].sort()
    };
}

/**
 * Marcas de un trabajador en una fecha.
 * @param {string} rut
 * @param {string} iso
 * @returns {Array<{time: string, type: string}>}
 */
export function getMarksFor(rut, iso) {
    const key = normalizeRut(rut);

    if (!key) return [];

    return getAttendanceMarks()[key]?.[iso] || [];
}

/**
 * Horas de entrada y de salida de un dia, listas para la celda del reporte.
 *
 * Si hay mas de una marca del mismo tipo se muestran TODAS: un trabajador puede
 * salir y volver a entrar el mismo dia, y esconder marcas seria justamente
 * perder la informacion que se quiere revisar. Las marcas sin tipo se muestran
 * en Entrada, que es donde el reloj las deja cuando no lo especifica.
 */
export function getAttendanceCells(rut, iso) {
    const marks = getMarksFor(rut, iso);

    return {
        entrada: marks
            .filter(mark => mark.type !== "out")
            .map(mark => mark.time)
            .join(" · "),
        salida: marks
            .filter(mark => mark.type === "out")
            .map(mark => mark.time)
            .join(" · ")
    };
}

/**
 * Hora de la marca de entrada de un dia, para medir el atraso.
 *
 * Usa el MISMO criterio que la celda "Entrada" del reporte (todo lo que no sea
 * salida) y se queda con la mas temprana: es la llegada. Si las dos no
 * coincidieran, la columna Atrasos contradiria a la de al lado.
 *
 * @param {string} rut
 * @param {string} iso
 * @returns {string} "HH:MM", o "" si ese dia no tiene entrada
 */
export function getEntryMarkTime(rut, iso) {
    const times = getMarksFor(rut, iso)
        .filter(mark => mark.type !== "out")
        .map(mark => String(mark.time || ""))
        .filter(Boolean)
        .sort();

    return times[0] || "";
}

/**
 * Lee un archivo del reloj control y guarda sus marcas.
 * @param {File} file
 */
export async function importAttendanceFile(file) {
    if (!file) throw new Error("Selecciona el archivo del reloj control.");

    const name = String(file.name || "").toLowerCase();

    if (!name.endsWith(".xls") && !name.endsWith(".xlsx")) {
        throw new Error("El registro de asistencia debe ser un archivo Excel.");
    }

    const buffer = await file.arrayBuffer();
    const rows = readXlsRows(buffer);
    const { marks, skipped } = parseAttendanceRows(rows);

    if (!marks.length) {
        throw new Error("El archivo no trae marcas de asistencia legibles.");
    }

    return { ...mergeAttendanceMarks(marks), skipped, total: marks.length };
}
