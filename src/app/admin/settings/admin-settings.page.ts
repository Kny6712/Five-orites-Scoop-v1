// src/app/admin/settings/admin-settings.page.ts
// Five-orites Scoop — Admin shop settings
//
// Brings three build-time constants under admin control, and surfaces the stock
// reconciliation report.
//
// This is the page REFACTOR_PLAN.md item 2.5 pointed at without finishing: it
// fixed the DUPLICATION of the low-stock number (four templates hardcoded `10`
// while `environment.lowStockThreshold` was ignored) but left the value
// unchangeable by the only person who would want to change it, because changing
// it meant a rebuild.
//
// It is also where an admin finds out whether stock numbers are trustworthy. The
// customer branch of the products rule lets any signed-in user set any stock
// level (firestore.rules:176-186, asserted by a test named "KNOWN LIMITATION:
// a customer CAN raise stock to any non-negative int" in
// tests/firestore.rules.test.ts), and the reconciliation panel reports the
// drift that creates.

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonButton,
  IonInput,
  IonTextarea,
  IonToggle,
  IonSelect,
  IonSelectOption,
  IonSkeletonText,
  ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { ShopSettingsService } from '../../core/services/shop-settings.service';
import {
  StockLedgerService,
  STOCK_REASON_LABELS,
  type ReconciliationReport,
  type StockMovement,
  type StockReason,
  type UnloggedChange,
} from '../../core/services/stock-ledger.service';
import { InventoryService } from '../../core/services/inventory.service';
import { OrderService } from '../../core/services/order.service';
import { Order } from '../../core/models/order.model';
import { toCsv, csvFilename, toIsoDate } from '../../core/logic/csv';
import { CsvExportService } from '../../core/services/csv-export.service';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonMenuButton,
    IonButton,
    IonInput,
    IonTextarea,
    IonToggle,
    IonSelect,
    IonSelectOption,
    IonSkeletonText,
    AppIconComponent,
    AlertBannerComponent,
    EmptyStateComponent,
    PaginationComponent,
    AppFooterComponent,
  ],
  templateUrl: './admin-settings.page.html',
  styleUrls: ['./admin-settings.page.scss'],
})
export class AdminSettingsPage implements OnInit {
  private shop = inject(ShopSettingsService);
  private ledger = inject(StockLedgerService);
  private inventory = inject(InventoryService);
  private orderService = inject(OrderService);
  private toastCtrl = inject(ToastController);
  private csvExport = inject(CsvExportService);

  isSaving = signal(false);
  loaded = signal(false);

  // Editable copies. Bound to the controls, written back on save — a settings
  // form that writes on every keystroke would burn a Firestore write per
  // character typed into the promo body.
  threshold = signal(10);
  promoTitle = signal('');
  promoBody = signal('');
  promoActive = signal(false);
  contactPhone = signal('');

  /** Reconciliation report state. */
  checking = signal(false);
  drift = signal<UnloggedChange[]>([]);
  checked = signal(false);
  /**
   * What the last pass actually read.
   *
   * Rendered in the panel because "no drift found" only means something next to
   * how much of the ledger was compared, and the check reads a recent window
   * rather than the whole ledger.
   */
  scannedRows = signal(0);
  scannedWindow = signal(0);
  /**
   * The two counts that stop this panel lying.
   *
   * `verified` is the number of stock values actually compared and found to agree.
   * `unverifiable` is the number with no ledger anchor at all — never compared, so
   * never cleared.
   *
   * Previously the panel reported drift alone and said "1 stock value does not
   * match the ledger", which reads as though the other 264 were checked and are
   * fine. They were not: `createProduct` wrote stock without logging a movement,
   * so 65 of 66 products had no history to check against. A pass that finds one
   * real problem while silently skipping everything else is worse than useless —
   * it trains the reader to trust a number that was never computed.
   */
  verifiedCount = signal(0);
  unverifiableCount = signal(0);
  totalStockValues = signal(0);
  movements = signal<StockMovement[]>([]);
  movementsLoading = signal(false);

  readonly reasonLabels = STOCK_REASON_LABELS;
  readonly reasonFilter = signal<StockReason | 'all'>('all');

  ngOnInit(): void {
    // One-shot read rather than a live listener: this form owns the values while
    // it is open, and a listener firing mid-edit would overwrite what is typed.
    this.shop.load().then((s) => {
      this.threshold.set(s.lowStockThreshold);
      this.promoTitle.set(s.promoTitle);
      this.promoBody.set(s.promoBody);
      this.promoActive.set(s.promoActive);
      this.contactPhone.set(s.contactPhone);
      this.loaded.set(true);
    });
    void this.loadMovements();
    void this.loadRepairs();
  }

