// src/app/features/orders/order-tracker/order-tracker.page.ts
// Five-orites Scoop — Real-Time Order Status Tracker
// Author: Five-orites Scoop team (see README)

import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonText,
  IonSkeletonText, IonChip, IonLabel, IonCard, IonCardContent,
  IonButton, AlertController, ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { ScoopMapComponent, type MapMarker } from '../../../shared/components/scoop-map/scoop-map.component';
import { Subscription, catchError, of } from 'rxjs';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { OrderService } from '../../../core/services/order.service';
import { Order, OrderStatus, ORDER_STATUS_META } from '../../../core/models/order.model';
import { OrderStatusBadgeComponent } from '../../../shared/components/order-status-badge/order-status-badge.component';
import { AppFooterComponent } from '../../../shared/components/app-footer/app-footer.component';
import { CartButtonComponent } from '../../../shared/components/cart-button/cart-button.component';
import { PesoPipe } from '../../../shared/pipes/peso.pipe';
import { SIZE_DISPLAY_LABELS } from '../../../core/config/pricing.config';
import { SHOP_LOCATION } from '../../../core/config/shop.config';
import {
  geocodeAddress, readCachedGeo, interpolate, distanceMetres, type GeoPoint,
} from '../../../core/logic/geo';

const STATUS_SEQUENCE: OrderStatus[] = [
  'pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];

@Component({
  selector: 'app-order-tracker',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonBackButton, IonText, IonSkeletonText,
    IonChip, IonLabel, IonCard, IonCardContent, IonButton,
    OrderStatusBadgeComponent, PesoPipe, CartButtonComponent,
    AppIconComponent, ScoopMapComponent, AppFooterComponent],
  templateUrl: './order-tracker.page.html',
  styleUrls: ['./order-tracker.page.scss'],
})
export class OrderTrackerPage implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private orderService = inject(OrderService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private firestore = inject(Firestore);
  private sub?: Subscription;

  order = signal<Order | null>(null);
  isLoading = signal(true);
  errorMessage = signal('');
  isCancelling = signal(false);

  readonly sizeLabels = SIZE_DISPLAY_LABELS;
  readonly statusSequence = STATUS_SEQUENCE;
  readonly statusMeta = ORDER_STATUS_META;
  readonly shopMapsUrl = SHOP_LOCATION.mapsUrl;

  isCancelled = computed(() => this.order()?.status === 'cancelled');

  // ── Map ────────────────────────────────────────────────────────────────────
  /**
   * The resolved destination, read from the order's cached `geo` first.
   *
   * The cache matters for two reasons beyond latency: Nominatim's policy requires
   * results to be cached, and a customer's street address should be sent to a
   * third party once rather than on every page open.
   */
  private readonly destination = signal<GeoPoint | null>(null);
  readonly isGeocoding = signal(false);
  readonly geoUnavailable = signal(false);

  /**
   * 0–1 progress along the route, derived from the order status.
   *
   * There is NO live courier position anywhere in this app — no driver app, no
   * geolocation writes, nothing. So this is explicitly a stage indicator along the
   * shop-to-customer line, not a simulated GPS trace. Rendering a marker that
   * glides smoothly along a straight line would look like live tracking and be
   * invented; snapping it to a fixed point per status is honest about what is
   * actually known.
   */
  readonly courierProgress = computed<number | null>(() => {
    switch (this.order()?.status) {
      case 'out_for_delivery':
        return 0.5;
      case 'delivered':
        return 1;
      default:
        return null;
    }
  });

  readonly mapRoute = computed(() => {
    const dest = this.destination();
    if (!dest) return null;
    return { from: SHOP_LOCATION, to: { lat: dest.lat, lng: dest.lng } };
  });

  readonly mapMarkers = computed<MapMarker[]>(() => {
    const dest = this.destination();
    const markers: MapMarker[] = [
      {
        id: 'shop',
        lat: SHOP_LOCATION.lat,
        lng: SHOP_LOCATION.lng,
        label: SHOP_LOCATION.name,
        detail: 'Where we scoop your order',
        tone: 'sunny',
      },
    ];

    if (!dest) return markers;

    markers.push({
      id: 'destination',
      lat: dest.lat,
      lng: dest.lng,
      label: 'Delivery address',
      detail: this.order()?.deliveryAddress ?? dest.label,
      tone: 'mint',
    });

    // Only while actually in transit. Once delivered, the destination marker IS
    // where the order is, so a second marker would be noise.
    const t = this.courierProgress();
    if (t !== null && t > 0 && t < 1) {
      const point = interpolate(SHOP_LOCATION, { lat: dest.lat, lng: dest.lng }, t);
      markers.push({
        id: 'courier',
        lat: point.lat,
        lng: point.lng,
        label: 'Your order',
        detail: 'Out for delivery',
        tone: 'primary',
      });
    }
    return markers;
  });

  readonly courierDistanceLabel = computed(() => {
    const dest = this.destination();
    if (!dest) return '';
    const metres = distanceMetres(SHOP_LOCATION, { lat: dest.lat, lng: dest.lng });
    return metres < 1000
      ? `${Math.round(metres)} m`
      : `${(metres / 1000).toFixed(1)} km`;
  });

  /**
   * Resolves the delivery address to a point, once.
   *
   * Reads the cache first; only calls the geocoder when there is nothing usable.
   * The result is then written back to the order so the next visit — and the
   * admin's map — sees it too. `merge: true` is essential: the order already has
   * items, totals and a status history, and a non-merged write would replace the
   * whole document.
   */
  private async ensureDestination(order: Order): Promise<void> {
    const cached = readCachedGeo((order as unknown as { geo?: unknown }).geo);
    if (cached) {
      this.destination.set(cached);
      return;
    }

    this.isGeocoding.set(true);
    const point = await geocodeAddress(order.deliveryAddress);
    this.isGeocoding.set(false);

    if (!point) {
      this.geoUnavailable.set(true);
      return;
    }

    this.destination.set(point);
    try {
      await setDoc(
        doc(this.firestore, `orders/${order.id}`),
        { geo: { lat: point.lat, lng: point.lng, label: point.label, at: point.at } },
        { merge: true }
      );
    } catch (err) {
      // The map works from memory either way; failing to cache only means the
      // next visit re-geocodes. Not worth surfacing to the customer.
      console.warn('Could not cache the geocode on the order', err);
    }
  }


  ngOnInit(): void {
    const orderId = this.route.snapshot.paramMap.get('id');
    if (!orderId) {
      this.errorMessage.set('Order not found.');
      this.isLoading.set(false);
      return;
    }

    this.sub = this.orderService
      .trackOrder(orderId)
      .pipe(catchError(() => {
        this.errorMessage.set('Could not load order. Please try again.');
        return of(null);
      }))
      .subscribe((order) => {
        if (order) {
          // Status toasts are NOT fired here. OrderNotificationService already
          // watches this user's orders app-wide, so keeping a second
          // notification path on this page would show every change twice for
          // anyone with the tracker open.
          const previous = this.order();
          this.order.set(order);
          // Resolve the destination once per order. onSnapshot re-emits on every
          // status change, and geocoding is rate-limited to 1 req/sec — so this
          // guard is what stops a status change from triggering another lookup.
          if (previous?.id !== order.id) {
            void this.ensureDestination(order);
          }
        }
        this.isLoading.set(false);
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  canCancel(): boolean {
    return this.order()?.status === 'pending' && !this.isCancelling();
  }

  async cancelOrder(): Promise<void> {
    const order = this.order();
    if (!order || order.status !== 'pending') return;
    const alert = await this.alertCtrl.create({
      header: 'Cancel Order',
      message: 'Cancel this order? Stock will be restored.',
      inputs: [{ name: 'reason', type: 'text', placeholder: 'Reason (optional)' }],
      buttons: [
        { text: 'Back', role: 'cancel' },
        {
          text: 'Cancel Order',
          role: 'destructive',
          handler: async (data) => {
            this.isCancelling.set(true);
            try {
              await this.orderService.cancelOrder(order.id, data?.reason);
              const toast = await this.toastCtrl.create({
                message: 'Order cancelled. Stock restored.',
                color: 'warning', duration: 2500, position: 'top',
              });
              await toast.present();
            } catch (err) {
              const toast = await this.toastCtrl.create({
                message: err instanceof Error ? err.message : 'Failed to cancel order.',
                color: 'danger', duration: 3000, position: 'top',
              });
              await toast.present();
            } finally {
              this.isCancelling.set(false);
            }
          },
        }],
    });
    await alert.present();
  }

  getStepState(step: OrderStatus): 'completed' | 'active' | 'upcoming' {
    const current = this.order()?.status;
    if (!current || current === 'cancelled') return 'upcoming';
    const currentIdx = STATUS_SEQUENCE.indexOf(current);
    const stepIdx = STATUS_SEQUENCE.indexOf(step);
    if (stepIdx < currentIdx) return 'completed';
    if (stepIdx === currentIdx) return 'active';
    return 'upcoming';
  }

  getStepTimestamp(step: OrderStatus): string {
    const history = this.order()?.statusHistory ?? [];
    const entry = history.find((h) => h.status === step);
    if (!entry) return '';
    try {
      const ts = entry.timestamp as unknown as { toDate(): Date } | string;
      const date = typeof ts === 'string' ? new Date(ts) : ts.toDate();
      return date.toLocaleTimeString('en-PH', {
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  formatDate(timestamp: unknown): string {
    try {
      if (timestamp === null || timestamp === undefined) return '—';
      const ts = timestamp as { toDate(): Date } | string;
      const date = typeof ts === 'string' ? new Date(ts) : ts.toDate();
      return date.toLocaleDateString('en-PH', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }
}
