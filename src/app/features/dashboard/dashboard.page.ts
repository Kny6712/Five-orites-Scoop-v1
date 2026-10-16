// src/app/features/dashboard/dashboard.page.ts
// Five-orites Scoop — Role-Aware Dashboard Hub
// Author: Five-orites Scoop team (see README)

import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonGrid,
  IonRow,
  IonCol,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonButton,
  IonText,
  IonSkeletonText,
  IonChip,
  IonLabel,
  IonRefresher,
  IonRefresherContent,
  IonToggle,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/app-icon/app-icon.component';
import { VoucherCardsComponent } from '@features/dashboard/voucher-cards/voucher-cards.component';
import { AlertBannerComponent } from '@shared/components/alert-banner/alert-banner.component';
import { Subscription, catchError, of, Observable } from 'rxjs';
import { AuthService } from '@core/services/auth.service';
import { InventoryService } from '@core/services/inventory.service';
import { OrderService } from '@core/services/order.service';
import { NotificationService } from '@core/services/notification.service';
import { ShopSettingsService } from '@core/services/shop-settings.service';
import { describeFirestoreError } from '@core/logic/firestore-error';
import { Product } from '@core/models/product.model';
import { Order } from '@core/models/order.model';
import { AppUser, isStaffRole } from '@core/models/user.model';
import { ProductCardComponent } from '@shared/components/product-card/product-card.component';