  async save(): Promise<void> {
    if (this.isSaving()) return;
    const t = this.threshold();
    if (!Number.isFinite(t) || t < 1) {
      await this.toast('Low-stock threshold must be at least 1.', 'danger');
      return;
    }
    this.isSaving.set(true);
    try {
      await this.shop.save({
        lowStockThreshold: Math.round(t),
        promoTitle: this.promoTitle().trim(),
        promoBody: this.promoBody().trim(),
        promoActive: this.promoActive(),
        contactPhone: this.contactPhone().trim(),
      });
      await this.toast('Shop settings saved.', 'success');
    } catch (err: unknown) {
      await this.toast(describeFirestoreError('shop settings', err), 'danger');
    } finally {
      this.isSaving.set(false);
    }
  }

  private async loadMovements(): Promise<void> {
    this.movementsLoading.set(true);
    try {
      this.movements.set(await this.ledger.recent(60));
    } catch {
      // A missing ledger collection is the normal case until the first movement
      // is written — not an error worth a banner on a settings page.
      this.movements.set([]);
    } finally {
      this.movementsLoading.set(false);
      // A fresh read can leave the list shorter than the page the admin was on.
      this.movementsPage.set(1);
    }
  }

  /**
   * Compares stored stock against the ledger and reports the disagreement.
   *
   * Now TWO reads for the whole pass — the product list and one window of
   * movements — where it used to be one read per product on top of the same
   * product list, which is why this is no longer a loop worth defending: the
   * per-product queries that made "sequential rather than parallel" a
   * rate-limiting concern are gone (see `StockLedgerService.findUnloggedChanges`).
   */
  async reconcile(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    this.drift.set([]);
    try {
      const products = await firstValueFrom(this.inventory.getAllProducts(200));
      const report: ReconciliationReport = await this.ledger.findUnloggedChanges(products as never);
      this.drift.set(report.changes);
      this.scannedRows.set(report.rowsScanned);
      this.scannedWindow.set(report.window);
      this.verifiedCount.set(report.verified);
      this.unverifiableCount.set(report.unverifiable);
      this.totalStockValues.set(report.totalStockValues);
      this.checked.set(true);
      // A new report replaces the old list, which can be shorter.
      this.driftPage.set(1);

      /**
       * The toast leads with what was ACTUALLY verified, not with what went wrong.
       *
       * "No drift found" is not a clean bill of health on its own: with 65 of 66
       * products having no ledger history, a pass could report zero drift while
       * having checked almost nothing. Naming the verified count makes the size of
       * the gap impossible to miss, and when nothing at all could be checked the
       * toast says THAT rather than implying success.
       */
      if (report.verified === 0 && report.changes.length === 0) {
        await this.toast(
          `Nothing could be checked — all ${report.unverifiable} stock values have no ` +
            'ledger history. Run the baseline script to start recording.',
          'warning',
        );
      } else if (report.changes.length) {
        await this.toast(
          `${report.changes.length} of ${report.verified + report.changes.length} checked ` +
            `stock values do not match the ledger${
              report.unverifiable ? `, ${report.unverifiable} unchecked` : ''
            }.`,
          'warning',
        );
      } else {
        await this.toast(
          `All ${report.verified} checked stock values match the ledger` +
            (report.unverifiable
              ? `, but ${report.unverifiable} have no history and were not checked.`
              : '.'),
          report.unverifiable ? 'warning' : 'success',
        );
      }
    } catch (err: unknown) {
      await this.toast(describeFirestoreError('the stock ledger', err), 'danger');
    } finally {
      this.checking.set(false);
    }
  }

  /**
   * The 60 movements that were read, narrowed by the reason filter.
   *
   * A computed rather than the method this was, because `pagedMovements` has to
   * re-slice whenever the filter changes; a method call inside a computed is
   * not tracked.
   */
  readonly filteredMovements = computed(() => {
    const f = this.reasonFilter();
    return f === 'all' ? this.movements() : this.movements().filter((m) => m.reason === f);
  });

  // ── Paging ────────────────────────────────────────────────────────────────
  /* Three independent lists on one page, so three independent page indexes: one
     shared index would page the drift table and the movement history together,
     which is only coherent if the reader is looking at one of them. Same page
     size for all three because they are all "a screenful of rows" — twelve is
     what still fits above the fold on a phone with the panel heading in view.

     Each index is reset where that list's contents change: `loadMovements`,
     `reconcile`, and `loadRepairs`/`repair`. `movementsPage` also depends on
     `reasonFilter`, which no control on this page currently writes to — whoever
     adds one has to reset the index there too, the way the orders page does. */
  readonly MOVEMENTS_PAGE_SIZE = 12;
  readonly DRIFT_PAGE_SIZE = 12;
  readonly REPAIRS_PAGE_SIZE = 12;

