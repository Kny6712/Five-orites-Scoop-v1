// src/app/features/orders/orders.page.ts
// Five-orites Scoop — Customer Order History Page
// Author: Five-orites Scoop team (see README)

import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonList,
  IonItem,
  IonLabel,
  IonText,
  IonSkeletonText,
  IonRefresher,
  IonRefresherContent,
  IonSelect,
  IonSelectOption,
  IonNote,
  IonBadge,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import { EmptyStateComponent } from '@shared/components/ui/empty-state.component';
import { Subscription, catchError, of } from 'rxjs';
import { OrderService } from '@core/services/orders/order.service';
import { PaymentService } from '@core/services/orders/payment.service';
import { AuthService } from '@core/services/identity/auth.service';
import {
  Order,
  ORDER_STATUS_META,
  isPaymentPayable,
  shouldShowPaymentBadge,
  type OrderStatus,
} from '@core/models/order.model';
import { OrderStatusBadgeComponent } from '@shared/components/commerce/order-status-badge.component';
import { PaymentStatusBadgeComponent } from '@shared/components/commerce/payment-status-badge.component';
import { CartButtonComponent } from '@shared/components/commerce/cart-button.component';
import { PaginationComponent } from '@shared/components/ui/pagination.component';
import { AppFooterComponent } from '@shared/components/commerce/app-footer.component';
import { PesoPipe } from '@shared/pipes/peso.pipe';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonMenuButton,
    IonList,
    IonItem,
    IonLabel,
    IonText,
    IonSkeletonText,
    IonRefresher,
    IonRefresherContent,
    IonSelect,
    IonSelectOption,
    IonNote,
    IonBadge,
    OrderStatusBadgeComponent,
    PaymentStatusBadgeComponent,
    PesoPipe,
    CartButtonComponent,
    PaginationComponent,
    AppFooterComponent,
    EmptyStateComponent,
  ],
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
})
export class OrdersPage implements OnInit, OnDestroy {
  private orderService = inject(OrderService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private paymentService = inject(PaymentService);
  private sub?: Subscription;

  orders = signal<Order[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');
  cancellingId = signal<string | null>(null);
  /**
   * The order a payment session is currently being created for.
   *
   * A double tap here does not make two orders — the order already exists — but
   * it does make two Xendit sessions for it, and paying one of them would
   * leave an orphaned request behind on the other. Same guard, same reason as
   * the cart's.
   */
  payingId = signal<string | null>(null);
  skeletonItems = Array(5).fill(0);

  /**
   * The statuses in lifecycle order, which is the order the dropdown lists them in.
   *
   * NOT SORTED BY LABEL OR BY COUNT, and that is the point: the list reads as
   * "where an order goes", so a customer can see that Preparing follows Confirmed
   * without knowing the domain. Cancelled sits last rather than in lifecycle order
   * because it is a branch off the side of the sequence, not a step along it —
   * the same reasoning that keeps the tracker's timeline from drawing a cancelled
   * order as a step, and the same one the notifications page's progress strip
   * uses when it drops the strip entirely for a cancelled order.
   */
  private static readonly STATUS_ORDER: readonly OrderStatus[] = [
    'pending',
    'confirmed',
    'preparing',
    'out_for_delivery',
    'delivered',
    'cancelled',
  ];

  /**
   * Which status the dropdown is narrowed to. 'all' is the default and the first
   * option, and that is a DELIBERATE DIFFERENCE from the notifications page rather
   * than an oversight of it.
   *
   * There the windows are time-based and 'today' is the better default, because a
   * notification feed exists to show what happened lately. A customer's order
   * history has no such bias: the rows they came looking for are as likely to be
   * delivered or cancelled as still moving, and a default of 'Order Placed' would
   * hide every settled order on arrival. So the whole history opens the page, and
   * the six statuses are one tap away — the same shape as the notifications page,
   * turned the other way round.
   */
  readonly statusFilter = signal<OrderStatus | 'all'>('all');

  /**
   * The dropdown's options: 'All' plus one per status, each carrying how many
   * orders it would show.
   *
   * THE COUNTS ARE NOT DECORATION, and they earn their place for the same reason
   * they do on the notifications page: a list of bare words invites picking the
   * longest-looking option, and "Cancelled (0)" is a decision in a way that
   * "Cancelled" is not.
   *
   * ZERO COUNTS STAY VISIBLE, matching that page's "Yesterday (0)" and "Earlier
   * (0)". Hiding them would make the list reshuffle as orders move through the
   * lifecycle — an order delivered today removes one option and adds another —
   * and a customer who has never had a delivered order would never learn the
   * state exists. A zero is information, not clutter.
   *
   * Derived from the whole list rather than the current page, so the counts do not
   * change as the customer pages through.
   */
  readonly statusOptions = computed(() => {
    const counts = new Map<OrderStatus, number>();
    for (const order of this.orders()) {
      counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
    }
    return [
      { value: 'all' as const, label: 'All', count: this.orders().length },
      ...OrdersPage.STATUS_ORDER.map((status) => ({
        value: status,
        label: ORDER_STATUS_META[status].label,
        count: counts.get(status) ?? 0,
      })),
    ];
  });

  /**
   * The orders the filter admits, before paging.
   *
   * Derived from the whole feed rather than the current page, so the filter cannot
   * narrow to nothing simply because the matching orders happened to sit on page
   * two — the same distinction the notifications page draws between `allThreads`
   * and `filteredThreads`, and the reason it filters before it slices.
   */
  readonly filteredOrders = computed(() => {
    const filter = this.statusFilter();
    if (filter === 'all') return this.orders();
    return this.orders().filter((order) => order.status === filter);
  });

  ngOnInit(): void {
    this.loadOrders();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  loadOrders(): void {
    const uid = this.authService.currentUserSnapshot?.uid;
    if (!uid) {
      this.router.navigate(['/auth']);
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');
    this.sub?.unsubscribe();

    this.sub = this.orderService
      .getCustomerOrders(uid)
      .pipe(
        catchError(() => {
          this.errorMessage.set('Failed to load orders. Pull to refresh.');
          return of([]);
        }),
      )
      .subscribe((orders) => {
        this.orders.set(orders);
        this.page.set(1);
        this.isLoading.set(false);
      });
  }

  handleRefresh(event: CustomEvent): void {
    this.loadOrders();
    setTimeout(() => (event.target as HTMLIonRefresherElement).complete(), 1000);
  }

  /**
   * Ten orders a page.
   *
   * The list read is uncapped — `getCustomerOrders` has no limit — so a customer
   * with a long history got a single unbounded scroll. Ten rows is about one
   * screen of this list, and the pager matches the admin screens' component so
   * the control looks identical wherever it appears.
   */
  readonly PAGE_SIZE = 10;
  readonly page = signal(1);

  /**
   * Which of this page's orders to render, within the current filter.
   *
   * Sliced from FILTERED orders, not from the whole list, so the rows on screen and
   * the pager's readout beneath them are always describing the same set — the same
   * invariant the notifications page's pager exists to protect, and the one that
   * breaks if a filter is applied after the slice instead of before it.
   */
  readonly pagedOrders = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.filteredOrders().slice(start, start + this.PAGE_SIZE);
  });

  /**
   * Total units on an order, not the number of line items.
   *
   * "Items" for a customer means how much ice cream arrived: two cups and a pint
   * of the same flavor is three items, not one line. The row previously showed
   * the line count, which understated it.
   */
  itemCount(order: Order): number {
    return order.items.reduce((sum, i) => sum + i.quantity, 0);
  }

  /**
   * The order's contents as one readable line — "Ube Halaya, Chocolate Peanut
   * Butter Cup" — so a row can be scanned without opening it.
   *
   * Names are de-duplicated because a ten-scoop order of one flavour is ten
   * lines of the same word; the quantity column already carries the count, so
   * repeating the name would add width and tell the reader nothing.
   *
   * Two names, and nothing after them. This used to append "+11" for the rest,
   * on the argument that a count is information a truncated name is not. On a
   * long list that count was wrong: every row ends in "+N", so it stops being a
   * signal and becomes a repeating artefact of a big order, which is what the
   * qty column beside it is already for. Dropping it leaves the row to say what
   * it is and stop. .order-items ellipsises in CSS, so a name that still will
   * not fit truncates rather than wrapping.
   */
  itemSummary(order: Order): string {
    return [...new Set(order.items.map((i) => i.variantName))].slice(0, 2).join(', ');
  }

  goToProducts(): void {
    void this.router.navigate(['/products']);
  }

  canCancel(order: Order): boolean {
    return order.status === 'pending';
  }

  /**
   * Whether the payment badge should be shown on this order.
   *
   * Hides it for orders predating the gateway — they carry no
   * `paymentRequestId`, and their `paymentStatus` has sat at `pending` since
   * the day they were written — flagging every historical order as "Unpaid"
   * would be a false claim about orders that were settled outside the app.
   */
  showPaymentBadge(order: Order): boolean {
    return shouldShowPaymentBadge(order);
  }

  /**
   * Whether "Pay Now" should be shown on this order.
   *
   * Four conditions, each of which independently means "do not ask for money":
   * paid already, refunded, cancelled, or delivered. The last is easy to miss —
   * a delivered order whose payment failed is a collections problem for the shop
   * to resolve by hand, not something to re-present a checkout page for, and
   * offering it would let a customer "pay" for an order that already arrived.
   */
  canPay(order: Order): boolean {
    return isPaymentPayable(order);
  }

  /**
   * Starts a payment session for an unpaid order.
   *
   * The order already exists: this is "Continue to Payment" for a customer who
   * left the cart page before they ever paid, or came back to My Orders after a
   * failure. No order is written, only a new session for the existing one.
   *
   * The button is disabled while a session is being created, for the same
   * reason it is on the cart: two calls in flight would mint two Xendit
   * sessions for the same order, and paying one of them would leave an orphaned
   * request behind on the other.
   */
  async payNow(order: Order, event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
    if (!this.paymentService.isConfigured) {
      const toast = await this.toastCtrl.create({
        message: 'Payments are not set up on this build yet.',
        color: 'warning',
        duration: 3000,
        position: 'top',
      });
      await toast.present();
      return;
    }

    this.payingId.set(order.id);
    try {
      const session = await this.paymentService.createSession(
        order.id,
        this.paymentService.preferredChannel,
      );
      this.paymentService.goToCheckout(session.checkoutUrl);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'We could not start your payment. Please try again.';
      const toast = await this.toastCtrl.create({
        message,
        color: 'danger',
        duration: 4000,
        position: 'top',
      });
      await toast.present();
    } finally {
      this.payingId.set(null);
    }
  }

  /**
   * Applies a new status from the dropdown.
   *
   * Takes the raw `CustomEvent` and narrows inside, rather than accepting the value
   * directly, because `ion-select` types its value as `any` and `?? 'all'` is the
   * same defensive read the notifications page's `onFilterChange` uses — a control
   * that can emit no value must not be able to blank the filter.
   *
   * THE PAGE RESET IS THE WHOLE POINT OF THIS METHOD, and it is needed for the same
   * reason it is there on the notifications page: `page` is not derived from the
   * filter, so nothing else resets it. Switching from page 3 of "All" to
   * "Delivered" — which holds two orders, so one page — would slice [20, 30) out of
   * a two-element array and render nothing at all, with a pager sitting under a
   * blank region claiming there are more. Changing what you are looking at has to
   * put you back at the first page of it.
   *
   * Guarded against a no-op change because `ion-select` fires `ionChange` when it
   * re-renders its selected state, and resetting the page from that would fight the
   * user for control of it.
   */
  onStatusChange(event: CustomEvent): void {
    const next = (event.detail.value as OrderStatus | 'all' | undefined) ?? 'all';
    if (this.statusFilter() === next) return;
    this.statusFilter.set(next);
    this.page.set(1);
  }

  /**
   * Back to the whole history, from the empty-window state.
   *
   * Routed through `onStatusChange` rather than setting the signal directly so there
   * is ONE path from "the customer changed their mind about the filter" to "the page
   * and the dropdown agree" — the same reason `showRescuePeriod` on the
   * notifications page calls `onFilterChange` with a synthetic event instead of
   * reaching past it.
   */
  showAllOrders(): void {
    this.onStatusChange({ detail: { value: 'all' } } as CustomEvent);
  }

  /**
   * The active status's label, for the empty-window copy.
   *
   * Lowercased the way `activePeriodLabel` lowercases on the notifications page, so
   * the sentence reads "None of your orders is preparing your scoops" — lowercased
   * mid-sentence, which is why this is a separate method rather than the option text
   * interpolated raw.
   *
   * Guarded on the filter being a real status: the empty state is only reachable
   * with one selected, so 'all' is unreachable here, but the type says otherwise and
   * the template would otherwise interpolate "all".
   */
  statusLabel(): string {
    const filter = this.statusFilter();
    return filter === 'all' ? '' : ORDER_STATUS_META[filter].label.toLowerCase();
  }

  /**
   * Which of the three notification-card treatments a row wears.
   *
   * THERE ISN'T ONE ANY MORE, and this is the deletion rather than an omission.
   *
   * The row used to be tinted by status — a teal border while the order was
   * still moving, a red one once it had been cancelled, and nothing at all for
   * a delivered order — so that a customer reading My Orders and Notifications
   * saw one card system rather than two.
   *
   * But the status chip on each row already carries the state, in the app's own
   * six tones, and a second signal on the same row says it twice. On a page of
   * thirteen orders, three of them cancelled and four still moving, the tinted
   * borders turned the page into a page of alerts: the eye went to the loud
   * rows rather than to the newest one, which is the order a customer actually
   * came back for.
   *
   * So every row is the same flat card now, and the chip is the only thing that
   * says where the order has got to.
   */
  async cancelOrder(order: Order, event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
    const alert = await this.alertCtrl.create({
      header: 'Cancel Order',
      // No mention of stock. This button is only offered while the order is
      // `pending` (see canCancel above), and a `pending` order has never had any
      // stock taken for it — stock is taken when STAFF move it out of pending in
      // the fulfilment queue. So "stock will be restored" was not merely
      // optimistic, it described a movement that can never apply to this order.
      message: `Cancel order #${order.id.slice(-6).toUpperCase()}? This cannot be undone.`,
      inputs: [{ name: 'reason', type: 'text', placeholder: 'Reason (optional)' }],
      buttons: [
        { text: 'Back', role: 'cancel' },
        {
          text: 'Cancel Order',
          role: 'destructive',
          handler: async (data) => {
            this.cancellingId.set(order.id);
            try {
              await this.orderService.cancelOrder(order.id, data?.reason);
              const toast = await this.toastCtrl.create({
                message: 'Order cancelled.',
                color: 'warning',
                duration: 2500,
                position: 'top',
              });
              await toast.present();
            } catch (err) {
              const toast = await this.toastCtrl.create({
                message: err instanceof Error ? err.message : 'Failed to cancel order.',
                color: 'danger',
                duration: 3000,
                position: 'top',
              });
              await toast.present();
            } finally {
              this.cancellingId.set(null);
            }
          },
        },
      ],
    });
    await alert.present();
  }

  formatDate(timestamp: unknown): string {
    try {
      const ts = timestamp as { toDate(): Date };
      const date = ts?.toDate ? ts.toDate() : new Date(timestamp as string);
      return date.toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  trackOrder(_: number, order: Order): string {
    return order.id;
  }
}
