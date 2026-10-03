// src/app/admin/analytics/analytics.page.ts

import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton,
  IonCard, IonCardContent, IonText,
  IonSkeletonText, IonRefresher, IonRefresherContent,
  IonChip, IonLabel, IonButton, IonSegment, IonSegmentButton,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { Subscription } from 'rxjs';
import { OrderService } from '../../core/services/order.service';
import { AuthService } from '../../core/services/auth.service';
import { Order, OrderStatus } from '../../core/models/order.model';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { toCsv, downloadCsv, csvFilename, toIsoDate } from '../../core/logic/csv';
import { SIZE_DISPLAY_LABELS } from '../../core/config/pricing.config';
import type { SizeVariant } from '../../core/models/product.model';
import { DonutChartComponent, type DonutSlice } from '../../shared/components/charts/donut-chart.component';
import { BarChartComponent, type BarDatum } from '../../shared/components/charts/bar-chart.component';
import { LineChartComponent, type LinePoint } from '../../shared/components/charts/line-chart.component';
import { bucketsFor, bucketize, runningTotal } from '../../core/logic/series';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { PesoPipe } from '../../shared/pipes/peso.pipe';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';

/** One row of the ranked flavors table. setName is carried so the table can
 *  group by set without a second lookup at render time. */
interface TopFlavor { name: string; setName: string; count: number; revenue: number; }

/**
 * Upper bound on a single reporting read. Comfortably above what a small shop
 * accumulates, and `truncated` reports honestly if it is ever reached, so a
 * capped figure degrades to "at least this much" rather than silently becoming
 * wrong.
 */
const ANALYTICS_MAX_ORDERS = 500;

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton,
    IonCard, IonCardContent, IonText,
    IonSkeletonText, IonRefresher, IonRefresherContent,
    IonChip, IonLabel, IonButton, IonSegment, IonSegmentButton, PesoPipe,
    AppIconComponent, DonutChartComponent, BarChartComponent, LineChartComponent, AlertBannerComponent, PaginationComponent,
    AppFooterComponent],
  templateUrl: './analytics.page.html',
  styleUrls: ['./analytics.page.scss'],
})

export class AnalyticsPage implements OnInit, OnDestroy {
  private orderService = inject(OrderService);
  private authService = inject(AuthService);
  private sub?: Subscription;

  orders = signal<Order[]>([]);
  isLoading = signal(true);
  /**
   * Set when the orders stream fails. Non-empty means "we do not know", NOT
   * "there is no sales data" — the two used to be indistinguishable, because a
   * failed read was swallowed into an empty array and the page happily rendered
   * ₱0 revenue and "No sales data yet."
   */
  loadError = signal('');
  dateRange = signal<'all' | 'today' | '7d' | '30d'>('all');

  /**
   * True when the read hit ANALYTICS_MAX_ORDERS, meaning the figures are a
   * lower bound and older orders exist that were not counted. Surfaced in the UI
   * so a capped report never reads as a complete one.
   */
  truncated = signal(false);

  /**
   * Orders that represent actual business, i.e. excluding the admin's own.
   *
   * An admin buying ice cream for themselves is not a sale — in bookkeeping that
   * is an owner drawing, and it does not belong in revenue. This also keeps
   * throwaway test orders out of the figures, without needing a "test order"
   * flag that no real storefront platform has. Fulfillment still lists these
   * orders, because staff still have to make the ice cream.
   */
  businessOrders = computed(() => {
    const myUid = this.authService.currentUserSnapshot?.uid;
    if (!myUid) return this.orders();
    return this.orders().filter((o) => o.customerId !== myUid);
  });

  /**
   * Orders placed by the signed-in admin, so the UI can disclose the exclusion.
   *
   * Scoped to the selected range like every other figure on the page — the note
   * that says "Excludes your 9 own orders" has to describe the same window as
   * the numbers it sits above, or it discloses a count the admin never removed
   * from the tiles they are looking at.
   */
  myOrderCount = computed(() => {
    const myUid = this.authService.currentUserSnapshot?.uid;
    if (!myUid) return 0;
    return this.orders().filter((o) => o.customerId === myUid && this.inRange(o)).length;
  });

