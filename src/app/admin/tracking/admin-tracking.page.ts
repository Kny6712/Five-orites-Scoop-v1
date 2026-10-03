// src/app/admin/tracking/admin-tracking.page.ts
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
// WHY ONLY ORDERS THAT HAVE A RESOLVED ADDRESS
// A pin needs coordinates. An order whose `geo` is missing is listed in the panel
// below the map instead, address text only — geocoding every undelivered order in
// the queue would fire dozens of Nominatim requests at once and get the project
// rate-limited, which is a shared free service. The customer tracker resolves an
// address on demand; this page consumes what that cached.

import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonButton, IonRefresher, IonRefresherContent,
  IonSearchbar, IonSkeletonText,
  AlertController, ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { ScoopMapComponent, type MapMarker } from '../../shared/components/scoop-map/scoop-map.component';
import { OrderStatusBadgeComponent } from '../../shared/components/order-status-badge/order-status-badge.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { PesoPipe } from '../../shared/pipes/peso.pipe';
import { OrderService } from '../../core/services/order.service';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { readCachedGeo, distanceMetres, type GeoPoint } from '../../core/logic/geo';
import { SHOP_LOCATION } from '../../core/config/shop.config';
import { Order, OrderStatus } from '../../core/models/order.model';
import { Subscription, catchError, of } from 'rxjs';

type ActiveStatus = Extract<OrderStatus, 'pending' | 'confirmed' | 'preparing' | 'out_for_delivery'>;

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
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonButton, IonRefresher, IonRefresherContent,
    IonSearchbar, IonSkeletonText,
    AppIconComponent, ScoopMapComponent, OrderStatusBadgeComponent, AlertBannerComponent,
    EmptyStateComponent, PaginationComponent, AppFooterComponent, PesoPipe,
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
    this.orders().filter((o) => ACTIVE_STATUSES.includes(o.status as ActiveStatus))
  );

  /** Active orders whose address has already been resolved to a point. */
  readonly mappedOrders = computed(() =>
    this.activeOrders()
      .map((order) => ({ order, geo: readCachedGeo((order as unknown as { geo?: unknown }).geo) }))
      .filter((entry): entry is { order: Order; geo: GeoPoint } => entry.geo !== null)
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
      .map((entry) => entry.order)
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
    () => this.orders().find((o) => o.id === this.selectedId()) ?? null
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
      const id = order.id.slice(-6).toUpperCase();
      return (
        id.includes(q) ||
        order.customerEmail.toLowerCase().includes(q) ||
        order.deliveryAddress.toLowerCase().includes(q)
      );
    });
  });

  /** True when a filter is active, so the panel can offer a way back. */
  readonly hasFilter = computed(
    () => this.query().trim().length > 0 || this.statusFilter() !== 'all'
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
    return this.visibleOrders().slice(start, start + this.PAGE_SIZE);
  });

  onPageChange(next: number): void {
    this.page.set(next);
    // Selection is page-scoped state here: an expanded detail panel for a row
    // that is no longer on screen is invisible state.
    this.selectedId.set(null);
  }

  /** Orders that are in the queue but hidden by the current filter. */
  readonly hiddenCount = computed(
    () => this.activeOrders().length - this.visibleOrders().length
  );

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
        })
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
        })
      )
      .subscribe((orders) => {
        this.orders.set(orders);
        this.truncated.set(orders.length >= this.ORDERS_MAX);
        this.isLoading.set(false);
      });
  }

  distanceFor(order: Order): string {
    const geo = readCachedGeo((order as unknown as { geo?: unknown }).geo);
    if (!geo) return '—';
    const m = distanceMetres(SHOP_LOCATION, { lat: geo.lat, lng: geo.lng });
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
              await this.toast.create({
                message: `Order updated to "${STATUS_LABEL[next]}"`,
                color: 'success',
                duration: 2000,
                position: 'top',
              }).then((t) => t.present());
            } catch (err) {
              await this.toast.create({
                message: err instanceof Error ? err.message : 'Could not update the order.',
                color: 'danger',
                duration: 3000,
                position: 'top',
              }).then((t) => t.present());
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
