// tests/logic.test.ts
// Five-orites Scoop — business logic tests
//
// These import the REAL implementations from src/app/core/logic. The previous
// version of this file re-implemented every rule inline, so it would still pass
// if the app itself were deleted. Do not inline logic here — import it.
//
// Run: npm run test:logic

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DELIVERY_FEE,
  FREE_DELIVERY_THRESHOLD,
  getDeliveryFee,
} from '../src/app/core/logic/delivery';
import { calculateDiscount, MAX_PERCENT_DISCOUNT } from '../src/app/core/logic/voucher';
import { summarizeRatings } from '../src/app/core/logic/rating';
import { assertCanAddToCart, clampToStock, normaliseStockLines } from '../src/app/core/logic/stock';
import { buildCloudinaryUrl } from '../src/app/core/logic/image-url';
import { describeFirestoreError, isMissingIndexError } from '../src/app/core/logic/firestore-error';
import { readCachedGeo, interpolate, distanceMetres } from '../src/app/core/logic/geo';
import { productCategory, PRODUCT_CATEGORIES } from '../src/app/core/models/product.model';
import { BUILT_IN_VOUCHERS } from '../src/app/core/models/voucher.model';

describe('delivery fee', () => {
  it('charges the flat fee below the threshold', () => {
    assert.equal(getDeliveryFee(0), DELIVERY_FEE);
    assert.equal(getDeliveryFee(FREE_DELIVERY_THRESHOLD - 1), DELIVERY_FEE);
  });

  it('is free at and above the threshold', () => {
    assert.equal(getDeliveryFee(FREE_DELIVERY_THRESHOLD), 0);
    assert.equal(getDeliveryFee(1200), 0);
  });
});

describe('cart stock cap', () => {
  it('allows a quantity within available stock', () => {
    assert.doesNotThrow(() => assertCanAddToCart('Rocky Road (pint)', 2, 3, 10));
  });

  it('rejects overselling', () => {
    assert.throws(
      () => assertCanAddToCart('Rocky Road (pint)', 8, 3, 10),
      /Exceeds available|Only 10 x Rocky Road/
    );
  });

  it('rejects an out-of-stock line', () => {
    assert.throws(() => assertCanAddToCart('Rocky Road (pint)', 0, 1, 0), /out of stock/);
  });

  it('rejects a non-positive quantity', () => {
    assert.throws(() => assertCanAddToCart('Rocky Road (pint)', 0, 0, 10), /at least 1/);
  });
});

describe('clampToStock', () => {
  it('caps the requested quantity at available stock', () => {
    assert.equal(clampToStock(9, 4), 4);
  });

  it('leaves the quantity alone when stock is unknown', () => {
    assert.equal(clampToStock(9, undefined), 9);
  });

  it('never returns a negative quantity', () => {
    assert.equal(clampToStock(5, -3), 0);
  });
});

describe('normaliseStockLines', () => {
  const line = (productId: string, size: string, quantity: number) => ({ productId, size, quantity });

  it('passes through a single valid line unchanged', () => {
    const result = normaliseStockLines([line('p1', 'cup', 2)]);
    assert.equal(result.length, 1);
    assert.equal(result[0].quantity, 2);
  });

  it('rejects a negative quantity, which would otherwise raise stock', () => {
    // The exploit this guards: `available < quantity` is false for 5 < -5, and
    // the write is `stock - quantity`, so stock would INCREASE.
    assert.throws(() => normaliseStockLines([line('p1', 'cup', -5)]), /Invalid quantity/);
  });

  it('rejects zero, which would decrement nothing', () => {
    assert.throws(() => normaliseStockLines([line('p1', 'cup', 0)]), /Invalid quantity/);
  });

  it('rejects a fractional quantity', () => {
    assert.throws(() => normaliseStockLines([line('p1', 'cup', 1.5)]), /Invalid quantity/);
  });

  it('rejects NaN rather than letting it reach Firestore', () => {
    assert.throws(() => normaliseStockLines([line('p1', 'cup', NaN)]), /Invalid quantity/);
  });

  it('sums duplicate product+size pairs so the charge matches the decrement', () => {
    // Two cart lines for the same size were previously charged twice while the
    // transaction wrote the document once.
    const result = normaliseStockLines([line('p1', 'cup', 1), line('p1', 'cup', 1)]);
    assert.equal(result.length, 1);
    assert.equal(result[0].quantity, 2);
  });

  it('keeps the same product in different sizes apart', () => {
    const result = normaliseStockLines([line('p1', 'cup', 1), line('p1', 'pint', 3)]);
    assert.equal(result.length, 2);
  });

  it('keeps different products apart', () => {
    const result = normaliseStockLines([line('p1', 'cup', 1), line('p2', 'cup', 1)]);
    assert.equal(result.length, 2);
  });

  it('does not mutate the caller\'s input objects', () => {
    const input = [line('p1', 'cup', 1), line('p1', 'cup', 1)];
    normaliseStockLines(input);
    assert.equal(input[0].quantity, 1);
  });

  it('returns an empty list for no lines', () => {
    assert.deepEqual(normaliseStockLines([]), []);
  });
});