  /** Human name for the active segment, so labels can say what they count. */
  rangeLabel = computed(() => {
    switch (this.dateRange()) {
      case 'today': return 'Today';
      case '7d': return 'Last 7 Days';
      case '30d': return 'Last 30 Days';
      default: return 'All Time';
    }
  });

  /**
   * Does this order fall inside the selected segment?
   *
   * An unreadable/absent createdAt is treated as IN range, so a malformed
   * timestamp can never quietly delete a real order from the figures.
   */
  private inRange(order: Order): boolean {
    const range = this.dateRange();
    if (range === 'all') return true;
    const now = Date.now();
    const ms = range === 'today' ? 24 * 3600 * 1000 : range === '7d' ? 7 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
    try {
      const ts = order.createdAt as unknown as { toDate(): Date } | string;
      const d = typeof ts === 'string' ? new Date(ts).getTime() : ts.toDate().getTime();
      return now - d <= ms;
    } catch {
      return true;
    }
  }

  rangedOrders = computed(() => this.businessOrders().filter((o) => this.inRange(o)));

  deliveredOnly = computed(() =>
    this.rangedOrders().filter((o) => o.status === 'delivered')
  );

  totalRevenue = computed(() =>
    this.deliveredOnly().reduce((sum, o) => sum + (o.grandTotal ?? 0), 0)
  );

  /**
   * Count KPIs read rangedOrders(), not businessOrders().
   *
   * They used to read the all-time business set, so moving the segment to 7d
   * changed Revenue / Avg / Top Flavors but left these two tiles frozen at
   * their lifetime totals — the page looked like a half-applied filter. They
   * also keep the admin's-own-orders exclusion that rangedOrders() applies, so
   * the counts stay consistent with the revenue they sit next to.
   */
  totalOrders = computed(() => this.rangedOrders().length);

  deliveredOrders = computed(() => this.deliveredOnly().length);

  /**
   * Revenue per day (or per week on a long range).
   *
   * The gap this fills: every figure above is an AGGREGATE for the whole
   * window, so "last 30 days" could only ever be one number. An owner's first
   * question is usually directional — is it going up or down — and a single
   * total cannot answer that.
   *
   * DELIVERED ONLY, matching every other figure on this page. Mixing in-progress
   * orders would put revenue on the chart that the Revenue tile excludes, and the
   * page would contradict itself on the same screen.
   *
   * 'all' has no window to plot against, so it plots nothing and says why rather
   * than picking an arbitrary 30 days.
   */
  readonly rangeDays = computed<number | null>(() => {
    switch (this.dateRange()) {
      case 'today': return 1;
      case '7d': return 7;
      case '30d': return 30;
      default: return null;
    }
  });

  readonly trendBuckets = computed(() => {
    const days = this.rangeDays();
    if (days === null) return [];
    return bucketsFor(days, new Date());
  });

  readonly revenueTrend = computed<LinePoint[]>(() => {
    const buckets = this.trendBuckets();
    if (!buckets.length) return [];
    const sums = bucketize(
      buckets,
      this.deliveredOnly(),
      (o) => {
        try {
          const ts = o.createdAt as unknown as { toDate(): Date } | string;
          return typeof ts === 'string' ? new Date(ts).getTime() : ts.toDate().getTime();
        } catch {
          return Number.NaN;
        }
      },
      (o) => o.grandTotal ?? 0
    );
    return buckets.map((b, i) => ({ label: b.label, value: sums[i] }));
  });

  readonly cumulativeRevenue = computed<LinePoint[]>(() => {
    const trend = this.revenueTrend();
    if (!trend.length) return [];
    return trend.map((p, i) => ({ label: p.label, value: runningTotal(trend.slice(0, i + 1).map((x) => x.value))[i] }));
  });

  readonly trendSeries = signal<'daily' | 'cumulative' | 'orders'>('daily');

  /** Plain integer, for the orders axis. */
  readonly formatCount = (v: number): string => String(Math.round(v));

  /** The series the chart should render, chosen by the toggle. */
  readonly activeTrend = computed(() => {
    switch (this.trendSeries()) {
      case 'cumulative': return this.cumulativeRevenue();
      case 'orders': return this.ordersTrend();
      default: return this.revenueTrend();
    }
  });

