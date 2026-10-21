// src/app/features/admin/vouchers/admin-vouchers.page.ts
// Five-orites Scoop — Admin voucher management
//
// WHY THIS PAGE EXISTS
// The `vouchers` collection had an implemented rule (`allow write: if isAdmin()`)
// with NO caller anywhere in src/ — and no seeder. The hardcoded BUILT_IN_VOUCHERS
// fallback was deliberately removed from VoucherService as a discount-control fix
// (it turned any rules/offline error into a client-computed discount). The
// combined result: in a fresh production database the collection is empty, and the
// customer-facing grab-a-code cards would render an empty list with no way for
// anyone to change that except the Firebase console.
//
// This page is the missing caller. It is the only surface in the app that can
// create a discount, and firestore.rules confines it to admins — pinned by
// tests/firestore.rules.test.ts, which asserts a customer cannot create, edit or
// delete a voucher.

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonButton,
  IonItem,
  IonLabel,
  IonInput,
  IonToggle,
  IonSelect,
  IonSelectOption,
  IonSearchbar,
  IonSkeletonText,
  AlertController,
  ToastController,
  ModalController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { AlertBannerComponent } from '@shared/components/ui/alert-banner.component';
import { EmptyStateComponent } from '@shared/components/ui/empty-state.component';
import { PaginationComponent } from '@shared/components/ui/pagination.component';
import { AdminFooterComponent } from '@shared/components/admin/admin-footer.component';
import { VoucherFormModalComponent } from './voucher-form-modal.component';
import { describeFirestoreError } from '@core/logic/firestore-error';
import { CsvExportService } from '@core/services/commerce/csv-export.service';
import { csvFilename, toCsv } from '@core/logic/csv/cell';
import {
  Voucher,
  voucherDate,
  voucherUsability,
  type RedemptionStats,
} from '@core/models/voucher.model';
import {
  Firestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
} from '@angular/fire/firestore';

/** Per-code totals joined from delivered orders. */
type VoucherMetrics = Record<string, { orders: number; discount: number; revenue: number }>;

/**
 * Delivered orders the performance metrics are measured over, newest first.
 *
 * DOWN FROM 500, AND NOW ORDERED. The report answers "which code actually sells",
 * which is a ranking of recent behaviour rather than a lifetime total, and an
 * unordered `limit` was in any case an arbitrary slice — the docs in whatever
 * order Firestore happened to return, which made the cap a lie of omission. An
 * explicit `orderBy('createdAt','desc')` turns the same read into "the most
 * recent N delivered orders", and it costs nothing extra: the
 * `orders(status ASC, createdAt DESC)` composite index in firestore.indexes.json
 * already serves `where('status', '==', 'delivered') + orderBy('createdAt')`,
 * which is the shape `OrderService` uses everywhere else.
 */
const METRICS_WINDOW = 200;

/**
 * Session memo for `loadMetrics`.
 *
 * Every visit to this page used to re-read up to 500 order documents to colour
 * one chip per voucher row — pure decoration around a working editor, billed per
 * document, and the most expensive thing in the app to merely LOOK at. The
 * aggregate is a performance report, not live state: it only changes when an
 * order is delivered, which happens elsewhere. Holding it for the life of the
 * app session makes a revisit cost zero reads.
 *
 * WHAT THE COST OF THAT IS: a code redeemed after the first visit does not move
 * the numbers until the app is reloaded, and the CSV export carries the same
 * snapshot. Deliberate — an hour-old ranking beats 200 reads per page view. A
 * FAILED read is deliberately not memoised, so the error banner's retry can
 * still succeed.
 */
let metricsMemo: VoucherMetrics | null = null;

