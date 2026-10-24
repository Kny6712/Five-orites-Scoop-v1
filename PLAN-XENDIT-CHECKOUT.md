# PLAN — Checkout & Payment Journey (Xendit)

**Status:** PLAN ONLY — no implementation performed. Awaiting approval.
**Date:** October 24, 2026
**App inspected:** Live at `http://localhost:8100` (Firestore/Auth emulator backend). Sign-up, add-to-cart, cart, Place Order, order tracker, and My Orders were all exercised end-to-end in a real browser.

> Everything marked **(VERIFIED)** was confirmed by reading the actual source or from official Xendit documentation. Everything marked **(RECOMMENDATION)** is a proposal, not yet implemented. Everything marked **(UNKNOWN)** must be resolved before or during implementation.

---

## 1. Current Flow & Gaps (VERIFIED)

### 1.1 The journey as it exists today

1. **Browse** — `/products`. Pick flavor + size, tap **Add to Cart**. Cart badge increments in the side menu. Stock is checked client-side against the live product doc.
2. **My Cart** — `/cart`. Shows line items (name, set·size, unit price, quantity stepper, line subtotal, remove), **Clear Cart**, **Delivery Details** (Delivery Address `*` textarea + optional Order Notes), **Order Summary** (Subtotal / Delivery Fee / Total), **Voucher** (promo code + Apply), and a gold **Place Order** button.
3. **Place Order** — client validates the address is non-empty, then calls `OrderService.placeOrder()`, which:
   - re-prices every line server-side from Firestore (authoritative),
   - resolves the voucher discount from Firestore,
   - writes the order doc with `status: 'pending'` and `paymentStatus: 'pending'`,
   - clears the cart, flips the page to its confirmation step, and auto-redirects to `/orders/:id` after ~4s.
4. **Order tracker** — `/orders/:id`. Fulfillment timeline (Placed → Confirmed → Preparing → Out for Delivery → Delivered), items, totals, delivery address, map, and a **Cancel** action while pending.
5. **My Orders** — `/orders`. Paginated history with totals and **Cancel** while pending.

Delivery pricing: flat **₱50** fee, waived above a **₱500** subtotal threshold, and a live "Add ₱X more for FREE delivery" hint. These constants are duplicated in `src/app/core/logic/delivery.ts` (client) and `functions/src/config.ts` (server), and a test asserts the two copies stay in sync.

### 1.2 What is missing

| Area                                 | Finding (VERIFIED)                                                                                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment provider                     | None. README "Known limitations": _"No payment gateway. Every order is written with `paymentStatus: 'pending'` and stays that way."_                                                                                          |
| `paymentReference` field             | Deliberately absent from `Order` (`order.model.ts:34-35`): _"no payment gateway is integrated… Add it back when one is."_                                                                                                     |
| Reachable payment states             | `paymentStatus: 'pending' \| 'paid' \| 'failed' \| 'refunded'` exist on the model, but `'paid' \| 'failed' \| 'refunded'` are **unreachable** — nothing ever writes them.                                                     |
| Payment handoff step                 | None. "Place Order" commits the order immediately; there is no "Continue to Payment".                                                                                                                                         |
| Resume / pay an unpaid order         | None. A `pending` order can only be cancelled, never paid.                                                                                                                                                                    |
| Webhook receiver                     | None. No backend endpoint exists to be notified of payment events.                                                                                                                                                            |
| Duplicate-payment protection         | None at the payment layer (a double-tap guard exists inside `placeOrder()` only).                                                                                                                                             |
| Abandoned / expired payment handling | None.                                                                                                                                                                                                                         |
| Serverless hosting for payment code  | **Blocked.** Project is on the Firebase **Spark (free)** plan and cannot deploy Cloud Functions (confirmed in README, `CUTOVER.md`, and the old `functions/` package being retired in favour of a staff-gated stock cutover). |

---

## 2. Recommended Journey & Rationale (RECOMMENDATION)

**Keep checkout on My Cart. Add a "Continue to Payment" step, then hand off to a provider-hosted checkout (Xendit Payment Session / Payment Link).**

### Why stay on My Cart rather than a dedicated checkout screen

- My Cart already holds everything a checkout screen would need: items, delivery details, voucher, summary, total. Splitting screens would duplicate the summary and force the customer to re-orient.
- The app is Ionic/Angular, mobile-first and shipped via Capacitor. The current two-column desktop layout (items + delivery left, summary + CTA right) already separates "what you're buying" from "what it costs / pay" — a natural seam for a payment handoff. On mobile it collapses to one column, which is the correct pattern for small screens.
- Fewer taps on mobile. A dedicated checkout screen adds a full navigation step for no new information.

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
Backend calls Xendit    POST /v3/payment_requests  (PHP, grandTotal)
Backend stores          paymentRequestId on the order
Returns                 checkout URL
        │
        ▼
