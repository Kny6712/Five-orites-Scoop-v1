# PLAN — Checkout & Payment Journey (Simulated, Internal Only)

**Status:** PLAN ONLY — no implementation performed. Awaiting approval.
**Date:** October 24, 2026
**App inspected:** Live at `http://localhost:8100` (Firestore/Auth emulator backend). Sign-up, add-to-cart, cart, Place Order, order tracker, and My Orders were all exercised end-to-end in a real browser.

> Everything marked **(VERIFIED)** was confirmed by reading the actual source. Everything marked **(RECOMMENDATION)** is a proposal, not yet implemented. Everything marked **(UNKNOWN)** must be resolved before or during implementation.

---

## 1. Current Flow & Gaps (VERIFIED)

### 1.1 The journey as it exists today

1. **Browse** — `/products`. Pick flavor + size, tap **Add to Cart**. Cart badge increments in the side menu. Stock is checked client-side against the live product doc.
2. **My Cart** — `/cart`. Shows line items (name, set·size, unit price, quantity stepper, line subtotal, remove), **Clear Cart**, **Delivery Details** (Delivery Address `*` textarea + optional Order Notes), **Order Summary** (Subtotal / Delivery Fee / Total), **Voucher** (promo code + Apply), and a gold **Continue to Payment** button.
3. **Place Order** — client validates the address is non-empty, then calls `OrderService.placeOrder()`, which:
   - re-prices every line server-side from Firestore (authoritative),
   - resolves the voucher discount from Firestore,
   - writes the order doc with `status: 'pending'` and `paymentStatus: 'pending'`,
   - clears the cart, flips the page to its confirmation step, and auto-redirects to `/orders/:id` after ~4s.
4. **Order tracker** — `/orders/:id`. Fulfillment timeline (Placed → Confirmed → Preparing → Out for Delivery → Delivered), items, totals, delivery address, map, and a **Cancel** action while pending.
5. **My Orders** — `/orders`. Paginated history with totals and **Cancel** while pending.

Delivery pricing: flat **₱50** fee, waived above a **₱500** subtotal threshold, and a live "Add ₱X more for FREE delivery" hint. These constants are duplicated in `src/app/core/logic/delivery.ts` (client) and `functions/src/config.ts` (server), and a test asserts the two copies stay in sync.

### 1.2 What is missing

| Area                             | Finding (VERIFIED)                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment provider                 | None. README "Known limitations": _"No payment gateway. Every order is written with `paymentStatus: 'pending'` and stays that way."_                                      |
| `paymentReference` field         | Deliberately absent from `Order` (`order.model.ts:34-35`): _"no payment gateway is integrated… Add it back when one is."_                                                 |
| Reachable payment states         | `paymentStatus: 'pending' \| 'paid' \| 'failed' \| 'refunded'` exist on the model, but `'paid' \| 'failed' \| 'refunded'` are **unreachable** — nothing ever writes them. |
| Payment handoff step             | None. "Place Order" commits the order immediately; there is no "Continue to Payment".                                                                                     |
| Resume / pay an unpaid order     | None. A `pending` order can only be cancelled, never paid.                                                                                                                |
| Simulated payment step           | None. No internal "Simulate Successful Payment" action exists for checkout, demo, or testing.                                                                             |
| Simulated receipt                | None. No demo receipt is shown or printable after a simulated payment.                                                                                                    |
| Admin fulfillment of paid orders | Exists independently (staff advance `status` in the fulfilment queue), but is not wired to payment state.                                                                 |

---

## 2. Recommended Journey & Rationale (RECOMMENDATION)

**Keep checkout on My Cart. Add a "Simulate Successful Payment" step that replaces any external gateway handoff.**

No Xendit, no PayMongo, no external payment gateway, no webhook receiver, no payment server deployment, no secret keys, no HTTPS endpoint. Payment is an internal simulation exercised entirely within the app.

### Target journey

```
My Cart (items + delivery + voucher + summary)
        │
        ▼
"Continue to Payment"  (replaces "Place Order")
        │
        ├─ client validates: address present, cart non-empty
        ├─ server re-validates: prices, voucher, delivery fee, stock
        ▼
Backend creates order  { status:'pending', paymentStatus:'pending' }
        │
        ▼
"Simulate Successful Payment" button shown on the order
        │
        ├─ click → internal simulation (no external call)
        ▼
Backend marks order { paymentStatus:'paid', paidAt: now }
        │
        ▼
Demo receipt shown → customer can print it
        │
        ▼
Order tracker  /orders/:id   (shows payment status beside fulfillment status)
        │
        ▼
Staff advances fulfillment status (confirmed → preparing → out_for_delivery → delivered)
        │
        ▼
Admin prints / re-prints demo receipt from the order
```