@Component({
  selector: 'app-admin-vouchers',
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
    IonItem,
    IonLabel,
    IonInput,
    IonToggle,
    IonSelect,
    IonSelectOption,
    IonSearchbar,
    IonSkeletonText,
    DatePipe,
    AppIconComponent,
    AlertBannerComponent,
    EmptyStateComponent,
    PaginationComponent,
    AdminFooterComponent,
    VoucherFormModalComponent,
  ],
  templateUrl: './admin-vouchers.page.html',
  styleUrls: ['./admin-vouchers.page.scss'],
})
export class AdminVouchersPage implements OnInit {
  private firestore = inject(Firestore);
  private alertCtrl = inject(AlertController);
  private toast = inject(ToastController);
  private modalCtrl = inject(ModalController);
  private csvExport = inject(CsvExportService);

  vouchers = signal<Voucher[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');
  busyCode = signal<string | null>(null);

  /**
   * Per-code performance, joined from delivered orders.
   *
   * `orders.discountAmount` and `orders.voucherCode` already existed, so this is
   * a read that was always possible and never made — the question "which code
   * actually sells?" had no answer until now. DELIVERED only, matching the
   * analytics page: a cancelled or in-progress order is not revenue, and
   * counting one would make a discount look more effective than it was.
   *
   * A WINDOW, not a lifetime: `METRICS_WINDOW` most recent delivered orders.
   */
  readonly stats = signal<VoucherMetrics>({});

  /**
   * The in-flight performance join, so the export can wait for it.
   *
   * The export's last four columns are measured, not stored — they come from
   * the join. Exporting while the join is still running would write zeros into
   * a file that says "0 delivered orders", which is a claim about the shop
   * rather than a gap in the file. So the export waits for this promise
   * instead of racing it. It resolves immediately on a session hit, because the
   * metrics are memoised.
   */
  private metricsPromise: Promise<void> = Promise.resolve();

  // ── Search & status filter ────────────────────────────────────────────────
  /* This page had no search and no filter: it listed every voucher, sorted by
     code, and an admin with thirty codes scrolled to find one. Since a voucher
     is identified by its code, a search box is the obvious control and it was
     simply missing. */
  readonly query = signal('');
  readonly showInactiveOnly = signal(false);

  readonly filteredVouchers = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.vouchers().filter((v) => {
      if (this.showInactiveOnly() && v.isActive) return false;
      if (!q) return true;
      return v.code.toLowerCase().includes(q);
    });
  });

  readonly activeCount = computed(() => this.vouchers().filter((v) => v.isActive).length);
  readonly inactiveCount = computed(() => this.vouchers().length - this.activeCount());

  onQuery(event: CustomEvent): void {
    this.query.set((event.detail.value ?? '') as string);
    this.page.set(1);
  }

  clearFilters(): void {
    this.query.set('');
    this.showInactiveOnly.set(false);
    this.page.set(1);
  }

  toggleStatusFilter(): void {
    this.showInactiveOnly.set(!this.showInactiveOnly());
    this.page.set(1);
  }

  /** Copy a code to the clipboard, for handing it to a customer directly. */
  async copyCode(voucher: Voucher): Promise<void> {
    try {
      await navigator.clipboard.writeText(voucher.code);
      await this.toast
        .create({
          message: `${voucher.code} copied.`,
          color: 'success',
          duration: 1600,
          position: 'top',
        })
        .then((t) => t.present());
    } catch {
      // Clipboard access is denied in some embedded browsers and over plain HTTP.
      // A toast saying so is better than a button that appears to do nothing.
      await this.toast
        .create({
          message: 'Could not copy — select the code and copy it manually.',
          color: 'warning',
          duration: 2500,
          position: 'top',
        })
        .then((t) => t.present());
    }
  }

  // ── Paging ────────────────────────────────────────────────────────────────
  readonly PAGE_SIZE = 12;
  readonly page = signal(1);

  readonly pagedVouchers = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.filteredVouchers().slice(start, start + this.PAGE_SIZE);
  });

  onPageChange(next: number): void {
    this.page.set(next);
  }

  ngOnInit(): void {
    void this.load();
    // Kept, not just fired: the export waits on it so the file's measured
    // columns carry numbers rather than zeros.
    this.metricsPromise = this.loadMetrics();
  }

  /**
   * Re-read the collection.
   *
   * Public because the error banner's retry action calls it, and private because
   * nothing outside this page should be reaching in to trigger a refresh.
   */
  async load(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    try {
      // Reads ALL vouchers, not just active ones — an admin needs to see the
      // deactivated ones too, otherwise a code switched off becomes invisible and
      // unrecoverable from the UI.
      const snap = await getDocs(collection(this.firestore, 'vouchers'));
      this.vouchers.set(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Voucher)
          .sort((a, b) => a.code.localeCompare(b.code)),
      );
    } catch (err) {
      this.errorMessage.set(describeFirestoreError('vouchers', err));
    } finally {
      this.isLoading.set(false);
    }
  }

  async startCreate(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: VoucherFormModalComponent,
      componentProps: { voucher: null, existingCodes: this.codesOfAll() },
      cssClass: 'large-sheet-modal',
    });
    await modal.present();
    const result = await modal.onDidDismiss();
    if (result?.data?.saved) {
      await this.load();
      await this.toast
        .create({
          message: 'Voucher created.',
          color: 'success',
          duration: 2000,
          position: 'top',
        })
        .then((t) => t.present());
    }
  }

  /**
   * The codes of every voucher in the shop, for the collision check.
   *
   * From the UNFILTERED list, not the filtered one: the search box narrows what
   * the owner is LOOKING at, and it must not decide which codes exist.
   */
  private codesOfAll(): string[] {
    return this.vouchers().map((v) => v.code);
  }

  /**
   * Opens the voucher editor on an EXISTING code.
   *
   * The same modal the "+ New" button opens, seeded with the record — the form
   * component already accepted a voucher for exactly this and the only thing
   * missing was the entry point. Editing is therefore not a second dialog: it is
   * the same one with a different question behind it.
   *
   * The toast says "updated" rather than "created" because the two paths are
   * otherwise identical, and telling the owner they created a voucher they
   * merely edited would be a lie about what changed.
   */
  async startEdit(voucher: Voucher): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: VoucherFormModalComponent,
      componentProps: {
        voucher,
        // Every code EXCEPT the one being edited, so saving a code over itself
        // is not treated as a collision.
        existingCodes: this.codesOfAll().filter((c) => c !== voucher.code),
      },
      cssClass: 'large-sheet-modal',
    });
    await modal.present();
    const result = await modal.onDidDismiss();
    if (result?.data?.saved) {
      await this.load();
      await this.toast
        .create({
          message: 'Voucher updated.',
          color: 'success',
          duration: 2000,
          position: 'top',
        })
        .then((t) => t.present());
    }
  }

  /**
   * Exports the voucher's own file.
   *
   * WHAT REPLACED THE IMPORT MODAL
   * This button used to open a "Bulk import vouchers" sheet: a CSV picker, a
   * template download and a performance report. That sheet is gone — the owner
   * asked for it, and a toolbar button that opens a dialog whose title is a
   * different verb than the button's own label is a trap, not a feature.
   *
   * So the button now does what it says: it writes the shop's vouchers to a
   * CSV. Everything the sheet could do that still matters is in the file —
   * every code, with its discount, its caps, its window, and how it has sold.
   *
   * THE COLUMNS ARE THE TEMPLATE'S.
   * Same names, same order, same `YYYY-MM-DD` dates as the old
   * `VOUCHER_CSV_TEMPLATE`, so a file exported here has the shape the shop's
   * CSV contract describes.
   *
   * There is NO IMPORTER BEHIND IT ANY MORE. The bulk-import sheet was
   * removed at the owner's request, and the parser that used to read these
   * files went with it — 394 lines of reachable-looking code that no page
   * could open. The columns are kept in that shape so a file exported today
   * can still be read by whatever tool the shop already has, and so a future
   * importer does not have to learn a second format.
   *
   * EVERY VOUCHER, NOT THE FILTERED ONES. The filter narrows what the owner is
   * LOOKING at; a file that silently contained only the codes matching the
   * search box would be a trap of its own — the owner would export while a
   * search was on and get a file they did not expect. Every other admin export
   * mirrors the list it was clicked from, and this one mirrors the whole shop.
   */
  async exportCsv(): Promise<void> {
    // Wait for the performance join first: the file's last four columns are
    // measured, and a file written mid-join would say "0 delivered orders"
    // about a code that has sold all month.
    await this.metricsPromise;

    const result = await this.csvExport.export(toCsv(this.exportRows()), csvFilename('vouchers'));
    const count = this.vouchers().length;
    void this.toast
      .create({
        message: result.ok
          ? `Exported ${count} voucher${count === 1 ? '' : 's'}.`
          : `Export failed${result.error ? `: ${result.error}` : ''}.`,
        color: result.ok ? 'success' : 'danger',
        duration: 3200,
        position: 'top',
      })
      .then((t) => t.present());
  }

  /**
   * Joins voucher codes to the orders that used them.
   *
   * Deliberately ONE query for all codes rather than one per code: a shop with
   * thirty codes would otherwise fire thirty reads, and Firestore bills and
   * rate-limits per document read. `voucherCode` is carried on the order, so the
   * whole join happens here in memory.
   *
   * `stats` is keyed by CODE rather than by document id, because that is what an
   * order carries — and because the document id changes when a code is renamed.
   *
   * READ COST: one query, `METRICS_WINDOW` documents, and then memoised for the
   * session (see `metricsMemo`) — so this is a once-per-session bill rather than
   * a bill per visit. When the window comes back full the numbers cover only the
   * most recent orders, and since this table has no room to say so, the page
   * toasts the window instead of quietly reporting a lifetime total it does not
   * have.
   */
  async loadMetrics(): Promise<void> {
    if (metricsMemo) {
      // Session hit: the aggregate cannot have moved in a way this page caused,
      // so this is free.
      this.stats.set(metricsMemo);
      return;
    }
    try {
      const snap = await getDocs(
        query(
          collection(this.firestore, 'orders'),
          where('status', '==', 'delivered'),
          orderBy('createdAt', 'desc'),
          limit(METRICS_WINDOW),
        ),
      );
      const out: VoucherMetrics = {};
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        const code = data['voucherCode'] as string | null;
        if (!code) continue;
        const row = out[code] ?? { orders: 0, discount: 0, revenue: 0 };
        row.orders += 1;
        row.discount += (data['discountAmount'] as number) ?? 0;
        row.revenue += (data['totalAmount'] as number) ?? 0;
        out[code] = row;
      }
      metricsMemo = out;
      this.stats.set(out);
      if (snap.size >= METRICS_WINDOW) {
        // The only honest way to say it from this file: the table has no caption
        // for the window, and a chip reading "12 orders · ₱340 off" implies a
        // lifetime figure it is not.
        await this.toast
          .create({
            message: `Voucher performance covers the ${METRICS_WINDOW} most recent delivered orders.`,
            color: 'warning',
            duration: 3200,
            position: 'top',
          })
          .then((t) => t.present());
      }
    } catch {
      // Metrics are an enhancement on top of a working editor; failing to read
      // them must not blank the voucher list. Not memoised, so a retry re-reads.
      this.stats.set({});
    }
  }

  /** A voucher with its measured performance, for one table row. */
  statsFor(voucher: Voucher): RedemptionStats {
    const m = this.stats()[voucher.code];
    const uses = typeof voucher.usageCount === 'number' ? voucher.usageCount : null;
    const usability = voucherUsability(voucher);
    const state: RedemptionStats['state'] = !voucher.isActive
      ? 'inactive'
      : !usability.usable && usability.reason === 'not_started'
        ? 'scheduled'
        : !usability.usable && usability.reason === 'expired'
          ? 'expired'
          : !usability.usable && usability.reason === 'exhausted'
            ? 'exhausted'
            : 'live';
    return {
      voucher,
      uses,
      // A code with no usageCount has not been counted. Reporting that as "0
      // uses" would make an untracked code look like a dud.
      untracked: uses === null,
      exhausted: !usability.usable && usability.reason === 'exhausted',
      discountGiven: m?.discount ?? 0,
      orders: m?.orders ?? 0,
      revenue: m?.revenue ?? 0,
      state,
    };
  }

  /**
   * The export, as CSV rows.
   *
   * ONE ROW PER VOUCHER, in the order the page lists them (by code), because a
   * file that reads in a different order from the screen it came off is a file
   * the owner has to re-sort before they can check it against the screen.
   *
   * The voucher's own fields come first and the measured ones follow, so the
   * file answers two questions in one: "what codes do I have?" and "which ones
   * sell?" — the second was the performance report the import sheet used to
   * own.
   *
   * "not tracked" rather than 0 for a code with no usageCount: a code nobody
   * has counted is a different statement from a code nobody has used, and the
   * row on screen says the same thing.
   */
  readonly exportRows = computed<readonly (readonly (string | number)[])[]>(() => [
    [
      'code',
      'type',
      'value',
      'min_order',
      'max_redemptions',
      'per_customer_limit',
      'starts_at',
      'expires_at',
      'is_active',
      'state',
      'uses',
      'delivered_orders',
      'discount_given',
      'revenue_affected',
    ],
    ...this.vouchers().map((v) => {
      const s = this.statsFor(v);
      return [
        v.code,
        v.type,
        v.value,
        v.minOrder ?? '',
        v.maxRedemptions ?? '',
        v.perCustomerLimit ?? '',
        voucherDate(v.startsAt),
        voucherDate(v.expiresAt),
        v.isActive ? 'yes' : 'no',
        s.state,
        s.untracked ? 'not tracked' : (s.uses ?? 0),
        s.orders,
        s.discountGiven,
        s.revenue,
      ];
    }),
  ]);

  /**
   * Flip a voucher's active state.
   *
   * Deliberately not confirmed. This is the reversible control — Delete is the
   * irreversible one — so putting a dialog on it would train people to dismiss
   * dialogs without reading them, which is exactly the habit that makes the
   * Delete confirmation useless.
   */
  async toggleActive(voucher: Voucher): Promise<void> {
    this.busyCode.set(voucher.code);
    try {
      await updateDoc(doc(this.firestore, `vouchers/${voucher.id}`), {
        isActive: !voucher.isActive,
      });
      await this.load();
    } catch (err) {
      this.errorMessage.set(describeFirestoreError('that voucher', err));
    } finally {
      this.busyCode.set(null);
    }
  }

  /**
   * Deletes a voucher outright.
   *
   * Confirmed with the code spelled out, because unlike deactivating this is
   * irreversible and there is no undo — a voucher can be recreated by hand, but
   * any order that referenced this code keeps its recorded `voucherCode` string
   * with nothing behind it.
   */
  async remove(voucher: Voucher): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: `Delete ${voucher.code}?`,
      message:
        'This removes the code permanently. Customers who already used it are unaffected, but it cannot be re-enabled afterwards.',
      buttons: [
        { text: 'Keep', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            this.busyCode.set(voucher.code);
            try {
              await deleteDoc(doc(this.firestore, `vouchers/${voucher.id}`));
              await this.load();
            } catch (err) {
              this.errorMessage.set(describeFirestoreError('that voucher', err));
            } finally {
              this.busyCode.set(null);
            }
          },
        },
      ],
    });
    await alert.present();
  }

  describe(voucher: Voucher): string {
    return voucher.type === 'percent' ? `${voucher.value}% off` : `₱${voucher.value} off`;
  }
}
