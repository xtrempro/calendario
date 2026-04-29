/* ======================================================
   UI ENGINE
   Todo lo visual (labels, colores, clases)
====================================================== */

import {
   TURNO_LABEL,
   TURNO_CLASS
} from "./constants.js";

/* ==========================================
   LABEL DE TURNO
========================================== */

export function turnoLabel(state){
   return TURNO_LABEL[state] || "";
}

export function aplicarClaseTurno(div,state){
   const clase = TURNO_CLASS[state];
   if(clase) div.classList.add(clase);
}

let sidePanelSyncFrame = 0;

export function syncTurnosSidePanelHeight(){
   if(sidePanelSyncFrame){
      cancelAnimationFrame(sidePanelSyncFrame);
   }

   sidePanelSyncFrame = requestAnimationFrame(() => {
      sidePanelSyncFrame = 0;

      const root = document.documentElement;
      const leavePanel = document.getElementById("leavePanel");
      const staffingPanel = document.getElementById("staffingReportPanel");
      const isDesktop = window.matchMedia("(min-width: 1101px)").matches;
      const isTurnosView = document.body.dataset.activeView === "turnos";

      if(
         !leavePanel ||
         !staffingPanel ||
         !isDesktop ||
         !isTurnosView ||
         leavePanel.offsetParent === null ||
         staffingPanel.offsetParent === null
      ){
         root.style.removeProperty("--turnos-side-panel-height");
         return;
      }

      root.style.setProperty(
         "--turnos-side-panel-height",
         `${Math.ceil(leavePanel.getBoundingClientRect().height)}px`
      );
   });
}

export function initTurnosSidePanelSync(){
   syncTurnosSidePanelHeight();
   window.addEventListener("resize", syncTurnosSidePanelHeight);

   const leavePanel = document.getElementById("leavePanel");
   if(!leavePanel || typeof ResizeObserver === "undefined") return;

   const observer = new ResizeObserver(() => {
      syncTurnosSidePanelHeight();
   });

   observer.observe(leavePanel);
}
