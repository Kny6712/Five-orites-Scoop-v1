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
  IonNote,
  IonBadge,
  IonButton,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { Subscription, catchError, of } from 'rxjs';
import { OrderService } from '../../core/services/order.service';
import { AuthService } from '../../core/services/auth.service';
import { Order } from '../../core/models/order.model';
import { OrderStatusBadgeComponent } from '../../shared/components/order-status-badge/order-status-badge.component';
import { CartButtonComponent } from '../../shared/components/cart-button/cart-button.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { PesoPipe } from '../../shared/pipes/peso.pipe';

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
    IonNote,
    IonBadge,
    IonButton,
    OrderStatusBadgeComponent,
    PesoPipe,
    CartButtonComponent,
    PaginationComponent,
    AppFooterComponent,
    AppIconComponent,
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
  private sub?: Subscription;

  orders = signal<Order[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');
  cancellingId = signal<string | null>(null);
  skeletonItems = Array(5).fill(0);

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
   * Eight orders a page.
   *
   * The list read is uncapped — `getCustomerOrders` has no limit — so a customer
   * with a long history got a single unbounded scroll. Eight rows is about one
   * screen of this list, and the pager matches the admin screens' component so
   * the control looks identical wherever it appears.
   */
  readonly PAGE_SIZE = 8;
  readonly page = signal(1);

  readonly pagedOrders = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.orders().slice(start, start + this.PAGE_SIZE);
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

  goToProducts(): void {
    void this.router.navigate(['/products']);
  }

  canCancel(order: Order): boolean {
    return order.status === 'pending';
  }

  async cancelOrder(order: Order, event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
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
            this.cancellingId.set(order.id);
            try {
              await this.orderService.cancelOrder(order.id, data?.reason);
              const toast = await this.toastCtrl.create({
                message: 'Order cancelled. Stock restored.',
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
