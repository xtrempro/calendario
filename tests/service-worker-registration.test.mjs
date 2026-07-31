import assert from "node:assert/strict";
import test from "node:test";

import {
    registerSupervisorServiceWorker
} from "../js/serviceWorkerRegistration.js";

class FakeServiceWorker extends EventTarget {
    constructor({ controlled = false } = {}) {
        super();
        this.controller = controlled ? {} : null;
        this.registerCalls = [];
        this.messages = [];
        this.updateCalls = 0;
        this.registration = {
            waiting: {
                postMessage: message => {
                    this.messages.push(message);
                }
            },
            update: async () => {
                this.updateCalls += 1;
            }
        };
    }

    register(scriptUrl, options) {
        this.registerCalls.push({ scriptUrl, options });
        return Promise.resolve(this.registration);
    }
}

function nextTask() {
    return new Promise(resolve => setImmediate(resolve));
}

test("registra el service worker sin usar cache HTTP para buscar actualizaciones", async () => {
    const windowRef = new EventTarget();
    const serviceWorker = new FakeServiceWorker();

    registerSupervisorServiceWorker({
        windowRef,
        navigatorRef: { serviceWorker }
    });

    windowRef.dispatchEvent(new Event("load"));
    await nextTask();

    assert.deepEqual(serviceWorker.registerCalls, [
        {
            scriptUrl: "/sw.js",
            options: { updateViaCache: "none" }
        }
    ]);
    assert.equal(serviceWorker.updateCalls, 1);
    assert.deepEqual(serviceWorker.messages, [
        { type: "TURNOPLUS_SKIP_WAITING" }
    ]);
});

test("recarga la PWA instalada cuando un service worker nuevo toma control", () => {
    const windowRef = new EventTarget();
    const serviceWorker = new FakeServiceWorker({ controlled: true });
    let reloads = 0;

    const destroy = registerSupervisorServiceWorker({
        windowRef,
        navigatorRef: { serviceWorker },
        locationRef: {
            reload: () => {
                reloads += 1;
            }
        }
    });

    serviceWorker.dispatchEvent(new Event("controllerchange"));
    serviceWorker.dispatchEvent(new Event("controllerchange"));

    assert.equal(reloads, 1);

    destroy();
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    assert.equal(reloads, 1);
});

test("no recarga durante la primera instalacion del service worker", () => {
    const windowRef = new EventTarget();
    const serviceWorker = new FakeServiceWorker();
    let reloads = 0;

    registerSupervisorServiceWorker({
        windowRef,
        navigatorRef: { serviceWorker },
        locationRef: {
            reload: () => {
                reloads += 1;
            }
        }
    });

    serviceWorker.dispatchEvent(new Event("controllerchange"));

    assert.equal(reloads, 0);
});
