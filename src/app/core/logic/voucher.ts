// src/app/core/logic/voucher.ts
// Five-orites Scoop — Voucher discount rules
//
// Framework-free so the unit tests exercise the real pricing path.

export type VoucherType = 'percent' | 'fixed';

// Shape calculateDiscount needs — not part of the public surface.
interface VoucherLike {
  type: VoucherType;
  value: number;
  minOrder?: number;
  isActive: boolean;
}

/** Largest percentage discount a voucher may ever grant. */
export const MAX_PERCENT_DISCOUNT = 90;

/**
 * Discount in pesos for a voucher against a subtotal.
 *
 * Returns 0 when the voucher is inactive or the subtotal is below its
 * minimum. A fixed discount is capped at the subtotal so a total can never
 * go negative.
 */
export function calculateDiscount(subtotal: number, voucher: VoucherLike): number {
  if (!voucher.isActive) return 0;
  if ((voucher.minOrder ?? 0) > subtotal) return 0;
  if (voucher.type === 'percent') {
    const pct = Math.min(Math.max(voucher.value, 0), MAX_PERCENT_DISCOUNT);
    return Math.floor((subtotal * pct) / 100);
  }
  return Math.min(Math.max(voucher.value, 0), subtotal);
}

/**
 * Where the dashboard hands a grabbed code to the cart page.
 *
 * WHY IT LIVES HERE AND NOT NEXT TO THE DASHBOARD.
 * The writer is `features/dashboard/voucher-cards` and the reader is
 * `features/cart`, so a constant defined beside either component makes one
 * feature import another feature's UI in order to read a string. The two pages
 * share this key and nothing else, and neither owns it.
 *
 * sessionStorage rather than localStorage, because a code is scoped to the tab
 * that typed it and must not outlive the trip to checkout.
 */
export const PENDING_VOUCHER_KEY = 'five_orites_pending_voucher';
