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
  IonSkeletonText,
  AlertController, ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { ScoopMapComponent, type MapMarker } from '../../shared/components/scoop-map/scoop-map.component';
import { OrderStatusBadgeComponent } from '../../shared/components/order-status-badge/order-status-badge.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
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
    IonSkeletonText,
    AppIconComponent, ScoopMapComponent, OrderStatusBadgeComponent, AlertBannerComponent,
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

  ngOnInit(): void {
    this.sub = this.orderService
      .getAllOrders(undefined, 200)
      .pipe(
        catchError((err: unknown) => {
          this.errorMessage.set(describeFirestoreError('orders', err));
          return of<Order[]>([]);
        })
      )
      .subscribe((orders) => {
        this.orders.set(orders);
        this.isLoading.set(false);
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  onMarkerTapped(marker: MapMarker): void {
    if (marker.id !== 'shop') this.selectedId.set(marker.id);
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

  async advance(order: Order): Promise<void> {
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
    (event.target as HTMLIonRefresherElement).complete();
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
