import {
    FIREBASE_CONFIG,
    FIREBASE_ENABLED,
    FIREBASE_SDK_BASE_URL
} from "./firebaseConfig.js";

let servicesPromise = null;

function hasConfigValue(value) {
    return Boolean(String(value || "").trim());
}

export function isFirebaseConfigured() {
    return Boolean(
        FIREBASE_ENABLED &&
        hasConfigValue(FIREBASE_CONFIG.apiKey) &&
        hasConfigValue(FIREBASE_CONFIG.authDomain) &&
        hasConfigValue(FIREBASE_CONFIG.projectId) &&
        hasConfigValue(FIREBASE_CONFIG.appId)
    );
}

async function loadFirebaseModule(name) {
    return import(`${FIREBASE_SDK_BASE_URL}/${name}.js`);
}

export async function getFirebaseServices() {
    if (!isFirebaseConfigured()) {
        throw new Error(
            "Firebase aun no esta configurado. Revisa js/firebaseConfig.js."
        );
    }

    if (!servicesPromise) {
        servicesPromise = Promise.all([
            loadFirebaseModule("firebase-app"),
            loadFirebaseModule("firebase-auth"),
            loadFirebaseModule("firebase-firestore"),
            loadFirebaseModule("firebase-storage")
        ]).then(([
            appModule,
            authModule,
            firestoreModule,
            storageModule
        ]) => {
            const app = appModule.initializeApp(FIREBASE_CONFIG);
            const auth = authModule.getAuth(app);
            const db = firestoreModule.getFirestore(app);
            const storage = storageModule.getStorage(app);
            const googleProvider =
                new authModule.GoogleAuthProvider();

            googleProvider.setCustomParameters({
                prompt: "select_account"
            });

            return {
                app,
                auth,
                db,
                storage,
                googleProvider,
                authModule,
                firestoreModule,
                storageModule
            };
        });
    }

    return servicesPromise;
}

export async function signInWithGoogle() {
    const {
        auth,
        authModule,
        googleProvider
    } = await getFirebaseServices();

    return authModule.signInWithPopup(auth, googleProvider);
}

export async function signOutFirebase() {
    const { auth, authModule } = await getFirebaseServices();

    return authModule.signOut(auth);
}

export async function onFirebaseAuthChanged(callback) {
    if (!isFirebaseConfigured()) {
        callback(null);
        return () => {};
    }

    const { auth, authModule } = await getFirebaseServices();

    return authModule.onAuthStateChanged(auth, callback);
}

