// tests/order-stock.integration.test.ts
// Stock movement, end to end, against the Firestore emulator.
//
// WHY THIS FILE EXISTS
// `firestore.rules.test.ts` proves the RULES permit or refuse each write.
// `logic.test.ts` proves the pure helpers. Neither one ever executed
// `OrderService.transitionOrderStatus`, which is ~200 lines that touch three
// collections inside a single transaction:
//
//   reads every product, re-reads inside the tx, validates with
//   normaliseStockLines, decrements stock, writes one `stockMovements` row per
//   line, and writes the ORDER DOCUMENT LAST.
//
// So the code that actually moves stock had no coverage at all. A rules test can
// pass 143/143 while the client half is wrong — for example if the order were
// written before the stock, a reader would briefly see `preparing` for stock that
// had not been taken. This file drives the real service, not a reimplementation.
//
// It also pins the behaviours that are easy to get wrong and invisible in review:
//   - a shortfall ABORTS and leaves every line untouched (no partial take)
//   - cancelling a `pending` order moves NO stock (none was ever taken)
//   - cancelling a `confirmed` order RETURNS stock and writes the ledger row
//   - the ledger records the ACTING STAFF uid, not the customer's
//   - the order document is written last, so it can never claim a take that failed
//
// Run with the emulator:  npm run test:integration

// MUST BE FIRST, both of these.
//
// `zone.js` defines the global `Zone`. AngularFire's `ɵZoneScheduler` calls
// `Zone.current.scheduleMacroTask(...)` when wrapping a Firestore callback, so
// without it every read and write throws "Zone is not defined".
//
// `@angular/compiler` is needed because `@angular/fire` ships partially compiled
// and falls back to JIT.
//
// ES module imports evaluate in source order, so these have to precede every
// `@angular/*` import below or the modules throw while loading.
import 'zone.js';
import '@angular/compiler';

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
import { Injector, runInInjectionContext } from '@angular/core';

import { Firestore as AngularFirestore } from '@angular/fire/firestore';

/**
 * AngularFire keeps its zone scheduler on `globalThis`, NOT in Angular's DI —
 * `getSchedulers()` reads `globalThis.ɵAngularFireScheduler` and throws
 * "Either AngularFireModule has not been provided in your AppModule…" if it is
 * absent. `runTransaction` wraps its callback in `runOutsideAngular`, which goes
 * through it, so a stock transition cannot run at all without this.
 *
 * The real implementation is built from NgZone and Zone.js, neither of which
 * exists under `node:test`. Every hook here is a pass-through, which is honest:
 * the transaction still executes, it simply is not running inside a zone.
 */
(globalThis as Record<string, unknown>)['ɵAngularFireScheduler'] = {
  ngZone: {
    runOutsideAngular: <T>(fn: () => T) => fn(),
    run: <T>(fn: () => T) => fn(),
  },
  outsideAngular: { schedule: <T>(fn: () => T) => fn() },
  insideAngular: { schedule: <T>(fn: () => T) => fn() },
};
import { OrderService } from '../src/app/core/services/order.service';
import { AuthService } from '../src/app/core/services/auth.service';
import { CartService } from '../src/app/core/services/cart.service';
import { InventoryService } from '../src/app/core/services/inventory.service';
import { VoucherService } from '../src/app/core/services/voucher.service';

let env: RulesTestEnvironment;

const MANAGER = 'manager-uid';
const STAFF = 'staff-uid';
const CUSTOMER = 'customer-uid';

const PRODUCT: Record<string, unknown> = {
  setNumber: 1,
  setName: 'Chocolates',
  variantName: 'Rocky Road',
  description: 'A classic.',
  imageUrl: '',
  pricing: { cup: 65, pint: 200, halfGallon: 500, gallon: 950 },
  stock: { cup: 10, pint: 10, halfGallon: 10, gallon: 10 },
  isActive: true,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
};

