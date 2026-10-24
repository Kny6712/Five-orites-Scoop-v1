// src/app/features/admin/orders/admin-orders.page.ts
// Five-orites Scoop — Admin Order Fulfillment Dashboard
// Author: Five-orites Scoop team (see README)

import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonButton,
  IonSearchbar,
  IonPopover,
  IonSkeletonText,
  IonRefresher,
  IonRefresherContent,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { EmptyStateComponent } from '@shared/components/ui/empty-state.component';
import { AlertBannerComponent } from '@shared/components/ui/alert-banner.component';
import { PaginationComponent } from '@shared/components/ui/pagination.component';
import { AdminFooterComponent } from '@shared/components/admin/admin-footer.component';
import { OrderService } from '@core/services/orders/order.service';
import { Order, OrderStatus, ORDER_STATUS_META } from '@core/models/order.model';
import { describeFirestoreError } from '@core/logic/firestore-error';
import { toCsv, csvFilename, toIsoDate } from '@core/logic/csv/cell';
import { CsvExportService } from '@core/services/commerce/csv-export.service';
import { OrderStatusBadgeComponent } from '@shared/components/commerce/order-status-badge.component';
import { PesoPipe } from '@shared/pipes/peso.pipe';
import { SIZE_DISPLAY_LABELS } from '@core/config/pricing.config';

/**
 * How many orders the fulfillment queue holds in memory.
 *
 * This is a WORKING QUEUE, not a report: an order the staff cannot see is an
 * order they never prepare. The old 100-order default was small enough that a
 * busy shop would quietly lose its backlog.
 *
 * It was ALSO a hard cap that hid everything past 300 behind a banner. The
 * banner was honest, which is why it survived so long, but honest and useless is
 * still useless. The read now pages to the end of the result set, so this is a
 * memory ceiling rather than a limit on how much of the queue is reachable.
 * `truncated` still fires if it is ever hit.
 */
const ORDERS_QUEUE_MAX = 3000;

/**
 * Orders per page read.
 *
 * Bounded because Firestore bills per document read, and one 3,000-document
 * query is a worse failure mode on a metered project than several small ones.
 */
const ORDERS_QUEUE_PAGE_SIZE = 200;

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'out_for_delivery',
  out_for_delivery: 'delivered',
};

/** Lifecycle order, for the free-form status picker. */
const ALL_STATUSES: readonly OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled',
];

@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonMenuButton,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonButton,
    IonSearchbar,
    IonPopover,
    IonSkeletonText,
    IonRefresher,
    IonRefresherContent,
    OrderStatusBadgeComponent,
    PesoPipe,
    PaginationComponent,
    AdminFooterComponent,
    AppIconComponent,
    EmptyStateComponent,
    AlertBannerComponent,
  ],
  templateUrl: './admin-orders.page.html',
  styleUrls: ['./admin-orders.page.scss'],
})
export class AdminOrdersPage implements OnInit, OnDestroy {
  private orderService = inject(OrderService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private csvExport = inject(CsvExportService);
  /**
   * No `Subscription` field any more.
   *
   * The queue used to hold an onSnapshot subscription for a capped read. The paged
   * `getOrdersPage` walk replaced it, and that is an async loop rather than an
   * observable, so there is nothing to unsubscribe from -- `walkToken` is what
   * stops it, and ngOnDestroy bumps it.
   */

  allOrders = signal<Order[]>([]);
  /** The status the queue is narrowed to, or 'all' for the whole queue. */
  statusFilter = signal<OrderStatus | 'all'>('all');
  isLoading = signal(true);
  /** Non-empty when the order list failed to load, as opposed to being empty. */
  loadError = signal('');
  /** True when the queue read hit ORDERS_QUEUE_MAX, so older orders are hidden. */
  truncated = signal(false);
  updatingId = signal<string | null>(null);
  expandedId = signal<string | null>(null);

  /**
   * Which row's status popover is open, or null when none is.
   *
   * ONE signal for the whole table rather than a per-row boolean, because that is
   * the only way to guarantee what the per-row `ion-select` version could not: that
   * at most one overlay is ever open. With one flag per row nothing stops an admin
   * from opening two, and two full-viewport overlays at `z-index: 1001` is a
   * backdrop over the queue.
   *
   * It also serves as the single source for `aria-expanded` on every row's button,
   * so the announced state cannot drift from the rendered one.
   */
  readonly statusPopoverId = signal<string | null>(null);

  /**
   * Whether the STATUS FILTER popover is open - a MIRROR of the overlay's real
   * state, written by didPresent/didDismiss and read by the trigger button's
   * aria-expanded.
   *
   * A mirror and not a driver, for the same reason `statusPopoverId` is one:
   * with `trigger` set, Ionic presents the overlay itself, and a signal that
   * drove it would be a second way of opening the same thing.
   */
  readonly statusFilterPopoverOpen = signal(false);

  readonly sizeLabels = SIZE_DISPLAY_LABELS;
  readonly statusMeta = ORDER_STATUS_META;

  /**
   * The lifecycle order the status windows are listed in.
   *
   * Cancelled was missing from the original list, so a cancelled order could
   * only be found under "All" - which is exactly the list that goes incomplete
   * once the shop passes the 100-order read cap.
   */
  private static readonly FILTER_ORDER: readonly OrderStatus[] = [
    'pending',
    'confirmed',
    'preparing',
    'out_for_delivery',
    'delivered',
    'cancelled',
  ];

  /**
   * The labels the QUEUE uses for each state.
   *
   * NOT the customer-facing ORDER_STATUS_META strings. "Delivery" and "Done" are
   * what a fulfilment queue calls those states; the customer page's "Out for
   * Delivery" and "Delivered" are a different voice for a different reader, and
   * sharing a control with that page does not mean sharing its wording. The
   * longest of these is seven characters, which is what keeps the popover
   * narrow enough for the counts to survive in it.
   */
  private static readonly FILTER_LABELS: Record<OrderStatus, string> = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    preparing: 'Preparing',
    out_for_delivery: 'Delivery',
    delivered: 'Done',
    cancelled: 'Cancelled',
  };

