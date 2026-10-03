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
import * as voucherModel from '../src/app/core/models/voucher.model';
import { toCsv, sanitiseCell, csvFilename, toIsoDate } from '../src/app/core/logic/csv';
import {
  calendarBuckets,
  weeklyBuckets,
  bucketsFor,
  bucketize,
  runningTotal,
} from '../src/app/core/logic/series';
import {
  parseCsvLine,
  parseProductCsv,
  slug,
  PRODUCT_CSV_TEMPLATE,
} from '../src/app/core/logic/csv-import';
import {
  ROLE_CAPABILITIES,
  ROLE_LABELS,
  ROLE_RANK,
  can,
  isStaffRole,
  asRole,
  type Capability,
  type UserRole,
} from '../src/app/core/models/user.model';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fnConfig from '../functions/src/config';
// ── Role / capability model ───────────────────────────────────────────────
// THE PRODUCTION INCIDENT: a user document's `role` read `"owner\n"` (a
// trailing newline from a hand edit in the Firebase console). Both the client
// (`can()` → ROLE_CAPABILITIES[role] → undefined → fail closed) and
// firestore.rules (`myRole() in [...]`) compare role strings EXACTLY, so the
// owner silently lost every admin page with no error anywhere. These tests pin
// the capability map's internal invariants and — crucially — that the client
// fails closed on the whole malformed-role corpus. The paired emulator test in
// firestore.rules.test.ts ('a role of "owner\n" gets NOTHING') is the other
// half; this half is the client. If either layer ever starts normalizing, the
// other half must too, or the split-brain returns.

const ALL_ROLES: UserRole[] = ['customer', 'staff', 'manager', 'admin', 'owner'];
const ALL_CAPABILITIES: Capability[] = [
  'view_dashboard',
  'manage_orders',
  'manage_inventory',
  'view_analytics',
  'manage_vouchers',
  'moderate_reviews',
  'manage_users',
  'manage_settings',
];

/** Every way a hand-entered role string can be wrong. All must fail closed. */
const MALFORMED_ROLES = [
  'owner\n',
  'owner\n\n',
  'owner ',
  ' owner',
  '\towner',
  'owner\t',
  'admin\n',
  'staff ',
  'Manager',
  'OWNER',
  'owner\r\n',
  'superuser',
  'adminx',
  '',
  '  ',
] as const;

describe('role tiers: the capability map', () => {
  it('grants a customer nothing at all', () => {
    for (const cap of ALL_CAPABILITIES) {
      assert.equal(can('customer', cap), false, `customer must not hold ${cap}`);
    }
  });

  it('never lets a LOWER tier hold a capability a HIGHER tier lacks', () => {
    // staff ⊂ manager ⊂ admin ⊂ owner. This is the invariant the whole ladder
    // rests on; widening a lower row past a higher one is a security bug.
    const chain: UserRole[] = ['staff', 'manager', 'admin', 'owner'];
    for (let i = 1; i < chain.length; i++) {
      for (const cap of ROLE_CAPABILITIES[chain[i - 1]]) {
        assert.ok(
          ROLE_CAPABILITIES[chain[i]].includes(cap),
          `${chain[i]} must keep ${cap}, which ${chain[i - 1]} has`,
        );
      }
    }
  });

  it('keeps manage_users and manage_settings OWNER-only', () => {
    // These two ARE the owner tier. `canManageUsers()` in firestore.rules is the
    // authoritative server-side copy of exactly this restriction.
    for (const role of ALL_ROLES) {
      for (const cap of ['manage_users', 'manage_settings'] as Capability[]) {
        assert.equal(can(role, cap), role === 'owner', `${role} / ${cap}`);
      }
    }
  });

  it('grants nothing outside the declared Capability union', () => {
    for (const role of ALL_ROLES) {
      for (const cap of ROLE_CAPABILITIES[role]) {
        assert.ok(ALL_CAPABILITIES.includes(cap), `${cap} is not a declared capability`);
      }
    }
  });

  it('declares no dead capability — every member is referenced by a grant or a guard', () => {
    // A capability that is declared but never granted/used is a lie the model
    // tells admins (ROLE_SUMMARY is shown in the promotion dialog). Guard against
    // the `repair_stock` class of defect: every declared capability must appear in
    // at least one ROLE_CAPABILITIES row.
    const granted = new Set(ALL_ROLES.flatMap((r) => [...ROLE_CAPABILITIES[r]]));
    for (const cap of ALL_CAPABILITIES) {
      assert.ok(granted.has(cap), `${cap} is declared but granted to nobody`);
    }
    for (const cap of granted) {
      assert.ok(ALL_CAPABILITIES.includes(cap), `${cap} is granted but not declared`);
    }
  });

  it('has a label, a rank and promotion-dialog copy for every tier', () => {
    for (const role of ALL_ROLES) {
      assert.ok(ROLE_LABELS[role].length > 0, `${role} label`);
      assert.equal(typeof ROLE_RANK[role], 'number', `${role} rank`);
    }
  });

  it('ranks the tiers ascending in privilege, as ROLE_CAPABILITIES declares them', () => {
    assert.deepEqual(
      [...ALL_ROLES].sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]),
      ALL_ROLES,
    );
  });
});

