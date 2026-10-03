// src/app/core/services/order-notification.service.ts
// Five-orites Scoop — in-app order notifications for the signed-in user
//
// Why this exists: `NotificationService.notifyOrderStatusChange()` was called by
// whichever client PERFORMED the status change. So the toast appeared on the
// admin's phone when they advanced a customer's order, and a customer only saw
// anything while they happened to have the tracker page open. The audience and
// the actor were the wrong way round.
//
// This service flips it: it watches the *signed-in user's own* orders and
// notifies them on a genuine transition. It also derives the persistent feed
// that the notifications page and the unread badge read from.
//
// SCOPE: in-app only. There is no Cloud Function in this project and therefore
// nothing to fan out through FCM when the app is closed. That is a deliberate
// scope decision, not a gap being papered over.
//
// TWO CONSUMERS, ONE WATCHER
//
// The toast and the feed are driven from the same snapshot rather than from two
// independent subscriptions. Two subscriptions to the same query would double
// every read against the Spark plan's 50K reads/day for no benefit, and could
// disagree about what "new" means.

import { Injectable, DestroyRef, inject, signal, computed, OnDestroy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, catchError, of } from 'rxjs';
import { OrderService } from './order.service';
import { NotificationService } from './notification.service';
import { AuthService } from './auth.service';
import { Order, OrderStatus } from '../models/order.model';
import { buildNotificationFeed, countUnread, FeedEntry } from '../logic/notifications';

/**
 * How many recent orders to watch.
 *
 * Only recent orders change status, so this bounds the watch without hiding
 * anything actionable. It is also the ceiling on how far back the feed reaches,
 * which the README states rather than leaving as a surprise — the same class of
 * honest note the analytics and fulfilment pages already carry about their own
 * memory ceilings.
 */
const WATCH_LIMIT = 20;

/** Largest jump a single snapshot may add, so a burst cannot fire a wall of toasts. */
const MAX_TOASTS_PER_UPDATE = 1;

@Injectable({ providedIn: 'root' })
export class OrderNotificationService implements OnDestroy {
  private orderService = inject(OrderService);
  private notifier = inject(NotificationService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);

  /** orderId -> the last status we have already told the user about. */
  private readonly seen = new Map<string, OrderStatus>();
  private subscription: Subscription | null = null;

  /** The watched orders. Held so the feed can be a `computed` over them. */
  private readonly orders = signal<Order[]>([]);

  /**
   * The user's read marker, mirrored into a signal.
   *
   * This MUST be a signal rather than reading `AuthService.currentUserSnapshot`
   * directly. That is a plain getter over a `BehaviorSubject`, so it is not
   * reactive: a `computed()` reading it would compute once and never recompute,
   * and the unread badge would stay lit after the user pressed "mark read" until
   * the next order happened to change. That is the exact failure the badge
   * exists to avoid — a control that visibly did nothing.
   *
   * Mirroring here is also what makes the badge correct no matter WHICH surface
   * marks the feed read.
   */
  private readonly readAt = signal<number | null>(null);

  private readonly notificationsEnabled = signal(true);

  /**
   * Everything the signed-in user has been notified about, newest first.
   *
   * A `computed` over the orders and the read marker rather than a signal poked
   * inside the snapshot handler, so marking read updates the list and the badge
   * without waiting for the next Firestore event.
   */
  readonly entries = computed<FeedEntry[]>(() =>
    buildNotificationFeed(this.orders(), this.readAt()),
  );

  /** Unread count for the header badge. Derived, never stored — see the note on `readAt`. */
  readonly unreadCount = computed(() => countUnread(this.entries()));

  constructor() {
    // Mirror the two user fields the feed depends on into signals. Done once,
    // here, instead of each consumer subscribing: three pages reading
    // `notificationsEnabled` should not mean three subscriptions to the auth
    // subject, and a single place to reason about is worth the one line.
    this.auth.currentUser$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((user) => {
      const marker = user?.notificationsReadAt;
      this.readAt.set(typeof marker === 'number' ? marker : null);
      this.notificationsEnabled.set(this.notifier.isEnabled(user?.notificationsEnabled));
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /**
   * Point the watcher at a user, or pass null to stop it. Safe to call on every
   * auth state change: the previous subscription is dropped, the seen-map and the
   * orders are both cleared, so signing out and back in cannot replay another
   * user's statuses and cannot notify about a status the new user has not seen.
   */
  watch(uid: string | null): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.seen.clear();
    this.orders.set([]);

    if (!uid) return;

    this.subscription = this.orderService
      .getCustomerOrders(uid, WATCH_LIMIT)
      // Without this, a failure here is an UNHANDLED RxJS error. Nothing in the
      // app subscribes to this stream's error channel — it exists only to fire
      // toasts and build the feed — so the throw was invisible to the user while
      // still killing the watcher for the rest of the session.
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

  /**
   * Marks everything currently in the feed as read.
   *
   * The local signal is moved FIRST so the badge clears on tap rather than after
   * a round trip, and rolled back if the write fails — otherwise the UI claims
   * success for a save that did not happen.
   *
   * Two deliberate choices in the value written:
   *
   * - Epoch ms, not a `serverTimestamp()`, because a sentinel read straight back
   *   is unresolved and the badge would keep counting what was just dismissed.
   *   `ProfilePatch` documents the same reasoning.
   * - `Date.now()` rather than the newest entry's timestamp. If the device clock
   *   and the stored timestamps disagree, using the entry can mark a
   *   just-arrived transition as already-seen; using now can only be conservative.
   */
  async markAllRead(): Promise<void> {
    const previous = this.readAt();
    const now = Date.now();
    this.readAt.set(now);

    try {
      await this.auth.updateProfile({ notificationsReadAt: now });
    } catch (err) {
      // Put the marker back so the badge returns to telling the truth. The
      // caller reports the failure to the user; this keeps the state honest in
      // the meantime rather than silently swallowing the write.
      this.readAt.set(previous);
      throw err;
    }
  }

  private report(orders: Order[]): void {
    this.orders.set(orders);

    // Toasts fire only for orders that are genuinely NEW to this session, and
    // never for the initial population. Opening the app after a change already
    // happened must not replay a burst of stale notifications — the feed exists
    // precisely so that history is available on demand instead.
    let fired = 0;
    for (const order of orders) {
      const previous = this.seen.get(order.id);

      if (
        previous !== undefined &&
        previous !== order.status &&
        this.notificationsEnabled() &&
        fired < MAX_TOASTS_PER_UPDATE
      ) {
        fired += 1;
        void this.notifier.notifyOrderStatusChange(order.id, order.status);
      }

      this.seen.set(order.id, order.status);
    }
  }
}
