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

import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonButton, IonItem, IonLabel,
  IonInput, IonToggle, IonSelect, IonSelectOption, IonSkeletonText,
  AlertController, ToastController, ModalController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { VoucherService } from '../../core/services/voucher.service';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { Voucher, VoucherType } from '../../core/models/voucher.model';
import { MAX_PERCENT_DISCOUNT } from '../../core/models/voucher.model';
import {
  Firestore, collection, getDocs, setDoc, doc, updateDoc, deleteDoc, query, where,
} from '@angular/fire/firestore';

@Component({
  selector: 'app-admin-vouchers',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonButton, IonItem, IonLabel,
    IonInput, IonToggle, IonSelect, IonSelectOption, IonSkeletonText,
    AppIconComponent, AlertBannerComponent,
  ],
  templateUrl: './admin-vouchers.page.html',
  styleUrls: ['./admin-vouchers.page.scss'],
})
export class AdminVouchersPage implements OnInit {
  private firestore = inject(Firestore);
  private voucherService = inject(VoucherService);
  private alertCtrl = inject(AlertController);
  private toast = inject(ToastController);
  private modalCtrl = inject(ModalController);

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

  /** Mirrors MAX_PERCENT_DISCOUNT, which the cart service enforces server-side. */
  readonly maxPercent = MAX_PERCENT_DISCOUNT;

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    try {
      // Reads ALL vouchers, not just active ones — an admin needs to see the
      // deactivated ones too, otherwise a code switched off becomes invisible and
      // unrecoverable from the UI.
      const snap = await getDocs(collection(this.firestore, 'vouchers'));
      this.vouchers.set(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Voucher))
          .sort((a, b) => a.code.localeCompare(b.code))
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
  }

  startEdit(voucher: Voucher): void {
    this.editing.set(true);
    this.originalId.set(voucher.id);
    this.code = voucher.code;
    this.type = voucher.type;
    this.value = voucher.value;
    this.minOrder = voucher.minOrder ?? 0;
    this.isActive = voucher.isActive;
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.originalId.set(null);
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
    return null;
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
      const payload = {
        code: normalized,
        type: this.type,
        value: this.value,
        minOrder: this.minOrder > 0 ? this.minOrder : null,
        isActive: this.isActive,
      };
      // A code change means a different document: keyed by code, so editing
      // SCOOP10 to SCOOP20 must remove the old one. Otherwise the old code would
      // linger, still valid, and invisible in the list.
      const targetId = normalized;
      if (originalId && originalId !== targetId) {
        await deleteDoc(doc(this.firestore, `vouchers/${originalId}`));
      }
      await setDoc(doc(this.firestore, `vouchers/${targetId}`), payload, { merge: true });

      this.cancelEdit();
      await this.load();
      await this.toast.create({
        message: `${normalized} saved.`,
        color: 'success',
        duration: 2000,
        position: 'top',
      }).then((t) => t.present());
    } catch (err) {
      this.errorMessage.set(describeFirestoreError('the voucher', err));
    } finally {
      this.busyCode.set(null);
    }
  }

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
    return voucher.type === 'percent'
      ? `${voucher.value}% off`
      : `₱${voucher.value} off`;
  }
}
