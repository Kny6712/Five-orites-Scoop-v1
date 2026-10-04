# 🍦 Five-orites Scoop

**Premium Ice Cream E-Commerce + Real-Time Inventory Management System**

> _"Premium ice cream, scooped to your door"_

---

## Project Overview

Five-orites Scoop is a cross-platform mobile/web application built with **Ionic 7 + Angular 17 + Firebase**. It enables customers to browse 64 ice cream products, order by size, and track orders in real time - with in-app notifications on status change - while giving store admins a live inventory and fulfillment dashboard.

It runs on Firebase's **free Spark plan**: no Cloud Functions, no server, no
payment gateway. Several things that would normally live on a server are instead
done by staff inside the app, and one or two are simply not done at all. Both
facts are load-bearing, so both are written down — see **Known limitations**,
which is the part of this file worth reading before you demo anything.

---

## Tech Stack

| Layer      | Technology                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------- |
| Framework  | Ionic 7 + Angular 17 (Standalone Components)                                                  |
| Native     | Capacitor 5 (iOS + Android)                                                                   |
| Backend    | Firebase Firestore + Firebase Auth (Spark)                                                    |
| Serverless | **None deployed.** `functions/` holds three handlers that cannot be deployed on the free plan |
| State      | RxJS BehaviorSubject + Angular Signals                                                        |
| Styling    | SCSS + Ionic CSS Variables                                                                    |
| Language   | TypeScript 5 (strict mode)                                                                    |
| Currency   | Philippine Peso (₱)                                                                           |
| Tooling    | ESLint · Prettier · husky + lint-staged · GitHub Actions · Dependabot                         |

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
- Cancel an order yourself while it is still **pending** — which is before any
  stock is taken, so nothing needs returning (see "Known limitations")
- A **notification feed** at `/notifications` with an unread badge, derived from
  each order's `statusHistory`, plus a toast while the app is open
- Voucher codes (e.g. `SCOOP10`, `FREE50`), saved address book, wishlist, and
  product reviews
- Profile photo upload, and **in-app account deletion** (Profile → Delete
  account)
- Google Sign-In + Email/Password authentication, with password reset
- Every credential failure reports the same "Incorrect email or password", and
  the reset confirmation is identical whether or not an account exists, so the
  login form cannot be used to discover which addresses are registered

### Admin

- **Inventory Manager**: Live stock view per product/size; inline edit with atomic
  Firestore updates, a `stockMovements` ledger, and a drift report that flags any
  stock level the ledger cannot account for
- **Order Fulfillment**: Filter orders by status, expand detail panel, advance
  order stages. **Advancing an order out of `pending` is what takes the stock** —
  see "Known limitations"
- **Sales Analytics**: Revenue KPIs, delivered order count, top flavors by units sold, CSV export
- **Low stock alerts**: Live dashboard banner when any SKU drops below threshold
- Account suspension, staff notes, and a role directory, with role tiers
  (`staff` / `manager` / `admin` / `owner`)
- Role-based access via a `role` field on the user's Firestore document
  (`users/{uid}`), enforced by `firestore.rules` — **not** Firebase Auth
  custom claims, which are not used anywhere in this project

---

## Known limitations (please read before demoing)

These are real constraints of the current build, documented here so the claims
above are not mistaken for more than they are.

- **Notifications are in-app only, by design.** This is a deliberate scope
  decision, not an unfinished feature. There is no push provider and no SMS
  gateway in this project, and no SMS or email of any kind is sent by the app at
  all. What exists instead:
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
- **Three Cloud Functions exist on disk and cannot be deployed here.** They live
  in `functions/src/index.ts` and are written and compiling:
  `reconcileOrderStock`, `restockCancelledOrder` and
  `anonymiseDeletedCustomerOrders`. **This project is on the free Spark plan, so
  `firebase deploy --only functions` fails and none of them has ever run.**
  Nothing in the app depends on them any more — stock moved to the staff-gated
  transaction described above — but they are dead weight that reads as a
  live design in any file that mentions them. Their only remaining cost is
  misleading the reader.
