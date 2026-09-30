# Five-orites Scoop — Feature Alignment Audit

**Where this sits in the doc set.** `Docs/` holds three documents describing the same
system:

| File | Role | Status |
|---|---|---|
| `five-orites-scoop-gap-analysis_Esguerra.md` | Original gap analysis | **Superseded** |
| `five-orites-scoop-corrected-gap-analysis.md` | Corrected gap analysis (defect-level) | Current |
| `five-orites-scoop-feature-alignment.md` | **This file** — feature-level alignment | Current |

This is the *feature-level* view: which planned capabilities exist, and at what depth.
The corrected gap analysis is the *defect-level* view: what is broken and why. Read this
one to answer "is the feature there?", the other to answer "what is wrong with it?".

The original is retained for provenance. Its evidence column is largely sound, but its
conclusions and several recommended fixes are not; the corrected file records which.

**Purpose:** establish which planned features are actually implemented, so plan-vs-code
drift is visible rather than assumed.

**Date:** 2026-09-30
**Scope:** `Five-orites-Scoop-v1` at the current working state (post-remediation session).

---

## 0. Baseline caveat — read before using this document

This audit compares **the project against itself**, not against a specification.

Both analyses in `Docs/` cite a *"Group 5 planned-features document (PDF)"* as the
source of requirements. **That file does not exist** in the repository or anywhere on
the machine. The only documents present are:

| File | Location | Last written |
|---|---|---|
| `five-orites-scoop-gap-analysis_Esguerra.md` | `Docs/` | 2026-09-29 |
| `five-orites-scoop-corrected-gap-analysis.md` | `Docs/` | 2026-09-30 |
| `README.md` | root | — |
| `REFACTOR_PLAN.md` | root | — |
| `SETUP_GUIDE.txt` | root | — |

Therefore every "required per docs" cell below rests on **quoted fragments with no
surviving original**. Five fragments are recoverable from the superseded analysis:

1. `"Push notifications for promos/order updates"`
2. `"Shopping cart and checkout flow"` · `"order tracking"`
3. `"Search and filter by flavor/price"`
4. `"flavors, tubs, cones, sundaes"`
5. `"add/edit/delete flavors and stock"`

**Action required before this document is treated as a requirements audit:** recover
the original PDF from a team member, or re-confirm these five fragments verbally so the
baseline is recorded rather than remembered.

---

## 1. Alignment matrix

Status key: ✅ aligned · ⚠️ partial / unverified · ❌ absent · 🔀 deliberate deviation

