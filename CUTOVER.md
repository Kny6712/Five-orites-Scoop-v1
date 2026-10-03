# CUTOVER.md — stock ownership, staff-gated

Referenced from `firestore.rules`. **Read this before deploying rules, and before
telling a customer anything about stock or their orders.**

> ### ⚠ THIS IS NOT THE RUNBOOK THE FILE NAME SUGGESTS
>
> An earlier version of this file was a runbook for deploying Cloud Functions and
> cutting stock ownership over to them. **That deployment can never happen on this
> project** — it is on the free Spark plan — and every line-number citation in it
> had gone stale. It has been rewritten as what it now is: **a runbook for the
> staff-gated stock movement that replaced it**, plus an honest note on the one
> customer-visible behaviour change it introduced.
>
> There is **no Blaze upgrade to do** and **no `deploy:functions` step**. If you
> were following the old version of this file, stop and re-read.

## TL;DR

The cutover landed, and it landed somewhere other than where this file used to
predict. Stock is **not** reserved at checkout and **not** moved by a server.
**Stock is taken by staff**, inside the transaction that advances an order out of
`pending` in the fulfilment queue. Checkout writes the order and nothing else.

There is no "half-finished migration" any more, and no ordering constraint: the
rules no longer permit a customer to write stock, and nothing in the app needs
them to.

### A note on citations

This file cites **file + symbol**, never line numbers. The previous version cited
~20 line numbers, and every one of them was wrong by the time anyone read it —
a runbook that sends you to the wrong line is worse than one that says "see
`transitionOrderStatus`".

## Current state, verified

| Layer                     | State                                                                                      | Where                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Checkout stock write      | **Does not exist.** `placeOrder` writes the order only.                                    | `OrderService.placeOrder`, `src/app/core/services/order.service.ts` |
| Stock movement            | **Lives in the status transition**, in one transaction                                     | `OrderService.transitionOrderStatus`, same file                     |
| Ledger row per movement   | Written in the same transaction as the decrement                                           | `stockMovements` collection                                         |
| Customer stock-write rule | **DELETED** — `/products` is write-gated to `canRunShop()`                                 | `firestore.rules`, `match /products/{productId}`                    |
| Restock on cancel         | **Not needed**: a customer can only cancel while `pending`, which is before stock is taken | `firestore.rules`, `match /orders/{orderId}` customer cancel clause |
| Rules tests               | **120 / 120 passing**                                                                      | `npm run test:rules`                                                |
| Business-logic tests      | ~165 cases                                                                                 | `npm run test:logic`                                                |
| Cloud Functions           | 3 handlers on disk, **cannot be deployed on Spark**                                        | `functions/src/index.ts`                                            |

### Why stock is not decremented at checkout, in one paragraph

Because nothing reserves it. A customer places an order; the order is `pending`;
stock is untouched. When staff advance it to `confirmed` or `preparing`, the
transaction re-reads every product on the order, checks every line, decrements
all of them and writes a `stockMovements` row per line — or aborts the whole
movement and refuses the transition if any line is short. This is deliberate and
it is the correct trade for a shop that cannot run a server: the person who knows
the shelf is the person who takes from it, and the transition they make is the
thing that is atomic.

## Step 1 — Deploy the rules and indexes

```bash
npm run deploy:firestore
```

Expected: rules deploy, then the **4 composite indexes** in
`firestore.indexes.json` are created. Index creation is asynchronous in the
console — a fresh project can report "indexes are being created" for a minute or
two, and a query that needs one fails until then. That is not a broken deploy.

**`npm run deploy` now works, and it is the thing to use.** It used to chain
`firestore → functions → hosting`, and because the functions step cannot succeed
on the Spark plan it died in the middle and hosting was never published at all.
The functions step is now out of the chain rather than left to fail: `deploy` is
`deploy:firestore && deploy:hosting`, and `deploy:functions` survives as a
separate script that still fails, so nobody puts it in a release pipeline by
accident.

Still worth running the two halves separately while you are reading the output,
because one `&&` chain reports only the first failure and this is the first time
either half has ever run against a live project.

**There is no staging project.** Every deploy targets the live shop. Rollback is
the git history of `firestore.rules`: revert the commit, then
`npm run deploy:firestore`.

## Step 2 — Prove the staff path moves stock, before trusting it

This is the check that matters. Static review cannot prove deployed state.

1. Sign in as a **non-admin** and place a real order. Confirm `stock` on every
   product on it is **unchanged**. This is the single test that catches a
   regression into client-side decrement.
2. Sign in as staff, open the fulfilment queue, advance that order out of
   `pending`. Confirm:
   - `stock` dropped by exactly the ordered quantity, for **every** line;
   - a `stockMovements` row appeared per line, reason `sale`, carrying the
     `orderId`.
