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

import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `[payment-server] Missing required environment variable ${name}.\n` +
        `Copy payment-server/.env.example to payment-server/.env and fill it in.`,
    );
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
function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export interface PaymentConfig {
  /** TCP port the service listens on. */
  port: number;
  /**
   * Xendit secret key. Test keys start with `dance_development_`, live keys
   * with `production_`. Backend only.
   */
  xenditSecretKey: string;
  /** Compared, byte for byte, against the `x-callback-token` webhook header. */
  xenditWebhookToken: string;
  /** `false` (test mode) or `true` (live). Decides which Xendit host we call. */
  xenditLive: boolean;
  /**
   * Public base URL of the Angular app, used to build the three return URLs
   * Xendit redirects the customer back to. Must be reachable by the customer's
   * browser — `http://localhost:8100` only works on the machine running it.
   *
   * Trailing slashes are stripped so `new URL(path, base)` cannot silently
   * swallow the first path segment.
   */
  appBaseUrl: string;
  /**
   * Origins allowed to call POST /payment/session. The Angular dev server and
   * the deployed hosting origin, comma separated.
   *
   * This is a CORS allowlist rather than `*` because the endpoint carries a
   * Firebase ID token and creates payment sessions: it should answer only to
   * the shop's own pages. It is not the security boundary — the ID-token
   * verification is — but there is no reason to let a random third-party page
   * drive it either.
   */
  allowedOrigins: string[];
  /**
   * When true, Firestore and Auth are pointed at the local emulators and the
   * service account is never loaded. This is what makes `npm run dev:emulator`
   * end to end without a real Firebase project.
   */
  useEmulator: boolean;
}

export function loadConfig(): PaymentConfig {
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

  if (liveRaw === 'true' && !xenditSecretKey.startsWith('production_')) {
    throw new Error(
      '[payment-server] XENDIT_LIVE=true but XENDIT_SECRET_KEY does not look like a live ' +
        'key (expected the "production_" prefix). Refusing to charge real money with a test key.',
    );
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