### Button labels and their meaning

| State                     | Label                           | Meaning                                                                          |
| ------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| Cart, ready               | **Continue to Payment**         | Creates the order (unpaid). Order is not yet paid.                               |
| Order created, unpaid     | **Simulate Successful Payment** | Internal simulation: marks `paymentStatus:'paid'`, sets `paidAt`, shows receipt. |
| Payment already made      | (receipt shown / re-printable)  | Payment is final; no second simulation.                                          |
| Unpaid order in My Orders | **Pay Now**                     | Opens the same "Simulate Successful Payment" flow against the existing order.    |
| Admin, fulfilled order    | **Print Demo Receipt**          | Re-renders the order's simulated receipt for the shop's copy.                    |

### When the order record is created

At **Continue to Payment**, before any payment step. The order is born `pending`/`pending` (unpaid) so that every later action — pay now, resume, retry — reuses the same order ID instead of minting duplicates.

### Cart behaviour by outcome

| Outcome           | Cart                        | Order                                                       |
| ----------------- | --------------------------- | ----------------------------------------------------------- |
| Simulated success | Cleared after receipt shown | `paymentStatus:'paid'`, `status:'confirmed'` (payment only) |
| Not yet paid      | Preserved                   | `paymentStatus:'pending'`, order stays `pending`            |
| Cancelled         | Preserved                   | `paymentStatus:'pending'`, order `cancelled`                |

---

## 3. Text Wireframes (RECOMMENDATION)

### 3.1 My Cart — desktop, two columns

```
┌──────────────────────────────────────────────────────────────────┐
│ My Cart                                        ◀ BACK            │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  YOUR ITEMS                                   ┌ ORDER SUMMARY ┐ │
│                                               │               │ │
│  Chocolate Fudge Brownie                      │ Subtotal  ₱65 │ │
│  Chocolates · Cup                             │ Voucher   −₱0 │ │
│  ₱65 each   [−] 1 [+]        ₱65              │ Delivery  ₱50 │ │
│  [🗑 Remove]                                  │ ───────────── │ │
│                                               │ Total    ₱115 │ │
│  Clear Cart                                   │ (payable now) │ │
│                                               └───────────────┘ │
│                                                                  │
│  DELIVERY DETAILS                            ┌ VOUCHER ───────┐ │
│  Delivery Address *                          │ Promo code      │ │
│  ┌────────────────────────────────────┐      │ [________][Apply]│ │
│  │ Enter your full delivery address…  │      └─────────────────┘ │
│  └────────────────────────────────────┘                          │
│  Order Notes (optional)                                          │
│  ┌────────────────────────────────────┐                          │
│  └────────────────────────────────────┘                          │
│                                                                  │
│  [ Continue to Payment ]   ← gold CTA, full width of the rail    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 My Cart — mobile, single column

```
My Cart        ◀ BACK
──────────────────────────
YOUR ITEMS
Chocolate Fudge Brownie
Chocolates · Cup   ₱65 each
[−] 1 [+]               ₱65
[🗑 Remove]

Clear Cart

DELIVERY DETAILS
Delivery Address *
_________________________
Order Notes (optional)
_________________________

ORDER SUMMARY
Subtotal        ₱65
Delivery Fee    ₱50
Total       ₱115

VOUCHER
Promo code [________][Apply]

[ Continue to Payment ]
```

### 3.3 Simulated payment — success (demo receipt)

```
🍦 FIVE-ORITES SCOOP — SIMULATED RECEIPT ────────────────────────
⚠️  SIMULATED — No real money was taken. This is a demo receipt.

Order #A5ICWL
Placed: Oct 24, 09:20 AM
Payment: SIMULATED — Successful
Paid at: Oct 24, 09:21 AM

Items:
  Chocolate Fudge Brownie · Cup · 1 × ₱65 = ₱65

Subtotal      ₱65
Voucher       −₱0
Delivery Fee  ₱50
─────────────────────────
Total         ₱115

Delivery Address:
123 Ice Cream Lane, Brgy. Cubao, Quezon City