Customer is redirected to Xendit-hosted checkout
        │
        ├─ success  → webhook → paymentStatus:'paid', status:'confirmed'
        ├─ cancel   → return URL → "Payment not completed" + Resume
        ├─ failure  → return URL → "Payment failed" + Try Again
        ▼
Order tracker  /orders/:id   (shows payment status beside fulfillment status)
```

### Button labels and their meaning

| State                     | Label                          | Meaning                                                                          |
| ------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| Cart, ready               | **Continue to Payment**        | Creates the order + payment session, then leaves the app. Order is not yet paid. |
| Preparing                 | _Preparing payment…_ (spinner) | Backend creating order + Xendit session.                                         |
| Returned, cancelled       | **Resume Payment**             | New payment session against the **same** order. No duplicate order.              |
| Returned, failed          | **Try Again**                  | New payment session against the **same** order.                                  |
| Unpaid order in My Orders | **Pay Now**                    | New payment session for an existing unpaid order.                                |

### When the order record is created

At **Continue to Payment**, _before_ the redirect. The order is born `pending`/`pending` (unpaid) so that every later action — resume, retry, Pay Now — reuses the same order ID instead of minting duplicates. Cart is cleared only after payment is confirmed by the webhook.

### Cart behaviour by outcome

| Outcome      | Cart                                   | Order                                                            |
| ------------ | -------------------------------------- | ---------------------------------------------------------------- |
| Success      | Cleared after webhook confirms payment | `paymentStatus:'paid'`, `status:'confirmed'`                     |
| Failure      | Preserved                              | `paymentStatus:'failed'`, order stays `pending`                  |
| Cancellation | Preserved                              | `paymentStatus:'pending'`, order stays `pending` (payable later) |
| Abandonment  | Preserved in localStorage              | Stays `pending` until paid or expired                            |

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

_Design note:_ Keep the current app identity. Avoid card-inside-card / nested outlined boxes — separate the summary, voucher and delivery blocks with **whitespace and typographic hierarchy**, not extra borders. Functional input borders (address, notes, promo) stay, because they signal "you can type here". The final payable amount (Total) must remain the visually dominant number near the CTA.

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

### 3.3 Payment result — success

```
Payment received ✅
──────────────────
Your payment of ₱115 was successful.
Order #A5ICWL is confirmed.

[ View Order Tracker ]   [ Order More ]
```

### 3.4 Payment result — cancelled / failed

```
Payment not completed
─────────────────────
We didn't get a payment for this order. It's still open —
you can finish paying whenever you're ready.

Order #A5ICWL · ₱115 · Payment: pending

[ Resume Payment ]   [ Try Again ]   [ View Order ]
```

### 3.5 My Orders — unpaid order row

```
#A5ICWL · Oct 24, 09:20 AM
Status: Order Placed      Payment: ⏳ Unpaid
Chocolate Fudge Brownie · 1 scoop · ₱115
[ Pay Now ]  [ Cancel ]
```

---

## 4. Provider Approach — Xendit (VERIFIED from official docs)

### 4.1 Documentation consulted

- `https://docs.xendit.co/` — documentation index
- `https://xendit-docs.document360.io/docs/available-payment-products` — Payments API vs Payment Session vs Plug-ins comparison
- `https://xendit-docs.document360.io/docs/how-payment-sessions-work` — hosted checkout / Payment Link flow
- `https://xendit-docs.document360.io/docs/how-payments-api-work` — Payments API v3, endpoints
- `https://xendit-docs.document360.io/docs/available-payment-methods` — PH channel codes and limits
- `https://xendit-docs.document360.io/docs/handling-webhooks` — webhook verification, duplicate handling, retries

### 4.2 Chosen product: Payment Session (provider-hosted checkout)

Lowest development effort, no card-entry UI in our app (keeps us out of PCI scope), Xendit hosts and secures the payment page. This satisfies the requirement of building no custom card-entry interface unless a verified need exists — and no such need was found.

### 4.3 Verified integration steps

1. Backend calls **`POST https://api.xendit.co/v3/payment_requests`** (Payments API v3) with:
   - `reference_id` — our order ID (idempotency anchor)
   - `type: "PAY"`
   - `currency: "PHP"`
   - `amount` — the order's `grandTotal`
   - `channel_code` — optional; e.g. `GCASH`, `PAYMAYA`, `CARDS`. Omit to let Xendit present all enabled methods.
   - `channel_properties.success_return_url` / `failure_return_url` / `cancel_return_url` — deep links back into the app
   - `description` — human-readable order summary
