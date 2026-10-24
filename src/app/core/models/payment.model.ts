// src/app/core/models/payment.model.ts
// Five-orites Scoop — payment-side types shared by the cart, the order list and
// the tracker.
//
// Kept apart from `order.model.ts` because that file describes the ORDER and
// this one describes the CHECKOUT CHOICE. The channel code is not a property of
// an order until a payment request exists for it, and the picker has to be able
// to render before any order does.

/**
 * Philippine channels this shop accepts, as Xendit names them.
 *
 * The same three the backend allowlists (`ALLOWED_CHANNELS` in
 * payment-server/src/xendit.ts). `CARDS` is absent on purpose: Xendit's minimum
 * for it is ₱5,000 and a typical basket here is ₱65–₱500, so offering it would
 * present a method that declines nearly every order.
 *
 * Typed as a union rather than `string` so a typo in a channel name is a
 * compile error at the call site instead of a 400 from Xendit at checkout.
 */
export type XenditChannelCode = 'GCASH' | 'PAYMAYA' | 'GRABPAY';

export interface PaymentChannel {
  code: XenditChannelCode;
  label: string;
  /** One line of copy for the picker. */
  blurb: string;
}

export const PAYMENT_CHANNEL_META: readonly PaymentChannel[] = [
  { code: 'GCASH', label: 'GCash', blurb: 'Pay with your GCash wallet' },
  { code: 'PAYMAYA', label: 'PayMaya', blurb: 'Pay with PayMaya' },
  { code: 'GRABPAY', label: 'GrabPay', blurb: 'Pay with GrabPay' },
];

/**
 * The screens the cart can show after "Continue to Payment" is pressed.
 *
 * `idle` is the cart itself. The rest are all reached from the same place and
 * differ first only in what the RETURN URL said — which is a HINT, never proof.
 * The authoritative answer is the order document's `paymentStatus`, written
 * only by the backend's verified webhook, and every screen below re-reads it
 * before deciding what to say.
 *
 * `preparing` is deliberately absent: creating a session takes one round trip,
 * so it is a state of the BUTTON (`isPreparingPayment` on the cart page), not a
 * screen the customer's basket disappears behind.
 */
export type PaymentOutcome = 'idle' | 'checking' | 'success' | 'pending' | 'failed';

/**
 * The three values Xendit can send back on the return URL's `payment` param.
 *
 * Mapped, not trusted: a customer who edits `?payment=success` in the address
 * bar learns nothing, because the page still polls the order document and shows
 * what the webhook actually recorded.
 */
export type ReturnHint = 'success' | 'failed' | 'cancelled';

export function parseReturnHint(value: string | null | undefined): ReturnHint | null {
  if (value === 'success') return 'success';
  if (value === 'failed') return 'failed';
  if (value === 'cancelled') return 'cancelled';
  return null;
}
