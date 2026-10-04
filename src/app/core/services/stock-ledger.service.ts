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

/**
 * What one reconciliation pass covered, so the UI can say so.
 *
 * `rowsScanned` is what was actually read and `window` is the cap it read to.
 * A pass that finds nothing is only reassuring in proportion to how much of the
 * ledger it looked at, which is why the report carries both numbers instead of
 * returning a bare array: `rowsScanned >= window` means the ledger is longer
 * than the pass covered.
 */
export interface ReconciliationReport {
  changes: UnloggedChange[];
  rowsScanned: number;
  window: number;
}

/**
 * How many recent ledger rows ONE reconciliation pass reads.
 *
 * WHY A SINGLE GLOBAL WINDOW RATHER THAN A QUERY PER PRODUCT
 * This used to loop over the catalogue and query 200 rows for each product, so
 * on the 64-flavor catalogue one button press cost up to 12,800 document reads —
 * a quarter of the Spark plan's 50,000-per-day allowance, repeatable at the
 * speed of a thumb. One ordered query over `stockMovements` costs one read per
 * row instead, and needs only the single-field index on `createdAt` that
 * `recent()` already relies on, so no new index is introduced. The rows are
 * grouped by product client-side and the per-product comparison is unchanged.
 *
 * WHY 500
 * Drift is created by a stock write that happened while the shop was open, so it
 * is a recent event by construction, and the opening-balance anchor below already
 * tolerates a truncated history — a window costs coverage, not correctness. 500
 * rows is 1% of the Spark plan's daily allowance per press, and is deep enough
 * that a flavor touched during normal trading is still inside it. Raising it
 * toward "every row ever" would put one report back in the range where pressing
 * the button twice breaks the day's budget.
 *
 * WHAT THIS COSTS
 * A flavor whose last movement predates the window is not compared at all, so
 * the report must state the window rather than implying it checked everything.
 */
const RECONCILE_WINDOW = 500;

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
   *
   * NOT the reconciliation's read path: a per-product query is correct but costs
   * one read set per product, which is what `findUnloggedChanges` used to do for
   * the whole catalogue. Kept for a single product's history, where it is one
   * query and the exact answer.
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
   * works even though only the most recent `RECONCILE_WINDOW` rows are read: the
   * anchor is derived rather than assumed, so a truncated history does not report
   * every product as drifted.
   *
   * COVERAGE IS THE WINDOW, NOT THE CATALOGUE. One ordered read of the newest
   * `RECONCILE_WINDOW` rows replaces the old query-per-product sweep (up to 12,800
   * reads per press), and a flavor with no movement inside that window is not
   * compared. That is a real reduction in coverage, which is why this returns a
   * `ReconciliationReport` carrying `rowsScanned` and `window` — the caller has
   * to display the window it actually inspected.
   */
  async findUnloggedChanges(
    products: {
      id: string;
      variantName: string;
      pricing?: unknown;
      stock?: Record<string, number>;
    }[],
  ): Promise<ReconciliationReport> {
    const sizes = ['cup', 'pint', 'halfGallon', 'gallon'] as const;
    const out: UnloggedChange[] = [];

    // ONE query for the whole pass, not one per product. `recent()` is already
    // this query: a lone `orderBy('createdAt','desc')`, so Firestore's automatic
    // single-field index serves it and no composite index is involved.
    const rows = await this.recent(RECONCILE_WINDOW);

    // Grouped in QUERY ORDER (newest first) and never re-sorted: the
    // opening-balance anchor below reads the LAST row of each size group as the
    // oldest, and a Map preserves insertion order, so each group stays
    // newest-first for free.
    const byProduct = new Map<string, StockMovement[]>();
    for (const row of rows) {
      const group = byProduct.get(row.productId);
      if (group) group.push(row);
      else byProduct.set(row.productId, [row]);
    }

    const catalogue = new Map(products.map((p) => [p.id, p]));
    for (const [productId, productRows] of byProduct) {
      // A movement for a flavor that is no longer in the catalogue has no stored
      // level to be compared against, so it is not drift and is not reported.
      const p = catalogue.get(productId);
      if (!p) continue;
      for (const size of sizes) {
        const forSize = productRows.filter((r) => r.size === size);
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
    return { changes: out, rowsScanned: rows.length, window: RECONCILE_WINDOW };
  }
}
