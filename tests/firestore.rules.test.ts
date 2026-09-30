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

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection,
  query, where, orderBy, getDocs, Timestamp,
} from 'firebase/firestore';

let env: RulesTestEnvironment;

const ADMIN = 'admin-uid';
const CUSTOMER = 'customer-uid';
const OTHER_CUSTOMER = 'other-customer-uid';

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
    items: [{ productId: 'p1', variantName: 'Rocky Road', setName: 'Chocolates', size: 'cup', quantity: 1, unitPrice: 65, subtotal: 65 }],
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

const asUser = (uid: string | null) => env.authenticatedContext(uid).firestore();
const asAdmin = () => env.authenticatedContext(ADMIN).firestore();

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
    await setDoc(doc(db, `users/${CUSTOMER}`), { uid: CUSTOMER, role: 'customer' });
    await setDoc(doc(db, `users/${OTHER_CUSTOMER}`), { uid: OTHER_CUSTOMER, role: 'customer' });
  });
});

describe('products: customer stock writes', () => {
  test('a customer may decrement stock by one size (the checkout path)', async () => {
    // Mirrors inventory.service.ts validateAndDecrementStock, which uses a
    // dotted path built at runtime: { [`stock.${size}`]: newStock }.
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        'stock.cup': 3,
        updatedAt: Timestamp.now(),
      })
    );
  });

  test('a customer may restock on cancel', async () => {
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        'stock.cup': 6,
        updatedAt: Timestamp.now(),
      })
    );
  });

  test('a customer may NOT raise stock arbitrarily beyond one call', async () => {
    // The documented limitation: rules scope the KEY, not the magnitude, and
    // cannot tie the write to an order. Asserted so the tradeoff stays visible
    // and is revisited if a Cloud Function ever replaces this path.
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        'stock.cup': 999999,
        updatedAt: Timestamp.now(),
      })
    );
  });

  test('a customer may NOT write negative stock', async () => {
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        'stock.cup': -1000,
        updatedAt: Timestamp.now(),
      })
    );
  });

  test('a customer may NOT change pricing', async () => {
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        'pricing.cup': 1,
        updatedAt: Timestamp.now(),
      })
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
      })
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
      })
    );
  });

  test('a signed-out visitor may not write', async () => {
    await assertFails(
      updateDoc(doc(env.unauthenticatedContext().firestore(), 'products/p1'), {
        'stock.cup': 0,
        updatedAt: Timestamp.now(),
      })
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
      })
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
      })
    );
  });

  test('a customer may NOT cancel somebody else\'s order', async () => {
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
      })
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
      })
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
      })
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
      })
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
      })
    );
  });

  test('a customer may create their own order', async () => {
    await assertSucceeds(addDoc(collection(asUser(CUSTOMER), 'orders'), orderFor(CUSTOMER, 'pending')));
  });

  test('a customer may NOT create an order for somebody else', async () => {
    await assertFails(addDoc(collection(asUser(CUSTOMER), 'orders'), orderFor(OTHER_CUSTOMER, 'pending')));
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
      })
    );
  });
});

describe('reads', () => {
  test('a customer can read a product and their own order', async () => {
    await seed('orders/o9', orderFor(CUSTOMER, 'pending'));
    await assertSucceeds(getDoc(doc(asUser(CUSTOMER), 'products/p1')));
    await assertSucceeds(getDoc(doc(asUser(CUSTOMER), 'orders/o9')));
  });

  test('a customer can NOT read another customer\'s order', async () => {
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
        orderBy('createdAt', 'desc')
      )
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
          orderBy('createdAt', 'desc')
        )
      )
    );
  });
});

