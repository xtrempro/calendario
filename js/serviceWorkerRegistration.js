export function registerSupervisorServiceWorker(options = {}) {
    const windowRef = options.windowRef || globalThis.window;
    const navigatorRef = options.navigatorRef || globalThis.navigator;
    const locationRef =
        options.locationRef ||
        windowRef?.location ||
        globalThis.location;
    const scriptUrl = options.scriptUrl || "/sw.js";
    const serviceWorker = navigatorRef?.serviceWorker;

    if (!serviceWorker?.register || !windowRef?.addEventListener) {
        return () => {};
    }

    const hadController = Boolean(serviceWorker.controller);
    let didReload = false;

    const reloadIfUpdatingInstalledApp = () => {
        if (!hadController || didReload) return;
        didReload = true;
        locationRef?.reload?.();
    };

    const handleControllerChange = () => {
        reloadIfUpdatingInstalledApp();
    };

    const handleLoad = () => {
        serviceWorker.register(scriptUrl, { updateViaCache: "none" })
            .then(registration => {
                if (registration.waiting?.postMessage) {
                    registration.waiting.postMessage({
                        type: "TURNOPLUS_SKIP_WAITING"
                    });
                }
                return registration.update?.();
            })
            .catch(() => {});
    };

    serviceWorker.addEventListener?.(
        "controllerchange",
        handleControllerChange
    );
    windowRef.addEventListener("load", handleLoad, { once: true });

    return () => {
        serviceWorker.removeEventListener?.(
            "controllerchange",
            handleControllerChange
        );
        windowRef.removeEventListener?.("load", handleLoad);
    };
}
