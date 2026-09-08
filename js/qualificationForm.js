// El formulario de evaluacion cuatrimestral, listo para imprimir.
//
// Es el documento que REPARTE la unidad de personal, no uno nuestro: la
// aplicacion solo lo rellena. Por eso se calca entero -mismos titulos, mismo
// orden, mismas rayas de guion bajo, mismo pie de firmas- y no se le agregan
// casilleros ni columnas. El original de Word no tiene tablas: es texto con
// subrayados, y asi se reproduce.
//
// Se conservan tal cual dos erratas del original ("ANTECEDENTES JEFE DIRECTOS"
// en plural y "la conducta del funcionamiento" por "del funcionario"): el papel
// que archiva personal tiene que ser el mismo que ellos reparten. Si algun dia
// personal corrige el documento, se corrigen aqui.
//
// OJO al adaptarlo a otra unidad: el membrete y el establecimiento son de este
// hospital. Estan todos juntos en FORM_HEADER para que sea una sola edicion.

import { escapeHTML } from "./htmlUtils.js";

export const FORM_HEADER = {
    lines: [
        "MINISTERIO DE SALUD",
        "S.S. VALPARAISO-SAN ANTONIO",
        "HOSPITAL CLAUDIO VICUÑA",
        "SECCIÓN PERSONAL"
    ],
    title: "FORMULARIO DE EVALUACIÓN CUATRIMESTRAL",
    establishment: "Hospital Claudio Vicuña de San Antonio"
};

// Los tres periodos, en el MISMO orden en que aparecen en el papel.
export const FORM_PERIOD_LINES = [
    { id: "may-aug", label: "Mayo a agosto del año" },
    { id: "jan-apr", label: "Enero a abril del año" },
    { id: "sep-dec", label: "Septiembre a diciembre del año" }
];

// Raya de relleno de un ancho fijo. Para las rayas de firma NO se usa esto:
// llevan `class="ln"` a secas y el ancho lo pone la hoja, porque un
// `style="width:0px"` en linea le ganaba al 100% de la regla y las dos firmas
// salian impresas sin raya donde firmar.
function line(width) {
    return `<span class="ln" style="width:${width}px"></span>`;
}

function filled(value) {
    return `<span class="fill">${escapeHTML(value || "")}</span>`;
}

function periodRowHTML(period, selectedId, year) {
    const mark = period.id === selectedId ? "X" : "";
    const yearText = period.id === selectedId
        ? filled(String(year))
        : line(140);

    return `
        <div class="perline">
            <strong class="mark">${escapeHTML(mark)}</strong>
            ${escapeHTML(period.label)} ${yearText}
        </div>
    `;
}

/**
 * El documento completo, en HTML, para escribirlo en un iframe e imprimirlo.
 *
 * @param {Object} data
 * @param {string} data.folio
 * @param {Object} data.profile `{ name, planta, unidad }`
 * @param {Object} data.supervisor `{ name, cargo }`
 * @param {string} data.periodId cual de los tres se marca con X
 * @param {number} data.year
 * @param {Array} data.factors `[{ title, formText, text }]`
 */
