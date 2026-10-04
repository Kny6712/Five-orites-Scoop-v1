// src/app/shared/components/order-status-badge/order-status-badge.component.ts
// Five-orites Scoop — Order Status Badge Component
// Author: Five-orites Scoop team (see README)

import { Component, Input } from '@angular/core';
import { IonChip, IonLabel } from '@ionic/angular/standalone';
import { AppIconComponent } from '../app-icon/app-icon.component';
import { OrderStatus, ORDER_STATUS_META } from '../../../core/models/order.model';

@Component({
  selector: 'app-order-status-badge',
  standalone: true,
  imports: [IonChip, IonLabel, AppIconComponent],
  template: `
    <ion-chip [color]="chipColor" class="status-chip">
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

  get chipColor(): string {
    const colorMap: Record<OrderStatus, string> = {
      pending: 'warning',
      confirmed: 'primary',
      preparing: 'secondary',
      out_for_delivery: 'tertiary',
      delivered: 'success',
      cancelled: 'danger',
    };
    return colorMap[this.status];
  }
}
