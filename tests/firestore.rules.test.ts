// tests/firestore.rules.test.ts
// Firestore security rules tests.
//
// These exist because a real bug shipped: the rules reserved product writes
// for admins while the checkout flow decremented stock as the customer, so no
// non-admin could ever place an order. Nothing caught it because the only
// tests were pure-logic tests that never touched a rules engine.
//
// Run with the emulator:  npm run test:rules
// (that script starts the emulator, runs this, then tears it down)

import { test, before, after, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';

/** Does this document still exist, read as an admin so reads are never the thing under test? */
async function exists(ref: ReturnType<typeof doc>): Promise<boolean> {
  return (await getDoc(ref)).exists();
}

let env: RulesTestEnvironment;

/**
 * Every Firestore client this suite mints, so that none of them outlives the test
 * that opened it.
 *
 * `env.authenticatedContext(uid).firestore()` constructs a NEW client every time
 * it is called -- not a cached one -- and each carries its own gRPC channel. The
 * five helpers below are invoked throughout 172 tests, so the suite was opening
 * hundreds of channels and closing none. The visible symptom was rare and looked
 * like a rules failure, because a channel settling after the root test context
 * closed makes Node's runner throw ERR_INTERNAL_ASSERTION from a worker message it
 * does not recognise, which lands in the report as a bare file-level 'test failed'
 * with no assertion, no stack and no failing test name.
 */
const openClients = new Set<Firestore>();

/** Mint an authenticated client and remember it, so `closeClients()` can close it. */
function authed(uid: string | null): Firestore {
  const client = env.authenticatedContext(uid).firestore();
  openClients.add(client);
  return client;
}

/** The same, signed out. Used to prove anonymous callers are refused. */
function unauthed(): Firestore {
  const client = env.unauthenticatedContext().firestore();
  openClients.add(client);
  return client;
}

/**
 * Close everything opened since the last sweep.
 *
 * `terminate()` is idempotent, and the registry is cleared as it goes so a client
 * is never closed twice. Runs in `afterEach` because the failure mode is
 * specifically "activity after the test ended" -- closing only in `after()` would
 * still leave a live channel between tests.
 */
async function closeClients(): Promise<void> {
  const clients = [...openClients];
  openClients.clear();
  await Promise.all(clients.map((c) => c.terminate()));
}

afterEach(closeClients);

const ADMIN = 'admin-uid';
const CUSTOMER = 'customer-uid';
const OTHER_CUSTOMER = 'other-customer-uid';

/**
 * The shop owner.
 *
 * Role tiers made the user directory OWNER-only, so the tests that assert
 * "someone can list users" need an owner rather than an admin. That is not a
 * workaround — it is the assertion the rules now make, and using `ADMIN` for it
 * would have tested the old model.
 */
const OWNER = 'owner-uid';
/** A shift lead: reaches the queue, cannot touch the catalog or the directory. */
const STAFF = 'staff-uid';
/** A manager: runs the shop day to day, but cannot hand out roles. */
const MANAGER = 'manager-uid';
/** A second customer, used to prove one cannot touch another's order. */
const asManager = () => authed(MANAGER);

const PRODUCT = {
  setNumber: 1,
  setName: 'Chocolates',
  variantName: 'Rocky Road',
  description: 'A classic.',
  imageUrl: '',
  pricing: { cup: 65, pint: 200, halfGallon: 500, gallon: 950 },
  stock: { cup: 5, pint: 5, halfGallon: 5, gallon: 5 },
  isActive: true,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
};

function orderFor(customerId: string, status: string) {
  return {
    customerId,
    customerEmail: 'c@example.com',
    items: [
      {
        productId: 'p1',
        variantName: 'Rocky Road',
        setName: 'Chocolates',
        size: 'cup',
        quantity: 1,
        unitPrice: 65,
        subtotal: 65,
      },
    ],
    totalAmount: 65,
    deliveryFee: 50,
    discountAmount: 0,
    voucherCode: null,
    grandTotal: 115,
    status,
    paymentStatus: 'pending',
    deliveryAddress: 'Somewhere',
    notes: '',
    cancelReason: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    statusHistory: [{ status: 'pending', timestamp: Timestamp.now() }],
  };
}

const asUser = (uid: string | null) => authed(uid);
const asAdmin = () => authed(ADMIN);
const asOwner = () => authed(OWNER);
const asStaff = () => authed(STAFF);

/** Write a fixture directly, bypassing the rules (see beforeEach for why). */
async function seed(path: string, data: unknown): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data as Record<string, unknown>);
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'five-orites-scoop-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

after(async () => {
  // Belt and braces: `afterEach` normally empties this, but if a hook threw
  // midway the registry can still hold clients, and a channel left open across
  // `cleanup()` is precisely what produces the late worker message.
  await closeClients();
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed with rules disabled. The admin document is normally created by hand in
  // the Firebase console precisely because `allow create` on users/{uid} only
  // permits role == 'customer' — no context can bootstrap an admin through the
  // rules, which is correct but means tests must not try.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'products/p1'), PRODUCT);
    await setDoc(doc(db, `users/${ADMIN}`), { uid: ADMIN, role: 'admin' });
    await setDoc(doc(db, `users/${OWNER}`), { uid: OWNER, role: 'owner' });
    await setDoc(doc(db, `users/${STAFF}`), { uid: STAFF, role: 'staff' });
    await setDoc(doc(db, `users/${MANAGER}`), { uid: MANAGER, role: 'manager' });
    await setDoc(doc(db, `users/${CUSTOMER}`), { uid: CUSTOMER, role: 'customer' });
    await setDoc(doc(db, `users/${OTHER_CUSTOMER}`), { uid: OTHER_CUSTOMER, role: 'customer' });
  });
});

