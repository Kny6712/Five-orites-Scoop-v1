// src/app/core/models/order.model.ts
// Five-orites Scoop — Order Data Models
// Author: Five-orites Scoop team (see README)

import { Timestamp } from '@angular/fire/firestore';
import { SizeVariant } from '@core/models/product.model';
import type { AppIcon } from '@core/icons/app-icons';

export type OrderStatus =
  'pending' | 'confirmed' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled';

/**
 * How the order's money is doing, separately from where the ice cream is.
 *
 * These two ladders move INDEPENDENTLY and conflating them is a live hazard:
 * `pending` (fulfilment) with `paid` (payment) is the normal state of a paid
 * order awaiting staff, and `pending` with `pending` is an order nobody has
 * paid for yet. See `isPaymentPayable` for what the app may act on.
 */
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

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
  paymentStatus: PaymentStatus;

  // ── Payment fields ──────────────────────────────────────────────────────────
  //
  // These were deliberately absent while no gateway existed (the old comment is
  // kept in git history). Xendit is now integrated: `payment-server/` mints a
  // payment request per order and its webhook is the ONLY writer of
  // `paymentStatus`.
  //
  // ABSENT IS NOT FALSE, and it matters for two of these. Every order created
  // before the gateway existed has no `paymentRequestId` and no `paidAt`, so
  // reading "absent" as "unpaid forever" would be wrong for the many `delivered`
  // orders that were simply never routed through a gateway. Treat absent as
  // "no gateway record", which is what the UI does — My Orders shows a Pay Now
  // button only while the order is genuinely still open and unpaid.
  //
  /** Xendit `payment_request_id` (`pr-…`). The idempotency anchor. */
  paymentRequestId?: string | null;
  /** Xendit `payment_id` (`py-…`) — the specific payment, written by the webhook. */
  paymentReference?: string | null;
  /** Channel code actually used: `GCASH` | `PAYMAYA` | `GRABPAY`. */
  paymentMethod?: string | null;
  /** When the webhook confirmed the money arrived. Null/absent until then. */
  paidAt?: Timestamp | null;
  deliveryAddress: string;
  notes?: string | null;
  cancelReason?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /**
   * The fulfilment timeline. `reason` is optional and only present on entries the
   * Cloud Function writes (`insufficient_stock`, `no_price`, `invalid_line`,
   * `empty_order`) — it records WHY the server cancelled an order, which is the
   * only place that distinction survives. Client-written entries omit it.
   */
  statusHistory: { status: OrderStatus; timestamp: Timestamp; reason?: string }[];

  /**
   * Whether a cancelled order's stock has been returned to inventory.
   *
   * ABSENT IS NOT FALSE. Every order cancelled before this field existed has no
   * marker, and reading "absent" as "stock was never returned" would flood the
   * repair queue with orders that are actually fine.
   *
   * So: `true` means confirmed returned, `false` means confirmed NOT returned
   * (the restock threw), and `undefined` means unknown — which is why the repair
   * panel only offers `false`, and shows unknown ones separately rather than
   * guessing. See `OrderService.repairStockRestock`.
   */
  stockRestored?: boolean;
  stockRestoredAt?: Timestamp | null;
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

/**
 * How to say each payment state out loud.
 *
 * Separate from `ORDER_STATUS_META` on purpose: the two ladders are independent
 * and merging them would re-create the conflation the model comment warns
 * about. A row shows BOTH chips — where the order is, and whether it is paid.
 */
export interface PaymentStatusMeta {
  label: string;
  /** Short label for a cramped row, e.g. the My Orders list. */
  short: string;
  icon: AppIcon;
  /** Tone key shared with the app's existing chip palette. */
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  description: string;
}

export const PAYMENT_STATUS_META: Record<PaymentStatus, PaymentStatusMeta> = {
  pending: {
    label: 'Payment Pending',
    short: 'Unpaid',
    icon: 'clock',
    tone: 'warning',
    description: 'This order has not been paid for yet.',
  },
  paid: {
    label: 'Payment Received',
    short: 'Paid',
    icon: 'circle-check',
    tone: 'success',
    description: 'Your payment was received.',
  },
  failed: {
    label: 'Payment Failed',
    short: 'Failed',
    icon: 'circle-x',
    tone: 'danger',
    description: 'The payment did not go through. You can try again.',
  },
  refunded: {
    label: 'Payment Refunded',
    short: 'Refunded',
    // `refresh`, not `rotate-ccw`: the icon registry has no `rotate-ccw`, and
    // `icon` is typed as `AppIcon`, so a wrong name is a compile error rather
    // than a silently blank glyph.
    icon: 'refresh',
    tone: 'neutral',
    description: 'This payment was refunded.',
  },
};

/**
 * Whether the app may offer to take money for this order.
 *
 * Four conditions, each of which independently means "do not ask for money":
 * paid already, refunded, cancelled, or delivered. The last is easy to miss —
 * a delivered order whose payment failed is a collections problem for the shop
 * to resolve by hand, not something to re-present a checkout page for, and
 * offering it would let a customer "pay" for an order that already arrived.
 */
export function isPaymentPayable(order: Pick<Order, 'status' | 'paymentStatus'>): boolean {
  if (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded') return false;
  if (order.status === 'cancelled' || order.status === 'delivered') return false;
  return true;
}

/**
 * Whether a payment badge should be shown at all.
 *
 * Hides it for orders predating the gateway: they carry no `paymentRequestId`,
 * and their `paymentStatus` has sat at `pending` since the day they were
 * written — flagging every historical order as "Unpaid" would be a false claim
 * about orders that were settled outside the app.
 */
export function shouldShowPaymentBadge(
  order: Pick<Order, 'status' | 'paymentStatus' | 'paymentRequestId'>,
): boolean {
  if (order.paymentStatus !== 'pending') return true;
  return Boolean(order.paymentRequestId);
}