[ Print Receipt ]   [ View Order Tracker ]   [ Order More ]
```

### 3.4 Payment not yet completed

```
Payment not completed
─────────────────────
This order has not been paid for yet. It's still open —
you can complete the simulated payment whenever you're ready.

Order #A5ICWL · ₱115 · Payment: Unpaid

[ Simulate Successful Payment ]   [ View Order ]   [ Edit Cart ]
```

### 3.5 My Orders — unpaid order row

```
#A5ICWL · Oct 24, 09:20 AM
Status: Order Placed      Payment: ⏳ Unpaid
Chocolate Fudge Brownie · 1 scoop · ₱115
[ Simulate Successful Payment ]  [ Cancel ]
```

### 3.6 Admin — Order Fulfillment row (paid)

```
#A5ICWL · Oct 24, 09:20 AM
Status: Confirmed         Payment: ✅ Paid (SIMULATED)
Chocolate Fudge Brownie · 1 scoop · ₱115
[ Next step: Preparing ]   [ Print Demo Receipt ]
```

---

## 4. Provider Approach — None (Simulated Internal Flow)

No external provider is involved. There is no Xendit, no PayMongo, no payment gateway, no webhook, no payment server, and no deployment target for payment code.

### What replaces the gateway

| Old gateway concept           | Replacement (simulated, internal)                                   |
| ----------------------------- | ------------------------------------------------------------------- |
| Xendit Payment Session        | Client-side button "Simulate Successful Payment"                    |
| Xendit checkout URL           | None — the app stays in the same browser tab                        |
| Xendit webhook                | None — the client updates `paymentStatus` directly on the order doc |
| `x-callback-token`            | Not needed — no server-to-server callback                           |
| Secret API key                | Not needed — no external call is made                               |
| Public HTTPS webhook URL      | Not needed — no webhook endpoint exists                             |
| Payment server (Express/Node) | Not needed — simulation runs in the frontend                        |

### Credentials & account requirements

**None.** No Xendit account, no API key, no webhook token, no public URL, no hosted backend.

---

## 5. Exact Files / Components Affected

### Frontend (Angular + Ionic)

| File                                                             | Change                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/features/cart/cart.page.ts`                             | `continueToPayment()` creates the order (unpaid) and shows the simulated-payment button instead of redirecting to Xendit; remove `paymentService`/`isConfigured` checks; add simulated-payment handler. |
| `src/app/features/cart/cart.page.html`                           | "Place Order" → "Continue to Payment"; add "Simulate Successful Payment" button on the order result screen; add demo receipt UI; remove Xendit channel picker (GCash/PayMaya/GrabPay).                  |
| `src/app/features/cart/cart.page.scss`                           | Style the simulated-payment button and demo receipt panel.                                                                                                                                              |
| `src/app/core/models/order.model.ts`                             | Keep `paymentReference?`, `paymentRequestId?`, `paymentMethod?`, `paidAt?` — repurpose as simulation record fields (all marked SIMULATED).                                                              |
| `src/app/core/services/orders/order.service.ts`                  | `placeOrder()` writes `paymentStatus: 'pending'` (unchanged). No payment session call.                                                                                                                  |
| `src/app/core/services/orders/payment.service.ts`                | **Removed or deprecated** — no backend to call. `isConfigured` always false / not used.                                                                                                                 |
| `src/app/core/models/payment.model.ts`                           | Remove `XenditChannelCode`, `PAYMENT_CHANNEL_META`, `PaymentSession`, channel picker types; keep `PaymentOutcome` if still used for result screens.                                                     |
| `src/app/features/orders/orders.page.ts` + `.html`               | "Pay Now" opens simulated-payment flow for unpaid orders; payment-status badge per row labelled "SIMULATED".                                                                                            |
| `src/app/features/order-tracker/order-tracker.page.ts` + `.html` | Show payment status alongside fulfillment status; add "Simulate Successful Payment" for unpaid orders; mark payment status as "SIMULATED".                                                              |
| `src/app/features/dashboard/dashboard.page.*`                    | Revenue should count **paid** orders (simulated), not merely delivered ones.                                                                                                                            |
| `src/app/shared/content/about-content.ts`                        | The "Secure Payments" copy should be replaced with a truthful statement: payments are simulated internally; no real gateway is integrated.                                                              |

### Database (Firestore)

