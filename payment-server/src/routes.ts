// payment-server/src/routes.ts
// Five-orites Scoop — the two endpoints this service exists for.
//
//   POST /payment/session   create a Xendit payment request for an order
//   POST /payment/webhook   receive Xendit's signed payment notifications
//
// The session route is behind Firebase ID-token auth and only ever charges the
// order's OWN recomputed total. The webhook route is behind the Xendit callback
// token and is the ONLY writer of `paymentStatus` in the whole system.

import { Router, type Request, type Response } from 'express';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import type { PaymentConfig } from './config';
import type { XenditClient, XenditWebhookPayload, XenditChannelCode } from './xendit';
import { isAllowedChannel, XenditApiError } from './xendit';
import { repriceOrder, RepriceError, type OrderDoc } from './reprice';
import { requireAuth } from './auth';

/** Payment states the order document may hold. Mirrors the client model. */
type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface RouteDeps {
  firestore: Firestore;
  auth: Auth;
  xendit: XenditClient;
  config: PaymentConfig;
}

export function buildRouter(deps: RouteDeps): Router {
  const router = Router();

  router.post(
    '/payment/session',
    requireAuth(deps.auth),
    (req, res) => void createSession(req, res, deps),
  );

  // No auth middleware: Xendit calls this, and it proves itself with the
  // callback token instead. It must stay reachable from the public internet.
  router.post('/payment/webhook', (req, res) => void handleWebhook(req, res, deps));

  // Liveness only. It must not touch Firestore, or a hung database would look
  // like a dead process to a platform health check and restart it mid-request.
  router.get('/health', (_req, res) => res.json({ ok: true, service: 'payment-server' }));

  return router;
}

// ── POST /payment/session ─────────────────────────────────────────────────────

/**
 * Body: `{ orderId, channelCode }`. Nothing else is accepted, and nothing else
 * is needed — the amount comes from the order document, never from the caller.
 */