2. Xendit returns a `payment_request_id`, a `status`, and an `actions[]` array whose `type` is `REDIRECT_CUSTOMER` and whose `value` is the hosted checkout URL.
3. Backend persists `paymentRequestId` on the order doc, returns the checkout URL to the client.
4. Client redirects the customer to that URL (external browser / in-app browser window).
5. Customer pays on Xendit's page.
6. Xendit posts a **webhook** to our endpoint, signed with the `x-callback-token` header.
7. Backend verifies the token, updates `paymentStatus:'paid'`, advances `status:'confirmed'`.

> **(UNKNOWN)** Confirm the exact v3 request/response field names and the webhook event names/payload shapes against the live sandbox before hard-coding. The list above reflects the documented shape at time of writing and must be re-checked.

### 4.4 Verified Philippine payment methods

| Channel code         | Display name       | Min    | Max          | Flow           | Processing |
| -------------------- | ------------------ | ------ | ------------ | -------------- | ---------- |
| `GCASH`              | GCash              | ₱1     | ₱100,000     | REDIRECT       | Instant    |
| `PAYMAYA`            | PayMaya            | ₱1     | ₱100,000     | REDIRECT, SKIP | Instant    |
| `GRABPAY`            | GrabPay            | ₱1     | ₱100,000     | REDIRECT, SKIP | Instant    |
| `CARDS`              | Cards              | ₱5,000 | ₱200,000,000 | REDIRECT, SKIP | Instant    |
| `BDO_ONLINE_BANKING` | BDO Online Banking | ₱1     | ₱2,000,000   | REDIRECT       | ~0.5 h     |

All are PHP-denominated and support desktop + mobile.

> Note: `CARDS` has a **₱5,000 minimum**. Our typical basket is ₱65–₱500, so Cards will frequently be below minimum. GCash / PayMaya / GrabPay (min ₱1) are the realistic defaults for this shop. Decide which methods to enable.

### 4.5 Credentials & account requirements

- **Xendit business account** — sign up at `dashboard.xendit.co`. Test mode is available immediately; **live mode requires KYC/business verification, which can take days.**
- **Secret API key** — backend only, never in the Angular bundle.
- **Webhook verification token** — from Dashboard → Developer settings → Webhooks.
- **Public HTTPS webhook URL** — localhost is not reachable by Xendit in production; use a tunnel (ngrok etc.) for local testing and a real host for production.

---

## 5. Exact Files / Components Affected

### Frontend (Angular + Ionic)

| File                                                             | Change                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/features/cart/cart.page.ts`                             | Replace `placeOrder()` with `continueToPayment()`; add payment states (`preparing`, `payment_pending`, `payment_success`, `payment_failure`, `payment_cancelled`); add Resume/Try-Again logic; handle return-from-payment. |
| `src/app/features/cart/cart.page.html`                           | "Place Order" → "Continue to Payment"; add payment status UI; reposition voucher near the total.                                                                                                                           |
| `src/app/features/cart/cart.page.scss`                           | Style the payment states; keep the no-nested-cards treatment.                                                                                                                                                              |
| `src/app/core/models/order.model.ts`                             | Add `paymentReference?`, `paymentRequestId?`, `paymentMethod?`, `paidAt?`.                                                                                                                                                 |
| `src/app/core/services/orders/order.service.ts`                  | New methods: create payment session (calls backend), re-initiate payment for an existing order, poll/observe payment status.                                                                                               |
| `src/app/features/orders/orders.page.ts` + `.html`               | "Pay Now" action for unpaid orders; payment-status badge per row.                                                                                                                                                          |
| `src/app/features/order-tracker/order-tracker.page.ts` + `.html` | Show payment status alongside fulfillment status.                                                                                                                                                                          |
| `src/app/features/dashboard/dashboard.page.*`                    | Revenue should count **paid** orders, not merely delivered ones.                                                                                                                                                           |
| `src/app/shared/content/about-content.ts`                        | The "Secure Payments" copy was rewritten because no gateway existed; it can now be replaced with a truthful statement once payments are real.                                                                              |

### Backend (NEW — must live outside Firebase Functions; see §10)

| Component                                 | Change                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| New payment service (e.g. Express / Node) | `POST /payment/session` → create Xendit payment request, persist `paymentRequestId`, return checkout URL. |
|                                           | `POST /payment/webhook` → verify `x-callback-token`, parse event, update order, idempotent.               |
| Secret storage                            | Xendit secret key + webhook token via environment variables. **Never** in the frontend or in the repo.    |

### Database (Firestore)

| Target                         | Change                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders/{id}.paymentReference` | New — Xendit payment reference.                                                                                                                                       |
| `orders/{id}.paymentRequestId` | New — Xendit payment request ID (idempotency anchor).                                                                                                                 |
| `orders/{id}.paymentMethod`    | New — channel code used.                                                                                                                                              |
| `orders/{id}.paidAt`           | New — timestamp of confirmed payment.                                                                                                                                 |
| `firestore.rules`              | Keep the `orders` create whitelist consistent with the new fields. The backend writes via the Admin SDK and bypasses rules, but the client-side rules must not drift. |

