# 🍦 Five-orites Scoop

**Premium Ice Cream E-Commerce + Real-Time Inventory Management System**

> _"Premium ice cream, scooped to your door"_

---

## Project Overview

Five-orites Scoop is a production-grade cross-platform mobile/web application built with **Ionic 7 + Angular 17 + Firebase**. It enables customers to browse 64 ice cream flavors, order by size, and track orders in real time - with in-app notifications on every status change - while giving store admins a live inventory and fulfillment dashboard.

---

## Tech Stack

| Layer     | Technology                                   |
| --------- | -------------------------------------------- |
| Framework | Ionic 7 + Angular 17 (Standalone Components) |
| Native    | Capacitor 5 (iOS + Android)                  |
| Backend   | Firebase Firestore + Firebase Auth           |
| State     | RxJS BehaviorSubject + Angular Signals       |
| Styling   | SCSS + Ionic CSS Variables                   |
| Language  | TypeScript 5 (strict mode)                   |
| Currency  | Philippine Peso (₱)                          |

---

## Features

### Customer

- Browse **64 premium ice cream products** across 8 flavor sets, filterable by
  **type** (flavor / sundae / cone), flavor set, size and max price; search by
  name; toggle in-stock only;
  sort by featured, price or name
- Select size: **Cup · Pint · Half Gallon · Gallon**
- Add to cart, adjust quantity, checkout with delivery address
- **Real-time order status tracker** (Pending → Preparing → Delivered)
- Cancel a pending order; stock is returned automatically
- Voucher codes (e.g. `SCOOP10`, `FREE50`), saved address book, wishlist, and
  product reviews
- In-app toasts on status change, wherever they are in the app (see the honest
  note on notifications below)
- Google Sign-In + Email/Password authentication, with password reset
- Every credential failure reports the same "Incorrect email or password", and
  the reset confirmation is identical whether or not an account exists, so the
  login form cannot be used to discover which addresses are registered

### Admin

- **Inventory Manager**: Live stock view per product/size; inline edit with atomic Firestore updates
- **Order Fulfillment**: Filter orders by status, expand detail panel, advance order stages
- **Sales Analytics**: Revenue KPIs, delivered order count, top flavors by units sold, CSV export
- **Low stock alerts**: Live dashboard banner when any SKU drops below threshold
- Role-based access via a `role` field on the user's Firestore document
  (`users/{uid}`), enforced by `firestore.rules` — **not** Firebase Auth
  custom claims, which are not used anywhere in this project

---

## Known limitations (please read before demoing)

These are real constraints of the current build, documented here so the claims
above are not mistaken for more than they are.

- **Notifications are in-app only, by design.** This is a deliberate scope
  decision, not an unfinished feature. There is no push provider and no SMS
  gateway in this project, and no Cloud Functions to fan anything out through.
  What exists instead:
  - A **persistent feed** at `/notifications`, reachable from the side menu, with
    an unread badge on the bell row. Entries are **derived from each order's
    `statusHistory`** rather than stored in a notifications collection, so the
    feed cannot drift out of step with the orders it describes and costs no extra
    Firestore writes. See `src/app/core/logic/notifications.ts`.
  - A **toast** while the app is open, fired by `OrderNotificationService` when
    it observes a genuine transition on the signed-in user's own orders. The
    earlier version fired from whichever client _performed_ the change, so the
    toast appeared on the admin's device and the customer saw nothing. That is
    fixed.
  - A single on/off preference (`notificationsEnabled` on the user document),
    editable from Settings, Dashboard and Profile — all three read the same field.

  **What you do not get:** nothing arrives when the app is closed or killed.
  Real background push needs an FCM token store plus a deployed Cloud Function to
  fan out from, and this project is on the free Spark plan, which cannot deploy
  functions at all. The `@capacitor/push-notifications` dependency has been
  **removed** rather than left dormant: it called `register()` with no
  `registration` listener anywhere, so no token was ever obtained and the toggle
  could read "on" while nothing was ever delivered. The OS-permission state
  machine that went with it (`granted`/`blocked`/`off`) is gone for the same
  reason — an in-app toast needs no permission, so the "blocked" state was
  unreachable and its UI was a control that could render a state it could never
  escape.

  The feed reaches back through the **20 most recent orders** (`WATCH_LIMIT` in
  `OrderNotificationService`), which is the same bound the dashboard query
  already used. Older orders are not listed.

