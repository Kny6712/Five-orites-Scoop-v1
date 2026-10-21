// src/app/features/admin/vouchers/voucher-form-modal.component.ts
// Five-orites Scoop — Create a voucher code, in a modal overlay.
//
// Replaces the inline `<section class="editor">` panel that sat inside
// ion-content and pushed the voucher list down whenever it opened. A modal does
// not disturb the list beneath it.
//
// Follows the house modal pattern used by edit-user-modal.component.ts: an
// `@Input()` setter seeds the form (componentProps land after construction,
// so reading the input in the constructor yields undefined), save() dismisses
// `{ saved: true }` only after a successful Firestore write, errors show inline
// via the `error()` signal, and cancel() dismisses with no data so the
// presenter does nothing.
//
// Create-only for now: `voucher` is null when opening from "+ New". The input
// is still accepted (null = create) so the save path stays shared if an edit
// entry point is added later.

import { Component, inject, Input, signal, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonToggle,
  ModalController,
} from '@ionic/angular/standalone';

import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { Firestore, doc, setDoc, deleteDoc, deleteField } from '@angular/fire/firestore';
import { describeFirestoreError } from '@core/logic/firestore-error';
import {
  Voucher,
  VoucherType,
  MAX_PERCENT_DISCOUNT,
  voucherDate,
} from '@core/models/voucher.model';

/** `YYYY-MM-DD` (what the date input speaks) → epoch ms at local midnight. */
function fromDateInput(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

@Component({
  selector: 'app-voucher-form-modal',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [
    CommonModule,
    FormsModule,
    IonButton,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonToggle,
    AppIconComponent,
  ],
  templateUrl: './voucher-form-modal.component.html',
  styleUrls: ['./voucher-form-modal.component.scss'],
})
export class VoucherFormModalComponent {
  private readonly modalCtrl = inject(ModalController);
  private readonly firestore = inject(Firestore);

  @Input()
  set voucher(value: Voucher | null) {
    this._voucher = value;
    this.seedForm();
  }
  get voucher(): Voucher | null {
    return this._voucher;
  }
  private _voucher: Voucher | null = null;

  /**
   * The codes of every OTHER voucher in the shop.
   *
   * The document id IS the code, so saving a code that already exists writes
   * straight over that voucher — the second code is gone, with no warning. That
   * was always true on the create path; it becomes far easier to do by accident
   * once a rename is on the table, because renaming A to B when B already
   * exists would overwrite B AND delete A.
   *
   * The page supplies this list with the voucher being edited left out, so
   * saving a code over itself is not a collision.
   */
  @Input() existingCodes: string[] = [];

  protected readonly saving = signal(false);
  protected readonly error = signal('');

  /** Mirrors MAX_PERCENT_DISCOUNT, which the cart service enforces server-side. */
  readonly maxPercent = MAX_PERCENT_DISCOUNT;

  protected code = '';
  protected type: VoucherType = 'percent';
  protected value = 10;
  protected minOrder = 0;
  protected isActive = true;
  protected maxRedemptions = '';
  protected perCustomerLimit = '';
  protected startsAtDate = '';
  protected expiresAtDate = '';

  private seedForm(): void {
    const v = this.voucher;
    if (!v) {
      this.code = '';
      this.type = 'percent';
      this.value = 10;
      this.minOrder = 0;
      this.isActive = true;
      this.maxRedemptions = '';
      this.perCustomerLimit = '';
      this.startsAtDate = '';
      this.expiresAtDate = '';
      return;
    }
    this.code = v.code;
    this.type = v.type;
    this.value = v.value;
    this.minOrder = v.minOrder ?? 0;
    this.isActive = v.isActive;
    this.maxRedemptions = typeof v.maxRedemptions === 'number' ? String(v.maxRedemptions) : '';
    this.perCustomerLimit =
      typeof v.perCustomerLimit === 'number' ? String(v.perCustomerLimit) : '';
    this.startsAtDate = voucherDate(v.startsAt);
    this.expiresAtDate = voucherDate(v.expiresAt);
  }

  protected get example(): {
    basket: number;
    total: number;
    saved: number;
    belowMinimum: boolean;
    minOrder: number;
  } | null {
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
  }

  private validate(): string | null {
    const normalized = this.code.trim().toUpperCase();
    if (!normalized) return 'Enter a voucher code.';
    if (!/^[A-Z0-9_-]{3,24}$/.test(normalized)) {
      return 'Use 3–24 letters, numbers, dashes or underscores.';
    }
    if (this.existingCodes.some((c) => c.toUpperCase() === normalized)) {
      return `A voucher with the code ${normalized} already exists.`;
    }
    if (!Number.isFinite(this.value) || this.value <= 0) {
      return 'Enter a discount value greater than zero.';
    }
    if (this.type === 'percent' && this.value > this.maxPercent) {
      return `A percentage discount cannot exceed ${this.maxPercent}%.`;
    }
    if (this.minOrder < 0) return 'Minimum order cannot be negative.';
    if (
      this.startsAtDate &&
      this.expiresAtDate &&
      fromDateInput(this.expiresAtDate) <= fromDateInput(this.startsAtDate)
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

  protected async save(): Promise<void> {
    if (this.saving()) return;
    const problem = this.validate();
    if (problem) {
      this.error.set(problem);
      return;
    }

    const normalized = this.code.trim().toUpperCase();
    const targetId = normalized;

    // The document id IS the code, so a renamed voucher is a NEW document. The
    // old one has to be removed by hand, or the shop ends up with two live
    // codes for one voucher and the list shows both.
    const originalId = this.voucher?.id ?? null;
    const renamed = originalId !== null && originalId !== normalized;

    this.saving.set(true);
    this.error.set('');
    try {
      const payload: Record<string, unknown> = {
        code: normalized,
        type: this.type,
        value: this.value,
        minOrder: this.minOrder > 0 ? this.minOrder : null,
        isActive: this.isActive,
        // Carried across a rename. Without it the new document would have no
        // usageCount at all, and the code would come back reading "Usage not
        // tracked" — a code with a redemption history that reports none.
        ...(this.voucher?.usageCount !== undefined ? { usageCount: this.voucher.usageCount } : {}),
        ...(this.maxRedemptions === ''
          ? { maxRedemptions: deleteField() }
          : { maxRedemptions: this.toCount(this.maxRedemptions) }),
        ...(this.perCustomerLimit === ''
          ? { perCustomerLimit: deleteField() }
          : { perCustomerLimit: this.toCount(this.perCustomerLimit) }),
        ...(this.startsAtDate
          ? { startsAt: fromDateInput(this.startsAtDate) }
          : { startsAt: deleteField() }),
        ...(this.expiresAtDate
          ? { expiresAt: fromDateInput(this.expiresAtDate) }
          : { expiresAt: deleteField() }),
      };
      await setDoc(doc(this.firestore, `vouchers/${targetId}`), payload, { merge: true });

      // Write the new document FIRST, then remove the old one. A failure
      // between the two leaves two codes, which is recoverable; deleting first
      // and failing to write would leave the shop with neither.
      if (renamed && originalId !== null) {
        await deleteDoc(doc(this.firestore, `vouchers/${originalId}`));
      }

      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      this.error.set(describeFirestoreError('the voucher', err));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.modalCtrl.dismiss();
  }
}
