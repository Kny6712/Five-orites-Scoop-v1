"use strict";
// payment-server/src/server.ts
// Five-orites Scoop — payment service entry point.
//
// This process exists because the Angular app cannot hold the Xendit secret
// key and the project cannot deploy Cloud Functions (Firebase Spark plan — see
// CUTOVER.md). It does exactly two things: mint a Xendit payment request for an
// order the caller owns, and receive Xendit's signed webhooks. Nothing else.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const config_1 = require("./config");
const firebase_1 = require("./firebase");
const xendit_1 = require("./xendit");
const routes_1 = require("./routes");
function main() {
    const config = (0, config_1.loadConfig)();
    if (config.useEmulator) {
        // Must be set BEFORE initFirebase so the Admin SDK dials localhost.
        process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080';
        process.env.FIREBASE_AUTH_EMULATOR_HOST ??= 'localhost:9099';
        console.log('[payment-server] Emulator mode: Firestore → localhost:8080, Auth → localhost:9099');
    }
    const { firestore, auth } = (0, firebase_1.initFirebase)(config);
    const xendit = new xendit_1.XenditClient(config.xenditSecretKey, config.xenditLive);
    const app = (0, express_1.default)();
    // ── CORS ────────────────────────────────────────────────────────────────────
    //
    // Scoped to the shop's own origins. The webhook route deliberately BYPASSES
    // this: Xendit's servers are not in the allowlist, they send no Origin
    // header, and CORS is a browser control that would not stop them anyway —
    // but a browser-driven request to the webhook from a hostile page would be
    // stopped by it, so the webhook is simply not registered through the CORS
    // handler at all.
    app.use((req, res, next) => {
        const origin = req.header('origin');
        if (origin && config.allowedOrigins.includes(origin.replace(/\/+$/, ''))) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
            res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        }
        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }
        next();
    });
    // The webhook's body MUST be parsed as JSON before the router, because
    // express.json() is what populates `req.body` and the token check runs
    // first thing inside the handler.
    app.use(express_1.default.json({ limit: '256kb' }));
    // A hard cap on body size. 256kb is far more than a payment webhook needs
    // (they are under 2kb) and it stops a flood of oversized bodies from being
    // buffered into memory before any check runs.
    app.use((req, res, next) => {
        if (req.method === 'POST' && req.is('application/json') === false && req.body) {
            // express.json() leaves the body unparsed for other content types; a
            // webhook or session call that is not JSON is a client bug worth naming.
            res.status(415).json({ error: 'expected_json' });
            return;
        }
        next();
    });
    app.use((0, routes_1.buildRouter)({ firestore, auth, xendit, config }));
    // Anything unmatched is a 404 rather than an express default HTML page, so a
    // misconfigured return URL or a typo'd webhook path is diagnosable from the
    // response alone.
    app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err, _req, res, _next) => {
        // The catch-all. An unhandled rejection inside a route would otherwise take
        // the process down mid-request and leave Xendit retrying against a dead
        // service. The error is logged server-side; the customer gets a generic
        // message and never a stack trace.
        console.error('[payment-server] Unhandled error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'internal_error', message: 'Something went wrong.' });
        }
    });
    app.listen(config.port, () => {
        console.log(`[payment-server] Listening on :${config.port} (${config.xenditLive ? 'LIVE' : 'TEST'} mode)`);
        console.log(`[payment-server] Return URL base: ${config.appBaseUrl}`);
        console.log(`[payment-server] Webhook endpoint: ${config.appBaseUrl}/… (register /payment/webhook)`);
    });
}
main();
//# sourceMappingURL=server.js.map