import { OrderStatusBadgeComponent } from '@shared/components/order-status-badge/order-status-badge.component';
import { PaginationComponent } from '@shared/components/pagination/pagination.component';
import { AppFooterComponent } from '@shared/components/app-footer/app-footer.component';
import { PesoPipe } from '@shared/pipes/peso.pipe';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-dashboard',
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
    IonGrid,
    IonRow,
    IonCol,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonButton,
    IonText,
    IonSkeletonText,
    IonChip,
    IonLabel,
    IonRefresher,
    IonRefresherContent,
    IonToggle,
    ProductCardComponent,
    OrderStatusBadgeComponent,
    PesoPipe,
    PaginationComponent,
    AppFooterComponent,
    AppIconComponent,
    VoucherCardsComponent,
    AlertBannerComponent,
  ],
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
})
export class DashboardPage implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private inventoryService = inject(InventoryService);
  private orderService = inject(OrderService);
  private notifService = inject(NotificationService);
  private subs: Subscription[] = [];

  currentUser = signal<AppUser | null>(null);
  isAdmin = computed(() => isStaffRole(this.currentUser()?.role));
  isLoading = signal(true);
  /**
   * Set when any dashboard feed fails. Non-empty means "we could not read
   * this", not "there is nothing here" — every feed below used to catch its
   * error into `of([])`, so a permissions error, a missing index or an offline
   * device rendered as a perfectly clean dashboard with four zeroed KPIs and no
   * featured flavors.
   */
  loadError = signal('');

  // Customer data
  featuredProducts = signal<Product[]>([]);
  recentOrders = signal<Order[]>([]);
  /** Id set behind the current featuredProducts shuffle — see loadCustomerDashboard(). */
  private featuredProductIdsKey = '';

  // Admin KPIs
  todayRevenue = signal(0);
  pendingOrderCount = signal(0);
  lowStockCount = signal(0);
  totalOrderCount = signal(0);
  adminRecentOrders = signal<Order[]>([]);
  lowStockProducts = signal<Product[]>([]);

  /**
   * The admin-editable threshold, not the build constant.
   *
   * Read from the same service `InventoryService.subscribeToLowStock()` uses, so
   * the count on screen and the rows in the low-stock panel can never disagree
   * about what "low" means.
   */
  readonly shop = inject(ShopSettingsService);
  readonly lowStockThreshold = computed(() => this.shop.lowStockThreshold());

  /**
   * Recent Orders paging.
   *
   * This list was a hard `.slice(0, 10)` with no pager, so an admin with 40
   * orders had no way to see the 11th-most-recent from this page at all — the
   * only route was "View All" into the fulfillment queue, which is a different
   * task with different controls. Ten a page keeps the whole list reachable
   * here without turning the dashboard into a table, and matches the 10–12 band
   * every list in the app now pages at so the rows-per-page does not read as a
   * different app depending on where you are.
   *
   * The underlying fetch is unchanged: getAllOrders() is capped at 100 by the
   * service, so the pager pages what was fetched rather than fetching more. That
   * is the right trade for a dashboard — it is a "what needs attention now"
   * surface, and the fulfillment queue is the exhaustive one.
   */
  readonly RECENT_PAGE_SIZE = 10;
  readonly recentPage = signal(1);

  readonly pagedRecentOrders = computed(() => {
    const start = (this.recentPage() - 1) * this.RECENT_PAGE_SIZE;
    return this.adminRecentOrders().slice(start, start + this.RECENT_PAGE_SIZE);
  });

  /**
   * Low stock paging.
   *
   * Same reasoning as the orders panel above, applied to the other list on this
   * page: a shop with thirty flavors under the threshold rendered thirty rows of
   * near-identical chips, and a restock is easier to work through a screen at a
   * time. It is sorted worst-first (see loadAdminDashboard), so paging keeps
   * that order — the flavors that will sell out today are still the first thing
   * on page 1.
   *
   * CLIENT-SIDE, AND THE READ IS DELIBERATELY UNCAPPED. `subscribeToLowStock` is
   * a live listener over every product, not a `limit()` query, so the panel is
   * already reading all of them; slicing here costs nothing and hides nothing. The
   * alternative — asking the service for one page at a time — would either lose
   * the live updates that make the panel worth having, or make it a different
   * kind of list than the one the KPI count above it describes.
   */
  readonly LOW_STOCK_PAGE_SIZE = 12;
  readonly lowStockPage = signal(1);

  /**
   * The low-stock rows for the current page.
   *
   * This was briefly an `filteredLowStock()` sandwiched between the two, driving a
   * per-size filter row that has since been removed. The intermediate is gone with
   * it: the service already pre-filters to products with at least one size under
   * the threshold (see `InventoryService.subscribeToLowStock`), so a second filter
   * on the client could only ever remove rows, never add a missing one.
   */
  readonly pagedLowStock = computed(() => {
    const start = (this.lowStockPage() - 1) * this.LOW_STOCK_PAGE_SIZE;
    return this.lowStockProducts().slice(start, start + this.LOW_STOCK_PAGE_SIZE);
  });

  /**
   * The class list for one per-size stock pill.
   *
   * WHY THIS IS A METHOD AND NOT A TEMPLATE EXPRESSION. The obvious binding,
   * `[class.stock-chip-empty]="product.stock.halfGallon === 0"`, combined with the
   * static `class="stock-chip-sm"` already on the element, made every one of these
   * four chips long enough that prettier split the element's own closing tag across
   * two lines:
   *
   *     >½ Gal: {{ product.stock.halfGallon }}</ion-chip
   *   >
   *
   * which is unreadable and would have to be re-broken by hand after every edit.
   * Binding `[class]` alone — with the base class supplied by this method — keeps
   * each chip on one line.
   *
   * THE TWO DO NOT COMBINE. A `[class]` binding REPLACES the element's class
   * attribute wholesale rather than adding to it, so leaving `class="stock-chip-sm"`
   * on the element as well would be an either/or, not a merge. That is why the base
   * class is returned from here instead of being written on the element.
   *
   * Zero is separated from low so a manager can see, down a column of rows, what is
   * actually GONE rather than what merely needs restocking. It is a fill change
   * only — same size, same radius, same label — so the list does not turn into a
   * colour chart.
   */
  chip(qty: number): string {
    return qty === 0 ? 'stock-chip-sm stock-chip-empty' : 'stock-chip-sm';
  }

  constructor() {
    this.authService.currentUser$.pipe(takeUntilDestroyed()).subscribe((user) => {
      const wasAdmin = this.isAdmin();
      this.currentUser.set(user);
      // Reload when role resolves (fixes admin seeing customer view on refresh).
      if (user && this.isAdmin() !== wasAdmin) {
        this.loadDashboard();
      } else if (
        user &&
        this.featuredProducts().length === 0 &&
        this.adminRecentOrders().length === 0
      ) {
        this.loadDashboard();
      }
    });
  }

  ngOnInit(): void {
    // Live so the banner and the low-stock threshold react to an admin saving
    // without a reload. `watch()` drops any previous listener first, so a
    // re-entry cannot stack subscriptions.
    this.shop.watch();
    this.loadDashboard();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.shop.stop();
  }

  loadDashboard(): void {
    this.isLoading.set(true);
    this.loadError.set('');
    this.subs.forEach((s) => s.unsubscribe());
    this.subs = [];

    if (this.isAdmin()) {
      this.loadAdminDashboard();
    } else {
      this.loadCustomerDashboard();
    }
  }

  /**
   * Record a failed feed and return the empty array the subscription sees.
   *
   * Returning `of([])` keeps the stream alive so the OTHER feeds still render
   * whatever they legitimately loaded; the error signal is what stops the page
   * from passing that empty array off as real data. isLoading is cleared here
   * too — otherwise a feed that fails leaves the skeleton spinning forever.
   *
   * The message now comes from describeFirestoreError, which distinguishes a
   * missing database index from a permissions problem from a genuinely offline
   * device. This handler used to claim "check your connection" for all three,
   * which is how a never-deployed composite index presented to every customer
   * as a wifi problem.
   */
  private feedFailed(what: string, err: unknown): Observable<never[]> {
    console.error(`Dashboard: could not load ${what}`, err);
    this.loadError.set(describeFirestoreError(what, err));
    this.isLoading.set(false);
    return of([]);
  }

  private loadCustomerDashboard(): void {
    // Featured products — random 4 from catalog.
    //
    // The shuffle runs ONCE per distinct set of products. Reshuffling on every
    // snapshot meant that any stock change anywhere in the catalog (a sale, an
    // admin restock) re-rolled the dice and the four cards jumped to different
    // flavors under the user's thumb — the stream is live, so this was frequent.
    // The rotation still happens when the catalog genuinely changes, which is
    // the case the randomness was there for.
    const s1 = this.inventoryService
      .getProducts()
      .pipe(catchError((err) => this.feedFailed('featured flavors', err)))
      .subscribe((products) => {
        const key = products.map((p) => p.id).join('|');
        if (key !== this.featuredProductIdsKey) {
          this.featuredProductIdsKey = key;
          const shuffled = [...products].sort(() => Math.random() - 0.5);
          this.featuredProducts.set(shuffled.slice(0, 4));
        }
        this.isLoading.set(false);
      });
    this.subs.push(s1);

    // Recent orders
    const uid = this.currentUser()?.uid;
    if (uid) {
      // Capped at exactly what is rendered. This was `getCustomerOrders(uid)`
      // followed by `.slice(0, 3)`, which subscribed to the newest 50 orders and
      // then discarded 47 of them — 50 document reads per emission to draw three
      // rows, on a dashboard that is refreshed often. `getCustomerOrders` already
      // applies `orderBy('createdAt', 'desc')` BEFORE `limit()`, so asking for 3
      // returns the same three the slice did.
      //
      // The orders page reads the same collection separately for its own list,
      // which is a second listener rather than a shared one. Worth folding into
      // one subscription if this ever shows up in a bill.
      const s2 = this.orderService
        .getCustomerOrders(uid, 3)
        .pipe(catchError((err) => this.feedFailed('your recent orders', err)))
        .subscribe((orders) => this.recentOrders.set(orders));
      this.subs.push(s2);
    }
  }

  private loadAdminDashboard(): void {
    // All orders for KPIs (capped server-side at 100, see OrderService).
    const s1 = this.orderService
      .getAllOrders()
      .pipe(catchError((err) => this.feedFailed('your KPIs and recent orders', err)))
      .subscribe((orders) => {
        this.totalOrderCount.set(orders.length);
        this.pendingOrderCount.set(
          orders.filter((o) => o.status === 'pending' || o.status === 'confirmed').length,
        );

        // Today's revenue: delivered orders today (paymentStatus stays
        // 'pending' until a payment gateway is integrated).
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayOrders = orders.filter((o) => {
          try {
            const raw = o.createdAt as unknown as { toDate(): Date } | string;
            const date = typeof raw === 'string' ? new Date(raw) : raw.toDate();
            return date >= today && (o.status === 'delivered' || o.paymentStatus === 'paid');
          } catch {
            return false;
          }
        });
        this.todayRevenue.set(todayOrders.reduce((sum, o) => sum + (o.grandTotal ?? 0), 0));

        // The full recent slice, no longer truncated to a display count: the
        // pager slices for display and needs the whole list to know its length.
        this.adminRecentOrders.set(orders.slice(0, 60));
        this.recentPage.set(1);
        this.isLoading.set(false);
      });
    this.subs.push(s1);

    // Low stock. The threshold is passed explicitly so the query and the number
    // shown beside it are read from the same source at the same moment — a
    // change to the setting mid-load would otherwise make them disagree.
    const s2 = this.inventoryService
      .subscribeToLowStock(this.lowStockThreshold())
      .pipe(catchError((err) => this.feedFailed('low stock alerts', err)))
      .subscribe((products) => {
        this.lowStockCount.set(products.length);
        // Show the WORST first, so the panel's top rows are the ones that will
        // sell out today. It was previously sliced in whatever order the snapshot
        // arrived, which meant a flavor at zero could sit below four flavors
        // merely "low" — the panel's job is triage, and triage is sorted.
        this.lowStockProducts.set(
          [...products].sort((a, b) => this.shortestSize(a) - this.shortestSize(b)),
        );
      });
    this.subs.push(s2);
  }

  /** The smallest single-size stock figure for a flavor — its worst number. */
  private shortestSize(p: Product): number {
    return Math.min(p.stock.cup, p.stock.pint, p.stock.halfGallon, p.stock.gallon);
  }

  /**
   * Three states, not two. A plain boolean cannot express "you asked and the
   * browser said no" — and once a browser permission is denied it cannot be
   * re-granted from a page at all, so the user has to change it in site settings.
   * A toggle that looks broken and offers no way out is worse than one that says
   * why.
   */
  readonly updatesOn = computed(() =>
    this.notifService.isEnabled(this.currentUser()?.notificationsEnabled),
  );

  /**
   * A pure preference write in both directions.
   *
   * This used to prompt for an OS permission first and roll the toggle back on a
   * denial, because the app was registering for FCM push. Notifications are now
   * in-app only, so there is no permission, no prompt, and no second axis that
   * could leave the switch reading "on" while nothing was delivered.
   */
  async onNotificationsToggle(event: CustomEvent): Promise<void> {
    const enabled = event.detail.checked as boolean;
    try {
      await this.authService.updateProfile({ notificationsEnabled: enabled });
      await this.authService.refreshProfile();
    } catch (err) {
      console.error('Could not save the notification preference', err);
      this.loadError.set('Could not save that preference. Please try again.');
    }
  }

  handleRefresh(event: CustomEvent): void {
    this.loadDashboard();
    setTimeout(() => (event.target as HTMLIonRefresherElement).complete(), 1200);
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

  trackProduct(_: number, p: Product): string {
    return p.id;
  }
  trackOrder(_: number, o: Order): string {
    return o.id;
  }
}
