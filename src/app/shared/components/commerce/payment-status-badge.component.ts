// src/app/shared/components/commerce/payment-status-badge.component.ts
// Five-orites Scoop — Payment status badge (the second, independent ladder)
//
// WHY THIS IS ITS OWN COMPONENT AND NOT A SECOND CHIP INSIDE
// OrderStatusBadgeComponent. The two ladders are independent — an order can be
// "Order Placed" and "Paid", or "Confirmed" and "Unpaid" — and merging them
// into one component would put a decision in there that does not exist: which
// of the two states does the chip show? Rows show BOTH chips, side by side,
// which is the only arrangement where the conflation the model comments warn
// about cannot happen.

import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { PaymentStatus, PAYMENT_STATUS_META } from '@core/models/order.model';

@Component({
  selector: 'app-payment-status-badge',
  standalone: true,
  imports: [NgClass, AppIconComponent],
  template: `
    <!--
      The same element and the same box as OrderStatusBadgeComponent: a plain
      span wearing the global ".chip" class, whose padding, min-height and
      12px radius copy ion-chip's values exactly. The argument for that swap is
      written out in full over there — an ion-chip declares a hard
      border-radius and exposes no custom property to change it — and nothing
      about payment state changes it.

      NO BACKTICKS IN THIS BLOCK: it sits inside the same template literal as
      the styles array below.
    -->
    <span [ngClass]="paymentClass" class="chip payment-chip">
      <app-icon [name]="paymentMeta.icon" class="payment-icon" />
      <span class="payment-text">{{ paymentMeta.label }}</span>
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }

      /* The box comes from the global ".chip" class. This rule holds only the
         things that are specific to a PAYMENT: its ink and its four tones. */
      .payment-chip {
        color: var(--chip-ink, var(--color-ink));
        font-size: 12px;
        font-weight: 600;
        background: var(--chip-bg);
        border: 1px solid var(--chip-border);

        /* Same override property the status chip exposes, for the same
           reason: a declaration on the chip's own tone always beats one a
           host inherits in, so an ancestor restating "--chip-border" would
           silently lose. */
        border-color: var(--chip-border-color, var(--chip-border));
      }

      .payment-text {
        color: var(--chip-label-ink, var(--chip-ink, var(--color-ink)));
      }

      /* Four tones, one ink. Plum on every one of these surfaces clears
         4.5:1: the warning and success tints are pale, the danger tint is a
         desaturated rose, and the neutral powder is the card colour itself.

         The CLASS NAMES ARE THE TONES, because the class is chosen from
         PAYMENT_STATUS_META.tone below — adding a state to that record needs no
         change here at all, and a tone with no fill is a chip that renders
         backgroundless rather than one that silently misses a branch. */
      .pt-success {
        --chip-bg: var(--tone-success-bg);
        --chip-border: var(--tone-success-border);
      }
      .pt-warning {
        --chip-bg: var(--tone-warning-bg);
        --chip-border: var(--tone-warning-border);
      }
      .pt-danger {
        --chip-bg: var(--tone-danger-bg);
        --chip-border: var(--tone-danger-border);
      }
      .pt-neutral {
        --chip-bg: var(--tile-powder);
        --chip-border: var(--tile-powder-deep);
      }

      .payment-icon {
        margin-right: 4px;
        /* 20px, which is app-icon's default and the size the status chip's
           measured widths were taken at. The two chips sit on the same row,
           so they are the same size for the same reason they are the same
           shape. */
      }
    `,
  ],
})
export class PaymentStatusBadgeComponent {
  @Input({ required: true }) status!: PaymentStatus;

  get paymentMeta() {
    return PAYMENT_STATUS_META[this.status];
  }

  /**
   * The tone class, chosen from the model's own tone rather than from the
   * status name — so the chip and `PAYMENT_STATUS_META` cannot drift, and a
   * future state added to that record arrives with a fill without touching
   * this file.
   */
  get paymentClass(): string {
    switch (this.paymentMeta.tone) {
      case 'success':
        return 'pt-success';
      case 'danger':
        return 'pt-danger';
      case 'neutral':
        return 'pt-neutral';
      default:
        return 'pt-warning';
    }
  }
}
