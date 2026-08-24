// Lector minimo de Excel binario (.xls, formato BIFF8 dentro de un compound
// file OLE).
//
// Existe porque el reloj control exporta en ese formato y no en .xlsx. El
// parser que ya tenia la app -el de la programacion semanal- lee .xlsx, que es
// un zip de XML; un .xls es otra cosa completamente y no hay forma de reusarlo.
//
// Devuelve las celdas en crudo: texto tal cual y numeros como numeros. NO
// intenta adivinar que numero es una fecha: en Excel una fecha es un numero
// como cualquier otro y solo el formato lo distingue. Quien llama sabe, por el
// encabezado, cual columna trae fechas, y esa es una señal mucho mas confiable
// que mirar el valor.
//
// Sin dependencias: es codigo puro sobre un ArrayBuffer.

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;

// Registros BIFF que interesan.
const BOF = 0x0809;
const CONTINUE = 0x003c;
const SST = 0x00fc;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const BLANK = 0x0201;

function isOleFile(bytes) {
    return OLE_MAGIC.every((byte, index) => bytes[index] === byte);
}

/**
 * Numeros de los sectores que forman la FAT.
 *
 * Los primeros 109 estan en la cabecera. Un archivo mas grande -pasadas unas
 * 7 MB con sectores de 512 bytes- continua la lista en la DIFAT: una cadena de
 * sectores donde cada uno guarda mas numeros y, en sus ultimos 4 bytes, donde
 * sigue la lista.
 *
 * Antes esto se daba por imposible ("un reloj control nunca llega a 7 MB") y la
 * FAT quedaba a medias: los sectores que faltaban se leian como `undefined` y
 * la lectura moria con "Offset is outside the bounds of the DataView". Con las
 * marcas de una unidad entera si se llega.
 */
export function fatSectorNumbers(view, sectorSize, fatCount) {
    const numbers = [];
    const sectorOffset = (index) => (index + 1) * sectorSize;

    for (let i = 0; i < Math.min(fatCount, 109); i++) {
        numbers.push(view.getUint32(76 + i * 4, true));
    }

    const perSector = sectorSize / 4 - 1;
    const difatCount = view.getUint32(72, true);
    let difat = view.getUint32(68, true);
    let guard = 0;

    while (
        numbers.length < fatCount &&
        difat < END_OF_CHAIN &&
        guard <= difatCount + 1
    ) {
        const base = sectorOffset(difat);

        if (base + sectorSize > view.byteLength) break;

        for (let i = 0; i < perSector && numbers.length < fatCount; i++) {
            numbers.push(view.getUint32(base + i * 4, true));
        }

        difat = view.getUint32(base + perSector * 4, true);
        guard++;
    }

    return numbers.filter(sector => sector < END_OF_CHAIN);
}

/**
 * Extrae el stream "Workbook" del compound file.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
function readWorkbookStream(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sectorSize = 1 << view.getUint16(30, true);
    const fatCount = view.getUint32(44, true);
    const dirStart = view.getUint32(48, true);
    const sectorOffset = (index) => (index + 1) * sectorSize;

    // La FAT encadena los sectores de cada stream, y ella misma vive repartida
    // en sectores. Los numeros de los primeros 109 van en la cabecera; de ahi
    // en adelante siguen en la DIFAT.
    const fat = [];

    fatSectorNumbers(view, sectorSize, fatCount).forEach(sector => {
        const base = sectorOffset(sector);

        for (let offset = 0; offset + 4 <= sectorSize; offset += 4) {
            if (base + offset + 4 > view.byteLength) return;

            fat.push(view.getUint32(base + offset, true));
        }
    });

    const readChain = (start, size = 0) => {
        const parts = [];
        let sector = start;
        let guard = 0;

        while (
            Number.isInteger(sector) &&
            sector >= 0 &&
            sector < END_OF_CHAIN &&
            guard < 1000000
        ) {
            const base = sectorOffset(sector);

            // Un sector fuera del archivo significa cadena rota: se corta aqui
            // en vez de reventar con un error del DataView.
            if (base >= bytes.length) break;

            parts.push(bytes.subarray(base, base + sectorSize));
            sector = fat[sector];
            guard++;
        }

        const total = parts.reduce((sum, part) => sum + part.length, 0);
        const out = new Uint8Array(total);
        let position = 0;

        parts.forEach(part => {
            out.set(part, position);
            position += part.length;
        });

        return size ? out.subarray(0, size) : out;
    };

    const directory = readChain(dirStart);
    const dirView = new DataView(
        directory.buffer,
        directory.byteOffset,
        directory.byteLength
    );

    for (let entry = 0; entry + 128 <= directory.length; entry += 128) {
        const nameLength = dirView.getUint16(entry + 64, true);

        if (!nameLength) continue;

        let name = "";

        for (let i = 0; i < nameLength - 2; i += 2) {
            name += String.fromCharCode(dirView.getUint16(entry + i, true));
        }

        if (name === "Workbook" || name === "Book") {
            return readChain(
                dirView.getUint32(entry + 116, true),
                dirView.getUint32(entry + 120, true)
            );
        }
    }

    throw new Error("El archivo Excel no contiene una hoja legible.");
}

/**
 * Parte el stream en registros BIFF, uniendo los CONTINUE al registro previo.
 * Un SST con muchos textos se parte en varios CONTINUE, y leerlos por separado
 * dejaria la mitad de las cadenas fuera.
 */
