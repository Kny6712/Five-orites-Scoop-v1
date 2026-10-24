// payment-server/src/xendit.ts
// Five-orites Scoop — thin client for Xendit Payments API v3.
//
// WHY NOT THE OFFICIAL SDK. The v3 REST contract is three fields wide for what
// this shop needs, the SDK is another dependency to keep patched, and the exact
// request/response shape is what has to be right — so it is spelled out here,
// against the published OpenAPI spec (docs.xendit.co, "Create a payment
// request" and "Payment webhook notification", both read 24 Oct 2026).
//
// THE PLAN GOT ONE FIELD WRONG AND IT IS CORRECTED HERE. PLAN-XENDIT-CHECKOUT
// §4.3 says to send `amount`. The v3 field is `request_amount`. Sending
// `amount` is silently ignored by Xendit — the request still validates,
// `request_amount` comes back as 0 or the call 400s on a missing field, and the
// customer is handed a checkout page for the wrong number or no page at all.
// `request_amount` is what the spec says and what the code below sends.

export type XenditChannelCode = 'GCASH' | 'PAYMAYA' | 'GRABPAY';

/**
 * The channels this shop offers, in the order they are offered.
 *
 * `CARDS` is deliberately absent. Its minimum is ₱5,000 and a typical basket
 * here is ₱65–₱500, so including it would present a method that rejects nearly
 * every order. See PLAN-XENDIT-CHECKOUT §4.4.
 */
export const ALLOWED_CHANNELS: readonly XenditChannelCode[] = ['GCASH', 'PAYMAYA', 'GRABPAY'];

export function isAllowedChannel(value: unknown): value is XenditChannelCode {
  return typeof value === 'string' && (ALLOWED_CHANNELS as readonly string[]).includes(value);
}

export interface CreatePaymentRequestInput {
  /** Our order id. Doubles as the idempotency anchor. */
  referenceId: string;
  /** Whole pesos. Xendit takes the minor unit only for IDR; PHP is pesos. */
  amount: number;
  channelCode: XenditChannelCode;
  successReturnUrl: string;
  failureReturnUrl: string;
  cancelReturnUrl: string;
  description: string;
}

export interface XenditAction {
  type: string;
  value: string;
  descriptor?: string;
}

export interface CreatePaymentRequestResult {
  paymentRequestId: string;
  /** Where to send the customer. `actions[].type === 'REDIRECT_CUSTOMER'`. */
  checkoutUrl: string;
  status: string;
}

/** Shape of the webhook body's `data` object. Only the fields we read. */
export interface XenditWebhookData {
  payment_id?: string;
  reference_id?: string;
  payment_request_id?: string;
  status?: string;
  channel_code?: string;
  currency?: string;
  request_amount?: number;
  failure_code?: string;
  captures?: { capture_id?: string; capture_amount?: number }[];
}

export interface XenditWebhookPayload {
  event?: string;
  business_id?: string;
  created?: string;
  data?: XenditWebhookData;
}

/** The subset of a Xendit failure we surface. Never the whole payload. */
export class XenditApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Xendit's own code, e.g. `INVALID_MERCHANT_SETTINGS`. Safe to log. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'XenditApiError';
  }
}

const API_BASES = {
  test: 'https://api.sandbox.xendit.co',
  live: 'https://api.xendit.co',
} as const;

export class XenditClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(secretKey: string, live: boolean) {
    this.baseUrl = live ? API_BASES.live : API_BASES.test;
    // HTTP Basic with the secret key as the user and an empty password — the
    // documented scheme for v3. `Buffer.from` rather than a template string so
    // the key never appears in a concatenation a linter might flag into a log.
    this.authHeader = `Basic ${Buffer.from(`${secretKey}:`, 'utf8').toString('base64')}`;
  }

  /**
   * POST /v3/payment_requests.
   *
   * `reference_id` is OUR order id, which is what makes a retried call for the
   * same order identifiable server-side. We do not rely on Xendit for
   * deduplication — the order document carries `paymentRequestId`, and a
   * resume creates a NEW request against the SAME order rather than reusing a
   * stale one.
   */
  async createPaymentRequest(
    input: CreatePaymentRequestInput,
  ): Promise<CreatePaymentRequestResult> {
    const body = {
      reference_id: input.referenceId,
      type: 'PAY',
      country: 'PH',
      currency: 'PHP',
      request_amount: input.amount,
      capture_method: 'AUTOMATIC',
      channel_code: input.channelCode,
      channel_properties: {
        success_return_url: input.successReturnUrl,
        failure_return_url: input.failureReturnUrl,
        cancel_return_url: input.cancelReturnUrl,
      },
      description: input.description,
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v3/payment_requests`, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          // Pinned, so a breaking change on Xendit's side surfaces as a
          // deliberate upgrade rather than as a silent field rename.
          'api-version': '2024-11-11',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // A network failure is NOT an API error and must not be reported as one:
      // the caller shows the customer "payment could not be started", which is
      // true for a timeout and false for a 400.
      throw new XenditApiError(
        `Could not reach Xendit: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
    }

    const text = await response.text();

    if (!response.ok) {
      let code: string | undefined;
      let message = `Xendit returned ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { message?: string; error_code?: string };
        code = parsed.error_code;
        if (parsed.message) message = parsed.message;
      } catch {
        // Non-JSON body (an HTML error page from a proxy). Keep the status.
      }
      // The body is logged by the route, never here, and never in full: a
      // Xendit error body can echo request fields back.
      throw new XenditApiError(message, response.status, code);
    }

    let parsed: {
      payment_request_id?: string;
      status?: string;
      actions?: XenditAction[];
    };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new XenditApiError('Xendit returned a malformed response.', 502);
    }

    const redirect = parsed.actions?.find((a) => a.type === 'REDIRECT_CUSTOMER');
    if (!parsed.payment_request_id || !redirect?.value) {
      // A `PAY` request against an enabled channel always returns a redirect
      // action. Its absence means the channel is not enabled on this account —
      // the most likely real cause — and saying so is far more useful than
      // handing the caller an undefined URL.
      throw new XenditApiError(
        'Xendit returned no checkout URL. The selected payment method may not be enabled on this account.',
        502,
        'NO_REDIRECT_ACTION',
      );
    }

    return {
      paymentRequestId: parsed.payment_request_id,
      checkoutUrl: redirect.value,
      status: parsed.status ?? 'UNKNOWN',
    };
  }
}
