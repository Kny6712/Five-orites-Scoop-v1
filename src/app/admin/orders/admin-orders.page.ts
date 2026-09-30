// src/app/admin/orders/admin-orders.page.ts
// Five-orites Scoop — Admin Order Fulfillment Dashboard
// Author: Five-orites Scoop team (see README)

import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton,
  IonSegment, IonSegmentButton, IonLabel,
  IonCard, IonCardContent, IonButton, IonText,
  IonSkeletonText, IonRefresher, IonRefresherContent,
  IonChip, IonBadge, AlertController, ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { Subscription, catchError, of } from 'rxjs';
import { OrderService } from '../../core/services/order.service';
import { Order, OrderStatus, ORDER_STATUS_META } from '../../core/models/order.model';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { OrderStatusBadgeComponent } from '../../shared/components/order-status-badge/order-status-badge.component';
import { CartButtonComponent } from '../../shared/components/cart-button/cart-button.component';
import { PesoPipe } from '../../shared/pipes/peso.pipe';
import { SIZE_DISPLAY_LABELS } from '../../core/config/pricing.config';

/**
 * How many orders the fulfillment queue reads.
 *
 * This is a WORKING QUEUE, not a report: an order the staff cannot see is an
 * order they never prepare. The old 100-order default was small enough that a
 * busy shop would quietly lose its backlog. `truncated` in the template warns
 * if this is ever reached.
 */
const ORDERS_QUEUE_MAX = 300;

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'out_for_delivery',
  out_for_delivery: 'delivered',
};

@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton,
    IonSegment, IonSegmentButton, IonLabel,
    IonCard, IonCardContent, IonButton, IonText,
    IonSkeletonText, IonRefresher, IonRefresherContent,
    IonChip, IonBadge,
    OrderStatusBadgeComponent, PesoPipe, CartButtonComponent,
    AppIconComponent, EmptyStateComponent, AlertBannerComponent],
  templateUrl: './admin-orders.page.html',
  styleUrls: ['./admin-orders.page.scss'],
})
export class AdminOrdersPage implements OnInit, OnDestroy {
  private orderService = inject(OrderService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private sub?: Subscription;

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
    { label: 'Cancelled', value: 'cancelled' }];

  filteredOrders = computed(() => {
    const filter = this.selectedFilter();
    if (filter === 'all') return this.allOrders();
    return this.allOrders().filter((o) => o.status === filter);
  });

  skeletonItems = Array(5).fill(0);


  ngOnInit(): void { this.loadOrders(); }
  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  loadOrders(): void {
    this.isLoading.set(true);
    this.loadError.set('');
    this.sub?.unsubscribe();
    // A dedicated cap, not the 100-order default: fulfillment is a working
    // queue, not a report, and an order the staff cannot see is one they never
    // prepare. The analytics page is the read that reports its own cap.
    this.sub = this.orderService.getAllOrders(undefined, ORDERS_QUEUE_MAX)
      .pipe(catchError((err) => {
        // Previously collapsed to an empty list, so a permissions denial or a
        // missing composite index rendered as "No orders" — indistinguishable
        // from a genuinely empty fulfilment queue.
        console.error('Failed to load orders.', err);
        this.loadError.set(describeFirestoreError('orders', err));
        return of([] as Order[]);
      }))
      .subscribe((orders) => {
        this.allOrders.set(orders);
        // Hitting the cap means older orders exist off-screen. Staff must be told,
        // or they will assume the queue is complete.
        this.truncated.set(orders.length >= ORDERS_QUEUE_MAX);
        this.isLoading.set(false);
      });
  }

  /**
   * Stock only comes back for an order that never left the shop, so cancelling
   * a dispatched order is allowed but must not read as a restock. The service
   * enforces this; the button is hidden to avoid offering an action whose
   * inventory side effect differs from what the label implies.
   */
  canCancel(order: Order): boolean {
    return order.status !== 'delivered' && order.status !== 'cancelled'
      && order.status !== 'out_for_delivery';
  }

  onFilterChange(event: CustomEvent): void {
    this.selectedFilter.set(event.detail.value);
    this.expandedId.set(null);
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
                color: 'success', duration: 2000, position: 'top',
              });
              await toast.present();
            } catch {
              const toast = await this.toastCtrl.create({
                message: 'Failed to update order status.',
                color: 'danger', duration: 3000, position: 'top',
              });
              await toast.present();
            } finally {
              this.updatingId.set(null);
            }
          },
        }],
    });
    await alert.present();
  }

  async cancelOrder(order: Order): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Cancel Order',
      message: `Cancel order #${order.id.slice(-6).toUpperCase()}? Stock will be restored.`,
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
                message: 'Order cancelled and stock restored.',
                color: 'warning', duration: 2500, position: 'top',
              });
              await toast.present();
            } catch (err: unknown) {
              const toast = await this.toastCtrl.create({
                message: err instanceof Error ? err.message : 'Failed to cancel order.',
                color: 'danger', duration: 3000, position: 'top',
              });
              await toast.present();
            } finally {
              this.updatingId.set(null);
            }
          },
        }],
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
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return '—'; }
  }

  trackOrder(_: number, o: Order): string { return o.id; }
}
