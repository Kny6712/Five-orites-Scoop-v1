# Five-orites Scoop — Refactor & Bug-Fix Plan

Scope: remove dead code, consolidate duplicated config, and fix the critical
correctness/security/deploy bugs found during the `repomix-output.xml` review.
No new features. No new paid services.

> ### ⚠ HISTORICAL DOCUMENT — READ `CUTOVER.md` INSTEAD
>
> **The assumption below is false.** This plan was written for a client-only app
> with no Cloud Functions. `functions/` now exists and owns stock reservation,
> order pricing, and voucher redemption — and it is **written but not deployed**.
>
> Nearly all of this plan is done (Phases 0–6 were largely executed). What it
> cannot describe is the thing that matters now: a **half-finished migration**
> where the client has stopped writing stock but the server-side replacement is
> not live, which means sales currently do not decrement inventory.
>
> Do not work from this file. Use:
>
> - **`CUTOVER.md`** — the stock cutover, which is the current blocker
> - **`README.md` → "Known limitations"** — what is and is not true today
>
> The phase structure below is kept for history only. Statements like "out of
> scope for a client-only pass" were accurate when written and are now wrong.

**Assumption (as originally written, and now false):** client-only (no Cloud
Functions). One item (#3) has a stronger fix that needs Cloud Functions — flagged
as optional.

---

## Phase 0 — Baseline

Confirm the project actually builds before touching anything, so we can tell our
own breakage from pre-existing breakage.

```bash
npm install
npm run typecheck
npm run build
npm run test:logic
```

Record the output. If `npm install` fails on peer deps, use `--legacy-peer-deps`
(as `SETUP_GUIDE.txt` already instructs).

---

## Phase 1 — Deploy & tooling (unblocks everything else)

These are small, and nothing after Phase 1 can be verified without them.

| #   | File                  | Change                                                                                                                                                      |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `firebase.json`       | `hosting.public`: `"www"` → `"www/browser"` (Angular 17 `application` builder emits to `www/browser`; `www/index.html` does not exist)                      |
| 2   | `capacitor.config.ts` | `webDir`: `'www'` → `'www/browser'`                                                                                                                         |
| 3   | `angular.json`        | Add `fileReplacements` to the `production` configuration so `environment.prod.ts` is actually used                                                          |
| 4   | `package.json`        | `"test": "ng test"` and `"lint": "ng lint"` reference targets that **do not exist** in `angular.json`. Remove both until real targets are added in Phase 5. |

**Verify:** `npm run build` → confirm `www/browser/index.html` exists.

---

## Phase 2 — Critical correctness & security

### 2.1 Voucher discount is client-supplied — `order.service.ts` (HIGH)

`placeOrder(address, notes, voucher?: { code, discount })` trusts a discount the
caller computed. It is only clamped to `totalAmount`, so a tampered client can
send `discount: totalAmount` and place a ₱0 order.

**Fix:** change the signature to accept only the code, and resolve the discount
internally.

```ts
// before
placeOrder(address: string, notes?: string, voucher?: { code: string; discount: number })

// after
placeOrder(address: string, notes?: string, voucherCode?: string | null)
```

`OrderService` calls `VoucherService.validateVoucher(code, totalAmount)` itself
and uses the returned `discount`. Callers stop computing money.

- `OrderService` gains a `VoucherService` injection.
- `cart.page.ts` passes `this.appliedVoucher()` (the code) instead of
  `{ code, discount }`.
- Circular-import check: `VoucherService` imports only Firestore + the voucher
  model, so `OrderService → VoucherService` is safe.

**Also in `firestore.rules`** (orders `create`): clamp the field so a raw SDK
write cannot exceed the subtotal.

```
&& request.resource.data.discountAmount >= 0
&& request.resource.data.discountAmount <= request.resource.data.totalAmount
```

> **Optional upgrade (needs Cloud Functions):** a rules `get()` on
> `vouchers/{code}` can verify a percent discount, but not `minOrder` or the
> fixed-amount case cleanly. A callable function is the only airtight fix.
> Deferred — out of scope for a client-only pass.

### 2.2 Stock decrement is not atomic with order creation — `order.service.ts` (HIGH)

`validateAndDecrementStock()` commits its transaction, then `addDoc()` runs
separately. If the order write fails, stock is gone permanently.

**Fix (compensating rollback):** track that the decrement succeeded; on any
failure after it, call `restockItems()` with the same line items before
rethrowing.

```ts
let stockCommitted = false;
try {
  await this.inventoryService.validateAndDecrementStock(stockItems);
  stockCommitted = true;
  const orderRef = await addDoc(ordersCol, orderData);
  this.cartService.clearCart();
  return orderRef.id;
} catch (err) {
  if (stockCommitted) {
    await this.inventoryService.restockItems(stockItems).catch(console.error);
  }
  throw err;
}
```

Also fixes the mirror case in `cancelOrder()`: restock currently runs _before_
the status update, so a failed update double-restockes. Reorder so the status
write commits first, then restock.

### 2.3 Cart is not scoped per user — `cart.service.ts` (MEDIUM)

Key is the global `five_orites_cart`, while `wishlist.service.ts` and
`address.service.ts` both key by `uid`. On a shared device the cart leaks
between accounts.

**Fix:** key by uid exactly like the other two services —
`five_orites_cart_v1` → `Record<uid, Cart>`, rehydrate on
`AuthService.currentUser$`, clear on sign-out. Keeps the existing
`{items, totalAmount, itemCount}` shape and the recalculate-on-load behaviour.

### 2.4 `updateQuantity()` has no stock cap — `cart.service.ts` (MEDIUM)

Only `addItem()` validates against stock, so the cart stepper can be pushed
past available stock and the order fails late at checkout.

**Fix:** `updateQuantity()` gains an optional `available` argument and clamps
(or throws) against it. `cart.page.ts` needs live stock to pass it — subscribe
to `InventoryService.getProducts()` in the cart page and build a
`productId|size → qty` map. Also cap the `+` button in `cart.page.html`
(line 50 currently has no `[disabled]`).

### 2.5 Low-stock threshold hardcoded in 4 places (LOW)

`environment.lowStockThreshold` is read by 3 TS files, but the number `10` is
written literally in:

- `shared/pipes/stock-status.pipe.ts`
- `features/products/products/product-detail.page.html` (lines ~6937–6941)
- `shared/components/product-card/product-card.component.html` (lines ~7930–7934)
- (admin inventory HTML compares against the TS-provided value — already fine)

**Fix:** expose a shared `LOW_STOCK_THRESHOLD` from one place and bind the
templates to it instead of a literal.

---

## Phase 3 — UI / logic bugs

| #   | File                                 | Bug                                                                                                                                                                                 | Fix                                                                                    |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 3.1 | `app.component.html:8375`            | `<img src="">` — empty `src` renders a broken image and can re-request the page                                                                                                     | Point at `assets/placeholder-scoop.svg`                                                |
| 3.2 | `order-status-badge.component.ts:46` | `out_for_delivery: 'tertiary'` — `--ion-color-tertiary` is never defined in `theme/variables.scss`, so the chip renders uncoloured. (`developers.page.ts:75` also uses `tertiary`.) | Add an `--ion-color-tertiary` token to `variables.scss`                                |
| 3.3 | `app.component.ts` + `.html`         | `NavItem.role` is declared but never used for filtering, so signed-out guests see "My Cart" / "My Orders" and get bounced to `/auth`                                                | Actually filter by `role` (use the field, don't delete it)                             |
| 3.4 | `admin/inventory/inventory.page.ts`  | `saveStock()` issues 4 sequential transactions; the edit modal uses the atomic `updateStocks()` for the same job                                                                    | Call `updateStocks()` once                                                             |
| 3.5 | `add-product-modal.component.ts`     | Dropdown lists only `SET_NAMES` 1–8, but a new set is assigned `maxSetNumber + 1`. Custom sets are unselectable and can collide                                                     | Build the option list from loaded products ∪ `SET_NAMES`, so admin-created sets appear |
| 3.6 | `admin/orders/admin-orders.page.ts`  | `filteredOrders` is an arrow property, not `computed()` — recomputes every CD cycle, inconsistent with every other page                                                             | Convert to `computed()`                                                                |
| 3.7 | `index.html:9163`                    | `<link rel="shortcut icon" type="image/png" href="favicon.ico" />` — MIME says PNG, file is ICO                                                                                     | `type="image/x-icon"`                                                                  |

---

## Phase 4 — Dead code & duplication

**Delete (verified zero references):**

| Symbol                                                                           | Location                                                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `StockHistoryEntry` interface                                                    | `core/models/product.model.ts`                                                                            |
| `ProductFilter.minPrice` / `.maxPrice`                                           | `core/models/product.model.ts`                                                                            |
| `Order.paymentReference`                                                         | `core/models/order.model.ts`                                                                              |
| `CartService.hasItem()`                                                          | `core/services/cart.service.ts`                                                                           |
| `InventoryService.getProductsBySet()`                                            | `core/services/inventory.service.ts`                                                                      |
| `StockStatusPipe` (+ its export)                                                 | `shared/pipes/stock-status.pipe.ts` — imported by `product-detail.page.ts` but never used in any template |
| `AnalyticsPage` `activeOrders`, `cancelledOrders`, `pendingOrders` computeds     | `admin/analytics/analytics.page.ts` — not referenced in the template                                      |
| `InventoryPage` `isLowStock()` / `isOutOfStock()`                                | `admin/inventory/inventory.page.ts` — template uses inline class bindings                                 |
| `environment.deliveryFeePhp`, `environment.freeDeliveryThresholdPhp`             | all 3 environment files — **never read**; `cart.model.ts` hardcodes 50/500                                |
| Unused imports `IonHeader, IonToolbar, IonTitle, IonNote`, `personCircleOutline` | `app.component.ts`                                                                                        |

**Also:** the `analytics` collection block in `firestore.rules` — nothing in the
app reads or writes it. Remove, or keep as a placeholder for the documented
future aggregation jobs. Recommend removing.

**Not deleting — deliberately:**

- `order.model.ts` `ORDER_STATUS_META.description` — used by the tracker template.
- `firestore.rules` product `allow delete: if false` — intentional (deactivate, don't delete).
- `environment.example.ts` — serves as setup documentation.

---

## Phase 5 — Make the tests real

`tests/logic.test.mjs` **re-implements** `getDeliveryFee`, `calculateDiscount`,
`summarizeRatings` and the stock-cap rule inline. It can pass while the app is
broken, so it proves nothing.

**Fix:** extract the pure business logic into framework-free modules with zero
Angular/Firebase imports, then import them from the tests.

- New `core/logic/delivery.ts` — `getDeliveryFee`, thresholds
- New `core/logic/voucher.ts` — `calculateDiscount`
- New `core/logic/rating.ts` — `summarizeRatings`
- New `core/logic/stock.ts` — the add-to-cart stock-cap rule (extracted from
  `CartService.addItem` so there is exactly one implementation)

`cart.model.ts` / `voucher.model.ts` / `review.model.ts` re-export from these so
existing imports keep working — no call-site churn.

Run with `tsx` (one devDependency, native TS, no config):

```json
"test:logic": "tsx --test tests/*.test.ts"
```

`node --test` + `tsx` covers the existing 4 suites. No test framework added.

**Optional, if a lint gate is wanted:** add ESLint + `angular-eslint` and a real
`lint` target in `angular.json`, restoring the script removed in Phase 1. Kept
separate so Phase 1 stays small.

---

## Phase 6 — Documentation accuracy

`README.md` currently overstates two things. Fix the claims, not the code:

- **"Push notifications for every status change"** — untrue.
  `NotificationService.notifyOrderStatusChange()` is called by the **admin's**
  client after it writes a status, and by the customer's tracker for its own
  device. The customer is not notified unless they have the tracker open.
  Real push needs Cloud Functions (already listed as out of scope).
- **"Role-based access via Firebase Auth custom claims"** — untrue. Role is a
  field on `users/{uid}` in Firestore, and `firestore.rules` `isAdmin()` reads
  that document. There are no custom claims anywhere.
- `SETUP_GUIDE.txt` says "2 things only" then lists three.
- `pricing.config.ts` and several files carry `// Author: [Developer Placeholder]`.

---

## Explicitly out of scope

Cloud Functions, payment gateway, CSV import, real push, PWA manifest, and
per-user order cancellation permissions. No behaviour is added beyond what is
listed above.

---

## Risk & rollback

Each phase is independent and touches distinct files, so a phase can be reverted
on its own. Phases 1 and 2 are the ones worth reviewing carefully — they are the
only ones that change runtime behaviour. Phases 3–5 are cosmetic or structural.

Commit per phase, not one big commit.