function readRecords(stream) {
    const view = new DataView(
        stream.buffer,
        stream.byteOffset,
        stream.byteLength
    );
    const records = [];
    let position = 0;

    while (position + 4 <= stream.length) {
        const opcode = view.getUint16(position, true);
        const length = view.getUint16(position + 2, true);
        const body = stream.subarray(position + 4, position + 4 + length);

        if (opcode === CONTINUE && records.length) {
            const previous = records[records.length - 1];
            const merged = new Uint8Array(previous.body.length + body.length);

            merged.set(previous.body, 0);
            merged.set(body, previous.body.length);
            // Donde empieza cada trozo. La SST lo necesita: un texto puede
            // quedar partido entre dos registros, y el segundo trozo arranca
            // con un byte de bandera que dice como sigue codificado. Sin saber
            // donde estan esos cortes, ese byte se lee como si fuera texto y
            // desde ahi todo queda corrido.
            previous.breaks = previous.breaks || [];
            previous.breaks.push(previous.body.length);
            previous.body = merged;
        } else {
            records.push({ opcode, body, breaks: [] });
        }

        position += 4 + length;
    }

    return records;
}

// Tabla de textos compartidos: las celdas de texto guardan un indice a esta
// tabla, no la cadena.
export function readSharedStrings(records) {
    const strings = [];
    const record = records.find(item => item.opcode === SST);

    if (!record || record.body.length < 8) return strings;

    const { body } = record;
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const breaks = new Set(record.breaks || []);
    const count = view.getUint32(4, true);
    let position = 8;

    for (let i = 0; i < count && position + 3 <= body.length; i++) {
        const characters = view.getUint16(position, true);
        const flags = body[position + 2];
        let wide = (flags & 0x01) === 1;

        position += 3;

        // Se saltan los bloques opcionales de formato enriquecido y de idioma:
        // solo interesa el texto.
        let richRuns = 0;
        let farEastSize = 0;

        if (flags & 0x08) {
            if (position + 2 > body.length) break;
            richRuns = view.getUint16(position, true);
            position += 2;
        }

        if (flags & 0x04) {
            if (position + 4 > body.length) break;
            farEastSize = view.getUint32(position, true);
            position += 4;
        }

        let text = "";
        let read = 0;
        let truncated = false;

        while (read < characters) {
            // Al cruzar a un trozo nuevo, su primer byte dice como sigue
            // codificado el resto del texto: puede cambiar de 8 a 16 bits a
            // mitad de palabra.
            if (breaks.has(position)) {
                if (position + 1 > body.length) { truncated = true; break; }
                wide = (body[position] & 0x01) === 1;
                position += 1;
            }

            const size = wide ? 2 : 1;

            if (position + size > body.length) { truncated = true; break; }

            text += String.fromCharCode(
                wide ? view.getUint16(position, true) : body[position]
            );
            position += size;
            read++;
        }

        position += richRuns * 4 + farEastSize;
        strings.push(text);

        if (truncated) break;
    }

    return strings;
}

// Los numeros RK vienen empaquetados en 30 bits, con dos banderas: entero o
// float, y dividido por 100 o no.
function decodeRk(value) {
    const isInteger = (value & 0x02) !== 0;
    const isDivided = (value & 0x01) !== 0;
    let number;

    if (isInteger) {
        number = value >> 2;
    } else {
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);

        view.setUint32(4, value & 0xfffffffc);
        number = view.getFloat64(0);
    }

    return isDivided ? number / 100 : number;
}

