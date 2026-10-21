// src/app/core/logic/voucher.ts
// Five-orites Scoop — Voucher discount rules
//
// Framework-free so the unit tests exercise the real pricing path.

import { formatLocalDate } from '@core/logic/date';
import { roundMoney } from '@core/logic/money';

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
    // ROUNDED, not floored. The old `Math.floor` silently took half a peso
    // off a 10% voucher on a ₱65 basket, while the fixed-amount branch
    // applied no rounding at all — so the two paths disagreed about what a
    // peso is.
    return roundMoney((subtotal * pct) / 100);
  }
  return roundMoney(Math.min(Math.max(voucher.value, 0), subtotal));
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

/**
 * `YYYY-MM-DD` for a stored epoch ms, or '' when there is no date.
 *
 * LOCAL time, deliberately: the date input in the voucher editor speaks local
 * dates, so the window the owner edits and the window written into a CSV have
 * to agree. A UTC formatter would put a code that starts tonight in the shop
 * on tomorrow's date in the file.
 *
 * It lives here rather than beside either caller because there are two of them
 * — the editor and the export — and two copies of a date formatter are two
 * formats by the next change.
 */
export function voucherDate(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  return formatLocalDate(ms);
}