| Target                         | Change                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `orders/{id}.paymentReference` | Kept — simulation writes a simulated reference (e.g. `SIM-<orderId>`) so paid orders are distinguishable from legacy unpaid ones.                      |
| `orders/{id}.paymentRequestId` | Kept — unused in simulation; retained for schema compatibility.                                                                                        |
| `orders/{id}.paymentMethod`    | Kept — set to `"SIMULATED"` on successful simulation.                                                                                                  |
| `orders/{id}.paidAt`           | Kept — set to `serverTimestamp()` when the simulated payment succeeds.                                                                                 |
| `firestore.rules`              | Keep the `orders` create whitelist consistent with the existing fields. No new server-side payment fields to protect — simulation is client-triggered. |

### Deleted / retired

| Component                                 | Reason                                 |
| ----------------------------------------- | -------------------------------------- |
| `payment-server/` directory               | No external backend is needed.         |
| `payment-server/README.md`                | No payment server to document.         |
| `payment-server/.env.example`             | No Xendit keys or tokens to configure. |
| `src/environments/*.ts` `payment.baseUrl` | No payment backend URL to point at.    |

---

## 6. Frontend / Backend / API / DB Change Detail

### 6.1 Frontend

1. **`cart.page.ts`**
   - `continueToPayment()`: validate address, call `orderService.placeOrder()`, show the order result screen with a **"Simulate Successful Payment"** button. No `paymentService` call, no redirect, no channel picker.
   - `simulatePayment()`: marks the order `paymentStatus: 'paid'`, `paymentMethod: 'SIMULATED'`, `paidAt: now`, `paymentReference: 'SIM-<orderId>'`; shows the demo receipt; clears the cart.
   - On result screens, never treat a local action as proof of anything external — the simulation _is_ the confirmation.
   - "Resume Payment" / "Pay Now" opens the same simulated-payment flow against the existing unpaid order.

2. **`cart.page.html`** — button label change ("Continue to Payment"), demo receipt panel, "Simulate Successful Payment" button, remove the payment-method channel picker.

3. **`order.model.ts`** — the payment fields (§5) are retained but repurposed as simulation records; every payment field written by the simulation carries a "SIMULATED" marker.

4. **`orders.page.ts/html`** — payment badge labelled "SIMULATED"; "Pay Now" triggers the simulated flow.

5. **`order-tracker.page.ts/html`** — "Payment: Paid (SIMULATED)" line; "Simulate Successful Payment" for unpaid orders.

### 6.2 Backend

**None.** No backend service is created or modified for payments. The simulated payment writes directly to the order document from the client (consistent with the existing client-side order placement model where staff, not a server, own stock and fulfillment transitions).

### 6.3 Security invariants (must hold)

- **No external payment call exists**, so there are no external keys, tokens, or webhooks to leak.
- The amount is recomputed from the order doc (authoritative) — no client-supplied amount is ever trusted.
- All payments and receipts are visibly labelled **SIMULATED** so no customer or staff member can mistake them for real transactions.
- No card data, wallet credentials, or real money is ever requested, stored, or logged.

### 6.4 Database rules

- No changes required beyond what already exists: the `orders` create whitelist already permits the payment fields.
- The client writes payment fields on its own order (simulation), consistent with the existing model where the client creates orders.

---

## 7. Order & Payment Lifecycle (simulated)

```
Order created            { status:'pending', paymentStatus:'pending' }
        │
        ▼
Customer clicks "Simulate Successful Payment"
        │
        ├─► Simulation succeeds ──────────┐
        │    order → paymentStatus:'paid' │
        │    paidAt := now                │
        │    paymentMethod := 'SIMULATED' │
        │    paymentReference := 'SIM-…'  │
        │    demo receipt shown           │
        │    cart cleared                 │
        │    redirect to tracker          │
        │                                 │
        └─► Not simulated (stays unpaid) ─┤
             order stays pending          │
             "Pay Now" / "Simulate …"    │
                                         │
Staff advances fulfillment ───────────────┴─► existing status transition
   (confirmed → preparing → out_for_delivery → delivered)
```

### Statuses stay separate

- **Fulfillment:** `pending → confirmed → preparing → out_for_delivery → delivered` (+ `cancelled`)
- **Payment:** `pending → paid` (simulated only; `failed`/`refunded` unused)

They move independently. Staff advance fulfillment regardless of payment state — the shop's existing staff-gated stock rule applies unchanged.

---

## 8. Phased Implementation Plan

### Phase 1 — Simulated payment in the cart (frontend only)

