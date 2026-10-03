// src/app/features/dashboard/voucher-cards/voucher-cards.component.ts
// Five-orites Scoop — "Grab a code" promo cards for the customer dashboard
//
// WHAT THIS IS
// A read-only list of active vouchers with a copy-to-clipboard action, so a
// customer can pick up a code here and paste it into /cart. It creates no claim
// records and tracks no redemption: the `vouchers` collection is readable by every
// signed-in user already (firestore.rules `allow read: if isSignedIn()`), so the
// codes are public by construction and pretending otherwise would be theatre.
//
// The discount is still resolved server-side at checkout — OrderService re-reads
// the code and recomputes from Firestore, so a tampered client cannot dictate a
// price. Copying a code grants no capability.
//
// WHY CLIPBOARD NEEDS A FALLBACK
// navigator.clipboard is unavailable in three real situations here: a non-secure
// origin (plain http on a LAN), an older WebView in the Capacitor Android shell,
// and any browser where the user has denied clipboard permission. All three throw
// or return undefined rather than failing loudly, so the card falls back to
// selecting the code text for a manual copy. Silently doing nothing would look
// like a broken button.

import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonButton, IonSpinner, IonSkeletonText } from '@ionic/angular/standalone';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { VoucherService } from '../../../core/services/voucher.service';
import { Voucher, calculateDiscount } from '../../../core/models/voucher.model';
import { PesoPipe } from '../../../shared/pipes/peso.pipe';

@Component({
  selector: 'app-voucher-cards',
  standalone: true,
  imports: [CommonModule, IonButton, IonSpinner, IonSkeletonText, AppIconComponent, PesoPipe],
  templateUrl: './voucher-cards.component.html',
  styleUrls: ['./voucher-cards.component.scss'],
})
export class VoucherCardsComponent implements OnInit {
  private voucherService = inject(VoucherService);
  private router = inject(Router);

  vouchers = signal<Voucher[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');

  /** The code most recently copied, so exactly one card shows confirmation. */
  copiedCode = signal<string | null>(null);
  /** Set when the clipboard was unavailable and the code was selected instead. */
  manualCopyCode = signal<string | null>(null);

  /** Free reference subtotal used to show what the code is worth. */
  readonly SAMPLE_SUBTOTAL = 500;

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    try {
      this.vouchers.set(await this.voucherService.getActiveVouchers());
    } catch (err) {
      console.error('Could not load vouchers', err);
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Could not load the latest promos.',
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Human summary of what a code does.
   *
   * Computed against a fixed sample subtotal rather than the live cart: the card
   * lives on the dashboard, where the cart total is not on screen, and a number
   * that silently changed as the cart filled would be misleading. The real
   * discount is computed at checkout against the real total.
   */
  describe(voucher: Voucher): string {
    if (voucher.type === 'percent') {
      return `${voucher.value}% off your order`;
    }
    return `₱${voucher.value} off your order`;
  }

  /** What this code is actually worth on a ₱500 basket — honest, not inflated. */
  sampleSaving(voucher: Voucher): number {
    return calculateDiscount(this.SAMPLE_SUBTOTAL, voucher);
  }

  hasMinimum(voucher: Voucher): boolean {
    return (voucher.minOrder ?? 0) > 0;
  }

  async copyCode(voucher: Voucher): Promise<void> {
    this.copiedCode.set(null);
    this.manualCopyCode.set(null);

    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(voucher.code);
      this.copiedCode.set(voucher.code);
      // Clear the confirmation after a few seconds so it does not linger looking
      // like a stuck state.
      setTimeout(() => {
        if (this.copiedCode() === voucher.code) this.copiedCode.set(null);
      }, 2500);
    } catch {
      // No usable clipboard API. Select the code so the user can copy it by hand
      // rather than being left with a button that appears to do nothing.
      this.manualCopyCode.set(voucher.code);
    }
  }

  /**
   * Takes the code to the cart and pre-fills the voucher field.
   *
   * The cart page owns the applied voucher, so rather than duplicating that state
   * (and risking two sources of truth for one discount) this hands the code over
   * and lets the cart apply it through the same path a typed code would take.
   * sessionStorage rather than localStorage because it is scoped to the tab and
   * should not outlive the trip to checkout.
   */
  async useCode(voucher: Voucher): Promise<void> {
    try {
      sessionStorage.setItem(PENDING_VOUCHER_KEY, voucher.code);
    } catch {
      // Private mode or storage disabled. The code is still on screen for manual
      // copy, so this is a degradation rather than a failure.
    }
    await this.router.navigate(['/cart'], { queryParams: { voucher: voucher.code } });
  }
}

/** Where the dashboard hands a grabbed code to the cart page. */
export const PENDING_VOUCHER_KEY = 'five_orites_pending_voucher';
