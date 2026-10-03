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

import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonButton,
  IonInput, IonTextarea, IonToggle, IonSelect, IonSelectOption,
  IonSkeletonText, ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { ShopSettingsService } from '../../core/services/shop-settings.service';
import { StockLedgerService, STOCK_REASON_LABELS, type StockMovement, type StockReason, type UnloggedChange } from '../../core/services/stock-ledger.service';
import { InventoryService } from '../../core/services/inventory.service';
import { OrderService } from '../../core/services/order.service';
import { Order } from '../../core/models/order.model';
import { toCsv, downloadCsv, csvFilename, toIsoDate } from '../../core/logic/csv';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonButton,
    IonInput, IonTextarea, IonToggle, IonSelect, IonSelectOption,
    IonSkeletonText,
    AppIconComponent, AlertBannerComponent,
    EmptyStateComponent, AppFooterComponent,
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
    }
  }

  /**
   * Compares stored stock against the ledger and reports the disagreement.
   *
   * Sequential per product rather than parallel: each call is a query, and
   * firing 64 of them at once on a phone is how you get rate-limited. The admin
   * is waiting on a report, not watching it stream.
   */
  async reconcile(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    this.drift.set([]);
    try {
      const products = await firstValueFrom(this.inventory.getAllProducts(200));
      const found = await this.ledger.findUnloggedChanges(products as never);
      this.drift.set(found);
      this.checked.set(true);
      await this.toast(
        found.length
          ? `${found.length} stock ${found.length === 1 ? 'value does' : 'values do'} not match the ledger.`
          : 'All stock values match the ledger.',
        found.length ? 'warning' : 'success'
      );
    } catch (err: unknown) {
      await this.toast(describeFirestoreError('the stock ledger', err), 'danger');
    } finally {
      this.checking.set(false);
    }
  }

  filteredMovements(): StockMovement[] {
    const f = this.reasonFilter();
    return f === 'all' ? this.movements() : this.movements().filter((m) => m.reason === f);
  }

  formatWhen(value: unknown): string {
    const iso = toIsoDate(value);
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  exportLedger(): void {
    const rows = [
      ['when', 'flavor', 'size', 'delta', 'balance_after', 'reason', 'order_id'],
      ...this.movements().map((m) => [
        toIsoDate(m.createdAt), m.variantName, m.size, m.delta, m.balanceAfter,
        m.reason, m.orderId ?? '',
      ]),
    ];
    downloadCsv(toCsv(rows), csvFilename('stock-movements'));
  }

  exportDrift(): void {
    const rows = [
      ['flavor', 'size', 'stored', 'ledger_says', 'drift'],
      ...this.drift().map((d) => [d.variantName, d.size, d.stored, d.logged, d.drift]),
    ];
    downloadCsv(toCsv(rows), csvFilename('stock-reconciliation'));
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
    }
  }

  async repair(order: Order): Promise<void> {
    this.repairingId.set(order.id);
    try {
      await this.orderService.repairStockRestock(order.id);
      this.unrestoredOrders.update((rows) => rows.filter((o) => o.id !== order.id));
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