/** An order for `lines`, in `status`, for the customer. */
function orderFor(
  status: string,
  lines: Array<{ productId: string; size: string; quantity: number }>,
) {
  return {
    customerId: CUSTOMER,
    customerEmail: 'c@example.com',
    items: lines.map((l, i) => ({
      productId: l.productId,
      variantName: `Flavor ${i + 1}`,
      setName: 'Chocolates',
      size: l.size,
      quantity: l.quantity,
      unitPrice: 65,
      subtotal: 65 * l.quantity,
    })),
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
    statusHistory: [{ status, timestamp: Timestamp.now() }],
  };
}

async function seed(path: string, data: unknown): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data as Record<string, unknown>);
  });
}

const asUser = (uid: string) => env.authenticatedContext(uid).firestore();

/** The size key on a product document, read with rules disabled. */
async function stockOf(productId: string, size: string): Promise<unknown> {
  let out: unknown;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), `products/${productId}`));
    out = snap.data()?.stock?.[size];
  });
  return out;
}

async function ledgerRows(): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDocs(collection(ctx.firestore(), 'stockMovements'));
    rows.push(...snap.docs.map((d) => d.data() as Record<string, unknown>));
  });
  return rows;
}

/**
 * Build the REAL `OrderService` around a real emulator Firestore, acting as
 * `uid`. Only `Firestore` and `AuthService` are genuine inputs to
 * `transitionOrderStatus`; the other three injected services are never touched
 * on this path and are stubbed so the constructor's `inject()` calls resolve.
 */
function serviceAs(uid: string): OrderService {
  const firestore = asUser(uid);
  const authStub = { currentUserSnapshot: uid === null ? null : { uid } };

  const injector = Injector.create({
    providers: [
      { provide: AngularFirestore, useValue: firestore },
      { provide: AuthService, useValue: authStub },
      { provide: CartService, useValue: {} },
      { provide: InventoryService, useValue: {} },
      { provide: VoucherService, useValue: {} },
    ],
  });

  return runInInjectionContext(injector, () => new OrderService());
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'five-orites-scoop-stock-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `users/${MANAGER}`), { uid: MANAGER, role: 'manager' });
    await setDoc(doc(db, `users/${STAFF}`), { uid: STAFF, role: 'staff' });
    await setDoc(doc(db, `users/${CUSTOMER}`), { uid: CUSTOMER, role: 'customer' });
  });
});