  /**
   * The filter's options: 'All' plus one per status, each carrying how many of
   * the queued orders it would show.
   *
   * THE COUNTS ARE NOT DECORATION - the same argument the customer orders page
   * makes for its own status dropdown. A list of bare words invites picking the
   * longest-looking option, and "Cancelled (0)" is a decision in a way that
   * "Cancelled" is not. On a queue this matters more than on a personal history:
   * the admin's actual job is "what is left to do", and the number is the whole
   * answer.
   *
   * ZERO COUNTS STAY VISIBLE, matching "Yesterday (0)" on the notifications page
   * and "Cancelled (0)" on My Orders. Hiding them would make the list reshuffle
   * as orders move through the lifecycle, and an admin who has never cancelled
   * an order would never learn the window exists.
   *
   * DERIVED FROM THE WHOLE QUEUE, not the current page and not the current
   * search. The counts describe the queue's shape - how many orders sit in each
   * state - and a count that changed every time the admin typed a character
   * would be answering a different question, one nobody asked.
   */
  readonly statusOptions = computed(() => {
    const counts = new Map<OrderStatus, number>();
    for (const order of this.allOrders()) {
      counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
    }
    return [
      { value: 'all' as OrderStatus | 'all', label: 'All', count: this.allOrders().length },
      ...AdminOrdersPage.FILTER_ORDER.map((status) => ({
        value: status,
        label: AdminOrdersPage.FILTER_LABELS[status],
        count: counts.get(status) ?? 0,
      })),
    ];
  });

  /**
   * Free-text search across id, customer, address and item names.
   *
   * The tracking page has had one all along and fulfilment did not, which made
   * the two admin queues answer the same question ("where is order ABC123?")
   * differently depending on which one you happened to open. Both now do the same
   * thing, so the answer does not depend on the page.
   *
   * It narrows WITHIN the status filter, not instead of it: a status says which
   * state, the search says which order.
   *
   * Client-side on purpose: the queue is already an in-memory array capped at
   * ORDERS_QUEUE_MAX, so a Firestore `where`/`orderBy` would need a composite
   * index and would still not cover a substring of an address.
   */
  search = signal('');

  /**
   * The search narrows the queue as you type.
   *
   * It used to commit on blur instead, and the Enter path was a DEAD BINDING:
   * `ionKeyDown` is an ion-INPUT event and ion-searchbar does not emit it, so
   * Angular was listening for an event that does not exist and only the blur
   * path ever narrowed anything. Typing looked broken.
   *
   * Now the filter reads this signal directly, which is what the sibling
   * queues do - the reviews, tracking, products, inventory and vouchers pages
   * all narrow on `ionInput`. The two-signal `search`/`query` split is gone.
   */
  onSearch(value: string | null | undefined): void {
    this.search.set(value ?? '');
    this.page.set(1);
  }

