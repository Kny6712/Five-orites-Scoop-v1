# 🍦 Five-orites Scoop

**Premium Ice Cream E-Commerce + Real-Time Inventory Management System**

> *"Premium ice cream, scooped to your door"*

---

## Project Overview

Five-orites Scoop is a production-grade cross-platform mobile/web application built with **Ionic 7 + Angular 17 + Firebase**. It enables customers to browse 64 ice cream flavors, order by size, track orders in real time, and receive push notifications — while giving store admins a live inventory and fulfillment dashboard.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Ionic 7 + Angular 17 (Standalone Components) |
| Native | Capacitor 5 (iOS + Android) |
| Backend | Firebase Firestore + Firebase Auth |
| State | RxJS BehaviorSubject + Angular Signals |
| Styling | SCSS + Ionic CSS Variables |
| Language | TypeScript 5 (strict mode) |
| Currency | Philippine Peso (₱) |

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

- **Notifications are in-app only.** `OrderNotificationService` watches the
  signed-in user's own orders and shows a toast (plus a browser notification,
  where that API is available and permitted) on a real status transition. The
  earlier version fired from whichever client *performed* the change, so the
  toast appeared on the admin's device and the customer saw nothing. That is
  fixed. What remains: a customer with the app closed still receives nothing.
  Real background push needs FCM tokens plus a deployed Cloud Function, which
  is not set up (see "Out of Scope").
- **No payment gateway.** Every order is written with `paymentStatus: 'pending'`
  and stays that way. Revenue figures count *delivered* orders, not paid ones.
- **Reports and queues are capped, and say so when they are.** A single read
  returns at most 500 orders for analytics and 300 for the fulfillment queue.
  Past that the UI states the figures are a lower bound rather than presenting a
  silent total. Selecting a date range is a server-side query
  (`OrderService.getOrdersSince`), not a browser-side filter, so "last 30 days"
  really means the last 30 days rather than the newest 100 orders re-filtered.
  Deeper history needs pagination.
- **Stock is decremented client-side, so the rules must let customers write
  stock.** The order flow decrements stock, writes the order, and rolls the
  decrement back if the write fails. Firestore rules cannot require a stock
  change to accompany an order, so `firestore.rules` grants any signed-in user
  a narrow `products` write scoped to the `stock` and `updatedAt` keys, with
  every size still required to be a non-negative integer.
  **The accepted tradeoff:** a user with the raw Firebase SDK can set any stock
  level, because the rule constrains *which keys* may change but not by how
  much. Only a Cloud Function performing the decrement server-side closes this.
  `tests/firestore.rules.test.ts` asserts the current behaviour deliberately,
  so the limitation stays visible rather than being rediscovered later.