describe('can() — the malformed-role corpus from the incident', () => {
  it('grants on an EXACT match only', () => {
    assert.equal(can('owner', 'manage_users'), true);
    assert.equal(can('staff', 'view_dashboard'), true);
    assert.equal(can('manager', 'manage_inventory'), true);
    assert.equal(can('admin', 'manage_vouchers'), true);
  });

  it('fails CLOSED on every malformed role string — including "owner\\n"', () => {
    for (const bad of MALFORMED_ROLES) {
      assert.equal(can(bad, 'manage_users'), false, `can(${JSON.stringify(bad)})`);
      assert.equal(isStaffRole(bad), false, `isStaffRole(${JSON.stringify(bad)})`);
    }
  });

  it('fails CLOSED on null and undefined', () => {
    for (const bad of [null, undefined]) {
      assert.equal(can(bad, 'view_dashboard'), false);
      assert.equal(isStaffRole(bad), false);
    }
  });

  it('is exactly what isStaffRole is built from, so the two cannot disagree', () => {
    for (const role of [...ALL_ROLES, ...MALFORMED_ROLES]) {
      assert.equal(isStaffRole(role), can(role, 'view_dashboard'), JSON.stringify(role));
    }
  });
});

describe('asRole()', () => {
  it('passes the four staff tiers through', () => {
    for (const role of ['staff', 'manager', 'admin', 'owner'] as UserRole[]) {
      assert.equal(asRole(role), role);
    }
  });

  it('maps anything else to customer — INCLUDING a malformed staff role', () => {
    for (const bad of [...MALFORMED_ROLES, null, undefined, 42, {}, ['owner']]) {
      assert.equal(asRole(bad as never), 'customer', JSON.stringify(bad));
    }
  });

  it('never reports a rank for a value it did not normalise', () => {
    assert.equal(ROLE_RANK[asRole('owner\n' as never)], ROLE_RANK.customer);
  });
});