3. **Test the abort.** Order a quantity larger than the current stock of one
   flavour and advance it. The transition must be **refused**, and no line may
   move. A partial decrement is the failure mode to look for.
4. Open the admin ledger and confirm the running balance matches
   `InventoryService.adjustStock` history for the same product.
5. Cancel a still-`pending` order as the customer. Stock must **not** move —
   nothing was ever taken. Confirm the order reaches `cancelled` and the reason
   is visible to the customer.

If step 2 does not move stock, **stop.** Do not deploy anything else.

## Step 3 — Prove the rules refuse a customer stock write

```bash
npm run test:rules
```

All 143 cases must pass. The ones that matter here assert that a signed-in
customer **cannot**:

- write a product's `stock` at all, in the app or with the raw SDK;
- raise stock to inflate availability (`stock.cup: 999999`);
- zero the catalog as an availability denial-of-service;
- restock by cancelling.

Then the full gate:

```bash
npm run verify
```

`verify` chains `typecheck → typecheck:scripts → lint → test:logic → test:rules
→ check:contrast → build`. **It is green.** It was not, for a long time, and the
reason it was red is the reason this section exists: the rules still granted a
customer a stock write while the client no longer performed one, so the tests
described the intended state and the rules did not implement it. That gap is
closed.

## Step 4 — Confirm the live project agrees

Static review and a green suite cannot prove deployed state. Against the live
project, in order:

1. Non-admin places a real order (step 2.1 above).
2. Staff advance it; stock moves once, with ledger rows.
3. Open the same order in two tabs and advance it in both. Stock must move
   **once** — the second transition is a no-op because the order is no longer
   `pending`.
4. As admin, advance the status and confirm the in-app notification lands on the
   **customer's** device, not the admin's.
5. Sign in as a second customer; confirm neither order is readable.
6. Withdraw network access and open admin inventory — it must show an **error**,
   not "0 products".

## The one behaviour change, stated plainly

**Stock is taken when staff advance the order, not at checkout. So an order can
be accepted and then declined.**

Before this change, checkout held stock for you and the order could not fail for
want of it. Now the order sits `pending` with nothing reserved, and a staff
member can refuse it at the moment they pick it up — usually because a flavour
sold out between your checkout and their review. `TERMS.md` says this to
customers; `README.md` → "Known limitations" says it to developers. Keep all
three in step if the model ever changes.

Nothing else a customer can do touches stock, which is why no customer write path
was needed.

## Rollback

If the staff transition misbehaves, the safe move is to **stop using the queue**,
not to re-open the customer write:

```bash
npm run deploy:firestore        # after reverting the offending commit
```

Re-opening the customer branch of `firestore.rules` would be **fixing forward in
the wrong direction**: it grants any signed-in session a write to a product's
stock scoped only by key name, with no direction check and no requirement that
the caller own any order — so `stock.cup: 999999` (oversell) and a zeroed catalog
(availability DoS) both become one call away. It is not a rollback target. Fix
the transaction instead.

Rolling back the **functions** is not a scenario: there is nothing deployed to
roll back.

## After the cutover

Already done — recorded so nobody re-opens them:

- The customer stock-write branch is deleted from `firestore.rules`, with the
  reason it existed written into the comment block above it (the history is the
  point; a bare deletion reads like an accident).
- Its comment block no longer claims the client write and the rule branch were a
  "matched pair" to be cut over together. Both halves of that were correct when
  written and both are now false.
- `npm run verify` is green, and CI (`.github/workflows/ci.yml`) runs the same
  chain, so this cannot silently regress again.

Still true, and worth knowing before you promise anything:

- **`functions/` is dead code.** `reconcileOrderStock`,
  `restockCancelledOrder` and `anonymiseDeletedCustomerOrders` cannot be
  deployed on the Spark plan and have never run. `reconcileOrderStock` was
  replaced by the staff transaction; `anonymiseDeletedCustomerOrders` is why
  `PRIVACY.md` has to say that a deleted customer's past orders are **not**
  redacted. Deleting `functions/` is a clean, separate change if you want it —
  but the privacy caveat has to go with it, not before.
- **`StockLedgerService` is read-only.** It reads `stockMovements` and reports
  drift; it does not write rows and has no `record()` method. Every ledger row is
  written by the inventory adjust/restock transaction or by the status-transition
  transaction, inside the same transaction as the product write.
- **Per-item `unitPrice` is still client-authored.** Firestore rules cannot loop
  over `items`, so the basket total is whatever the client said. `totalAmount`,
  `deliveryFee`, `discountAmount` and `grandTotal` are all validated, but the
  line items behind them are not.
