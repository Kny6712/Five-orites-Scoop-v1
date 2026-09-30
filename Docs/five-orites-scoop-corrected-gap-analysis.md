Fi# Five-orites Scoop — Corrected Gap Analysis

**Supersedes** `five-orites-scoop-gap-analysis_Esguerra.md` (Esguerra, undated).
That document's *evidence* column is mostly accurate, but its conclusions and
several of its recommended fixes are not. This file records what was verified,
what was wrong, and what has been done about it.

> ### ⚠ NOT DEPLOYED · NOT RUNTIME-VERIFIED
>
> Every fix below was verified by `npm run typecheck`, `npm run build`,
> `npm run test:logic` and `npm run test:rules`. **None has been exercised
> against a live Firestore project.** `npm run deploy` has never been run, and
> no real order has been placed through the fixed checkout.
>
> Only items labelled **Verified** have automated test coverage. Everything
> marked **runtime unverified** is confirmed by inspection and compilation
> alone — that is a real but weaker guarantee, and it is why the
> [pre-demo checklist](#part-6--what-to-verify-before-demoing) is not optional.

**Method.** Static review of the source tree plus execution: `npm install`,
`npm run typecheck`, `npm run build`, `npm run test:logic` (34 cases) and
`npm run test:rules` (23 cases, Firestore emulator). The emulator required
adding `@firebase/rules-unit-testing` and an `emulators` block, which did not
exist before.

**A note on line numbers.** The citations below were written against the
pre-fix tree. Because the fixes shifted line positions, most now point at
unrelated code. Every citation is therefore labelled either **Live** (still
present, re-anchored to the current line) or **Pre-fix** (describes a defect
that no longer exists at that line; the fix location is given instead).

**Where this sits.** `Docs/` also holds
`five-orites-scoop-feature-alignment.md`, the feature-level view — which
planned capabilities exist and at what depth. This file is the defect-level
view: what is broken, what was fixed, and how confident that is.

---

## A source-integrity caveat that applies to every requirement

The superseded document cites a *"Group 5 planned-features document (PDF)"* as
a source. **No such file exists in this repository or anywhere on this
machine** — only `README.md`, `REFACTOR_PLAN.md`, `SETUP_GUIDE.txt` and the
analyses in `Docs/`. Every *"Expected behavior (plan)"* cell in that document
therefore rests on quoted fragments with no surviving source, and **the
requirement baseline cannot be independently verified.** Re-confirm the five
quoted requirements with the team before treating either document as a
requirements audit rather than a code audit.

One methodological claim in the old document *is* correct: the root
`repomix-output.xml` really does contain the project twice (a root copy plus a
128-file `Five-orites-Scoop-v1/` copy) alongside 230 `.claude/` entries. The
clean single-project export is the one inside `Five-orites-Scoop-v1/`.

---

## Part 1 — What the old document got right

These are recorded because they are the checks most likely to be wrong.

| Claim | Status | Anchor |
|---|---|---|
| `firestore.rules` reserved `products` writes to admins | **Pre-fix** | was `:26`; create is still admin-only at `:58` |
| `firestore.rules` reserved `orders` updates to admins | **Pre-fix** | was `:64`; now `:93-104` (admin **or** scoped customer-cancel) |
| `validateAndDecrementStock` writes `products` as the customer | **Live** | `order.service.ts:129` → `inventory.service.ts:302-305` |
| Push is in-app only; the admin's device is notified | **Removed** | calls deleted from `admin-orders.page.ts`; replaced by `order-notification.service.ts` |
| `ProductFilter` had no price field; no user-selectable sort | **Live** | now resolved — see Part 3 #10 |
| `Product` has no category field; 64 flavors, 8 sets × 8 | **Live** | `product.model.ts:25-37` (unchanged); 64 SKUs at `seed-products.ts:30` |
| No `deleteDoc` anywhere; `allow delete: if false` | **Live** | `firestore.rules:64` |
| `index.html` blocked pinch zoom | **Pre-fix** | was `:10`; attributes removed from that same line |
| Analytics reads at most 100 orders | **Live** | `order.service.ts:227,232` — **still uncapped** |
| `buildAppUser` silently downgraded an admin | **Pre-fix** | was `:86-95`; retry loop now `:60-63` |
| Committed API key and unsigned Cloudinary preset | **Live** | `environment.ts:4,18` — **still present, unchanged** |

**The hardest item it got right:** for a dotted write like
`` { 'stock.cup': 4 } ``, `request.resource.data.diff(resource.data).affectedKeys()`
returns the **top-level** key `'stock'`, because `Map.diff()` is shallow and a
Firestore document has no field literally named `stock.cup`. So
`hasOnly(['stock', 'updatedAt'])` is correct. The common mistake —
`hasOnly(['stock.cup', 'updatedAt'])` — was avoided. *(Inferred from Firestore
semantics, not executed against the emulator; the emulator test at
`tests/firestore.rules.test.ts:100-110` exercises the dotted write but does not
assert the key name.)*

---

## Part 2 — What the old document got wrong

### 2.1 Its central fix would have taken the app offline

It presented both rule snippets as complete `match` blocks containing **only**
`allow update`. Applied literally, `match /products/{id}` loses
`allow read: if isSignedIn()` (now `firestore.rules:57`) and `match /orders/{id}`
loses **both** `allow read` (now `:70-71`) and `allow create` (now `:73-84`).
The catalog, cart, dashboard, admin inventory, order list, tracker *and checkout
itself* would break for every user. A fix that silently deletes read rules is
worse than no fix.

### 2.2 The rule dropped the invariant it claimed to keep

The comment `// keep the existing >= 0 checks` annotated code containing no
range or type checks. Under `||`, the customer branch had neither, so a
signed-in user could write `stock.cup = -1000000` — exactly the corruption the
`>= 0` checks exist to prevent. **Fixed:** the checks were extracted to
`stockIsSane()` at `firestore.rules:24-33` and are now applied on *both* the
admin and customer branches (`:63`).

### 2.3 The review rules snippet would not compile

`reviewId == productId + '_' + request.auth.uid` references `productId`, an
**undefined identifier** inside `match /reviews/{reviewId}`. The ruleset would
fail to deploy. `addReview` also used `addDoc`, so document IDs stayed random
and the check could never have matched.

**Fixed, correctly.** The rule now uses
`request.resource.data.productId` (the capture does not exist; the field does,
`firestore.rules:144`) and `allow create, update` at `:141` rather than
create-only, since the second submission is an update. `addReview` writes to a
deterministic `doc()` path, and the author can withdraw their own review
(`:151-154`) — which the old rules allowed *nobody* to do, since `delete` was
admin-only and no admin UI implemented it. Seven cases in
`tests/firestore.rules.test.ts` cover impersonation, cross-user edits and
cross-user deletes.

### 2.4 An unstated cross-collection coupling

`cancelOrder` writes the order, *then* calls `restockItems`. Opening only the
`orders` branch means the cancel **commits** and then throws "cancelled, but
restocking failed", with no recovery path. Opening only the `products` branch
leaves checkout broken. The document never connected these. **Fixed:** both
branches ship in the same rule set, and a test asserts the pairing.

### 2.5 Smaller errors

- **"No sort" is false** — sorting by `setNumber` then `variantName` existed all
  along. The real gap was no *user-selectable* sort. **Live** at
  `inventory.service.ts:92-95`.
- **"200 reviews per product"** — the 200 lived in `getRatingSummary`, which had
  **zero callers**. The live path read 50. The function has since been removed.
- **The broken logo was already fixed** at `app.component.html:15`. Still broken
  on `about.page.html:21`, which the document missed. **Now fixed.**
- **"The export contains the project twice"** — correct, but for the root
  export, not the one inside the project folder.
- **The notification fix missed a third caller**, `order-tracker.page.ts:90`,
  so it would have shipped duplicate toasts. **Fixed**; the call is gone, with a
  comment at `:86-89` explaining the de-duplication.
- **`getCountFromServer` cannot implement the KPI proposed for it.**
  `businessOrders` excludes the admin's own orders, and Firestore has no `!=`
  operator, so a server-side count is a *different number*, not a fix. The API is
  not used anywhere in `src/`.
- **"Tubs" is not a gap.** Pint and half gallon cover a retail tub
  functionally. Cones and sundaes are the real gaps.

---

## Part 3 — Defects the document missed entirely

Ordered by severity.

**Legend** — ✅ *Verified*: an automated test asserts it ·
⚠️ *runtime unverified*: compiles and confirmed by inspection only ·
◻ *Known gap*: not fixed, with a named action · 🔀 *Accepted*: deliberately not
fixed, with rationale.

| # | Defect | Anchor | Status |
|---|---|---|---|
| 1 | **Negative quantity passes the stock check and *raises* stock.** `5 < -5` is false, and the write is `stock - quantity`. Reachable via unvalidated `localStorage` cart rehydration. | Pre-fix `inventory.service.ts:261,270`. Fix: `core/logic/stock.ts:52-67`, called at `inventory.service.ts:274` and `:317`. Rehydration path `cart.service.ts:56-65` is unchanged. | ✅ **Verified** — 10 test cases |
| 2 | **Orders creatable at any price.** The create rule validates no `unitPrice`, `subtotal`, `quantity` or `deliveryFee`. | **Live** — `firestore.rules:73-84` | ⚠️ **Partially fixed.** The client no longer trusts localStorage prices (`order.service.ts:83-93`), but the *rule* still validates nothing. A raw-SDK write can still set any price. |
| 3 | **Client-controlled `unitPrice` fallback**, contradicting the code's own "never trust localStorage prices" comment. | Pre-fix `order.service.ts:75`. Fix: `:83-93` | ⚠️ runtime unverified |
| 4 | **Concurrent cancel double-restocked.** Read-then-write with no transaction; the code's "a retry cannot double-restock" comment was false. | Pre-fix `order.service.ts:237-256`. Fix: `:280-295`, `:299` | ⚠️ runtime unverified — **the concurrency itself is untested** |
| 5 | **Admin cancelling `out_for_delivery` restocked shipped ice cream.** | Pre-fix `order.service.ts:240-241`. Fix: `PRE_DISPATCH_STATUSES` at `:36`, guard at `:307-309`; button hidden at `admin-orders.page.ts:118-121` | ⚠️ runtime unverified |
| 6 | **Admin self-demotion.** `setDoc` without `merge`, hard-coding `role: 'customer'`. | Pre-fix `auth.service.ts:115`. Fix: `:138-146` (`merge: true` at `:145`) | ⚠️ runtime unverified |
| 7 | **Deactivating a voucher did nothing.** Any Firestore error fell through to `BUILT_IN_VOUCHERS`. | Pre-fix `voucher.service.ts:39-44`. Fix: `:31-41` | ⚠️ runtime unverified |
| 8 | **Five error sinks rendered failures as empty states** — "No orders", "No sales data yet.", "No reviews yet – be the first!" The last is a fabricated success. | Pre-fix: `admin-orders.page.ts:97`, `analytics.page.ts:201`, `dashboard.page.ts:124,137,147,175`, `product-detail.page.ts:143`. Fixes: `:97-109`, `:243-252`, `feedFailed()` at `:139-144`, `:181-188` | ✅ **Verified by inspection** — see the correction below |
| 9 | **Deactivated products were still purchasable by direct link.** | Pre-fix `product-detail.page.ts`. Fix: `isUnavailable` at `:126`, `canPurchase` at `:128`, enforced `:235` and `:246-256`; template `:47`, `:115` | ⚠️ runtime unverified |
| 10 | **Duplicate cart lines** were charged twice but decremented once. | Pre-fix `inventory.service.ts:253-275`. Fix: `stock.ts:61-64` | ✅ **Verified** |
| 11 | **Analytics ignored the date range and the 100-order cap.** KPIs read an all-time, newest-100 set and filtered in the browser, so "last 30 days" silently dropped anything past order 100 and "All Time" meant "the newest 100". CSV exported every status while revenue counted only delivered, so the two could never reconcile. | Pre-fix `analytics.page.ts:95,97-99` and the browser-side `inRange()`. Fixes: `OrderService.getOrdersSince` (server-side range query, `order.service.ts:271`), `ANALYTICS_MAX_ORDERS = 500` (`analytics.page.ts:32`), `truncated()` surfaced in the template, CSV now built from `deliveredOnly()` | ⚠️ runtime unverified — the range query's authorisation is ✅ tested, the arithmetic is not |
| 12 | **Accessibility blockers, not 3.** The accordion hid all order actions from keyboard users; the star rating was mouse-only. | Fixes: accordion now `role="button"` + `aria-expanded` + keydown at `admin-orders.page.html:81-92`; star rating `star-rating.component.ts:35-45`, `onStarKey` at `:82-86`; plus set chips, 8 unlabelled fields, 6 icon buttons, viewport | ⚠️ runtime unverified |
| 13 | `PreloadAllModules` cancelled lazy loading — customers downloaded 3 admin-only chunks. | Pre-fix `app.config.ts:16`. Fix: `AdminAwarePreloadingStrategy` at `:64-96` | ⚠️ runtime unverified |
| 14 | `@capacitor/splash-screen` configured but never installed; the native config was dead. | `capacitor.config.ts:18-24` unchanged and now *valid* — dependency added at `package.json:43` | ⚠️ runtime unverified (and unverifiable without a device) |
| 15 | `/favicon.ico` was not an asset, so the SPA rewrite returned **HTTP 200 with an HTML body**. | Fix: inline SVG data-URI favicon at `index.html:19-26` | ⚠️ See correction below |
| 16 | Seeded catalog ships `imageUrl: ''` for all 64 products, and the uploader's source path was a hardcoded `D:\...`. | **Partly fixed** — uploader path is now `--dir`/`IMAGE_DIR`; `images:generate` + `images:seed` produce and wire per-flavor artwork. A plain `npm run seed` is still imageless. | ◻ **Known gap** — see Part 4 #5 |
| 17 | No `noUnusedLocals`, no `ng test` target, no `ng lint` target; nothing caught dead code. | **Live** — `tsconfig.json:3-20`; `angular.json:16` defines only `build` and `serve` | ◻ **Known gap** — see Part 4 #9 |
| 18 | **`bulkRestock` had a lost-update race** — the only stock writer in the service that was not transactional. It read all products, then issued plain `updateDoc`s computing the new level from that pre-loop snapshot, so a customer checkout committing in between was silently overwritten: a real sale erased by a restock. | **Fixed** — `inventory.service.ts` bulk restock now wraps each product in `runTransaction` and re-reads the base inside it | ⚠️ runtime unverified |

### Corrections to the previous revision of this document

Three entries in the earlier version of this file were wrong and are corrected here:

1. **Row 8 was reported "Fixed" on the strength of a subagent's summary.** An
   independent verification pass found that `inventory.page.ts` set a
   `loadError` signal that **`inventory.page.html` never referenced** — a failed
   catalog read still rendered "0 products" over an empty list, with the search
   bar and "Add Product" live over data that never loaded. Now genuinely fixed
   (`inventory.page.html:22-49`, styles in `inventory.page.scss`). The same pass
   found `cart.page.ts:114` had **no error handling at all**, so a failed stock
   read silently disabled the quantity cap. Now surfaced to the user
   (`cart.page.ts:110-135`, `cart.page.html:34-41`).
2. **Row 12 claimed the accordion was fixed when it was not.** It was still a
   bare `<div (click)>`; the accessibility pass had been told that file was out
   of its ownership. Now fixed.
3. **Row 15 was reported "Fixed" but was not.** `src/favicon.ico` is a **0-byte
   file** — it had been since the initial commit, so adding it to the assets
   config only replaced an HTML 200 with an empty-body 200. Replaced with an
   inline SVG data URI, which issues no request at all.

### Claims the document could have made but did not

- **Firestore index requirements are fully verifiable statically, and all three
  composite-requiring queries have correctly-shaped indexes.** There is no
  production-only "query requires an index" bug here. Three of six declared
  indexes are unused.
- **No XSS.** Zero `innerHTML` / `bypassSecurityTrust*` in the codebase.
- **No IDOR** on `/orders/:id`; the owner-read rule closes it, and a test asserts it.
- **No privilege escalation** via `users/{uid}`.
- **Admin routes are properly guarded** by a parent-level
  `canActivate: [authGuard, adminGuard]`.

---

## Part 4 — Remaining known limitations

1. **A signed-in user can write any stock level via the raw SDK.** The rule
   constrains *which keys* may change, not by how much, and cannot tie a stock
   write to an order. Only a Cloud Function closes this. Asserted explicitly in
   `tests/firestore.rules.test.ts:120-130` so it stays visible rather than being
   rediscovered.
2. **The order-create rule still validates no prices** (Part 3 #2). The client
   is now trustworthy; the rule is not.
3. **No background push.** A customer with the app closed receives nothing.
   Needs FCM tokens plus a deployed Cloud Function. In-app notification is
   owner-driven and correct; the delivery *channel* is the gap.
4. **Reporting is capped and says so.** Analytics reads at most 500 orders and
   the fulfillment queue at most 300; both surface a banner when the cap is hit
   so a partial figure never presents as a total. A selected date range is now a
   server-side `where('createdAt','>=',…)` query rather than a browser-side
   filter over the newest 100, so "last 30 days" means what it says. Deeper
   history still needs pagination.
   **Constraint worth knowing:** that range query carries no `customerId`
   filter, so Firestore can only authorise it for an admin. Analytics sits behind
   `adminGuard`, so that holds — but the read must not be reused on a
   customer-facing page without restoring the owner filter. Asserted in
   `tests/firestore.rules.test.ts`.
5. **Product artwork is generated, not photographed — and a plain
   `npm run seed` still leaves the catalog imageless.** ◻ *Action, in order:*
   (a) **done** — `DEFAULT_IMAGE_DIR` in `scripts/upload-product-images.ts` is
   now a `--dir` flag or `IMAGE_DIR`, not a hardcoded `D:\icecream\...` path;
   (b) **done** — `npm run images:generate` writes one distinct SVG per flavor
   to `assets/images/`, and `npm run images:seed` re-seeds pointing each product
   at its artwork instead of an empty string;
   (c) **outstanding** — the seeders still default to the imageless path, so
   nothing forces the artwork step. Either chain it into `npm run seed` or make
   the placeholder path the default.
   **Before demoing:** run `npm run images:generate && npm run images:seed`.
   A storefront showing one generic scoop 64 times reads as unfinished in a way
   no other gap here does.
6. **No payment gateway.** Every order stays `paymentStatus: 'pending'`.
7. **Catalog types now exist: `flavor` | `sundae` | `cone`.** A `category`
   field on `Product`, a Type picker in both admin modals, a storefront Type
   filter, and a `CATEGORY_BY_VARIANT` map in the seeder assigning 6 sundaes and
   2 cones (the sorbets — the closest honest candidates, no products invented
   to fill the category). The seeder **fails loudly** if that map names a
   product that does not exist, because a typo would otherwise yield an empty
   filter with no error anywhere.
   **`firestore.rules` validates the category, and this was the sharp edge.** The
   check applies only when the field is *present*: the 64 existing documents
   predate it, and a mandatory rule would reject every one of them on its next
   admin edit — a regression far worse than the gap. Four cases in
   `tests/firestore.rules.test.ts` cover it, including that a category-less
   document remains editable.
   **Still open:** "tubs" is not a type — pint and half-gallon cover it
   functionally. Admin-created *sets* above number 8 remain mispriced to the
   Chocolate tier, because `getPricingForSet` falls back and the edit modal never
   patches pricing.

8. **Node version is now enforced.** `package.json` carries an `engines` block
   with an upper bound. Angular 17's own `engines` field is a floor, so npm
   silently accepted Node 24 and the mismatch surfaced as build failures with no
   diagnostic pointing at the version. `.nvmrc` alone was advisory — nothing read
   it.
9. **`scripts/` is now typechecked.** `npm run typecheck` only ever covered
   `tsconfig.app.json`, which lists just `src/main.ts`, so the seed script —
   the thing that writes 64 documents to production Firestore — was entirely
   unverified. Adding `npm run typecheck:scripts` immediately surfaced a real
   error (`admin.firestore.Firestore` annotating a `require()`'d value, which can
   never resolve). `npm run verify` now chains both.
10. **Duplicate reviews are closed.** Reviews use a deterministic id
    (`${productId}_${uid}`), the rules require that id to match its author and
    product, and an author may edit or withdraw their own review. Previously a
    user could post unlimited reviews that neither they nor any admin UI could
    remove. Covered by 7 cases in `tests/firestore.rules.test.ts`.
11. **No `noUnusedLocals`, no lint or test target in `angular.json`.** ◻
    *Action:* set `"noUnusedLocals": true` in `tsconfig.json` and expect a first
    pass of failures to clean up — do it as its own commit, not mid-feature. The
    11 dead symbols removed this pass were all found by hand, and nothing
    prevents the next ones. A `lint` target needs ESLint + `angular-eslint`
    configured from scratch; that is a larger task and is deliberately not
    attempted here.
12. **Restock-after-cancel failure has no self-healing path.** A retry
    short-circuits on `status === 'cancelled'`. Needs staff repair, or a marker
    field the rules would have to permit.
13. **The concurrency fix for double-restock is untested.** `runTransaction`
    around the cancel is correct by inspection, but no test exercises two
    simultaneous cancels. (`bulkRestock` had the same class of bug — a
    `getDocs` followed by plain `updateDoc`s — and is now transactional, also
    untested against real concurrency.) The *policy* both rest on is now pinned
    by a `pre-dispatch stock return` test, but the mechanism is not.
14. **Admin-created flavor sets above number 8 are permanently mispriced** to the
    Chocolate tier: `getPricingForSet` falls back for any unrecognised set
    number, and the edit modal never patches `pricing`. Unrelated to categories,
    but it is a live data bug in the catalog. ◻ *Action:* let the add/edit modal
    edit price per size.

---

## Part 5 — Files changed

55 modified, 5 added. Grouped by purpose.

| Area | Files |
|---|---|
| **Security rules** | `firestore.rules`, `firebase.json` (emulators block) |
| **Core logic** | `core/logic/stock.ts`, `core/services/order.service.ts`, `inventory.service.ts`, `auth.service.ts`, `voucher.service.ts` |
| **New** | `core/services/order-notification.service.ts`, `tests/firestore.rules.test.ts` |
| **Tests** | `tests/logic.test.ts` (24 → 40 cases) |
| **Catalog types** | `core/models/product.model.ts` (`ProductCategory`, `productCategory()`, `PRODUCT_CATEGORIES`), `core/logic/stock.ts` (`SIZE_VARIANTS`), `scripts/seed-products.ts` (`CATEGORY_BY_VARIANT` + `assertProductCategories()`), `scripts/generate-placeholder-images.ts` *(new)*, `assets/images/*.svg` *(new, 64)*, admin add/edit modals, `products.page.{ts,html}` |
| **Admin UI** | `admin-orders.page.{ts,html,scss}`, `analytics.page.{ts,html}`, `inventory.page.{ts,html,scss}`, `add-product-modal`, `edit-product-modal` |
| **Customer UI** | `products.page.{ts,html,scss}`, `product-detail.page.{ts,html}`, `cart.page.{ts,html,scss}`, `dashboard.page.{ts,html}`, `order-tracker.page.ts`, `auth.page.html`, `about.page.html` |
| **Shared** | `star-rating.component.ts`, `product-card.component.html`, `app.component.ts`, `app.config.ts` |
| **Config/docs** | `package.json`, `angular.json`, `capacitor.config.ts` (via dependency), `index.html`, `README.md`, `.gitignore` |

### Test coverage map

| Fix | Covered by |
|---|---|
| #1 negative quantity, #10 duplicate lines | `tests/logic.test.ts` — 10 cases in `normaliseStockLines` |
| Catalog categories, incl. absent-field tolerance | `tests/logic.test.ts` — 4 cases in `product category` |
| Pre-dispatch stock-return policy | `tests/logic.test.ts` — 2 cases |
| Customer stock write, customer cancel scope, negative stock, pricing write, forged `statusHistory`, IDOR, review de-duplication/ownership, the analytics range read, category validation | `tests/firestore.rules.test.ts` — 37 cases |
| Everything else | **No automated test.** Verified by `typecheck` + `build` only |

That last row is the honest limit. Around half the fixes still rest on
inspection rather than on a test that would fail if the behaviour regressed —
notably the transactional cancel and bulk restock, which are correct by reading
but have never been run against real concurrency.

`npm run verify` now chains: app typecheck · scripts typecheck · logic tests ·
rules tests · production build.

---

## Part 6 — What to verify before demoing

Static review cannot confirm deployed state. In order:

1. `npm run deploy` — rules **and** indexes must both reach the live project.
   Hosting alone does not deploy indexes, which is why the script pairs them.
2. Sign in as a **non-admin** and place a real order. This is the single test
   that would have caught the original bug.
3. Cancel that order; confirm stock returns to its prior value.
4. Open the same order in two tabs, cancel in both, and confirm stock returns
   **once**. This exercises the untested concurrency fix (Part 4 #12).
5. As admin, advance the status and confirm the notification appears on the
   **customer's** device, not the admin's.
6. Sign in as a second customer; confirm neither order is readable.
7. Withdraw network access and open the admin inventory page — it must show an
   error, not "0 products".
8. Run the emulator suite: `npm run test:rules`.

Items 2–7 cannot be automated with the current test setup and need a real
device or browser against a live project.