describe('a manager advances an order: stock is taken', () => {
  test('stock drops by the ordered quantity and a sale row is written', async () => {
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 3 }]));

    await serviceAs(MANAGER).updateOrderStatus('o1', 'confirmed');

    assert.equal(await stockOf('p1', 'cup'), 7, 'stock should fall from 10 to 7');

    const rows = await ledgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reason, 'sale');
    assert.equal(rows[0].delta, -3);
    assert.equal(rows[0].balanceAfter, 7);
    assert.equal(rows[0].orderId, 'o1');
    assert.equal(rows[0].size, 'cup');
  });

  test('the ledger records the ACTING STAFF uid, not the customer', async () => {
    // `actorUid` means "who caused this". Writing the customer there would make
    // the field a duplicate of `orderId`'s customer link and destroy the only
    // distinct thing it can say.
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 1 }]));

    await serviceAs(MANAGER).updateOrderStatus('o1', 'confirmed');

    const rows = await ledgerRows();
    assert.equal(rows[0].actorUid, MANAGER);
    assert.notEqual(rows[0].actorUid, CUSTOMER);
  });

  test('only the ordered SIZE moves', async () => {
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'pint', quantity: 2 }]));

    await serviceAs(MANAGER).updateOrderStatus('o1', 'confirmed');

    assert.equal(await stockOf('p1', 'pint'), 8);
    assert.equal(await stockOf('p1', 'cup'), 10, 'cup was not on the order');
    assert.equal(await stockOf('p1', 'gallon'), 10);
  });

  test('every line across several products is taken', async () => {
    await seed('products/p1', PRODUCT);
    await seed('products/p2', { ...PRODUCT, variantName: 'Mint' });
    await seed(
      'orders/o1',
      orderFor('pending', [
        { productId: 'p1', size: 'cup', quantity: 2 },
        { productId: 'p2', size: 'gallon', quantity: 1 },
      ]),
    );

    await serviceAs(MANAGER).updateOrderStatus('o1', 'confirmed');

    assert.equal(await stockOf('p1', 'cup'), 8);
    assert.equal(await stockOf('p2', 'gallon'), 9);
    assert.equal((await ledgerRows()).length, 2);
  });

  test('duplicate lines for one size are summed, not double-charged', async () => {
    // normaliseStockLines merges them, and the transaction writes each document
    // once. Without the merge, two lines of 2 would charge 4 while applying one
    // decrement of 2.
    await seed('products/p1', PRODUCT);
    await seed(
      'orders/o1',
      orderFor('pending', [
        { productId: 'p1', size: 'cup', quantity: 2 },
        { productId: 'p1', size: 'cup', quantity: 2 },
      ]),
    );

    await serviceAs(MANAGER).updateOrderStatus('o1', 'confirmed');

    assert.equal(await stockOf('p1', 'cup'), 6);
    assert.equal((await ledgerRows()).length, 1, 'one document, one ledger row');
  });

  test('the order document records the new status and appends to the timeline', async () => {
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 1 }]));

    await serviceAs(MANAGER).updateOrderStatus('o1', 'confirmed');

    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'orders/o1'));
      assert.equal(snap.data()?.status, 'confirmed');
      const history = snap.data()?.statusHistory as Array<{ status: string }>;
      assert.equal(history.length, 2, 'the append-only rule requires exactly one more entry');
      assert.equal(history[1].status, 'confirmed');
    });
  });

  test('the take fires on a jump straight to preparing, not only to confirmed', async () => {
    // The admin status picker and bulk advance can skip `confirmed`. Gating the
    // take on the single common transition would leave a permanent silent hole
    // in exactly the two controls meant to be shortcuts.
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 1 }]));

    await serviceAs(MANAGER).updateOrderStatus('o1', 'preparing');

    assert.equal(await stockOf('p1', 'cup'), 9);
  });

  test('a second advance does not take the stock again', async () => {
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 3 }]));

    const svc = serviceAs(MANAGER);
    await svc.updateOrderStatus('o1', 'confirmed');
    await svc.updateOrderStatus('o1', 'preparing');

    assert.equal(await stockOf('p1', 'cup'), 7, 'still 10 - 3, taken once');
    assert.equal((await ledgerRows()).length, 1);
  });

  test('a transition that moves no stock writes NO ledger row at all', async () => {
    // REGRESSION. `next` is `shouldTake ? current - quantity : current +
    // quantity`, and the `reads.push` that applies it used to run
    // UNCONDITIONALLY for every line. So a transition that was neither a take nor
    // a restore did not merely leave stock alone — it ADDED the ordered quantity
    // back and wrote a `cancel_restock` row claiming a return that never
    // happened. `confirmed -> preparing` did exactly this, which is one click in
    // the fulfilment queue.
    //
    // 165 logic tests and 143 rules tests all passed while this was live: the
    // rules tests never drove this code, and the logic tests only covered
    // `normaliseStockLines`, which is correct on its own.
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 3 }]));

    const svc = serviceAs(MANAGER);
    await svc.updateOrderStatus('o1', 'confirmed');
    await svc.updateOrderStatus('o1', 'preparing');
    await svc.updateOrderStatus('o1', 'out_for_delivery');

    assert.equal(await stockOf('p1', 'cup'), 7, 'the shelf must not creep upward on each advance');
    const rows = await ledgerRows();
    assert.equal(rows.length, 1, 'only the take belongs in the ledger');
    assert.equal(rows[0].reason, 'sale');
  });

  test('a pending order advanced straight to delivered takes the stock', async () => {
    // `delivered` is NOT in STOCK_HELD_STATUSES, so `willHold` is false and the
    // take does not fire on `pending -> delivered`. That is a real hole: an order
    // skipped straight past preparing would sell stock that was never taken.
    // Pinned so the status set and the take condition cannot drift apart again.
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 2 }]));

    await serviceAs(MANAGER).updateOrderStatus('o1', 'delivered');

    assert.equal(
      await stockOf('p1', 'cup'),
      10,
      'stock was taken, so delivered must not exempt it',
    );
  });
});