export function qualificationFormHTML(data = {}) {
    const profile = data.profile || {};
    const supervisor = data.supervisor || {};
    const factors = Array.isArray(data.factors) ? data.factors : [];

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHTML(FORM_HEADER.title)}</title>
<style>
    @page { size: A4; margin: 14mm 16mm; }
    * { box-sizing: border-box; }
    body {
        margin: 0;
        font-family: "Times New Roman", Times, Georgia, serif;
        font-size: 12pt;
        line-height: 1.4;
        color: #000;
        background: #fff;
    }
    h1 {
        margin: 20px 0 16px;
        text-align: center;
        font-size: 14pt;
        letter-spacing: .02em;
    }
    h2 {
        margin: 0 0 6px;
        font-size: 12pt;
        letter-spacing: .03em;
    }
    .head { display: flex; justify-content: space-between; gap: 20px; }
    .head strong { display: block; }
    .folio { text-align: right; }
    .folio .box { display: inline-block; margin-top: 3px; border: 1px solid #000; padding: 2px 12px; font-weight: bold; }
    /* Lo que rellena la aplicacion va subrayado, como escrito sobre la linea. */
    .fill { font-weight: bold; border-bottom: 1px solid #000; padding: 0 3px; }
    .ln { display: inline-block; border-bottom: 1px solid #000; }
    .block { margin-bottom: 16px; }
    .perline { line-height: 1.9; }
    .perline .mark { display: inline-block; width: 22px; }
    .row { display: flex; gap: 24px; line-height: 2; }
    .row > span:first-child { flex: 1 1 0; }
    .row > span:last-child { flex: 0 0 230px; }
    .factor { margin-bottom: 16px; }
    .factor .name { font-weight: bold; margin-bottom: 3px; }
    .factor .desc { font-size: 11pt; margin-bottom: 6px; }
    .factor p { margin: 0; padding-left: 6px; text-align: justify; }
    .rule { border-bottom: 1px solid #000; height: 20px; }
    .sign { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; margin-top: 40px; }
    .sign .who { flex: 0 0 290px; }
    .sign .who .ln { width: 100%; }
    .sign .who small { display: block; margin-top: 3px; font-size: 12pt; }
    /* Evita que un factor quede partido entre dos hojas. */
    .factor, .block { break-inside: avoid; }
</style>
</head>
<body>
    <div class="head">
        <div>
            ${FORM_HEADER.lines.map(text => `<strong>${escapeHTML(text)}</strong>`).join("")}
        </div>
        <div class="folio">
            <strong>FOLIO</strong>
            <div class="box">${escapeHTML(data.folio || "")}</div>
        </div>
    </div>

    <h1>${escapeHTML(FORM_HEADER.title)}</h1>

    <div class="block">
        <div>Periodo (Marque con una X)</div>
        ${FORM_PERIOD_LINES.map(period =>
            periodRowHTML(period, data.periodId, data.year)
        ).join("")}
    </div>

    <div class="block">
        <h2>ANTECEDENTES PERSONALES</h2>
        <div class="row">
            <span>Apellidos y nombres: ${filled(profile.name)}</span>
            <span>Planta: ${filled(profile.planta)}</span>
        </div>
        <div class="row">
            <span>Unidad de Trabajo: ${filled(profile.unidad)}</span>
            <span>Establecimiento: ${escapeHTML(FORM_HEADER.establishment)}</span>
        </div>
    </div>

    <div class="block">
        <h2>ANTECEDENTES JEFE DIRECTOS</h2>
        <div style="line-height:2">
            <div>Apellidos y nombres: ${filled(supervisor.name)}</div>
            <div>Cargo: ${filled(supervisor.cargo)}</div>
        </div>
    </div>

    <div class="block">
        <h2>FACTORES A EVALUAR</h2>
        ${factors.map(factor => `
            <div class="factor">
                <div class="name">${escapeHTML(factor.title)}</div>
                <div class="desc">${escapeHTML(factor.formText)}</div>
                <p>${escapeHTML(factor.text || "")}</p>
            </div>
        `).join("")}
    </div>

    <div class="block">
        <h2>NOTIFICACION AL FUNCIONARIO</h2>
        <div style="margin-bottom:12px">
            Conforme ${line(70)}
            <span style="display:inline-block;width:40px"></span>
            Disconforme ${line(70)}
        </div>
        <div>Observaciones (del Funcionario)</div>
        <div class="rule"></div>
        <div class="rule"></div>
        <div class="rule"></div>
        <div class="rule"></div>
        <div class="sign">
            <span class="who">
                <span class="ln"></span>
                <small>Firma del Funcionario</small>
            </span>
            <span>Fecha ${line(40)}/${line(40)}/${line(50)}/</span>
        </div>
    </div>

    <div class="block">
        <h2>RECEPCION DE OFICINA DE PERSONAL</h2>
        <div>Fecha de recepci&oacute;n ${line(44)}/${line(40)}/${line(40)}/</div>
        <div class="sign">
            <span class="who">
                <span class="ln"></span>
                <small>Firma y Timbre</small>
            </span>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Imprime el documento desde un iframe oculto.
 *
 * No se usa `window.open`: el navegador bloquea la ventana emergente por
 * defecto y habria que explicarle al supervisor como habilitarla. Es el mismo
 * camino que usa la programacion semanal.
 */
export function printQualificationForm(html) {
    if (typeof document === "undefined") return;

    const frame = document.createElement("iframe");

    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("title", "Formulario para imprimir");
    frame.style.cssText =
        "position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;";
    document.body.appendChild(frame);

    const view = frame.contentWindow;
    const doc = view?.document;
    let removed = false;
    const remove = () => {
        if (removed) return;
        removed = true;
        frame.remove();
    };

    if (!doc) {
        remove();
        return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    // Se retira DESPUES de imprimir: quitar el iframe con el dialogo abierto
    // cancela la impresion. El plazo largo es la red por si el navegador no
    // dispara afterprint.
    view.onafterprint = remove;

    // No se usa `frame.onload`: al insertarlo se dispara un load por el
    // about:blank inicial y ahi todavia no hay nada escrito.
    setTimeout(() => {
        view.focus();
        view.print();
        setTimeout(remove, 60000);
    }, 0);
}
