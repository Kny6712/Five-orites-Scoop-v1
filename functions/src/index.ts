// functions/src/index.ts
// Five-orites Scoop — Server-authoritative stock and order pricing
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
// Two trust problems, closed by moving the same two writes behind the Admin SDK:
//
// 1. ANY SIGNED-IN CUSTOMER COULD WRITE ANY STOCK LEVEL. The products rule's
//    customer branch scopes a stock write to the KEY `stock` but cannot scope
//    its MAGNITUDE, because rules cannot tie a write to an order created moments
//    earlier. The rules file says so in capitals, and
//    tests/firestore.rules.test.ts pins it with a test that asserts
//    `stock.cup: 999999` SUCCEEDS. Every stock figure the admin UI shows — the
//    low-stock panel, the queue's availability, the analytics inventory numbers
//    — was therefore writable by whoever held a signed-in session.
//    `reconcileOrderStock` performs the decrement here instead, so the customer
//    never writes stock at all.
//
// 2. THE ORDER'S MONEY FIELDS CAME FROM THE CLIENT. The rules do check
//    `grandTotal == totalAmount - discountAmount + deliveryFee`, but a rule has
//    no loop and therefore cannot compare a per-item `unitPrice` against the
//    catalog. A forged client could send its own unit prices, keep the totals
//    internally consistent, and buy a gallon for ₱1.
//    `reconcileOrderStock` re-prices every line from `products/{id}.pricing` and
//    overwrites the totals, so a forged order cannot set its own price.
//
// `restockCancelledOrder` is the other half: when an order is cancelled, the
// stock it consumed has to come back, and doing that only where a status
// transition is actually observable is the honest place to do it.
//
// ── RULES PARITY ────────────────────────────────────────────────────────────
// These handlers use the ADMIN SDK, which BYPASSES firestore.rules entirely.
// So tightening the rules changes nothing about what this code may write, and a
// rules regression will not show up here as a PERMISSION_DENIED — the writes
// would succeed either way. What the two layers still have to AGREE on is
// shape: the field names, the four stock keys (cup / pint / halfGallon /
// gallon) and the ledger `reason` strings, because the client reads those
// documents and the admin rules validate them.
//
// ── DEPLOY PREREQUISITE ─────────────────────────────────────────────────────
// The client still contains its own stock writers: OrderService.placeOrder calls
// InventoryService.validateAndDecrementStock BEFORE writing the order, and
// OrderService.cancelOrder calls restockItems afterwards. Both overlap with the
// handlers below. Deployed alongside them, every sale decrements twice and
// every cancellation restocks twice — inventory drifting the exact opposite way
// from the corruption these functions exist to stop. Those client paths must be
// removed in the same release, and the corresponding customer branch of the
// products rule narrowed to nothing, or this file is a net loss.

import { initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';

import { calculateDiscount, getDeliveryFee } from './config';

// Initialised at MODULE LOAD, not inside a handler. The Admin SDK resolves its
// credentials and project id from the environment once; calling initializeApp()
// per invocation would re-read them on every trigger. Deploying more handlers
// into this file therefore costs nothing extra here.
initializeApp();

const db = getFirestore();

// NOTE ON REGION: neither trigger sets a region, so both run in `us-central1`,
// which is the Cloud Functions default. If this project's Firestore database
// lives elsewhere, pass `{ region: '<the database location>' }` to the trigger
// — a handler far from the database it writes is slower, not broken, but it is
// not free and the two should be in the same place.

// ── Shared shapes ───────────────────────────────────────────────────────────

/**
 * The four sizes the catalog sells, and therefore the exact keys of
 * `products/{id}.stock`.
 *
 * Mirrors SIZE_VARIANTS in src/app/core/logic/stock.ts. It is re-declared rather
 * than imported for the reason in config.ts, and a typo here is worse than in a
 * display string: it would write `stock.pintt`, invent a fifth size that nothing
 * in the app ever reads, and leave the real pint untouched.
 */
type SizeVariant = 'cup' | 'pint' | 'halfGallon' | 'gallon';

const SIZE_VARIANTS: readonly SizeVariant[] = ['cup', 'pint', 'halfGallon', 'gallon'];

/**
 * Statuses at which the order is still physically in the store, so cancelling it
 * should return its stock. `out_for_delivery` and `delivered` are excluded
 * because the ice cream has left the building: restocking it would invent
 * inventory the shop can then sell a second time.
 *
 * Mirrors PRE_DISPATCH_STATUSES in src/app/core/services/order.service.ts. Keep
 * the two in step — the client path and this path restock the same orders, so a
 * disagreement shows up as an order that is cancelled and still has its stock,
 * or an order that is cancelled and has stock twice.
 */
const PRE_DISPATCH_STATUSES: readonly string[] = ['pending', 'confirmed', 'preparing'];

/** The subset of a product document these handlers read. */
interface ProductDoc {
  variantName?: string;
  pricing?: Partial<Record<SizeVariant, number>>;
  stock?: Partial<Record<SizeVariant, number>>;
}

/**
 * The subset of an order item these handlers read.
 *
 * Every field is optional because this document was written by a browser. The
 * types describe what a well-behaved client sends, not what is guaranteed — the
 * runtime checks in isSellableQuantity()/isSizeVariant() are what the handlers
 * actually rely on.
 */
interface OrderItemDoc {
  productId?: string;
  variantName?: string;
  size?: string;
  quantity?: number;
}

/** The subset of an order document these handlers read. */
interface OrderDoc {
  customerId?: string;
  status?: string;
  paymentStatus?: string;
  items?: OrderItemDoc[];
  discountAmount?: number;
  /**
   * The code the customer claimed, written by the browser and therefore
   * untrusted. It is used only to LOOK UP a voucher — never as an amount. The
   * discount actually granted is recomputed from the voucher document.
   */
  voucherCode?: string | null;
  /**
   * True once nothing is owed back for this order — either the stock was
   * returned, or (the case that matters here) it was never taken. False means
   * a restock failed and the order is in the admin repair queue. Absent means
   * "unknown", which is why neither handler treats it as an answer on its own.
   */
  stockRestored?: boolean;
}

/** The subset of a voucher document this handler reads. */
interface VoucherDoc {
  code?: string;
  type?: string;
  value?: number;
  minOrder?: number;
  isActive?: boolean;
  usageCount?: number;
  maxRedemptions?: number;
  perCustomerLimit?: number;
  startsAt?: number;
  expiresAt?: number;
}

/** An order line that survived validation and was priced from the catalog. */
interface PricedLine {
  productId: string;
  size: SizeVariant;
  quantity: number;
  unitPrice: number;
  variantName: string;
}

/**
 * Thrown INSIDE the decrement transaction to abort it.
 *
 * A Firestore transaction cannot fail and commit partially, which is what makes
 * this safe: by the time the shortfall is discovered the transaction may already
 * have decremented three of four products, and the throw gives all four back.
 * It is a distinct class rather than an `Error` whose message is compared,
 * because a real Firestore failure — a network error, a permissions failure —
 * must never be mistaken for "out of stock" and quietly turned into a
 * cancellation. That mistake would be the worst of both: the customer loses the
 * order and the stock stays taken.
 */
class InsufficientStockError extends Error {}

/**
 * Thrown inside the decrement transaction to abort it when the order was
 * cancelled while this handler was running — see the read in
 * reconcileOrderStock. It carries no message because it is not a fault: it is
 * this handler declining to do work that another handler has already undone.
 */
class AlreadyCancelledError extends Error {}

/**
 * Thrown to abort the reservation when the voucher the customer claimed cannot
 * be honoured — unknown, switched off, expired, already at its cap, or past this
 * customer's personal limit.
 *
 * Aborting is the honest response: the order is cancelled with a reason the
 * customer can read rather than confirmed at a discount the shop did not agree
 * to. The alternative — quietly charging full price — is the behaviour that made
 * the cap unenforceable in the first place.
 */
/** Why a voucher was refused, as shown to the customer. */
type VoucherRejection = 'unknown' | 'inactive' | 'not_started' | 'expired' | 'exhausted' | 'per_customer';

/**
 * The customer-facing text for each refusal, kept next to the check that
 * produces it so a new reason cannot be added to one without the other.
 */
const VOUCHER_REJECTION_TEXT: Record<VoucherRejection, string> = {
  unknown: 'Promo code not recognised',
  inactive: 'This promo code is no longer active',
  not_started: 'This promo code is not active yet',
  expired: 'This promo code has expired',
  exhausted: 'This promo code has reached its redemption limit',
  per_customer: 'You have reached your limit for this promo code',
};

class VoucherRejectedError extends Error {
  constructor(readonly reason: VoucherRejection) {
    super(VOUCHER_REJECTION_TEXT[reason]);
    this.name = 'VoucherRejectedError';
  }
}

// ── Validation helpers ──────────────────────────────────────────────────────

function isSizeVariant(value: unknown): value is SizeVariant {
  return typeof value === 'string' && (SIZE_VARIANTS as readonly string[]).includes(value);
}

/**
 * A quantity is a whole number of at least 1, because the decrement is
 * `stock - quantity`.
 *
 * This is not defensive paranoia, it is arithmetic: a negative quantity passes a
 * naive availability test (`5 < -5` is false) and then RAISES the stock level
 * instead of lowering it. The cart is rehydrated from localStorage, so
 * `items[].quantity` is whatever the last writer put there. The same guard is on
 * the client in normaliseStockLines (src/app/core/logic/stock.ts) and it has to
 * be here too, because the field is still client-written here.
 */
function isSellableQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * The current level of one size, with absent and malformed values folded to 0.
 *
 * `stock?.[size] ?? 0` handles a legacy document that never had the key.
 * `Number.isFinite` handles one that has a string or NaN in it — an old write
 * from before `stockIsSane()` in the rules, or a hand edit in the console.
 * Without it, `NaN < quantity` is false, the check passes, and the write then
 * fails on NaN — which retried the trigger forever instead of cancelling one
 * order. Zero is the right fallback: the line is short, and the order is
 * cancelled with a reason a human can act on.
 */
function stockLevel(product: ProductDoc | undefined, size: SizeVariant): number {
  const raw = Number(product?.stock?.[size] ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

// ── Order cancellation ──────────────────────────────────────────────────────

/**
 * Cancels an order that cannot be fulfilled or cannot be priced.
 *
 * Centralised because every failure mode has to produce the SAME document
 * shape. The tracker page renders `statusHistory`, the admin queue reads
 * `cancelReason`, and the rules count `statusHistory` entries on a cancel — so
 * a second, differently-shaped cancellation path would be the kind of thing
 * that passes review and then renders as a blank row.
 *
 * `reason` rides INSIDE the history entry rather than beside it. The entry shape
 * stays `{ status, timestamp }` with one extra optional key, so every existing
 * reader of `entry.status` is unaffected, and the machine-readable cause
 * survives for anything that wants to distinguish "we ran out" from "we could
 * not price it".
 *
 * `stockRestored` is the handshake with `restockCancelledOrder`, and it is NOT
 * optional bookkeeping. Cancelling an order IS the event that handler watches
 * for, so a cancellation written here would otherwise make it give back stock
 * this handler never took — the out-of-stock path below would return the whole
 * order to the shelf and let the shop sell the same ice cream twice. Passing
 * true says "no stock was ever removed, so nothing is owed", which is also
 * exactly what AdminRepairPanel wants to see: it lists `stockRestored === false`
 * and leaves `true` alone.
 */
async function cancelOrder(
  orderRef: FirebaseFirestore.DocumentReference,
  reason: string,
  historyReason: string,
  stockRestored: boolean
): Promise<void> {
  await orderRef.update({
    status: 'cancelled',
    cancelReason: reason,
    stockRestored,
    stockRestoredAt: stockRestored ? Timestamp.now() : null,
    statusHistory: FieldValue.arrayUnion({
      status: 'cancelled',
      reason: historyReason,
      timestamp: Timestamp.now(),
    }),
    updatedAt: Timestamp.now(),
  });
}

// ── Voucher redemption ───────────────────────────────────────────────────────

/**
 * Normalises a claimed code the same way the client does before it looks one up.
 *
 * The code arrives from a browser, so it is trimmed and upper-cased here for the
 * same reason the client does it: ` scoop10 ` and `SCOOP10` are the same code,
 * and a mismatch here would be read as "no such voucher" rather than as a hit.
 */
function normaliseVoucherCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

/**
 * Resolves and validates the voucher an order claimed, or throws.
 *
 * This is the whole reason the redemption counter could never work. The counter
 * was incremented by the CLIENT (`VoucherService.recordRedemption`), but
 * `firestore.rules` is `allow write: if isAdmin()` on `vouchers/` — a customer is
 * not an admin, there is no impersonation mechanism anywhere in the codebase, and
 * the failure was swallowed into a `console.error`. So `usageCount` stayed
 * wherever the admin page last wrote it and `maxRedemptions` could never trip.
 *
 * Doing it here fixes three things at once: the counter actually moves, the cap
 * is checked against the same value it spends, and the discount is derived from
 * the voucher's own `value` instead of the number the client sent.
 *
 * `maxRedemptions` is checked a SECOND time inside the transaction, against the
 * value that is about to be written. The check here is for a fast, readable
 * failure; the one in the transaction is what makes two simultaneous checkouts
 * on the last remaining redemption impossible.
 */
async function resolveVoucher(
  claimedCode: unknown,
  customerId: string | undefined,
  orderId: string,
  now: number
): Promise<{ doc: FirebaseFirestore.DocumentReference; data: VoucherDoc; code: string }> {
  const code = normaliseVoucherCode(claimedCode);
  if (!code) throw new VoucherRejectedError('unknown');

  // Looked up by CODE, not by an id the client supplied. The order document
  // carries only `voucherCode`; trusting a client-supplied voucher id would let a
  // customer name any document in the collection.
  const snap = await db.collection('vouchers').where('code', '==', code).limit(1).get();
  if (snap.empty) throw new VoucherRejectedError('unknown');

  const ref = snap.docs[0].ref;
  const data = snap.docs[0].data() as VoucherDoc;

  if (data.isActive !== true) throw new VoucherRejectedError('inactive');
  if (typeof data.startsAt === 'number' && now < data.startsAt) {
    throw new VoucherRejectedError('not_started');
  }
  if (typeof data.expiresAt === 'number' && now > data.expiresAt) {
    throw new VoucherRejectedError('expired');
  }

  // A cap with no recorded usage has not been reached. `usageCount` is absent on
  // every voucher written before tracking existed, and treating absent as zero
  // is what "no data yet" means — treating it as a failure would refuse every
  // legacy code from its first use.
  const used = typeof data.usageCount === 'number' && Number.isFinite(data.usageCount) ? data.usageCount : 0;
  if (typeof data.maxRedemptions === 'number' && used >= data.maxRedemptions) {
    throw new VoucherRejectedError('exhausted');
  }

  // Per-customer limit. Firestore rules cannot COUNT documents, which is why this
  // was declared, admin-editable and enforced nowhere: `voucherUsability` and
  // `validateVoucher` both ignore it. It has to be a query, and the query has to
  // run here.
  //
  // Our OWN order is already in the collection — `onDocumentCreated` fires after
  // the write — so it is excluded by id rather than subtracted blindly.
  if (typeof data.perCustomerLimit === 'number' && customerId) {
    const limit = data.perCustomerLimit;
    // Bounded: fetching limit + 2 rows is enough to prove the customer is over
    // the line, and never reads a customer's whole order history.
    const prior = await db
      .collection('orders')
      .where('customerId', '==', customerId)
      .where('voucherCode', '==', code)
      .limit(limit + 2)
      .get();
    const earlier = prior.docs.filter((d) => d.id !== orderId).length;
    if (earlier >= limit) throw new VoucherRejectedError('per_customer');
  }

  return { doc: ref, data, code };
}

// ── Handler 1: a new order, priced and reserved server-side ─────────────────

/**
 * Re-prices a brand-new order from the catalog and decrements the stock it
 * consumed, in that order, on the server.
 *
 * Fires on ORDER CREATION only. By the time this runs the order document
 * already exists and the client already believes it placed an order, so the
 * handler's first job is to establish what that order is actually worth — and
 * then to make the shop's stock agree with it, or cancel it.
 */
export const reconcileOrderStock = onDocumentCreated('orders/{orderId}', async (event) => {
  const order = event.data?.data() as OrderDoc | undefined;
  if (!order) return;

  // Only a genuine, unpaid, uncancelled order. onDocumentCreated also fires for
  // a rules/import seed and for any document an admin writes by hand, and an
  // order that is already paid or already cancelled must not have its stock
  // taken a second time.
  if (order.status !== 'pending' || order.paymentStatus !== 'pending') return;

  const orderId = event.params.orderId;
  const orderRef = db.doc(`orders/${orderId}`);
  const items = Array.isArray(order.items) ? order.items : [];

  // An order with no items is not a ₱0 order, it is a ₱50 delivery charge for
  // nothing: getDeliveryFee(0) is the flat fee, because 0 is below the free
  // threshold. The rules require items.size() > 0, so this only fires on a
  // hand-written or malformed document — which is exactly the sort of document
  // this handler exists for.
  if (items.length === 0) {
    await cancelOrder(orderRef, 'Empty order', 'empty_order', true);
    return;
  }

  // ── Step 1: price every line from the catalog ─────────────────────────────
  //
  // The client's unitPrice, subtotal, totalAmount, deliveryFee and grandTotal
  // are read NOWHERE in this file. `items[].unitPrice` is taken from
  // `products/{id}.pricing[size]`, and the totals are computed from that.
  //
  // A line that cannot be priced — the product was deleted between the cart and
  // the checkout, or an admin never set a price for that size — cancels the
  // whole order. There is no partial fallback to the client's number, because
  // that number is the one thing this function was written to ignore.
  const lines: PricedLine[] = [];
  for (const item of items) {
    // Pulled into locals so the type guards below narrow these exact values.
    // Every one of them came from a browser, so none can be assumed.
    const productId = typeof item?.productId === 'string' ? item.productId : '';
    const size = item?.size;
    const quantity = item?.quantity;
    if (!productId || !isSizeVariant(size) || !isSellableQuantity(quantity)) {
      await cancelOrder(orderRef, 'Invalid order line', 'invalid_line', true);
      return;
    }

    const productSnap = await db.doc(`products/${productId}`).get();
    const product = (productSnap.exists ? productSnap.data() : undefined) as ProductDoc | undefined;

    // `pricing[size]` is the authoritative price. A product with no price for
    // this size is a data problem to fix in the admin UI, not something to
    // paper over with the number the client sent — which is the whole reason
    // this function exists.
    const unitPrice = product?.pricing?.[size];
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice)) {
      await cancelOrder(orderRef, 'Item unavailable', 'no_price', true);
      return;
    }

    lines.push({
      productId,
      size,
      quantity,
      unitPrice,
      // Names come from the catalog for the same reason prices do: the admin may
      // have renamed a flavor, and the order record should agree with the shop.
      variantName: product?.variantName ?? item.variantName ?? 'Unknown',
    });
  }

  // ── Step 2: recompute the money ───────────────────────────────────────────
  const totalAmount = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const deliveryFee = getDeliveryFee(totalAmount);

  // ── Step 2a: resolve the voucher the order claimed ────────────────────────
  //
  // Resolve BEFORE the money so a refused voucher aborts before any arithmetic
  // depends on it. `voucherCode` came from a browser and is used only as a lookup
  // key — the amount comes from the voucher document.
  const claimedCode = normaliseVoucherCode(order.voucherCode);
  let voucherClaim: { doc: FirebaseFirestore.DocumentReference; data: VoucherDoc; code: string } | null = null;
  if (claimedCode) {
    try {
      voucherClaim = await resolveVoucher(order.voucherCode, order.customerId, orderId, Date.now());
    } catch (err) {
      if (err instanceof VoucherRejectedError) {
        await cancelOrder(orderRef, err.message, `voucher_${err.reason}`, true);
        return;
      }
      throw err;
    }
  }

  // The discount is RECOMPUTED, not clamped. The previous code read the client's
  // `discountAmount` and bounded it to [0, totalAmount]; the rules permit
  // anything in that range, so a forged client could send `discountAmount:
  // totalAmount` and take the entire basket for the delivery fee. The bound was
  // real, the value was still the client's.
  //
  // No voucher means no discount. That is the fail-closed direction: an order
  // claiming a code that does not resolve is cancelled above, never charged full
  // price in silence.
  const discountAmount = voucherClaim
    ? calculateDiscount(totalAmount, {
        type: voucherClaim.data.type ?? 'percent',
        value: typeof voucherClaim.data.value === 'number' ? voucherClaim.data.value : 0,
        minOrder: voucherClaim.data.minOrder,
        isActive: voucherClaim.data.isActive === true,
      })
    : 0;

  const grandTotal = totalAmount - discountAmount + deliveryFee;

  // ── Step 3: decrement the stock, all lines or none ────────────────────────
  //
  // Duplicate product+size lines are summed first, exactly as normaliseStockLines
  // does on the client. A cart that lists the same size twice is charged twice
  // and must decrement once; without the merge the transaction writes `stock`
  // twice from the same read and the second write erases the first, so the shop
  // keeps the money and gives away the inventory.
  const stockLines = new Map<string, PricedLine>();
  for (const line of lines) {
    const key = `${line.productId}|${line.size}`;
    const existing = stockLines.get(key);
    if (existing) existing.quantity += line.quantity;
    else stockLines.set(key, { ...line });
  }

  try {
    await db.runTransaction(async (tx) => {
      // The order itself is re-read here, before any product, for one reason:
      // a cancellation that landed while this handler was pricing. Cancelling
      // fires `restockCancelledOrder`, which gives this order's stock back — so
      // taking it now would hand out the same units twice, and the net stock
      // level would end up HIGHER than before the order existed. Reading the
      // order inside the transaction is what makes the race close: if the
      // cancellation commits first, this transaction retries and sees it, and if
      // this transaction commits first the restock is still the correcting
      // write. Either order, the level ends up right.
      //
      // Only 'cancelled' aborts. An admin moving the order to 'preparing' while
      // this runs is a perfectly valid order that still needs its stock taken.
      const liveOrder = await tx.get(orderRef);
      if (liveOrder.exists && (liveOrder.data() as OrderDoc).status === 'cancelled') {
        throw new AlreadyCancelledError('Order was cancelled before its stock was reserved.');
      }

      // Every read before every write. Firestore requires that ordering, and it
      // is what makes the decrement a single atomic unit: a shortfall on the
      // fourth product discards the first three.
      const reads: {
        ref: FirebaseFirestore.DocumentReference;
        size: SizeVariant;
        quantity: number;
        current: number;
        variantName: string;
      }[] = [];

      for (const line of stockLines.values()) {
        const ref = db.doc(`products/${line.productId}`);

        // Re-read INSIDE the transaction rather than reusing the price pass's
        // snapshot. The transaction body is re-executed on contention, so this
        // is the only read the decrement is allowed to trust — the price pass
        // above may be seconds old, and two customers buying the last pint
        // would both pass a check against it.
        const snap = await tx.get(ref);
        const product = (snap.exists ? snap.data() : undefined) as ProductDoc | undefined;
        const current = stockLevel(product, line.size);
        if (current < line.quantity) {
          throw new InsufficientStockError(`${line.variantName} (${line.size}): ${current} left.`);
        }
        reads.push({
          ref,
          size: line.size,
          quantity: line.quantity,
          current,
          variantName: product?.variantName ?? line.variantName,
        });
      }

      // The voucher is re-read here too, and this is the check that actually
      // matters. `resolveVoucher` ran a moment ago and could already be stale —
      // two customers checking out the last remaining redemption would both pass
      // it. Reading the document inside the transaction means the cap is tested
      // against the same value that is about to be incremented, and Firestore
      // retries the whole body on contention, so exactly one of them wins and the
      // other is cancelled by the catch below.
      let voucherUsage: { ref: FirebaseFirestore.DocumentReference; next: number } | null = null;
      if (voucherClaim) {
        const voucherSnap = await tx.get(voucherClaim.doc);
        const fresh = (voucherSnap.exists ? voucherSnap.data() : undefined) as VoucherDoc | undefined;
        const used =
          typeof fresh?.usageCount === 'number' && Number.isFinite(fresh.usageCount) ? fresh.usageCount : 0;
        if (typeof fresh?.maxRedemptions === 'number' && used >= fresh.maxRedemptions) {
          throw new VoucherRejectedError('exhausted');
        }
        // Absolute value from the read, not `increment(1)`. Inside a transaction
        // the two agree, but writing the number that was checked is the only form
        // where "checked" and "wrote" cannot drift apart.
        voucherUsage = { ref: voucherClaim.doc, next: used + 1 };
      }

      for (const read of reads) {
        const next = read.current - read.quantity;

        // Dot-path, not a whole-map write, so only the size actually sold is
        // touched. Same choice InventoryService.validateAndDecrementStock makes,
        // and the reason a four-line order is four independent writes that no
        // single clobber can merge into one.
        tx.update(read.ref, {
          [`stock.${read.size}`]: next,
          updatedAt: Timestamp.now(),
        });

        // The ledger row goes in the SAME transaction, so a movement can never
        // be recorded for a decrement that rolled back, or missed for one that
        // committed. `reason: 'sale'` is what lets the admin ledger tell a real
        // sale apart from an admin's manual adjustment — the two were previously
        // indistinguishable, which is precisely why StockLedgerService exists.
        tx.set(db.collection('stockMovements').doc(), {
          productId: read.ref.id,
          variantName: read.variantName,
          size: read.size,
          delta: -read.quantity,
          balanceAfter: next,
          reason: 'sale',
          orderId,
          actorUid: order.customerId ?? null,
          createdAt: Timestamp.now(),
        });
      }

      // The redemption is spent in the SAME transaction as the stock it buys. That
      // single fact is what closes the double-spend race: check and spend are one
      // atomic unit, so two customers racing for the last redemption cannot both
      // win. It also means an order that fails for any other reason above never
      // burns a redemption — the old client-side counter incremented after the
      // order committed, so a cancelled order still consumed a use.
      if (voucherUsage) {
        tx.update(voucherUsage.ref, {
          usageCount: voucherUsage.next,
          updatedAt: Timestamp.now(),
        });
      }
    });
  } catch (err) {
    // The order was cancelled underneath this handler and its stock has already
    // been returned. There is nothing left to confirm: writing `confirmed` here
    // would resurrect an order the customer just cancelled.
    if (err instanceof AlreadyCancelledError) {
      return;
    }
    if (err instanceof VoucherRejectedError) {
      await cancelOrder(orderRef, err.message, `voucher_${err.reason}`, true);
      return;
    }
    if (err instanceof InsufficientStockError) {
      await cancelOrder(orderRef, 'Insufficient stock', 'insufficient_stock', true);
      return;
    }
    // Anything else is a genuine failure and is rethrown so the trigger is
    // retried. Swallowing it would leave a pending order whose stock was never
    // taken — the customer has committed to paying and nobody has reserved their
    // ice cream, which is the exact state the client-side path could also reach
    // and which this file is here to end.
    throw err;
  }

  // ── Step 4: publish the authoritative money ───────────────────────────────
  //
  // These four values OVERWRITE whatever the client sent. That is the whole
  // point: the client is untrusted for money, so its totals are not inputs to
  // this write, they are the thing being replaced.
  //
  // `paymentStatus` is deliberately untouched. This handler reserves stock and
  // confirms the order; capturing payment is a separate system and out of scope
  // here. An order stays 'pending' payment until something else moves it.
  await orderRef.update({
    totalAmount,
    deliveryFee,
    discountAmount,
    grandTotal,
    status: 'confirmed',
    statusHistory: FieldValue.arrayUnion({
      status: 'confirmed',
      timestamp: Timestamp.now(),
    }),
    updatedAt: Timestamp.now(),
  });
});

// ── Handler 2: give the stock back when an order is cancelled ───────────────

/**
 * Returns the stock a cancelled order consumed.
 *
 * Cancelling is the only way stock legitimately comes back, and it is the only
 * moment a trigger can see it happen: the update that sets `status: 'cancelled'`
 * is the one event both the admin queue and the customer's tracker page produce,
 * so it is the single place the restock can be attached without either page
 * having to remember to call one.
 */
export const restockCancelledOrder = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before = event.data?.before.data() as OrderDoc | undefined;
  const after = event.data?.after.data() as OrderDoc | undefined;
  if (!before || !after) return;

  // The TRANSITION, not the state. A second cancellation — a double tap, or the
  // Orders page and the Tracker page cancelling the same order — must not
  // restock twice, and an order that was already cancelled before this handler
  // existed (or before this function was deployed) must not be restocked by its
  // own first update after deployment.
  if (after.status !== 'cancelled' || before.status === 'cancelled') return;

  // `stockRestored: true` on a cancellation written by reconcileOrderStock means
  // "this order never removed any stock" — it was cancelled before its lines
  // could be priced or reserved. Restocking here would invent the entire order's
  // quantity out of nothing and leave the shop able to sell ice cream it does
  // not have. The flag is written by that handler on every path where it cancels
  // without touching stock, which is what makes this pair safe: exactly one of
  // the two handlers ever removes stock for a given order.
  if (after.stockRestored === true) return;

  // …and only while the order was still in the shop. An admin cancelling an
  // `out_for_delivery` order is a legitimate operational action, but the ice
  // cream is on a bike: returning its stock would create inventory the shop can
  // sell a second time. This is the same guard the client's cancelOrder applies
  // before calling restockItems, and the reason the two must agree.
  if (!PRE_DISPATCH_STATUSES.includes(before.status ?? '')) return;

  const orderId = event.params.orderId;
  const orderRef = db.doc(`orders/${orderId}`);
  const items = Array.isArray(after.items) ? after.items : [];

  // Validate and collapse before the transaction, for the same two reasons the
  // create path does: an unvalidated quantity would REMOVE stock, and duplicate
  // lines must add up rather than be applied once each.
  //
  // Unlike the create path there is nothing to cancel here — the order is
  // already cancelled — so a malformed line is logged and skipped rather than
  // aborting the restock of every other line. Skipping is the only safe
  // option: restocking an unvalidated quantity could destroy inventory.
  const restock = new Map<string, { productId: string; size: SizeVariant; quantity: number }>();
  for (const item of items) {
    const productId = typeof item?.productId === 'string' ? item.productId : '';
    const size = item?.size;
    const quantity = item?.quantity;
    if (!productId || !isSizeVariant(size) || !isSellableQuantity(quantity)) {
      console.error(
        `Order ${orderId}: skipping malformed restock line.`,
        JSON.stringify(item ?? null)
      );
      continue;
    }
    const key = `${productId}|${size}`;
    const existing = restock.get(key);
    if (existing) existing.quantity += quantity;
    else restock.set(key, { productId, size, quantity });
  }
  if (restock.size === 0) return;

  try {
    await db.runTransaction(async (tx) => {
      const reads: {
        ref: FirebaseFirestore.DocumentReference;
        size: SizeVariant;
        quantity: number;
        current: number;
        variantName: string;
      }[] = [];

      for (const line of restock.values()) {
        const ref = db.doc(`products/${line.productId}`);
        const snap = await tx.get(ref);
        // A product deleted after the order was placed has no stock to return
        // to. The client's restockItems skips it for the same reason; the loss
        // is recorded by the missing ledger row rather than hidden.
        if (!snap.exists) {
          console.error(`Order ${orderId}: product ${line.productId} is gone; its stock cannot be returned.`);
          continue;
        }
        const product = snap.data() as ProductDoc;
        reads.push({
          ref,
          size: line.size,
          quantity: line.quantity,
          current: stockLevel(product, line.size),
          variantName: product.variantName ?? 'Unknown',
        });
      }

      for (const read of reads) {
        const next = read.current + read.quantity;
        tx.update(read.ref, {
          [`stock.${read.size}`]: next,
          updatedAt: Timestamp.now(),
        });

        // `reason: 'cancel_restock'` is deliberately distinct from the client's
        // 'admin_restock'. They are different events with different
        // accountability: one is a sale being unwound, the other is a staff
        // decision to restock, and the ledger is the only place that distinction
        // survives.
        tx.set(db.collection('stockMovements').doc(), {
          productId: read.ref.id,
          variantName: read.variantName,
          size: read.size,
          delta: read.quantity,
          balanceAfter: next,
          reason: 'cancel_restock',
          orderId,
          actorUid: after.customerId ?? null,
          createdAt: Timestamp.now(),
        });
      }

      // In the SAME transaction, so `stockRestored` can never claim stock that
      // was not returned. Writing the order doc here also cannot re-trigger this
      // function: the status is already 'cancelled', so the guard above rejects
      // the resulting update.
      tx.update(orderRef, {
        stockRestored: true,
        stockRestoredAt: Timestamp.now(),
      });
    });
  } catch (err) {
    // The mirror of the failure path in OrderService.cancelOrder. Without a
    // marker the failure is invisible: the order is cancelled, the trigger will
    // not fire again for it, and nobody would know the stock is still missing.
    // `stockRestored: false` is exactly what AdminRepairPanel filters on, so the
    // order stays in the repair queue instead of being lost.
    console.error(`CRITICAL: restock after cancellation failed for order ${orderId}.`, err);
    try {
      await orderRef.update({ stockRestored: false, stockRestoredAt: null });
    } catch (markerErr) {
      // Even the marker failed. Do not throw this instead of the original error
      // — the original is the one that describes what actually went wrong.
      console.error(`CRITICAL: could not mark order ${orderId} for repair.`, markerErr);
    }
    throw err;
  }
});