- **Deleting your account does not delete your orders, and does not redact them
  either.** Profile → Delete account removes `users/{uid}` and the Firebase Auth
  record, then signs you out; that part works and both app stores are satisfied
  by it. The order documents survive **with your name, email, delivery address
  and notes still on them.** `anonymiseDeletedCustomerOrders` is the handler that
  was meant to strip those fields with the Admin SDK, and it is one of the three
  functions that cannot run on this plan. `PRIVACY.md` says all of this in the
  customer's own words; keep them in step if you change either.
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
- **Stock is moved by staff, not at checkout, and never by a Cloud Function.**
  Checkout writes the order and nothing else — no stock, no reservation. Stock
  is taken inside the transaction that advances an order out of `pending` in the
  fulfilment queue (`OrderService.transitionOrderStatus`, called from the admin
  queue): every product on the order is re-read inside the transaction, the whole
  movement aborts if any line is short, and a `stockMovements` ledger row is
  written per line alongside the decrement. That path is rule-gated —
  `firestore.rules` has **no** customer branch on `/products` any more, so a
  signed-in customer cannot write a stock level at all, in the app or with the
  raw SDK. `npm run test:rules` is **172/172** on that, and `npm run verify` is
  green.
  **The one thing this changes for a customer:** an order can be placed, and then
  declined by staff, because nothing was held for it between checkout and
  acceptance. `CUTOVER.md` is the runbook for this path.
- **Voucher caps are not enforced at checkout.** `maxRedemptions` and
  `perCustomerLimit` were meant to be checked and spent atomically in the same
  transaction as the stock. They are not, and cannot be from the client: nothing
  increments a voucher's `usageCount`, so the counter never moves and the caps
  never bite. (`usageCount` was once incremented by the client against a
  `vouchers` write the rules reserve for admins, so every attempt was refused
  and swallowed into a `console.error`.) What _is_ enforced: minimum spend,
  start/end dates, and whether the code is active. What is **not**: per-item
  `unitPrice` — Firestore rules have no loop, so an array of items cannot be
  summed, and the client still authors the basket total. `firestore.rules` does
  clamp the money fields that are checkable (`totalAmount > 0`,
  `deliveryFee >= 0`, `discountAmount` between 0 and `totalAmount`, and the
  identity `grandTotal == totalAmount - discountAmount + deliveryFee`), which
  closes the forged-negative-delivery-fee and discount-equals-total holes.
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
│   │   ├── models/          ← product, order, user, cart, voucher interfaces
│   │   ├── logic/           ← pure pricing/delivery/voucher/stock/notification rules
│   │   ├── services/        ← auth, cart, inventory, order, stock ledger,
│   │   │                       notifications, image upload
│   │   ├── guards/          ← authGuard, adminGuard
│   │   └── config/          ← pricing.config.ts (authoritative price matrix)
│   ├── shared/
│   │   ├── components/      ← ProductCard, OrderStatusBadge, StarRating
│   │   └── pipes/           ← PesoPipe, StockStatusPipe, CloudinaryPipe
│   ├── features/
│   │   ├── auth/            ← Login, Register, Google Sign-In
│   │   ├── dashboard/       ← Role-aware hub (customer + admin views)
│   │   ├── products/        ← Catalog + Product Detail
│   │   ├── cart/            ← Cart + Checkout flow
│   │   ├── orders/          ← Order history + Live tracker
│   │   ├── notifications/   ← Feed derived from each order's statusHistory
│   │   ├── profile/         ← Profile, photo upload, Delete account
│   │   ├── about/           ← App overview
│   │   └── developers/      ← Team credits
│   └── admin/
│       ├── inventory/       ← Stock management CRUD + ledger
│       ├── orders/          ← Fulfillment dashboard (advancing = taking stock)
│       ├── analytics/       ← Sales reports
│       ├── vouchers/        ← Promo code CRUD
│       ├── users/           ← Role directory, suspension, staff notes
│       └── settings/        ← Shop settings (low-stock threshold, banner)
├── environments/            ← Firebase config (dev + prod)
└── theme/
    └── variables.scss       ← Brand design tokens
scripts/                     ← Seeders, image generation/upload, CI helpers
functions/                   ← 3 Cloud Function handlers — CANNOT BE DEPLOYED on Spark
tests/                       ← tests/logic.test.ts, tests/firestore.rules.test.ts
.github/workflows/ci.yml     ← CI gate (verify chain + functions typecheck)
```

---

## Getting Started

### Prerequisites

- Node.js 20+ (`.nvmrc` says 20, and `package.json` `engines` rejects Node 24)
- npm 9+
- Java, for the Firestore emulator that `npm run test:rules` runs
- Firebase project with Firestore + Authentication enabled
- A Cloudinary account (free plan is enough) for image upload — see
  `SETUP_GUIDE.txt`
- **Note the billing plan.** The app is built to run on the free **Spark** plan:
  stock, vouchers, notifications and account deletion all work without a server.
  It is not built to deploy Cloud Functions, so `npm run deploy` leaves them out
  and `npm run deploy:functions` will fail. If you upgrade to Blaze, read
  `CUTOVER.md` first.

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
npm run deploy:firestore
```

