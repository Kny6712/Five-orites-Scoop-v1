# CUTOVER.md — moving stock ownership from the client to Cloud Functions

Referenced from `firestore.rules`. **Read this before deploying rules or functions.**

## TL;DR

The repository is frozen **half-way through a cutover**. The client half is done; the
server half is not live. Until you finish this runbook, **every sale ships without
decrementing inventory.**

Do not remove the customer branch from `firestore.rules` until step 3 below has
confirmed the functions are live and moving stock. Out of order, you either lose all
checkouts or you oversell indefinitely.

## Current state, verified

| Layer                         | State                     | Where                                           |
| ----------------------------- | ------------------------- | ----------------------------------------------- |
| Client stock decrement        | **REMOVED**               | `src/app/core/services/order.service.ts:68-83`  |
| `reconcileOrderStock`         | Written, **not deployed** | `functions/src/index.ts:260`                    |
| `restockCancelledOrder`       | Written, **not deployed** | `functions/src/index.ts:499`                    |
| Customer stock-write rule     | **STILL OPEN**            | `firestore.rules:186-190`                       |
| Rules tests for the new world | **4 RED**                 | `tests/firestore.rules.test.ts:126,139,148,161` |

### Why stock is not decrementing today

`order.service.ts` no longer writes stock — it delegates to a function that is not
running. The rules still _permit_ a customer to write stock, but nothing in the app
does so any more. Net result: orders are created, money is (presumably) collected, and
the shelf count never moves.

### Why you cannot simply delete the rule branch

`firestore.rules:186-190` grants any signed-in user a stock write scoped only by _key
name_:

```rules
|| (isSignedIn()
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['stock', 'updatedAt'])
    && stockIsSane());
```

`stockIsSane()` (`firestore.rules:135-141`) only checks each size is a non-negative
integer. So today any signed-in session can write `stock.cup: 999999` (oversell) or
zero the entire catalogue (availability DoS). That branch is the worst hole in the file.

It is also, right now, the only thing that would have let a client decrement — but the
client no longer tries. **The branch is pure attack surface with no remaining purpose.**

Deleting it is correct and is the goal. It is only unsafe if the function is not yet
live, because then nothing decrements at all _and_ the cancellation restock path is
gone too.

## Prerequisites

- [ ] **Firebase project upgraded Spark → Blaze.** Cloud Functions cannot deploy on the
      free plan. This is a billing change in the Google Cloud console and it is the
      single hardest gate in this document — nothing here works without it.
- [ ] You are signed in as an owner: `firebase login`
- [ ] `five-orites-scoop` is the active project (`.firebaserc` default)

## Step 1 — Deploy the functions

```bash
npm run deploy:functions
```

Expected: `tsc` compiles clean, then `firebase deploy --only functions` reports two
deployed triggers. Verify in the console under **Functions**.

## Step 2 — Prove the function moves stock BEFORE touching the rules

Place one real order through the app (any signed-in non-admin account):

1. Note a product's `stock.cup` in the Firestore console.
2. Check out one unit of that product.
3. **Confirm `stock.cup` dropped by exactly 1**, and that a `stockMovements` row
   appeared with reason `sale`.
4. Cancel the order.
5. **Confirm `stock.cup` returned to its original value** and a `cancel_restock` row
   appeared.
6. Cancel the same order a second time. Stock must **not** move again.

If stock does not move in step 3, **stop.** The function is not live or not triggered.
Do not proceed to step 3.

## Step 3 — Close the hole in the rules

Only after step 2 passes. Edit `firestore.rules:186-190`, replacing:

```rules
      allow update: if (canRunShop() && isWellFormedProduct())
        || (isSignedIn()
            && request.resource.data.diff(resource.data).affectedKeys()
                 .hasOnly(['stock', 'updatedAt'])
            && stockIsSane());
```

with:

```rules
      allow update: if canRunShop() && isWellFormedProduct();
```

Then update the comment block above it (`firestore.rules:166-182`) — it describes a
temporary branch that no longer exists.

```bash
npm run deploy:firestore
```

## Step 4 — Prove the rules now refuse it

```bash
npm run test:rules
```

The 4 tests at `tests/firestore.rules.test.ts:126,139,148,161` must now pass:

- a customer may NOT write stock at all — the Cloud Function owns it
- a customer may NOT restock on cancel either
- a customer may NOT raise stock to inflate availability — the hole is CLOSED
- a customer may NOT zero the catalog (availability DoS)

Then run the full gate:

```bash
npm run verify
```

`verify` chains `typecheck → typecheck:scripts → test:logic → test:rules →
check:contrast → build`. **It cannot pass today** — `test:rules` is red. It should be
green after this runbook is complete.

## Step 5 — Confirm the live project agrees

Static review cannot prove deployed state. Against the live project:

1. Sign in as a **non-admin** and place a real order. This is the single test that
   catches the original bug.
2. Cancel it; confirm stock returns to its prior value.
3. Open the same order in two tabs, cancel in both, confirm stock returns **once**.
4. As admin, advance the status; confirm the in-app notification lands on the
   **customer's** device, not the admin's.
5. Sign in as a second customer; confirm neither order is readable.
6. Withdraw network access and open admin inventory — it must show an **error**, not
   "0 products".

## Rollback

If step 3 goes wrong, revert the rules immediately:

```bash
git revert <the commit that removed the branch>
npm run deploy:firestore
```

Restoring the branch is safe on its own: with the client no longer writing stock, the
branch grants no new capability the app uses. It re-opens the hole, so treat the revert
as temporary and fix forward.

Rolling back the **functions** alone (step 1) is the dangerous direction — it stops
stock decrementing while the client still does not decrement either.

## After the cutover

Two things in this repo still assume the old world and should be cleaned up:

- `functions/src/index.ts:39-47` describes a client cutover that has already happened.
- `src/app/core/services/stock-ledger.service.ts:5-22` documents the customer stock
  hole as open. After step 3 it is closed.
- `README.md:82-92` still says "Stock is decremented client-side" and `README.md:311`
  lists Cloud Functions as out of scope. Both are false.
