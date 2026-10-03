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
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  addDoc,
  updateDoc,
  runTransaction,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { getDeliveryFee } from '../models/cart.model';
import { getPricingForSet } from '../config/pricing.config';
import { Order, OrderItem, OrderStatus } from '../models/order.model';
import { AuthService } from './auth.service';
import { CartService } from './cart.service';
import { InventoryService } from './inventory.service';
import { VoucherService } from './voucher.service';

/**
 * Statuses at which the order is still physically in the store, so cancelling
 * it should return stock. `out_for_delivery` and `delivered` are excluded: the
 * ice cream has left, and restocking would invent inventory.
 *
 * This constant is now DUPLICATED in the server: `restockCancelledOrder`
 * (functions/src/index.ts) makes the pre-dispatch decision on the trigger that
 * watches the cancellation, not here. Keep the two lists identical.
 */
const PRE_DISPATCH_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing'];

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
    voucherCode?: string | null
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
        const data = snap.data() as { pricing?: Record<string, number>; setName?: string; variantName?: string; setNumber?: number };
        const firestorePrice = data.pricing?.[item.size];
        const matrixPrice = data.setNumber != null
          ? getPricingForSet(data.setNumber)?.[item.size]
          : undefined;
        // Never fall back to the cart's stored price. The cart is rehydrated
        // from localStorage, so that number is attacker-controlled, and this
        // function exists precisely so the client cannot dictate the price. A
        // product with no resolvable price is a data problem to fix in the
        // admin UI, not something to paper over with a client value.
        const unitPrice = firestorePrice ?? matrixPrice;
        if (unitPrice == null) {
          throw new Error(
            `${data.variantName ?? item.variantName} has no price set for this size.`
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
      let appliedVoucherId: string | null = null;
      let discountAmount = 0;
      if (normalizedCode) {
        const { voucher, discount } = await this.voucherService.validateVoucher(
          normalizedCode,
          totalAmount
        );
        appliedCode = voucher.code;
        appliedVoucherId = voucher.id;
        discountAmount = Math.min(Math.max(discount, 0), totalAmount);
      }
      const grandTotal = totalAmount - discountAmount + deliveryFee;

      // ── FIX: never pass undefined to Firestore ──────────────
      // notes undefined → use null instead
      const safeNotes = (notes && notes.trim().length > 0) ? notes.trim() : null;

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
        notes: safeNotes,           // ← null instead of undefined
        cancelReason: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        // NOTE: serverTimestamp() is banned inside arrays by Firestore,
        // so history entries use client Timestamp.now().
        statusHistory: [
          { status: 'pending', timestamp: Timestamp.now() },
        ],
      };

      // Step 3: Create order document
      const ordersCol = collection(this.firestore, 'orders');
      const orderRef = await addDoc(ordersCol, orderData);

      // Step 4: Count the redemption, once the order exists.
      //
      // This has to run AFTER the order write: counting before it would burn a
      // redemption for an order that then failed to commit. It is a separate
      // write (a voucher's usageCount is not part of the order), so it cannot be
      // folded into the order transaction.
      //
      // `maxRedemptions` was previously decoration — `recordRedemption` existed
      // but was never called, so `usageCount` stayed at whatever the admin page
      // wrote and one code was redeemable forever. The customer-side voucher
      // update runs as the SHOP AUTH context (the customer cannot write
      // `vouchers/` — `allow write: if isAdmin()`), so a failure here must not
      // fail an order that already committed.
      if (appliedVoucherId) {
        try {
          await this.voucherService.recordRedemption(appliedVoucherId);
        } catch (err) {
          console.error('Voucher redemption count failed (order committed).', err);
        }
      }

      // Step 5: Clear cart ONCE after successful order
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
        limit(maxResults)
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
        }
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
        }
      );
      return () => unsubscribe();
    });
  }

  getAllOrders(statusFilter?: OrderStatus, maxResults = 100): Observable<Order[]> {
    return new Observable<Order[]>((observer) => {
      const ordersCol = collection(this.firestore, 'orders');
      const q = statusFilter
        ? query(ordersCol, where('status', '==', statusFilter), orderBy('createdAt', 'desc'), limit(maxResults))
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
        }
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
        limit(maxResults)
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
        }
      );
      return () => unsubscribe();
    });
  }

  async updateOrderStatus(orderId: string, newStatus: OrderStatus): Promise<void> {
    const orderRef = doc(this.firestore, `orders/${orderId}`);
    await updateDoc(orderRef, {
      status: newStatus,
      updatedAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: newStatus, timestamp: Timestamp.now() }),
    });
  }

  async cancelOrder(orderId: string, reason?: string): Promise<void> {
    const orderRef = doc(this.firestore, `orders/${orderId}`);
    const snap = await getDoc(orderRef);
    if (!snap.exists()) throw new Error(`Order ${orderId} not found.`);
    const order = { id: snap.id, ...snap.data() } as Order;
    if (order.status === 'cancelled') return;
    if (order.status === 'delivered') throw new Error('Delivered orders cannot be cancelled.');

    const safeReason = (reason && reason.trim().length > 0) ? reason.trim().slice(0, 300) : null;

    // ── The restock is the FUNCTION's job ─────────────────────────────────────
    //
    // `restockCancelledOrder` (functions/src/index.ts) watches exactly this
    // transition — `status` moving into `cancelled` — and returns the stock in a
    // transaction, writing the ledger row and the `stockRestored` marker with it.
    // This method used to do all of that itself via
    // `InventoryService.restockItems`, and doing both would return the stock
    // twice for every cancellation.
    //
    // The transaction below therefore does ONE thing: move the status, atomically,
    // so two concurrent cancels cannot both write it. Everything downstream —
    // the restock, the marker, the repair-queue entry on failure — belongs to the
    // trigger, which can see the transition and react to it even when the cancel
    // came from the admin queue or the tracker page.
    await runTransaction(this.firestore, async (tx) => {
      const fresh = await tx.get(orderRef);
      if (!fresh.exists()) return;
      const current = fresh.data() as { status?: OrderStatus };
      if (current.status === 'cancelled') return;
      if (current.status === 'delivered') {
        throw new Error('Delivered orders cannot be cancelled.');
      }
      tx.update(orderRef, {
        status: 'cancelled',
        cancelReason: safeReason,
        updatedAt: serverTimestamp(),
        statusHistory: arrayUnion({ status: 'cancelled', timestamp: Timestamp.now() }),
      });
    });
  }

  /**
   * Re-runs the restock for a cancelled order whose stock never came back.
   *
   * Admin-only in effect: `stockRestored` is outside the customer cancel clause's
   * `hasOnly([...])`, so only `allow update: if isAdmin()` can write it. The
   * marker is set to true FIRST, before the restock is attempted, so a second
   * click cannot double-restock while the first write is in flight — a
   * double-restock inflates inventory the same way a failed one deflates it.
   *
   * On failure the marker is rolled back to false, because leaving it true would
   * hide the order from the repair queue permanently.
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
        order.items.map((i) => ({ productId: i.productId, size: i.size, quantity: i.quantity }))
      );
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : 'Restocking failed. Check the product still exists.'
      );
    }

    await updateDoc(orderRef, { stockRestored: true, stockRestoredAt: serverTimestamp() });
  }
}