describe('reviews', () => {
  // Review ids are deterministic (`${productId}_${uid}`), so these use
  // setDoc at a known path rather than addDoc with a random id.
  const reviewPath = (productId: string, uid: string) => `reviews/${productId}_${uid}`;

  test('an admin may set a valid category', async () => {
    await assertSucceeds(
      updateDoc(doc(asAdmin(), 'products/p1'), {
        category: 'sundae',
        updatedAt: Timestamp.now(),
      })
    );
  });

  test('a customer may NOT change a category', async () => {
    // Category decides which storefront filter a product appears under, so it is
    // a merchandising field: admin-only, like pricing and isActive.
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'products/p1'), {
        category: 'cone',
        updatedAt: Timestamp.now(),
      })
    );
  });

  test('an admin may NOT set a category outside the allowed set', async () => {
    await assertFails(
      updateDoc(doc(asAdmin(), 'products/p1'), {
        category: 'popsicle',
        updatedAt: Timestamp.now(),
      })
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
      })
    );
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
      })
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
      })
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
      })
    );
  });

  test('a user may NOT file a review under somebody else\'s id', async () => {
    await assertFails(
      setDoc(doc(asUser(CUSTOMER), reviewPath('p1', OTHER_CUSTOMER)), {
        productId: 'p1',
        userId: OTHER_CUSTOMER,
        rating: 5,
        comment: 'Great',
        createdAt: Timestamp.now(),
      })
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
      })
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
        { merge: true }
      )
    );
  });

  test('a user may NOT edit somebody else\'s review', async () => {
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
        { merge: true }
      )
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

  test('a user may NOT delete somebody else\'s review', async () => {
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
  test('a customer may set their own display name', async () => {
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { displayName: 'New Name' })
    );
  });

  test('a customer may set a phone number', async () => {
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { phone: '+639171234567' })
    );
  });

  test('a customer may set a profile photo', async () => {
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), {
        photoURL: 'https://res.cloudinary.com/fhtucp4v/image/upload/avatars/a.jpg',
      })
    );
  });

  test('a customer may store their notification preference', async () => {
    await assertSucceeds(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { notificationsEnabled: false })
    );
  });

  test('a customer may NOT promote themselves to admin', async () => {
    // The single most important assertion in this block. The rules pin
    // `role == resource.data.role` on the owner branch, so this must fail even
    // though the owner branch is otherwise unrestricted.
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { role: 'admin' })
    );
  });

  test('a customer may NOT change their own uid', async () => {
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { uid: OTHER_CUSTOMER })
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
      setDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { displayName: 'Only This' })
    );
  });

  test('a merged write keeps the document intact', async () => {
    await assertSucceeds(
      setDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`), { displayName: 'Merged' }, { merge: true })
    );
    const after = (await getDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`))).data()!;
    assert.equal(after.role, 'customer');
    assert.equal(after.displayName, 'Merged');
  });

  test('a customer may NOT write another user\'s document', async () => {
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), `users/${OTHER_CUSTOMER}`), { displayName: 'Hax' })
    );
  });

  test('a customer may NOT delete their own document', async () => {
    // `allow delete: if false` — for everyone, including admins. Plan for
    // deactivation via role, not deletion.
    await assertFails(deleteDoc(doc(asUser(CUSTOMER), `users/${CUSTOMER}`)));
  });

  test('a signed-out visitor may NOT read a user document', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `users/${CUSTOMER}`)));
  });

  test('a sparse document is still editable', async () => {
    // An admin bootstrapped by hand in the Firebase console — the ONLY documented
    // way to create the first admin — holds just { uid, role }. `allow create`
    // does not require email/displayName/createdAt, so that shape is
    // rules-valid, and the profile form has to tolerate a missing displayName.
    await seed('users/sparse', { uid: 'sparse', role: 'customer' });
    await assertSucceeds(
      updateDoc(doc(asUser('sparse'), 'users/sparse'), { displayName: 'Now Named' })
    );
  });
});

