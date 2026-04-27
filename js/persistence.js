const LOCAL_DRIVER = "local";

let activeDriver = LOCAL_DRIVER;

// Persistence boundary: Firebase can later hydrate a cache and keep this API sync.
function storage() {
    if (typeof globalThis === "undefined") return null;
    return globalThis.localStorage || null;
}

function cloneFallback(fallback) {
    if (Array.isArray(fallback)) {
        return [...fallback];
    }

    if (fallback && typeof fallback === "object") {
        return { ...fallback };
    }

    return fallback;
}

function parseJSON(raw, fallback) {
    if (raw === null || raw === undefined) {
        return cloneFallback(fallback);
    }

    try {
        const parsed = JSON.parse(raw);

        return parsed ?? cloneFallback(fallback);
    } catch {
        return cloneFallback(fallback);
    }
}

export function getStorageDriver() {
    return activeDriver;
}

export function configureStorageDriver(driver = LOCAL_DRIVER) {
    activeDriver = driver || LOCAL_DRIVER;
}

export function getRaw(key, fallback = null) {
    const store = storage();
    if (!store) return fallback;

    const value = store.getItem(key);
    return value === null ? fallback : value;
}

export function setRaw(key, value) {
    const store = storage();
    if (!store) return;

    store.setItem(key, String(value));
}

export function removeKey(key) {
    const store = storage();
    if (!store) return;

    store.removeItem(key);
}

export function getJSON(key, fallback = {}) {
    return parseJSON(getRaw(key, null), fallback);
}

export function setJSON(key, value) {
    setRaw(key, JSON.stringify(value));
}

export function getNumber(key, fallback = 0) {
    const raw = getRaw(key, null);
    if (raw === null) return fallback;

    const value = Number(raw);

    return Number.isFinite(value) ? value : fallback;
}

export function listKeys(prefix = "") {
    const store = storage();
    if (!store) return [];

    const keys = [];

    for (let i = 0; i < store.length; i++) {
        const key = store.key(i);

        if (key && (!prefix || key.startsWith(prefix))) {
            keys.push(key);
        }
    }

    return keys;
}

export function moveKey(oldKey, newKey) {
    const value = getRaw(oldKey, null);
    if (value === null) return;

    setRaw(newKey, value);
    removeKey(oldKey);
}
