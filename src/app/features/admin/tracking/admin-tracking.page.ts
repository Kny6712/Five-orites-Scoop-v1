// src/app/features/admin/tracking/admin-tracking.page.ts
// Five-orites Scoop — Admin map of every active order, with status control
//
// WHAT THIS SHOWS, HONESTLY
// Every order that is still moving, pinned at its delivery destination, plus the
// shop. Tapping a pin advances that order's status, reusing OrderService — the
// same call Fulfillment makes, so there is one code path for a status change and
// no chance of the two disagreeing.
//
// There is no live courier position in this system, and none is invented here. The
// map shows where orders are GOING, not where riders are. See the courier note on
// the customer tracker for the same reasoning.
//
// THE ROUTE, NOT A SECOND QUEUE
// This page and Fulfillment both list orders, and for a while they were the same
// list twice: the same query, the same newest-first order, the same Items and
// Value columns, the same search over the same fields.
//
// They are not the same job, and the system already says so. Fulfillment is a
// QUEUE — newest first, because the question is "what is next to make", and it
// is the only page that shows the customer, the items, the total and the date.
// This page is a ROUTE — nearest first, because the question is "what is next to
// deliver", and it is the only page that shows the map, the address and the
// distance.
//
// So the columns Fulfillment owns were removed here, and the list is ordered by
// distance from the shop. The distance was always computed and always shown; it
// just never decided anything.
//
// WHY ONLY ORDERS THAT HAVE A RESOLVED ADDRESS
// A pin needs coordinates. An order whose `geo` is missing is listed in the panel
// below the map instead, address text only — geocoding every undelivered order in
// the queue would fire dozens of Nominatim requests at once and get the project
// rate-limited, which is a shared free service. The customer tracker resolves an
// address on demand; this page consumes what that cached.

import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
  IonSkeletonText,
  IonPopover,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { ScoopMapComponent, type MapMarker } from '@shared/components/commerce/scoop-map.component';
import { OrderStatusBadgeComponent } from '@shared/components/commerce/order-status-badge.component';
import { AlertBannerComponent } from '@shared/components/ui/alert-banner.component';
import { EmptyStateComponent } from '@shared/components/ui/empty-state.component';
import { PaginationComponent } from '@shared/components/ui/pagination.component';
import { AdminFooterComponent } from '@shared/components/admin/admin-footer.component';
import { OrderService } from '@core/services/orders/order.service';
import { describeFirestoreError } from '@core/logic/firestore-error';
import { readCachedGeo, distanceMetres, type GeoPoint } from '@core/logic/geo';
import { SHOP_LOCATION } from '@core/config/shop.config';
import { Order, OrderStatus } from '@core/models/order.model';
import { Subscription, catchError, of } from 'rxjs';

type ActiveStatus = Extract<
  OrderStatus,
  'pending' | 'confirmed' | 'preparing' | 'out_for_delivery'
>;

const ACTIVE_STATUSES: ActiveStatus[] = ['pending', 'confirmed', 'preparing', 'out_for_delivery'];

/** The statuses a pin can advance to, mirroring Fulfillment's single-step flow. */
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'out_for_delivery',
  out_for_delivery: 'delivered',
};

@Component({
  selector: 'app-admin-tracking',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonMenuButton,
    IonRefresher,
    IonRefresherContent,
    IonSearchbar,
    IonSkeletonText,
    IonPopover,
    AppIconComponent,
    ScoopMapComponent,
    OrderStatusBadgeComponent,
    AlertBannerComponent,
    EmptyStateComponent,
    PaginationComponent,
    AdminFooterComponent,
  ],
  templateUrl: './admin-tracking.page.html',
  styleUrls: ['./admin-tracking.page.scss'],
})
export class AdminTrackingPage implements OnInit, OnDestroy {
  private orderService = inject(OrderService);
  private alertCtrl = inject(AlertController);
  private toast = inject(ToastController);
  private sub?: Subscription;

