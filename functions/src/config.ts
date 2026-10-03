// functions/src/config.ts
// Five-orites Scoop — Server-side business constants
//
// WHY THIS IS A COPY AND NOT AN IMPORT
// This package is deployed on its own: Firebase builds functions/ separately
// from the Angular app, and its node_modules contains only firebase-admin,
// firebase-functions and typescript. `src/app/core/logic/delivery.ts` is not
// shipped alongside it and cannot be imported at runtime. So every rule the
// server has to enforce to price an order correctly has to exist here as well.
//
// THE DUPLICATION IS THE RISK, AND IT IS A MONEY RISK
// The storefront quotes a delivery figure from the client's constant. This file
// decides what the customer is actually charged. If the two ever disagree, the
// cart page and the order record show different numbers for the same basket —
// which is the kind of bug that is invisible in review and obvious to a
// customer at checkout. That is why the sync between the two copies is
// ASSERTED by a test rather than left to a comment nobody reads.
//
// If you change a number here, change it there in the same commit:
//     src/app/core/logic/delivery.ts
// and re-export it from src/app/core/models/cart.model.ts, which is where the
// app's call sites import it from.

/**
 * Flat delivery fee in pesos, Metro Manila.
 *
 * MUST stay in sync with src/app/core/logic/delivery.ts — a test asserts equality.
 */
export const DELIVERY_FEE = 50;

/**
 * Subtotal at or above which delivery is free.
 *
 * MUST stay in sync with src/app/core/logic/delivery.ts — a test asserts equality.
 */
export const FREE_DELIVERY_THRESHOLD = 500;

/**
 * Free at and above the threshold; otherwise the flat fee.
 *
 * This is the client's `getDeliveryFee` verbatim, and it is used to OVERWRITE
 * the `deliveryFee` on the order. That overwrite is the point: the client is
 * untrusted for money, so the fee is recomputed here from the authoritative
 * subtotal rather than read off the order the customer wrote.
 *
 * The threshold is applied to the subtotal BEFORE the discount, matching the
 * client's own order of operations (see OrderService.placeOrder). Discounting
 * first would let a large voucher manufacture free delivery.
 */
export function getDeliveryFee(subtotal: number): number {
  return subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
}