// src/app/core/services/order-notification.service.ts
// Five-orites Scoop — In-app order status notifications for the signed-in user
//
// Why this exists: `NotificationService.notifyOrderStatusChange()` was called by
// whichever client PERFORMED the status change. So the toast appeared on the
// admin's phone when they advanced a customer's order, and a customer only saw
// anything while they happened to have the tracker page open. The audience and
// the actor were the wrong way round.
//
// This service flips it: it watches the *signed-in user's own* orders and
// notifies them on a genuine transition. It is in-app only — a customer with
// the app closed still receives nothing, because real background push needs a
// Cloud Function to fan out through FCM.

import { Injectable, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, catchError, of } from 'rxjs';
import { OrderService } from './order.service';
import { NotificationService } from './notification.service';
import { Order, OrderStatus } from '../models/order.model';

/** How many recent orders to watch. Recent orders are the ones that can change. */
const WATCH_LIMIT = 20;

@Injectable({ providedIn: 'root' })
export class OrderNotificationService {
  private orderService = inject(OrderService);
  private notifier = inject(NotificationService);
  private destroyRef = inject(DestroyRef);

  /** orderId -> the last status we have already told the user about. */
  private readonly seen = new Map<string, OrderStatus>();
  private subscription: Subscription | null = null;

  /**
   * Point the watcher at a user, or pass null to stop it. Safe to call on every
   * auth state change: the previous subscription is dropped and the seen-map is
   * cleared, so signing out and back in cannot replay another user's statuses
   * and cannot notify about a status the new user has not seen yet.
   */
  watch(uid: string | null): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.seen.clear();

    if (!uid) return;

    this.subscription = this.orderService
      .getCustomerOrders(uid, WATCH_LIMIT)
      // Without this, a failure here is an UNHANDLED RxJS error. Nothing in the
      // app subscribes to this stream's error channel — it exists only to fire
      // toasts — so the throw was invisible to the user while still killing the
      // watcher for the rest of the session.
      //
      // That is not hypothetical: this stream calls the same getCustomerOrders()
      // query the dashboard uses, which needs a composite index on
      // (customerId ASC, createdAt DESC). While that index was undeployed, every
      // sign-in threw here for every user, whether or not they ever opened the
      // dashboard. Order notifications were simply dead, with no error shown.
      .pipe(
        catchError((err: unknown) => {
          console.error('Order notifications: could not watch orders', err);
          return of<Order[]>([]);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((orders) => this.report(orders));
  }

  private report(orders: Order[]): void {
    for (const order of orders) {
      const previous = this.seen.get(order.id);

      // No previous entry means we have not seen this order before — either it
      // is brand new (the customer just placed it and got a confirmation
      // inline) or the app was opened after the change already happened.
      // Both cases are deliberately silent, so opening the app does not fire a
      // burst of stale toasts.
      if (previous !== undefined && previous !== order.status) {
        void this.notifier.notifyOrderStatusChange(order.id, order.status);
      }

      this.seen.set(order.id, order.status);
    }
  }
}
