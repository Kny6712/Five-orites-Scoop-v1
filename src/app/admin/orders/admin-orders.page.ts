// src/app/admin/orders/admin-orders.page.ts
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
  IonSelect,
  IonSelectOption,
  IonSkeletonText,
  IonRefresher,
  IonRefresherContent,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { OrderService } from '../../core/services/order.service';
import { Order, OrderStatus, ORDER_STATUS_META } from '../../core/models/order.model';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { toCsv, csvFilename, toIsoDate } from '../../core/logic/csv';
import { CsvExportService } from '../../core/services/csv-export.service';
import { OrderStatusBadgeComponent } from '../../shared/components/order-status-badge/order-status-badge.component';
import { PesoPipe } from '../../shared/pipes/peso.pipe';
import { SIZE_DISPLAY_LABELS } from '../../core/config/pricing.config';

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
    IonSelect,
    IonSelectOption,
    IonSkeletonText,
    IonRefresher,
    IonRefresherContent,
    OrderStatusBadgeComponent,
    PesoPipe,
    PaginationComponent,
    AppFooterComponent,
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
  selectedFilter = signal<OrderStatus | 'all'>('all');
  isLoading = signal(true);
  /** Non-empty when the order list failed to load, as opposed to being empty. */
  loadError = signal('');
  /** True when the queue read hit ORDERS_QUEUE_MAX, so older orders are hidden. */
  truncated = signal(false);
  updatingId = signal<string | null>(null);
  expandedId = signal<string | null>(null);

  readonly sizeLabels = SIZE_DISPLAY_LABELS;
  readonly statusMeta = ORDER_STATUS_META;
  readonly nextStatus = NEXT_STATUS;

  readonly filterOptions: { label: string; value: OrderStatus | 'all' }[] = [
    { label: 'All', value: 'all' },
    { label: 'Pending', value: 'pending' },
    { label: 'Confirmed', value: 'confirmed' },
    { label: 'Preparing', value: 'preparing' },
    { label: 'Delivery', value: 'out_for_delivery' },
    { label: 'Done', value: 'delivered' },
    // Cancelled was missing from this list, so a cancelled order could only be
    // found under "All" — which is exactly the list that goes incomplete once
    // the shop passes the 100-order read cap.
    { label: 'Cancelled', value: 'cancelled' },
  ];

  /**
   * Free-text search across id, customer, address and item names.
   *
   * The tracking page has had one all along and fulfilment did not, which made
   * the two admin queues answer the same question ("where is order ABC123?")
   * differently depending on which one you happened to open. Both now do the same
   * thing, so the answer does not depend on the page.
   *
   * Client-side on purpose: the queue is already an in-memory array capped at
   * ORDERS_QUEUE_MAX, so a Firestore `where`/`orderBy` would need a composite
   * index and would still not cover a substring of an address.
   */
  search = signal('');
  query = signal('');

  onSearch(value: string | null | undefined): void {
    this.search.set(value ?? '');
    this.page.set(1);
  }

  /** Order ids for bulk actions — survives a filter change. */
  private readonly selectedIds = signal<ReadonlySet<string>>(new Set<string>());

  isSelected(orderId: string): boolean {
    return this.selectedIds().has(orderId);
  }

  selectedCount = computed(() => this.selectedIds().size);

  toggleSelected(orderId: string): void {
    const next = new Set(this.selectedIds());
    if (next.has(orderId)) next.delete(orderId);
    else next.add(orderId);
    this.selectedIds.set(next);
  }

  selectAllOnPage(): void {
    const next = new Set(this.selectedIds());
    for (const o of this.pagedOrders()) next.add(o.id);
    this.selectedIds.set(next);
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  filteredOrders = computed(() => {
    const filter = this.selectedFilter();
    const q = this.query().trim().toLowerCase();

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

  /**
   * Stock only comes back for an order that never left the shop, so cancelling
   * a dispatched order is allowed but must not read as a restock. The service
   * enforces this; the button is hidden to avoid offering an action whose
   * inventory side effect differs from what the label implies.
   */
  canCancel(order: Order): boolean {
    return (
      order.status !== 'delivered' &&
      order.status !== 'cancelled' &&
      order.status !== 'out_for_delivery'
    );
  }

  onFilterChange(event: CustomEvent): void {
    this.selectedFilter.set(event.detail.value);
    this.expandedId.set(null);
    // A status change usually shrinks the result set. Without this the page can
    // be left on, say, page 4 of a list that now has 2 pages, showing nothing.
    this.page.set(1);
  }

  toggleExpand(orderId: string): void {
    this.expandedId.set(this.expandedId() === orderId ? null : orderId);
  }

  getNextStatusLabel(status: OrderStatus): string {
    const next = NEXT_STATUS[status];
    return next ? ORDER_STATUS_META[next].label : '';
  }

  async advanceStatus(order: Order): Promise<void> {
    const next = NEXT_STATUS[order.status];
    if (!next) return;

    const alert = await this.alertCtrl.create({
      header: 'Advance Order',
      message: `Mark order #${order.id.slice(-6).toUpperCase()} as "${ORDER_STATUS_META[next].label}"?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          handler: async () => {
            this.updatingId.set(order.id);
            try {
              await this.orderService.updateOrderStatus(order.id, next);
              // No customer notification here: this is the ADMIN's device. The
              // owner's device is notified by OrderNotificationService, which
              // watches their own orders.
              const toast = await this.toastCtrl.create({
                message: `Order updated to "${ORDER_STATUS_META[next].label}"`,
                color: 'success',
                duration: 2000,
                position: 'top',
              });
              await toast.present();
            } catch {
              const toast = await this.toastCtrl.create({
                message: 'Failed to update order status.',
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
   * Every status an order can legally be moved to, for the free-form picker.
   *
   * `delivered` and `cancelled` are reachable here for the first time. Before,
   * the only way to mark an order delivered was to step through
   * pending → confirmed → preparing → out_for_delivery → delivered, which is
   * correct for the happy path and wrong for a shop that takes a phone order and
   * hands it straight over. Both remain reachable by the normal button, so this
   * adds a route rather than replacing one.
   *
   * A status is excluded when it is where the order already is — offering
   * "mark as Delivered" on a delivered order is a no-op that looks like a
   * failure.
   */
  statusOptionsFor(order: Order): readonly OrderStatus[] {
    return ALL_STATUSES.filter((s) => s !== order.status);
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
   * Advances every selected order in one go.
   *
   * Deliberately sequential rather than parallel: `updateOrderStatus` appends to
   * `statusHistory` and each write re-reads the document, so firing them at once
   * would have several transactions racing on the same doc. Sequential is slower
   * and correct, which is the right trade for a button an admin taps once.
   *
   * Cancelling is NOT offered in bulk — it restores stock, and doing that to 30
   * orders by accident is not a mistake worth supporting.
   */
  async bulkAdvance(target: OrderStatus): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length || target === 'cancelled') return;

    const alert = await this.alertCtrl.create({
      header: `Move ${ids.length} order${ids.length === 1 ? '' : 's'}`,
      message: `Mark all ${ids.length} selected as "${ORDER_STATUS_META[target].label}"?`,
      buttons: [
        { text: 'Back', role: 'cancel' },
        {
          text: 'Confirm',
          handler: async () => {
            let ok = 0;
            const failed: string[] = [];
            for (const id of ids) {
              this.updatingId.set(id);
              try {
                await this.orderService.updateOrderStatus(id, target);
                ok++;
              } catch {
                failed.push(id.slice(-6).toUpperCase());
              } finally {
                this.updatingId.set(null);
              }
            }
            this.clearSelection();
            const t = await this.toastCtrl.create({
              message: failed.length
                ? `${ok} updated, ${failed.length} failed: ${failed.slice(0, 3).join(', ')}`
                : `${ok} order${ok === 1 ? '' : 's'} marked "${ORDER_STATUS_META[target].label}".`,
              color: failed.length ? 'warning' : 'success',
              duration: 3200,
              position: 'top',
            });
            await t.present();
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