- `cart.page.ts`: `continueToPayment()` creates the order unpaid; add `simulatePayment()` handler.
- `cart.page.html`: "Continue to Payment" button; "Simulate Successful Payment" button on result screen; demo receipt panel.
- `cart.page.scss`: style the simulated-payment button and receipt.
- No backend, no payment server, no Xendit.

### Phase 2 — Order model + fields (frontend only)

- `order.model.ts`: confirm `paymentReference`, `paymentMethod`, `paidAt` are used as simulation records; all values marked "SIMULATED".
- `payment.model.ts`: remove Xendit channel types if no longer referenced.

### Phase 3 — Order tracking + resume / Pay Now (frontend only)

- `orders.page.*`: "Pay Now" triggers simulated payment; payment badge labelled "SIMULATED".
- `order-tracker.page.*`: payment status line labelled "SIMULATED"; "Simulate Successful Payment" for unpaid orders.

### Phase 4 — Admin fulfillment + demo receipt re-print (frontend only)

- `admin-orders.page.*`: payment status badge labelled "SIMULATED"; "Print Demo Receipt" action on paid orders.
- Dashboard revenue counts simulated `paid` orders.

### Phase 5 — Testing, cleanup & retirement

- Remove `payment-server/` directory, `.env.example`, and `payment.baseUrl` from environments.
- Remove `XenditChannelCode` / `PAYMENT_CHANNEL_META` from `payment.model.ts`.
- Deprecate `payment.service.ts` (no backend to call).
- Update `about-content.ts` "Secure Payments" copy to state payments are simulated internally.

---

## 9. Testing Checklist

| Area              | Test                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Simulated payment | "Simulate Successful Payment" marks `paymentStatus:'paid'`, sets `paidAt`, `paymentMethod:'SIMULATED'`, `paymentReference:'SIM-…'`. |
| Demo receipt      | Receipt shows order id, items, totals, delivery address, and is visibly labelled **SIMULATED**.                                     |
| Print receipt     | Browser print dialog opens for the demo receipt; "Print Demo Receipt" on admin re-renders it.                                       |
| Mobile            | Cart layout at 390 px; "Continue to Payment" tap target ≥ 44 px; "Simulate Successful Payment" reachable on small screens.          |
| Validation        | Empty address blocked; empty cart blocked; voucher re-validated server-side before order creation.                                  |
| Duplicates        | Simulating twice on the same order is a no-op (order already `paid`).                                                               |
| Resume / recover  | Unpaid order in My Orders → "Pay Now" opens the simulated flow against the same order (no duplicate).                               |
| Status separation | `status` and `paymentStatus` render independently on the tracker.                                                                   |
| Cart behaviour    | Simulated success clears the cart; unpaid order preserves it.                                                                       |
| Admin             | Staff can advance fulfillment on a simulated-paid order; "Print Demo Receipt" works.                                                |
| Labels            | Every payment and receipt on screen carries "SIMULATED" — none can be mistaken for real money.                                      |
| Regression        | Existing order placement, stock transition, and voucher tests still pass (`npm run test`).                                          |

---

## 10. Unresolved Decisions & Known Gaps

### Policy decisions

- Should staff be able to advance an order to `confirmed`/`preparing` while `paymentStatus` is still `pending`? (Today, yes — stock is taken regardless, per `CUTOVER.md`. Unchanged.)
- Should a simulated-paid order be allowed to be cancelled by staff after payment? (Allowed today; unchanged.)
- Should the demo receipt be printable from the customer's order tracker as well as admin? (Proposed: yes, from both.)

### Unknowns to verify

- None related to external providers (there are none).
- Confirm `firestore.rules` permits the client to write `paymentStatus`, `paidAt`, `paymentReference`, `paymentMethod` on its own orders.

---

## Summary

**Verified:** the app has a complete cart → order → tracker flow with **no payment layer**. `paymentStatus` exists on the model but is permanently stuck at `'pending'`; there is no payment provider, no webhook handler, and no payment reference field.

**Recommendation:** adopt the simulated internal flow in §2 — **no Xendit, no PayMongo, no external gateway, no payment server, no webhook, no secret keys, no HTTPS deployment**. The customer creates an unpaid order, clicks "Simulate Successful Payment", the order is marked `paid` (SIMULATED), a demo receipt is shown and printable, and staff advance fulfillment independently.

**Do not begin implementation** until this plan is approved. Planning only.