  /**
   * Orders per day, which is a different question from pesos per day.
   *
   * A shop can hold revenue flat by doubling prices while halving orders, and
   * the revenue line alone would show that as stability.
   */
  readonly ordersTrend = computed<LinePoint[]>(() => {
    const buckets = this.trendBuckets();
    if (!buckets.length) return [];
    const counts = bucketize(
      buckets,
      this.deliveredOnly(),
      (o) => {
        try {
          const ts = o.createdAt as unknown as { toDate(): Date } | string;
          return typeof ts === 'string' ? new Date(ts).getTime() : ts.toDate().getTime();
        } catch {
          return Number.NaN;
        }
      },
      () => 1
    );
    return buckets.map((b, i) => ({ label: b.label, value: counts[i] }));
  });

  avgOrderValue = computed(() =>
    this.deliveredOnly().length > 0
      ? this.totalRevenue() / this.deliveredOnly().length
      : 0
  );

  /**
   * Every flavor that sold, ranked highest to lowest.
   *
   * NOT sliced to ten. This is the backing data for the ranked table on the
   * page, and a "top 10" table with no way to see 11th place answers only half
   * the question an owner actually has — which of my flavors is not selling?
   * The chart beside it takes a slice of this; the table shows all of it, and
   * says so.
   */
  topFlavors = computed<TopFlavor[]>(() => {
    const map = new Map<string, TopFlavor>();
    this.deliveredOnly().forEach((o) =>
      o.items?.forEach((item) => {
        const key = item.variantName;
        const existing = map.get(key) ?? { name: key, count: 0, revenue: 0, setName: item.setName || '—' };
        map.set(key, {
          name: key,
          setName: item.setName || '—',
          count: existing.count + item.quantity,
          revenue: existing.revenue + item.subtotal,
        });
      })
    );
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  });

  /** The ten best sellers, for the chart. */
  readonly topTenFlavors = computed(() => this.topFlavors().slice(0, 10));

  /**
   * The ranked table is paged rather than rendered whole.
   *
   * This page was the one list in the app still missing the shared pager, and
   * the ranked table is the one that grows without bound — a busy month can put
   * every flavor in the catalog on screen at once, which is exactly the "top 10
   * answers only half the question" case the table was built to solve, defeated
   * by its own length.
   *
   * The CHART stays top-10 on purpose: a bar chart of 60 flavors is unreadable,
   * so slicing there is a design decision rather than a shortcut. The TABLE shows
   * all of them, a page at a time.
   */
  readonly flavorPage = signal(1);
  readonly FLAVOR_PAGE_SIZE = 12;
  readonly flavorPageOffset = computed(() => (this.flavorPage() - 1) * this.FLAVOR_PAGE_SIZE);
  readonly pagedFlavors = computed(() => {
    const start = this.flavorPageOffset();
    return this.topFlavors().slice(start, start + this.FLAVOR_PAGE_SIZE);
  });

  /**
   * Share of all units sold, per flavor, highest first.
   *
   * A count alone does not tell an owner whether a flavor is doing well. 40
   * units is excellent against 200 total and poor against 4,000 — the percentage
   * is what makes the ranking mean anything, so it is computed rather than left
   * for the reader to work out.
   */
  readonly flavorShare = computed<Record<string, number>>(() => {
    const flavors = this.topFlavors();
    const total = flavors.reduce((sum, f) => sum + f.count, 0);
    if (total === 0) return {};
    const out: Record<string, number> = {};
    for (const f of flavors) out[f.name] = (f.count / total) * 100;
    return out;
  });

  /** The single best-selling size, for the headline under the size chart. */
  readonly topSize = computed(() => {
    const sizes = this.salesBySize();
    if (sizes.length === 0) return null;
    const top = sizes[0];
    return {
      label: SIZE_DISPLAY_LABELS[top.name as SizeVariant] ?? top.name,
      count: top.count,
      revenue: top.revenue,
    };
  });

  salesBySet = computed(() => {
    const map = new Map<string, { name: string; count: number; revenue: number }>();
    this.deliveredOnly().forEach((o) =>
      o.items?.forEach((item) => {
        const key = item.setName || 'Unknown';
        const e = map.get(key) ?? { name: key, count: 0, revenue: 0 };
        map.set(key, { name: key, count: e.count + item.quantity, revenue: e.revenue + item.subtotal });
      })
    );
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  });