- **No payment gateway.** Every order is written with `paymentStatus: 'pending'`
  and stays that way. Revenue figures count _delivered_ orders, not paid ones.
- **Reports page properly; the fulfilment queue does not.** Analytics walks
  pages (`OrderService.getOrdersPage`) until Firestore runs out, and reports the
  true order count from `getCountFromServer`, so revenue reflects every matching
  order. It previously read the newest 500 in one query and derived every figure
  from those, which meant past 500 orders the whole page silently described the
  newest 500 while the header said "All Time". A 5,000-order memory ceiling
  remains and the UI still says so if it is ever hit.
  The **fulfilment queue** also pages to the end of the result set now. It reads
  the whole set into memory rather than one screen at a time, because the status
  tabs, the search box and the date filter all operate across `allOrders` at
  once — server-side paging would mean re-querying on every tab click and every
  keystroke, and the counts in the tab labels would all go wrong. Both pages keep
  a memory ceiling (5,000 and 3,000) and warn rather than hide.
- **Selecting a date range is a server-side query, not a browser-side filter.**
  It is read through the same paged walk with a `where('createdAt','>=',…)` bound,
  so "last 30 days" means the last 30 days.
  Note that bound carries no `customerId` filter, so Firestore only authorises it
  for an admin. Analytics sits behind `adminGuard` so that holds — but the read
  must not be reused on a customer-facing page without restoring the owner
  filter.
- **Stock ownership is mid-cutover, and this is the most important thing on this
  page.** The client no longer writes stock — `OrderService.placeOrder` delegates
  to the `reconcileOrderStock` Cloud Function, which re-prices every line from the
  catalog, decrements in one transaction, and cancels the order itself if the
  shelf is short. That function is **written but NOT deployed** (Cloud Functions
  need the Blaze plan; this project is on Spark).
  The customer branch of the `products` rule is **still open**, so any signed-in
  user can currently write any stock level — `stock.cup: 999999` or zeroing the
  catalog. Four tests in `tests/firestore.rules.test.ts` assert that branch is
  _closed_ and therefore **fail right now**; `npm run verify` is red because of
  it, and that is correct: the tests describe the intended state and the rules do
  not implement it yet.
  The two halves must be changed together. Removing the rule branch before the
  function is live denies every checkout. **Follow `CUTOVER.md`**, and do not
  deploy rules or functions without reading it.
- **Voucher limits are enforced server-side, in the same transaction as the
  stock.** `maxRedemptions` and `perCustomerLimit` used to be decoration: the
  counter was incremented by the _client_, against a `vouchers` write the rules
  reserve for admins, so every attempt was refused and silently swallowed into a
  `console.error`. One code was redeemable without limit, forever. The counter now
  moves in `reconcileOrderStock`, checked and spent atomically, and the discount
  is **recomputed** from the voucher document rather than clamped from the
  client's figure — a forged `discountAmount: totalAmount` used to buy the whole
  basket for the delivery fee. This is server-side too, so it inherits the same
  "written but not deployed" caveat as above.
- **One review per customer per product.** Reviews are written under a
  deterministic id (`${productId}_${uid}`), so a second submission edits the
  first rather than adding a duplicate, and `firestore.rules` enforces that the
  document id matches its author and product. Authors can edit and withdraw
  their own review. The product page loads the most recent 200 and says so when
  that truncates.

---

## Project Structure