describe('products: stock is staff-owned', () => {
  test('a customer may NOT write stock at all — staff own it now', async () => {
    // There is no customer branch on the products rule. Stock moves in the
    // transaction that advances an order out of `pending`, performed by STAFF from
    // the fulfilment queue (`OrderService.transitionOrderStatus`), so EVERY stock
    // write from a customer session is refused.
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        'stock.cup': 3,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a customer may NOT restock on cancel either', async () => {
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        'stock.cup': 6,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a customer may NOT raise stock to inflate availability — the hole is CLOSED', async () => {
    // This SUCCEEDED for months: any signed-in session could write
    // stock.cup: 999999 (oversell) or zero the whole catalog (availability DoS).
    // Deleting the customer branch is what closed it, and this assertion is the
    // proof it stays closed.
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        'stock.cup': 999999,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a customer may NOT zero the catalog (availability DoS)', async () => {
    await seed('products/p2', { ...PRODUCT, variantName: 'Mint Chip' });
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        'stock.cup': 0,
        'stock.pint': 0,
        'stock.halfGallon': 0,
        'stock.gallon': 0,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a customer may NOT write negative stock', async () => {
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        'stock.cup': -1000,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a STAFF-tier account may NOT write stock either', async () => {
    // THE ONE REAL BEHAVIOUR REGRESSION from deleting the customer branch.
    //
    // While it existed, ANY signed-in session could write `stock` — which
    // included a `staff` shift lead. So a shift lead could zero the catalog, and
    // a test elsewhere in this file documented that as SUCCEEDING.
    //
    // Now that stock is taken by the fulfilment take, which is a PRODUCT write and
    // therefore gated on `canRunShop()` (manager+), a `staff` account cannot write
    // stock at all. That is the correct trade — it is precisely the hole being
    // closed — but it is a change in what a shift lead can do, so it is pinned
    // here rather than discovered by someone on a shop floor.
    await assertFails(
      updateDoc(doc(asStaff(), 'products/p1'), {
        'stock.cup': 99,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a MANAGER-tier account MAY decrement stock — that is the fulfilment take', async () => {
    // The positive control for the test above. Without it, "staff cannot" could
    // pass for the wrong reason (a broken product rule rather than a correct tier
    // boundary), and the take in `OrderService.transitionOrderStatus` would be
    // impossible for anyone.
    await assertSucceeds(
      updateDoc(doc(asManager(), 'products/p1'), {
        'stock.cup': 4,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a MANAGER-tier account may NOT set stock negative', async () => {
    // `stockIsSane()` still floors every size at zero for the manager path too, so
    // the take can never drive a shelf below empty even if the transaction's own
    // shortfall check were somehow bypassed.
    await assertFails(
      updateDoc(doc(asManager(), 'products/p1'), {
        'stock.cup': -1,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a customer may NOT change pricing', async () => {
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        'pricing.cup': 1,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a customer may NOT re-activate a deactivated product', async () => {
    // Note: writing a field to the value it already holds produces an EMPTY
    // diff, so `hasOnly` trivially passes. The test therefore targets a
    // product that is genuinely deactivated, otherwise it would assert nothing.
    await seed('products/p2', { ...PRODUCT, variantName: 'Retired', isActive: false });
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'products/p2'), {
        isActive: true,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a customer may NOT create a product', async () => {
    await assertFails(addDoc(collection(asUser(CUSTOMER), 'products'), PRODUCT));
  });

  test('an admin may set any field', async () => {
    await assertSucceeds(
      updateDoc(doc(asAdmin(), 'products/p1'), {
        'pricing.cup': 70,
        'stock.cup': 0,
        isActive: false,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a signed-out visitor may not write', async () => {
    await assertFails(
      updateDoc(doc(unauthed(), 'products/p1'), {
        'stock.cup': 0,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  // ── Product deletion ───────────────────────────────────────────────────
  // The Inventory page has an explicit, confirmed X control that erases a flavor
  // document outright, as distinct from the Active pill which only takes it off
  // sale. That needs a rule, and the rule needs to be pinned: `if false` was
  // what made removal impossible before, and the failure mode of loosening it
  // too far is a customer deleting the catalog.
  test('an admin may delete a product', async () => {
    await seed('products/doomed', { ...PRODUCT, variantName: 'Mis-seeded Flavor' });
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'products/doomed')));
    assert.equal(await exists(doc(asAdmin(), 'products/doomed')), false);
  });

  test('a customer may NOT delete a product', async () => {
    // This is the one that must not regress. The customer stock branch above
    // necessarily allows any signed-in user to WRITE a product's stock field, so
    // delete has to be the thing that stays admin-only.
    await seed('products/keep', { ...PRODUCT, variantName: 'Popular Flavor' });
    await assertFails(deleteDoc(doc(asUser(CUSTOMER), 'products/keep')));
    assert.equal(await exists(doc(asAdmin(), 'products/keep')), true);
  });

  test('a signed-out visitor may NOT delete a product', async () => {
    await assertFails(deleteDoc(doc(unauthed(), 'products/p1')));
  });

  // ── Legacy-catalogue tolerance ──────────────────────────────────────────
  //
  // `isWellFormedProduct()` requires all four `pricing.*` fields to be `int`, and
  // unlike `stockIsSane()` it does NOT tolerate them being absent: `null is int`
  // is false. So before the narrow stock clause existed, one legacy flavour
  // missing a price field made its stock unmovable and every order containing it
  // un-advanceable — a PERMISSION_DENIED naming neither the price nor the reason.
  //
  // These pin the fix AND its limit: stock may move on an untidy catalogue, but
  // the untidiness itself is still refused.
  describe('stock movement does not require a pristine catalogue', () => {
    /** A flavour seeded before one of the four price fields existed. */
    const LEGACY = {
      ...PRODUCT,
      variantName: 'Legacy Flavor',
      pricing: { cup: 65, pint: 200, gallon: 950 },
    };

    test('a manager MAY move stock on a flavour missing a price field', async () => {
      await seed('products/legacy', LEGACY);
      await assertSucceeds(
        updateDoc(doc(asManager(), 'products/legacy'), {
          'stock.cup': 4,
          updatedAt: Timestamp.now(),
        }),
      );
    });

    test('but the missing price field itself may still NOT be written', async () => {
      // The narrow clause only covers `stock` and `updatedAt`. Filling in the
      // absent price is a catalogue edit and must still be well-formed.
      await seed('products/legacy', LEGACY);
      await assertFails(
        updateDoc(doc(asManager(), 'products/legacy'), {
          pricing: { cup: 65, pint: 200, halfGallon: -500, gallon: 950 },
        }),
      );
    });

    test('and a negative stock level is still refused on that same flavour', async () => {
      // The point of routing through `stockIsSane()` rather than dropping the
      // check: tolerant about the catalogue, not about the number being written.
      await seed('products/legacy', LEGACY);
      await assertFails(
        updateDoc(doc(asManager(), 'products/legacy'), {
          'stock.cup': -1,
          updatedAt: Timestamp.now(),
        }),
      );
    });

    test('a staff account still may NOT move stock', async () => {
      // The narrow clause is `canRunShop()`, not `isStaff()`. Being able to read
      // the fulfilment queue is not authority over the shelf.
      await seed('products/legacy', LEGACY);
      await assertFails(
        updateDoc(doc(asStaff(), 'products/legacy'), {
          'stock.cup': 4,
          updatedAt: Timestamp.now(),
        }),
      );
    });

    test('a customer still may NOT move stock on a legacy flavour either', async () => {
      await seed('products/legacy', LEGACY);
      await assertFails(
        updateDoc(doc(asUser(CUSTOMER), 'products/legacy'), {
          'stock.cup': 4,
          updatedAt: Timestamp.now(),
        }),
      );
    });
  });
});

describe('orders: a legacy order with no timeline', () => {
  // The append-only check reads `resource.data.statusHistory.size()`. On an order
  // with no `statusHistory`, `null.size()` is an EVALUATION ERROR, which denies
  // the entire write — so before `historyLen()` existed, such an order could be
  // neither advanced by staff nor cancelled by its customer, ever.
  //
  // `placeOrder` has always written the field, so this is only reachable for
  // orders written by a seed script, a console paste, or an older build. Which is
  // precisely what a live shop's database accumulates.
  const WITHOUT_TIMELINE = (() => {
    const o = orderFor(CUSTOMER, 'pending') as Record<string, unknown>;
    delete o.statusHistory;
    return o;
  })();

  test('staff MAY advance an order that has no statusHistory', async () => {
    await seed('orders/old', WITHOUT_TIMELINE);
    await assertSucceeds(
      updateDoc(doc(asManager(), 'orders/old'), {
        status: 'confirmed',
        statusHistory: [{ status: 'confirmed', timestamp: Timestamp.now() }],
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a status change with NO timeline append is still refused', async () => {
    // The append-only guarantee, restated for an order that HAS a timeline.
    // `historyLen` must not have weakened this into "size may be anything".
    await seed('orders/old', orderFor(CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asManager(), 'orders/old'), {
        status: 'confirmed',
        statusHistory: [{ status: 'pending', timestamp: Timestamp.now() }],
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('the timeline may not be truncated either', async () => {
    await seed('orders/old', orderFor(CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asManager(), 'orders/old'), {
        status: 'confirmed',
        statusHistory: [],
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a legacy order may gain ONE entry, not two', async () => {
    // The tolerance is "absent means empty", NOT "absent means unconstrained".
    // Writing two entries where exactly one append is permitted is the case that
    // would let a manager fabricate a history out of nothing.
    await seed('orders/old', WITHOUT_TIMELINE);
    await assertFails(
      updateDoc(doc(asManager(), 'orders/old'), {
        status: 'confirmed',
        statusHistory: [
          { status: 'pending', timestamp: Timestamp.now() },
          { status: 'confirmed', timestamp: Timestamp.now() },
        ],
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a customer MAY still cancel a `pending` order that has no timeline', async () => {
    await seed('orders/old', WITHOUT_TIMELINE);
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), 'orders/old'), {
        status: 'cancelled',
        cancelReason: 'Changed my mind',
        statusHistory: [{ status: 'cancelled', timestamp: Timestamp.now() }],
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test("and still may NOT cancel somebody else's", async () => {
    await seed('orders/old', { ...WITHOUT_TIMELINE, customerId: OTHER_CUSTOMER });
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/old'), {
        status: 'cancelled',
        cancelReason: 'Not mine',
        statusHistory: [{ status: 'cancelled', timestamp: Timestamp.now() }],
        updatedAt: Timestamp.now(),
      }),
    );
  });
});

describe('orders: money floors', () => {
  // `deliveryFee` used to be validated NOWHERE — not even `is number`. It appeared
  // only inside the consistency identity, which made a forged negative fee the
  // cheapest way to steal from the shop: keep every line item at a real price,
  // shave the fee, and nothing in the payload looks wrong to a human reviewer.

  test('a customer may NOT create an order with a NEGATIVE delivery fee', async () => {
    // The attack this closes, in full: a ₱1,000 basket settled for ₱550.
    await assertFails(
      setDoc(doc(asUser(CUSTOMER), 'orders/o1'), {
        ...orderFor(CUSTOMER, 'pending'),
        totalAmount: 1000,
        discountAmount: 0,
        deliveryFee: -450,
        grandTotal: 550,
      }),
    );
  });

  test('a customer may NOT create a ₱0 order', async () => {
    // Five gallons recorded at zero. `totalAmount > 0` is what refuses it; the
    // per-line `unitPrice` cannot be checked at all, because Firestore rules have
    // no loop and cannot sum an array.
    await assertFails(
      setDoc(doc(asUser(CUSTOMER), 'orders/o1'), {
        ...orderFor(CUSTOMER, 'pending'),
        items: [
          {
            productId: 'p1',
            variantName: 'Rocky Road',
            setName: 'Chocolates',
            size: 'gallon',
            quantity: 5,
            unitPrice: 0,
            subtotal: 0,
          },
        ],
        totalAmount: 0,
        discountAmount: 0,
        deliveryFee: 0,
        grandTotal: 0,
      }),
    );
  });

  test('a customer may NOT create an order with a fractional peso anywhere', async () => {
    await assertFails(
      setDoc(doc(asUser(CUSTOMER), 'orders/o1'), {
        ...orderFor(CUSTOMER, 'pending'),
        deliveryFee: 49.5,
        grandTotal: 65 + 49.5,
      }),
    );
  });

  test('a customer MAY still create an ordinary order', async () => {
    // The positive control. Without it, the three tests above could all pass
    // because the clause rejects EVERY order rather than because the money floors
    // work — which would be a far worse bug than the one being fixed.
    await assertSucceeds(setDoc(doc(asUser(CUSTOMER), 'orders/o1'), orderFor(CUSTOMER, 'pending')));
  });
});

describe('orders: the restock marker', () => {
  // `stockRestored` appeared in NO allow-list in firestore.rules before this — only
  // in comments — so `OrderService.repairStockRestock()` threw PERMISSION_DENIED on
  // its first statement for every role including owner, and the admin repair panel
  // was a control that could never be used. It now has its own narrow clause.

  test('a MANAGER may mark a cancelled order as restocked', async () => {
    await seed('orders/o1', orderFor(CUSTOMER, 'cancelled'));
    await assertSucceeds(
      updateDoc(doc(asManager(), 'orders/o1'), {
        stockRestored: true,
        stockRestoredAt: Timestamp.now(),
      }),
    );
  });

  test('a customer may NOT write the restock marker on an update', async () => {
    await seed('orders/o1', orderFor(CUSTOMER, 'cancelled'));
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o1'), {
        stockRestored: false,
        stockRestoredAt: null,
      }),
    );
  });

  test('a customer may NOT set the marker at CREATE to seed a fake repair row', async () => {
    // The laundering defence. A `false` marker on a fresh order would appear in
    // the owner's repair queue, and a repair moves real stock — so the create
    // allow-list must keep omitting `stockRestored`. This test is the reason it
    // does, and the reason the marker got a SEPARATE clause rather than a place in
    // the staff whitelist.
    await assertFails(
      setDoc(doc(asUser(CUSTOMER), 'orders/o1'), {
        ...orderFor(CUSTOMER, 'cancelled'),
        stockRestored: false,
        stockRestoredAt: null,
      }),
    );
  });

  test('a manager may NOT use the marker clause to also change the status', async () => {
    // The narrow clause allows ONLY the two marker fields. Without this, widening
    // it to reach the marker would have quietly widened every other staff write.
    await seed('orders/o1', orderFor(CUSTOMER, 'cancelled'));
    await assertFails(
      updateDoc(doc(asManager(), 'orders/o1'), {
        stockRestored: true,
        status: 'delivered',
      }),
    );
  });

  test('the marker may NOT be written on an order that is not cancelled', async () => {
    // A stray write on a live order is inert (the repair panel filters on
    // `status === 'cancelled'`), but refusing it keeps the flag meaning exactly one
    // thing rather than "whatever a manager typed".
    await seed('orders/o1', orderFor(CUSTOMER, 'confirmed'));
    await assertFails(
      updateDoc(doc(asManager(), 'orders/o1'), {
        stockRestored: false,
        stockRestoredAt: null,
      }),
    );
  });
});

describe('orders: customer cancel', () => {
  test('a customer may cancel their own pending order', async () => {
    await seed('orders/o1', orderFor(CUSTOMER, 'pending'));
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o1'), {
        status: 'cancelled',
        cancelReason: 'Changed my mind',
        updatedAt: Timestamp.now(),
        statusHistory: [
          { status: 'pending', timestamp: Timestamp.now() },
          { status: 'cancelled', timestamp: Timestamp.now() },
        ],
      }),
    );
  });

  test('a customer may NOT cancel an order that is not pending', async () => {
    await seed('orders/o2', orderFor(CUSTOMER, 'out_for_delivery'));
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o2'), {
        status: 'cancelled',
        cancelReason: null,
        updatedAt: Timestamp.now(),
        statusHistory: [
          { status: 'pending', timestamp: Timestamp.now() },
          { status: 'cancelled', timestamp: Timestamp.now() },
        ],
      }),
    );
  });

  test("a customer may NOT cancel somebody else's order", async () => {
    await seed('orders/o3', orderFor(OTHER_CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o3'), {
        status: 'cancelled',
        cancelReason: null,
        updatedAt: Timestamp.now(),
        statusHistory: [
          { status: 'pending', timestamp: Timestamp.now() },
          { status: 'cancelled', timestamp: Timestamp.now() },
        ],
      }),
    );
  });

  test('a customer may NOT rewrite the order total while cancelling', async () => {
    // The money fields are not in the allow-list, so this is denied even
    // though the status change itself is legitimate.
    await seed('orders/o4', orderFor(CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o4'), {
        status: 'cancelled',
        cancelReason: null,
        grandTotal: 0,
        totalAmount: 0,
        updatedAt: Timestamp.now(),
        statusHistory: [
          { status: 'pending', timestamp: Timestamp.now() },
          { status: 'cancelled', timestamp: Timestamp.now() },
        ],
      }),
    );
  });

  test('a customer may NOT forge multiple statusHistory entries', async () => {
    await seed('orders/o5', orderFor(CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o5'), {
        status: 'cancelled',
        cancelReason: null,
        updatedAt: Timestamp.now(),
        statusHistory: [
          { status: 'pending', timestamp: Timestamp.now() },
          { status: 'delivered', timestamp: Timestamp.now() },
          { status: 'cancelled', timestamp: Timestamp.now() },
        ],
      }),
    );
  });

  test('a customer may NOT set an arbitrary cancel reason length', async () => {
    await seed('orders/o6', orderFor(CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o6'), {
        status: 'cancelled',
        cancelReason: 'x'.repeat(400),
        updatedAt: Timestamp.now(),
        statusHistory: [
          { status: 'pending', timestamp: Timestamp.now() },
          { status: 'cancelled', timestamp: Timestamp.now() },
        ],
      }),
    );
  });

  test('a customer may NOT move an order to any status other than cancelled', async () => {
    await seed('orders/o7', orderFor(CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o7'), {
        status: 'delivered',
        updatedAt: Timestamp.now(),
        statusHistory: [
          { status: 'pending', timestamp: Timestamp.now() },
          { status: 'delivered', timestamp: Timestamp.now() },
        ],
      }),
    );
  });

  test('a customer may create their own order', async () => {
    await assertSucceeds(
      addDoc(collection(asUser(CUSTOMER), 'orders'), orderFor(CUSTOMER, 'pending')),
    );
  });

  test('a customer may NOT create an order for somebody else', async () => {
    await assertFails(
      addDoc(collection(asUser(CUSTOMER), 'orders'), orderFor(OTHER_CUSTOMER, 'pending')),
    );
  });

  test('an admin may advance any order status', async () => {
    await seed('orders/o8', orderFor(CUSTOMER, 'pending'));
    await assertSucceeds(
      updateDoc(doc(asAdmin(), 'orders/o8'), {
        status: 'out_for_delivery',
        updatedAt: Timestamp.now(),
        statusHistory: [
          { status: 'pending', timestamp: Timestamp.now() },
          { status: 'out_for_delivery', timestamp: Timestamp.now() },
        ],
      }),
    );
  });

  test('staff may NOT write a status outside the known set', async () => {
    // The staff branch was a bare `if canRunShop()`, so it accepted any string.
    // A typo like 'delivred' produces an order the tracker cannot render and the
    // admin queue cannot filter — a blank row at read time instead of a refusal
    // at write time.
    await seed('orders/o10', orderFor(CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asAdmin(), 'orders/o10'), {
        status: 'delivred',
        updatedAt: Timestamp.now(),
        statusHistory: [
          { status: 'pending', timestamp: Timestamp.now() },
          { status: 'delivred', timestamp: Timestamp.now() },
        ],
      }),
    );
  });

  test('staff may NOT truncate the fulfilment timeline', async () => {
    // The customer cancel branch required statusHistory to grow by exactly one.
    // The staff branch required nothing, so a manager could shrink the array and
    // rewrite what the tracker's progress view is derived from.
    //
    // What is NOT asserted here: that an individual entry cannot be edited in
    // place. Proving every prior entry survived at the same index needs a loop,
    // and Firestore rules have no loop — the rules file says so rather than
    // implying a guarantee it cannot keep.
    await seed('orders/o11', {
      ...orderFor(CUSTOMER, 'confirmed'),
      statusHistory: [
        { status: 'pending', timestamp: Timestamp.now() },
        { status: 'confirmed', timestamp: Timestamp.now() },
      ],
    });
    await assertFails(
      updateDoc(doc(asAdmin(), 'orders/o11'), {
        statusHistory: [{ status: 'confirmed', timestamp: Timestamp.now() }],
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('staff may NOT change status without appending to the timeline', async () => {
    await seed('orders/o11b', orderFor(CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asAdmin(), 'orders/o11b'), {
        status: 'preparing',
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('staff MAY correct an address without touching the timeline', async () => {
    // The ordinary non-status edit has to keep working: status unchanged, history
    // unchanged, so the append-only rule must not demand growth here.
    await seed('orders/o11c', orderFor(CUSTOMER, 'pending'));
    await assertSucceeds(
      updateDoc(doc(asAdmin(), 'orders/o11c'), {
        deliveryAddress: 'Corrected address',
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('staff may NOT write a field outside the order whitelist', async () => {
    // customerId decides whose order it is and paymentStatus decides whether it
    // is paid. Neither belongs in a staff status write.
    await seed('orders/o12', orderFor(CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asAdmin(), 'orders/o12'), {
        paymentStatus: 'paid',
        updatedAt: Timestamp.now(),
      }),
    );
    await assertFails(
      updateDoc(doc(asAdmin(), 'orders/o12'), {
        customerId: OTHER_CUSTOMER,
        updatedAt: Timestamp.now(),
      }),
    );
  });
});

describe('reads', () => {
  test('a customer can read a product and their own order', async () => {
    await seed('orders/o9', orderFor(CUSTOMER, 'pending'));
    await assertSucceeds(getDoc(doc(asUser(CUSTOMER), 'products/p1')));
    await assertSucceeds(getDoc(doc(asUser(CUSTOMER), 'orders/o9')));
  });

  test("a customer can NOT read another customer's order", async () => {
    await seed('orders/o10', orderFor(OTHER_CUSTOMER, 'pending'));
    await assertFails(getDoc(doc(asUser(CUSTOMER), 'orders/o10')));
  });

  test('the analytics range query works for the admin who actually runs it', async () => {
    // Analytics reads `where('createdAt','>=',since)` + `orderBy('createdAt')`
    // instead of the newest 100 and filtering in the browser.
    //
    // Run as an ADMIN, which is the only context that ever issues it — the page
    // sits behind adminGuard. That matters: the orders read rule matches on
    // `resource.data.customerId`, and Firestore can only prove a LIST query is
    // authorised when the query itself is constrained to the caller's own
    // documents. A date-range query has no customerId filter, so a non-admin
    // issuing it is denied (asserted separately below). Relying on isAdmin()
    // short-circuiting first is correct here, and this test is what proves the
    // new query shape is actually readable.
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    await seed('orders/recent', { ...orderFor(CUSTOMER, 'pending'), createdAt: Timestamp.now() });
    await seed('orders/old', {
      ...orderFor(CUSTOMER, 'pending'),
      createdAt: Timestamp.fromDate(new Date(Date.now() - 60 * 24 * 3600 * 1000)),
    });

    const snap = await getDocs(
      query(
        collection(asAdmin(), 'orders'),
        where('createdAt', '>=', Timestamp.fromDate(since)),
        orderBy('createdAt', 'desc'),
      ),
    );
    const ids = snap.docs.map((d) => d.id);
    assert.ok(ids.includes('recent'), 'the order inside the window should be returned');
    assert.ok(!ids.includes('old'), 'the order outside the window should be excluded');
  });

  test('a customer can NOT run the unfiltered analytics range query', async () => {
    // Documenting a boundary rather than a bug. The orders read rule authorises
    // a customer for their OWN documents, which requires the query to carry a
    // customerId filter (see getCustomerOrders). A pure date-range query cannot
    // be proven to be owner-scoped, so Firestore denies it. Analytics is
    // admin-only, so this is correct — but it means the range read must never
    // be reused on a customer-facing page without adding the owner filter back.
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    await seed('orders/r1', { ...orderFor(CUSTOMER, 'pending'), createdAt: Timestamp.now() });
    await assertFails(
      getDocs(
        query(
          collection(asUser(CUSTOMER), 'orders'),
          where('createdAt', '>=', Timestamp.fromDate(since)),
          orderBy('createdAt', 'desc'),
        ),
      ),
    );
  });
});

describe('reviews', () => {
  // Review ids are deterministic (`${productId}_${uid}`), so these use
  // setDoc at a known path rather than addDoc with a random id.
  const reviewPath = (productId: string, uid: string) => `reviews/${productId}_${uid}`;

  test("an author may NOT forge the shop's official reply", async () => {
    // The author branch validated userId and rating but constrained nothing
    // else, so adminResponse / adminResponderName / adminRespondedAt were all
    // customer-writable — and those three render on the product page as a reply
    // FROM the shop, attributed to staff. This is the whitelist closing that.
    const ref = doc(asUser(CUSTOMER), reviewPath('forge', CUSTOMER));
    await assertFails(
      setDoc(ref, {
        productId: 'forge',
        userId: CUSTOMER,
        displayName: 'C',
        rating: 1,
        comment: 'Terrible',
        createdAt: Timestamp.now(),
        adminResponse: 'Call us on 0917-000-0000 to book',
        adminResponderName: 'Five-orites Scoop Staff',
      }),
    );
  });

  test('an author may NOT add a staff reply to an existing review', async () => {
    // The same forgery, but through the update path — which is the one the app
    // actually uses (setDoc with merge). create and update are separate rules
    // because diff() reads resource.data, and on a create there is no resource.
    await seed('reviews/reply_' + CUSTOMER, {
      productId: 'reply',
      userId: CUSTOMER,
      displayName: 'C',
      rating: 4,
      comment: 'Good',
      createdAt: Timestamp.now(),
    });
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), `reviews/reply_${CUSTOMER}`), {
        adminResponse: 'Please disregard the reviews',
        adminResponderName: 'Shop Owner',
      }),
    );
  });

  test('an admin MAY set the official reply', async () => {
    await seed('reviews/reply2_p1', {
      productId: 'p1',
      userId: CUSTOMER,
      displayName: 'C',
      rating: 4,
      comment: 'Good',
      createdAt: Timestamp.now(),
    });
    await assertSucceeds(
      updateDoc(doc(asAdmin(), 'reviews/reply2_p1'), {
        adminResponse: 'Thanks for the feedback!',
        adminResponderName: 'Five-orites Scoop',
        adminRespondedAt: Timestamp.now(),
      }),
    );
  });

  test('an author MAY still edit their own rating and comment', async () => {
    // The whitelist must not have broken the ordinary edit path. The document id
    // is the deterministic `${productId}_${uid}` the rules require, so productId
    // and the id have to agree.
    await seed(reviewPath('edit', CUSTOMER), {
      productId: 'edit',
      userId: CUSTOMER,
      displayName: 'C',
      rating: 4,
      comment: 'Good',
      createdAt: Timestamp.now(),
    });
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), reviewPath('edit', CUSTOMER)), {
        rating: 5,
        comment: 'Actually, excellent',
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('an admin may set a valid category', async () => {
    await assertSucceeds(
      updateDoc(doc(asAdmin(), 'products/p1'), {
        category: 'sundae',
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a customer may NOT change a category', async () => {
    // Category decides which storefront filter a product appears under, so it is
    // a merchandising field: admin-only, like pricing and isActive.
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        category: 'cone',
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('an admin may NOT set a category outside the allowed set', async () => {
    await assertFails(
      updateDoc(doc(asAdmin(), 'products/p1'), {
        category: 'popsicle',
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('a product with NO category is still editable (pre-category documents)', async () => {
    // The 64 seeded products predate the field. A rule that required it would
    // reject every one of them on its next admin edit, so the check is only
    // applied when the field is present.
    await seed('products/legacy', { ...PRODUCT, variantName: 'Legacy Flavor' });
    assert.equal((await getDoc(doc(asAdmin(), 'products/legacy'))).data()!.category, undefined);
    await assertSucceeds(
      updateDoc(doc(asAdmin(), 'products/legacy'), {
        'stock.cup': 7,
        updatedAt: Timestamp.now(),
      }),
    );
  });

  test('an admin may NOT write a NEGATIVE price', async () => {
    // `pricing.gallon is int` alone admitted -5000. That is not cosmetic:
    // reconcileOrderStock clamps the discount to [0, totalAmount], which is only
    // a safe clamp while totalAmount >= 0. With a negative price the subtotal is
    // negative, Math.min(0, -5000) is -5000, and the Admin SDK — which bypasses
    // these rules — persists a NEGATIVE discount that then satisfies
    // grandTotal == totalAmount - discountAmount + deliveryFee.
    await assertFails(updateDoc(doc(asAdmin(), 'products/p1'), { 'pricing.gallon': -5000 }));
    await assertFails(updateDoc(doc(asAdmin(), 'products/p1'), { 'pricing.cup': -1 }));
  });

  test('a price of exactly zero is still allowed', async () => {
    // The floor is >= 0, not > 0: a free sample or a giveaway flavour is a
    // legitimate merchandising decision, and a rule that refused it would just be
    // worked around in the data.
    await assertSucceeds(updateDoc(doc(asAdmin(), 'products/p1'), { 'pricing.cup': 0 }));
  });

  test('a signed-in user may post a review in range', async () => {
    await assertSucceeds(
      setDoc(doc(asUser(CUSTOMER), reviewPath('p1', CUSTOMER)), {
        productId: 'p1',
        userId: CUSTOMER,
        displayName: 'C',
        rating: 5,
        comment: 'Great',
        createdAt: Timestamp.now(),
      }),
    );
  });

  test('a user may NOT post an out-of-range rating', async () => {
    await assertFails(
      setDoc(doc(asUser(CUSTOMER), reviewPath('p1', CUSTOMER)), {
        productId: 'p1',
        userId: CUSTOMER,
        rating: 9,
        comment: 'Great',
        createdAt: Timestamp.now(),
      }),
    );
  });

  test('a fractional rating is rejected by the rules, not just the client', async () => {
    // The old rule was `rating >= 1 && rating <= 5` with no `is int`, so 4.5
    // passed the rules even though the client refused it.
    await assertFails(
      setDoc(doc(asUser(CUSTOMER), reviewPath('p1', CUSTOMER)), {
        productId: 'p1',
        userId: CUSTOMER,
        rating: 4.5,
        comment: 'Great',
        createdAt: Timestamp.now(),
      }),
    );
  });

  test("a user may NOT file a review under somebody else's id", async () => {
    await assertFails(
      setDoc(doc(asUser(CUSTOMER), reviewPath('p1', OTHER_CUSTOMER)), {
        productId: 'p1',
        userId: OTHER_CUSTOMER,
        rating: 5,
        comment: 'Great',
        createdAt: Timestamp.now(),
      }),
    );
  });

  test('a user may NOT impersonate another user inside their own id', async () => {
    // The id says CUSTOMER but the payload claims to be OTHER_CUSTOMER.
    await assertFails(
      setDoc(doc(asUser(CUSTOMER), reviewPath('p1', CUSTOMER)), {
        productId: 'p1',
        userId: OTHER_CUSTOMER,
        rating: 5,
        comment: 'Great',
        createdAt: Timestamp.now(),
      }),
    );
  });

  test('a user may edit their own review (a second submission is an update)', async () => {
    await seed(reviewPath('p1', CUSTOMER), {
      productId: 'p1',
      userId: CUSTOMER,
      rating: 5,
      comment: 'Great',
      createdAt: Timestamp.now(),
    });
    await assertSucceeds(
      setDoc(
        doc(asUser(CUSTOMER), reviewPath('p1', CUSTOMER)),
        { rating: 3, comment: 'Changed my mind' },
        { merge: true },
      ),
    );
  });

  test("a user may NOT edit somebody else's review", async () => {
    await seed(reviewPath('p1', OTHER_CUSTOMER), {
      productId: 'p1',
      userId: OTHER_CUSTOMER,
      rating: 5,
      comment: 'Theirs',
      createdAt: Timestamp.now(),
    });
    await assertFails(
      setDoc(
        doc(asUser(CUSTOMER), reviewPath('p1', OTHER_CUSTOMER)),
        { rating: 1, comment: 'Sabotage' },
        { merge: true },
      ),
    );
  });

  test('a user may withdraw their own review', async () => {
    await seed(reviewPath('p1', CUSTOMER), {
      productId: 'p1',
      userId: CUSTOMER,
      rating: 5,
      comment: 'Regret this',
      createdAt: Timestamp.now(),
    });
    await assertSucceeds(deleteDoc(doc(asUser(CUSTOMER), reviewPath('p1', CUSTOMER))));
  });

  test("a user may NOT delete somebody else's review", async () => {
    await seed(reviewPath('p1', OTHER_CUSTOMER), {
      productId: 'p1',
      userId: OTHER_CUSTOMER,
      rating: 5,
      comment: 'Theirs',
      createdAt: Timestamp.now(),
    });
    await assertFails(deleteDoc(doc(asUser(CUSTOMER), reviewPath('p1', OTHER_CUSTOMER))));
  });

  test('an admin may moderate any review', async () => {
    await seed(reviewPath('p1', OTHER_CUSTOMER), {
      productId: 'p1',
      userId: OTHER_CUSTOMER,
      rating: 1,
      comment: 'Spam',
      createdAt: Timestamp.now(),
    });
    await assertSucceeds(deleteDoc(doc(asAdmin(), reviewPath('p1', OTHER_CUSTOMER))));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /users and /vouchers had NO test coverage at all. The fixtures above were the
// only thing in this file that ever touched them, so the entire profile-editing
// and voucher surface — four of the five features added in this pass — was
// flying unreviewed. These pin the behaviour those features depend on.
// ─────────────────────────────────────────────────────────────────────────────

describe('users: self-service profile', () => {
  /**
   * The unread marker. REGRESSION — tapping a notification failed for EVERY role.
   *
   * `AuthService.updateProfile({ notificationsReadAt })` writes this field, and
   * all three `users` update branches gate on `diff().affectedKeys().hasOnly([…])`.
   * All three lists omitted it, so every write was PERMISSION_DENIED and the user
   * saw "Could not update your notifications" with a badge that would not clear.
   *
   * The instructive part is that nothing was individually wrong: the model carried
   * the field, `ProfilePatch` carried it, the write path was correct, and 143
   * rules tests passed. Two correct halves with nothing asserting they agree.
   */
  describe('the notification read marker', () => {
    test('a customer may mark their OWN feed read', async () => {
      await assertSucceeds(
        updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), {
          notificationsReadAt: 1_700_000_000_000,
        }),
      );
    });

    test('and may CLEAR it back to null', async () => {
      // markAllRead only ever sets a number, but a null is what an absent marker
      // reads as, and a rule that accepted the number but not the clear would
      // make the field write-once.
      await seed(`users/${CUSTOMER}`, {
        uid: CUSTOMER,
        role: 'customer',
        notificationsReadAt: 1_700_000_000_000,
      });
      await assertSucceeds(
        updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { notificationsReadAt: null }),
      );
    });

    test('staff, admin and owner may all mark their OWN feed read', async () => {
      // The reported symptom was "both client, admin, owner", because all three
      // lists omitted the field. Each tier therefore needs its own assertion:
      // fixing only the customer branch would leave the other two broken in a way
      // that still looks correct in the app.
      for (const uid of [STAFF, ADMIN, OWNER]) {
        await assertSucceeds(
          updateDoc(doc(asUser(uid), `users/${uid}`), { notificationsReadAt: 1_700_000_000_000 }),
        );
      }
    });

    test('a user may NOT set the marker on somebody ELSE', async () => {
      await assertFails(
        updateDoc(doc(asUser(CUSTOMER), `users/${OTHER_CUSTOMER}`), {
          notificationsReadAt: 1_700_000_000_000,
        }),
      );
    });

    test('a non-numeric marker is refused', async () => {
      await assertFails(
        updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { notificationsReadAt: 'yesterday' }),
      );
    });

    test('a fractional marker is refused — the field is epoch MILLIseconds', async () => {
      // `is number` would have admitted this. A fractional read marker silently
      // compares wrong against normalised epoch ms in the feed, so the badge
      // would be neither right nor reliably wrong.
      await assertFails(
        updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { notificationsReadAt: 1.5 }),
      );
    });

    test('the marker still cannot smuggle an admin-only field in', async () => {
      // Adding a key to the self-service whitelist must not widen the branch.
      // `isSuspended` is the one that matters: a customer who could write it
      // could lift their own suspension.
      await assertFails(
        updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), {
          notificationsReadAt: 1_700_000_000_000,
          isSuspended: false,
        }),
      );
    });
  });

  // Account deletion. Both app stores require an in-app deletion path for an app
  // that lets someone create an account, and this rule used to be `if false`
  // for everyone -- PRIVACY.md had to promise a manual email route because
  // nothing in the app could remove anything.
  test('a user may delete their OWN account document', async () => {
    await assertSucceeds(deleteDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`)));
  });

  test("a user may NOT delete somebody else's account", async () => {
    await assertFails(deleteDoc(doc(asUser(CUSTOMER), `users/${OTHER_CUSTOMER}`)));
  });

  test("a customer may NOT delete an ADMIN's account", async () => {
    // The self-delete path must not become a way to remove a superior.
    await assertFails(deleteDoc(doc(asUser(CUSTOMER), 'users/owner-uid')));
  });

  test('a signed-out caller may delete nothing', async () => {
    await assertFails(deleteDoc(doc(unauthed(), `users/${CUSTOMER}`)));
  });

  test("even an OWNER cannot delete another person's account", async () => {
    // canManageUsers() grants role changes, not deletion. Deleting another
    // account is deliberately out of reach of every tier from the client:
    // wiping a customer's history is not recoverable in-app.
    await assertFails(deleteDoc(doc(asOwner(), `users/${CUSTOMER}`)));
  });

  test('a customer may set their own display name', async () => {
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { displayName: 'New Name' }),
    );
  });

  test('a customer may set a phone number', async () => {
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { phone: '+639171234567' }),
    );
  });

  test('a customer may set a profile photo', async () => {
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), {
        photoURL: 'https://res.cloudinary.com/fhtucp4v/image/upload/avatars/a.jpg',
      }),
    );
  });

  test('a customer may store their notification preference', async () => {
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { notificationsEnabled: false }),
    );
  });

  test('a customer may NOT promote themselves to admin', async () => {
    // The single most important assertion in this block. The rules pin
    // `role == resource.data.role` on the owner branch, so this must fail even
    // though the owner branch is otherwise unrestricted.
    await assertFails(updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { role: 'admin' }));
  });

  test('a customer may NOT change their own uid', async () => {
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { uid: OTHER_CUSTOMER }),
    );
  });

  test('a customer may NOT write a full document that drops role', async () => {
    // WHY THIS TEST MATTERS — the asymmetry is a genuine footgun.
    //
    // `allow update: if isAdmin() || (isOwner(uid) && role unchanged && uid
    // unchanged)`. A non-merged setDoc from a CUSTOMER omits `role`, so
    // `request.resource.data.role` is null, `resource.data.role` is 'customer',
    // and the comparison fails — the write is REJECTED. Loudly, and safely.
    //
    // The same non-merged setDoc from an ADMIN takes the `isAdmin()` branch,
    // which short-circuits with no validation at all. The write SUCCEEDS and the
    // target document loses its role, which for an admin editing themselves means
    // instant self-demotion and lockout of every admin page.
    //
    // So code that behaves correctly for a customer silently corrupts for an
    // admin. This test pins the fail-safe half; the admin half is a UI
    // responsibility (always merge), documented in auth.service.ts.
    await assertFails(
      setDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { displayName: 'Only This' }),
    );
  });

  test('a merged write keeps the document intact', async () => {
    await assertSucceeds(
      setDoc(
        doc(asUser(CUSTOMER), `users/${CUSTOMER}`),
        { displayName: 'Merged' },
        { merge: true },
      ),
    );
    const after = (await getDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`))).data()!;
    assert.equal(after.role, 'customer');
    assert.equal(after.displayName, 'Merged');
  });

  test("a customer may NOT write another user's document", async () => {
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), `users/${OTHER_CUSTOMER}`), { displayName: 'Hax' }),
    );
  });

  test('a signed-out caller may NOT delete a user document', async () => {
    await assertFails(deleteDoc(doc(unauthed(), `users/${CUSTOMER}`)));
  });

  test('a signed-out visitor may NOT read a user document', async () => {
    await assertFails(getDoc(doc(unauthed(), `users/${CUSTOMER}`)));
  });

  test('a sparse document is still editable', async () => {
    // An admin bootstrapped by hand in the Firebase console — the ONLY documented
    // way to create the first admin — holds just { uid, role }. `allow create`
    // does not require email/displayName/createdAt, so that shape is
    // rules-valid, and the profile form has to tolerate a missing displayName.
    await seed('users/sparse', { uid: 'sparse', role: 'customer' });
    await assertSucceeds(
      updateDoc(doc(asUser('sparse'), 'users/sparse'), { displayName: 'Now Named' }),
    );
  });
});

describe('users: directory listing', () => {
  test('an OWNER may run an unfiltered collection query', async () => {
    // This is the assertion the whole admin Users page rests on, and the reason
    // it needs NO rules change.
    //
    // Firestore authorises a list only if the `allow read` condition can be
    // proven for EVERY document the query could return — it cannot evaluate
    // rules per returned row, because that would leak which documents exist.
    // `isOwner(uid)` depends on the path parameter, so it is true for exactly
    // one document and cannot satisfy an unfiltered query. `canManageUsers()`
    // depends only on `request.auth` plus a get() of the CALLER's own document —
    // never on the document being read — so it is provable for all of them.
    const snap = await getDocs(query(collection(asOwner(), 'users'), orderBy('uid', 'asc')));
    assert.ok(snap.size >= 3, `expected the seeded users, got ${snap.size}`);
  });

  test('a customer may NOT run an unfiltered collection query', async () => {
    await assertFails(getDocs(query(collection(asUser(CUSTOMER), 'users'), orderBy('uid', 'asc'))));
  });

  test('an admin may NOT enumerate the user directory', async () => {
    // The tier boundary that matters most. An `admin` can read a single document
    // — the fulfilment queue needs to show who an order belongs to — but listing
    // the whole directory is OWNER-only, so a compromised admin account cannot
    // export every customer in the shop.
    await assertFails(getDocs(query(collection(asAdmin(), 'users'), orderBy('uid', 'asc'))));
  });

  test('staff may NOT enumerate the user directory either', async () => {
    await assertFails(getDocs(query(collection(asStaff(), 'users'), orderBy('uid', 'asc'))));
  });

  test("an admin may edit another user's PROFILE but not their role", async () => {
    // The line between "fix this customer\'s phone number" and "make this person
    // an admin". Both were the same operation before role tiers.
    await assertSucceeds(
      updateDoc(doc(asAdmin(), `users/${OTHER_CUSTOMER}`), { displayName: 'Staff Edit' }),
    );
    await assertFails(updateDoc(doc(asAdmin(), `users/${OTHER_CUSTOMER}`), { role: 'manager' }));
    const after = (await getDoc(doc(asOwner(), `users/${OTHER_CUSTOMER}`))).data()!;
    assert.equal(after.role, 'customer', 'the role must be untouched');
  });

  test("an OWNER MAY change another user's role (the promotion path)", async () => {
    await assertSucceeds(updateDoc(doc(asOwner(), `users/${OTHER_CUSTOMER}`), { role: 'manager' }));
    const after = (await getDoc(doc(asOwner(), `users/${OTHER_CUSTOMER}`))).data()!;
    assert.equal(after.role, 'manager');
  });

  test('an OWNER may NOT demote THEMSELVES', async () => {
    // The permanent-lockout hole. Under the old rules `allow update: if isAdmin()`
    // was unconditional, so the last admin could write `role: 'customer'` onto
    // themselves: isAdmin() then returns false for everyone, and `allow delete:
    // if false` means the account cannot be removed. The admin side becomes
    // unreachable with no recovery path from inside the app.
    //
    // Guarded by `isNotDemotingSelf()` in the rules, not only by the disabled
    // checkbox in admin-users.page.ts — a UI guard is a suggestion.
    await assertFails(updateDoc(doc(asOwner(), `users/${OWNER}`), { role: 'customer' }));
    const after = (await getDoc(doc(asOwner(), `users/${OWNER}`))).data()!;
    assert.equal(after.role, 'owner', 'the owner must still be an owner');
  });

  test('an account may NOT promote ITSELF', async () => {
    // Self-escalation is the same danger as self-demotion, and the same guard
    // blocks it: a `manager` writing `role: 'owner'` onto their own document
    // would otherwise grant themselves the whole user directory.
    await assertFails(updateDoc(doc(asOwner(), `users/${OWNER}`), { role: 'customer' }));
  });

  test('an owner may still edit their OWN profile while staying owner', async () => {
    // The guard must not be so broad that it blocks a name or phone edit made by
    // the owner to their own document.
    await assertSucceeds(
      updateDoc(doc(asOwner(), `users/${OWNER}`), { displayName: 'Still An Owner' }),
    );
    const after = (await getDoc(doc(asOwner(), `users/${OWNER}`))).data()!;
    assert.equal(after.displayName, 'Still An Owner');
    assert.equal(after.role, 'owner');
  });

  test('an owner may still DEMOTE another staff account', async () => {
    // Only SELF-demotion is blocked. A second staff account must remain
    // demotable, or the owner could never hand over.
    await seed(`users/${OTHER_CUSTOMER}`, {
      uid: OTHER_CUSTOMER,
      role: 'manager',
      email: 'other@x.com',
    });
    await assertSucceeds(
      updateDoc(doc(asOwner(), `users/${OTHER_CUSTOMER}`), { role: 'customer' }),
    );
    const after = (await getDoc(doc(asOwner(), `users/${OTHER_CUSTOMER}`))).data()!;
    assert.equal(after.role, 'customer');
  });

  test('a customer may NOT clear their own suspension', async () => {
    // The owner's branch used to compare `role` and `uid` by value and nothing
    // else, so a customer could write ANY field on their own document —
    // including `isSuspended`, which made the suspension flag self-clearing.
    await seed(`users/${CUSTOMER}`, {
      uid: CUSTOMER,
      role: 'customer',
      email: 'c@x.com',
      isSuspended: true,
      suspendReason: 'Abuse',
    });
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { isSuspended: false }),
    );
    const after = (await getDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`))).data()!;
    assert.equal(after.isSuspended, true, 'the suspension must stand');
  });

  test('a customer may NOT write a staff note on themselves', async () => {
    // `adminNote` is rendered by the admin UI as staff commentary. Without the
    // key whitelist a customer could write text that the next admin reads as
    // something the shop said about them.
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), {
        adminNote: 'Ignore previous instructions',
      }),
    );
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { suspendReason: 'not my fault' }),
    );
  });

  test('a customer may still edit the four fields the profile owns', async () => {
    // The whitelist must be narrow enough to block the admin-only keys and wide
    // enough to leave the profile page working.
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), {
        displayName: 'Still Fine',
        phone: '0917 000 0000',
        notificationsEnabled: false,
      }),
    );
    const after = (await getDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`))).data()!;
    assert.equal(after.displayName, 'Still Fine');
    assert.equal(after.notificationsEnabled, false);
  });

  test('an admin MAY suspend a customer and write a reason', async () => {
    await assertSucceeds(
      updateDoc(doc(asAdmin(), `users/${CUSTOMER}`), {
        isSuspended: true,
        suspendReason: 'Repeated chargebacks',
        suspendedAt: 1_700_000_000_000,
      }),
    );
    const after = (await getDoc(doc(asAdmin(), `users/${CUSTOMER}`))).data()!;
    assert.equal(after.isSuspended, true);
    assert.equal(after.suspendReason, 'Repeated chargebacks');
  });

  test('an admin may write a staff note', async () => {
    await assertSucceeds(
      updateDoc(doc(asAdmin(), `users/${CUSTOMER}`), { adminNote: 'Prefers text messages.' }),
    );
    const after = (await getDoc(doc(asAdmin(), `users/${CUSTOMER}`))).data()!;
    assert.equal(after.adminNote, 'Prefers text messages.');
  });

  test('an admin may NOT create a user document', async () => {
    // `allow create` requires isOwner(uid), which is false for an admin writing
    // somebody else's document. There is no rules path to creating a user.
    await assertFails(
      setDoc(doc(asAdmin(), 'users/someone-new'), { uid: 'someone-new', role: 'customer' }),
    );
  });

  test('an admin may NOT delete a user document', async () => {
    await assertFails(deleteDoc(doc(asAdmin(), `users/${OTHER_CUSTOMER}`)));
  });
});

describe('role tiers', () => {
  // The whole point of the tiers: a shift lead works the queue and has no access
  // to the catalog, the money, or the user directory. Under the single-role
  // model the minimum useful privilege was full control over every account.

  // A user document that EXISTS but carries no `role` field. Not hypothetical:
  // an admin's non-merged `setDoc` on a user document takes the `isAdmin()` branch,
  // which short-circuits with no field validation and succeeds, dropping the role.
  // See the "regression: a non-merged write must not strip a role" test above.
  //
  // `myRole()` therefore reads the role with `.get('role', '')`. Dot access to an
  // absent key is an EVALUATION ERROR rather than `false`, which aborts the whole
  // rule expression instead of just denying - so the same account would be locked
  // out by a crash rather than by a decision, and the emulator log would blame an
  // internal fault instead of naming the missing field.
  //
  // HONEST SCOPE: today this changes no outcome. Every role check in the file sits
  // on the RIGHT of its `||`, where "threw" and "false" deny identically. The value
  // is that it removes a trap: the first `isStaff() || <permissive clause>` added
  // to this file would behave differently under an evaluation error, and silently.
  test('an account whose document has no role gets no staff access', async () => {
    await seed('users/roleless-uid', { uid: 'roleless-uid', displayName: 'No Role' });

    // The staff-only catalog write.
    await assertFails(
      updateDoc(doc(authed('roleless-uid'), 'products/p1'), {
        pricing: { cup: 1, pint: 1, halfGallon: 1, gallon: 1 },
      }),
    );
    // And the staff-only reads: the order queue and the user directory.
    await assertFails(getDocs(collection(authed('roleless-uid'), 'orders')));
    await assertFails(getDocs(collection(authed('roleless-uid'), 'users')));
  });

  test('a role-less account is not blanket-denied: it keeps what a customer keeps', async () => {
    await seed('users/roleless-uid', { uid: 'roleless-uid', displayName: 'No Role' });
    await seed('products/p1', PRODUCT);

    // The counterpart to the test above. Refusing a role-less account everywhere
    // would ALSO satisfy every assertFails there, and would be a far worse bug than
    // the one being fixed: a customer who somehow lost their role field would find
    // the app entirely dead rather than merely staff-less.
    //
    // What a signed-in customer may still do: read the catalogue (`allow read: if
    // isSignedIn()`), and read their own user document (`isOwner(uid)`). A
    // role-less account must keep both.
    await assertSucceeds(getDoc(doc(authed('roleless-uid'), 'products/p1')));
    await assertSucceeds(getDoc(doc(authed('roleless-uid'), `users/roleless-uid`)));

    // And it must still be refused the stock write, exactly as a customer is: there
    // is no customer branch on the products rule at all.
    await assertFails(updateDoc(doc(authed('roleless-uid'), 'products/p1'), { 'stock.cup': 99 }));
  });

  test('staff may read the order queue', async () => {
    await assertSucceeds(getDocs(collection(asStaff(), 'orders')));
  });

  test('staff may NOT write the catalog beyond stock', async () => {
    // Note what is NOT asserted: a staff write to `stock` alone SUCCEEDS,
    // because the customer branch of the products rule permits any signed-in
    // user to touch that one key. That is the pre-existing documented
    // limitation, not a tier decision — see the "KNOWN LIMITATION" comment in
    // firestore.rules, which the "a customer CAN raise stock to any non-negative
    // int" test in this file asserts deliberately.
    //
    // The tier boundary that DOES exist is everything else: a shift lead cannot
    // rename a flavor, reprice it, or activate a deactivated one.
    await seed('products/p2', { ...PRODUCT, variantName: 'Mint Chip' });
    await assertFails(updateDoc(doc(asStaff(), 'products/p2'), { variantName: 'Renamed' }));
    await assertFails(updateDoc(doc(asStaff(), 'products/p2'), { 'pricing.cup': 1 }));
    await assertFails(updateDoc(doc(asStaff(), 'products/p2'), { isActive: false }));
    await assertFails(
      setDoc(doc(asStaff(), 'products/new-flavor'), { ...PRODUCT, variantName: 'New' }),
    );
  });

  test('a manager MAY write the catalog', async () => {
    await seed(`users/${MANAGER}`, { uid: MANAGER, role: 'manager' });
    await seed('products/p2', { ...PRODUCT, variantName: 'Mint Chip' });
    await assertSucceeds(
      updateDoc(doc(authed(MANAGER), 'products/p2'), {
        'stock.cup': 99,
      }),
    );
  });

  test('staff may NOT create a voucher', async () => {
    await assertFails(
      setDoc(doc(asStaff(), 'vouchers/EVIL'), {
        code: 'EVIL',
        type: 'percent',
        value: 90,
        isActive: true,
      }),
    );
  });

  test('an admin MAY create a voucher', async () => {
    await assertSucceeds(
      setDoc(doc(asAdmin(), 'vouchers/OK10'), {
        code: 'OK10',
        type: 'percent',
        value: 10,
        isActive: true,
      }),
    );
  });

  test('a manager may NOT create a voucher', async () => {
    await seed(`users/${MANAGER}`, { uid: MANAGER, role: 'manager' });
    await assertFails(
      setDoc(doc(authed(MANAGER), 'vouchers/NOPE'), {
        code: 'NOPE',
        type: 'percent',
        value: 10,
        isActive: true,
      }),
    );
  });

  test('a customer may NOT read the order queue', async () => {
    await assertFails(getDocs(collection(asUser(CUSTOMER), 'orders')));
  });

  test('staff may NOT write the stock ledger', async () => {
    // The ledger is append-only and owner/admin-only: a fabricated row would let
    // someone reconcile their own unlogged stock writes.
    await assertFails(
      addDoc(collection(asStaff(), 'stockMovements'), {
        productId: 'p1',
        variantName: 'X',
        size: 'cup',
        delta: 999,
        balanceAfter: 999,
        reason: 'sale',
      }),
    );
  });

  test('an admin MAY append to the stock ledger', async () => {
    await assertSucceeds(
      addDoc(collection(asAdmin(), 'stockMovements'), {
        productId: 'p1',
        variantName: 'X',
        size: 'cup',
        delta: -1,
        balanceAfter: 9,
        reason: 'sale',
      }),
    );
  });
});

describe('vouchers', () => {
  const voucher = (code: string) => ({
    code,
    type: 'percent',
    value: 10,
    minOrder: 200,
    isActive: true,
  });

  test('a signed-in customer may read all vouchers', async () => {
    await seed('vouchers/SCOOP10', voucher('SCOOP10'));
    const snap = await getDocs(collection(asUser(CUSTOMER), 'vouchers'));
    assert.equal(snap.size, 1);
  });

  test('a signed-in customer may list only active vouchers', async () => {
    // The grab-cards query. A single equality filter is served by Firestore's
    // automatic single-field index, so no composite index is required — which is
    // why this passes with nothing deployed.
    await seed('vouchers/SCOOP10', voucher('SCOOP10'));
    await seed('vouchers/OLD', { ...voucher('OLD'), isActive: false });
    const snap = await getDocs(
      query(collection(asUser(CUSTOMER), 'vouchers'), where('isActive', '==', true)),
    );
    assert.equal(snap.size, 1);
    assert.equal(snap.docs[0].id, 'SCOOP10');
  });

  test('a signed-OUT visitor may NOT read vouchers', async () => {
    await seed('vouchers/SCOOP10', voucher('SCOOP10'));
    await assertFails(getDocs(collection(unauthed(), 'vouchers')));
  });

  test('an admin may create a voucher', async () => {
    // `allow write: if isAdmin()` existed with no caller anywhere in src/ before
    // this. The admin vouchers page is that caller.
    await assertSucceeds(setDoc(doc(asAdmin(), 'vouchers/FREE50'), voucher('FREE50')));
  });

  test('an admin may deactivate a voucher', async () => {
    await seed('vouchers/SCOOP10', voucher('SCOOP10'));
    await assertSucceeds(updateDoc(doc(asAdmin(), 'vouchers/SCOOP10'), { isActive: false }));
  });

  test('a customer may NOT create a voucher', async () => {
    // The live discount-control bypass. `validateVoucher` resolves the discount
    // from this collection server-side precisely so a tampered client cannot
    // dictate a price — which is only true while customers cannot write here.
    await assertFails(
      setDoc(doc(asUser(CUSTOMER), 'vouchers/EVIL100'), {
        code: 'EVIL100',
        type: 'percent',
        value: 100,
        isActive: true,
      }),
    );
  });

  test('a customer may NOT edit or delete a voucher', async () => {
    await seed('vouchers/SCOOP10', voucher('SCOOP10'));
    await assertFails(updateDoc(doc(asUser(CUSTOMER), 'vouchers/SCOOP10'), { value: 90 }));
    await assertFails(deleteDoc(doc(asUser(CUSTOMER), 'vouchers/SCOOP10')));
  });
});

describe('shop settings', () => {
  const settings = () => ({
    lowStockThreshold: 12,
    promoTitle: 'Mango season',
    promoBody: 'New flavors this week.',
    promoActive: true,
    contactPhone: '0917 000 0000',
  });

  test('a signed-in customer may read the settings document', async () => {
    // The storefront renders the promo banner and the low-stock pill reads the
    // threshold, so customer-side read is required, not a leak.
    await seed('shopSettings/app', settings());
    const snap = await getDoc(doc(asUser(CUSTOMER), 'shopSettings/app'));
    assert.equal(snap.exists(), true);
  });

  test('a signed-OUT visitor may NOT read the settings document', async () => {
    await seed('shopSettings/app', settings());
    await assertFails(getDoc(doc(unauthed(), 'shopSettings/app')));
  });

  test('an admin may NOT write the settings document (owner-only now)', async () => {
    // shopSettings/app changes are one of the owner-role capabilities, NOT admin:
    // the capability guard on the client blocks the page, and the deploy must now
    // honor that rather than granting admin a write the model denies.
    const docRef = doc(asAdmin(), 'shopSettings/app');
    await assertFails(setDoc(docRef, settings()));
  });

  test('an owner MAY write the settings document', async () => {
    const docRef = doc(asOwner(), 'shopSettings/app');
    await assertSucceeds(setDoc(docRef, settings()));
  });

  test('settings delete is refused for everyone', async () => {
    await seed('shopSettings/app', settings());
    const asAny = asOwner();
    await assertFails(deleteDoc(doc(asAny, 'shopSettings/app')));
  });

  test('a customer may NOT write the settings document', async () => {
    // Otherwise any customer could raise the low-stock threshold out of the way
    // and hide their own overselling from the dashboard.
    await assertFails(
      setDoc(doc(asUser(CUSTOMER), 'shopSettings/app'), { ...settings(), lowStockThreshold: 999 }),
    );
  });
});

describe('developers (the public credits page)', () => {
  /**
   * These five records were object literals inside `DevelopersPage`, so there was
   * nothing to write and therefore nothing to protect. They are documents now,
   * which makes them the first thing in this file that a CUSTOMER could reach for
   * if the block were written loosely.
   *
   * The asymmetry is the point: `/developers` carries no route guard, so a
   * signed-out guest reads it — that is why `read` is open. Cloudinary is
   * configured with an UNSIGNED upload preset, so the upload POST cannot be
   * permission-gated either, which means the Firestore write is the ONLY
   * enforceable step in the whole photo feature. A UI-only permission control
   * would be cosmetic, and these tests are what make the rules block load-bearing
   * rather than decorative.
   */
  const developer = (over: Record<string, unknown> = {}) => ({
    name: 'Kenn Karlo Umadhay',
    roles: ['Main Project Lead', 'QA'],
    accent: '#CFE4F2',
    photoURL: null,
    order: 1,
    ...over,
  });

  // ── Read ────────────────────────────────────────────────────────────────

  test('a signed-OUT visitor may read the credits', async () => {
    // Required, not a leak: the storefront links /developers and the page has no
    // authGuard. Gating the read would blank the credits for every visitor.
    await seed('developers/kenn', developer());
    const snap = await getDoc(doc(unauthed(), 'developers/kenn'));
    assert.equal(snap.exists(), true);
  });

  test('a customer may list the credits', async () => {
    await seed('developers/kenn', developer());
    const snap = await getDocs(collection(asUser(CUSTOMER), 'developers'));
    assert.equal(snap.size, 1);
  });

  // ── Write: manager and owner ─────────────────────────────────────────────

  test('a manager MAY create a credit', async () => {
    await assertSucceeds(setDoc(doc(asManager(), 'developers/new'), developer()));
  });

  test('an owner MAY create a credit', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), 'developers/new'), developer()));
  });

  test('a manager MAY edit an existing credit', async () => {
    await seed('developers/kenn', developer());
    await assertSucceeds(
      updateDoc(doc(asManager(), 'developers/kenn'), { name: 'Kenn U. Umadhay' }),
    );
  });

  // ── Write: everyone else, including ADMIN ───────────────────────────────

  test('a customer may NOT create a credit', async () => {
    await assertFails(setDoc(doc(asUser(CUSTOMER), 'developers/new'), developer()));
  });

  test('a staff account may NOT create a credit', async () => {
    // The one regression worth stating: `staff` works the fulfilment queue and
    // can move an order, which is exactly the argument someone would make for
    // letting them edit the credits. Rewriting who built the app is not a queue task.
    await assertFails(setDoc(doc(asStaff(), 'developers/new'), developer()));
  });

  test('an ADMIN may NOT create a credit — the manager/owner line is deliberate', async () => {
    // `canRunShop()` would have allowed this, since it is manager+admin+owner.
    // Rewriting the credits is the one page where admin is excluded, so
    // `canManageTeam()` is manager+owner only and this test is what holds it there.
    await assertFails(setDoc(doc(asAdmin(), 'developers/new'), developer()));
  });

  test('an admin may NOT edit an existing credit', async () => {
    await seed('developers/kenn', developer());
    await assertFails(updateDoc(doc(asAdmin(), 'developers/kenn'), { name: 'Someone Else' }));
  });

  // ── Delete: owner only ───────────────────────────────────────────────────

  test('an owner MAY delete a credit', async () => {
    await seed('developers/kenn', developer());
    await assertSucceeds(deleteDoc(doc(asOwner(), 'developers/kenn')));
  });

  test('a manager may NOT delete a credit', async () => {
    await seed('developers/kenn', developer());
    await assertFails(deleteDoc(doc(asManager(), 'developers/kenn')));
  });

  test('an admin may NOT delete a credit', async () => {
    await seed('developers/kenn', developer());
    await assertFails(deleteDoc(doc(asAdmin(), 'developers/kenn')));
  });

  // ── Shape ────────────────────────────────────────────────────────────────

  test('an accent outside the palette is refused', async () => {
    // The initials are plum on a PASTEL disc, which clears AA on each of the five.
    // A free colour value would put unreadable text on a dark disc, and
    // check:contrast validates design tokens rather than a value typed at runtime.
    await assertFails(setDoc(doc(asOwner(), 'developers/dark'), developer({ accent: '#101010' })));
  });

  test('each of the five palette accents IS accepted', async () => {
    for (const [i, hex] of ['#CFE4F2', '#CDEAD9', '#F8D2DD', '#FBE9BE', '#D3DDF7'].entries()) {
      await assertSucceeds(
        setDoc(doc(asOwner(), `developers/a${i}`), developer({ accent: hex, order: i })),
      );
    }
  });

  test('an empty name is refused', async () => {
    await assertFails(setDoc(doc(asOwner(), 'developers/x'), developer({ name: '' })));
  });

  test('a non-integer order is refused', async () => {
    await assertFails(setDoc(doc(asOwner(), 'developers/x'), developer({ order: 1.5 })));
  });

  test('an unknown field may NOT be smuggled in', async () => {
    // A photo URL is not the only thing a field could smuggle: a `role` here would
    // be inert, but the point is that the whitelist is a whitelist.
    await assertFails(setDoc(doc(asOwner(), 'developers/x'), { ...developer(), isAdmin: true }));
  });

  test('a credit may NOT be created with a photo URL that is not a string', async () => {
    await assertFails(setDoc(doc(asOwner(), 'developers/x'), developer({ photoURL: 42 })));
  });

  test('roles must be a list', async () => {
    await assertFails(setDoc(doc(asOwner(), 'developers/x'), developer({ roles: 'QA' })));
  });

  test('a credit with NO roles is refused', async () => {
    // A card with a name and no roles says nothing, and the client already blocks
    // saving one; the rules agree rather than leaving it to the UI.
    await assertFails(setDoc(doc(asOwner(), 'developers/x'), developer({ roles: [] })));
  });

  test('a photo URL of null is ACCEPTED — that is what the seed and the clear button write', async () => {
    // Regression: the helper first required `photoURL is string`, which refused the
    // exact shape the app itself produces with no photo uploaded.
    await assertSucceeds(
      setDoc(doc(asOwner(), 'developers/nophoto'), developer({ photoURL: null })),
    );
  });

  test('a photo URL string is accepted', async () => {
    await assertSucceeds(
      setDoc(
        doc(asOwner(), 'developers/photo'),
        developer({
          photoURL: 'https://res.cloudinary.com/demo/image/upload/five-orites-scoop/avatars/x.jpg',
        }),
      ),
    );
  });
});

describe('stock movements (the ledger)', () => {
  const movement = () => ({
    productId: '1_rocky_road',
    variantName: 'Rocky Road',
    size: 'cup',
    delta: -2,
    balanceAfter: 8,
    reason: 'sale',
    orderId: 'order-1',
    createdAt: new Date(),
  });

  test('an admin may append a movement', async () => {
    await assertSucceeds(addDoc(collection(asAdmin(), 'stockMovements'), movement()));
  });

  test('an admin may read the ledger', async () => {
    await seed('stockMovements/m1', movement());
    const snap = await getDocs(collection(asAdmin(), 'stockMovements'));
    assert.equal(snap.size, 1);
  });

  test('a customer may NOT read the ledger', async () => {
    // Rows carry order ids and who moved the stock. A customer reading the audit
    // trail would learn other people's order ids.
    await seed('stockMovements/m1', movement());
    await assertFails(getDocs(collection(asUser(CUSTOMER), 'stockMovements')));
  });

  test('a customer may NOT append a movement', async () => {
    // The whole value of the ledger is that a row means "this changed through the
    // app". If a customer could write one, they could fabricate the history that
    // reconciles their own unlogged stock writes.
    await assertFails(addDoc(collection(asUser(CUSTOMER), 'stockMovements'), movement()));
  });

  test('a movement may NOT be edited or deleted, not even by an admin', async () => {
    // An append-only log. An editable ledger is not evidence of anything.
    await seed('stockMovements/m1', movement());
    await assertFails(updateDoc(doc(asAdmin(), 'stockMovements/m1'), { delta: 0 }));
    await assertFails(deleteDoc(doc(asAdmin(), 'stockMovements/m1')));
  });
});

describe('unlisted collections are denied by design', () => {
  test('the catch-all denies a collection with no match block', async () => {
    // Firestore denies unmatched paths implicitly, so this asserts the behaviour
    // rather than the mechanism — but the explicit `match /{document=**}` means it
    // is now a stated rule instead of an omission nobody wrote down.
    await seed('secretThing/x', { hello: 'world' });
    await assertFails(getDocs(collection(asAdmin(), 'secretThing')));
    await assertFails(setDoc(doc(asAdmin(), 'secretThing/x'), { hello: 'world' }));
  });
});

describe('orders: cached geocode', () => {
  // The tracking map caches a geocoded destination on the order as
  // `geo: { lat, lng }` so an address is resolved once rather than on every page
  // open. The order create rule validates eleven specific fields and contains no
  // hasOnly/keys() check, so unknown fields are permitted — this pins that, since
  // the map feature depends on it.
  test('a customer may NOT create an order carrying a geo field', async () => {
    // The order create rule now has a keys() allow-list (the laundering defense),
    // so unknown fields are rejected at create. The map feature caches `geo` via a
    // later STAFF update (see `an admin may write a geo field onto an order`), so
    // no customer create needs to carry it.
    await assertFails(
      addDoc(collection(asUser(CUSTOMER), 'orders'), {
        ...orderFor(CUSTOMER, 'pending'),
        geo: { lat: 14.6188159, lng: 121.1029457, label: 'Cainta, Rizal' },
      }),
    );
  });

  test('a customer MAY cache geo on their own order, and only that', async () => {
    // OrderTrackerPage.ensureDestination geocodes `deliveryAddress` and writes the
    // result back so the map — and the admin dispatch map — have a pin to draw.
    // That write was PERMISSION_DENIED on every attempt and the failure was
    // swallowed by a console.warn, so the geocode was never cached and the admin
    // map could never show a destination. It is now allowed by its own narrow
    // rule rather than by widening the cancel branch.
    //
    // The original test asserted the opposite ("may NOT add geo while
    // cancelling"). That pinned the bug as intended behaviour. The concern behind
    // it was real and is preserved by the test below: a customer must not be able
    // to ride a geo write to touch anything else.
    await seed('orders/o1', orderFor(CUSTOMER, 'pending'));
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o1'), {
        geo: { lat: 14.6188159, lng: 121.1029457, label: 'Cainta, Rizal' },
      }),
    );
  });

  test('a geo write may NOT be used to touch anything else', async () => {
    // This is the invariant the cancel branch's whitelist exists to protect, and
    // the reason geo got its own rule instead of a slot in that one. The cancel
    // branch requires status == 'pending', and a tracker is opened precisely to
    // watch an order that has already left, so geo could not go there. Here it
    // must not become a second way in: pairing geo with a status change, or with
    // any money field, must still fail.
    await seed('orders/o1', orderFor(CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o1'), {
        geo: { lat: 14.6, lng: 121.1 },
        status: 'cancelled',
      }),
    );
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o1'), {
        geo: { lat: 14.6, lng: 121.1 },
        grandTotal: 0,
      }),
    );
  });

  test("a customer may NOT cache a geo on somebody else's order", async () => {
    await seed('orders/o3', orderFor(OTHER_CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o3'), { geo: { lat: 14.6, lng: 121.1 } }),
    );
  });

  test('a customer may NOT cache an out-of-range coordinate', async () => {
    // Leaflet throws on a non-finite or out-of-range coordinate, and a throw
    // inside the map render takes the whole tracker page with it.
    await seed('orders/o1', orderFor(CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o1'), { geo: { lat: 999, lng: 121.1 } }),
    );
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o1'), { geo: { lat: 14.6, lng: -999 } }),
    );
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o1'), { geo: { lat: 'north', lng: 121.1 } }),
    );
  });

  test('an admin may write a geo field onto an order', async () => {
    await seed('orders/o2', orderFor(CUSTOMER, 'pending'));
    await assertSucceeds(
      updateDoc(doc(asAdmin(), 'orders/o2'), {
        geo: { lat: 14.6188159, lng: 121.1029457, label: 'Cainta, Rizal' },
      }),
    );
  });
});