  salesBySize = computed(() => {
    const map = new Map<string, { name: string; count: number; revenue: number }>();
    this.deliveredOnly().forEach((o) =>
      o.items?.forEach((item) => {
        const key = item.size;
        const e = map.get(key) ?? { name: key, count: 0, revenue: 0 };
        map.set(key, { name: key, count: e.count + item.quantity, revenue: e.revenue + item.subtotal });
      })
    );
    return [...map.values()].sort((a, b) => b.count - a.count);
  });

  // ── Chart data ───────────────────────────────────────────────────────────

  /**
   * Order counts per status, for the donut.
   *
   * Deliberately built from `rangedOrders()` — every order in the window — not
   * from `deliveredOnly()`. A "status mix" that only ever showed one slice
   * because it was filtered to delivered orders would be a pie chart with no
   * information in it. Delivered is still the largest slice, which is the point.
   *
   * Cancelled is last, so the operational states read in lifecycle order and the
   * one people want to notice sits apart from the happy path.
   */
  readonly statusSlices = computed<DonutSlice[]>(() => {
    const orders = this.rangedOrders();
    const count = (status: OrderStatus) => orders.filter((o) => o.status === status).length;
    return [
      { label: 'Delivered', value: count('delivered'), tone: 'mint' },
      { label: 'Out for delivery', value: count('out_for_delivery'), tone: 'sunny' },
      { label: 'Preparing', value: count('preparing'), tone: 'primary' },
      { label: 'Confirmed', value: count('confirmed'), tone: 'primary' },
      { label: 'Placed', value: count('pending'), tone: 'neutral' },
      { label: 'Cancelled', value: count('cancelled'), tone: 'danger' },
    ];
  });

  /** Units per flavor, with revenue as the annotation. Chart data is the top
   *  ten; the full ranking is in the table below it. */
  readonly flavorBars = computed<BarDatum[]>(() =>
    this.topTenFlavors().map((f) => ({
      label: f.name,
      value: f.count,
      annotation: this.formatPesoValue(f.revenue),
      tone: 'primary' as const,
    }))
  );

  readonly setBars = computed<BarDatum[]>(() =>
    this.salesBySet().map((s) => ({
      label: s.name,
      value: s.revenue,
      annotation: `${s.count} units`,
      tone: 'mint' as const,
    }))
  );

  readonly sizeBars = computed<BarDatum[]>(() =>
    this.salesBySize().map((s) => ({
      // salesBySize() keys by the raw `item.size` string, so it is typed `string`
      // rather than `SizeVariant`. Guarding the lookup rather than casting keeps
      // an unexpected value falling back to the raw string instead of printing
      // "undefined".
      label: SIZE_DISPLAY_LABELS[s.name as SizeVariant] ?? s.name,
      value: s.count,
      // Revenue as the annotation, because units alone cannot answer "which size
      // should we push?" — a gallon sells one unit and earns four pints.
      annotation: this.formatPesoValue(s.revenue),
      tone: 'sunny' as const,
    }))
  );

  /**
   * Nothing to report here yet.
   *
   * A "flavors with no sales" list is the most actionable thing this page could
   * show, but it needs the full catalog to be meaningful and the Analytics read
   * is orders-only by design. Rather than fire a second Firestore read for it,
   * the ranked table's own tail tells the same story: anything below the last
   * row with a low share is a flavor that is barely moving.
   */

  // Formatters are bound as properties, not arrow calls in the template, so the
  // bar chart's input signal sees a stable reference across change detection.
  protected readonly formatUnits = (v: number): string => `${v}`;
  protected readonly formatPeso = (v: number): string => this.formatPesoValue(v);

  /**
   * A flavor's share of all units sold, as a percentage string.
   *
   * One decimal below 10%, whole numbers above — "0.4%" and "23%" are both
   * meaningful, "23.0%" and "0.4%" both being one decimal is noise. A flavor
   * that sold nothing in the window reports 0% rather than a dash, because zero
   * is the answer.
   */
  protected shareLabel(flavorName: string): string {
    const share = this.flavorShare()[flavorName];
    if (share === undefined) return '0%';
    return `${share < 10 ? share.toFixed(1) : Math.round(share)}%`;
  }