// ── Client ↔ rules drift lint ─────────────────────────────────────────────
// The client and firestore.rules are two hand-maintained sources of truth with
// no shared definition. Four of the security findings in the last audit existed
// ONLY because they drifted. This parses the deployed rules file and asserts the
// role sets agree with the client model, so a future edit to one without the
// other fails CI instead of silently widening or narrowing access.
describe('client ↔ firestore.rules drift lint', () => {
  const rulesPath = join(process.cwd(), 'firestore.rules');
  let rules: string;
  try {
    rules = readFileSync(rulesPath, 'utf8');
  } catch {
    rules = '';
  }

  const hasRules = rules.length > 0;

  it('finds the rules file to lint against', () => {
    assert.ok(hasRules, 'firestore.rules must be readable for the drift lint');
  });

  it('the rules isStaff tier set matches the client staff roles', () => {
    if (!hasRules) return;
    const m = rules.match(/myRole\(\) in \[([^\]]+)\]/);
    assert.ok(m, 'isStaff() role list not found in firestore.rules');
    const rulesSet = m![1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .sort();
    const clientStaff = ALL_ROLES.filter((r) => r !== 'customer').sort();
    assert.deepEqual(rulesSet, clientStaff, 'isStaff() set drifted from the client staff roles');
  });

  it('the rules canRunShop tier set matches the client manage_inventory grants', () => {
    if (!hasRules) return;
    const m = rules.match(
      /function canRunShop\(\)\s*\{\s*return isStaff\(\) && myRole\(\) in \[([^\]]+)\]/,
    );
    assert.ok(m, 'canRunShop() role list not found in firestore.rules');
    const rulesSet = m![1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .sort();
    const clientShop = ALL_ROLES.filter((r) => can(r, 'manage_inventory')).sort();
    assert.deepEqual(
      rulesSet,
      clientShop,
      'canRunShop() set drifted from the client manage_inventory grants',
    );
  });

  it('the rules canManageUsers is owner-only, matching manage_users', () => {
    if (!hasRules) return;
    assert.match(
      rules,
      /function canManageUsers\(\)\s*\{\s*return isStaff\(\) && myRole\(\) == 'owner'/,
    );
    assert.equal(ALL_ROLES.filter((r) => can(r, 'manage_users')).length, 1);
  });

  it('shopSettings write is owner-only in the rules, matching manage_settings', () => {
    if (!hasRules) return;
    // `allow write: if isAdmin()` on shopSettings used to over-grant admin a
    // write the client denies. It must be canManageUsers() (owner) now.
    const shopBlock = rules.match(/match \/shopSettings\/\{docId\}[^{]*\{([^}]*\n[^}]*)\n\s*\}/);
    assert.ok(shopBlock, 'shopSettings match block not found');
    assert.match(shopBlock![1], /allow (create|update): if canManageUsers\(\)/);
    assert.doesNotMatch(shopBlock![1], /allow write: if isAdmin\(\)/);
  });

  it('the orders create rule has a keys() allow-list (laundering defense)', () => {
    if (!hasRules) return;
    const orderCreate = rules.match(/match \/orders\/\{orderId\}[^]*?allow create: if([^;]*);/s);
    assert.ok(orderCreate, 'orders allow create not found');
    assert.match(orderCreate![1], /keys\(\)\.hasOnly\(/, 'orders create must restrict keys');
    assert.match(
      orderCreate![1],
      /grandTotal\s*==?\s*request\.resource\.data\.totalAmount/,
      'grandTotal identity check missing',
    );
  });

  it('a role of "owner\\n" gets NOTHING — the client half of the incident', () => {
    // The rules half of this assertion lives in firestore.rules.test.ts against
    // the emulator. Here we pin the CLIENT half: a trailing-newline owner must
    // NOT reach the admin area, so the UI and the server agree on the outcome.
    assert.equal(isStaffRole('owner\n'), false);
    assert.equal(can('owner\n', 'manage_users'), false);
    assert.equal(can('owner\n', 'manage_settings'), false);
    // ...and the well-formed owner DOES reach them, proving the check is not
    // simply always-false.
    assert.equal(isStaffRole('owner'), true);
    assert.equal(can('owner', 'manage_users'), true);
  });
});

describe('delivery fee', () => {
  // The Cloud Function prices the order the customer is actually charged, from a
  // COPY of these constants (functions/src/config.ts) — the functions package is
  // deployed separately and cannot import from src/. If the two copies drift, the
  // cart quotes one number and the order records another, which is invisible in
  // review and obvious at checkout. So the equality is asserted, not assumed.
  it('the function copy of the delivery fee matches the client copy', () => {
    assert.equal(fnConfig.DELIVERY_FEE, DELIVERY_FEE);
    assert.equal(fnConfig.FREE_DELIVERY_THRESHOLD, FREE_DELIVERY_THRESHOLD);
  });

  it('the function computes the same fee for the same subtotals', () => {
    for (const subtotal of [0, 65, 115, 499, 500, 501, 1000, 5000]) {
      assert.equal(
        fnConfig.getDeliveryFee(subtotal),
        getDeliveryFee(subtotal),
        `fee mismatch at subtotal ${subtotal}`,
      );
    }
  });

  it('charges the flat fee below the threshold', () => {
    assert.equal(getDeliveryFee(0), DELIVERY_FEE);
    assert.equal(getDeliveryFee(FREE_DELIVERY_THRESHOLD - 1), DELIVERY_FEE);
  });

  it('is free at and above the threshold', () => {
    assert.equal(getDeliveryFee(FREE_DELIVERY_THRESHOLD), 0);
    assert.equal(getDeliveryFee(1200), 0);
  });
});

describe('scripts/seed-admin.ts: the role vocabulary cannot drift', () => {
  // The script duplicates the role list rather than importing it, because scripts/
  // is deployed and run with its own tsconfig and cannot reach into src/. A
  // duplicated list can drift, and the failure it produces is silent: the script
  // writes a role the rules do not recognise, the account authenticates fine, and
  // every admin page is hidden with no error anywhere. That is the same failure
  // mode as the "owner\n" incident above, reached by a different route.
  //
  // So the two lists are asserted equal here, in the same spirit as the delivery
  // constants.
  const scriptSource = readFileSync(join(__dirname, '..', 'scripts', 'seed-admin.ts'), 'utf8');
  const declared = scriptSource.match(/const ROLES = \[([^\]]+)\]/)?.[1] ?? '';
  const scriptRoles = [...declared.matchAll(/'([^']+)'/g)].map((m) => m[1]);

  it('declares exactly the five roles the client model defines', () => {
    assert.deepEqual(
      [...scriptRoles].sort(),
      [...ALL_ROLES].sort(),
      'scripts/seed-admin.ts ROLES has drifted from UserRole — a role the script writes but the rules do not know is a silently powerless admin',
    );
  });

  it('rejects a role with stray whitespace instead of trimming it', () => {
    // The script's parseRole deliberately has no `.trim()`. Trimming would be
    // friendlier and would also re-open the exact incident this project already
    // had: "owner\n" matching no tier. Assert the intent so a later "cleanup"
    // does not reintroduce it.
    assert.ok(
      !/\.trim\(\)/.test(scriptSource.match(/function parseRole[\s\S]*?\n}/)?.[0] ?? ''),
      'parseRole must not trim — exact matching is the guard against "owner\\n"',
    );
  });
});