  /**
   * The queue, narrowed by status and then by the search text.
   *
   * STATUS FIRST, then the text. The order matters only for the counts the
   * two produce, not for the rows themselves: a row either is in the state or
   * it is not, and then either matches the text or it does not.
   *
   * Both narrowings are applied to the WHOLE queue before it is paged, so a
   * filter can never land the admin on a page that is empty because the
   * matching rows happened to sit on page two.
   */
  filteredOrders = computed(() => {
    const filter = this.statusFilter();
    const q = this.search().trim().toLowerCase();

    return this.allOrders().filter((o) => {
      if (filter !== 'all' && o.status !== filter) return false;
      if (!q) return true;
      return (
        o.id.toLowerCase().includes(q) ||
        (o.customerEmail ?? '').toLowerCase().includes(q) ||
        (o.deliveryAddress ?? '').toLowerCase().includes(q) ||
        (o.items ?? []).some((i) => (i.variantName ?? '').toLowerCase().includes(q))
      );
    });
  });

  /**
   * What the empty state says when nothing matched.
   *
   * It has to name the STATUS, because the status is the wider of the two
   * narrowings: an empty "Cancelled" window is a different fact from an empty
   * search, and "No orders matching this search" would be pointing the admin at
   * the wrong control.
   */
  readonly emptyMessage = computed(() => {
    const filter = this.statusFilter();
    const searching = this.search().trim().length > 0;
    if (filter === 'all') {
      return searching ? 'No orders matching this search.' : 'No orders.';
    }
    const label = AdminOrdersPage.FILTER_LABELS[filter].toLowerCase();
    return searching ? `No ${label} orders matching this search.` : `No ${label} orders.`;
  });

  /**
   * Ten orders a page.
   *
   * The queue read fetches up to 300 orders and the page rendered every one of
   * them as a card. On a phone that is a very long scroll of largely identical
   * rows, and the actionable ones — the ones still pending or preparing — are
   * scattered through it. Paging keeps the scroll short and, more importantly,
   * makes the filter counts legible: "12 of 34" tells an admin at a glance
   * whether the queue is nearly clear.
   *
   * The full filtered set stays in `filteredOrders` — this only decides what is
   * rendered, so the counts and the status chips remain correct.
   */
  readonly PAGE_SIZE = 10;
  readonly page = signal(1);