### 5. Run in Browser

```bash
npm start
```

### 6. Verify the Build

```bash
npm run verify        # the whole gate, 11 steps - see `scripts.verify` for the order
                      # + test:rules + check:contrast + build
```

That is the whole chain, in that order, and `lint` is part of it — it was missing
from this list and from the commands table below until recently, which made
`verify` look shorter than it is. `verify` is also what CI runs
(`.github/workflows/ci.yml`), so a green local `verify` and a green CI mean the
same thing.

The rules suite needs Java (the Firestore emulator is a Java process); everything
else does not.

Or individually:

```bash
npm run typecheck        # tsc --noEmit against the app tsconfig
npm run typecheck:scripts# tsc --noEmit against scripts/ — the seeders are outside
                         #   tsconfig.app.json, so nothing else checks them
npm run typecheck:functions # tsc in functions/ (undeployable on Spark, still typechecked)
npm run typecheck:templates # ngc. tsc does NOT read templates, so without this no
                          #   binding, @if/@for block or icon name was ever checked
npm run lint             # ESLint over src/, scripts/, tests/ and functions/
npm run lint:fix         # same, with --fix
npm run format           # Prettier, in place
npm run format:check     # Prettier, check only
npm run check:contrast   # WCAG contrast check over the theme tokens
npm run test:logic       # business-logic unit tests (node:test via tsx) — 198 cases
npm run test:rules       # Firestore security rules tests, via the emulator - 172 cases
npm run test:integration # stock movement end-to-end, via the emulator - 23 cases
npm run test             # All three suites in sequence
npm run build            # production bundle -> www/browser
```

Note: the build output is `www/browser`, which is what both `firebase.json`
and `capacitor.config.ts` point at.

### 7. Deploy

```bash
npm run deploy                                     # rules + indexes, then hosting
```

That is these two commands, in that order:

```bash
npm run deploy:firestore                          # rules + indexes  — WORKS
npm run build && firebase deploy --only hosting    # the built app      — WORKS
```

The split is deliberate and `deploy` now does both halves: deploying hosting
alone does **not** deploy `firestore.indexes.json`, and deploying Firestore
alone does not publish the app. Do both.

**The functions step used to sit in the middle of that chain, and it is why
hosting had never been published.** It used to be

```json
"deploy": "npm run deploy:firestore && npm run deploy:functions && npm run deploy:hosting"
```

Step 1 succeeded. Step 2 (`deploy:functions`) failed every time, because Cloud
Functions cannot be deployed on the free Spark plan — that is a billing
constraint, not a bug. Because the chain is `&&`, step 3 never ran, so **a
`npm run deploy` reported a functions error and left the hosting deploy
un-applied.** Read it as "nothing was published", not "the rules went out". The
script worked as written; the chain was wrong, and the wrongness was silent
because the error it reported was about a step nothing depended on.