---

## 6. Frontend / Backend / API / DB Change Detail

### 6.1 Frontend

1. **`cart.page.ts`**
   - Extend the checkout step signal to include payment states.
   - `continueToPayment()`: validate address, call the order service to create the order **and** the payment session, show _Preparing payment…_, then redirect to the Xendit URL.
   - On return, read query params **only to choose which screen to show**. Never treat the redirect as proof of payment — confirmation comes from the webhook (poll the order's `paymentStatus`).
   - "Resume Payment" reuses the existing unpaid order.
2. **`cart.page.html`** — button label change, payment status messaging, delivery validation kept adjacent to the address field, voucher placed near the total.
3. **`order.model.ts`** — the four new payment fields (§5).
4. **`orders.page.ts/html`** — payment badge + "Pay Now".
5. **`order-tracker.page.ts/html`** — a "Payment: paid / pending / failed" line.

### 6.2 Backend (new service)

1. **`POST /payment/session`** — receives `{ orderId, amount, currency, channelCode?, returnUrls }`; re-reads the order server-side and re-validates price/voucher/delivery; calls Xendit; stores `paymentRequestId`; returns `{ checkoutUrl }`.
2. **`POST /payment/webhook`** — verifies `x-callback-token`; updates `paymentStatus` and `status`; **idempotent** (skip if the order already reflects this state).

### 6.3 Security invariants (must hold)

- Xendit secret key and webhook token exist **only** on the server, via env vars.
- Amount charged is recomputed server-side from the order doc — never trusted from the client.
- Payment confirmation is driven by the **verified webhook**, not by a browser redirect.
- No card data, tokens, or full webhook payloads are logged or rendered.

### 6.4 Database rules

- The `orders` `create` whitelist is extended for the new fields.
- If the client is ever allowed to update payment fields on its own order, restrict it to orders still in `pending` so a paid order cannot be tampered with. Preferred: the client never writes payment fields at all; the backend (Admin SDK) does.

---

## 7. Order & Payment Lifecycle (failure and recovery)

```
Order created            { status:'pending', paymentStatus:'pending' }
        │
        ▼
Customer redirected to Xendit-hosted checkout
        │
        ├─► Payment succeeds ──────────┐
        │    webhook → paid            │
        │    order → confirmed         │
        │    show success screen       │
        │    clear cart                │
        │    redirect to tracker       │
        │                              │
        ├─► Payment fails ─────────────┤
        │    webhook → failed          │
        │    order stays pending       │
        │    "Try Again" → new session │
        │                              │
        ├─► Customer cancels ──────────┤
        │    return URL → cancelled    │
        │    order stays pending       │
        │    "Resume Payment"          │
        │                              │
        └─► Abandoned (never returns) ─┤
             order stays pending       │
             Xendit session expires    │
             My Orders → "Pay Now"     │
                                       │
Staff advances fulfillment ────────────┴─► existing staff stock transaction
```

### Statuses stay separate

- **Fulfillment:** `pending → confirmed → preparing → out_for_delivery → delivered` (+ `cancelled`)
- **Payment:** `pending → paid → failed → refunded`

They move independently. A concrete policy question this exposes (see §10): should staff be able to advance an order toward `preparing` while `paymentStatus` is still `pending`? Today stock is taken on the status transition regardless of payment.

### Duplicate handling

- **Double-tap on Continue to Payment** — disable the button while the request is in flight (same pattern as the existing `isPlacingOrder` guard).
- **Duplicate webhook deliveries** — backend checks current `paymentStatus` before writing; `payment_request_id` serves as the idempotency key.
- **Resume / Pay Now never duplicate orders** — the same order ID is reused; only a new payment session is created.

---

## 8. Phased Implementation Plan

### Phase 1 — Backend payment service _(no frontend dependency; can run in parallel)_

- Stand up the payment service (Express/Node) with the Xendit SDK.
- Implement `POST /payment/session` and `POST /payment/webhook` with token verification.
- Obtain Xendit **test** account + test keys.
- **Blocker:** requires a hostable backend (Firebase Functions are unavailable on Spark).

### Phase 2 — Frontend model + cart payment initiation _(depends on Phase 1 endpoint URL)_

- `order.model.ts` payment fields.
- `cart.page.ts` — `continueToPayment()`, payment states.
- `cart.page.html` — button label + payment UI.

### Phase 3 — Order tracking + resume _(depends on Phase 2)_

- `orders.page.*` — "Pay Now" + payment badge.
- `order-tracker.page.*` — payment status line.

### Phase 4 — Dashboard + hardening _(depends on Phase 3)_

- Dashboard revenue counts paid orders.
- Server-side price/voucher re-validation at session creation.

### Phase 5 — Production readiness _(depends on all of the above + Xendit KYC)_

- Live account and production keys.
- Public HTTPS webhook endpoint.
- Remove test-mode conditionals.

---

## 9. Testing Checklist

| Area              | Test                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Sandbox payments  | GCash, PayMaya, Cards test flows in Xendit test mode — success, failure, cancellation.                                              |
| Mobile            | Cart layout at 390 px; "Continue to Payment" tap target ≥ 44 px; external redirect works from the in-app browser.                   |
| Validation        | Empty address blocked; empty cart blocked; voucher re-validated server-side before payment.                                         |
| Duplicates        | Double-tap "Continue to Payment" produces **one** payment session; a replayed webhook causes **no** double update.                  |
| Webhooks          | Valid token updates the order; invalid token is rejected; retried webhook is idempotent.                                            |
| Resume / recover  | Return from a cancelled payment → "Resume Payment" reuses the same order; close the browser and return later → My Orders "Pay Now". |
| Status separation | `status` and `paymentStatus` render independently on the tracker.                                                                   |
| Cart behaviour    | Success clears the cart; failure/cancel preserves it.                                                                               |
| Security          | Secret keys absent from the frontend bundle; no card data in logs or UI; amounts re-validated server-side.                          |
| Regression        | Existing order placement (without payment), stock decrement, and voucher redemption tests still pass (`npm run test`).              |

---

## 10. Unresolved Decisions, Credentials & Account Requirements

### 🔴 Critical blocker — backend hosting

The project is on the Firebase **Spark** plan and **cannot deploy Cloud Functions**. Creating a Xendit payment session and receiving webhooks both require a server that can hold a secret key, make server-to-server calls, and receive public HTTPS traffic.

**Decision needed — where does the payment backend live?**

1. A new Express/Node service deployed elsewhere (Render, Railway, Fly.io, etc.).
2. Upgrade Firebase to **Blaze** and use Cloud Functions (the `functions/` package is already scaffolded).
3. Xendit **Payment Links** created from the dashboard (no code, but no dynamic per-order amounts — poor fit for variable carts).

### 🟡 Credentials not yet obtained

- Xendit business account.
- Xendit **secret API key** (test mode immediate; live mode gated on KYC).
- Xendit **webhook verification token**.
- Public **HTTPS URL** for the webhook endpoint.

### 🟡 Policy decisions

- May staff advance an order to `confirmed`/`preparing` while `paymentStatus` is still `pending`? (Today, yes — stock is taken regardless.)
- What happens to an unpaid order after the Xendit session expires — auto-cancel, or leave `pending` indefinitely?
- Who initiates refunds, and through which tool (Xendit dashboard vs API)?

### 🟢 Unknowns to verify against the live sandbox

- Exact v3 request/response field names and webhook event names/payload shapes for PHP.
- Whether all PH channels (GCash, PayMaya, Cards) are enabled in test mode or only some.
- Session-expiry duration for an unpaid Xendit payment request.
- Whether `CARDS`' ₱5,000 minimum should exclude it from the enabled-method list for this shop.

---

## Summary

**Verified:** the app has a complete cart → order → tracker flow with **no payment layer**. `paymentStatus` exists on the model but is permanently stuck at `'pending'`; there is no payment provider, no webhook handler, and no payment reference field. Xendit's hosted Payment Session is a documented, verified fit for a Philippine ice-cream shop (GCash, PayMaya, GrabPay, Cards) and avoids building any card-entry UI.

**Recommendation:** adopt the journey in §2, but **do not begin implementation** until the backend-hosting question in §10 is answered and Xendit credentials are in hand.