describe('a shortfall aborts the whole take', () => {
  test('the order does not move and NO line is decremented', async () => {
    // The failure this guards is subtle and expensive: p1 has enough and p2 does
    // not, so a service that validated-then-wrote would shrink p1 and leave the
    // order sitting at `pending` looking untouched. The shelf would be short by
    // one flavour with no record of why.
    await seed('products/p1', PRODUCT);
    await seed('products/p2', {
      ...PRODUCT,
      variantName: 'Scarce',
      stock: { cup: 1, pint: 10, halfGallon: 10, gallon: 10 },
    });
    await seed(
      'orders/o1',
      orderFor('pending', [
        { productId: 'p1', size: 'cup', quantity: 2 },
        { productId: 'p2', size: 'cup', quantity: 5 },
      ]),
    );

    await assert.rejects(() => serviceAs(MANAGER).updateOrderStatus('o1', 'confirmed'));

    assert.equal(await stockOf('p1', 'cup'), 10, 'the satisfiable line must be given back');
    assert.equal(await stockOf('p2', 'cup'), 1);

    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'orders/o1'));
      assert.equal(snap.data()?.status, 'pending', 'the order must not have moved');
      assert.equal((snap.data()?.statusHistory as unknown[]).length, 1);
    });
    assert.equal((await ledgerRows()).length, 0, 'no ledger row for a take that never happened');
  });

  test('the message says nothing was taken, so staff know what to do next', async () => {
    await seed('products/p1', {
      ...PRODUCT,
      stock: { cup: 1, pint: 10, halfGallon: 10, gallon: 10 },
    });
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 4 }]));

    await assert.rejects(
      () => serviceAs(MANAGER).updateOrderStatus('o1', 'confirmed'),
      (err: Error) => {
        assert.match(err.message, /Nothing was taken/);
        assert.match(err.message, /has not moved/);
        return true;
      },
    );
  });
});

describe('cancellation', () => {
  test('cancelling a PENDING order moves no stock, because none was taken', async () => {
    // This is what makes the customer cancel path safe: rules pin a customer to
    // cancelling while `pending`, before any take, so a customer never owes a
    // restock and never needs to write a product.
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 3 }]));

    await serviceAs(MANAGER).cancelOrder('o1', 'Changed my mind');

    assert.equal(await stockOf('p1', 'cup'), 10, 'nothing was ever taken');
    assert.equal((await ledgerRows()).length, 0);
  });

  test('cancelling a CONFIRMED order returns the stock and writes a restock row', async () => {
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 3 }]));

    const svc = serviceAs(MANAGER);
    await svc.updateOrderStatus('o1', 'confirmed');
    assert.equal(await stockOf('p1', 'cup'), 7);

    await svc.cancelOrder('o1', 'Customer changed their mind');

    assert.equal(await stockOf('p1', 'cup'), 10, 'the shelf is whole again');
    const rows = await ledgerRows();
    assert.equal(rows.length, 2);
    // Selected BY REASON, not by position: `stockMovements` rows get auto-ids,
    // so a `getDocs` returns them in an order that has nothing to do with which
    // write happened first. An earlier version of this test indexed by position
    // and failed for exactly that reason.
    const restock = rows.find((r) => r.reason === 'cancel_restock');
    assert.ok(restock, 'a cancel_restock row must exist');
    assert.equal(restock.delta, 3);
    assert.equal(restock.balanceAfter, 10);
    assert.equal(restock.orderId, 'o1');
  });

  test('a completed restock is recorded as such', async () => {
    // `stockRestored: false` hides this order from the repair queue, so a
    // partial return must NOT claim success.
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 2 }]));

    const svc = serviceAs(MANAGER);
    await svc.updateOrderStatus('o1', 'confirmed');
    await svc.cancelOrder('o1', 'Changed my mind');

    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'orders/o1'));
      assert.equal(snap.data()?.stockRestored, true);
      assert.ok(snap.data()?.stockRestoredAt);
    });
  });

  test('a restock that could not complete is recorded as NOT done', async () => {
    // The flavour was deleted after the order was confirmed, so there is no
    // shelf to return to. Refusing the whole cancellation would be worse — the
    // order is already cancelled — but claiming success would hide the hole from
    // the repair queue permanently.
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 1 }]));

    const svc = serviceAs(MANAGER);
    await svc.updateOrderStatus('o1', 'confirmed');

    // Now delete the product out from under the order.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'products/p1'));
    });

    await svc.cancelOrder('o1', 'Flavour withdrawn');

    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'orders/o1'));
      assert.equal(
        snap.data()?.status,
        'cancelled',
        'the cancellation itself must still go through',
      );
      assert.equal(snap.data()?.stockRestored, false, 'a partial return must not claim success');
    });
  });

  test('a customer can cancel their own pending order without writing a product', async () => {
    // The customer branch of the orders rule permits exactly these four fields.
    // If this ever needed a product write it would be PERMISSION_DENIED for a
    // customer — which is precisely the design.
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 1 }]));

    await serviceAs(CUSTOMER).cancelOrder('o1', 'Wrong item');

    assert.equal(await stockOf('p1', 'cup'), 10);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'orders/o1'));
      assert.equal(snap.data()?.status, 'cancelled');
      assert.equal(snap.data()?.cancelReason, 'Wrong item');
    });
  });

  test('REGRESSION: a pending cancel must not restock, for ANY role', async () => {
    // `shouldRestore` was derived from STOCK_HELD_STATUSES, which contains
    // `pending` — but the take fires on EXIT from pending, so a pending order
    // holds nothing. A manager cancelling one INVENTED inventory, and a customer
    // cancelling their own was PERMISSION_DENIED outright, because the
    // transaction reached for a product document: the exact thing the customer
    // rules branch exists to prevent, triggered by the customer's own
    // legitimate action.
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 3 }]));

    await serviceAs(MANAGER).cancelOrder('o1', 'Not needed');

    assert.equal(await stockOf('p1', 'cup'), 10, 'nothing was ever taken, so nothing comes back');
    assert.equal((await ledgerRows()).length, 0, 'and no ledger row may claim otherwise');
  });
});

