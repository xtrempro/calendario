// Construye la grilla de la PROGRAMACIÓN SEMANAL a partir de un modelo de hoja de
// Excel (celdas + celdas combinadas), de forma DINÁMICA: no asume posiciones
// fijas de columnas ni cantidad de servicios. Es el reemplazo determinístico del
// OCR de imagen. Salida (mismo contrato que consume la PWA):
//
//   { title, weekLabel, days: string[], rows: Row[] }
//   Row = { title, detail, fullWidth?, fullText?, cells?: Cell[] }
//   Cell = string | { text, rowSpan }   // rowSpan para los bloques de fin de semana
//
// El TONO no se asigna aquí: la PWA lo deriva del título contra su plantilla
// (con un tono por defecto para servicios nuevos), así el importador queda
// agnóstico a qué servicios existan.

function colToNum(letters) {
    let n = 0;
    for (const ch of String(letters).toUpperCase()) {
        n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return n;
}

function numToCol(n) {
    let s = "";
    let x = n;
    while (x > 0) {
        const r = (x - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        x = Math.floor((x - 1) / 26);
    }
    return s;
}

function parseRef(ref) {
    const m = /^([A-Z]+)(\d+)$/i.exec(String(ref).trim());
    if (!m) return null;
    return { col: colToNum(m[1]), row: Number(m[2]) };
}

function normText(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

// Texto de contenido (celdas / nota full-width): PRESERVA los saltos de línea
// (la PWA los renderiza como <br>), colapsando solo espacios/tabs dentro de cada
// línea y descartando líneas vacías.
function cellText(value) {
    return String(value == null ? "" : value)
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
}

// Índice de celdas combinadas: para cada celda cubierta devuelve el ancla y el
// tamaño del rango, marcando si ESA celda es el ancla (esquina superior-izq).
function buildMergeIndex(merges) {
    const index = new Map();
    for (const range of merges || []) {
        const [a, b] = String(range).split(":");
        const A = parseRef(a);
        const B = parseRef(b || a);
        if (!A || !B) continue;
        const c1 = Math.min(A.col, B.col);
        const c2 = Math.max(A.col, B.col);
        const r1 = Math.min(A.row, B.row);
        const r2 = Math.max(A.row, B.row);
        for (let r = r1; r <= r2; r += 1) {
            for (let c = c1; c <= c2; c += 1) {
                index.set(`${c},${r}`, {
                    anchorCol: c1,
                    anchorRow: r1,
                    colspan: c2 - c1 + 1,
                    rowspan: r2 - r1 + 1,
                    isAnchor: c === c1 && r === r1
                });
            }
        }
    }
    return index;
}

const DAY_RE = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i;

// Separa "SERVICIO / Colación 12:45 hrs." en { title, detail }. El detalle es
// SOLO la parte de "Colación ..." o un horario "HH:MM - HH:MM hrs." — así no se
// parte mal "CUMPLEAÑOS Y/O FESTIVIDADES" ni "FERIADO LEGAL/D.COMPEN." (que no
// tienen colación y quedan íntegros como título).
function splitServiceLabel(label) {
    const clean = normText(label);
    if (!clean) return { title: "", detail: "" };
    const detailRe = /(colaci[oó]n\b[^/]*|\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*hrs?\.?)/i;
    const m = detailRe.exec(clean);
    if (m && m.index > 0) {
        const title = normText(clean.slice(0, m.index).replace(/[/\-]\s*$/, ""));
        const detail = normText(clean.slice(m.index));
        if (title) return { title, detail };
    }
    return { title: clean, detail: "" };
}

export function scheduleGridFromSheet(sheet) {
    const cells = (sheet && sheet.cells) || {};
    const maxRow = Number(sheet && sheet.maxRow) || 0;
    const maxCol = Number(sheet && sheet.maxCol) || 0;
    const merge = buildMergeIndex(sheet && sheet.merges);
    const val = (col, row) => normText(cells[`${numToCol(col)}${row}`]);
    const content = (col, row) => cellText(cells[`${numToCol(col)}${row}`]);

    // 1) Título: "PLAN SEMANAL ..." en las primeras filas.
    let title = "";
    for (let r = 1; r <= Math.min(3, maxRow) && !title; r += 1) {
        for (let c = 1; c <= maxCol; c += 1) {
            const v = val(c, r);
            if (/plan\s+semanal/i.test(v)) { title = v; break; }
        }
    }

    // 2) Fila de días: la de las primeras filas con más encabezados de día.
    let dayRow = 0;
    let dayCols = [];
    for (let r = 1; r <= Math.min(4, maxRow); r += 1) {
        const cols = [];
        for (let c = 1; c <= maxCol; c += 1) {
            if (DAY_RE.test(val(c, r))) cols.push(c);
        }
        if (cols.length > dayCols.length) { dayCols = cols; dayRow = r; }
    }
    const days = dayCols.map((c) => val(c, dayRow));
    const firstDayCol = dayCols[0] || 2;
    const lastDayCol = dayCols[dayCols.length - 1] || firstDayCol;

    // 3) Filas de servicio (desde dayRow+1). Recorre col A dinámicamente.
    const rows = [];
    for (let r = dayRow + 1; r <= maxRow; r += 1) {
        const labelMerge = merge.get(`1,${r}`);
        // Fila cubierta por un merge vertical anclado más arriba en A: ya se emitió.
        if (labelMerge && !labelMerge.isAnchor && labelMerge.anchorCol === 1) continue;

        const label = val(1, r);
        // Fila full-width: la etiqueta (col A) se combina horizontalmente cubriendo
        // las columnas de día (p. ej. A:F para la RONDA). Su texto ocupa todo el ancho.
        const isFullWidth = Boolean(
            labelMerge &&
            labelMerge.isAnchor &&
            labelMerge.anchorCol === 1 &&
            labelMerge.colspan >= firstDayCol
        );

        if (isFullWidth) {
            if (!label) continue;
            const fullText = content(1, r);
            rows.push({ title: normText(label), detail: "", fullWidth: true, fullText });
            continue;
        }

        // Celdas por día, respetando merges verticales del fin de semana.
        const cellsOut = [];
        let hasContent = Boolean(label);
        for (const c of dayCols) {
            const cm = merge.get(`${c},${r}`);
            if (cm && !cm.isAnchor) {
                // cubierta por un merge vertical anclado arriba -> no se emite celda.
                continue;
            }
            const text = content(c, r);
            if (text) hasContent = true;
            if (cm && cm.isAnchor && cm.rowspan > 1) {
                cellsOut.push({ text, rowSpan: cm.rowspan });
            } else {
                cellsOut.push(text);
            }
        }

        if (!hasContent) continue;
        const { title: svcTitle, detail } = splitServiceLabel(label);
        rows.push({ title: svcTitle || label, detail, cells: cellsOut });
    }

    return { title, weekLabel: title.replace(/^.*?semanal\s*/i, "").trim(), days, rows };
}

export default scheduleGridFromSheet;
