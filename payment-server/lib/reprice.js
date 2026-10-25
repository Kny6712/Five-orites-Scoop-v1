"use strict";
// payment-server/src/reprice.ts
// Five-orites Scoop — server-side re-pricing of an order before charging it.
//
// WHY THIS EXISTS, in one sentence: `firestore.rules` cannot sum an array (it
// has no loop), so the per-line prices in an order document are the one part of
// the money the client rules genuinely cannot verify — and the amount we charge
// is derived from exactly those numbers.
//
// WHAT IT DOES. Reads every product named in the order, recomputes each line
// from `products/{id}.pricing[size]`, recomputes the subtotal, the delivery fee
// and the voucher discount, and returns the figures the charge should use. It
// does NOT trust the order document's `grandTotal`; where the document and the
// recomputation disagree, the recomputation wins and the caller is told, so the
// discrepancy can be surfaced rather than silently absorbed.
//
// FAIL-CLOSED, deliberately and in three places:
//   - a product that no longer exists aborts the charge,
//   - a product with no price for the ordered size aborts the charge,
//   - a quantity that is not a positive whole number aborts the charge.
// Each of these is a reason not to take money, not a reason to guess.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeliveryFee = exports.FREE_DELIVERY_THRESHOLD = exports.DELIVERY_FEE = exports.repriceOrder = exports.RepriceError = void 0;
const firebase_1 = require("./firebase");
Object.defineProperty(exports, "DELIVERY_FEE", { enumerable: true, get: function () { return firebase_1.DELIVERY_FEE; } });
Object.defineProperty(exports, "FREE_DELIVERY_THRESHOLD", { enumerable: true, get: function () { return firebase_1.FREE_DELIVERY_THRESHOLD; } });
Object.defineProperty(exports, "getDeliveryFee", { enumerable: true, get: function () { return firebase_1.getDeliveryFee; } });
/**
 * Thrown when the order cannot be honestly priced. `userMessage` is safe to
 * show a customer; `detail` is for the server log only.
 */
class RepriceError extends Error {
    userMessage;
    detail;
    constructor(userMessage, detail) {
        super(detail);
        this.userMessage = userMessage;
        this.detail = detail;
        this.name = 'RepriceError';
    }
}
exports.RepriceError = RepriceError;
async function repriceOrder(firestore, order) {
    const lines = order.items ?? [];
    if (lines.length === 0) {
        throw new RepriceError('This order has no items.', 'order has an empty items array');
    }
    if (lines.length > 100) {
        // Mirrors the ceiling in OrderService.transitionOrderStatus. Firestore's
        // per-transaction document limit is 500 and this is a read per line; an
        // order that large is a bug worth surfacing, not a bill to write.
        throw new RepriceError('This order is too large to price automatically.', `order has ${lines.length} lines (ceiling 100)`);
    }
    const productRefs = lines.map((line) => firestore.doc(`products/${line.productId}`));
    const productSnaps = await Promise.all(productRefs.map((ref) => ref.get()));
    let totalAmount = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const snap = productSnaps[i];
        if (!snap.exists) {
            throw new RepriceError('One of the items in this order is no longer available.', `product ${line.productId} no longer exists`);
        }
        const product = snap.data();
        const size = line.size ?? '';
        const unitPrice = product.pricing?.[size];
        if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) {
            throw new RepriceError(`${product.variantName ?? line.variantName ?? 'An item'} has no price set for this size.`, `product ${line.productId} has no pricing[${JSON.stringify(size)}]`);
        }
        const quantity = line.quantity;
        if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
            // A fractional or negative quantity would charge a fraction of a peso or,
            // worse, SUBTRACT from the total. Refuse rather than normalise.
            throw new RepriceError('This order has an invalid quantity.', `line ${line.productId} has quantity ${JSON.stringify(quantity)}`);
        }
        totalAmount += unitPrice * quantity;
    }
    const deliveryFee = (0, firebase_1.getDeliveryFee)(totalAmount);
    // The voucher is re-resolved from its CODE, exactly as OrderService does on
    // the client — but here the client's answer cannot be believed, so it is
    // recomputed. A discount that fails to resolve now costs the customer the
    // discount rather than the charge being invented from a stale number.
    let discountAmount = 0;
    const code = order.voucherCode?.trim().toUpperCase();
    if (code) {
        discountAmount = await resolveVoucherDiscount(firestore, code, totalAmount);
    }
    const grandTotal = Math.max(totalAmount - discountAmount + deliveryFee, 0);
    const stored = order.grandTotal;
    const mismatch = typeof stored === 'number' && Math.abs(stored - grandTotal) > 0.001;
    return { grandTotal, totalAmount, deliveryFee, discountAmount, mismatch };
}
exports.repriceOrder = repriceOrder;
/**
 * Discount for a voucher code, recomputed here rather than taken from the
 * order.
 *
 * Kept deliberately close to `src/app/core/logic/voucher.ts`, which this
 * service cannot import (that file sits behind Angular path aliases and pulls
 * in app-level imports). `MAX_PERCENT_DISCOUNT = 90` and the fixed-amount cap
 * at the subtotal are the two rules that must agree between the copies.
 */
const MAX_PERCENT_DISCOUNT = 90;
async function resolveVoucherDiscount(firestore, code, subtotal) {
    const snap = await firestore.collection('vouchers').where('code', '==', code).limit(1).get();
    const doc = snap.docs[0];
    if (!doc) {
        // The code on the order no longer resolves. Charging the undiscounted
        // total would silently take MORE than the customer was quoted, so this
        // fails the charge instead of absorbing the difference.
        throw new RepriceError('A voucher on this order is no longer valid.', `voucher ${code} not found`);
    }
    const v = doc.data();
    const now = Date.now();
    if (v.isActive === false) {
        throw new RepriceError('A voucher on this order is no longer active.', `voucher ${code} inactive`);
    }
    if (typeof v.startsAt === 'number' && now < v.startsAt) {
        throw new RepriceError('A voucher on this order has not started yet.', `voucher ${code} not started`);
    }
    if (typeof v.expiresAt === 'number' && now > v.expiresAt) {
        throw new RepriceError('A voucher on this order has expired.', `voucher ${code} expired`);
    }
    if (typeof v.maxRedemptions === 'number' &&
        typeof v.usageCount === 'number' &&
        v.usageCount >= v.maxRedemptions) {
        throw new RepriceError('A voucher on this order has been fully redeemed.', `voucher ${code} exhausted (${v.usageCount}/${v.maxRedemptions})`);
    }
    if (typeof v.minOrder === 'number' && v.minOrder > subtotal) {
        throw new RepriceError('A voucher on this order no longer applies to this total.', `voucher ${code} requires ${v.minOrder}, basket is ${subtotal}`);
    }
    if (typeof v.value !== 'number' || !Number.isFinite(v.value)) {
        throw new RepriceError('A voucher on this order is malformed.', `voucher ${code} has no value`);
    }
    if (v.type === 'percent') {
        const pct = Math.min(Math.max(v.value, 0), MAX_PERCENT_DISCOUNT);
        return roundMoney((subtotal * pct) / 100);
    }
    return roundMoney(Math.min(Math.max(v.value, 0), subtotal));
}
/** Half-up to the nearest centavo. Mirrors `src/app/core/logic/money.ts`. */
function roundMoney(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
//# sourceMappingURL=reprice.js.map