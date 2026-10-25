"use strict";
// payment-server/src/config.ts
// Five-orites Scoop — payment service configuration.
//
// WHY THIS FILE IS PARANOID. This is the ONE process in the project that holds
// the Xendit secret key. If it starts without the key it must refuse to serve,
// not fall back to an empty string and then send `Authorization: Basic ` to
// Xendit — which fails with a 401 that looks, to whoever is reading the logs,
// like a Xendit outage rather than a missing variable. Failing loudly at boot
// is the cheapest possible diagnostic.
//
// Nothing here is ever sent to the browser. The Angular bundle gets only
// `environment.paymentBaseUrl` and the public app URL; the secret key and the
// webhook token never leave this process.
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = void 0;
require("dotenv/config");
function required(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`[payment-server] Missing required environment variable ${name}.\n` +
            `Copy payment-server/.env.example to payment-server/.env and fill it in.`);
    }
    return value;
}
/**
 * Optional, with a default, for the values that are safe to guess locally.
 *
 * `XENDIT_WEBHOOK_TOKEN` is deliberately NOT one of them. An empty token would
 * make the webhook accept any caller, and the webhook is the endpoint that
 * marks orders paid — so a missing token has to be a boot failure, not a
 * permissive default.
 */
function optional(name, fallback) {
    return process.env[name]?.trim() || fallback;
}
function loadConfig() {
    const rawPort = optional('PORT', '4242');
    const port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`[payment-server] PORT must be a valid TCP port, got "${rawPort}".`);
    }
    const liveRaw = optional('XENDIT_LIVE', 'false').toLowerCase();
    if (liveRaw !== 'true' && liveRaw !== 'false') {
        throw new Error(`[payment-server] XENDIT_LIVE must be "true" or "false", got "${liveRaw}".`);
    }
    // The webhook token is required in BOTH modes. Test mode marks test orders
    // paid, and a permissive test mode is how a permissive production mode gets
    // written — the same code path, the same missing check.
    const xenditSecretKey = required('XENDIT_SECRET_KEY');
    const xenditWebhookToken = required('XENDIT_WEBHOOK_TOKEN');
    // BOTH key formats are recognised: Xendit renamed its prefixes — live keys
    // used to be `production_…` and are now `xnd_production_…`. Checking only the
    // legacy prefix would refuse a perfectly valid LIVE key at boot, and the
    // refusal would surface for the first time at cutover, where the tempting
    // "fix" is loosening the check to `startsWith('xnd_')` — which would then
    // accept `xnd_development_` too, i.e. exactly the test key this guard exists
    // to block. Two exact prefixes, never a shared one.
    const looksLive = xenditSecretKey.startsWith('production_') ||
        xenditSecretKey.startsWith('xnd_production_');
    if (liveRaw === 'true' && !looksLive) {
        throw new Error('[payment-server] XENDIT_LIVE=true but XENDIT_SECRET_KEY does not look like a live ' +
            'key (expected the "production_" or "xnd_production_" prefix). ' +
            'Refusing to charge real money with a test key.');
    }
    const useEmulator = optional('USE_EMULATOR', 'false').toLowerCase() === 'true';
    return {
        port,
        xenditSecretKey,
        xenditWebhookToken,
        xenditLive: liveRaw === 'true',
        appBaseUrl: optional('APP_BASE_URL', 'http://localhost:8100').replace(/\/+$/, ''),
        allowedOrigins: optional('ALLOWED_ORIGINS', 'http://localhost:8100,http://localhost:8200')
            .split(',')
            .map((o) => o.trim().replace(/\/+$/, ''))
            .filter(Boolean),
        useEmulator,
    };
}
exports.loadConfig = loadConfig;
//# sourceMappingURL=config.js.map