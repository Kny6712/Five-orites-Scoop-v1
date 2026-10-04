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
import {
  RECONCILE_SIZES,
  reconcileSize,
  RESET_REASONS,
  STOCK_REASON_LABELS,
  type StockReason,
} from '../logic/ledger-reconcile';

/**
 * Re-exported, not redefined.
 *
 * The reason vocabulary and the epoch rule are pure data and belong in
 * `core/logic`, where `tests/logic.test.ts` can import them — importing them from
 * here instead made the whole suite fail to load, because this service calls
 * `inject()` and imports AngularFire. Keeping the definitions there and
 * re-exporting means every existing consumer of these names keeps working and
 * there is still exactly one copy. See `ledger-reconcile.ts`.
 */
export { STOCK_REASON_LABELS, type StockReason };

/** Alias kept for callers that want to be explicit about what the set means. */
export const STOCK_REASON_RESET = RESET_REASONS;

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
 *
 * WHY `unverifiable` AND `verified` EXIST, and this is the second honesty bug in
 * this feature.
 *
 * The pass previously returned only `changes`, and any product/size with no
 * movement rows was skipped without a word. The panel then read "1 stock value
 * does not match the ledger" — which implies the other 65 products were compared
 * and are clean. They were never compared. `createProduct` writes stock straight
 * onto the product document with no movement row, and the CSV importer calls the
 * same method, so in the live catalogue 65 of 66 products had NO history at all
 * and only 4 movement rows existed in the entire project.
 *
 * So the pass was reporting one real finding while implying 65 clean bills of
 * health it had never checked. `verified` counts the stock values actually
 * compared and found to agree; `unverifiable` counts those with no anchor to
 * compare against. A reader can then see that "1 drifted" sits inside a much
 * larger "0 verified".
 *
 * `totalStockValues` is the denominator: products x sizes. It is what makes the
 * three counts add up, so the panel cannot quietly under-report.
 */
export interface ReconciliationReport {
  changes: UnloggedChange[];
  rowsScanned: number;
  window: number;
  /** Stock values with a usable anchor whose stored level AGREES with the ledger. */
  verified: number;
  /** Stock values with no anchor at all — never compared, so never cleared. */
  unverifiable: number;
  /** products x sizes, the denominator the other two counts sit inside. */
  totalStockValues: number;
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
   * THE ANCHOR IS AN EPOCH, NOT "THE OLDEST ROW".
   *
   * The opening balance is taken as `balanceAfter - delta` of an anchor row, and
   * everything at or after that row is summed. Previously the anchor was simply
   * the oldest row visible, which is correct only while the history is coherent
   * from the very beginning.
   *
   * It was not. `createProduct` writes stock onto the product document with no
   * movement row, and the CSV importer calls the same method, so seeded stock
   * never entered the ledger. In the live catalogue that produced exactly this:
   * four movement rows for one flavour, whose oldest said `balanceAfter: 2` and
   * whose newest said `48` — a chain that contradicts itself, which the old
   * anchor faithfully reconstructed as 0 and reported as "+48 drift".
   *
   * So the anchor is now the oldest row whose reason is in `STOCK_REASON_RESET`
   * (`stock_intake` or `baseline`), falling back to the oldest row overall when
   * there is none. A row that asserts "as of now this is N" supersedes
   * everything before it, which is what makes `scripts/baseline-ledger.ts`
   * actually repair a product — without deleting the incoherent rows above it,
   * which `firestore.rules` rightly forbids and which would throw away history.
   *
   * COVERAGE IS THE WINDOW, NOT THE CATALOGUE, and it is now COUNTED. One
   * ordered read of the newest `RECONCILE_WINDOW` rows replaces the old
   * query-per-product sweep (up to 12,800 reads per press). A flavour whose
   * movements all predate the window has no anchor inside it and is counted as
   * `unverifiable` — never as clean. Returning `verified` and `unverifiable`
   * alongside `changes` is what stops the panel implying that silence means
   * agreement; see `ReconciliationReport`.
   */
  async findUnloggedChanges(
    products: {
      id: string;
      variantName: string;
      pricing?: unknown;
      stock?: Record<string, number>;
    }[],
  ): Promise<ReconciliationReport> {
    // The shared list, not a second literal: `totalStockValues` is derived from it,
    // so a copy here would silently change the denominator the panel divides by.
    const sizes = RECONCILE_SIZES;
    const out: UnloggedChange[] = [];

    // ONE query for the whole pass, not one per product. `recent()` is already
    // this query: a lone `orderBy('createdAt','desc')`, so Firestore's automatic
    // single-field index serves it and no composite index is involved.
    const rows = await this.recent(RECONCILE_WINDOW);

    // Grouped in QUERY ORDER (newest first) and never re-sorted: the anchor
    // lookup below reads the LAST matching row as the oldest, and a Map preserves
    // insertion order, so each group stays newest-first for free.
    const byProduct = new Map<string, StockMovement[]>();
    for (const row of rows) {
      const group = byProduct.get(row.productId);
      if (group) group.push(row);
      else byProduct.set(row.productId, [row]);
    }

    let verified = 0;
    let unverifiable = 0;

    for (const p of products) {
      const productRows = byProduct.get(p.id);
      for (const size of sizes) {
        // Scoped to the CATALOGUE, not to the groups: a product with no movement
        // rows never appears as a key in `byProduct`, so iterating the map instead
        // would silently skip it — which is precisely the 65 products this pass
        // used to pretend it had cleared.
        //
        // Rows arrive newest-first, which `reconcileSize` requires: the anchor is
        // the LAST matching row, so the order is load-bearing, not incidental.
        const forSize = (productRows ?? []).filter((r) => r.size === size);
        const { expected, anchored } = reconcileSize(forSize);
        if (!anchored || expected === null) {
          // Never compared, so never cleared. Counting it is what stops the report
          // implying that silence means agreement — `reconcileSize` returns null
          // rather than 0 precisely so "no history" cannot be mistaken for drift.
          unverifiable++;
          continue;
        }

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
        } else {
          verified++;
        }
      }
    }

    // Movements for a flavour that has since been deleted from the catalogue are
    // read but never compared — there is no stored level to compare them against.
    // They are deliberately NOT added to `unverifiable`, which counts stock
    // values in the catalogue; a deleted flavour has no stock value left to check.
    return {
      changes: out,
      rowsScanned: rows.length,
      window: RECONCILE_WINDOW,
      verified,
      unverifiable,
      totalStockValues: products.length * sizes.length,
    };
  }
}