- **Voucher discounts are resolved from the `vouchers` collection only.** A
  deactivated voucher no longer falls back to a built-in list, so turning a
  voucher off in the admin UI genuinely disables it. Rules additionally clamp
  `discountAmount` to the subtotal.
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
npm run verify        # typecheck + business-logic tests + production build
```

Or individually:
```bash
npm run typecheck     # tsc --noEmit against the app tsconfig
npm run test:logic    # business-logic unit tests (node:test via tsx)
npm run test:rules    # Firestore security rules tests, via the emulator
npm run build         # production bundle -> www/browser
```

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

| Command | What it does |
|---|---|
| `npm start` | Dev server |
| `npm run build` | Production bundle to `www/browser` |
| `npm run typecheck` | `tsc --noEmit` against the app tsconfig |
| `npm run test:logic` | Unit tests for pricing, delivery, vouchers, stock, ratings |
| `npm run test:rules` | Security rules tests against the Firestore emulator (Java required) |
| `npm run test` | Both suites in sequence |
| `npm run verify` | `typecheck` + `test:logic` + `build` — run this before any deploy |
| `npm run emulators` | Start the emulator UI to inspect rules interactively |
| `npm run seed` | Seed 64 products (add `seed:preserve-stock` to keep stock) |
| `npm run images:generate` | Generate one placeholder SVG per flavor |
| `npm run images:seed` | Re-seed with those images, so products are not imageless |
| `npm run deploy` | Deploy rules + indexes, then build + hosting |

There is no `lint` script: `angular.json` defines no lint target, so `ng lint`
would fail.

---

## Product Catalog (64 SKUs)

| Set | Name | Count |
|---|---|---|
| 1 | Chocolates | 8 varieties |
| 2 | Vanilla | 8 varieties |
| 3 | Strawberry | 8 varieties |
| 4 | Mango | 8 varieties |
| 5 | Ube | 8 varieties |
| 6 | Mint | 8 varieties |
| 7 | Coffee | 8 varieties |
| 8 | Cookies & Cream | 8 varieties |

### Product types

The plan asked for "flavors, tubs, cones, sundaes". Tubs are covered by the pint
and half-gallon sizes, so they needed no separate type. The model carries a
`category` of `flavor` | `sundae` | `cone`, and the storefront filters on it.

| Type | Seeded | Which |
|---|---|---|
| Flavor | 56 | everything not listed below |
| Sundae | 6 | Mango Graham, Ube Halo-Halo Style, Ube Leche Flan, Strawberry Cheesecake, Mango Cheesecake, Mint Cheesecake |
| Cone | 2 | Classic Mango Sorbet, Mango Tango Twist |

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

| Set | Cup | Pint | Half Gallon | Gallon |
|---|---|---|---|---|
| Chocolates (1) | ₱65 | ₱200 | ₱500 | ₱950 |
| Vanilla (2) | ₱60 | ₱190 | ₱480 | ₱900 |
| Strawberry (3) | ₱65 | ₱200 | ₱500 | ₱950 |
| Mango (4) | ₱65 | ₱200 | ₱500 | ₱950 |
| Ube (5) | ₱70 | ₱210 | ₱520 | ₱980 |
| Mint (6) | ₱65 | ₱200 | ₱500 | ₱950 |
| Coffee (7) | ₱70 | ₱210 | ₱520 | ₱980 |
| Cookies & Cream (8) | ₱65 | ₱200 | ₱500 | ₱950 |

---

## The Team

| Name | Roles |
|---|---|
| **Kenn Karlo Umadhay** | Main Project Lead · Full Stack Dev · UI/UX Designer Lead · QA · Documentation |
| **Heaven Alvior** | QA · Documentation |
| **Justin Curby P. Esguerra** | Full Stack Dev · UI/UX Designer · QA · Documentation |
| **Renz Gabriel De la Cruz** | QA · Documentation |
| **Antonio Miguel Villanueva** | Full Stack Dev · UI/UX Designer · QA · Documentation |

---

## Out of Scope (Future Phases)

- **Firebase Cloud Functions** — needed for real background push notifications,
  and for enforcing stock decrements server-side (see Known Limitations)
- **Payment gateway integration** (PayMongo / Paymaya webhook handlers)
- **Server-side analytics aggregation** — current figures are computed on the
  client from a capped query
- CSV bulk product import
- App Store / Play Store deployment pipeline

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

| File | Purpose |
|---|---|
| `README.md` | Setup, features, commands, and honest limitations |
| `SETUP_GUIDE.txt` | Step-by-step first-run checklist |
| `Docs/five-orites-scoop-corrected-gap-analysis.md` | Defect-level audit: what is broken, what was fixed, what remains |
| `Docs/five-orites-scoop-feature-alignment.md` | Feature-level audit: which planned features exist, and which do not |
| `REFACTOR_PLAN.md` | The earlier refactor pass (executed) |

> **Known gap in the documentation set:** the "Group 5 planned-features document"
> referenced by the analyses in `Docs/` is not present in this repository. The
> feature-alignment audit therefore compares the app against quoted requirement
> fragments rather than against a spec. Recovering the original document is the
> first thing needed to make that audit authoritative.

---

*Five-orites Scoop © 2025 — Built with Ionic · Angular · Firebase*
