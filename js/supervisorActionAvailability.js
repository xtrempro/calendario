export const MOVE_SHIFT_HOSTS = new Set([
    "calendarioturnos-7c4d9.web.app",
    "calendarioturnos-7c4d9.firebaseapp.com",
    "turnoplus-test-7c4d9.web.app",
    "turnoplus-test-7c4d9.firebaseapp.com"
]);

export function isLocalDevelopmentHost(hostname = "") {
    const normalized = String(hostname || "").toLowerCase();

    return (
        !normalized ||
        normalized === "localhost" ||
        normalized === "127.0.0.1" ||
        normalized === "::1"
    );
}

export function isTurnoPlusHost(hostname = "") {
    const normalized = String(hostname || "").toLowerCase();

    return (
        normalized === "turnoplus.cl" ||
        normalized.endsWith(".turnoplus.cl")
    );
}

export function isMoveShiftAvailable(windowRef = globalThis.window) {
    const hostname =
        String(windowRef?.location?.hostname || "").toLowerCase();

    return (
        isTurnoPlusHost(hostname) ||
        MOVE_SHIFT_HOSTS.has(hostname) ||
        isLocalDevelopmentHost(hostname)
    );
}