  readonly pagedOrders = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.filteredOrders().slice(start, start + this.PAGE_SIZE);
  });

  /**
   * The row's position in the FILTERED set, counting from one.
   *
   * It used to be a checkbox, and a checkbox could not answer the question the
   * queue is actually asked: how many are there? A number can. The admin reads
   * the last number on the last page and has the total.
   *
   * THE NUMBER RUNS ACROSS PAGES, not from 1 on each one. Page 2 starts at 11,
   * and the last row of a 37-order queue reads 37. Restarting per page would
   * have been a number that lies about the size of the queue.
   *
   * The offset is the same slice `pagedOrders` takes, so the number and the
   * row cannot drift apart.
   */
  rowNumber(index: number): number {
    return (this.page() - 1) * this.PAGE_SIZE + index + 1;
  }

  skeletonItems = Array(5).fill(0);

  /**
   * Total units on an order, not the line count.
   *
   * "Items" in a fulfilment queue is a quantity question — three pints of the
   * same flavor is three things to scoop, not one line to read. A line count
   * would understate the work and is what the column used to be missing
   * entirely.
   */
  itemCount(order: Order): number {
    return order.items.reduce((sum, i) => sum + i.quantity, 0);
  }

  /**
   * Page change from the pager.
   *
   * Collapses any open detail row: an expanded order on the page the user just
   * left is invisible state, and if they page back it reappears still open with
   * no indication of why.
   */
  onPageChange(next: number): void {
    this.page.set(next);
    this.expandedId.set(null);
    // The open popover's trigger is about to be destroyed along with every row on
    // the page being left, so `statusPopoverId` has to stop naming it. Otherwise a
    // new page's row at the same `$index` inherits the open state, and the first
    // row of page 2 opens with a popover nobody asked for.
    this.statusPopoverId.set(null);
  }

  ngOnInit(): void {
    this.loadOrders();
  }
  ngOnDestroy(): void {
    // Bump the walk token so an in-flight page walk cannot resolve into a
    // destroyed view. The walk is a plain async loop with no subscription to
    // cancel, so this is the only thing stopping it writing to signals after
    // teardown -- the same reason AnalyticsPage does it.
    this.walkToken++;
  }

  /**
   * Incremented per read so a superseded page walk can tell it is stale.
   *
   * The walk awaits between pages, so a pull-to-refresh landing mid-walk would
   * otherwise let two walks race and the older one could win, replacing a fresh
   * read with a stale one.
   */
  private walkToken = 0;

  loadOrders(): void {
    this.isLoading.set(true);
    this.loadError.set('');

    // EVERY matching order, walked in pages.
    //
    // This used to be one query capped at ORDERS_QUEUE_MAX with a banner when
    // the cap was hit. The banner was honest, which is why it survived so long,
    // but honest and useless is still useless: an order beyond 300 is an order
    // that cannot be prepared, and the fix for that is not a warning, it is
    // being able to reach the order.
    //
    // Paging the whole set rather than fetching one screen at a time is
    // deliberate. This page filters and sorts CLIENT-SIDE across `allOrders` --
    // status tabs, a search box, and a date filter all operate on the full list
    // at once, and there is a shared PaginationComponent below that slices
    // whichever view is active. Server-side paging would mean re-querying on
    // every tab click and every keystroke in the search box, and the filter
    // counts in the tab labels would all become wrong.
    //
    // So the queue keeps the whole set in memory, exactly as analytics does, and
    // ORDERS_QUEUE_MAX becomes a memory ceiling that warns rather than a limit
    // that hides. The same approach, for the same reason.
    const collected: Order[] = [];
    let cursor: unknown = null;
    let hasMore = true;
    this.walkToken++;
    const token = this.walkToken;

    void (async () => {
      try {
        while (hasMore) {
          const result = await this.orderService.getOrdersPage({
            pageSize: ORDERS_QUEUE_PAGE_SIZE,
            cursor,
          });

          // A newer walk started, or the view was destroyed. Discard this result
          // rather than appending into a list nobody is looking at any more.
          if (token !== this.walkToken) return;

          collected.push(...result.orders);
          cursor = result.cursor;
          hasMore = result.hasMore && collected.length < ORDERS_QUEUE_MAX;

          if (collected.length >= ORDERS_QUEUE_MAX) {
            // Still reachable, still reported. A ceiling the app cannot hit is a
            // claim, and a claim that silently stops being true is the bug the
            // banner exists to prevent.
            this.truncated.set(true);
            break;
          }
        }

        this.allOrders.set(collected);
        this.truncated.set(false);
        this.page.set(1);
      } catch (err) {
        if (token !== this.walkToken) return;
        // Previously collapsed to an empty list, so a permissions denial or a
        // missing composite index rendered as "No orders" — indistinguishable
        // from a genuinely empty fulfilment queue.
        console.error('Failed to load orders.', err);
        this.loadError.set(describeFirestoreError('orders', err));
      } finally {
        if (token === this.walkToken) this.isLoading.set(false);
      }
    })();
  }

  toggleExpand(orderId: string): void {
    this.expandedId.set(this.expandedId() === orderId ? null : orderId);
  }

  /**
   * Label for the current status filter shown in the trigger button, with the
   * matching count — same shape as the users page's role filter chip label.
   *
   * The count is the whole answer to "how many are in this state", so it is
   * IN the label rather than behind the control: a button reading just
   * "Cancelled" and a popover reading "Cancelled (3)" would make the admin
   * open the thing to find out what it is for.
   */
  getStatusFilterLabel(): string {
    const opt = this.statusOptions().find((o) => o.value === this.statusFilter());
    return opt ? `${opt.label} (${opt.count})` : `All (${this.allOrders().length})`;
  }

  /**
   * Opens the status filter popover (driven by the button's `trigger` attribute).
   */
  openStatusFilterPopover(): void {
    this.statusFilterPopoverOpen.set(true);
  }

  closeStatusFilterPopover(): void {
    this.statusFilterPopoverOpen.set(false);
  }

  /**
   * Apply a status filter choice from the popover.
   *
   * The page goes back to 1 because a status change usually shrinks the result
   * set, and without this the admin can be left on page 4 of a list that now
   * has 2 pages, showing nothing.
   */
  onStatusFilter(next: OrderStatus | 'all'): void {
    this.statusFilter.set(next);
    this.expandedId.set(null);
    // The open popover's trigger goes with the rows that are about to be
    // re-rendered, so `statusPopoverId` must stop naming it.
    this.statusPopoverId.set(null);
    this.page.set(1);
  }

  /**
   * Statuses at which the shop is holding this order's stock.
   *
   * Mirrors `STOCK_HELD_STATUSES` in OrderService, which is where the movement
   * actually happens. It is repeated here rather than imported because the page
   * needs it only to decide what to SAY, and a message that misstated the stock
   * consequence is a support ticket — but if the two ever disagree, this copy is
   * the wrong one, so change the service first.
   */
  protected readonly heldStockStatuses: readonly OrderStatus[] = [
    'pending',
    'confirmed',
    'preparing',
  ];

  async cancelOrder(order: Order): Promise<void> {
    // Whether stock comes back depends entirely on where the order is. Stock is
    // taken when an order LEAVES `pending`, so a `pending` order holds none and
    // cancelling it returns nothing; a `confirmed` or `preparing` order does hold
    // its stock and cancelling it puts it back on the shelf. One message covering
    // both cases would have to be a lie for one of them.
    const heldStock = this.heldStockStatuses.includes(order.status);

    const alert = await this.alertCtrl.create({
      header: 'Cancel Order',
      message:
        `Cancel order #${order.id.slice(-6).toUpperCase()}?` +
        (heldStock ? ' Its stock will be returned to the shelf.' : ''),
      inputs: [{ name: 'reason', type: 'text', placeholder: 'Reason (optional)' }],
      buttons: [
        { text: 'Back', role: 'cancel' },
        {
          text: 'Cancel Order',
          role: 'destructive',
          handler: async (data) => {
            this.updatingId.set(order.id);
            try {
              await this.orderService.cancelOrder(order.id, data?.reason);
              // Owner notified by OrderNotificationService, not from here.
              const toast = await this.toastCtrl.create({
                message: heldStock ? 'Order cancelled and stock returned.' : 'Order cancelled.',
                color: 'warning',
                duration: 2500,
                position: 'top',
              });
              await toast.present();
            } catch (err: unknown) {
              const toast = await this.toastCtrl.create({
                message: err instanceof Error ? err.message : 'Failed to cancel order.',
                color: 'danger',
                duration: 3000,
                position: 'top',
              });
              await toast.present();
            } finally {
              this.updatingId.set(null);
            }
          },
        },
      ],
    });
    await alert.present();
  }

  handleRefresh(event: CustomEvent): void {
    this.loadOrders();
    setTimeout(() => (event.target as HTMLIonRefresherElement).complete(), 1000);
  }

  formatDate(timestamp: unknown): string {
    try {
      if (timestamp === null || timestamp === undefined) return '—';
      const ts = timestamp as { toDate(): Date } | string;
      const date = typeof ts === 'string' ? new Date(ts) : ts.toDate();
      return date.toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  trackOrder(_: number, o: Order): string {
    return o.id;
  }

  /**
   * The popover id for one row, and the `ion-popover`'s `trigger` reference.
   *
   * DERIVED FROM `$index`, NOT FROM `order.id`. Only the current page is ever in
   * the DOM, so the row's position is already a unique key, and an id attribute
   * built from a Firestore document id is one unescaped character away from
   * breaking the `trigger` lookup. This cannot have that failure mode.
   */
  statusTriggerId(rowIndex: number): string {
    return `order-status-trigger-${rowIndex}`;
  }

  isStatusPopoverOpen(rowIndex: number): boolean {
    return this.statusPopoverId() === this.statusTriggerId(rowIndex);
  }

  closeStatusPopover(): void {
    this.statusPopoverId.set(null);
  }

  /**
   * The obvious next step for this order, or undefined at a terminal status.
   *
   * Deliberately the same map the row's old "Confirmed →" pill was reading, so the
   * popover's promoted first option and the pill it replaces are the same decision
   * — this moves where that decision is *offered*, not what it is.
   */
  nextStepFor(order: Order): OrderStatus | undefined {
    return NEXT_STATUS[order.status];
  }

  /**
   * The statuses left over for the popover's "all statuses" group: everything
   * except where the order already is, and except the next step, which has already
   * been promoted above them.
   *
   * Excluding the current status is unchanged in substance and still for the reason
   * it was first written — offering "mark as Delivered" on a delivered order is a
   * no-op that looks like a failure. What changed is that the current status is no
   * longer simply absent: it is shown at the top of the popover as the chip itself,
   * marked Current, so the admin can see where the order is without the list
   * pretending it does not know.
   */
  otherStatusOptions(order: Order): readonly OrderStatus[] {
    const next = NEXT_STATUS[order.status];
    return ALL_STATUSES.filter((s) => s !== order.status && s !== next);
  }

  readonly allStatuses = ALL_STATUSES;

  /** Moves one order to any status, with a confirm that names the target. */
  async setStatus(order: Order, next: OrderStatus): Promise<void> {
    if (order.status === next) return;
    // Cancelling restocks and has its own dialog; do not offer two paths to it.
    if (next === 'cancelled') {
      await this.cancelOrder(order);
      return;
    }
    const alert = await this.alertCtrl.create({
      header: 'Change status',
      message:
        `Order #${order.id.slice(-6).toUpperCase()}: ` +
        `"${ORDER_STATUS_META[order.status].label}" → "${ORDER_STATUS_META[next].label}"?` +
        (next === 'delivered'
          ? '\n\nSkipping straight to Delivered is fine for an order handed over in person.'
          : ''),
      buttons: [
        { text: 'Back', role: 'cancel' },
        {
          text: 'Confirm',
          handler: async () => {
            this.updatingId.set(order.id);
            try {
              await this.orderService.updateOrderStatus(order.id, next);
              const t = await this.toastCtrl.create({
                message: `Order set to "${ORDER_STATUS_META[next].label}"`,
                color: 'success',
                duration: 2000,
                position: 'top',
              });
              await t.present();
            } catch (err: unknown) {
              const t = await this.toastCtrl.create({
                message: err instanceof Error ? err.message : 'Failed to update status.',
                color: 'danger',
                duration: 3000,
                position: 'top',
              });
              await t.present();
            } finally {
              this.updatingId.set(null);
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Exports the whole FILTERED queue, not just the visible page.
   *
   * Every other admin export in the app takes the filtered set rather than the
   * rendered slice, and an export that silently drops 40 rows because you were
   * on page 1 of 4 is worse than no export at all.
   */
  /**
   * Prints a professional receipt for an order via the browser's print dialog.
   */
  printReceipt(order: Order): void {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const total = order.grandTotal ?? 0;
    const subtotal = order.totalAmount ?? 0;
    const discount = order.discountAmount ?? 0;
    const delivery = order.deliveryFee ?? 0;
    const itemsHtml = order.items
      .map(
        (i) =>
          `<tr>
            <td class="item-name">${i.variantName} (${i.size}) × ${i.quantity}</td>
            <td class="item-price">${(i.unitPrice * i.quantity).toLocaleString('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })}</td>
          </tr>`,
      )
      .join('');
    const placed = this.formatDate(order.createdAt);
    const paidAt = order.paidAt ? this.formatDate(order.paidAt) : '—';
    const transactionRef = order.paymentReference ?? '—';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Receipt #${order.id.slice(-6)}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 1.4; color: #1a1a1a; padding: 20px; max-width: 320px; margin: 0 auto; }
          @media print { body { padding: 0; max-width: none; } @page { margin: 0; size: auto; } }
          .receipt { border: 1px solid #ddd; border-radius: 8px; padding: 24px; background: #fff; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #1a1a1a; padding-bottom: 16px; }
          .logo { font-size: 24px; margin-bottom: 8px; }
          .shop-name { font-weight: 700; font-size: 16px; letter-spacing: 0.5px; }
          .shop-tagline { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
          .receipt-title { font-size: 11px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 1px; margin: 16px 0 8px; }
          .meta-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px; margin-bottom: 16px; }
          .meta-label { color: #666; }
          .meta-value { font-weight: 500; text-align: right; }
          .divider { border-top: 1px dashed #ccc; margin: 16px 0; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
          th { text-align: left; font-weight: 600; font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px; border-bottom: 1px solid #1a1a1a; }
          td { padding: 8px 0; font-size: 12px; vertical-align: top; }
          .item-name { color: #1a1a1a; }
          .item-price { text-align: right; font-weight: 500; white-space: nowrap; }
          .totals { font-size: 12px; }
          .total-row { display: flex; justify-content: space-between; padding: 4px 0; }
          .total-label { color: #666; }
          .total-value { font-weight: 500; }
          .total-row.grand { border-top: 1px solid #1a1a1a; margin-top: 8px; padding-top: 12px; font-size: 14px; font-weight: 700; }
          .total-row.grand .total-label, .total-row.grand .total-value { color: #1a1a1a; }
          .address-section { margin-top: 20px; padding-top: 16px; border-top: 1px dashed #ccc; }
          .address-label { font-size: 11px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
          .address-text { font-size: 12px; line-height: 1.6; white-space: pre-wrap; }
          .footer { text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px dashed #ccc; font-size: 11px; color: #999; }
          .transaction-ref { font-family: monospace; font-size: 11px; background: #f5f5f5; padding: 4px 8px; border-radius: 4px; display: inline-block; margin-top: 4px; }
        </style>
      </head>
      <body>
        <div class="receipt">
          <div class="header">
            <div class="logo">🍦</div>
            <div class="shop-name">FIVE-ORITES SCOOP</div>
            <div class="shop-tagline">Artisanal Ice Cream</div>
          </div>

          <div class="receipt-title">Transaction Receipt</div>

          <div class="meta-grid">
            <span class="meta-label">Order #</span>
            <span class="meta-value">${order.id.slice(-6).toUpperCase()}</span>
            <span class="meta-label">Placed</span>
            <span class="meta-value">${placed}</span>
            <span class="meta-label">Paid</span>
            <span class="meta-value">${paidAt}</span>
            <span class="meta-label">Transaction Ref</span>
            <span class="meta-value"><span class="transaction-ref">${transactionRef}</span></span>
          </div>

          <div class="divider"></div>

          <table>
            <thead>
              <tr><th>Item</th><th>Amount</th></tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div class="divider"></div>

          <div class="totals">
            <div class="total-row"><span class="total-label">Subtotal</span><span class="total-value">${subtotal.toLocaleString('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })}</span></div>
            ${discount > 0 ? `<div class="total-row"><span class="total-label">Voucher ${order.voucherCode}</span><span class="total-value">-${discount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })}</span></div>` : ''}
            <div class="total-row"><span class="total-label">Delivery</span><span class="total-value">${delivery === 0 ? 'FREE' : delivery.toLocaleString('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })}</span></div>
            <div class="total-row grand"><span class="total-label">Total</span><span class="total-value">${total.toLocaleString('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })}</span></div>
          </div>

          <div class="address-section">
            <div class="address-label">Delivery Address</div>
            <div class="address-text">${order.deliveryAddress}</div>
          </div>

          <div class="footer">
            <p>Thank you for your order!</p>
            <p>Five-orites Scoop • five-orites-scoop.example.com</p>
          </div>
        </div>
        <script>
          window.onload = function() { window.print(); window.onafterprint = function() { window.close(); }; };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  /**
   * Exports the whole FILTERED queue, not just the visible page.
   *
   * Every other admin export in the app takes the filtered set rather than the
   * rendered slice, and an export that silently drops 40 rows because you were
   * on page 1 of 4 is worse than no export at all.
   */
  async exportCsv(): Promise<void> {
    const rows = [
      [
        'order_id',
        'date',
        'status',
        'customer',
        'items',
        'units',
        'subtotal',
        'discount',
        'delivery',
        'grand_total',
        'address',
      ],
      ...this.filteredOrders().map((o) => [
        o.id,
        toIsoDate(o.createdAt),
        o.status,
        o.customerEmail ?? '',
        (o.items ?? []).map((i) => `${i.variantName} x${i.quantity}`).join(' | '),
        (o.items ?? []).reduce((s, i) => s + i.quantity, 0),
        o.totalAmount ?? 0,
        o.discountAmount ?? 0,
        o.deliveryFee ?? 0,
        o.grandTotal ?? 0,
        o.deliveryAddress ?? '',
      ]),
    ];
    // The success toast is gated on the export actually succeeding. It used to be
    // unconditional, which on a device claimed "Exported N orders" for a write
    // that never happened.
    const result = await this.csvExport.export(toCsv(rows), csvFilename('orders'));
    const count = this.filteredOrders().length;
    void this.toastCtrl
      .create({
        message: result.ok
          ? `Exported ${count} orders.`
          : `Export failed${result.error ? `: ${result.error}` : ''}.`,
        color: result.ok ? 'success' : 'danger',
        duration: 3200,
        position: 'top',
      })
      .then((t) => t.present());
  }
}
