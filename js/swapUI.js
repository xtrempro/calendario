import {
    cambiosDelMes,
    registrarCambio
} from "./swaps.js";
import {
    getCurrentProfile,
    getProfiles,
    getRotativa,
    getSwaps
} from "./storage.js";
import { refreshAll } from "./refresh.js";
import { pushHistory } from "./history.js";
import { getTurnoBase } from "./turnEngine.js";

let fechaCambioSeleccionada = "";
let fechaDevolucionSeleccionada = "";
let swapDate = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
);

function parseInputDate(value){
    const parts = value.split("-");
    return new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2])
    );
}

function formatFecha(fechaStr){
    const parts = fechaStr.split("-");
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function getBaseState(nombre, year, month, day = 1){
    const key = `${year}-${month}-${day}`;
    const turno = getTurnoBase(nombre, key);

    return turno ? turno : null;
}

function getPerfil(nombre) {
    return getProfiles().find(
        profile => profile.name === nombre
    ) || null;
}

function esRotativaDiurna(nombre) {
    return getRotativa(nombre).type === "diurno";
}

function esTurnoIntercambiable(turno) {
    const base = Number(turno) || 0;

    return base === 1 || base === 2;
}

function codigoTurno(valor){
    const turno = Number(valor) || 0;

    if (turno === 2) return "N";
    if (turno === 1) return "L";

    return "";
}

function mismaRotativa(nombre1, nombre2){
    const y = swapDate.getFullYear();
    const m = swapDate.getMonth();

    let iguales = 0;
    let comparados = 0;

    for (let d = 1; d <= 20; d++) {
        const a = getBaseState(nombre1, y, m, d);
        const b = getBaseState(nombre2, y, m, d);

        if (a === null || b === null) continue;

        comparados++;

        if (a === b) iguales++;
    }

    if (comparados < 4) return false;

    return iguales === comparados;
}

function getTrabajadoresDisponibles(nombreFrom) {
    const perfilFrom = getPerfil(nombreFrom);

    if (!perfilFrom) return [];

    return getProfiles().filter(profile =>
        profile.name !== nombreFrom &&
        profile.estamento === perfilFrom.estamento &&
        !esRotativaDiurna(profile.name) &&
        !mismaRotativa(nombreFrom, profile.name)
    );
}

function getSwapYear(){
    return swapDate.getFullYear();
}

function getSwapMonth(){
    return swapDate.getMonth();
}

function formatSwapMonth(){
    return swapDate
        .toLocaleString(
            "es-CL",
            {
                month: "long",
                year: "numeric"
            }
        )
        .toUpperCase();
}

function cambiarMesSwap(offset){
    swapDate = new Date(
        getSwapYear(),
        getSwapMonth() + offset,
        1
    );

    fechaCambioSeleccionada = "";
    fechaDevolucionSeleccionada = "";

    renderSwapPanel();
}

function toISO(date){
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function keyISO(key){
    const parts = key.split("-");
    return `${parts[0]}-${String(Number(parts[1]) + 1).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`;
}

function textoTurno(turno){
    if (turno === 1) return "L";
    if (turno === 2) return "N";
    if (turno === 3) return "24";
    if (turno === 4) return "D";
    if (turno === 5) return "D+N";

    return "";
}

function getProfileMap(prefix, nombre) {
    return JSON.parse(
        localStorage.getItem(`${prefix}_${nombre}`)
    ) || {};
}

function fechaDisponible(nombre, key, turno){
    if (!esTurnoIntercambiable(turno)) return false;

    const swaps = getSwaps();

    if (
        swaps.some(swap =>
            (swap.from === nombre || swap.to === nombre) &&
            (
                swap.fecha === keyISO(key) ||
                swap.devolucion === keyISO(key)
            )
        )
    ) {
        return false;
    }

    if (getProfileMap("admin", nombre)[key]) return false;
    if (getProfileMap("legal", nombre)[key]) return false;
    if (getProfileMap("comp", nombre)[key]) return false;
    if (getProfileMap("absences", nombre)[key]) return false;

    return true;
}

export function renderSwapPanel(){
    const box = document.getElementById("swapPanel");
    if (!box) return;

    const perfiles = getProfiles();
    const selectedFrom = getCurrentProfile();
    const previousTo =
        document.getElementById("swapTo")?.value || "";
    const perfilFrom = getPerfil(selectedFrom);

    if (!selectedFrom || !perfilFrom) {
        box.innerHTML = `
            <div class="section-head">
                <h3>Cambios de Turno</h3>
            </div>
            <div class="empty-state">
                Selecciona un trabajador para revisar cambios de turno.
            </div>
        `;
        return;
    }

    if (esRotativaDiurna(selectedFrom)) {
        box.innerHTML = `
            <div class="section-head">
                <h3>Cambios de Turno</h3>
            </div>
            <div class="empty-state">
                ${selectedFrom} tiene rotativa Diurno, por lo que no puede intercambiar turnos.
            </div>
        `;
        return;
    }

    if (perfiles.length < 2) {
        box.innerHTML = `
            <div class="section-head">
                <h3>Cambios de Turno</h3>
            </div>
            <div class="empty-state">
                Necesitas al menos dos colaboradores para registrar cambios de turno.
            </div>
        `;
        return;
    }

    const options = getTrabajadoresDisponibles(
        selectedFrom
    )
        .map(profile => `
            <option
                value="${profile.name}"
                ${profile.name === previousTo ? "selected" : ""}
            >
                ${profile.name}
            </option>
        `)
        .join("");

    box.innerHTML = `
        <div class="section-head">
            <h3>Cambios de Turno</h3>
        </div>

        <div class="swap-monthbar">
            <button id="swapPrevMonth" class="swap-month-button" type="button" aria-label="Mes anterior">
                &lt;
            </button>

            <strong id="swapMonthLabel">${formatSwapMonth()}</strong>

            <button id="swapNextMonth" class="swap-month-button" type="button" aria-label="Mes siguiente">
                &gt;
            </button>
        </div>

        <div class="swap-row">
            <label class="field-stack">
                <span>Entrega turno</span>
                <div id="swapFromLabel" class="swap-readonly-worker">
                    ${selectedFrom}
                </div>
            </label>

            <label class="field-stack">
                <span>Recibe turno</span>
                <select id="swapTo">
                    ${options}
                </select>
            </label>

            <div class="mini-wrap">
                <label>Fecha de cambio</label>
                <div id="swapCalendar1"></div>
            </div>

            <div class="mini-wrap">
                <label>Fecha de devolución</label>
                <div id="swapCalendar2"></div>
            </div>

            <button id="saveSwapBtn" class="primary-button primary-button--wide" type="button">
                Registrar cambio
            </button>
        </div>

        <div id="swapList"></div>
    `;

    document.getElementById("swapPrevMonth").onclick =
        () => cambiarMesSwap(-1);

    document.getElementById("swapNextMonth").onclick =
        () => cambiarMesSwap(1);

    document.getElementById("saveSwapBtn").onclick =
        guardarCambioTurno;

    document.getElementById("swapTo").onchange =
        renderMiniCalendarios;

    actualizarSwapTo(previousTo);
    renderSwapList();
    renderMiniCalendarios();
}

window.renderSwapPanel = renderSwapPanel;

function renderMiniCalendarios(){
    const from = getCurrentProfile();
    const to = document.getElementById("swapTo")?.value;

    if (!from || !to) return;

    renderMiniCalendar(
        "swapCalendar1",
        from,
        true
    );

    renderMiniCalendar(
        "swapCalendar2",
        to,
        false
    );
}

function renderMiniCalendar(id, trabajador, esCambio){
    const div = document.getElementById(id);
    if (!div) return;

    const y = getSwapYear();
    const m = getSwapMonth();
    const days = new Date(y, m + 1, 0).getDate();

    let html = `<div class="mini-grid">`;

    for (let d = 1; d <= days; d++) {
        const fecha = new Date(y, m, d);

        const key = `${y}-${m}-${d}`;
        const turnoBase = getTurnoBase(trabajador, key);
        const valido = fechaDisponible(
            trabajador,
            key,
            turnoBase
        );

        let clase = "mini-off";

        if (valido) clase = "mini-on";

        const seleccionada = esCambio
            ? fechaCambioSeleccionada === toISO(fecha)
            : fechaDevolucionSeleccionada === toISO(fecha);

        if (seleccionada) {
            clase = "mini-selected";
        }

        html += `
            <div
                class="mini-day ${clase}"
                data-fecha="${toISO(fecha)}"
                data-tipo="${esCambio ? 1 : 2}"
            >
                <span>${d}</span>
                <small>${textoTurno(turnoBase)}</small>
            </div>
        `;
    }

    html += `</div>`;

    div.innerHTML = html;

    div.querySelectorAll(".mini-on, .mini-selected")
        .forEach(item => {
            item.onclick = () => {
                const fecha = item.dataset.fecha;

                if (item.dataset.tipo === "1") {
                    fechaCambioSeleccionada = fecha;
                } else {
                    fechaDevolucionSeleccionada = fecha;
                }

                renderMiniCalendarios();
            };
        });
}

function actualizarSwapTo(preferredTo = ""){
    const from = getCurrentProfile();
    const toSelect = document.getElementById("swapTo");

    if (!from || !toSelect) return;

    const filtrados = getTrabajadoresDisponibles(from);

    const selectedTo =
        filtrados.some(profile => profile.name === preferredTo)
            ? preferredTo
            : filtrados[0]?.name || "";

    toSelect.innerHTML = filtrados
        .map(profile => `
            <option
                value="${profile.name}"
                ${profile.name === selectedTo ? "selected" : ""}
            >
                ${profile.name}
            </option>
        `)
        .join("");

    if (!filtrados.length) {
        toSelect.disabled = true;

        const saveButton =
            document.getElementById("saveSwapBtn");

        if (saveButton) {
            saveButton.disabled = true;
        }

        document.getElementById("swapCalendar1").innerHTML = `
            <div class="empty-state empty-state--compact">
                No hay colegas compatibles para este cambio.
            </div>
        `;

        document.getElementById("swapCalendar2").innerHTML = `
            <div class="empty-state empty-state--compact">
                Ajusta la selección para continuar.
            </div>
        `;
        return;
    }

    toSelect.disabled = false;

    const saveButton =
        document.getElementById("saveSwapBtn");

    if (saveButton) {
        saveButton.disabled = false;
    }
}

function renderSwapList(){
    const div = document.getElementById("swapList");
    if (!div) return;

    const swaps = cambiosDelMes(
        getSwapYear(),
        getSwapMonth()
    );

    if (!swaps.length) {
        div.innerHTML = `
            <div class="empty-state empty-state--compact">
                No hay cambios de turno registrados en ${formatSwapMonth().toLowerCase()}.
            </div>
        `;
        return;
    }

    div.innerHTML = swaps
        .slice()
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .map(swap => `
            <div class="swap-item">
                ${swap.from} -> ${swap.to}
                (${formatFecha(swap.fecha)})
                | devolución ${formatFecha(swap.devolucion)}
            </div>
        `)
        .join("");
}

function guardarCambioTurno(){
    const from = getCurrentProfile();
    const to = document.getElementById("swapTo")?.value;
    const fecha = fechaCambioSeleccionada;
    const devolucion = fechaDevolucionSeleccionada;

    if (!from || !to || !fecha || !devolucion) {
        alert("Completa todos los campos.");
        return;
    }

    if (from === to) {
        alert("El cambio debe ser entre trabajadores distintos.");
        return;
    }

    const f1 = parseInputDate(fecha);
    const f2 = parseInputDate(devolucion);

    if (
        f1.getFullYear() !== f2.getFullYear() ||
        f1.getMonth() !== f2.getMonth()
    ) {
        alert("Ambas fechas deben pertenecer al mismo mes.");
        return;
    }

    if (
        f1.getFullYear() !== getSwapYear() ||
        f1.getMonth() !== getSwapMonth()
    ) {
        alert("Las fechas deben pertenecer al mes visualizado.");
        return;
    }

    const perfilFrom = getPerfil(from);
    const perfilTo = getPerfil(to);

    if (
        !perfilFrom ||
        !perfilTo ||
        perfilFrom.estamento !== perfilTo.estamento
    ) {
        alert("Solo se pueden intercambiar turnos entre trabajadores del mismo estamento.");
        return;
    }

    if (
        esRotativaDiurna(from) ||
        esRotativaDiurna(to)
    ) {
        alert("Los trabajadores con rotativa Diurno no pueden intercambiar turnos.");
        return;
    }

    if (mismaRotativa(from, to)) {
        alert("No se puede intercambiar con un trabajador que tiene la misma rotativa base.");
        return;
    }

    const turnoFrom = getBaseState(
        from,
        f1.getFullYear(),
        f1.getMonth(),
        f1.getDate()
    );

    const turnoTo = getBaseState(
        to,
        f2.getFullYear(),
        f2.getMonth(),
        f2.getDate()
    );

    if (!esTurnoIntercambiable(turnoFrom)) {
        alert(`${from} solo puede entregar turnos base Larga o Noche.`);
        return;
    }

    if (!esTurnoIntercambiable(turnoTo)) {
        alert(`${to} solo puede devolver turnos base Larga o Noche.`);
        return;
    }

    registrarCambio({
        from,
        to,
        fecha,
        devolucion,
        turno: codigoTurno(turnoFrom),
        turnoDevuelto: codigoTurno(turnoTo),
        year: f1.getFullYear(),
        month: f1.getMonth()
    });

    pushHistory();

    fechaCambioSeleccionada = "";
    fechaDevolucionSeleccionada = "";

    refreshAll();
    alert("Cambio registrado.");
}