  orders = signal<Order[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');
  busyId = signal<string | null>(null);
  selectedId = signal<string | null>(null);

  readonly shop = SHOP_LOCATION;

  /** Every order still in the shop or on the road. */
  readonly activeOrders = computed(() =>
    this.orders().filter((o) => ACTIVE_STATUSES.includes(o.status as ActiveStatus)),
  );

  /** Active orders whose address has already been resolved to a point. */
  readonly mappedOrders = computed(() =>
    this.activeOrders()
      .map((order) => ({ order, geo: readCachedGeo((order as unknown as { geo?: unknown }).geo) }))
      .filter((entry): entry is { order: Order; geo: GeoPoint } => entry.geo !== null),
  );

  /**
   * Active orders with no cached point.
   *
   * Listed rather than hidden: an order staff cannot see on the map is an order
   * they may not think to prepare.
   */
  readonly unmappedOrders = computed(() =>
    this.activeOrders()
      .map((order) => ({ order, geo: readCachedGeo((order as unknown as { geo?: unknown }).geo) }))
      .filter((entry) => entry.geo === null)
      .map((entry) => entry.order),
  );

  readonly mapMarkers = computed<MapMarker[]>(() => {
    const markers: MapMarker[] = [
      {
        id: 'shop',
        lat: SHOP_LOCATION.lat,
        lng: SHOP_LOCATION.lng,
        label: SHOP_LOCATION.name,
        detail: 'The shop',
        tone: 'sunny',
      },
    ];
    for (const { order, geo } of this.mappedOrders()) {
      markers.push({
        id: order.id,
        lat: geo.lat,
        lng: geo.lng,
        label: `#${order.id.slice(-6).toUpperCase()}`,
        detail: order.deliveryAddress,
        tone: order.status === 'out_for_delivery' ? 'mint' : 'primary',
        tappable: true,
      });
    }
    return markers;
  });

  readonly selectedOrder = computed(
    () => this.orders().find((o) => o.id === this.selectedId()) ?? null,
  );

  // ── Search & status filter ────────────────────────────────────────────────
  /* There was no search on this page at all: the only controls were "tap a pin"
     and "tap a row". With 20+ active orders that means scrolling a list to find
     one, and the map gives no way to find an order whose pin is off-screen or
     clustered under another.

     The filter runs over the ACTIVE set only — the page's actual subject — and
     matches id, customer email and address text, which between them cover the
     three things staff know an order by. */
  readonly query = signal('');
  readonly statusFilter = signal<ActiveStatus | 'all'>('all');

  readonly statusOptions: { label: string; value: ActiveStatus | 'all' }[] = [
    { label: 'All', value: 'all' },
    { label: 'Placed', value: 'pending' },
    { label: 'Confirmed', value: 'confirmed' },
    { label: 'Preparing', value: 'preparing' },
    { label: 'Out', value: 'out_for_delivery' },
  ];

  /**
   * What the dropdown's trigger says.
   *
   * The chosen status, so the control says where it is without being opened —
   * and "All" when nothing is chosen, which is the filter's own name for
   * "no status filter" rather than a separate option.
   */
  readonly statusFilterLabel = computed(
    () => this.statusOptions.find((o) => o.value === this.statusFilter())?.label ?? 'All',
  );

  /**
   * Whether the status popover is open.
   *
   * A MIRROR of the overlay's real state, not a driver of it: it is set true by
   * `didPresent` and false by `didDismiss`, so it can never claim to be open
   * while nothing is open. The same arrangement the fulfilment queue's filter
   * uses.
   */
  readonly statusFilterPopoverOpen = signal(false);

  /** Opens the status filter popover (driven by the button's `trigger`). */
  openStatusFilterPopover(): void {
    this.statusFilterPopoverOpen.set(true);
  }

  closeStatusFilterPopover(): void {
    this.statusFilterPopoverOpen.set(false);
  }

  /**
   * Active orders, narrowed by the status chip and the search box.
   *
   * A filter that also cleared the map would be actively harmful: a search that
   * removes pins is a search that makes it harder to see where the orders are.
   * The map keeps every active order, and only the LIST is narrowed — so a search
   * highlights in the list without hiding anything on the map.
   */
  readonly visibleOrders = computed(() => {
    const status = this.statusFilter();
    const q = this.query().trim().toLowerCase();

    return this.activeOrders().filter((order) => {
      if (status !== 'all' && order.status !== status) return false;
      if (!q) return true;
      /* The id is lowercased to MATCH the query, not uppercased for display.

         It used to be `order.id.slice(-6).toUpperCase()`, against a query that
         is already lowercased — so "RACKG1".includes("rackg1") was false and
         the id could not be found AT ALL, at any case. The admin sees #RACKG1
         in the Order column and types it, and gets nothing back.

         The id is DISPLAYED uppercased by the template, which is a
         presentation decision and lives there; matching is a case-folded
         operation and belongs here. The fulfilment queue's search gets this
         right already — `o.id.toLowerCase().includes(q)`. */
      const id = order.id.slice(-6).toLowerCase();
      return (
        id.includes(q) ||
        order.customerEmail.toLowerCase().includes(q) ||
        order.deliveryAddress.toLowerCase().includes(q)
      );
    });
  });

  /**
   * THE ROUTE, and this is what stops this page being a second fulfilment queue.
   *
   * Both pages used to order their rows the same way, because both read the
   * same Firestore query — `orderBy('createdAt','desc')` — and this list simply
   * filtered it. Two pages, one ordering, one object: the admin could not tell
   * them apart by what they showed.
   *
   * Fulfillment is a QUEUE and is newest-first: "what is next to make". This
   * page is a ROUTE and is nearest-first: "what is next to deliver". The
   * distance was always computed and always displayed — it just never decided
   * the ORDER of anything.
   *
   * THE ORDERS WITH NO PIN GO LAST, because they cannot be distance-ordered at
   * all: they are not stops yet. They are still listed, still flagged, and
   * still advanceable — they are simply not pretending to be on the route.
   *
   * The sort is STABLE, so two stops at the same distance keep the order the
   * query gave them (newest first) instead of shuffling between renders.
   */
  readonly routeOrders = computed(() => {
    const list = [...this.visibleOrders()];
    return list.sort((a, b) => {
      const da = this.distanceOf(a);
      const db = this.distanceOf(b);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });
  });

  /** True when a filter is active, so the panel can offer a way back. */
  readonly hasFilter = computed(
    () => this.query().trim().length > 0 || this.statusFilter() !== 'all',
  );

  onQuery(event: CustomEvent): void {
    this.query.set((event.detail.value ?? '') as string);
    this.page.set(1);
  }

  onStatusFilter(value: ActiveStatus | 'all'): void {
    this.statusFilter.set(value);
    this.page.set(1);
  }

  clearFilters(): void {
    this.query.set('');
    this.statusFilter.set('all');
    this.page.set(1);
  }

  /**
   * Ids that matched the current filter, for highlighting.
   *
   * Returned as a Set because the map and the table both read it on every
   * change-detection pass; rebuilding a Set per call would allocate on each one.
   */
  readonly visibleIds = computed(() => new Set(this.visibleOrders().map((o) => o.id)));

  /** True when the order is hidden by the current filter, not merely unselected. */
  isFilteredOut(order: Order): boolean {
    return this.hasFilter() && !this.visibleIds().has(order.id);
  }

  // ── Paging ────────────────────────────────────────────────────────────────
  readonly PAGE_SIZE = 10;
  readonly page = signal(1);

  readonly pagedVisibleOrders = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.routeOrders().slice(start, start + this.PAGE_SIZE);
  });

  onPageChange(next: number): void {
    this.page.set(next);
    // Selection is page-scoped state here: an expanded detail panel for a row
    // that is no longer on screen is invisible state.
    this.selectedId.set(null);
  }

  /** Orders that are in the queue but hidden by the current filter. */
  readonly hiddenCount = computed(() => this.activeOrders().length - this.visibleOrders().length);

  /**
   * Whether the order read hit its cap, so staff know the list is incomplete.
   *
   * This page previously fetched 200 orders and said nothing about it, unlike
   * Fulfillment (300) and Analytics (500), which both disclose theirs. A map
   * that silently omits orders is worse than a list that does.
   */
  readonly ORDERS_MAX = 200;
  readonly truncated = signal(false);

  ngOnInit(): void {
    this.sub = this.orderService
      .getAllOrders(undefined, this.ORDERS_MAX)
      .pipe(
        catchError((err: unknown) => {
          this.errorMessage.set(describeFirestoreError('orders', err));
          return of<Order[]>([]);
        }),
      )
      .subscribe((orders) => {
        this.orders.set(orders);
        this.truncated.set(orders.length >= this.ORDERS_MAX);
        this.isLoading.set(false);
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  onMarkerTapped(marker: MapMarker): void {
    if (marker.id !== 'shop') this.selectedId.set(marker.id);
  }

  /**
   * Select an order from the table.
   *
   * Selecting something the filter is currently hiding would be confusing — the
   * detail card would appear for a row that is not on screen — so an excluded
   * order clears the filter instead of being selected silently.
   */
  select(order: Order): void {
    if (this.isFilteredOut(order)) this.clearFilters();
    this.selectedId.set(this.selectedId() === order.id ? null : order.id);
  }

  /** Total units on an order, for the Items column. */
  itemCount(order: Order): number {
    return order.items.reduce((sum, i) => sum + i.quantity, 0);
  }

  reload(): void {
    this.errorMessage.set('');
    this.orders.set([]);
    this.isLoading.set(true);
    this.sub?.unsubscribe();
    this.sub = this.orderService
      .getAllOrders(undefined, this.ORDERS_MAX)
      .pipe(
        catchError((err: unknown) => {
          this.errorMessage.set(describeFirestoreError('orders', err));
          return of<Order[]>([]);
        }),
      )
      .subscribe((orders) => {
        this.orders.set(orders);
        this.truncated.set(orders.length >= this.ORDERS_MAX);
        this.isLoading.set(false);
      });
  }

  /**
   * Metres from the shop, or null when the address has never been resolved.
   *
   * NULL, NOT ZERO, and not a dash. The distance is what orders the route, so
   * an unresolved address has to be distinguishable from one that happens to
   * be at the shop — and the row has to be able to say WHICH of the two it is.
   */
  distanceOf(order: Order): number | null {
    const geo = readCachedGeo((order as unknown as { geo?: unknown }).geo);
    if (!geo) return null;
    return distanceMetres(SHOP_LOCATION, { lat: geo.lat, lng: geo.lng });
  }

  /**
   * "2.4 km" — or null when the order has no location yet.
   *
   * Null rather than a dash, because the caller has two genuinely different
   * things to say about an order without a location: the route puts it last,
   * and the row flags it. A dash said neither.
   */
  distanceLabel(order: Order): string | null {
    const m = this.distanceOf(order);
    if (m === null) return null;
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  }

  nextLabel(order: Order): string {
    const next = NEXT_STATUS[order.status];
    return next ? `Mark as ${STATUS_LABEL[next]}` : 'No further step';
  }

  canAdvance(order: Order): boolean {
    return NEXT_STATUS[order.status] !== undefined;
  }

  /**
   * Advance an order's status.
   *
   * `event` is taken and stopped deliberately. The advance control used to live
   * inside a row that itself had a click handler, so every tap on the button
   * also selected the row and re-rendered the selected card — the "unintended
   * interaction" this page had. Each control now does exactly one thing.
   */
  async advance(event: Event, order: Order): Promise<void> {
    event.stopPropagation();
    const next = NEXT_STATUS[order.status];
    if (!next) return;

    const alert = await this.alertCtrl.create({
      header: 'Advance this order?',
      message: `Mark #${order.id.slice(-6).toUpperCase()} as "${STATUS_LABEL[next]}"? The customer is notified on their device.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Advance',
          handler: async () => {
            this.busyId.set(order.id);
            try {
              await this.orderService.updateOrderStatus(order.id, next);
              await this.toast
                .create({
                  message: `Order updated to "${STATUS_LABEL[next]}"`,
                  color: 'success',
                  duration: 2000,
                  position: 'top',
                })
                .then((t) => t.present());
            } catch (err) {
              await this.toast
                .create({
                  message: err instanceof Error ? err.message : 'Could not update the order.',
                  color: 'danger',
                  duration: 3000,
                  position: 'top',
                })
                .then((t) => t.present());
            } finally {
              this.busyId.set(null);
            }
          },
        },
      ],
    });
    await alert.present();
  }

  handleRefresh(event: CustomEvent): void {
    // A real reload, not just a spinner. The order list is a live query, but a
    // pull-to-refresh that only spun was a control that appeared to do nothing.
    this.reload();
    setTimeout(() => (event.target as HTMLIonRefresherElement).complete(), 900);
  }
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Order Placed',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