/**
 * Lee un .xls y devuelve sus filas.
 *
 * @param {ArrayBuffer} buffer
 * @returns {Array<Array<string|number|null>>} filas por indice, celdas en crudo
 */
export function readXlsRows(buffer) {
    const bytes = new Uint8Array(buffer);

    if (!isOleFile(bytes)) {
        throw new Error(
            "El archivo no tiene el formato Excel esperado (.xls del reloj control)."
        );
    }

    const stream = readWorkbookStream(bytes);
    const records = readRecords(stream);
    const strings = readSharedStrings(records);
    const cells = new Map();
    let maxRow = -1;
    let maxColumn = -1;

    const put = (row, column, value) => {
        cells.set(`${row}|${column}`, value);
        maxRow = Math.max(maxRow, row);
        maxColumn = Math.max(maxColumn, column);
    };

    records.forEach(({ opcode, body }) => {
        if (!body.length) return;

        const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

        if (opcode === LABELSST) {
            const index = view.getUint32(6, true);

            put(
                view.getUint16(0, true),
                view.getUint16(2, true),
                strings[index] ?? ""
            );
            return;
        }

        if (opcode === LABEL) {
            const characters = view.getUint16(6, true);
            let text = "";

            for (let c = 0; c < characters; c++) {
                text += String.fromCharCode(body[9 + c]);
            }

            put(view.getUint16(0, true), view.getUint16(2, true), text);
            return;
        }

        if (opcode === NUMBER) {
            put(
                view.getUint16(0, true),
                view.getUint16(2, true),
                view.getFloat64(6, true)
            );
            return;
        }

        if (opcode === RK) {
            put(
                view.getUint16(0, true),
                view.getUint16(2, true),
                decodeRk(view.getUint32(6, true))
            );
            return;
        }

        if (opcode === MULRK) {
            const row = view.getUint16(0, true);
            const first = view.getUint16(2, true);
            const count = (body.length - 6) / 6;

            for (let i = 0; i < count; i++) {
                put(
                    row,
                    first + i,
                    decodeRk(view.getUint32(4 + i * 6 + 2, true))
                );
            }
            return;
        }

        if (opcode === BLANK) {
            put(view.getUint16(0, true), view.getUint16(2, true), null);
        }
    });

    if (maxRow < 0) return [];

    return Array.from({ length: maxRow + 1 }, (_, row) =>
        Array.from({ length: maxColumn + 1 }, (_, column) =>
            cells.has(`${row}|${column}`) ? cells.get(`${row}|${column}`) : null
        )
    );
}

/**
 * Convierte un numero de serie de Excel a fecha.
 *
 * El origen es el 30 de diciembre de 1899, no el 1 de enero de 1900: Excel
 * arrastra un bug historico que da 1900 como año bisiesto, y ese origen
 * desplazado es lo que lo compensa.
 *
 * @param {number} serial
 * @returns {Date|null}
 */
export function dateFromExcelSerial(serial) {
    const value = Number(serial);

    if (!Number.isFinite(value) || value <= 0) return null;

    const days = Math.floor(value);
    const seconds = Math.round((value - days) * 86400);

    // El serial es hora de PARED: no lleva zona horaria. Se descompone en UTC
    // -que es aritmetica limpia, sin horario de verano de por medio- y recien
    // ahi se arma una fecha local con esas mismas cifras.
    //
    // Devolver directamente la fecha UTC corria las marcas 4 horas en Chile: un
    // marcaje de las 08:18 aparecia como 04:18, y los de la madrugada saltaban
    // al dia anterior.
    const utc = new Date(Date.UTC(1899, 11, 30));

    utc.setUTCDate(utc.getUTCDate() + days);
    utc.setUTCSeconds(utc.getUTCSeconds() + seconds);

    const date = new Date(
        utc.getUTCFullYear(),
        utc.getUTCMonth(),
        utc.getUTCDate(),
        utc.getUTCHours(),
        utc.getUTCMinutes(),
        utc.getUTCSeconds()
    );

    return Number.isNaN(date.getTime()) ? null : date;
}

export const XLS_READER_INTERNALS = {
    decodeRk,
    isOleFile,
    readRecords,
    readSharedStrings
};
