"use strict";
// payment-server/src/firebase.ts
// Five-orites Scoop — Admin SDK bootstrap for the payment service.
//
// WHY A SEPARATE COPY OF THE PRICING AND VOUCHER RULES. The Angular app's
// versions live behind `@core/...` path aliases and import Angular types; this
// service cannot reach them, and `functions/src/config.ts` is the same story
// (it also cannot be deployed — the project is on Spark). So the delivery
// constants are duplicated here, exactly as the plan describes, and this file
// says so rather than pretending it is the only copy.
Object.defineProperty(exports, "__esModule", { value: true });
exports.initFirebase = exports.getDeliveryFee = exports.FREE_DELIVERY_THRESHOLD = exports.DELIVERY_FEE = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/**
 * Duplicated from `src/app/core/logic/delivery.ts`. A test in the main app
 * asserts the two client/server copies stay in sync; this is the third copy and
 * it is checked by `repriceOrder` below, which recomputes the delivery fee from
 * these constants rather than trusting the number on the order document.
 */
exports.DELIVERY_FEE = 50;
exports.FREE_DELIVERY_THRESHOLD = 500;
function getDeliveryFee(subtotal) {
    return subtotal >= exports.FREE_DELIVERY_THRESHOLD ? 0 : exports.DELIVERY_FEE;
}
exports.getDeliveryFee = getDeliveryFee;
/**
 * Initializes the Admin SDK once per process.
 *
 * Emulator mode is the interesting branch: `initializeApp` without credentials
 * and with `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` already
 * exported by the caller (see server.ts) means no service-account key is ever
 * read. That is what lets `npm run dev:emulator` run the whole payment flow on a
 * laptop with no Firebase project at all.
 */
function initFirebase(config) {
    const existing = (0, app_1.getApps)()[0];
    if (config.useEmulator) {
        // The emulators accept any project id; `demo-` is the documented convention
        // and makes an accidental production call fail loudly.
        const app = existing ??
            (0, app_1.initializeApp)({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'demo-five-orites-scoop' });
        return { firestore: (0, firestore_1.getFirestore)(app), auth: (0, auth_1.getAuth)(app) };
    }
    // Production-ish: prefer a mounted service account (Render/Railway/Fly all
    // mount one, or set GOOGLE_APPLICATION_CREDENTIALS), and fall back to
    // applicationDefault() which also picks up a mounted key. An explicit
    // FIREBASE_SERVICE_ACCOUNT=path is supported for local runs against the real
    // project — the path, never the JSON itself, is what goes in an env file.
    const app = existing ??
        (() => {
            const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
            if (keyPath && (0, node_fs_1.existsSync)((0, node_path_1.resolve)(keyPath))) {
                const json = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(keyPath), 'utf8'));
                return (0, app_1.initializeApp)({ credential: (0, app_1.cert)(json) });
            }
            return (0, app_1.initializeApp)({ credential: (0, app_1.applicationDefault)() });
        })();
    return { firestore: (0, firestore_1.getFirestore)(app), auth: (0, auth_1.getAuth)(app) };
}
exports.initFirebase = initFirebase;
//# sourceMappingURL=firebase.js.map