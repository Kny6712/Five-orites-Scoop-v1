// src/app/core/logic/money.ts
// Five-orites Scoop — Pesos rounding
//
// Framework-free so `npm run test:logic` can assert it directly.
//
// WHY THIS EXISTS
// Money was being accumulated and rounded in four places, each slightly
// differently: `series.ts` summed `grandTotal` floats with no rounding at all
// (so a cumulative-revenue line could render 1234.5600000000001), and
// `voucher.ts` FLOORED the percent path while the fixed path applied no
// rounding whatsoever. Two discount paths that disagree by half a peso is the
// kind of thing a customer notices on the receipt.
//
// The rule the shop wants: a peso is the smallest unit that matters, so every
// peso figure that leaves this codebase is a whole number of centavo.

/**
 * Rounds a peso amount to two decimal places.
 *
 * `Math.round` on `n * 100` handles the classic float representation error:
 * `1.005 * 100` is `100.49999999999999` in IEEE-754, so a naive
 * `Math.round(n * 100) / 100` gives `1` instead of `1.01`. Rounding the scaled
 * integer and dividing back is what makes this agree with what a calculator
 * shows, which is the whole point of a money helper.
 *
 * A non-finite input returns 0 rather than propagating `NaN` into a total.
 */
export function roundMoney(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Rounds a peso amount to a whole peso.
 *
 * Used where the data model demands an integer: `firestore.rules` requires
 * `pricing.*` to be an `int`, and the ledger's `delta`/`balanceAfter` columns
 * are counts of stock, not pesos.
 */
export function roundPeso(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount);
}

/**
 * Sums peso amounts without float drift.
 *
 * Adds into an integer number of centavo and converts back once at the end, so
 * a thousand `0.1` additions are `100.00` and not `99.99999999999997`.
 */
export function sumMoney(amounts: readonly number[]): number {
  let centavo = 0;
  for (const amount of amounts) {
    if (!Number.isFinite(amount)) continue;
    centavo += Math.round((amount + Number.EPSILON) * 100);
  }
  return centavo / 100;
}
