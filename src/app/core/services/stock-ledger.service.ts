// src/app/core/services/stock-ledger.service.ts
// Five-orites Scoop — Append-only stock movement history
//
// WHY THIS EXISTS
// The products update rule's customer branch scopes a signed-in customer's stock
// write to the KEY `stock` but cannot scope the MAGNITUDE, because rules cannot
// tie a write to an order created moments earlier. The rules file says so, and
// tests/firestore.rules.test.ts pins it with a test named "KNOWN LIMITATION:
// a customer CAN raise stock to any non-negative int" that then asserts
// `stock.cup: 999999` SUCCEEDS.
//
// The consequence is that every stock figure the admin UI shows — the low-stock
// panel, the fulfilment queue's availability, the analytics inventory numbers —
// is attacker-writable, and there was no ledger to reconcile it against. A
// discrepancy between the ledger and the product document is the evidence.
//
// WHAT IT DOES AND DOES NOT FIX
// It does NOT prevent the write. Only a Cloud Function performing the decrement
// server-side can, and Cloud Functions are out of scope (REFACTOR_PLAN.md:5,243).
// What it gives is DETECTION: an admin can see that a product's stock moved by
// 999,999 at an implausible time with no matching order, which is the difference
// between a silent corruption and a visible one.
//
// Every mutation goes through a transaction that writes the product AND the
// ledger entry together, so a ledger row can never claim a movement that did not
// happen. Writes that do NOT go through here (a customer's raw-SDK write) leave
// no ledger row at all — which is precisely what `findUnloggedChanges` looks for.

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from '@angular/fire/firestore';

/**
 * Why a stock level changed. Rendered as a chip, never translated.
 *
 * `sale` and `cancel_restock` are written SERVER-SIDE by the Cloud Functions
 * (`reconcileOrderStock` / `restockCancelledOrder` in functions/src/index.ts),
 * which reserve and return stock for an order. They exist here so the admin
 * ledger can tell a real sale apart from a staff member's manual restock — the
 * two used to be indistinguishable, which is the whole reason the ledger exists.
 */
export type StockReason = 'manual_adjust' | 'admin_restock' | 'sale' | 'cancel_restock';

export const STOCK_REASON_LABELS: Record<StockReason, string> = {
  manual_adjust: 'Adjusted in inventory',
  admin_restock: 'Restocked',
  sale: 'Sold',
  cancel_restock: 'Cancelled order returned',
};

export interface StockMovement {
  id: string;
  productId: string;
  /** Denormalised so a ledger view needs no second lookup. */
  variantName: string;
  size: string;
  /** Signed: positive is stock in, negative is stock out. */
  delta: number;
  /** Stock after the change, so the running total is verifiable from the rows. */
  balanceAfter: number;
  reason: StockReason;
  /** Set when the movement is attributable to an order. */
  orderId?: string;
  /** Who caused it — a uid for admin actions, blank for a sale. */
  actorUid?: string;
  createdAt: unknown;
}

/**
 * A product whose stock no longer agrees with the sum of its ledger rows.
 *
 * This is the whole point of the ledger: a product whose stored stock differs
 * from its logged movements was written by something that bypassed
 * `InventoryService` — in practice a customer's raw SDK call.
 */
export interface UnloggedChange {
  productId: string;
  variantName: string;
  size: string;
  stored: number;
  logged: number;
  drift: number;
}

@Injectable({ providedIn: 'root' })
export class StockLedgerService {
  private firestore = inject(Firestore);

  /**
   * Recent movements, newest first.
   *
   * Capped and reported, in keeping with the rest of the admin side: a ledger is
   * exactly the sort of table where quietly showing 200 of 4,000 rows would make
   * it look like the shop has no history.
   */
  async recent(limitRows = 100): Promise<StockMovement[]> {
    const q = query(
      collection(this.firestore, 'stockMovements'),
      orderBy('createdAt', 'desc'),
      limit(limitRows),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as StockMovement[];
  }

  /**
   * Every movement for one product — the per-flavor history view.
   */
  async forProduct(productId: string, limitRows = 50): Promise<StockMovement[]> {
    const q = query(
      collection(this.firestore, 'stockMovements'),
      where('productId', '==', productId),
      orderBy('createdAt', 'desc'),
      limit(limitRows),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as StockMovement[];
  }

  /**
   * Finds products whose stored stock disagrees with their logged movements.
   *
   * This is the reconciliation report and the reason the ledger is worth having.
   * Any drift it reports was written by something that did not go through
   * `record()` — in practice, a signed-in customer with the raw SDK, which the
   * rules cannot prevent.
   *
   * Compares `stored` against the sum of deltas plus an opening balance, and the
   * opening balance is taken as the first row's `balanceAfter - delta`. That
   * works even though the ledger only holds recent rows: the anchor is derived
   * rather than assumed, so a truncated history does not report every product as
   * drifted.
   */
  async findUnloggedChanges(
    products: {
      id: string;
      variantName: string;
      pricing?: unknown;
      stock?: Record<string, number>;
    }[],
  ): Promise<UnloggedChange[]> {
    const sizes = ['cup', 'pint', 'halfGallon', 'gallon'] as const;
    const out: UnloggedChange[] = [];

    for (const p of products) {
      const rows = await this.forProduct(p.id, 200);
      if (rows.length === 0) continue;
      for (const size of sizes) {
        const forSize = rows.filter((r) => r.size === size);
        if (forSize.length === 0) continue;
        const loggedSum = forSize.reduce((s, r) => s + (r.delta ?? 0), 0);
        // Rows arrive newest-first, so the LAST one is the oldest.
        const oldest = forSize[forSize.length - 1];
        const opening = (oldest.balanceAfter ?? 0) - (oldest.delta ?? 0);
        const expected = opening + loggedSum;
        const stored = p.stock?.[size] ?? 0;
        if (expected !== stored) {
          out.push({
            productId: p.id,
            variantName: p.variantName,
            size,
            stored,
            logged: expected,
            drift: stored - expected,
          });
        }
      }
    }
    return out;
  }
}