| # | Feature | Required per docs | Actual state | Evidence | Status |
|---|---|---|---|---|---|
| 1 | Login — email/password | Part B "implemented" | Working | `auth.service.ts:117` | ✅ |
| 2 | Login — Google | Part B "implemented" | `signInWithPopup` only; native WebView behaviour unverified | `auth.service.ts:127` | ⚠️ unverifiable |
| 3 | Shopping cart | Req 2 | Per-user storage key, stock cap enforced | `cart.service.ts:14`, `logic/stock.ts:17` | ✅ |
| 4 | **Checkout** | Req 2 | **Was non-functional for every non-admin.** Now fixed, with 23 emulator rules tests | `firestore.rules:58-63` + `order.service.ts:129` | ✅ newly |
| 5 | Order tracking | Req 2 | Live `onSnapshot` + step timeline | `order-tracker.page.ts:81` | ✅ |
| 6 | Order cancel | *addition, not in Req 2* | Was broken; now transactional | `order.service.ts:248` | ✅ newly |
| 7 | **Push — order updates** | Req 1 | In-app only, now owner-driven via a watcher service. No background delivery | `core/services/order-notification.service.ts` | ⚠️ partial |
| 8 | **Push — promos** | Req 1 | **Nothing exists.** No promo/announcement collection | — | ❌ **absent** |
| 9 | Search by flavor | Req 3 | Name, set, in-stock, wishlist filters | `products.page.ts:106` | ✅ |
| 10 | **Filter by price** | Req 3 | Was missing; added this session | `products.page.ts` size/price selects | ✅ newly |
| 11 | Catalog — flavors | Req 4 | 64 flavors, 8 sets × 8 | `seed-products.ts`, `README.md` | ✅ |
| 12 | Catalog — tubs | Req 4 | No `tub` size; pint / half-gallon cover it functionally | `pricing.config.ts:18-23` | ✅ terminology |
| 13 | **Catalog — cones** | Req 4 | `Product.category` exists (`flavor`/`sundae`/`cone`), with a storefront Type filter, a Type picker in both admin modals, and 2 seeded as cones | `core/models/product.model.ts`; `products.page.html`; `scripts/seed-products.ts` → `CATEGORY_BY_VARIANT` | ✅ newly |
| 14 | **Catalog — sundaes** | Req 4 | same mechanism, 6 seeded as sundaes | same | ✅ newly |
| 15 | Add / edit flavors | Req 5 | Modals work, image picker is now keyboard-operable. Admin-created sets still permanently mispriced | `pricing.config.ts:41-43` | ⚠️ partial |
| 16 | **Delete flavors** | Req 5 | Soft delete only; `allow delete: if false` | `firestore.rules:42` | 🔀 deviation |
| 17 | Stock management | Req 5 | Live per-size editing, transactional | `inventory.service.ts:173` | ✅ |
| 18 | Order management (admin) | Part B | Working; out-for-delivery restock hole fixed | `admin-orders.page.ts` | ✅ |
| 19 | Sales report | Part B | Works, **caps at 100 orders** | `order.service.ts:207,212` | ⚠️ partial |
| 20 | Inventory management | Part B | Working | `inventory.page.ts` | ✅ |
| 21 | Ratings & reviews | Part B | Working; 200-review cap, no duplicate prevention | `review.service.ts` | ⚠️ partial |
| 22 | Vouchers | *implied* | Fallback bypass removed this session | `voucher.service.ts` | ✅ newly |
| 23 | Wishlist / address book | Part B | localStorage, per-user keyed | `wishlist.service.ts`, `address.service.ts` | ✅ |

### Score

**17 aligned · 5 partial · 1 absent · 1 deliberate deviation**

The one remaining absent item is **promo notifications** — the plan asked for
"push notifications for promos" and no promo or announcement system exists. Cones
and sundaes were the other two, and both are now implemented.

The seeded cones are the two sorbets: the closest honest existing products,
rather than inventing items the shop does not stock. Admin-created products get a
Type picker, so real cone products can be tagged without touching code. "Tubs"
is covered by the pint and half-gallon sizes rather than being a separate type.

---

## 2. The five "new feature proposals" — 0 of 5 built

These are separated deliberately. They appear under *"New Feature Proposals (kept
separate)"* in the superseded analysis, meaning the author **intentionally excluded
them from the gap section**. They are scope requests, **not alignment debt** — with one
partial exception, now closed: cone and sundae categories appeared in *both* lists,
and as catalog types they were genuine Req 4 drift, so they have been built.

| Proposal | State | Note |
|---|---|---|
| Real background push (FCM + Cloud Functions) | ❌ not started | Blaze plan + real device testing |
| Admin-editable promo/announcement banner | ❌ not started | See trap below |
| Cone and sundae product categories | ✅ **done** | Implemented — see §4.1 |
| Payment gateway (e.g. PayMongo) | ❌ not started | Out of scope for a client-only pass |
| Guest catalog browsing | ❌ not started | `/products` is behind `authGuard` |

> **Trap worth flagging:** `dashboard.page.html:59` contains an element with
> `class="promo-banner"`. It is **not** a promo system — it calls
> `requestNotifications()` (`dashboard.page.ts:220`), making it a *notification
> permission prompt*. Anyone auditing by class name will wrongly tick this proposal
> as implemented.

**The partial exception, now closed:** cone and sundae categories appeared in
*both* lists. As category modelling they were a proposal; but Req 4 names cones
and sundaes as catalog types, so their *absence* was genuine plan-vs-code drift.
Implemented — see §4.1.

---

## 3. Document contradictions