async function createSession(req: Request, res: Response, deps: RouteDeps): Promise<void> {
  const uid = req.uid;
  if (!uid) {
    // Unreachable when the router is mounted correctly; kept because a
    // mis-mounted router that skips the middleware should fail closed rather
    // than fall through to an unauthenticated charge.
    res.status(401).json({ error: 'missing_token' });
    return;
  }

  const { orderId, channelCode } = (req.body ?? {}) as {
    orderId?: unknown;
    channelCode?: unknown;
  };

  if (typeof orderId !== 'string' || !orderId.trim()) {
    res.status(400).json({ error: 'invalid_order', message: 'An order id is required.' });
    return;
  }
  if (!isAllowedChannel(channelCode)) {
    res.status(400).json({
      error: 'invalid_channel',
      message: 'Choose GCash, PayMaya or GrabPay to pay.',
    });
    return;
  }
  const channel = channelCode as XenditChannelCode;

  const orderRef = deps.firestore.doc(`orders/${orderId}`);
  const snap = await orderRef.get();

  // 404 rather than 403 for someone else's order: confirming that an order id
  // exists is itself a small leak, and the caller has no legitimate reason to
  // know it.
  if (!snap.exists) {
    res.status(404).json({ error: 'not_found', message: 'That order could not be found.' });
    return;
  }
  const order = snap.data() as OrderDoc;

  if (order.customerId !== uid) {
    res.status(404).json({ error: 'not_found', message: 'That order could not be found.' });
    return;
  }

  // ── Lifecycle guards ────────────────────────────────────────────────────────
  if (order.status === 'cancelled') {
    res.status(409).json({
      error: 'order_closed',
      message: 'This order was cancelled and can no longer be paid.',
    });
    return;
  }
  if (order.status === 'delivered') {
    res.status(409).json({ error: 'order_closed', message: 'This order is already complete.' });
    return;
  }
  if (order.paymentStatus === 'paid') {
    // Idempotent-by-refusal, and the most important guard here: a customer who
    // taps Pay Now twice must never be charged twice. `paid` is only ever
    // written by the verified webhook, so reaching this line means Xendit
    // already told us the money arrived.
    res.status(409).json({ error: 'already_paid', message: 'This order is already paid.' });
    return;
  }

  // ── Re-price, server-side ───────────────────────────────────────────────────
  let priced;
  try {
    priced = await repriceOrder(deps.firestore, order);
  } catch (err) {
    if (err instanceof RepriceError) {
      // 409, not 400: the request was well formed, the ORDER is what stopped it.
      console.warn(`[payment-server] Order ${orderId} could not be priced: ${err.detail}`);
      res.status(409).json({ error: 'cannot_price', message: err.userMessage });
      return;
    }
    throw err;
  }

  if (priced.grandTotal <= 0) {
    res.status(409).json({
      error: 'cannot_price',
      message: 'This order has nothing to pay for.',
    });
    return;
  }

  if (priced.mismatch) {
    // THE CHARGE FOLLOWS THE RECOMPUTED TOTAL, and the document is corrected to
    // match. The alternative — charging the stored number — is how a tampered
    // client becomes a wrong bill. Recording the correction makes it visible
    // rather than silently absorbed.
    console.warn(
      `[payment-server] Order ${orderId}: stored grandTotal ${order.grandTotal} disagreed ` +
        `with recomputed ${priced.grandTotal}. Charging the recomputed figure.`,
    );
  }

  const returnUrls = buildReturnUrls(deps.config, orderId);

  let result;
  try {
    result = await deps.xendit.createPaymentRequest({
      referenceId: orderId,
      amount: priced.grandTotal,
      channelCode: channel,
      ...returnUrls,
      description: `Five-orites Scoop order #${orderId.slice(-6).toUpperCase()}`,
    });
  } catch (err) {
    if (err instanceof XenditApiError) {
      console.error(
        `[payment-server] Xendit rejected order ${orderId}: ` +
          `status=${err.status} code=${err.code ?? 'none'}`,
      );
      res.status(502).json({
        error: 'xendit_error',
        message: 'We could not start your payment. Please try again in a moment.',
      });
      return;
    }
    throw err;
  }

  // Persist FIRST, then answer. If this write fails the customer is never sent
  // to a checkout page whose order we cannot find — a paid order with no
  // `paymentRequestId` is un-reconcilable, and an abandoned redirect is merely
  // annoying.
  await orderRef.update({
    paymentRequestId: result.paymentRequestId,
    paymentMethod: channel,
    // A retry must not inherit a stale FAILED. It goes back to pending so the
    // webhook has one honest state to move out of.
    ...(order.paymentStatus === 'failed'
      ? { paymentStatus: 'pending' satisfies PaymentStatus }
      : {}),
    // Correct the stored total when the recomputation disagreed, so the tracker
    // and the dashboard show the figure that was actually charged.
    ...(priced.mismatch
      ? {
          totalAmount: priced.totalAmount,
          discountAmount: priced.discountAmount,
          deliveryFee: priced.deliveryFee,
          grandTotal: priced.grandTotal,
        }
      : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });

  res.json({
    orderId,
    checkoutUrl: result.checkoutUrl,
    paymentRequestId: result.paymentRequestId,
    amount: priced.grandTotal,
  });
}

/**
 * The three URLs Xendit sends the customer back to.
 *
 * Query parameters, not a separate route, because the app is a single-page app
 * behind an auth guard: `/cart?payment=success&orderId=…` lands on a page the
 * customer can already reach, and the parameter only decides WHICH SCREEN is
 * shown. It is never treated as proof of payment — that is the webhook's job,
 * and the cart page polls the order document rather than believing the URL.
 */
function buildReturnUrls(
  config: PaymentConfig,
  orderId: string,
): {
  successReturnUrl: string;
  failureReturnUrl: string;
  cancelReturnUrl: string;
} {
  const base = new URL('/cart', config.appBaseUrl);
  const short = orderId.slice(-6).toUpperCase();
  return {
    successReturnUrl: withParams(base, { payment: 'success', orderId, ref: short }),
    failureReturnUrl: withParams(base, { payment: 'failed', orderId, ref: short }),
    cancelReturnUrl: withParams(base, { payment: 'cancelled', orderId, ref: short }),
  };
}

function withParams(base: URL, params: Record<string, string>): string {
  const url = new URL(base.toString());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// ── POST /payment/webhook ─────────────────────────────────────────────────────

async function handleWebhook(req: Request, res: Response, deps: RouteDeps): Promise<void> {
  // ── 1. Verify the sender, BEFORE reading the body ───────────────────────────
  const token = req.header('x-callback-token');
  if (!token || !timingSafeEqual(token, deps.config.xenditWebhookToken)) {
    console.warn('[payment-server] Webhook rejected: bad or missing x-callback-token.');
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  const payload = req.body as XenditWebhookPayload | undefined;
  const event = payload?.event;
  const data = payload?.data;

  if (!event || !data) {
    // Acknowledged, not retried: an empty or unrecognised body will not become
    // meaningful on the sixth delivery, and failing it would burn Xendit's
    // retry budget on something that can never succeed.
    console.warn('[payment-server] Webhook acknowledged with no recognisable payload.');
    res.status(200).json({ received: true });
    return;
  }

  const orderId = data.reference_id?.trim();
  if (!orderId) {
    console.warn(`[payment-server] Webhook ${event} has no reference_id; ignored.`);
    res.status(200).json({ received: true });
    return;
  }

  const orderRef = deps.firestore.doc(`orders/${orderId}`);
  const snap = await orderRef.get();

  if (!snap.exists) {
    // Acknowledged. Retrying cannot make the order appear, and a 4xx would
    // trigger six pointless retries.
    console.warn(`[payment-server] Webhook ${event} for unknown order ${orderId}; ignored.`);
    res.status(200).json({ received: true });
    return;
  }
  const order = snap.data() as OrderDoc;

  // ── 2. Map the event onto our payment state ─────────────────────────────────
  //
  // The three events Xendit sends for a Payments API payment request, and what
  // each means for the shop:
  //
  //   payment.capture        money is IN. This is the only event that marks an
  //                          order paid.
  //   payment.authorization  a hold, not a capture. With `capture_method:
  //                          AUTOMATIC` we do not act on it — acting would mark
  //                          an order paid on a card hold that may still fail.
  //   payment.failure        the payment failed. Order stays `pending`
  //                          fulfilment-wise and becomes payable again.
  //
  // The plan (§2) said the webhook should also advance `status` to 'confirmed'.
  // IT DELIBERATELY DOES NOT. Fulfilment status is advanced by STAFF from the
  // fulfilment queue, and that same client transaction is what takes stock off
  // the shelf (see CUTOVER.md and `STOCK_TAKEN_STATUSES` in OrderService). A
  // server-side jump to `confirmed` would take the order past the only place
  // stock is ever decremented, and the shop would sell ice cream it had already
  // sold. Payment and fulfilment move independently, by design.
  let nextPaymentStatus: PaymentStatus | null = null;
  if (event === 'payment.capture') nextPaymentStatus = 'paid';
  else if (event === 'payment.failure') nextPaymentStatus = 'failed';

  if (nextPaymentStatus === null) {
    res.status(200).json({ received: true, ignored: event });
    return;
  }

  // ── 3. Verify the amount actually matches what we asked for ─────────────────
  //
  // A capture for a different amount means one of: a tampered webhook, a
  // partial capture, or a bug on our side. None of them should silently become
  // "paid".
  const chargedAmount = data.request_amount;
  if (
    nextPaymentStatus === 'paid' &&
    typeof chargedAmount === 'number' &&
    typeof order.grandTotal === 'number' &&
    Math.abs(chargedAmount - order.grandTotal) > 0.01
  ) {
    console.error(
      `[payment-server] Order ${orderId}: capture of ${chargedAmount} does not match ` +
        `grandTotal ${order.grandTotal}. NOT marking paid — reconcile by hand ` +
        `(payment_id ${data.payment_id ?? 'unknown'}).`,
    );
    // 200, deliberately: Xendit did its job and retrying will reproduce the
    // same mismatch. This needs a human, not another delivery.
    res.status(200).json({ received: true, flagged: 'amount_mismatch' });
    return;
  }

  // ── 4. Apply it, idempotently ───────────────────────────────────────────────
  //
  // A Firestore transaction, so a duplicate delivery racing a first delivery
  // cannot both apply. Xendit retries on any non-2xx and also resends on
  // provider hiccups, so duplicates are the NORM here, not an edge case.
  try {
    await deps.firestore.runTransaction(async (tx) => {
      const fresh = await tx.get(orderRef);
      if (!fresh.exists) return;
      const current = fresh.data() as OrderDoc;

      // ── The duplicate guard ───────────────────────────────────────────────
      //
      // A replayed `payment.capture` on an already-paid order is a no-op, and
      // so is a late `payment.failure` arriving AFTER a capture (the events do
      // not arrive in a guaranteed order). `paid` is terminal for our purposes:
      // nothing may downgrade it except a refund, which is a different code
      // path entirely.
      if (current.paymentStatus === 'paid') return;
      if (current.paymentStatus === 'refunded') return;
      if (current.paymentStatus === nextPaymentStatus) return;

      // Typed as the SDK's own update shape rather than `Record<string, unknown>`
      // so the FieldValue assignments below are checked instead of being cast
      // through `any` at the call site.
      const update: { [key: string]: FieldValue | PaymentStatus | string | null } = {
        paymentStatus: nextPaymentStatus,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (nextPaymentStatus === 'paid') {
        update.paymentReference = data.payment_id ?? null;
        update.paidAt = FieldValue.serverTimestamp();
        if (data.channel_code) update.paymentMethod = data.channel_code;
      }

      tx.update(orderRef, update);
    });
  } catch (err) {
    // A real failure: return 5xx so Xendit retries. This is the ONE case where
    // a non-2xx is correct, because the next delivery may well succeed.
    console.error(
      `[payment-server] Webhook write failed for order ${orderId}:`,
      err instanceof Error ? err.message : err,
    );
    res.status(500).json({ error: 'write_failed' });
    return;
  }

  // ── 5. Acknowledge QUICKLY ──────────────────────────────────────────────────
  // Xendit expects a 2xx within a few seconds and retries up to six times with
  // exponential backoff. Everything above is a single document read plus,
  // at most, one transaction — well inside that window.
  res.status(200).json({ received: true });
}

/**
 * Constant-time string comparison.
 *
 * `===` on a secret leaks its prefix through timing: an attacker who can send
 * many webhooks can walk the token one character at a time. `crypto.timingSafeEqual`
 * needs equal-length buffers, so a length mismatch short-circuits — which leaks
 * only the length, which is not a secret.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i]! ^ bufB[i]!;
  return diff === 0;
}
