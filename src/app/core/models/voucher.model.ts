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
}

// Built-in fallback so demos work even when Firestore `vouchers` is empty.
export const BUILT_IN_VOUCHERS: Voucher[] = [
  { id: 'builtin-scoop10', code: 'SCOOP10', type: 'percent', value: 10, minOrder: 200, isActive: true },
  { id: 'builtin-free50', code: 'FREE50', type: 'fixed', value: 50, minOrder: 500, isActive: true },
];