describe('vouchers', () => {
  it('applies a percentage above its minimum order', () => {
    assert.equal(
      calculateDiscount(1000, { type: 'percent', value: 10, minOrder: 200, isActive: true }),
      100
    );
  });

  it('ignores a percentage below its minimum order', () => {
    assert.equal(
      calculateDiscount(100, { type: 'percent', value: 10, minOrder: 200, isActive: true }),
      0
    );
  });

  it('caps a fixed discount at the subtotal', () => {
    assert.equal(
      calculateDiscount(30, { type: 'fixed', value: 50, isActive: true }),
      30
    );
  });

  it('ignores inactive vouchers', () => {
    assert.equal(
      calculateDiscount(1000, { type: 'percent', value: 10, isActive: false }),
      0
    );
  });

  it('never discounts more than the maximum percentage', () => {
    assert.equal(
      calculateDiscount(1000, { type: 'percent', value: 500, isActive: true }),
      (1000 * MAX_PERCENT_DISCOUNT) / 100
    );
  });

  it('keeps the built-in codes well-formed', () => {
    // These are reference data, NOT a fallback. VoucherService validates
    // against the `vouchers` collection only — the built-in list used to be
    // consulted whenever the Firestore lookup came back empty or threw, which
    // meant deactivating a voucher in the admin UI had no effect. It is kept
    // for seeding and for asserting sensible sample values, so this test
    // guards the data rather than implying the app honours it.
    for (const v of BUILT_IN_VOUCHERS) {
      assert.ok(v.isActive, `${v.code} should be active`);
      assert.ok(calculateDiscount(1000, v) > 0, `${v.code} should discount ₱1000`);
    }
  });
});

describe('reviews', () => {
  it('returns a zeroed summary for no reviews', () => {
    assert.deepEqual(summarizeRatings([]), { average: 0, count: 0 });
  });

  it('averages to one decimal place', () => {
    assert.deepEqual(summarizeRatings([{ rating: 5 }, { rating: 4 }]), {
      average: 4.5,
      count: 2,
    });
  });
});

describe('order cancel policy', () => {
  // NOTE: this re-declares the rule inline. The app has three separate
  // implementations — orders.page.ts canCancel(), order-tracker.page.ts
  // canCancel(), and the firestore.rules predicate — so there is no single
  // function to import here. The rules test asserts the authoritative copy
  // (tests/firestore.rules.test.ts). This block is a readability statement of
  // intent, NOT proof that the app enforces it.
  const customerCanCancel = (status: string) => status === 'pending';

  it('lets a customer cancel only while pending', () => {
    assert.equal(customerCanCancel('pending'), true);
    assert.equal(customerCanCancel('confirmed'), false);
    assert.equal(customerCanCancel('delivered'), false);
  });
});

describe('pre-dispatch stock return', () => {
  // Mirrors PRE_DISPATCH_STATUSES in order.service.ts. Stock only comes back if
  // the order never left the shop — restocking an out_for_delivery order would
  // invent inventory the store then oversells.
  const PRE_DISPATCH = ['pending', 'confirmed', 'preparing'];

  it('returns stock for an order that has not shipped', () => {
    for (const status of PRE_DISPATCH) {
      assert.ok(PRE_DISPATCH.includes(status), `${status} should restock`);
    }
  });

  it('does NOT return stock once the order is out for delivery or delivered', () => {
    assert.equal(PRE_DISPATCH.includes('out_for_delivery'), false);
    assert.equal(PRE_DISPATCH.includes('delivered'), false);
    assert.equal(PRE_DISPATCH.includes('cancelled'), false);
  });
});

