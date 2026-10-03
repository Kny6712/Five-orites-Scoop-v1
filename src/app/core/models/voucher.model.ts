// src/app/core/models/voucher.model.ts
// Five-orites Scoop — Voucher / Promo Code Data Models

// The discount calculation lives in core/logic/voucher.ts so the unit tests can
// import it without pulling in Firestore. Re-exported here.
export {
  calculateDiscount,
  MAX_PERCENT_DISCOUNT,
  type VoucherType,
} from '../logic/voucher';

import type { VoucherType } from '../logic/voucher';

export interface Voucher {
  id: string;
  code: string; // uppercase, e.g. SCOOP10
  type: VoucherType;
  value: number; // percent 1-90 or fixed peso amount
  minOrder?: number; // minimum subtotal to apply
  isActive: boolean;

  /**
   * Redemption tracking and limits.
   *
   * None of these existed before, which made "which code actually sells?" an
   * unanswerable question — the only trace a voucher left was the `voucherCode`
   * string on an order, so answering it meant scanning orders client-side and
   * still could not tell you whether a code hit a cap.
   *
   * EVERY FIELD HERE IS OPTIONAL. A voucher written before this change has none
   * of them, and `redemptionStats` below has to treat that as "no data" rather
   * than as zero — a code with no `usageCount` has not been counted, which is a
   * different statement from "has been used zero times". See the comment on the
   * function for how the two are kept apart.
   */
  /** Incremented on every successful redemption. Absent = never counted. */
  usageCount?: number;
  /** Cap on total redemptions. Absent = unlimited. */
  maxRedemptions?: number;
  /** Cap per customer. Absent = unlimited. */
  perCustomerLimit?: number;
  /** Epoch ms. Absent = no start. Compared with `Date.now()` by the customer service. */
  startsAt?: number;
  /** Epoch ms. Absent = never expires. */
  expiresAt?: number;
}

/** One voucher row with its measured performance, for the admin report. */
export interface RedemptionStats {
  voucher: Voucher;
  /** `null` when the voucher has no `usageCount` — i.e. it predates tracking. */
  uses: number | null;
  /** True when this code has no usage data at all, so nothing may be concluded. */
  untracked: boolean;
  /** True when `usageCount` has reached `maxRedemptions`. */
  exhausted: boolean;
  /** Pesos taken off the books by this code. Only over DELIVERED orders. */
  discountGiven: number;
  /** Delivered orders that used it. */
  orders: number;
  /** Pesos of delivered subtotal the discount came off. */
  revenue: number;
  state: 'live' | 'scheduled' | 'expired' | 'exhausted' | 'inactive';
}

/**
 * Whether a voucher can be used right now, and why not when it cannot.
 *
 * Split out of `voucher.ts` so the admin page and the checkout share one
 * definition of "usable" — otherwise the report can say a code is live while
 * checkout refuses it.
 *
 * `tracked` is separate from `usable` on purpose: a code with no `usageCount`
 * can still be perfectly usable, and reporting it as broken would be wrong.
 */
export type VoucherUsability =
  | { usable: true }
  | { usable: false; reason: 'inactive' | 'not_started' | 'expired' | 'exhausted' };

export function voucherUsability(v: Voucher, now = Date.now()): VoucherUsability {
  if (!v.isActive) return { usable: false, reason: 'inactive' };
  if (typeof v.startsAt === 'number' && now < v.startsAt) {
    return { usable: false, reason: 'not_started' };
  }
  if (typeof v.expiresAt === 'number' && now > v.expiresAt) {
    return { usable: false, reason: 'expired' };
  }
  if (
    typeof v.maxRedemptions === 'number' &&
    typeof v.usageCount === 'number' &&
    v.usageCount >= v.maxRedemptions
  ) {
    return { usable: false, reason: 'exhausted' };
  }
  return { usable: true };
}

// There is deliberately NO built-in voucher list.
//
// One used to live here (`SCOOP10`, `FREE50`) as a fallback when the Firestore
// lookup came back empty — which meant deactivating a code in the admin UI had no
// effect, because the hardcoded copy answered anyway. That fallback is gone, and
// the list went with it.
//
// What made removing it necessary rather than tidy: the cart page labelled its
// input "Promo code (try SCOOP10)", and because nothing has ever seeded those
// codes into `vouchers/`, following the hint produced
// `Voucher "SCOOP10" not found.` on every attempt. A hint that cannot work is
// worse than no hint.
//
// Real codes are created in Admin -> Vouchers, which has full CRUD and now
// enforces maxRedemptions and perCustomerLimit server-side.
