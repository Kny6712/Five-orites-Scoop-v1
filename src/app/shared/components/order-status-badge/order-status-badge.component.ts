// src/app/shared/components/order-status-badge/order-status-badge.component.ts
// Five-orites Scoop — Order Status Badge Component
// Author: Five-orites Scoop team (see README)

import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { IonChip, IonLabel } from '@ionic/angular/standalone';
import { AppIconComponent } from '../app-icon/app-icon.component';
import { OrderStatus, ORDER_STATUS_META } from '../../../core/models/order.model';

@Component({
  selector: 'app-order-status-badge',
  standalone: true,
  imports: [NgClass, IonChip, IonLabel, AppIconComponent],
  template: `
    <!--
      Explicit tone classes, NOT [color]="chipColor".

      Ionic's color input chooses a foreground AND a background from one name with no
      relationship between them, which is why "Order Placed" measured 1.31:1 and
      "Preparing Your Scoops" 1.14:1 - the label and the pill within a percent of the
      same lightness.

      This is the third and widest instance of the same defect (after the credits chips
      and the inventory chips), and it was invisible for longer than either: this
      component renders on four pages, all of which were auth-gated or empty, so no
      audit could reach it until the emulator had orders in it.
    -->
    <ion-chip [ngClass]="statusClass" class="status-chip">
      <app-icon [name]="statusMeta.icon" class="status-icon" />
      <ion-label>{{ statusMeta.label }}</ion-label>
    </ion-chip>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }
      .status-chip {
        font-size: 12px;
        font-weight: 600;
        --color: var(--color-ink);

        ion-label {
          color: var(--color-ink);
        }
      }

      /* One background per state, one foreground for all of them. Ink on every one of
         these surfaces clears 4.5:1 by a wide margin: 11.19 on the info tint, 11.45 on
         mint, 6.35 on success, 6.29 on warning, 7.42 on danger. */
      .st-pending {
        background: var(--tone-warning-bg);
        border: 1px solid var(--tone-warning-border);
      }
      .st-confirmed {
        background: var(--tone-info-bg);
        border: 1px solid var(--tone-info-border);
      }
      .st-preparing {
        background: var(--tile-powder);
        border: 1px solid var(--tone-info-border);
      }
      .st-delivery {
        background: var(--tile-mint);
        border: 1px solid var(--tone-success-border);
      }
      .st-delivered {
        background: var(--tone-success-bg);
        border: 1px solid var(--tone-success-border);
      }
      .st-cancelled {
        background: var(--tone-danger-bg);
        border: 1px solid var(--tone-danger-border);
      }
      .status-icon {
        margin-right: 4px;
      }
    `,
  ],
})
export class OrderStatusBadgeComponent {
  @Input({ required: true }) status!: OrderStatus;

  get statusMeta() {
    return ORDER_STATUS_META[this.status];
  }

  /**
   * The tone a status chip wears, as a class rather than an Ionic colour name.
   *
   * This returned 'warning' | 'primary' | 'secondary' | 'tertiary' | 'success' |
   * 'danger', which the template handed to `[color]`. Ionic then derived BOTH the
   * label colour and the pill background from that one name, choosing among its own
   * tint shades with no contrast relationship between them - measured at 1.31:1 and
   * 1.14:1 for the two states above.
   *
   * `out_for_delivery` gets its own mint tint rather than sharing 'confirmed', because
   * a class hands the stylesheet both halves of the pair at once and six states
   * squeezed into five colours is how the collision started.
   */
  get statusClass(): string {
    switch (this.status) {
      case 'pending':
        return 'st-pending';
      case 'confirmed':
        return 'st-confirmed';
      case 'preparing':
        return 'st-preparing';
      case 'out_for_delivery':
        return 'st-delivery';
      case 'delivered':
        return 'st-delivered';
      default:
        return 'st-cancelled';
    }
  }
}
