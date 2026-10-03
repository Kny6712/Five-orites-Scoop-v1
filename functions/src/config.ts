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

// ── Voucher discount ─────────────────────────────────────────────────────────
//
// Same reasoning as the delivery constants above, and the risk is higher: the
// discount decides how much money the shop keeps. Before this existed the server
// clamped the CLIENT's `discountAmount` into [0, totalAmount] and called that a
// validation — which bounds the damage but still lets a forged client send
// `discountAmount: totalAmount` and buy the whole basket for the delivery fee.
// The amount has to be recomputed from the voucher's own `value`, never read off
// the order.
//
// MUST stay in sync with src/app/core/logic/voucher.ts — a test asserts equality.

/** Largest percentage discount a voucher may ever grant. */
export const MAX_PERCENT_DISCOUNT = 90;

/** The fields of a voucher document that pricing depends on. */
export interface VoucherPricing {
  type: string;
  value: number;
  minOrder?: number;
  isActive: boolean;
}

/**
 * Discount in pesos for a voucher against a subtotal.
 *
 * This is the client's `calculateDiscount` verbatim. It returns 0 for an inactive
 * voucher or a subtotal below its minimum, and caps a fixed discount at the
 * subtotal so a total can never go negative.
 */
export function calculateDiscount(subtotal: number, voucher: VoucherPricing): number {
  if (!voucher.isActive) return 0;
  if ((voucher.minOrder ?? 0) > subtotal) return 0;
  if (voucher.type === 'percent') {
    const pct = Math.min(Math.max(voucher.value, 0), MAX_PERCENT_DISCOUNT);
    return Math.floor((subtotal * pct) / 100);
  }
  return Math.min(Math.max(voucher.value, 0), subtotal);
}
