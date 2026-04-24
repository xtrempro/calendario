import { getProfiles } from "./storage.js";
import { aplicarCambiosTurno } from "./turnEngine.js";
import { ESTAMENTO } from "./constants.js";
import { isWeekend } from "./calculations.js";
import { currentDate } from "./calendar.js";

const KEY = "staffing_config";

function defaultConfig() {
    const tecnico = ESTAMENTO[1];

    return {
        Profesional: { habil: 2, inhabil: 1, noche: 1 },
        [tecnico]: { habil: 3, inhabil: 2, noche: 1 },
        Administrativo: { habil: 2, inhabil: 0, noche: 0 },
        Auxiliar: { habil: 2, inhabil: 1, noche: 1 }
    };
}

function normalizeConfig(config = {}) {
    const base = defaultConfig();
    const tecnico = ESTAMENTO[1];
    const legacyTecnico =
        config["TÃ©cnico"] ||
        config.Tecnico ||
        {};

    return {
        ...base,
        ...config,
        [tecnico]: {
            ...base[tecnico],
            ...(config[tecnico] || legacyTecnico)
        }
    };
}

export function getStaffingConfig() {
    return normalizeConfig(
        JSON.parse(localStorage.getItem(KEY)) || {}
    );
}

export function saveStaffingConfig(cfg) {
    localStorage.setItem(
        KEY,
        JSON.stringify(normalizeConfig(cfg))
    );
}

function trabajaDia(turno) {
    return [1, 3, 4, 5].includes(turno);
}

function trabajaNoche(turno) {
    return [2, 3, 5].includes(turno);
}

function key(y, m, d){
    return `${y}-${m}-${d}`;
}

function getDataPerfil(nombre){
    return JSON.parse(
        localStorage.getItem("data_" + nombre)
    ) || {};
}

function contarGrupo(profiles, estamento, y, m, d){
    let dia = 0;
    let noche = 0;

    profiles
        .filter(profile => profile.estamento === estamento)
        .forEach(profile => {
            const data = getDataPerfil(profile.name);

            let turno = data[key(y, m, d)] || 0;

            turno = aplicarCambiosTurno(
                profile.name,
                key(y, m, d),
                turno
            );

            if (trabajaDia(turno)) dia++;
            if (trabajaNoche(turno)) noche++;
        });

    return { dia, noche };
}

function sugerirReemplazo(profiles, estamento, y, m, d){
    const libres = profiles
        .filter(profile => profile.estamento === estamento)
        .filter(profile => {
            const data = getDataPerfil(profile.name);

            let turno = data[key(y, m, d)] || 0;

            turno = aplicarCambiosTurno(
                profile.name,
                key(y, m, d),
                turno
            );

            return turno === 0;
        });

    if (!libres.length) return null;

    libres.sort((a, b) => a.name.localeCompare(b.name));

    return libres[0].name;
}

export function analizarMes(year, month){
    const cfg = getStaffingConfig();
    const profiles = getProfiles();
    const diasMes =
        new Date(year, month + 1, 0).getDate();

    const salida = [];

    for (let d = 1; d <= diasMes; d++) {
        const fecha = new Date(year, month, d);
        const habil = !isWeekend(fecha);
        const detalle = [];

        ESTAMENTO.forEach(est => {
            const req = habil
                ? cfg[est].habil
                : cfg[est].inhabil;

            const reqN = cfg[est].noche;

            const real =
                contarGrupo(
                    profiles,
                    est,
                    year,
                    month,
                    d
                );

            if (real.dia < req) {
                const faltan = req - real.dia;
                const sug =
                    sugerirReemplazo(
                        profiles,
                        est,
                        year,
                        month,
                        d
                    );

                detalle.push({
                    tipo: "faltante",
                    estamento: est,
                    cantidad: faltan,
                    sugerencia: sug
                });
            }

            if (real.dia > req) {
                detalle.push({
                    tipo: "exceso",
                    estamento: est,
                    cantidad: real.dia - req
                });
            }

            if (real.noche < reqN) {
                detalle.push({
                    tipo: "noche",
                    estamento: est,
                    cantidad: reqN - real.noche
                });
            }
        });

        salida.push({
            dia: d,
            detalle
        });
    }

    return salida;
}

export function renderStaffingPanel(){
    const btn = document.getElementById("saveStaffingBtn");
    if (!btn) return;

    const cfg = getStaffingConfig();

    ESTAMENTO.forEach(est => {
        document.getElementById(`cfg_${est}_habil`).value =
            cfg[est].habil;

        document.getElementById(`cfg_${est}_inhabil`).value =
            cfg[est].inhabil;

        document.getElementById(`cfg_${est}_noche`).value =
            cfg[est].noche;
    });

    btn.onclick = () => {
        const nuevo = {};

        ESTAMENTO.forEach(est => {
            nuevo[est] = {
                habil: Number(document.getElementById(`cfg_${est}_habil`).value) || 0,
                inhabil: Number(document.getElementById(`cfg_${est}_inhabil`).value) || 0,
                noche: Number(document.getElementById(`cfg_${est}_noche`).value) || 0
            };
        });

        saveStaffingConfig(nuevo);
        renderStaffingAnalysis();
    };
}

function renderDetailBadge(detail){
    if (detail.tipo === "faltante") {
        return `
            <span class="staffing-pill staffing-pill--bad">
                Falta ${detail.cantidad} ${detail.estamento}
                ${detail.sugerencia ? ` - Sugerido: ${detail.sugerencia}` : ""}
            </span>
        `;
    }

    if (detail.tipo === "exceso") {
        return `
            <span class="staffing-pill staffing-pill--warn">
                Exceso ${detail.cantidad} ${detail.estamento}
            </span>
        `;
    }

    return `
        <span class="staffing-pill staffing-pill--night">
            Falta noche ${detail.cantidad} ${detail.estamento}
        </span>
    `;
}

function mostrarResultado(data){
    const div = document.getElementById("staffingResult");
    if (!div) return;

    const issues = data.filter(item => item.detalle.length);

    if (!issues.length) {
        div.innerHTML = `
            <div class="staffing-summary staffing-summary--ok">
                Cobertura completa para el mes visible.
            </div>
        `;
        return;
    }

    div.innerHTML = issues
        .map(item => `
            <article class="staffing-entry">
                <div class="staffing-entry__day">Día ${item.dia}</div>
                <div class="staffing-entry__list">
                    ${item.detalle.map(renderDetailBadge).join("")}
                </div>
            </article>
        `)
        .join("");
}

export function analizarStaffingMes(
    year = currentDate.getFullYear(),
    month = currentDate.getMonth()
){
    const data = analizarMes(year, month);
    mostrarResultado(data);
    return data;
}

export function renderStaffingAnalysis(){
    return analizarStaffingMes(
        currentDate.getFullYear(),
        currentDate.getMonth()
    );
}

window.renderStaffingAnalysis = renderStaffingAnalysis;