```
src/
├── app/
│   ├── core/
│   │   ├── models/          ← product, order, user, cart interfaces
│   │   ├── services/        ← auth, cart, inventory, order, notification
│   │   ├── guards/          ← authGuard, adminGuard
│   │   └── config/          ← pricing.config.ts (authoritative price matrix)
│   ├── shared/
│   │   ├── components/      ← ProductCard, OrderStatusBadge, StarRating
│   │   └── pipes/           ← PesoPipe, StockStatusPipe
│   ├── features/
│   │   ├── auth/            ← Login, Register, Google Sign-In
│   │   ├── dashboard/       ← Role-aware hub (customer + admin views)
│   │   ├── products/        ← Catalog + Product Detail
│   │   ├── cart/            ← Cart + Checkout flow
│   │   ├── orders/          ← Order history + Live tracker
│   │   ├── about/           ← App overview
│   │   └── developers/      ← Team credits
│   └── admin/
│       ├── inventory/       ← Stock management CRUD
│       ├── orders/          ← Fulfillment dashboard
│       └── analytics/       ← Sales reports
├── environments/            ← Firebase config (dev + prod)
└── theme/
    └── variables.scss       ← Brand design tokens
scripts/
└── seed-products.ts         ← Firestore seed script (64 SKUs)
```

---

## Getting Started

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- npm 9+
- Firebase project with Firestore + Authentication enabled

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Firebase

Copy `src/environments/environment.example.ts` over
`src/environments/environment.ts` and fill in your Firebase project credentials.
`environment.prod.ts` is substituted automatically for production builds via
`fileReplacements` in `angular.json` — you do not need to edit it by hand.

### 3. Seed the Product Catalog

Place your Firebase service account key at `scripts/serviceAccountKey.json`, then:

```bash
npm run seed
```

This writes all **64 product documents** to Firestore with default stock levels.
Use `npm run seed:preserve-stock` to keep existing stock counts.

**Every product gets an empty `imageUrl` from a plain `npm run seed`**, so the
storefront renders the same generic scoop placeholder 64 times. To give each
flavor its own image:

```bash
npm run images:generate   # 64 distinct placeholder SVGs -> assets/images/
npm run images:seed       # re-seed pointing each product at its artwork
```

To use real photography, drop files into `assets/images/` named after the flavor
slug, or upload to Cloudinary with
`npm run upload:images -- --dir=<folder> --upload --write`.

### 4. Deploy Firestore Security Rules + Indexes

```bash
firebase deploy --only firestore
```

### 5. Run in Browser

```bash
npm start
```

### 6. Verify the Build

```bash
npm run verify        # typecheck + typecheck:scripts + test:logic + test:rules
                      # + check:contrast + build
```

> **`npm run verify` currently FAILS**, at `test:rules`. Four assertions that the
> customer stock-write branch is closed fail because `firestore.rules` still
> grants it — see "Known limitations" above and `CUTOVER.md`. This is the honest
> state of the build: the tests are correct and the rules are not finished. It is
> also what CI reports, so a red build here is expected until the cutover lands.
>
> To check everything that _is_ green today:
> `npm run typecheck && npm run typecheck:scripts && npm run test:logic && npm run check:contrast && npm run build`

````

