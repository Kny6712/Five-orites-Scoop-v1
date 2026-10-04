// src/app/core/logic/ledger-reconcile.ts
// Five-orites Scoop — the arithmetic behind the stock integrity check
//
// WHY A SEPARATE MODULE. Framework-free and pure, so `tests/logic.test.ts`
// imports the same code the app runs rather than a reimplementation of it. This is
// the arrangement the rest of `core/logic` follows, and it is the reason those
// tests are worth anything: the alternative is testing a copy, which passes while
// the service disagrees.
//
// This exists because the arithmetic was previously buried inside an Angular
// service method behind `inject(Firestore)`, where it could only be reached with
// the Firestore emulator running. The arithmetic is the part with the subtlety in
// it, and it was the part with no tests.
//
// THE ONE NON-TRIVIAL RULE: a reset row starts a new epoch.
//
// A movement is normally a DELTA ("this much stock went in or out"), and the level
// it implies depends on everything before it. That only works if the chain is
// coherent from the very beginning. It was not, and the reason is mundane:
// `createProduct` wrote a product's stock onto the product document without
// logging any movement at all, and the CSV importer calls the same method.
//
// So a row may instead be an ASSERTION of truth — "as of now, this product is at
// N" — recorded with `reason: 'stock_intake'` (a product being born) or
// `reason: 'baseline'` (a one-off migration of existing stock). Everything before
// such a row describes a level it supersedes, and summing those rows would
// double-count. The anchor is therefore the oldest RESET row when one exists, and
// the oldest row overall when none does.
//
// Concretely, this is what repairs a product whose history is incoherent:
//
//   balanceAfter=2   +1   admin_restock     <- the bad anchor, implies a level of 1
//   balanceAfter=51  +1   admin_restock
//   balanceAfter=49  -2   sale
//   balanceAfter=48  -1   manual_adjust
//   balanceAfter=48  +48  baseline          <- NEW: asserts the level is 48
//
// Without the epoch rule the anchor stays at the first row, the deltas sum to -1,
// and the check reports "expected 0, stored 48, drift +48" — confidently wrong,
// and wrong in a way that looks like tampering. With it, the anchor is the
// baseline row, the opening is 0, and the level is 48, exactly as stored.

/**
 * The minimum a row needs for this arithmetic. Deliberately structural rather
 * than the service's `StockMovement`: a row read back from Firestore has an
 * `unknown` `createdAt` and an id the tests have no reason to invent, and
 * depending on the full interface would make every test build scaffolding it does
 * not care about.
 */
/**
 * The reasons a movement row can carry.
 *
 * WHY IT LIVES HERE AND NOT IN `stock-ledger.service.ts`.
 *
 * It was there, and importing it from `tests/logic.test.ts` made the ENTIRE
 * suite fail to load — that service imports `@angular/fire/firestore` and calls
 * `inject()`, neither of which exists under `node:test`. The vocabulary is pure
 * data with no behaviour, so it belongs beside the pure function that keys off it.
 * The service re-exports it, so every existing import keeps working and there is
 * still exactly one definition.
 */
export type StockReason =
  'manual_adjust' | 'admin_restock' | 'sale' | 'cancel_restock' | 'stock_intake' | 'baseline';

/** Rendered as a chip in the movements table, never translated. */
export const STOCK_REASON_LABELS: Record<StockReason, string> = {
  manual_adjust: 'Adjusted in inventory',
  admin_restock: 'Restocked',
  sale: 'Sold',
  cancel_restock: 'Cancelled order returned',
  stock_intake: 'Stock recorded at creation',
  baseline: 'Opening balance recorded',
};

/**
 * Reasons that assert a level rather than describe a change to it.
 *
 * The anchor for a size's history, and therefore the difference between a
 * meaningful integrity check and a confident false positive. Typed against
 * `StockReason`, so adding a reason to the union without considering this set is
 * a visible decision rather than a silent omission.
 */
export const RESET_REASONS: ReadonlySet<StockReason> = new Set<StockReason>([
  'stock_intake',
  'baseline',
]);

export interface ReconcileRow {
  /** Signed: positive is stock in, negative is stock out. */
  delta: number;
  /** Stock after the change. */
  balanceAfter: number;
  reason: string;
  size: string;
}

export interface SizeReconciliation {
  /** The level the ledger implies, or null when there is nothing to compare. */
  expected: number | null;
  /** True when at least one row existed, i.e. the value could be checked at all. */
  anchored: boolean;
  /** Rows the anchor superseded, which were read but deliberately not summed. */
  supersededRows: number;
}

/**
 * The level a size's ledger rows imply.
 *
 * @param rows   Every row for ONE product and ONE size, NEWEST FIRST — the order
 *               `orderBy('createdAt','desc')` returns. The order matters and is
 *               not incidental: the anchor is found by taking the LAST matching
 *               row, so passing these oldest-first silently anchors on the wrong
 *               end of the history.
 * @param stored The level on the product document, for comparison by the caller.
 */
export function reconcileSize(rows: readonly ReconcileRow[]): SizeReconciliation {
  if (rows.length === 0) {
    // No history at all. Returning 0 here would be the single most damaging thing
    // this function could do: a product born with 48 cups and no opening movement
    // would be reported as "expected 0", which is indistinguishable from real
    // tampering. Null means "cannot be checked", which is the truth.
    return { expected: null, anchored: false, supersededRows: 0 };
  }

  /**
   * The epoch lookup, widened to `string`.
   *
   * `RESET_REASONS` is typed `ReadonlySet<StockReason>` so that adding a reason to
   * the vocabulary without considering this set is a visible decision. But a row
   * read back from Firestore carries whatever `reason` string was actually stored —
   * possibly one written by a future build, or a typo — so the membership test has
   * to accept a plain `string`. `ReadonlySet` is covariant, so this is a widening
   * assignment rather than a cast, and the typed set stays the single definition.
   */
  const RESET_LOOKUP: ReadonlySet<string> = RESET_REASONS;

  const resets = rows.filter((r) => RESET_LOOKUP.has(r.reason));
  const anchor = resets.length ? resets[resets.length - 1] : rows[rows.length - 1];

  const anchorIndex = rows.indexOf(anchor);

  /**
   * The anchor plus everything NEWER than it — and "newer" is to the LEFT, because
   * `rows` is newest-first. `slice(anchorIndex)` was the first attempt and it was
   * wrong in a way the tests caught immediately: it selects the anchor and
   * everything older, which with no reset row means the anchor ALONE, silently
   * discarding every movement after it and reporting a level nobody ever held.
   */
  const sinceAnchor = rows.slice(0, anchorIndex + 1);

  const loggedSum = sinceAnchor.reduce((sum, r) => sum + (r.delta ?? 0), 0);
  const opening = (anchor.balanceAfter ?? 0) - (anchor.delta ?? 0);

  return {
    expected: opening + loggedSum,
    anchored: true,
    // Rows strictly OLDER than the anchor, i.e. to the right of it in this order.
    // They were read and deliberately not summed.
    supersededRows: rows.length - 1 - anchorIndex,
  };
}

/** The four sizes reconciliation runs over. Mirrors `SIZE_VARIANTS`. */
export const RECONCILE_SIZES = ['cup', 'pint', 'halfGallon', 'gallon'] as const;
