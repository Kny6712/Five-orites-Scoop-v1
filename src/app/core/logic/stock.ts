// src/app/core/logic/stock.ts
// Five-orites Scoop — Pure stock rules
//
// Deliberately free of Angular and Firebase imports so the unit tests can
// import this module directly instead of re-implementing the rules. If the app
// and the tests ever disagree, the tests are wrong.

/**
 * Validates that `addQty` more units of a line may be added to the cart.
 * Throws a user-facing message on violation.
 *
 * @param label      Human-readable line label, e.g. "Rocky Road (pint)".
 * @param existingQty Units of this exact line already in the cart.
 * @param addQty     Units the caller wants to add. Must be >= 1.
 * @param available  Units currently in stock. Must be > 0.
 */
export function assertCanAddToCart(
  label: string,
  existingQty: number,
  addQty: number,
  available: number
): void {
  if (addQty <= 0) throw new Error('Quantity must be at least 1.');
  if (available <= 0) throw new Error(`${label} is out of stock.`);
  if (existingQty + addQty > available) {
    throw new Error(
      `Only ${available} x ${label} available. You already have ${existingQty} in cart.`
    );
  }
}

/** Clamps a requested quantity to what is actually available (never below 0). */
export function clampToStock(quantity: number, available: number | undefined): number {
  if (available === undefined) return quantity;
  return Math.min(quantity, Math.max(available, 0));
}

/**
 * Every size the catalog sells, in display order.
 *
 * Typed as a plain string tuple, NOT as `SizeVariant`: that type lives in
 * product.model.ts, which imports Timestamp from @angular/fire/firestore, and
 * this module is required to stay free of Angular and Firebase so the unit
 * tests can import it directly. See the note at the top of this file.
 */
export const SIZE_VARIANTS = ['cup', 'pint', 'halfGallon', 'gallon'] as const;

/**
 * Validates and collapses the stock movements a checkout is about to apply.
 *
 * Two reasons this is not a plain `for` loop:
 *
 * 1. Quantities are attacker-controlled. The cart is rehydrated from
 *    localStorage, and a negative quantity passes a naive
 *    `available < quantity` test (`5 < -5` is false) and then *raises* stock,
 *    because the write is `stock - quantity`. Every quantity is therefore
 *    required to be a whole number of at least 1.
 * 2. Duplicate product/size pairs are summed. The transaction writes each
 *    document once, so two separate lines for the same size were charged
 *    twice while only one decrement was applied.
 */
export function normaliseStockLines<T extends { productId: string; size: string; quantity: number }>(
  lines: readonly T[]
): T[] {
  const merged = new Map<string, T>();
  for (const line of lines) {
    const quantity = line.quantity;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`Invalid quantity for ${line.size}: must be a whole number of 1 or more.`);
    }
    const key = `${line.productId}|${line.size}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += quantity;
    else merged.set(key, { ...line });
  }
  return [...merged.values()];
}
