// src/app/core/models/payment.model.ts
// Five-orites Scoop — payment-side types shared by the cart, the order list and
// the tracker.
//
// Kept apart from `order.model.ts` because that file describes the ORDER and
// this one describes the CHECKOUT CHOICE. The channel code is not a property of
// an order until a payment request exists for it, and the picker has to be able
// to render before any order does.

/**
 * The screens the cart can show after "Continue to Payment" is pressed.
 *
 * `idle` is the cart itself. The rest are all reached from the same place and
 * differ first only in what the outcome said — which is a HINT, never proof.
 * The authoritative answer is the order document's `paymentStatus`, written
 * only when the customer clicks "Settle Transaction", and every
 * screen below re-reads it before deciding what to say.
 *
 * `preparing` is deliberately absent: creating a session takes one round trip,
 * so it is a state of the BUTTON (`isPreparingPayment` on the cart page), not a
 * screen the customer's basket disappears behind.
 */
export type PaymentOutcome = 'idle' | 'checking' | 'success' | 'pending' | 'failed';

/**
 * The three values the internal settlement can report on its outcome.
 *
 * Mapped, not trusted: the page still reads the order document before claiming
 * anything about money.
 */
export type ReturnHint = 'success' | 'failed' | 'cancelled';

export function parseReturnHint(value: string | null | undefined): ReturnHint | null {
  if (value === 'success') return 'success';
  if (value === 'failed') return 'failed';
  if (value === 'cancelled') return 'cancelled';
  return null;
}