describe('users: admin listing', () => {
  test('an admin MAY run an unfiltered collection query', async () => {
    // This is the assertion the whole admin Users page rests on, and the reason
    // it needs NO rules change.
    //
    // Firestore authorises a list only if the `allow read` condition can be
    // proven for EVERY document the query could return — it cannot evaluate
    // rules per returned row, because that would leak which documents exist.
    // `isOwner(uid)` depends on the path parameter, so it is true for exactly
    // one document and cannot satisfy an unfiltered query. `isAdmin()` depends
    // only on `request.auth` plus a get() of the CALLER's own document — never
    // on the document being read — so it is provable for all of them, and the
    // query is allowed.
    //
    // The repo already asserts this same reasoning for the identically-shaped
    // orders rule in the `reads` block above.
    const snap = await getDocs(query(collection(asAdmin(), 'users'), orderBy('uid', 'asc')));
    assert.ok(snap.size >= 3, `expected the seeded users, got ${snap.size}`);
  });

  test('a customer may NOT run an unfiltered collection query', async () => {
    await assertFails(
      getDocs(query(collection(asUser(CUSTOMER), 'users'), orderBy('uid', 'asc')))
    );
  });

  test('an admin may edit another user', async () => {
    await assertSucceeds(
      updateDoc(doc(asAdmin(), `users/${OTHER_CUSTOMER}`), { displayName: 'Staff Edit' })
    );
  });

  test('an admin MAY change another user\'s role (the promotion path)', async () => {
    await assertSucceeds(
      updateDoc(doc(asAdmin(), `users/${OTHER_CUSTOMER}`), { role: 'admin' })
    );
    const after = (await getDoc(doc(asAdmin(), `users/${OTHER_CUSTOMER}`))).data()!;
    assert.equal(after.role, 'admin');
  });

  test('an admin may NOT create a user document', async () => {
    // `allow create` requires isOwner(uid), which is false for an admin writing
    // somebody else's document. There is no rules path to creating a user.
    await assertFails(
      setDoc(doc(asAdmin(), 'users/someone-new'), { uid: 'someone-new', role: 'customer' })
    );
  });

  test('an admin may NOT delete a user document', async () => {
    await assertFails(deleteDoc(doc(asAdmin(), `users/${OTHER_CUSTOMER}`)));
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
      query(collection(asUser(CUSTOMER), 'vouchers'), where('isActive', '==', true))
    );
    assert.equal(snap.size, 1);
    assert.equal(snap.docs[0].id, 'SCOOP10');
  });

  test('a signed-OUT visitor may NOT read vouchers', async () => {
    await seed('vouchers/SCOOP10', voucher('SCOOP10'));
    await assertFails(
      getDocs(collection(env.unauthenticatedContext().firestore(), 'vouchers'))
    );
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
      })
    );
  });

  test('a customer may NOT edit or delete a voucher', async () => {
    await seed('vouchers/SCOOP10', voucher('SCOOP10'));
    await assertFails(updateDoc(doc(asUser(CUSTOMER), 'vouchers/SCOOP10'), { value: 90 }));
    await assertFails(deleteDoc(doc(asUser(CUSTOMER), 'vouchers/SCOOP10')));
  });
});

describe('orders: cached geocode', () => {
  // The tracking map caches a geocoded destination on the order as
  // `geo: { lat, lng }` so an address is resolved once rather than on every page
  // open. The order create rule validates eleven specific fields and contains no
  // hasOnly/keys() check, so unknown fields are permitted — this pins that, since
  // the map feature depends on it.
  test('a customer may create an order carrying a geo field', async () => {
    await assertSucceeds(
      addDoc(collection(asUser(CUSTOMER), 'orders'), {
        ...orderFor(CUSTOMER, 'pending'),
        geo: { lat: 14.6188159, lng: 121.1029457, label: 'Cainta, Rizal' },
      })
    );
  });

  test('a customer may NOT add geo to an existing order while cancelling', async () => {
    // The cancel branch is confined with hasOnly(['status','cancelReason',
    // 'updatedAt','statusHistory']). Widening it would let a customer rewrite the
    // fulfilment timeline, so geo must stay out of it.
    await seed('orders/o1', orderFor(CUSTOMER, 'pending'));
    await assertFails(
      updateDoc(doc(asUser(CUSTOMER), 'orders/o1'), { geo: { lat: 0, lng: 0 } })
    );
  });

  test('an admin may write a geo field onto an order', async () => {
    await seed('orders/o2', orderFor(CUSTOMER, 'pending'));
    await assertSucceeds(
      updateDoc(doc(asAdmin(), 'orders/o2'), {
        geo: { lat: 14.6188159, lng: 121.1029457, label: 'Cainta, Rizal' },
      })
    );
  });
});
