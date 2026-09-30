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