Or individually:
```bash
npm run typecheck     # tsc --noEmit against the app tsconfig
npm run test:logic    # business-logic unit tests (node:test via tsx)
npm run test:rules    # Firestore security rules tests, via the emulator
npm run build         # production bundle -> www/browser
````

Note: the build output is `www/browser`, which is what both `firebase.json`
and `capacitor.config.ts` point at.

### 7. Deploy

```bash
npm run deploy          # rules + indexes, then build + hosting
```

Deploying hosting alone does **not** deploy `firestore.indexes.json`, so
`deploy:hosting` is deliberately paired with an explicit `deploy:firestore`
in the `deploy` script. Skipping the rules is how a checkout that writes
products stops working.

### 8. Build for Android / iOS

```bash
npm run build:android
npm run build:ios
```

---

## Project Commands

| Command                   | What it does                                                        |
| ------------------------- | ------------------------------------------------------------------- |
| `npm start`               | Dev server                                                          |
| `npm run build`           | Production bundle to `www/browser`                                  |
| `npm run typecheck`       | `tsc --noEmit` against the app tsconfig                             |
| `npm run test:logic`      | Unit tests for pricing, delivery, vouchers, stock, ratings          |
| `npm run test:rules`      | Security rules tests against the Firestore emulator (Java required) |
| `npm run test`            | Both suites in sequence                                             |
| `npm run verify`          | `typecheck` + `test:logic` + `build` — run this before any deploy   |
| `npm run emulators`       | Start the emulator UI to inspect rules interactively                |
| `npm run seed`            | Seed 64 products (add `seed:preserve-stock` to keep stock)          |
| `npm run images:generate` | Generate one placeholder SVG per flavor                             |
| `npm run images:seed`     | Re-seed with those images, so products are not imageless            |
| `npm run deploy`          | Deploy rules + indexes, then build + hosting                        |

There is no `lint` script: `angular.json` defines no lint target, so `ng lint`
would fail.

---

## Product Catalog (64 SKUs)

| Set | Name            | Count       |
| --- | --------------- | ----------- |
| 1   | Chocolates      | 8 varieties |
| 2   | Vanilla         | 8 varieties |
| 3   | Strawberry      | 8 varieties |
| 4   | Mango           | 8 varieties |
| 5   | Ube             | 8 varieties |
| 6   | Mint            | 8 varieties |
| 7   | Coffee          | 8 varieties |
| 8   | Cookies & Cream | 8 varieties |

### Product types

The plan asked for "flavors, tubs, cones, sundaes". Tubs are covered by the pint
and half-gallon sizes, so they needed no separate type. The model carries a
`category` of `flavor` | `sundae` | `cone`, and the storefront filters on it.

| Type   | Seeded | Which                                                                                                       |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------- |
| Flavor | 56     | everything not listed below                                                                                 |
| Sundae | 6      | Mango Graham, Ube Halo-Halo Style, Ube Leche Flan, Strawberry Cheesecake, Mango Cheesecake, Mint Cheesecake |
| Cone   | 2      | Classic Mango Sorbet, Mango Tango Twist                                                                     |

The cones are the two sorbets — dairy-free single scoops, the closest honest
candidates without inventing products the shop does not sell. Assigning types
lives in one place, `CATEGORY_BY_VARIANT` in `scripts/seed-products.ts`, and the
seeder refuses to run if it names a product that does not exist. Admin-created
products get a Type picker in both the add and edit modals, so real cone
products can be tagged without touching code.

A product with no `category` field reads as a flavor, so documents seeded before
this field existed keep appearing in the catalog.

---

## Pricing Matrix

| Set                 | Cup | Pint | Half Gallon | Gallon |
| ------------------- | --- | ---- | ----------- | ------ |
| Chocolates (1)      | ₱65 | ₱200 | ₱500        | ₱950   |
| Vanilla (2)         | ₱60 | ₱190 | ₱480        | ₱900   |
| Strawberry (3)      | ₱65 | ₱200 | ₱500        | ₱950   |
| Mango (4)           | ₱65 | ₱200 | ₱500        | ₱950   |
| Ube (5)             | ₱70 | ₱210 | ₱520        | ₱980   |
| Mint (6)            | ₱65 | ₱200 | ₱500        | ₱950   |
| Coffee (7)          | ₱70 | ₱210 | ₱520        | ₱980   |
| Cookies & Cream (8) | ₱65 | ₱200 | ₱500        | ₱950   |

---

## The Team

| Name                          | Roles                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------- |
| **Kenn Karlo Umadhay**        | Main Project Lead · Full Stack Dev · UI/UX Designer Lead · QA · Documentation |
| **Heaven Alvior**             | QA · Documentation                                                            |
| **Justin Curby P. Esguerra**  | Full Stack Dev · UI/UX Designer · QA · Documentation                          |
| **Renz Gabriel De la Cruz**   | QA · Documentation                                                            |
| **Antonio Miguel Villanueva** | Full Stack Dev · UI/UX Designer · QA · Documentation                          |

---

## Not done yet

Previously this list said Cloud Functions were out of scope. They exist. Corrected:

- **Cloud Functions are written but NOT DEPLOYED.** `functions/` holds
  `reconcileOrderStock` and `restockCancelledOrder`. They need the Blaze plan;
  the project is on Spark. This is the single blocker behind most of what
  follows. See `CUTOVER.md`.
- **Any notification that reaches a closed app** — push, SMS, email. The project
  is in-app only by decision (see "Known limitations"), and closing that gap
  needs a server to send from, which the Spark plan cannot host. The
  `@capacitor/push-notifications` dependency has been removed rather than left
  wired to nothing.
- **Payment gateway** (GCash / Maya / PayMongo). No payment UI exists on any
  screen and no card detail is collected. The About page used to advertise
  "Secure Payments"; that claim has been removed rather than left standing.
- **Server-side aggregation.** Both the analytics page and the fulfilment queue
  page through every matching order and aggregate in the browser. Correct, but
  they hold the whole set in memory. A shop with years of history wants the sums
  computed server-side.
- **Guest catalog browsing.** `/products` is behind `authGuard`, and
  `firestore.rules` is `allow read: if isSignedIn()`, so this needs both changed.
- **Self-service account deletion.** Not in the app; `PRIVACY.md` says so
  plainly rather than claiming otherwise. Both stores require it for apps with
  account creation.
- CSV bulk product import
- App Store / Play Store signing and release pipeline. `android/` now exists and
  a debug APK builds; there is no keystore, no iOS project, and no app icon or
  splash artwork in `src/assets/`.
- **Staging is declared but not provisioned.** `.firebaserc` has a `staging`
  alias and a `deploy:staging` script, so the intent is recorded. No second
  Firebase project exists yet, and `environment.staging.ts` plus its
  `fileReplacement` in `angular.json` are **not** wired. Until they are,
  `deploy:staging` sends rules to the right place while the built app still points
  at production — a worse state than no staging, so the placeholder project id is
  left obviously invalid rather than guessed. The provisioning steps are written
  out inside `.firebaserc` itself.

---

## Testing

`npm run test:logic` runs the business-logic suite with `node:test` via `tsx`.
The tests import the real implementations from `src/app/core/logic/`, which is
deliberately free of Angular and Firebase imports.

`npm run test:rules` runs the Firestore security-rules suite against the local
emulator (requires Java). It needs no credentials and touches no live project.
`npm run test` runs both.

These rules tests exist because a real defect shipped unnoticed: the rules
reserved product writes for admins while checkout decremented stock as the
customer, so no non-admin could ever place an order. Nothing caught it, because
the only tests were pure-logic tests that never reached a rules engine.

**Do not inline logic in the test file.** The original version of this suite
re-implemented every rule by hand, so it would have kept passing even if the
app's own implementation were deleted — it proved nothing.

---

## Documentation

| File                                               | Purpose                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `README.md`                                        | Setup, features, commands, and honest limitations                   |
| `SETUP_GUIDE.txt`                                  | Step-by-step first-run checklist                                    |
| `Docs/five-orites-scoop-corrected-gap-analysis.md` | Defect-level audit: what is broken, what was fixed, what remains    |
| `Docs/five-orites-scoop-feature-alignment.md`      | Feature-level audit: which planned features exist, and which do not |
| `REFACTOR_PLAN.md`                                 | The earlier refactor pass (executed)                                |

> **Known gap in the documentation set:** the "Group 5 planned-features document"
> referenced by the analyses in `Docs/` is not present in this repository. The
> feature-alignment audit therefore compares the app against quoted requirement
> fragments rather than against a spec. Recovering the original document is the
> first thing needed to make that audit authoritative.

---

_Five-orites Scoop © 2025 — Built with Ionic · Angular · Firebase_