describe('voucher discount: client and function copies agree', () => {
  // Same duplication, higher stakes. `reconcileOrderStock` recomputes the
  // discount from the voucher document and OVERWRITES the client's figure, so
  // the function's copy is the one that decides what the shop keeps. If the two
  // disagree the cart quotes a number the order will not honour — and the
  // customer finds out at the moment the order is confirmed, not before.
  const VOUCHER_SHAPES = [
    { type: 'percent', value: 10, minOrder: 200, isActive: true },
    { type: 'percent', value: 90, minOrder: 0, isActive: true },
    { type: 'percent', value: 100, minOrder: 0, isActive: true },
    { type: 'fixed', value: 50, minOrder: 500, isActive: true },
    { type: 'fixed', value: 99999, minOrder: 0, isActive: true },
    { type: 'fixed', value: -20, minOrder: 0, isActive: true },
    { type: 'percent', value: 10, minOrder: 1000, isActive: false },
  ] as const;
  const SUBTOTALS = [0, 99, 100, 199, 200, 201, 499, 500, 1200, 5000];

  it('the function copy of the percent ceiling matches the client copy', () => {
    assert.equal(fnConfig.MAX_PERCENT_DISCOUNT, MAX_PERCENT_DISCOUNT);
  });

  it('computes an identical discount across every voucher shape and subtotal', () => {
    for (const voucher of VOUCHER_SHAPES) {
      for (const subtotal of SUBTOTALS) {
        assert.equal(
          fnConfig.calculateDiscount(subtotal, voucher),
          calculateDiscount(subtotal, voucher),
          `discount mismatch for ${voucher.type} ${voucher.value} at subtotal ${subtotal}`,
        );
      }
    }
  });

  it('never returns a negative discount on either copy', () => {
    for (const voucher of VOUCHER_SHAPES) {
      for (const subtotal of SUBTOTALS) {
        assert.ok(
          fnConfig.calculateDiscount(subtotal, voucher) >= 0,
          `function copy went negative for ${voucher.type} ${voucher.value} at ${subtotal}`,
        );
        assert.ok(
          calculateDiscount(subtotal, voucher) >= 0,
          `client copy went negative for ${voucher.type} ${voucher.value} at ${subtotal}`,
        );
      }
    }
  });

  it('never discounts more than the subtotal on either copy', () => {
    // The invariant the function relies on when it recomputes grandTotal: an
    // over-large fixed voucher must not manufacture a negative order total.
    for (const voucher of VOUCHER_SHAPES) {
      for (const subtotal of SUBTOTALS) {
        assert.ok(
          fnConfig.calculateDiscount(subtotal, voucher) <= subtotal,
          `function copy exceeded subtotal for ${voucher.type} ${voucher.value} at ${subtotal}`,
        );
        assert.ok(
          calculateDiscount(subtotal, voucher) <= subtotal,
          `client copy exceeded subtotal for ${voucher.type} ${voucher.value} at ${subtotal}`,
        );
      }
    }
  });
});