  readonly movementsPage = signal(1);
  readonly driftPage = signal(1);
  readonly repairsPage = signal(1);

  readonly pagedMovements = computed(() => {
    const start = (this.movementsPage() - 1) * this.MOVEMENTS_PAGE_SIZE;
    return this.filteredMovements().slice(start, start + this.MOVEMENTS_PAGE_SIZE);
  });

  readonly pagedDrift = computed(() => {
    const start = (this.driftPage() - 1) * this.DRIFT_PAGE_SIZE;
    return this.drift().slice(start, start + this.DRIFT_PAGE_SIZE);
  });

  readonly pagedRepairs = computed(() => {
    const start = (this.repairsPage() - 1) * this.REPAIRS_PAGE_SIZE;
    return this.unrestoredOrders().slice(start, start + this.REPAIRS_PAGE_SIZE);
  });

  onMovementsPageChange(next: number): void {
    this.movementsPage.set(next);
  }

  onDriftPageChange(next: number): void {
    this.driftPage.set(next);
  }

  onRepairsPageChange(next: number): void {
    this.repairsPage.set(next);
  }

  formatWhen(value: unknown): string {
    const iso = toIsoDate(value);
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async exportLedger(): Promise<void> {
    const rows = [
      ['when', 'flavor', 'size', 'delta', 'balance_after', 'reason', 'order_id'],
      ...this.movements().map((m) => [
        toIsoDate(m.createdAt),
        m.variantName,
        m.size,
        m.delta,
        m.balanceAfter,
        m.reason,
        m.orderId ?? '',
      ]),
    ];
    await this.csvExport.export(toCsv(rows), csvFilename('stock-movements'));
  }

  async exportDrift(): Promise<void> {
    const rows = [
      ['flavor', 'size', 'stored', 'ledger_says', 'drift'],
      ...this.drift().map((d) => [d.variantName, d.size, d.stored, d.logged, d.drift]),
    ];
    await this.csvExport.export(toCsv(rows), csvFilename('stock-reconciliation'));
  }

  /**
   * Cancelled orders whose stock never came back.
   *
   * `corrected-gap-analysis.md:299` records this as having "no self-healing
   * path" — a restock failure after a cancel needed manual repair against the
   * console. This is that path.
   *
   * ONLY orders carrying an explicit `stockRestored === false` are listed. A
   * cancelled order with NO marker is counted separately and not offered for
   * repair, because absent means "unknown", not "broken" — offering all of them
   * would re-add stock that was already correctly returned.
   */
  readonly unrestoredOrders = signal<Order[]>([]);
  readonly unknownRestockCount = signal(0);
  readonly repairLoading = signal(false);
  readonly repairingId = signal('');

  async loadRepairs(): Promise<void> {
    this.repairLoading.set(true);
    try {
      const orders = await firstValueFrom(this.orderService.getAllOrders(undefined, 300));
      const cancelled = orders.filter((o) => o.status === 'cancelled');
      this.unrestoredOrders.set(cancelled.filter((o) => o.stockRestored === false));
      this.unknownRestockCount.set(cancelled.filter((o) => o.stockRestored === undefined).length);
    } catch {
      await this.toast('Could not load cancelled orders.', 'danger');
    } finally {
      this.repairLoading.set(false);
      // A reload can leave a shorter queue than the page the admin was on.
      this.repairsPage.set(1);
    }
  }

  async repair(order: Order): Promise<void> {
    this.repairingId.set(order.id);
    try {
      await this.orderService.repairStockRestock(order.id);
      this.unrestoredOrders.update((rows) => rows.filter((o) => o.id !== order.id));
      // Removing the last row of a page would otherwise leave the reader on an
      // empty page with nothing to click.
      this.repairsPage.set(1);
      await this.toast('Stock returned to inventory.', 'success');
    } catch (err: unknown) {
      await this.toast(describeFirestoreError('that order', err), 'danger');
    } finally {
      this.repairingId.set('');
    }
  }

  private async toast(message: string, color: 'success' | 'danger' | 'warning'): Promise<void> {
    const t = await this.toastCtrl.create({ message, color, duration: 2800, position: 'top' });
    await t.present();
  }
}