| Conflict | Status |
|---|---|
| `README.md:69-74` claimed the client-side stock decrement *"is correct for the app in use"*, while the gap analysis said checkout should be rejected | **Resolved** — rules fixed, README rewritten |
| `REFACTOR_PLAN.md:247` listed *"per-user order cancellation permissions"* as **explicitly out of scope**, while gap-analysis improvement #1 proposed exactly that | **Resolved** — followed the newer document, but note the team had already declined this once |
| `README.md` describes the catalog as *"64 premium ice cream flavors"* and the plan names cones and sundaes | **Open** — the catalog has no type dimension at all, so the plan's wording is unmet. See §4.1 |
| `REFACTOR_PLAN.md` describes a future aggregation job reading an `analytics` collection; `firestore.rules` has no such block and nothing reads it | **Resolved** — the block was removed as dead per that plan's own Phase 4 |

---

## 4. Recommended next scope

Ordered by effort-to-alignment ratio.

### ✅ 1. Add a `category` field — DONE

Delivered, and the sharp edge was handled: `firestore.rules` validates the
category **only when the field is present**, so the 64 documents seeded before it
existed stay editable instead of being rejected on their next admin change. A
required-field rule would have been a worse regression than the gap it closed.
Four rules cases cover it, including that a category-less document remains
writable.

Also worth noting what shipped alongside: `npm run typecheck` never covered
`scripts/`, so the seed script — the thing that writes 64 documents to production
Firestore — was entirely unverified. `npm run typecheck:scripts` now exists and
immediately caught a real error. And `package.json` now carries an `engines`
upper bound, because Angular 17's own field is a floor and npm silently accepted
Node 24.

### 2. Promo notifications (fixes the last remaining Req 1 drift)

Fully absent, and the larger of the two. Minimum viable version: an
`announcements` collection the admin can write, surfaced as a banner on the dashboard
— which does **not** yet satisfy "push notifications for promos", only the visible
part of it. Real promo push needs FCM + a Cloud Function.

**Estimate:** banner only 2–3 h · with real push, a Cloud Function + Blaze + device testing.

### 3. Pagination for the 100-order cap

Revenue and order counts silently under-report past 100 orders. This is a correctness
gap, not a feature gap, and it needs real pagination rather than a larger limit.

**Estimate:** 3–5 h.

### 4. Ask the team two questions the files cannot answer

- Does *"delete flavors"* mean **hard delete**? The team already chose soft delete once,
  deliberately, and `allow delete: if false` protects order history. A literal reading of
  Req 5 says hard delete; the current behaviour is a justified deviation. **Confirm
  before building.**
- Are the five quoted fragments **verbatim** from the plan? Cone/sundae and promo
  alignment both hinge on the exact wording.

---

## 5. How confident is the "aligned" column?

> **Not deployed, not runtime-verified.** Every fix was checked with
> `npm run typecheck`, `npm run build`, `npm run test:logic` (34 cases) and
> `npm run test:rules` (23 cases, emulator). None has been run against a live
> Firestore project, and no real order has been placed through the fixed
> checkout. A ✅ here means *implemented and inspected*, not *proven working in
> production*.

Two of the fifteen aligned items have automated test coverage — the stock-line
normalisation and the security rules. The rest rest on compilation and review.
See `five-orites-scoop-corrected-gap-analysis.md` Part 5 for the full coverage
map and Part 6 for the pre-demo checklist.

## 6. Pre-demo verification

Static review cannot confirm deployed state. In order:

1. `npm run deploy` — rules **and** indexes must both reach the live project.
2. Sign in as a **non-admin** and place a real order. This is the single test that
   would have caught the original checkout bug.
3. Cancel that order; confirm stock returns to its prior value.
4. Confirm the admin sees the order, and that advancing its status notifies the
   **customer's** device, not the admin's.
5. Sign in as a second customer; confirm neither order is readable.

Automated coverage currently: `npm run test:logic` (34 cases),
`npm run test:rules` (23 cases, Firestore emulator), `npm run typecheck`, `npm run build`.