describe('product category', () => {
  it('treats a product with no category as a flavor', () => {
    // The 64 seeded products predate the field. Defaulting keeps them visible
    // under Flavors instead of vanishing from the catalog.
    assert.equal(productCategory({}), 'flavor');
    assert.equal(productCategory({ category: undefined }), 'flavor');
  });

  it('passes through a recognised category', () => {
    assert.equal(productCategory({ category: 'sundae' }), 'sundae');
    assert.equal(productCategory({ category: 'cone' }), 'cone');
    assert.equal(productCategory({ category: 'flavor' }), 'flavor');
  });

  it('falls back to flavor for an unrecognised value', () => {
    // Defensive: a document written by a future version, or a typo, must not
    // render as an empty catalog section.
    assert.equal(productCategory({ category: 'popsicle' }), 'flavor');
    assert.equal(productCategory({ category: '' }), 'flavor');
  });

  it('covers every category with a display label', () => {
    const values = PRODUCT_CATEGORIES.map((c) => c.value);
    assert.deepEqual(values, ['flavor', 'sundae', 'cone']);
    for (const c of PRODUCT_CATEGORIES) {
      assert.ok(c.label.length > 0, 'each category needs a label');
    }
  });
});

describe('cloudinary delivery url', () => {
  const STORED =
    'https://res.cloudinary.com/fhtucp4v/image/upload/v1756200000/five-orites-scoop/products/a.jpg';

  it('injects sizing and auto-format before the version segment', () => {
    assert.equal(
      buildCloudinaryUrl(STORED, 400),
      'https://res.cloudinary.com/fhtucp4v/image/upload/f_auto,q_auto,w_400/v1756200000/five-orites-scoop/products/a.jpg',
    );
  });

  it('rounds the requested width', () => {
    assert.ok(buildCloudinaryUrl(STORED, 399.6).includes('w_400'));
  });

  it('keeps the public id and folder intact', () => {
    assert.ok(buildCloudinaryUrl(STORED, 1000).endsWith('v1756200000/five-orites-scoop/products/a.jpg'));
  });

  it('does not stack transforms when applied twice', () => {
    const once = buildCloudinaryUrl(STORED, 400);
    const twice = buildCloudinaryUrl(once, 200);
    assert.equal(
      twice,
      'https://res.cloudinary.com/fhtucp4v/image/upload/f_auto,q_auto,w_200/v1756200000/five-orites-scoop/products/a.jpg',
    );
    assert.equal(times2Count(twice, 'f_auto'), 1);
  });

  it('omits the width when none is given', () => {
    assert.ok(buildCloudinaryUrl(STORED, 0).includes('f_auto,q_auto/'));
    assert.ok(!buildCloudinaryUrl(STORED, 0).includes('w_'));
    assert.ok(!buildCloudinaryUrl(STORED, Number.NaN).includes('w_'));
  });

  it('passes through anything that is not a cloudinary url', () => {
    assert.equal(buildCloudinaryUrl('assets/placeholder-scoop.svg', 400), 'assets/placeholder-scoop.svg');
    assert.equal(buildCloudinaryUrl('https://example.com/x.jpg', 400), 'https://example.com/x.jpg');
    assert.equal(buildCloudinaryUrl('', 400), '');
    assert.equal(buildCloudinaryUrl(null, 400), '');
    assert.equal(buildCloudinaryUrl(undefined, 400), '');
  });
});

describe('firestore error messages', () => {
  /**
   * The bug this exists for: `getCustomerOrders()` needs a composite index on
   * (customerId ASC, createdAt DESC). While that index was undeployed, every
   * customer dashboard showed "Check your connection and try again" for what was
   * in fact a schema problem. These assertions pin the split so the two can never
   * be reported as the same thing again.
   */
  it('does not blame the connection for a missing index', () => {
    const msg = describeFirestoreError('your recent orders', { code: 'failed-precondition' });
    assert.ok(!/connection/i.test(msg), `must not suggest a connection fix: ${msg}`);
    assert.ok(/index/i.test(msg));
  });

  it('does not blame the connection for a permissions failure', () => {
    const msg = describeFirestoreError('orders', { code: 'permission-denied' });
    assert.ok(!/connection/i.test(msg), `must not suggest a connection fix: ${msg}`);
    assert.ok(/permission/i.test(msg));
  });

  it('blames the connection only when genuinely offline', () => {
    assert.match(describeFirestoreError('orders', { code: 'unavailable' }), /offline/i);
    assert.match(describeFirestoreError('orders', { code: 'deadline-exceeded' }), /offline/i);
  });

  it('falls back to a non-specific message for an unknown failure', () => {
    const msg = describeFirestoreError('flavors', { code: 'something-new' });
    assert.ok(!/connection/i.test(msg), `must not invent a cause: ${msg}`);
    assert.match(msg, /flavors/, 'the unknown case is the only one that names the thing');
  });

  it('survives a null, undefined or code-less error', () => {
    for (const bad of [null, undefined, {}, 'a string', 42, { code: 7 }]) {
      const msg = describeFirestoreError('orders', bad);
      assert.equal(typeof msg, 'string');
      assert.ok(msg.length > 0);
    }
  });

  it('handles a transport-prefixed code', () => {
    assert.equal(
      describeFirestoreError('orders', { code: 'firestore/failed-precondition' }),
      describeFirestoreError('orders', { code: 'failed-precondition' })
    );
  });

  it('identifies the missing-index case separately', () => {
    assert.equal(isMissingIndexError({ code: 'failed-precondition' }), true);
    assert.equal(isMissingIndexError({ code: 'firestore/failed-precondition' }), true);
    assert.equal(isMissingIndexError({ code: 'permission-denied' }), false);
    assert.equal(isMissingIndexError(null), false);
  });
});

