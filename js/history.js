import { getCurrentProfile } from "./storage.js";

let undoStack = [];
let redoStack = [];

function key(nombre,tipo){
    return tipo + "_" + nombre;
}

function snapshot(){

    const p = getCurrentProfile();
    if(!p) return null;

    return {
        data: localStorage.getItem(key(p,"data")),
        admin: localStorage.getItem(key(p,"admin")),
        legal: localStorage.getItem(key(p,"legal")),
        comp: localStorage.getItem(key(p,"comp")),
        leaveBalances: localStorage.getItem(
            key(p,"leaveBalances")
        ),
        abs: localStorage.getItem(key(p,"absences")),
        blocked: localStorage.getItem(key(p,"blocked")),
        shift: localStorage.getItem(key(p,"shift"))
    };
}

function restore(state){

    const p = getCurrentProfile();
    if(!p || !state) return;

    localStorage.setItem(key(p,"data"), state.data || "{}");
    localStorage.setItem(key(p,"admin"), state.admin || "{}");
    localStorage.setItem(key(p,"legal"), state.legal || "{}");
    localStorage.setItem(key(p,"comp"), state.comp || "{}");
    localStorage.setItem(
        key(p,"leaveBalances"),
        state.leaveBalances || "{}"
    );
    localStorage.setItem(key(p,"absences"), state.abs || "{}");
    localStorage.setItem(key(p,"blocked"), state.blocked || "{}");
    localStorage.setItem(key(p,"shift"), state.shift || "false");
}

export function pushHistory(){

    undoStack.push(snapshot());

    if(undoStack.length > 50){
        undoStack.shift();
    }

    redoStack = [];
}

export function undo(){

    if(!undoStack.length) return false;

    const current = snapshot();
    redoStack.push(current);

    const prev = undoStack.pop();

    restore(prev);

    return true;
}

export function redo(){

    if(!redoStack.length) return false;

    const current = snapshot();
    undoStack.push(current);

    const next = redoStack.pop();

    restore(next);

    return true;
}
