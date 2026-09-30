# Five-orites Scoop: Gap Analysis and Improvement Report

**Sources reviewed:** Group 5 planned-features document (PDF) and Repomix export of the Ionic 7 / Angular 17 / Firebase project.

**Method and limits:** This is a static code review only. The app was **not** built, run, or tested. The export contains the project twice plus a `.claude/` tooling folder; the duplicate and the tooling were ignored.

**Overall:** every planned module has an implementation. The main problems are:

- a probable conflict between the Firestore rules and the checkout/cancel code;
- push notifications that are in-app only;
- three smaller differences from the plan (price filter, catalog types, hard delete).

---

## Part 1: Gap Analysis

### A. Confirmed gaps and differences

| Feature | Expected behavior (plan) | Current implementation (evidence) | Gap | Priority | Recommended next step |
|---|---|---|---|---|---|
| Push notifications | "Push notifications for promos/order updates" | `notification.service.ts` shows a toast and a browser `Notification`. `admin-orders.page.ts` calls `notifyOrderStatusChange` right after the admin updates a status, so the toast appears on the **admin's** device. A customer only sees one while `order-tracker.page.ts` is open. `PushNotifications.register()` is called, but nothing stores or listens for the token. No `getMessaging`, service worker, manifest, or functions folder in the export. README "Known limitations" states the same. | No background push. No promo notifications. Notification shown to the wrong audience. | High | Short term: improvement #4. Full compliance needs FCM plus a Cloud Function (Blaze plan). Confirm with your professor whether in-app notification is acceptable. |
| Checkout, cancel and stock vs. security rules | "Shopping cart and checkout flow"; order tracking | `firestore.rules` allows `products` update and `orders` update for **admins only**. But `order.service.ts` → `placeOrder` calls `validateAndDecrementStock`, which updates `products` as the customer. `orders.page.ts` lets customers cancel a pending order, which updates `orders` and restocks. | Under these rules a non-admin's checkout and cancel should be rejected. Deployed rules cannot be confirmed. | **High** | Test with a non-admin account now. If it fails, apply the rules in improvement #1. |
| Search and filter by flavor/price | "Search and filter by flavor/price" | `products.page.ts` has name/set search, set chips, in-stock toggle, wishlist toggle. `ProductFilter` has `size` but no price. No sort. | Price filter and sort missing. | Medium | Add price sort and max-price filter on a selected size (about 2 h). |
| Catalog product types | "flavors, tubs, cones, sundaes" | 64 flavors × 4 sizes (cup, pint, half gallon, gallon). `Product` model has no category/type field. A search for cone, sundae, tub found nothing. | Cones and sundaes absent. "Tubs" only loosely covered by larger sizes. | Medium | Team decision: reword the plan, or add a `category` field to the model, seed script, and filter chips. |
| Admin "delete" flavors | "add/edit/delete flavors and stock" | Add and edit modals exist. Activate/deactivate toggle exists. No `deleteDoc` anywhere; rules say `allow delete: if false`. | Soft delete instead of hard delete. | Low | Keep it (protects order history); reword the plan to "deactivate". |

### B. Implemented as planned (with caveats)

| Feature | Evidence | Caveat |
|---|---|---|
| Login/registration (email + Google) | `auth.service.ts`: email/password and `signInWithPopup`. | Popup sign-in is risky inside a Capacitor APK (unverified). No password reset. |
| Order tracking | `order-tracker.page.ts`: live `onSnapshot` and step timeline. | Adds `confirmed` and `cancelled` beyond the plan's four statuses. |
| Ratings and reviews | `review.service.ts`, product-detail form, 1–5 rule in `firestore.rules`. | Nothing stops repeat reviews by one user. |
| Order management | `admin-orders.page.ts`: status filter, advance-status, cancel. | No "Cancelled" filter tab. |
| Basic sales report | `analytics.page.ts`: total orders, revenue, revenue per flavor/set/size, CSV export. | Revenue counts delivered orders only; reads at most 100 orders; excludes the admin's own orders. |
| Inventory management | Live stock editing, add/edit product, low-stock alerts, Cloudinary image upload. | See the delete row above. |

### C. Cannot verify from the export

- Deployed Firestore rules and indexes; whether Google is enabled as an auth provider.
- Whether an admin user exists and whether the 64 products are seeded.
- Android and iOS builds (`android/` and `ios/` are git-ignored, so absent from the export).
- Whether `npm run build` and `npm run test:logic` pass.
- Rendering on real phones.

---

## Part 2: Improvements to Existing Features

Priority and effort are rough estimates for a student project.

### 1. Checkout and cancel vs. security rules
**Category:** reliability, security | **Priority:** High | **Effort:** 3–4 h

- **Now:** client code writes to `products` and `orders`, which the rules reserve for admins.
- **Improve:** allow only the narrow writes customers actually need, using field-level checks:

```
match /orders/{id} {
  allow update: if isAdmin() || (
    resource.data.customerId == request.auth.uid
    && resource.data.status == 'pending'
    && request.resource.data.status == 'cancelled'
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['status','cancelReason','updatedAt','statusHistory']));
}
match /products/{id} {
  allow update: if isAdmin() || (isSignedIn()
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['stock','updatedAt']));   // keep the existing >= 0 checks
}
```

