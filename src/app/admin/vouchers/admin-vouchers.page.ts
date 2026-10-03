// src/app/admin/vouchers/admin-vouchers.page.ts
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
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import {
  Voucher,
  VoucherType,
  voucherUsability,
  type RedemptionStats,
} from '../../core/models/voucher.model';
import { MAX_PERCENT_DISCOUNT } from '../../core/models/voucher.model';
import { toCsv, csvFilename } from '../../core/logic/csv';
import { CsvExportService } from '../../core/services/csv-export.service';
import {
  Firestore,
  collection,
  getDocs,
  setDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  deleteField,
} from '@angular/fire/firestore';

/** `YYYY-MM-DD` for a stored epoch ms, or '' when there is no date. */
function toDateInput(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
    AppFooterComponent,
  ],
  templateUrl: './admin-vouchers.page.html',
  styleUrls: ['./admin-vouchers.page.scss'],
})
export class AdminVouchersPage implements OnInit {
  private firestore = inject(Firestore);
  private alertCtrl = inject(AlertController);
  private toast = inject(ToastController);
  private csvExport = inject(CsvExportService);

  vouchers = signal<Voucher[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');
  busyCode = signal<string | null>(null);

  // Editor state. A signal per field rather than a form object so the template
  // can bind with ngModel without a forms framework.
  editing = signal(false);
  originalId = signal<string | null>(null);
  code = '';
  type: VoucherType = 'percent';
  value = 10;
  minOrder = 0;
  isActive = true;

  // ── Redemption limits (new) ──────────────────────────────────────────────
  /* Empty string means "no limit" rather than 0, because 0 is a meaningful
     value here: a maxRedemptions of 0 means the code is already spent out. The
     distinction is lost the moment it is stored as a number, so it is preserved
     on the way in. */
  maxRedemptions = '';
  perCustomerLimit = '';
  /** ISO date strings, because that is what <input type="date"> speaks. */
  startsAtDate = '';
  expiresAtDate = '';

  /**
   * Per-code performance, joined from delivered orders.
   *
   * `orders.discountAmount` and `orders.voucherCode` already existed, so this is
   * a read that was always possible and never made — the question "which code
   * actually sells?" had no answer until now. DELIVERED only, matching the
   * analytics page: a cancelled or in-progress order is not revenue, and
   * counting one would make a discount look more effective than it was.
   */
  readonly stats = signal<Record<string, { orders: number; discount: number; revenue: number }>>(
    {},
  );
  readonly metricsLoading = signal(false);

  /** Mirrors MAX_PERCENT_DISCOUNT, which the cart service enforces server-side. */
  readonly maxPercent = MAX_PERCENT_DISCOUNT;

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

  /**
   * A worked example of what the voucher does.
   *
   * The question an admin actually has when creating a discount is "what will a
   * customer pay", and neither the percent nor the fixed-amount number answers
   * it on its own. This states it in words against a ₱500 basket, and shows the
   * minimum-order case too when one is set — because a voucher that does nothing
   * below ₱X is the easiest mistake to make here.
   */
  readonly example = computed(() => {
    const type = this.type;
    const value = Number(this.value);
    const minOrder = Number(this.minOrder);
    if (!Number.isFinite(value) || value <= 0) return null;

    const BASKET = 500;
    const apply = (subtotal: number): number => {
      if (minOrder > 0 && subtotal < minOrder) return subtotal;
      if (type === 'percent') {
        const discount = Math.round(subtotal * (Math.min(value, this.maxPercent) / 100));
        return subtotal - discount;
      }
      return subtotal - Math.min(value, subtotal);
    };

    const discounted = apply(BASKET);
    return {
      basket: BASKET,
      total: discounted,
      saved: BASKET - discounted,
      belowMinimum: minOrder > 0 && BASKET < minOrder,
      minOrder,
    };
  });

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
    void this.loadMetrics();
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

  startCreate(): void {
    this.editing.set(true);
    this.originalId.set(null);
    this.code = '';
    this.type = 'percent';
    this.value = 10;
    this.minOrder = 0;
    this.isActive = true;
    this.maxRedemptions = '';
    this.perCustomerLimit = '';
    this.startsAtDate = '';
    this.expiresAtDate = '';
  }

  startEdit(voucher: Voucher): void {
    this.editing.set(true);
    this.originalId.set(voucher.id);
    this.code = voucher.code;
    this.type = voucher.type;
    this.value = voucher.value;
    this.minOrder = voucher.minOrder ?? 0;
    this.isActive = voucher.isActive;
    // Back to '' for "no limit", so an absent field does not open as 0 — which
    // would save a voucher that was previously uncapped into one that is spent.
    this.maxRedemptions =
      typeof voucher.maxRedemptions === 'number' ? String(voucher.maxRedemptions) : '';
    this.perCustomerLimit =
      typeof voucher.perCustomerLimit === 'number' ? String(voucher.perCustomerLimit) : '';
    this.startsAtDate = toDateInput(voucher.startsAt);
    this.expiresAtDate = toDateInput(voucher.expiresAt);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.originalId.set(null);
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
   */
  async loadMetrics(): Promise<void> {
    this.metricsLoading.set(true);
    try {
      const snap = await getDocs(
        query(collection(this.firestore, 'orders'), where('status', '==', 'delivered'), limit(500)),
      );
      const out: Record<string, { orders: number; discount: number; revenue: number }> = {};
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
      this.stats.set(out);
    } catch {
      // Metrics are an enhancement on top of a working editor; failing to read
      // them must not blank the voucher list.
      this.stats.set({});
    } finally {
      this.metricsLoading.set(false);
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

  /** Best sellers first, so the report answers "what works?" unprompted. */
  readonly ranked = computed(() =>
    this.vouchers()
      .map((v) => this.statsFor(v))
      .sort((a, b) => {
        // Untracked codes sort last rather than first: sorting on 0 would put a
        // code with no data above one that demonstrably sold 40 times.
        if (a.untracked !== b.untracked) return a.untracked ? 1 : -1;
        return (b.discountGiven || b.revenue) - (a.discountGiven || a.revenue);
      }),
  );

  async exportReport(): Promise<void> {
    const rows = [
      ['code', 'state', 'uses', 'delivered_orders', 'discount_given', 'revenue_affected'],
      ...this.ranked().map((s) => [
        s.voucher.code,
        s.state,
        s.untracked ? 'not tracked' : (s.uses ?? 0),
        s.orders,
        s.discountGiven,
        s.revenue,
      ]),
    ];
    const result = await this.csvExport.export(toCsv(rows), csvFilename('voucher-performance'));
    void this.toast
      .create({
        message: result.ok
          ? 'Exported voucher performance.'
          : `Export failed${result.error ? `: ${result.error}` : ''}.`,
        color: result.ok ? 'success' : 'danger',
        duration: result.ok ? 2200 : 3200,
        position: 'top',
      })
      .then((t) => t.present());
  }

  /**
   * Validates before writing.
   *
   * The client checks here are for the ADMIN's benefit — an immediate, specific
   * message beats a round-trip rejection. They are not the security boundary:
   * `calculateDiscount` clamps a percent to 90 and a fixed value to the subtotal
   * regardless, so a hand-crafted write cannot produce a negative total. The real
   * boundary is that only an admin can write here at all.
   */
  private validate(): string | null {
    const normalized = this.code.trim().toUpperCase();
    if (!normalized) return 'Enter a voucher code.';
    if (!/^[A-Z0-9_-]{3,24}$/.test(normalized)) {
      return 'Use 3–24 letters, numbers, dashes or underscores.';
    }
    if (!Number.isFinite(this.value) || this.value <= 0) {
      return 'Enter a discount value greater than zero.';
    }
    if (this.type === 'percent' && this.value > this.maxPercent) {
      return `A percentage discount cannot exceed ${this.maxPercent}%.`;
    }
    if (this.minOrder < 0) return 'Minimum order cannot be negative.';
    // A window that ends before it starts can never apply, and it is always a
    // typo rather than an intention.
    if (
      this.startsAtDate &&
      this.expiresAtDate &&
      this.fromDateInput(this.expiresAtDate) <= this.fromDateInput(this.startsAtDate)
    ) {
      return 'The expiry date must be after the start date.';
    }
    for (const [label, raw] of [
      ['Max redemptions', this.maxRedemptions],
      ['Per-customer limit', this.perCustomerLimit],
    ] as const) {
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) return `${label} must be a whole number of 0 or more.`;
    }
    return null;
  }

  private toCount(raw: string): number {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  /**
   * The stored redemption count for the code being edited, or null when the code
   * predates tracking.
   *
   * Read live from `vouchers` rather than copied into a field, so a redemption
   * that lands while the editor is open is reflected rather than overwritten on
   * save.
   */
  usageOf(): number | null {
    const id = this.originalId();
    if (!id) return null;
    const found = this.vouchers().find((v) => v.id === id);
    return typeof found?.usageCount === 'number' ? found.usageCount : null;
  }

  /** `YYYY-MM-DD` (what the date input speaks) → epoch ms at local midnight. */
  private fromDateInput(iso: string): number {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
  }

  async save(): Promise<void> {
    const problem = this.validate();
    if (problem) {
      this.errorMessage.set(problem);
      return;
    }

    const normalized = this.code.trim().toUpperCase();
    const originalId = this.originalId();

    // Codes are the user-facing identity, so a duplicate is rejected up front
    // with a clear message. The document id is derived from the code, so a
    // collision would otherwise silently overwrite the existing voucher.
    if (!originalId) {
      const clash = this.vouchers().find((v) => v.code === normalized);
      if (clash) {
        this.errorMessage.set(`${normalized} already exists.`);
        return;
      }
    }

    this.busyCode.set(normalized);
    this.errorMessage.set('');
    try {
      const payload: Record<string, unknown> = {
        code: normalized,
        type: this.type,
        value: this.value,
        minOrder: this.minOrder > 0 ? this.minOrder : null,
        isActive: this.isActive,
        // `deleteField` on an emptied limit, NOT a stored 0. A voucher with no
        // `maxRedemptions` is uncapped; one stored as 0 is spent out and would
        // silently stop working the first time an admin cleared the field.
        ...(this.maxRedemptions === ''
          ? { maxRedemptions: deleteField() }
          : { maxRedemptions: this.toCount(this.maxRedemptions) }),
        ...(this.perCustomerLimit === ''
          ? { perCustomerLimit: deleteField() }
          : { perCustomerLimit: this.toCount(this.perCustomerLimit) }),
        ...(this.startsAtDate
          ? { startsAt: this.fromDateInput(this.startsAtDate) }
          : { startsAt: deleteField() }),
        ...(this.expiresAtDate
          ? { expiresAt: this.fromDateInput(this.expiresAtDate) }
          : { expiresAt: deleteField() }),
      };
      // A code change means a different document: keyed by code, so editing
      // SCOOP10 to SCOOP20 must remove the old one. Otherwise the old code would
      // linger, still valid, and invisible in the list.
      //
      // The redemption count is CARRIED OVER on a rename. It is a property of the
      // PROMOTION, not of the spelling; losing it would let an admin reset a
      // spent-out code's cap by renaming it, which is the one thing a cap is for.
      const targetId = normalized;
      if (originalId && originalId !== targetId) {
        const previous = this.vouchers().find((v) => v.id === originalId);
        if (typeof previous?.usageCount === 'number') {
          payload['usageCount'] = previous.usageCount;
        }
        await deleteDoc(doc(this.firestore, `vouchers/${originalId}`));
      }
      await setDoc(doc(this.firestore, `vouchers/${targetId}`), payload, { merge: true });

      this.cancelEdit();
      await this.load();
      await this.toast
        .create({
          message: `${normalized} saved.`,
          color: 'success',
          duration: 2000,
          position: 'top',
        })
        .then((t) => t.present());
    } catch (err) {
      this.errorMessage.set(describeFirestoreError('the voucher', err));
    } finally {
      this.busyCode.set(null);
    }
  }

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
