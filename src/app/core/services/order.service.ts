// src/app/core/services/order.service.ts
// Five-orites Scoop — Order Service (Fixed)

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  collection,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  getCountFromServer,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  addDoc,
  updateDoc,
  runTransaction,
} from '@angular/fire/firestore';
import type {
  QueryConstraint,
  QueryDocumentSnapshot,
  DocumentReference,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { getDeliveryFee } from '../models/cart.model';
import { normaliseStockLines } from '../logic/stock';
import { isPermissionDeniedError } from '../logic/firestore-error';
import type { Product, SizeVariant } from '../models/product.model';

/**
 * One page of reporting results.
 *
 * `cursor` is deliberately `unknown`: it is the Firestore `QueryDocumentSnapshot`
 * the page ended on, passed back verbatim so the implicit `__name__` tiebreaker is
 * preserved. Reconstructing a `{createdAt, id}` object instead loses that
 * tiebreaker, and orders sharing a createdAt millisecond can then be skipped or
 * repeated across a page boundary. See `getOrdersPage`.
 */
export interface OrdersPage {
  orders: Order[];
  hasMore: boolean;
  /** True total from a server-side count, not the length of this page. */
  total: number;
  cursor: unknown;
}

import { Order, OrderItem, OrderStatus } from '../models/order.model';
import { AuthService } from './auth.service';
import { CartService } from './cart.service';
import { InventoryService } from './inventory.service';
import { VoucherService } from './voucher.service';

/**
 * Statuses at which the shop is still physically holding the order's stock.
 *
 * WHY THIS LIST IS HERE AND NOT IN A FUNCTION. `functions/src/index.ts` declares
 * `PRE_DISPATCH_STATUSES` for the same purpose, but this project is on Firebase's
 * free Spark plan and Cloud Functions CANNOT BE DEPLOYED, so that copy can never
 * run. This is now the single real copy.
 *
 * The earlier arrangement — a client list mirrored in the function, with a
 * comment asking the two to be kept in step — was deleted deliberately, because
 * two lists that must match where only one is real is exactly the arrangement
 * that drifts silently. Deleting the unreachable copy is what makes that true
 * again.
 *
 * `out_for_delivery` and `delivered` are excluded on purpose: the ice cream has
 * left the building, so returning its stock would invent inventory the shop can
 * then sell a second time.
 */
const STOCK_HELD_STATUSES: readonly OrderStatus[] = ['pending', 'confirmed', 'preparing'];

/**
 * The shelf is short. Distinct from every other failure on purpose.
 *
 * A real Firestore error — network, permissions, contention — must NEVER be
 * reported to the shop as "not enough ice cream". Doing so would cancel an order
 * the customer could legitimately have had, which is the worst of both outcomes:
 * they lose the sale AND the stock stays on the shelf.
 */
class InsufficientStockError extends Error {}

/** The order was cancelled or delivered between the caller's read and this write. */
class OrderNoLongerOpenError extends Error {}

@Injectable({ providedIn: 'root' })
export class OrderService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);
  private cartService = inject(CartService);
  private inventoryService = inject(InventoryService);
  private voucherService = inject(VoucherService);

  /**
   * Places an order for the signed-in user's cart.
   *
   * `voucherCode` is a CODE, never a discount amount — the discount is resolved
   * here from Firestore so a tampered client cannot dictate the price.
   */
  async placeOrder(
    deliveryAddress: string,
    notes?: string,
    voucherCode?: string | null,
  ): Promise<string> {
    const user = this.authService.currentUserSnapshot;
    if (!user) throw new Error('User must be signed in to place an order.');

    const cart = this.cartService.currentCart;
    if (cart.items.length === 0) throw new Error('Cart is empty.');
    if (!deliveryAddress.trim()) throw new Error('Delivery address is required.');

    // ── Stock is no longer written here ─────────────────────────────────────────
    //
    // This used to call `InventoryService.validateAndDecrementStock` BEFORE the
    // order was written, and compensate in the catch. Both halves are gone:
    // stock is now reserved server-side by the `reconcileOrderStock` Cloud
    // Function (functions/src/index.ts), which decrements in a transaction and
    // cancels the order itself if the shelf is short. Leaving the client write in
    // place would decrement twice for every sale — inventory drifting the exact
    // opposite way from the corruption the function exists to stop.
    //
    // The client-side price pass below is still worth doing: it gives the customer
    // an honest quote at checkout instead of a number that changes a second later.
    // It is a DISPLAY value only. The function recomputes every line from
    // `products/{id}.pricing` and overwrites the totals, so nothing here is trusted
    // as money.

    try {
      // Step 1: Re-price from Firestore (never trust localStorage prices).
      const authoritativeItems: OrderItem[] = [];
      for (const item of cart.items) {
        const snap = await getDoc(doc(this.firestore, `products/${item.productId}`));
        if (!snap.exists()) throw new Error(`Product ${item.variantName} no longer exists.`);
        const data = snap.data() as {
          pricing?: Record<string, number>;
          setName?: string;
          variantName?: string;
          setNumber?: number;
        };
        // NO FALLBACK to PRICING_MATRIX here.
        //
        // This used to read `getPricingForSet(setNumber)?.[size]` when
        // `pricing[size]` was missing, and the comment two lines down claimed the
        // whole pass was "a DISPLAY value only". It was not: the number went into
        // the order document, and the customer was quoted it.
        //
        // `reconcileOrderStock` has no such fallback — it cancels the order with
        // `no_price`. So the two layers disagreed in exactly the case the comment
        // called impossible: the cart showed a price from the build-time matrix,
        // checkout accepted it, and a second later the order was cancelled. The
        // fail-closed behaviour is the function's, so the client now matches it.
        //
        // PRICING_MATRIX stays as a DISPLAY default for the admin's add-product
        // form. It is never a source of truth for a price actually charged.
        const unitPrice = data.pricing?.[item.size];
        if (unitPrice == null) {
          throw new Error(
            `${data.variantName ?? item.variantName} has no price set for this size.`,
          );
        }
        authoritativeItems.push({
          productId: item.productId,
          // Names come from Firestore as well: the admin may have renamed a
          // flavor, and receipts plus analytics group by these strings.
          variantName: data.variantName ?? item.variantName,
          setName: data.setName ?? item.setName,
          size: item.size,
          quantity: item.quantity,
          unitPrice,
          subtotal: unitPrice * item.quantity,
        });
      }
      const totalAmount = authoritativeItems.reduce((s, i) => s + i.subtotal, 0);
      const deliveryFee = getDeliveryFee(totalAmount);

      // Resolve the discount from the voucher CODE. Never accept an amount
      // from the caller — that would let a tampered client dictate the price.
      const normalizedCode = voucherCode?.trim().toUpperCase() || null;
      let appliedCode: string | null = null;
      let discountAmount = 0;
      if (normalizedCode) {
        const { voucher, discount } = await this.voucherService.validateVoucher(
          normalizedCode,
          totalAmount,
        );
        appliedCode = voucher.code;
        discountAmount = Math.min(Math.max(discount, 0), totalAmount);
      }
      const grandTotal = totalAmount - discountAmount + deliveryFee;

      // ── FIX: never pass undefined to Firestore ──────────────
      // notes undefined → use null instead
      const safeNotes = notes && notes.trim().length > 0 ? notes.trim() : null;

      const orderData = {
        customerId: user.uid,
        customerEmail: user.email,
        items: authoritativeItems,
        totalAmount,
        deliveryFee,
        discountAmount,
        voucherCode: appliedCode,
        grandTotal,
        status: 'pending',
        paymentStatus: 'pending',
        deliveryAddress: deliveryAddress.trim(),
        notes: safeNotes, // ← null instead of undefined
        cancelReason: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        // NOTE: serverTimestamp() is banned inside arrays by Firestore,
        // so history entries use client Timestamp.now().
        statusHistory: [{ status: 'pending', timestamp: Timestamp.now() }],
      };

      // Step 3: Create order document
      const ordersCol = collection(this.firestore, 'orders');
      const orderRef = await addDoc(ordersCol, orderData);

      // Step 5: Clear cart ONCE after successful order
      //
      // There is deliberately NO redemption counter here. It used to call
      // `voucherService.recordRedemption(voucherId)` immediately after `addDoc`,
      // which could never succeed: `firestore.rules` is `allow write: if
      // isAdmin()` on `vouchers/`, the customer is not an admin, and there is no
      // impersonation mechanism anywhere in the codebase. Every attempt threw
      // PERMISSION_DENIED into the `console.error` two lines below, so
      // `usageCount` never moved and `maxRedemptions` could never trip — a promo
      // code was redeemable without limit, forever.
      //
      // The counter is now incremented by the `reconcileOrderStock` Cloud Function
      // inside the same transaction that decrements the stock, so the cap is
      // checked and spent atomically and a cancelled order never burns a use.
      // See functions/src/index.ts and CUTOVER.md.
      this.cartService.clearCart();

      return orderRef.id;
    } catch (err) {
      // No compensation needed: nothing was written outside this function, and
      // the order document was either created (and the function will reserve its
      // stock, or cancel it) or never was.
      console.error('Order placement error:', err);
      throw err;
    }
  }

  getCustomerOrders(uid: string, maxResults = 50): Observable<Order[]> {
    return new Observable<Order[]>((observer) => {
      const ordersCol = collection(this.firestore, 'orders');
      const q = query(
        ordersCol,
        where('customerId', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(maxResults),
      );
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const orders = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Order[];
          observer.next(orders);
        },
        (error) => {
          console.error('Customer orders snapshot error:', error);
          observer.error(error);
        },
      );
      return () => unsubscribe();
    });
  }

  trackOrder(orderId: string): Observable<Order> {
    return new Observable<Order>((observer) => {
      const orderRef = doc(this.firestore, `orders/${orderId}`);
      const unsubscribe = onSnapshot(
        orderRef,
        (docSnap) => {
          if (docSnap.exists()) {
            observer.next({ id: docSnap.id, ...docSnap.data() } as Order);
          } else {
            observer.error(new Error(`Order ${orderId} not found.`));
          }
        },
        (error) => {
          console.error('Order tracker snapshot error:', error);
          observer.error(error);
        },
      );
      return () => unsubscribe();
    });
  }

  getAllOrders(statusFilter?: OrderStatus, maxResults = 100): Observable<Order[]> {
    return new Observable<Order[]>((observer) => {
      const ordersCol = collection(this.firestore, 'orders');
      const q = statusFilter
        ? query(
            ordersCol,
            where('status', '==', statusFilter),
            orderBy('createdAt', 'desc'),
            limit(maxResults),
          )
        : query(ordersCol, orderBy('createdAt', 'desc'), limit(maxResults));

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const orders = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Order[];
          observer.next(orders);
        },
        (error) => {
          // Logged for parity with trackOrder/getCustomerOrders. Without it a
          // permissions denial or a missing composite index is invisible in the
          // console even though the admin page now shows an error state.
          console.error('Failed to load orders.', error);
          observer.error(error);
        },
      );
      return () => unsubscribe();
    });
  }

  /**
   * Orders created at or after `since`, newest first, for reporting over a date
   * range.
   *
   * Analytics used to read the newest 100 orders and then filter by date in the
   * browser, so "last 30 days" silently ignored anything past order 100 and
   * "all time" quietly meant "the newest 100". Filtering at the server keeps
   * the window honest.
   *
   * `where('createdAt', '>=', since)` combined with `orderBy('createdAt')` is
   * served by the single-field index on createdAt, so this needs no composite
   * index. `snapshot.size` is compared against the limit by the caller to
   * report truncation rather than hide it.
   */
  getOrdersSince(since: Date, maxResults = 500): Observable<Order[]> {
    return new Observable<Order[]>((observer) => {
      const ordersCol = collection(this.firestore, 'orders');
      const q = query(
        ordersCol,
        where('createdAt', '>=', Timestamp.fromDate(since)),
        orderBy('createdAt', 'desc'),
        limit(maxResults),
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const orders = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Order[];
          observer.next(orders);
        },
        (error) => {
          console.error('Failed to load orders for the selected range.', error);
          observer.error(error);
        },
      );
      return () => unsubscribe();
    });
  }

  /**
   * One page of orders for reporting, plus whether more exist.
   *
   * THE CAP THIS REPLACES
   * `getAllOrders(undefined, 500)` returned an array that stopped at 500, and the
   * analytics page derived revenue, order counts and the flavor ranking from it. So
   * once a shop passed 500 orders, every figure on that page silently described the
   * NEWEST 500 orders while the header said "All Time". Revenue under-reported and
   * nothing on screen said so.
   *
   * A larger limit would not fix that — it moves the cliff, it does not remove it,
   * and it costs more Firestore reads to hide it. So this pages properly.
   *
   * WHY A COUNT IS INCLUDED
   * `hasMore` is derived from the page coming back full, which is one query. But the
   * caller also needs to know the TRUE total to page through and to say "page 2 of
   * 9" — and `getCountFromServer` is a single aggregate read regardless of how many
   * orders exist, where counting by fetching would be O(n).
   *
   * `total` comes from the server rather than being inferred, so a shop with 12
   * orders is not told it has 12 pages, and one with 5,000 is not told 500.
   *
   * NOT LIVE. This is a `getDocs` read, not `onSnapshot`, unlike the rest of this
   * service. Paging a live query while the underlying set mutates means a document
   * can be skipped or repeated across page boundaries — the cursor points at a
   * position, and inserting above it shifts everything. Reporting wants a consistent
   * snapshot; the page re-reads on refresh and on range change.
   */
  async getOrdersPage(options: {
    status?: OrderStatus;
    since?: Date;
    pageSize?: number;
    cursor?: unknown;
    /**
     * The total from the first page of this walk, so later pages need not re-run
     * the count query. See the note on `total` below.
     */
    knownTotal?: number;
  }): Promise<OrdersPage> {
    const pageSize = Math.max(1, Math.min(options.pageSize ?? 50, 200));
    const ordersCol = collection(this.firestore, 'orders');

    const filters: QueryConstraint[] = [];
    if (options.status) filters.push(where('status', '==', options.status));
    if (options.since) filters.push(where('createdAt', '>=', Timestamp.fromDate(options.since)));

    const q = query(
      ordersCol,
      ...filters,
      orderBy('createdAt', 'desc'),
      ...(options.cursor ? [startAfter(options.cursor as QueryDocumentSnapshot)] : []),
      limit(pageSize),
    );

    const snapshot = await getDocs(q);
    const orders = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Order[];

    // A short page is the last page: Firestore returns fewer than `limit` only when
    // the result set is exhausted, so this is exact rather than a guess.
    const hasMore = orders.length === pageSize;
    const cursor = hasMore ? snapshot.docs[snapshot.docs.length - 1] : null;

    // `total` is resolved ONLY on the first page.
    //
    // The count query takes neither the cursor nor the limit, so it is invariant
    // across every page of a walk — a client paging through 25 pages was issuing 25
    // identical count queries to learn the same number 25 times. It is also the
    // only part of this method that is not free, and the analytics page walks to a
    // 5,000-order ceiling against Firebase's 50,000 reads/day free quota.
    //
    // Once the caller has the first page's total it has the only total there is.
    // Later pages reuse it, which is also the semantically honest answer: a count
    // taken from the middle of a walk can silently disagree with the pages either
    // side of it if an order arrives mid-walk.
    const total = options.cursor
      ? (options.knownTotal ?? orders.length)
      : (await getCountFromServer(query(ordersCol, ...filters))).data().count;

    return { orders, hasMore, total, cursor };
  }

  async updateOrderStatus(orderId: string, newStatus: OrderStatus): Promise<void> {
    await this.transitionOrderStatus(orderId, newStatus);
  }

  async cancelOrder(orderId: string, reason?: string): Promise<void> {
    // Truncated because the rules cap `cancelReason` at 300 characters, and a
    // longer string is a PERMISSION_DENIED on the ENTIRE cancellation — the
    // order would stay open with no explanation shown.
    const safeReason = reason && reason.trim().length > 0 ? reason.trim().slice(0, 300) : null;
    await this.transitionOrderStatus(orderId, 'cancelled', { cancelReason: safeReason });
  }

  /**
   * THE ONE place an order's status changes, and the one place stock moves.
   *
   * Everything else in the app — the fulfilment queue's advance button, its
   * free-form status picker, its bulk advance, the dispatch map, the customer's
   * own cancel — funnels through here. That is deliberate: it is why a stock take
   * cannot be bypassed by using a different control, and why a fifth call site
   * added later inherits the correct behaviour for free.
   *
   * WHY STAFF AND NOT THE CUSTOMER. This project is on Firebase's free plan, so
   * there is no server to reserve stock and `reconcileOrderStock` can never be
   * deployed. The alternative was letting the customer decrement at checkout,
   * which requires a Firestore rule that grants every signed-in user a write to
   * product stock — and that rule let ANY customer set `stock.cup: 999999` or
   * zero the whole catalog. Moving the take to a staff action means customers
   * cannot write a product document at all, so that rule could simply be deleted.
   * See the products block in firestore.rules for the full history.
   *
   * THE TRADE, stated plainly: stock is no longer reserved at checkout, so two
   * customers can both order the last pint. The second one is not declined at
   * checkout — it is declined when staff try to start preparing it, and the order
   * stays `pending` so staff can tell the customer. For a shop with staff
   * watching a queue that is a workable process; TERMS.md says so rather than
   * promising a checkout-time guarantee the app cannot keep.
   *
   * ROLE-AGNOSTIC BY DESIGN. This method is identical for a customer and a
   * manager, and it is `firestore.rules` — not this code — that decides who may
   * do what. A customer cancelling a `pending` order computes
   * `shouldTake === false` and `shouldRestore === false` (stock was never taken
   * at `pending`), so the only write is the status change their own rules branch
   * already permits. They never touch a product.
   */
  private async transitionOrderStatus(
    orderId: string,
    newStatus: OrderStatus,
    opts: { cancelReason?: string | null } = {},
  ): Promise<void> {
    const orderRef = doc(this.firestore, `orders/${orderId}`);
    const actorUid = this.authService.currentUserSnapshot?.uid ?? null;

    // Set inside the transaction body, read in the `catch` below. A transaction
    // body may run more than once on contention and may abort partway, so this
    // describes the LAST attempt rather than being computed up front — which is
    // what we want, since it is only consulted to explain a failure.
    let shouldMoveStock = false;

    try {
      await runTransaction(this.firestore, async (tx) => {
        // ══ READS ═══════════════════════════════════════════════════════════
        // Every read precedes every write — Firestore requires that ordering, and
        // it is what makes this one atomic unit: a shortfall on the fourth product
        // gives back the first three.
        //
        // Re-read INSIDE the transaction rather than trusting any value the caller
        // already holds. The body re-runs on contention, so this is the only read
        // the movement may rely on.

        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists()) throw new Error(`Order ${orderId} not found.`);
        const order = orderSnap.data() as Order;

        // Idempotent: a double tap must be a no-op, not an error. Both call sites
        // toast success unconditionally, so an error here would read as a failure
        // for an action that in fact already happened.
        if (order.status === newStatus) return;
        if (order.status === 'delivered') {
          throw new Error('Delivered orders cannot be changed.');
        }
        if (order.status === 'cancelled') {
          if (newStatus === 'cancelled') return;
          throw new OrderNoLongerOpenError('This order was cancelled.');
        }

        const from = order.status;
        const isCancel = newStatus === 'cancelled';
        const wasHolding = STOCK_HELD_STATUSES.includes(from);
        const willHold = STOCK_HELD_STATUSES.includes(newStatus);

        // The take fires on ANY exit from `pending`, not only `pending ->
        // confirmed`. The admin queue can jump a pending order straight to
        // `preparing`, `out_for_delivery` or `delivered` through its status
        // picker and its bulk advance, and gating on the single common transition
        // would leave a permanent silent hole in exactly the two controls that
        // exist to be shortcuts.
        const shouldTake = !isCancel && from === 'pending' && willHold;

        // Cancellation returns stock only if it was actually taken. A
        // `pending -> cancelled` move therefore returns nothing, which is what
        // makes the CUSTOMER cancel path correct: the rules pin a customer to
        // cancelling while `pending`, before any take, so a customer can never owe
        // a restock and never needs to write a product.
        const shouldRestore = isCancel && wasHolding;

        // Whether this attempt writes product documents at all — the condition
        // the manager-only product rule actually gates. Published for the
        // `catch` below.
        shouldMoveStock = shouldTake || shouldRestore;

        // ── Validate and collapse the lines ─────────────────────────────────
        // `normaliseStockLines` is pure and synchronous, so it is legal inside the
        // transaction body. Called HERE, on the data just read, rather than
        // outside it: `items` is staff-writable, so a pre-read would be a race on
        // the very quantities being decremented.
        //
        // It does two jobs. Every quantity must be a whole number of at least 1,
        // because the write is `stock - quantity` and a negative quantity RAISES
        // stock. And duplicate product/size pairs are summed, because the
        // transaction writes each document once — two lines for the same size
        // would otherwise be charged twice while only one decrement applied.
        //
        // It THROWS on violation, which aborts the transaction, which is the
        // fail-closed outcome: the order does not move at all.
        const lines = normaliseStockLines(
          (order.items ?? []).map((i) => ({
            productId: i.productId,
            size: i.size,
            quantity: i.quantity,
            variantName: i.variantName,
          })),
        );

        // Defensive. Firestore's documented per-transaction ceiling is 500
        // documents and this write costs `1 + 2N` for N distinct lines, so a
        // 150-line order would fail opaquely deep in the SDK. A cart that large is
        // a bug worth surfacing, not a transaction to attempt.
        if (lines.length > 100) {
          throw new Error(
            'This order has too many distinct items to move atomically. Split it, or adjust the stock by hand.',
          );
        }

        type Read = {
          ref: DocumentReference;
          size: SizeVariant;
          quantity: number;
          next: number;
          variantName: string;
        };
        const reads: Read[] = [];
        const skipped: string[] = [];

        for (const line of lines) {
          const ref = doc(this.firestore, `products/${line.productId}`);
          const snap = await tx.get(ref);
          const product = snap.data() as Product | undefined;

          // An absent or non-finite level folds to 0. `NaN < quantity` is false,
          // so a NaN would sail past the shortfall check and then fail the write
          // with a much less useful message.
          const raw = Number(product?.stock?.[line.size] ?? 0);
          const current = Number.isFinite(raw) ? raw : 0;

          if (shouldTake && current < line.quantity) {
            // THROW to abort. By now earlier lines may already have staged
            // decrements; the throw gives every one of them back. A partial take
            // is strictly worse than no take — the shelf shrinks by three of four
            // lines while the order sits pending and looks untouched.
            throw new InsufficientStockError(
              `${line.variantName} (${line.size}): ${current} left, ${line.quantity} needed.`,
            );
          }

          if (shouldRestore && !snap.exists()) {
            // A flavor deleted after the order was confirmed has no shelf to
            // return to. Skipped rather than aborting, because the order is
            // already cancelled and refusing the whole cancellation would be
            // worse. It is recorded by leaving `stockRestored` false below.
            skipped.push(line.productId);
            console.error(
              `Order ${orderId}: product ${line.productId} no longer exists, so its stock cannot be returned.`,
            );
            continue;
          }

          reads.push({
            ref,
            size: line.size,
            quantity: line.quantity,
            next: shouldTake ? current - line.quantity : current + line.quantity,
            variantName: product?.variantName ?? line.variantName ?? 'Unknown',
          });
        }

        // ══ WRITES ══════════════════════════════════════════════════════════
        for (const read of reads) {
          // Dot-path, not a whole-map write, so only the size actually sold is
          // touched. A four-line order is then four independent writes that no
          // single clobber can merge into one.
          tx.update(read.ref, {
            [`stock.${read.size}`]: read.next,
            updatedAt: serverTimestamp(),
          });

          // The audit row goes in the SAME transaction, so a movement can never
          // be recorded for a decrement that rolled back, or missed for one that
          // committed. `reason: 'sale'` is what lets the admin ledger tell a real
          // sale apart from a staff adjustment — the two were previously
          // indistinguishable, which is why StockLedgerService exists.
          tx.set(doc(collection(this.firestore, 'stockMovements')), {
            productId: read.ref.id,
            variantName: read.variantName,
            size: read.size,
            delta: shouldTake ? -read.quantity : read.quantity,
            balanceAfter: read.next,
            reason: shouldTake ? 'sale' : 'cancel_restock',
            orderId,
            // The staff member who caused it, NOT the customer. `orderId` already
            // carries the customer link, so writing them here too would make this
            // field a duplicate of it and destroy the only distinct meaning it
            // has: "who caused this".
            actorUid,
            createdAt: serverTimestamp(),
          });
        }

        // The order document LAST, in the same transaction. So a status can never
        // claim to be preparing for stock that was not taken, and `stockRestored`
        // can never claim a return that did not fully happen.
        tx.update(orderRef, {
          status: newStatus,
          // Spread rather than `cancelReason: null`: a non-cancel transition must
          // leave cancelReason exactly as it was.
          ...(isCancel ? { cancelReason: opts.cancelReason ?? null } : {}),
          ...(shouldRestore
            ? {
                // FALSE, not true, when any line was skipped. Claiming a completed
                // return that partially failed would hide a real hole from the
                // repair queue, and this marker is the only thing that decides
                // whether the queue shows this order at all.
                stockRestored: skipped.length === 0,
                stockRestoredAt: skipped.length === 0 ? serverTimestamp() : null,
              }
            : {}),
          updatedAt: serverTimestamp(),
          statusHistory: arrayUnion({ status: newStatus, timestamp: Timestamp.now() }),
        });
      });
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        // Rethrown as a plain Error so no page can branch on the internal class.
        // The wording matters: nothing was taken and the order has NOT moved, and
        // staff need to know that to decide whether to decline or restock.
        throw new Error(
          `${err.message} Nothing was taken and the order has not moved — decline it from the queue, or fix the stock and try again.`,
        );
      }
      if (err instanceof OrderNoLongerOpenError) throw new Error(err.message);

      // A staff shift lead hitting this is an EXPECTED outcome, not a fault, and
      // the raw error is useless to them: it names no field and no role, and
      // `describeFirestoreError` would have said "permission to LOAD", which is
      // wrong in every particular for a write.
      //
      // Only reported for a transition that actually moves stock. A `pending ->
      // cancelled` writes no product, so a customer cancelling their own order
      // can never reach here, and a staff member cancelling a `pending` order is
      // not blocked by this gate at all.
      if (shouldMoveStock && isPermissionDeniedError(err)) {
        throw new Error(
          'Moving this order changes stock on the shelf, and only a manager or the owner can do that. Nothing was changed — ask a manager to take it from here.',
        );
      }
      throw err;
    }
  }

  /**
   * Re-runs the restock for a cancelled order whose stock never came back.
   *
   * Staff-only, and now genuinely reachable: `stockRestored` gained its own
   * clause in firestore.rules. It previously appeared in NO allow-list at all —
   * only in comments — so the first `updateDoc` below threw PERMISSION_DENIED for
   * every role including owner, and the admin repair panel was a control that
   * could never be used. (The old comment here blamed "only `allow update: if
   * isAdmin()`", a clause that does not exist on orders.)
   *
   * The marker is claimed FIRST, before the restock, so a second click cannot
   * double-restock while the first write is in flight — a double-restock inflates
   * inventory exactly as a failed one deflates it. On failure the marker is rolled
   * back to false, because leaving it true would hide the order from the repair
   * queue permanently.
   */
  async repairStockRestock(orderId: string): Promise<void> {
    const orderRef = doc(this.firestore, `orders/${orderId}`);

    // Claim it first. `stockRestored: false` is also the filter the panel uses, so
    // this both prevents a double-claim and marks it in-progress for a refresh.
    await updateDoc(orderRef, { stockRestored: false, stockRestoredAt: null });

    const snap = await getDoc(orderRef);
    if (!snap.exists()) throw new Error('That order no longer exists.');
    const order = snap.data() as Order;
    if (order.status !== 'cancelled') {
      throw new Error('Only a cancelled order needs its stock returned.');
    }

    try {
      await this.inventoryService.restockItems(
        order.items.map((i) => ({ productId: i.productId, size: i.size, quantity: i.quantity })),
      );
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : 'Restocking failed. Check the product still exists.',
      );
    }

    await updateDoc(orderRef, { stockRestored: true, stockRestoredAt: serverTimestamp() });
  }
}