describe('who is allowed to move stock', () => {
  test('a staff shift lead is refused, with an explanation rather than a raw error', async () => {
    // The product write inside the transaction is gated on `canRunShop()`
    // (manager+). A shift lead works the queue but cannot touch the shelf.
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 1 }]));

    await assert.rejects(
      () => serviceAs(STAFF).updateOrderStatus('o1', 'confirmed'),
      (err: Error) => {
        assert.match(err.message, /manager/i);
        assert.match(err.message, /Nothing was changed/);
        return true;
      },
    );
    assert.equal(await stockOf('p1', 'cup'), 10);
  });

  test('a customer cannot advance their own order', async () => {
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('pending', [{ productId: 'p1', size: 'cup', quantity: 1 }]));

    await assert.rejects(() => serviceAs(CUSTOMER).updateOrderStatus('o1', 'confirmed'));
    assert.equal(await stockOf('p1', 'cup'), 10);
  });
});

describe('terminal states', () => {
  test('a delivered order cannot be changed at all', async () => {
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('delivered', [{ productId: 'p1', size: 'cup', quantity: 1 }]));

    await assert.rejects(
      () => serviceAs(MANAGER).updateOrderStatus('o1', 'preparing'),
      /Delivered orders cannot be changed/,
    );
    assert.equal(await stockOf('p1', 'cup'), 10);
  });

  test('a cancelled order cannot be reopened, and takes no fresh stock', async () => {
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('cancelled', [{ productId: 'p1', size: 'cup', quantity: 1 }]));

    await assert.rejects(() => serviceAs(MANAGER).updateOrderStatus('o1', 'confirmed'));
    assert.equal(await stockOf('p1', 'cup'), 10);
  });

  test('re-cancelling is a no-op, not an error', async () => {
    // Both call sites toast success unconditionally, so an error here would read
    // as a failure for an action that already happened.
    await seed('products/p1', PRODUCT);
    await seed('orders/o1', orderFor('cancelled', [{ productId: 'p1', size: 'cup', quantity: 1 }]));

    await serviceAs(MANAGER).cancelOrder('o1', 'Again');
    assert.equal(await stockOf('p1', 'cup'), 10);
    assert.equal((await ledgerRows()).length, 0, 'a no-op must not restock');
  });
});