`deploy:functions` is out of the chain now. There was nothing to keep it for:
the three handlers in `functions/` have never run and cannot (see "Known
limitations"), so keeping them in the path cost a deploy every time and bought
nothing.

Also worth knowing before you use anything in this area:

- **`npm run deploy:functions` will always fail here.** The script still exists.
  Do not put it in a release script, a CI job or a habit — it fails on billing,
  so no flag, config or retry makes it work. The handlers in `functions/` are
  dead code (see "Known limitations").
- **There is no staging project, and every deploy targets the live shop.**
  `.firebaserc` declares exactly one project, `five-orites-scoop`. There is no
  rehearsal environment to catch a bad rules file before it reaches customers,
  and a second project used to be _declared_ here with the literal placeholder
  `REPLACE_WITH_YOUR_STAGING_PROJECT_ID` as its id. It was removed rather than
  left standing, because a declared alias reads as isolation without providing
  any: there was no such project, no `environment.staging.ts`, and no staging
  `fileReplacement` in `angular.json`, so the staging scripts would have sent
  rules to one place while the built app still pointed at production — the worst
  of both, silent and looking rehearsed. The rollback reference is the **git
  history of `firestore.rules`**: revert the commit, then
  `npm run deploy:firestore`. There is no second copy of the shop to fall back
  to, and no second copy of the data either, so test with `npm run test:rules`
  and think before you deploy.

### 8. Build for Android / iOS

```bash
npm run build:android
npm run build:ios
```

---

## Project Commands

| Command                       | What it does                                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm start`                   | Dev server                                                                                                                                                                                                                         |
| `npm run build`               | Production bundle to `www/browser`                                                                                                                                                                                                 |
| `npm run typecheck`           | `tsc --noEmit` against `tsconfig.app.json`                                                                                                                                                                                         |
| `npm run typecheck:scripts`   | `tsc --noEmit` against `scripts/tsconfig.json` — the seeders live outside the app tsconfig, so nothing else checks them                                                                                                            |
| `npm run typecheck:functions` | `tsc` inside `functions/` - undeployable on Spark, still typechecked                                                                                                                                                               |
| `npm run typecheck:templates` | `ngc`. `tsc` does not read templates, so without this no binding or icon name was ever type-checked                                                                                                                                |
| `npm run lint`                | ESLint over `src/`, `scripts/`, `tests/` and `functions/`                                                                                                                                                                          |
| `npm run lint:fix`            | The same, with `--fix`                                                                                                                                                                                                             |
| `npm run format`              | Prettier, in place                                                                                                                                                                                                                 |
| `npm run format:check`        | Prettier, check only. Blocking, in CI as well as locally                                                                                                                                                                           |
| `npm run check:contrast`      | WCAG contrast check over the theme tokens                                                                                                                                                                                          |
| `npm run test:logic`          | Unit tests for pricing, delivery, vouchers, stock, ratings — 198 cases                                                                                                                                                             |
| `npm run test:rules`          | Security rules tests against the Firestore emulator — 172 cases, all passing (Java required)                                                                                                                                       |
| `npm run test:integration`    | Stock movement end-to-end against the emulator - 23 cases                                                                                                                                                                          |
| `npm run test`                | `test:logic` + `test:rules` + `test:integration` in sequence                                                                                                                                                                       |
| `npm run verify`              | 11 steps, in order: `typecheck`, `typecheck:scripts`, `typecheck:functions`, `typecheck:templates`, `lint`, `test:logic`, `test:rules`, `test:integration`, `check:contrast`, `format:check`, `build` - run this before any deploy |
| `npm run emulators`           | Start the emulator UI to inspect rules interactively                                                                                                                                                                               |
| `npm run seed`                | Seed 64 products (add `seed:preserve-stock` to keep stock)                                                                                                                                                                         |
| `npm run seed:admin`          | Promote an account: `npm run seed:admin -- <uid> owner`                                                                                                                                                                            |
| `npm run seed:developers`     | Publish the five team credits to Firestore. Refuses a second run without `--force`, which would discard edits made in the app                                                                                                      |
| `npm run images:generate`     | Generate one placeholder SVG per flavor                                                                                                                                                                                            |
| `npm run images:seed`         | Re-seed with those images, so products are not imageless                                                                                                                                                                           |
| `npm run upload:images`       | Upload product photos to Cloudinary (`--dir=<folder> --upload --write`)                                                                                                                                                            |
| `npm run deploy:firestore`    | Deploy rules + indexes                                                                                                                                                                                                             |
| `npm run deploy:hosting`      | `npm run build` then `firebase deploy --only hosting`                                                                                                                                                                              |
| `npm run deploy`              | Chained `firestore → hosting`. Works. Functions are **not** in it — see below.                                                                                                                                                     |
| `npm run deploy:functions`    | Deploy the Cloud Functions. **Always fails here** — Spark cannot deploy functions. Keep it out of any release path.                                                                                                                |

`npm run deploy:hosting` exists so the hosting half can be run on its own after
`deploy:firestore` — the reason `deploy` chains them is that hosting does not
deploy `firestore.indexes.json`, and skipping the rules breaks the app. `deploy`
now runs both halves in that order, so the usual command is `npm run deploy`.

### Tooling that runs on every change

- **ESLint** (`.eslintrc.js`, `angular-eslint` + `typescript-eslint`) — wired
  into `verify` and into CI.
- **Prettier** (`.prettierrc.js`) — `format` / `format:check`. Formatting is
  non-blocking in CI on purpose; it must never be the reason a change cannot
  merge.
- **husky + lint-staged** (`.husky/pre-commit`) — formats and lints staged files
  on commit. Format runs before lint on purpose, so `eslint --fix` does not
  reintroduce formatting that prettier would undo. Note that `verify` does **not**
  cover the hook.
- **`.editorconfig`** — indentation and newline policy for every editor.
- **GitHub Actions** (`.github/workflows/ci.yml`) — runs `npm run verify`, the same
  command you run locally, and uploads `www/browser` as an artifact on every run.
  It is a gate, never a deployment: nothing in it touches Firebase.
- **Dependabot** (`.github/dependabot.yml`) — dependency update PRs.
- **Firestore indexes** — 4 composite indexes in `firestore.indexes.json`,
  deployed by `deploy:firestore`. Hosting deploys do not carry them.

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

- **The three Cloud Functions in `functions/` cannot be deployed.** They are on
  disk, written and compiling — `reconcileOrderStock`,
  `restockCancelledOrder`, `anonymiseDeletedCustomerOrders` — and the project is
  on the free **Spark** plan, which cannot host functions at all. None of them has
  ever run. They are **not** "pending deployment": deploying them means a billing
  change in the Google Cloud console, which nobody has made. Nothing in the app
  depends on them any more (stock moved to a staff-gated transaction — see
  "Known limitations"), so the honest options are to delete `functions/` or to
  leave it as a record of the design that was replaced. Do not describe them as
  pending work in a demo.
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
- **Redacting a deleted customer's past orders.** Account deletion itself ships
  and works; the identifying fields left on the order do not get removed, because
  the function that would do it cannot run. This is a `PRIVACY.md` disclosure, not
  a UI gap. See "Known limitations".
- CSV bulk product import
- App Store / Play Store signing and release pipeline. `android/` now exists and
  a debug APK builds; there is no keystore, no iOS project, and no app icon or
  splash artwork in `src/assets/`.

---

## Testing

`npm run test:logic` runs the business-logic suite with `node:test` via `tsx` —
about **165 cases**. The tests import the real implementations from
`src/app/core/logic/` and `src/app/core/models/`, which are deliberately free of
Angular and Firebase imports.

`npm run test:rules` runs the Firestore security-rules suite against the local
emulator (requires Java). It needs no credentials and touches no live project,
and it is **172 cases, all passing** — including the assertions that a customer
cannot write a product's stock at all. `npm run test` runs all three suites.

`npm run verify` is the gate, and CI runs that same command rather than its own copy

These rules tests exist because a real defect shipped unnoticed: the rules
reserved product writes for admins while checkout decremented stock as the
customer, so no non-admin could ever place an order. Nothing caught it, because
the only tests were pure-logic tests that never reached a rules engine.

**Do not inline logic in the test file.** The original version of this suite
re-implemented every rule by hand, so it would have kept passing even if the
app's own implementation were deleted — it proved nothing.

**What no test reaches.** Roughly half of what was fixed in this project rests on
inspection and compilation rather than on a test that would fail if the behaviour
regressed — the transactional cancel, the bulk restock, and the UI states. And
nothing at all has been exercised against a live Firestore project. A green
`verify` means "the checks we wrote all pass", not "the shop works".

---

## Documentation

| File                                               | Purpose                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                        | Setup, features, commands, and honest limitations                                                                         |
| `SETUP_GUIDE.txt`                                  | Step-by-step first-run checklist                                                                                          |
| `CUTOVER.md`                                       | Runbook for the staff-gated stock movement, and what it changes                                                           |
| `PRIVACY.md` / `TERMS.md`                          | Customer-facing legal text, written from the source                                                                       |
| `Docs/five-orites-scoop-corrected-gap-analysis.md` | Defect-level audit: what is broken, what was fixed, what remains — **dated 30 September 2026, see the banner at the top** |
| `Docs/five-orites-scoop-feature-alignment.md`      | **Superseded.** Kept as a pointer only; do not read it for current state                                                  |
| `Docs/five-orites-scoop-gap-analysis_Esguerra.md`  | The original gap analysis, kept for provenance only                                                                       |
| `REFACTOR_PLAN.md`                                 | The earlier refactor pass (executed) — historical                                                                         |

> **Known gap in the documentation set:** the "Group 5 planned-features document"
> referenced by the analyses in `Docs/` is not present in this repository. Those
> documents therefore compare the app against quoted requirement fragments rather
> than against a spec. Recovering the original document is the first thing needed
> to make either audit authoritative — which is also why neither has been
> refreshed against the current build.

---

_Five-orites Scoop © 2025 — Built with Ionic · Angular · Firebase_