  private formatPesoValue(v: number): string {
    return `₱${v.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
  }

  setDateRange(range: 'all' | 'today' | '7d' | '30d'): void {
    this.dateRange.set(range);
    // The range is now a server-side query, not a browser-side filter, so the
    // read has to be reissued. Without this the segment buttons would look
    // functional while the underlying data never changed.
    this.loadData();
  }

  /**
   * CSV of the orders behind the figures.
   *
   * Deliberately the SAME set the revenue tile uses — delivered orders in the
   * selected range. It previously exported every status, so summing its
   * grand_total column never reconciled with the Revenue figure printed on the
   * same page. A report that contradicts itself is worse than no report, and
   * `status` stays in the header so a reader can see the scope.
   *
   * A cancelled or in-progress order is not revenue, so it is not exported.
   */
  exportCsv(): void {
    const rows = [
      ['order_id', 'date', 'status', 'items', 'subtotal', 'discount', 'delivery', 'grand_total'],
      ...this.deliveredOnly().map((o) => [
        o.id,
        toIsoDate(o.createdAt),
        o.status,
        o.items?.reduce((s, i) => s + i.quantity, 0) ?? 0,
        o.totalAmount ?? 0,
        o.discountAmount ?? 0,
        o.deliveryFee ?? 0,
        o.grandTotal ?? 0])];
    downloadCsv(toCsv(rows), csvFilename('delivered-sales', this.dateRange()));
  }


  ngOnInit(): void { this.loadData(); }
  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  /**
   * Orders are read for the SELECTED RANGE, server-side.
   *
   * Previously the page read the newest 100 orders and filtered by date in the
   * browser. That made "last 30 days" ignore anything past order 100, and made
   * "All Time" quietly mean "the newest 100" while the label claimed otherwise
   * — the figures were wrong with nothing on screen to say so. The range is now
   * a `where('createdAt','>=',...)` clause, and the on-screen filter is limited
   * to the 'all' case, where no lower bound exists.
   */
  loadData(): void {
    this.isLoading.set(true);
    this.loadError.set('');
    this.truncated.set(false);
    // A new range is a new ranking; staying on page 7 would show an empty table.
    this.flavorPage.set(1);
    this.sub?.unsubscribe();

    const range = this.dateRange();
    if (range === 'all') {
      this.sub = this.orderService.getAllOrders(undefined, ANALYTICS_MAX_ORDERS).subscribe({
        next: (orders) => {
          this.orders.set(orders);
          // Hitting the cap means the figures below are a floor, not a total.
          this.truncated.set(orders.length >= ANALYTICS_MAX_ORDERS);
          this.isLoading.set(false);
        },
        error: (err: unknown) => this.onLoadError(err),
      });
      return;
    }

    const since = this.rangeStart(range);
    this.sub = this.orderService.getOrdersSince(since, ANALYTICS_MAX_ORDERS).subscribe({
      next: (orders) => {
        this.orders.set(orders);
        this.truncated.set(orders.length >= ANALYTICS_MAX_ORDERS);
        this.isLoading.set(false);
      },
      error: (err: unknown) => this.onLoadError(err),
    });
  }

  /** Inclusive lower bound for a rolling range, as a Date. */
  private rangeStart(range: 'today' | '7d' | '30d'): Date {
    const ms =
      range === 'today' ? 24 * 3600 * 1000 : range === '7d' ? 7 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
    return new Date(Date.now() - ms);
  }

  private onLoadError(err: unknown): void {
    // A permissions error, a missing index and an offline device all land here.
    // Rendering any of them as "No sales data yet." is a lie the admin cannot
    // detect, so surface it rather than showing ₱0 as if it were real.
    console.error('Analytics: could not load orders', err);
    this.orders.set([]);
    this.loadError.set(describeFirestoreError('sales data', err));
    this.isLoading.set(false);
  }

  handleRefresh(event: CustomEvent): void {
    this.loadData();
    setTimeout(() => (event.target as HTMLIonRefresherElement).complete(), 1000);
  }
}