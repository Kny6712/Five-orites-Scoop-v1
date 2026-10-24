// src/app/core/services/orders/payment.service.ts
// Five-orites Scoop — client wrapper for the Xendit payment backend.
//
// WHY THIS IS A SEPARATE SERVICE FROM OrderService. OrderService talks only to
// Firestore and needs no network, no token and no backend. Payment talks to a
// process that does not exist on Firebase's Spark plan (see
// payment-server/README.md) and carries a credential. Keeping them apart means
// the order path still works, degraded but functional, when the payment
// service is down — which it will be locally until someone runs it.

import { Injectable, inject } from '@angular/core';
import { environment } from '@env/environment';
import { AuthService } from '@core/services/identity/auth.service';
import type { XenditChannelCode } from '@core/models/payment.model';

/** The channels offered at checkout. Mirrors ALLOWED_CHANNELS in payment-server/src/xendit.ts. */
export const PAYMENT_CHANNELS: readonly XenditChannelCode[] = ['GCASH', 'PAYMAYA', 'GRABPAY'];

/**
 * Where the customer's last channel choice is kept.
 *
 * localStorage rather than a signal, because the choice has to survive the one
 * thing that page state cannot: the customer picks GCash on the cart, leaves
 * the app for Xendit, comes back, opens My Orders and taps Pay Now — by then
 * three components have been created and destroyed. A preference is not a
 * secret, so it does not need the care a token needs, only a try/catch for
 * storage being disabled.
 */
const PREFERRED_CHANNEL_KEY = 'preferredPaymentChannel';

export interface PaymentSession {
  orderId: string;
  checkoutUrl: string;
  paymentRequestId: string;
  amount: number;
}

/**
 * Why the payment call failed, already resolved into something a page can act
 * on. Every network/HTTP failure is folded into one of these four so no page
 * has to interpret a fetch error or an HTTP status code itself.
 */
export type PaymentFailure =
  | { kind: 'not_configured' }
  | { kind: 'signed_out' }
  | { kind: 'unavailable' }
  | { kind: 'rejected'; message: string };

export class PaymentError extends Error {
  constructor(readonly failure: PaymentFailure) {
    super(describeFailure(failure));
    this.name = 'PaymentError';
  }
}

function describeFailure(f: PaymentFailure): string {
  switch (f.kind) {
    case 'not_configured':
      return 'Payments are not set up on this build yet.';
    case 'signed_out':
      return 'Please sign in again to continue.';
    case 'unavailable':
      return 'We could not reach the payment service. Please try again in a moment.';
    case 'rejected':
      return f.message;
  }
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private auth = inject(AuthService);

  /**
   * True when this build has a payment backend pointed at it at all.
   *
   * Checked before any network call so the UI can say "payments are not set up"
   * instead of a generic network error — which is what a wrong URL looks like
   * from the browser, and which would send someone hunting a server problem
   * that is really a missing environment value.
   */
  get isConfigured(): boolean {
    return Boolean(environment.payment?.baseUrl);
  }

  /**
   * The channel the next session should be created for.
   *
   * Read from storage and validated against the allowlist rather than trusted:
   * a stale or hand-edited value is dropped back to GCash instead of being
   * handed to Xendit as a channel code the backend will refuse.
   */
  get preferredChannel(): XenditChannelCode {
    try {
      const raw = localStorage.getItem(PREFERRED_CHANNEL_KEY);
      if (raw && (PAYMENT_CHANNELS as readonly string[]).includes(raw)) {
        return raw as XenditChannelCode;
      }
    } catch {
      // Storage disabled; the default below is the whole answer then.
    }
    return 'GCASH';
  }

  set preferredChannel(code: XenditChannelCode) {
    try {
      localStorage.setItem(PREFERRED_CHANNEL_KEY, code);
    } catch {
      // Preference lost on the next load; nothing else depends on it.
    }
  }

  /**
   * Creates a Xendit payment session for an EXISTING order.
   *
   * Takes an order id, never an amount. The backend re-prices the order from
   * Firestore and charges that; accepting an amount here would put the price in
   * the hands of the browser, which is the one place it must not be.
   *
   * Used both by "Continue to Payment" (a just-created order) and by
   * "Pay Now" / "Resume Payment" (an older one). They are the same call, and
   * that is the point: resuming must never mint a second order.
   */
  async createSession(orderId: string, channelCode: XenditChannelCode): Promise<PaymentSession> {
    if (!this.isConfigured) throw new PaymentError({ kind: 'not_configured' });

    const token = await this.auth.getIdToken();
    if (!token) throw new PaymentError({ kind: 'signed_out' });

    const base = environment.payment.baseUrl.replace(/\/+$/, '');

    let response: Response;
    try {
      response = await fetch(`${base}/payment/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderId, channelCode }),
      });
    } catch {
      // A failed fetch is indistinguishable, from here, between "the service is
      // not running" and "this device has no network". Both say the same thing
      // to the customer and both are worth the same retry.
      throw new PaymentError({ kind: 'unavailable' });
    }

    if (!response.ok) {
      let message = 'We could not start your payment. Please try again.';
      let kind: PaymentFailure['kind'] = 'unavailable';
      try {
        const body = (await response.json()) as { message?: string; error?: string };
        if (body.message) message = body.message;
        // `already_paid` and `cannot_price` are the two the backend answers
        // with a specific, actionable message, and both must be SHOWN rather
        // than replaced with the generic one.
        if (
          body.error === 'already_paid' ||
          body.error === 'cannot_price' ||
          body.error === 'order_closed'
        ) {
          kind = 'rejected';
        }
      } catch {
        // Non-JSON error body; keep the generic message.
      }
      if (response.status === 401) throw new PaymentError({ kind: 'signed_out' });
      throw new PaymentError(kind === 'rejected' ? { kind, message } : { kind });
    }

    const session = (await response.json()) as Partial<PaymentSession>;
    if (!session.checkoutUrl) throw new PaymentError({ kind: 'unavailable' });

    return {
      orderId: session.orderId ?? orderId,
      checkoutUrl: session.checkoutUrl,
      paymentRequestId: session.paymentRequestId ?? '',
      amount: session.amount ?? 0,
    };
  }

  /**
   * Sends the customer to Xendit's hosted checkout.
   *
   * A full navigation, not a popup and not an in-app webview. Popups are
   * blocked on mobile WebViews and Xendit's flow is not designed for one; a
   * top-level navigation lets the customer use whatever wallet app their phone
   * already trusts, and the return URL brings them back to the app.
   *
   * `location.assign` rather than `window.open` so there is no popup blocker in
   * the path and no second browsing context to reconcile on return.
   */
  goToCheckout(checkoutUrl: string): void {
    window.location.assign(checkoutUrl);
  }
}