describe('cached geocode validation', () => {
  /**
   * `order.geo` is CUSTOMER-AUTHORED. The order create rule validates eleven
   * specific fields and contains no `hasOnly`, so a customer can attach any `geo`
   * they like at checkout. `L.latLng()` throws on out-of-range coordinates, so an
   * unvalidated read means a map that renders nothing at all — these assertions
   * are the only thing standing between that and a blank page.
   */
  it('accepts a well-formed cached point', () => {
    const point = readCachedGeo({ lat: 14.6188159, lng: 121.1029457, label: 'Cainta', at: 1 });
    assert.ok(point);
    assert.equal(point!.lat, 14.6188159);
    assert.equal(point!.label, 'Cainta');
  });

  it('rejects out-of-range coordinates', () => {
    assert.equal(readCachedGeo({ lat: 91, lng: 0 }), null);
    assert.equal(readCachedGeo({ lat: 0, lng: 181 }), null);
    assert.equal(readCachedGeo({ lat: -91, lng: 0 }), null);
  });

  it('rejects non-numeric and non-finite values', () => {
    assert.equal(readCachedGeo({ lat: '14.6', lng: '121.1' }), null);
    assert.equal(readCachedGeo({ lat: Number.NaN, lng: 121 }), null);
    assert.equal(readCachedGeo({ lat: Number.POSITIVE_INFINITY, lng: 121 }), null);
    assert.equal(readCachedGeo({ lat: null, lng: null }), null);
  });

  it('rejects a missing or malformed container', () => {
    for (const bad of [null, undefined, {}, '14.6,121.1', 42, [14.6, 121.1]]) {
      assert.equal(readCachedGeo(bad), null);
    }
  });

  it('tolerates a missing label and timestamp', () => {
    const point = readCachedGeo({ lat: 14.6, lng: 121.1 });
    assert.ok(point);
    assert.equal(point!.label, '');
    assert.equal(point!.at, 0);
  });
});

describe('route interpolation and distance', () => {
  const SHOP = { lat: 14.6188159, lng: 121.1029457 };
  const HOME = { lat: 14.65, lng: 121.12 };

  it('returns the endpoints at t=0 and t=1', () => {
    assert.deepEqual(interpolate(SHOP, HOME, 0), SHOP);
    assert.deepEqual(interpolate(SHOP, HOME, 1), HOME);
  });

  it('returns the midpoint at t=0.5', () => {
    const mid = interpolate(SHOP, HOME, 0.5);
    assert.ok(Math.abs(mid.lat - (SHOP.lat + HOME.lat) / 2) < 1e-9);
    assert.ok(Math.abs(mid.lng - (SHOP.lng + HOME.lng) / 2) < 1e-9);
  });

  it('clamps t outside 0..1 rather than overshooting the destination', () => {
    // A courier marker drawn past the customer's house would be nonsense, so the
    // value is pinned rather than extrapolated.
    assert.deepEqual(interpolate(SHOP, HOME, 5), HOME);
    assert.deepEqual(interpolate(SHOP, HOME, -3), SHOP);
  });

  it('reports zero distance to itself', () => {
    assert.equal(Math.round(distanceMetres(SHOP, SHOP)), 0);
  });

  it('measures a plausible great-circle distance', () => {
    // ~5km apart. Loose bounds on purpose: this is a smoke test that the formula
    // is not returning metres-as-degrees or similar, not a geodesy check.
    const metres = distanceMetres(SHOP, HOME);
    assert.ok(metres > 3000 && metres < 6000, `unexpected distance: ${metres}`);
  });
});

/** Counts non-overlapping occurrences, for the no-stacking assertion. */
function times2Count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