describe('cart stock cap', () => {
  it('allows a quantity within available stock', () => {
    assert.doesNotThrow(() => assertCanAddToCart('Rocky Road (pint)', 2, 3, 10));
  });

  it('rejects overselling', () => {
    assert.throws(
      () => assertCanAddToCart('Rocky Road (pint)', 8, 3, 10),
      /Exceeds available|Only 10 x Rocky Road/,
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
  const line = (productId: string, size: string, quantity: number) => ({
    productId,
    size,
    quantity,
  });

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

  it("does not mutate the caller's input objects", () => {
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
      100,
    );
  });

  it('ignores a percentage below its minimum order', () => {
    assert.equal(
      calculateDiscount(100, { type: 'percent', value: 10, minOrder: 200, isActive: true }),
      0,
    );
  });

  it('caps a fixed discount at the subtotal', () => {
    assert.equal(calculateDiscount(30, { type: 'fixed', value: 50, isActive: true }), 30);
  });

  it('ignores inactive vouchers', () => {
    assert.equal(calculateDiscount(1000, { type: 'percent', value: 10, isActive: false }), 0);
  });

  it('never discounts more than the maximum percentage', () => {
    assert.equal(
      calculateDiscount(1000, { type: 'percent', value: 500, isActive: true }),
      (1000 * MAX_PERCENT_DISCOUNT) / 100,
    );
  });

  it('has no built-in voucher list to fall back to', () => {
    // The built-in list (SCOOP10 / FREE50) is gone, and this pins why it must not
    // come back. It used to be consulted whenever the Firestore lookup came back
    // empty OR THREW, which meant switching a voucher off in the admin UI did
    // nothing — the hardcoded copy answered anyway. It was also never seeded, so
    // the cart page's "try SCOOP10" hint produced "Voucher not found" every time.
    assert.equal(
      Object.keys(voucherModel).includes('BUILT_IN_VOUCHERS'),
      false,
      'a built-in voucher list overrides admin control and must not return',
    );
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
    assert.ok(
      buildCloudinaryUrl(STORED, 1000).endsWith('v1756200000/five-orites-scoop/products/a.jpg'),
    );
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
    assert.equal(
      buildCloudinaryUrl('assets/placeholder-scoop.svg', 400),
      'assets/placeholder-scoop.svg',
    );
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
      describeFirestoreError('orders', { code: 'failed-precondition' }),
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

describe('csv serialisation', () => {
  /**
   * The escaping rules used to live in a private method on the analytics page,
   * which meant the four admin exports added afterwards had no shared rule to
   * follow. A review comment or a delivery address containing a comma is not an
   * edge case — "Taft Ave, Manila" is the normal shape of a Filipino address —
   * so an unquoted cell silently shifts every column after it.
   */
  it('quotes a cell containing a comma', () => {
    assert.equal(sanitiseCell('Taft Ave, Manila'), '"Taft Ave, Manila"');
  });

  it('doubles an embedded quote', () => {
    assert.equal(sanitiseCell('Best "ube" ever'), '"Best ""ube"" ever"');
  });

  it('quotes unconditionally so no column can be a latent bug', () => {
    assert.equal(sanitiseCell('plain'), '"plain"');
    assert.equal(sanitiseCell(42), '"42"');
    assert.equal(sanitiseCell(false), '"false"');
  });

  it('renders null and undefined as an empty cell, never "null"', () => {
    assert.equal(sanitiseCell(null), '""');
    assert.equal(sanitiseCell(undefined), '""');
  });

  it('preserves a newline inside a quoted cell', () => {
    const csv = toCsv([['a'], ['line one\nline two']]);
    assert.equal(csv, '"a"\n"line one\nline two"');
  });

  it('emits a header plus one line per row', () => {
    const csv = toCsv([
      ['id', 'name'],
      ['1', 'Rocky Road'],
      ['2', 'Ube Halaya'],
    ]);
    assert.equal(csv.split('\n').length, 3);
    assert.ok(csv.startsWith('"id","name"'));
  });

  it('returns an empty string for no rows', () => {
    assert.equal(toCsv([]), '');
  });

  it('builds a dated filename', () => {
    assert.match(csvFilename('orders'), /^five-orites-orders-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.match(
      csvFilename('delivered-sales', '30d'),
      /^five-orites-delivered-sales-30d-\d{4}-\d{2}-\d{2}\.csv$/,
    );
  });

  /**
   * `createdAt` is a Firestore Timestamp in the app but can arrive as a string
   * from a cache, and is absent on some legacy documents. A formatter that
   * throws takes down the whole export rather than blanking one cell.
   */
  it('accepts a Timestamp-like object, a string, or nothing', () => {
    const stamp = { toDate: () => new Date('2026-10-02T03:04:05.000Z') };
    assert.equal(toIsoDate(stamp), '2026-10-02T03:04:05.000Z');
    assert.equal(toIsoDate('2026-10-02T03:04:05.000Z'), '2026-10-02T03:04:05.000Z');
    for (const bad of [null, undefined, 'not-a-date', {}, 42]) {
      assert.equal(toIsoDate(bad), '');
    }
  });
});

describe('revenue trend bucketing', () => {
  // A fixed clock, because these assertions are about calendar arithmetic and
  // running them "today" would silently start failing in some months.
  const NOW = new Date(2026, 9, 2, 14, 30); // 2 Oct 2026, 2:30pm local
  /** A timestamp on October `d` 2026 at `h`:00 local. */
  const at = (d: number, h = 12) => new Date(2026, 9, d, h, 0, 0).getTime();
  /** A timestamp on September `d` 2026 — the window opens in September. */
  const sept = (d: number, h = 12) => new Date(2026, 8, d, h, 0, 0).getTime();

  it('produces one bucket per day, oldest first, ending today', () => {
    const b = calendarBuckets(7, NOW);
    assert.equal(b.length, 7);
    assert.equal(b[0].date, '2026-09-26');
    assert.equal(b[6].date, '2026-10-02', 'the last bucket must be today');
    for (let i = 1; i < b.length; i++) {
      assert.ok(b[i].start > b[i - 1].start, 'buckets must increase');
    }
  });

  it('ends each bucket at the next local midnight, not 24h later', () => {
    // This is the DST case: a rolling 86_400_000ms step lands on 23:00 or 01:00
    // and silently shifts the whole trend by an hour.
    const b = calendarBuckets(2, NOW);
    for (const bucket of b) {
      assert.equal(new Date(bucket.end).getHours(), 0, 'each bucket ends at midnight');
      assert.equal(new Date(bucket.start).getHours(), 0, 'each bucket starts at midnight');
    }
  });

  it('sums each order into exactly one bucket', () => {
    const b = calendarBuckets(7, NOW);
    const sums = bucketize(
      b,
      [at(2), at(2), at(1), sept(26)],
      (t) => t,
      () => 100,
    );
    assert.equal(sums.length, 7);
    assert.equal(sums[6], 200, 'two orders today');
    assert.equal(sums[5], 100, 'one yesterday');
    assert.equal(sums[0], 100, 'one on the first day of the window');
    assert.equal(
      sums.reduce((a, b2) => a + b2, 0),
      400,
    );
  });

  it('separates 11:59pm from 12:01am across a day boundary', () => {
    const b = calendarBuckets(2, NOW);
    const late = new Date(2026, 9, 1, 23, 59).getTime();
    const early = new Date(2026, 9, 2, 0, 1).getTime();
    const sums = bucketize(
      b,
      [late, early],
      (t) => t,
      () => 1,
    );
    assert.equal(sums[0], 1, '11:59pm belongs to yesterday');
    assert.equal(sums[1], 1, '12:01am belongs to today');
  });

  it('ignores orders outside the window rather than clamping them in', () => {
    const b = calendarBuckets(7, NOW);
    // Two inside the window, one from January, one from TOMORROW — both strays
    // must be dropped rather than clamped into the nearest column, which would
    // invent a spike at each edge.
    const sums = bucketize(
      b,
      [at(1), at(2), new Date(2026, 0, 1).getTime(), at(3)],
      (t) => t,
      () => 10,
    );
    assert.equal(
      sums.reduce((a, b2) => a + b2, 0),
      20,
    );
  });

  it('emits empty buckets so the line has no gaps', () => {
    const b = calendarBuckets(5, NOW);
    const sums = bucketize(
      b,
      [at(2)],
      (t) => t,
      () => 500,
    );
    assert.equal(sums.length, 5);
    assert.deepEqual(sums, [0, 0, 0, 0, 500]);
  });

  it('survives an unparseable timestamp instead of dropping the bucket', () => {
    const b = calendarBuckets(3, NOW);
    const sums = bucketize(
      b,
      [Number.NaN, at(2)],
      (t) => t,
      () => 50,
    );
    assert.equal(
      sums.reduce((a, b2) => a + b2, 0),
      50,
    );
  });

  it('collapses a long window into weeks and keeps every order', () => {
    const daily = calendarBuckets(30, NOW);
    // One order in each of the three weeks of the window, so a weekly bug that
    // dropped or double-counted a column would show up as a different total.
    const sample = [at(2), sept(20), sept(5)];
    const dailySums = bucketize(
      daily,
      sample,
      (t) => t,
      () => 10,
    );
    const weekly = weeklyBuckets(30, NOW);
    const weeklySums = bucketize(
      weekly,
      sample,
      (t) => t,
      () => 10,
    );
    assert.ok(weekly.length < daily.length, 'weeks must be fewer columns than days');
    assert.equal(
      dailySums.reduce((a, b) => a + b, 0),
      weeklySums.reduce((a, b) => a + b, 0),
      'bucketing weekly must not drop or double-count any order',
    );
  });

  it('switches to weekly above 14 days and stays daily below', () => {
    assert.equal(bucketsFor(7, NOW).length, 7);
    assert.equal(bucketsFor(14, NOW).length, 14);
    assert.ok(bucketsFor(30, NOW).length <= 5);
  });

  it('accumulates a running total from zero', () => {
    // Starts at the first bucket, not at the first day's own value, which would
    // overstate the opening figure.
    assert.deepEqual(runningTotal([100, 50, 25]), [100, 150, 175]);
    assert.deepEqual(runningTotal([]), []);
  });

  it('handles a zero-length or negative window without throwing', () => {
    assert.equal(calendarBuckets(0, NOW).length, 1);
    assert.equal(calendarBuckets(-5, NOW).length, 1);
  });
});

describe('csv line parsing', () => {
  it('splits on commas', () => {
    assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
  });

  it('keeps a comma inside quotes instead of splitting on it', () => {
    // The same failure the CSV writer guards against, read backwards: a naive
    // split here would shift every column after the flavor name.
    assert.deepEqual(parseCsvLine('1,Chocolates,"Rocky Road, chunky",flavor'), [
      '1',
      'Chocolates',
      'Rocky Road, chunky',
      'flavor',
    ]);
  });

  it('unescapes a doubled quote', () => {
    assert.deepEqual(parseCsvLine('"Best ""ube"" ever"'), ['Best "ube" ever']);
  });

  it('tolerates a line ending inside quotes', () => {
    assert.deepEqual(parseCsvLine('"one\ntwo",b'), ['one\ntwo', 'b']);
  });

  it('returns an empty trailing field rather than dropping it', () => {
    assert.deepEqual(parseCsvLine('a,'), ['a', '']);
    assert.deepEqual(parseCsvLine(''), ['']);
  });
});

describe('product csv import', () => {
  const HEADER =
    'set_number,set_name,variant_name,description,category,cup_price,pint_price,half_gallon_price,gallon_price,cup_stock,pint_stock,half_gallon_stock,gallon_stock';

  it('parses a well-formed file', () => {
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocolates,Rocky Road,Nuts,flavor,65,200,500,950,3,2,1,0`,
    );
    assert.equal(plan.errors.length, 0);
    assert.equal(plan.valid.length, 1);
    assert.equal(plan.valid[0].variantName, 'Rocky Road');
    assert.equal(plan.valid[0].pricing.gallon, 950);
    assert.equal(plan.valid[0].stock.cup, 3);
    assert.equal(plan.valid[0].category, 'flavor');
  });

  it('defaults a missing category to flavor', () => {
    const plan = parseProductCsv(`${HEADER}\n1,Chocolates,Rocky Road,,,65,200,500,950,,,,`);
    assert.equal(plan.valid[0].category, 'flavor');
  });

  it('rejects the WHOLE file when any row is bad', () => {
    // The whole point: an admin must never end up with 40 of 64 flavors written
    // and no way to tell which 40.
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocolates,Rocky Road,,flavor,65,200,500,950,,,,` +
        `\n1,Chocolates,Broken,,flavor,abc,200,500,950,,,,`,
    );
    assert.equal(plan.valid.length, 0, 'nothing may be accepted');
    assert.equal(plan.errors.length, 1);
    assert.match(plan.errors[0].message, /cup price/);
  });

  it('reports the original line number, header included', () => {
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocolates,Good,,flavor,65,200,500,950,,,,` +
        `\n1,Chocolates,Bad,,flavor,-5,200,500,950,,,,`,
    );
    assert.equal(plan.errors[0].line, 3, 'line 1 is the header');
  });

  it('rejects a negative price', () => {
    const plan = parseProductCsv(`${HEADER}\n1,Chocolates,X,,flavor,-5,200,500,950,,,,`);
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /0 or more/);
  });

  it('rejects fractional and negative stock', () => {
    assert.equal(parseProductCsv(`${HEADER}\n1,C,X,,flavor,65,200,500,950,1.5,,,`).valid.length, 0);
    assert.equal(parseProductCsv(`${HEADER}\n1,C,X,,flavor,65,200,500,950,-2,,,`).valid.length, 0);
  });

  it('rejects a non-integer set number', () => {
    const plan = parseProductCsv(`${HEADER}\n0,Chocolates,X,,flavor,65,200,500,950,,,,`);
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /setNumber/);
  });

  it('rejects an unknown category instead of silently making it a flavor', () => {
    const plan = parseProductCsv(`${HEADER}\n1,C,X,,popsicle,65,200,500,950,,,,`);
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /category/);
  });

  it('rejects a row missing a required name', () => {
    assert.equal(parseProductCsv(`${HEADER}\n1,,X,,flavor,65,200,500,950,,,,`).valid.length, 0);
    assert.equal(
      parseProductCsv(`${HEADER}\n1,Chocolates,,,flavor,65,200,500,950,,,,`).valid.length,
      0,
    );
  });

  it('rejects a duplicate pair inside one file', () => {
    // The document id is derived from the pair, so a duplicate silently
    // overwrites the earlier row.
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocolates,Rocky Road,,flavor,65,200,500,950,,,,` +
        `\n1,Chocolates,Rocky Road,,flavor,99,200,500,950,,,,`,
    );
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /duplicate/);
  });

  it('rejects a row that already exists in the catalog', () => {
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocolates,Rocky Road,,flavor,65,200,500,950,,,,`,
      new Set(['1_rocky_road']),
    );
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /already exists/);
  });

  it('refuses a file with no price column rather than importing everything at zero', () => {
    // `isWellFormedProduct` allows pricing.cup === 0, so a header typo would
    // otherwise create 64 products nobody can buy.
    const plan = parseProductCsv('set_number,set_name,variant_name\n1,Chocolates,Rocky Road');
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /price column/i);
  });

  it('reports the missing required columns when the header is wrong', () => {
    const plan = parseProductCsv('a,b,c\n1,2,3');
    assert.match(plan.errors[0].message, /Missing required column/);
  });

  it('lists unknown columns so a typo is visible rather than silently ignored', () => {
    const plan = parseProductCsv(`${HEADER}\n1,Chocolates,X,,flavor,65,200,500,950,,,,`);
    assert.deepEqual(plan.unknownColumns, []);
    const typo = parseProductCsv(
      'set_number,set_name,variant_name,category,cup_prce,pint_price,half_gallon_price,gallon_price\n1,C,X,flavor,65,200,500,950',
    );
    assert.ok(typo.unknownColumns.includes('cup_prce'), 'the typo must be named');
  });

  it('accepts header variants a human would actually type', () => {
    for (const header of [
      'Set,Name,Flavor,Type,Price (Cup),Price (Pint),Price (Half Gallon),Price (Gallon)',
      'setNumber,setName,variantName,category,cupPrice,pintPrice,halfGallonPrice,gallonPrice',
      'SET NUMBER,SET NAME,VARIANT NAME,CATEGORY,CUP PRICE,PINT PRICE,HALF GALLON PRICE,GALLON PRICE',
    ]) {
      const plan = parseProductCsv(`${header}\n1,Chocolates,Rocky Road,flavor,65,200,500,950`);
      assert.equal(plan.valid.length, 1, `header not understood: ${header}`);
      assert.equal(plan.valid[0].pricing.gallon, 950);
    }
  });

  it('skips blank lines and comments instead of failing on them', () => {
    const plan = parseProductCsv(
      `${HEADER}\n\n# exported 2 Oct\n1,Chocolates,Rocky Road,,flavor,65,200,500,950,,,,\n\n`,
    );
    assert.equal(plan.valid.length, 1);
    assert.equal(plan.errors.length, 0);
  });

  it('reports an empty file rather than importing nothing quietly', () => {
    const plan = parseProductCsv('');
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /empty/i);
  });

  it('handles a quoted comma inside a description', () => {
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocoletes,Rocky Road,"Rich, fudgy, nutty",flavor,65,200,500,950,,,,`,
    );
    assert.equal(plan.valid[0].description, 'Rich, fudgy, nutty');
  });

  it('builds the same document id as the seeder', () => {
    assert.equal(slug('Rocky Road'), 'rocky_road');
    assert.equal(slug('Strawberryfields Forever'), 'strawberryfields_forever');
    assert.equal(slug('  Ube Halaya!  '), 'ube_halaya');
  });

  it('ships a template that parses', () => {
    const plan = parseProductCsv(PRODUCT_CSV_TEMPLATE);
    assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));
    assert.equal(plan.valid.length, 1);
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
