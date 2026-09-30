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

    // Declared outside the try so the catch block can compensate.
    const stockItems = cart.items.map((i) => ({
      productId: i.productId,
      size: i.size,
      quantity: i.quantity,
    }));
    let stockCommitted = false;

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
      let discountAmount = 0;
      if (normalizedCode) {
        const { voucher, discount } = await this.voucherService.validateVoucher(
          normalizedCode,
          totalAmount
        );
        appliedCode = voucher.code;
        discountAmount = Math.min(Math.max(discount, 0), totalAmount);
      }
      const grandTotal = totalAmount - discountAmount + deliveryFee;

      // Step 2: Validate and decrement stock (transactional).
      // Stock and the order document cannot be written in one transaction
      // (different collections), so track the commit and roll the decrement
      // back if the order write fails. Without this, a failed order write
      // silently destroys inventory.
      await this.inventoryService.validateAndDecrementStock(stockItems);
      stockCommitted = true;

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

      // Step 4: Clear cart ONCE after successful order
      this.cartService.clearCart();

      return orderRef.id;
    } catch (err) {
      console.error('Order placement error:', err);
      // Compensate: the decrement already committed, so give the stock back
      // before surfacing the failure. Never mask the original error.
      if (stockCommitted) {
        try {
          await this.inventoryService.restockItems(stockItems);
        } catch (rollbackErr) {
          console.error('CRITICAL: stock rollback failed — inventory may be short.', rollbackErr);
        }
      }
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

    // Flip the status inside a transaction rather than a bare read-then-write.
    // Two concurrent cancels (a double-tap, or the Orders page and the Tracker
    // page cancelling the same order) both used to read 'pending', both wrote,
    // and both restocked — so the previous "a retry cannot double-restock"
    // comment was not true. runTransaction re-reads on conflict, so the loser
    // observes 'cancelled' here, returns null, and skips the restock.
    //
    // The status we transitioned FROM is returned as well, because it decides
    // whether stock should come back at all. See PRE_DISPATCH_STATUSES below.
    const previousStatus = await runTransaction(this.firestore, async (tx) => {
      const fresh = await tx.get(orderRef);
      if (!fresh.exists()) return null;
      const current = fresh.data() as { status?: OrderStatus };
      if (current.status === 'cancelled') return null;
      if (current.status === 'delivered') {
        throw new Error('Delivered orders cannot be cancelled.');
      }
      tx.update(orderRef, {
        status: 'cancelled',
        cancelReason: safeReason,
        updatedAt: serverTimestamp(),
        statusHistory: arrayUnion({ status: 'cancelled', timestamp: Timestamp.now() }),
      });
      return current.status ?? 'pending';
    });

    // Only the caller that actually moved the order out of its current status
    // does anything further.
    if (previousStatus === null) return;

    // Stock only comes back if the order had not left the shop. An admin
    // cancelling an `out_for_delivery` order is a legitimate operational
    // action, but the ice cream is physically on a bike — restocking it would
    // invent inventory the store can then oversell. The Firestore rules already
    // confine a *customer* to cancelling while `pending`; this closes the same
    // hole on the admin path, which the rules intentionally allow more freedom.
    if (!PRE_DISPATCH_STATUSES.includes(previousStatus)) {
      return;
    }

    try {
      await this.inventoryService.restockItems(
        order.items.map((i) => ({ productId: i.productId, size: i.size, quantity: i.quantity }))
      );
    } catch (err) {
      // The order is already cancelled, and a retry will short-circuit above,
      // so this leak has no self-healing path and needs manual repair. The
      // rules deliberately do not let a customer write a `restocked` marker.
      console.error('CRITICAL: restock after cancellation failed.', err);
      throw new Error('Order cancelled, but restocking failed. Please contact staff.');
    }
  }
}