- **Trade-off:** any signed-in user could edit stock through the SDK. Document this as a known limitation; the airtight fix is a Cloud Function.
- **Test:** add rules tests with `@firebase/rules-unit-testing` and the Firebase emulator. Current tests only cover pure logic.

### 2. Google sign-in and login
**Category:** reliability, security | **Priority:** Medium | **Effort:** 3–6 h

- **Now:** `signInWithPopup` only; no "Forgot password".
- **Improve:** popup flows often fail in native webviews. Use `Capacitor.isNativePlatform()` to switch to `@capacitor-firebase/authentication` on device; keep the popup for web. Add `sendPasswordResetEmail`.
- **Also:** `auth/wrong-password` and `auth/user-not-found` messages reveal which emails have accounts. Use one generic "Incorrect email or password" message.

### 3. Accessibility quick wins
**Category:** accessibility | **Priority:** Medium | **Effort:** 1–2 h

- `index.html` sets `maximum-scale=1.0, user-scalable=no`, blocking pinch zoom. Remove both.
- `auth.page.html` has no `aria-label`. Give each `ion-input` a `label`/`aria-label`, and label the show/hide password button.
- The logo `<img src="">` is empty and causes a broken request. Point it at a real asset.
- Set chips use `(click)` on `ion-chip`, which keyboard users cannot operate. Use `ion-segment`, or add `role="button"`, `tabindex="0"`, and a keydown handler.

### 4. In-app order notifications (interim)
**Category:** usability | **Priority:** Medium | **Effort:** 2–3 h

- **Now:** status toasts only fire on the tracker page; the admin's device gets a "Your order has been confirmed" toast.
- **Improve:** remove the `notifyOrderStatusChange` calls from `admin-orders.page.ts`. In `AppComponent`, for non-admin users, watch the customer's orders and notify on any status change:

```ts
const seen = new Map<string, OrderStatus>();
let first = true;
orderService.getCustomerOrders(uid, 10).subscribe(orders => {
  for (const o of orders) {
    const prev = seen.get(o.id);
    if (!first && prev && prev !== o.status) notifier.notifyOrderStatusChange(o.id, o.status);
    seen.set(o.id, o.status);
  }
  first = false;
});
```

### 5. Analytics and dashboard accuracy
**Category:** reliability, performance | **Priority:** Medium | **Effort:** 3–5 h

- **Now:** both read at most 100 orders; `totalOrders` counts cancelled orders while revenue counts delivered only.
- **Improve:** query by date with `where('createdAt','>=', start)` and use `getCountFromServer` for counts. Label the KPIs clearly.
- **CSV export:** `a.click()` on a blob URL usually will not save a file inside a Capacitor app. Use `@capacitor/filesystem` and `@capacitor/share` on native.

### 6. Catalog and dashboard performance
**Category:** performance | **Priority:** Low–Medium | **Effort:** 1–2 h

- **Now:** `getProducts()` opens a separate live listener for each page that calls it (catalog, cart, dashboard).
- **Improve:** share one stream with `shareReplay({ bufferSize: 1, refCount: true })` to cut Firestore reads.
- Featured flavors are shuffled on every snapshot in `dashboard.page.ts`, so cards reshuffle when stock changes. Shuffle once.
- `PreloadAllModules` also preloads admin bundles for customers. Consider a customer-only preloading strategy.

### 7. Reviews
**Category:** reliability, usability | **Priority:** Low–Medium | **Effort:** about 2 h

- **Now:** one user can post unlimited reviews; averages are computed by downloading up to 200 reviews per product.
- **Improve:** use the document ID `${productId}_${uid}` and enforce it in rules (`reviewId == productId + '_' + request.auth.uid`). Optionally store `ratingSum` and `ratingCount` on the product.

### 8. Cart, wishlist and address persistence
**Category:** reliability | **Priority:** Low | **Effort:** 2–4 h

- **Now:** stored in `localStorage` (per device); the cart stores `unitPrice` at add time. Checkout re-prices correctly, but the cart screen can show stale prices.
- **Improve:** refresh cart prices from the live product stream on the cart page. Optionally sync the wishlist to `users/{uid}`.

### 9. Security hygiene
**Category:** security | **Priority:** Low | **Effort:** 1 h

- `environment.ts` is committed. That is normal for Firebase web config, but restrict the API key by HTTP referrer in Google Cloud and rely on the rules.
- The Cloudinary upload preset is unsigned. Restrict allowed formats and max file size in the preset.
- A transient Firestore failure in `buildAppUser` silently drops an admin to the customer view. Retry once before falling back.

---

## New Feature Proposals (kept separate)

- Real background push via Cloud Functions plus FCM tokens, including promo broadcasts.
- An admin-editable promo/announcement banner collection.
- Cone and sundae product categories.
- Payment gateway integration (e.g., PayMongo).
- Guest catalog browsing without sign-in.
