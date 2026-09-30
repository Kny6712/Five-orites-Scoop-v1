// src/app/core/models/order.model.ts
// Five-orites Scoop — Order Data Models
// Author: Five-orites Scoop team (see README)

import { Timestamp } from '@angular/fire/firestore';
import { SizeVariant } from './product.model';
import type { AppIcon } from '../icons/app-icons';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface OrderItem {
  productId: string;
  variantName: string;
  setName: string;
  size: SizeVariant;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface Order {
  id: string;
  customerId: string;
  customerEmail: string;
  items: OrderItem[];
  totalAmount: number;
  deliveryFee: number;
  discountAmount?: number;
  voucherCode?: string | null;
  grandTotal: number;
  status: OrderStatus;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  // There is deliberately no paymentReference field: no payment gateway is
  // integrated yet (see README "Out of Scope"). Add it back when one is.
  deliveryAddress: string;
  notes?: string | null;
  cancelReason?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  statusHistory: { status: OrderStatus; timestamp: Timestamp }[];
}

export interface OrderStatusMeta {
  label: string;
  /**
   * Typed as `AppIcon` rather than `string`, so a rename or a typo in the icon
   * registry is a compile error instead of a silently blank glyph in the status
   * badge.
   */
  icon: AppIcon;
  description: string;
}

export const ORDER_STATUS_META: Record<OrderStatus, OrderStatusMeta> = {
  pending: {
    label: 'Order Placed',
    icon: 'clock',
    description: 'We received your order and are reviewing it.',
  },
  confirmed: {
    label: 'Confirmed',
    icon: 'circle-check',
    description: 'Your order has been confirmed!',
  },
  preparing: {
    label: 'Preparing Your Scoops',
    icon: 'ice-cream',
    description: 'Our scoop artists are crafting your order.',
  },
  out_for_delivery: {
    label: 'Out for Delivery',
    icon: 'bike',
    description: 'Your ice cream is on its way!',
  },
  delivered: {
    label: 'Delivered',
    icon: 'circle-check-big',
    description: 'Enjoy your scoops! 🍦',
  },
  cancelled: {
    label: 'Cancelled',
    icon: 'circle-x',
    description: 'This order has been cancelled.',
  },
};
