// src/app/core/services/voucher.service.ts
// Five-orites Scoop — Voucher lookup

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  limit,
  getDocs,
} from '@angular/fire/firestore';
import { Voucher, calculateDiscount } from '../models/voucher.model';

@Injectable({ providedIn: 'root' })
export class VoucherService {
  private firestore = inject(Firestore);

  /**
   * Every ACTIVE voucher, for the "grab a code" cards on the dashboard.
   *
   * Deliberately a plain Promise rather than an onSnapshot observable. The
   * storefront catalogue, low-stock alerts and orders are all live streams because
   * they change under the user while they look at them. A promo list does not: it
   * changes when an admin edits it, and the user acting on a code will be
   * checking out shortly. A one-shot read is simpler, and `validateVoucher`
   * re-checks the code and its `isActive` flag at checkout regardless — so a code
   * deactivated between grabbing it and paying is still correctly rejected rather
   * than honoured from a stale list.
   *
   * A single equality filter is served by Firestore's automatic single-field
   * index, so this needs no composite index deployed. Ordering by `code` WOULD
   * need one ({isActive ASC, code ASC}), which is not in firestore.indexes.json —
   * hence the in-memory sort rather than a query orderBy.
   */
  async getActiveVouchers(): Promise<Voucher[]> {
    const col = collection(this.firestore, 'vouchers');
    const q = query(col, where('isActive', '==', true));

    let snap;
    try {
      snap = await getDocs(q);
    } catch {
      throw new Error('Could not reach the voucher service. Please try again.');
    }

    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Voucher))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async validateVoucher(code: string, subtotal: number): Promise<{ voucher: Voucher; discount: number }> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) throw new Error('Enter a voucher code.');

    // The vouchers collection is the ONLY source of truth.
    //
    // This used to fall back to a hard-coded BUILT_IN_VOUCHERS list whenever the
    // lookup came back empty or threw, "so SCOOP10 / FREE50 always work in
    // demos". That made deactivating a voucher in the admin UI a no-op for the
    // storefront, and turned any rules/offline error into a client-computed
    // discount — a live discount-control bypass. An empty result and a failed
    // lookup are now reported distinctly instead of being silently downgraded.
    const col = collection(this.firestore, 'vouchers');
    const q = query(col, where('code', '==', normalized), where('isActive', '==', true), limit(1));

    let snap;
    try {
      snap = await getDocs(q);
    } catch {
      throw new Error('Could not reach the voucher service. Please try again.');
    }

    if (snap.empty) throw new Error(`Voucher "${normalized}" not found. or is no longer active.`);

    const voucher = { id: snap.docs[0].id, ...snap.docs[0].data() } as Voucher;
    const discount = calculateDiscount(subtotal, voucher);
    if (discount <= 0) throw new Error(`Code ${normalized} needs a minimum order of ₱${voucher.minOrder ?? 0}.`);
    return { voucher, discount };
  }
}
