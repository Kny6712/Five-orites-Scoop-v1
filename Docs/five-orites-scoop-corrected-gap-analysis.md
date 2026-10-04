# Five-orites Scoop — Corrected Gap Analysis

> **SUPERSEDED — retained for provenance only.**
>
> Written before the stock-fulfilment decision. Its remediation table describes
> code that has since been rewritten, and its own warning that "none has been
> exercised against a live Firestore project" still applies to everything that
> replaced it.
>
> **The source of truth is `firestore.rules` and `README.md`.**

## Why this document was retired

It was a defect-level audit: what was broken, and what was done about it. Every
defect it listed has since been addressed, and the fixes it recommended have
been overtaken by a larger architectural change:

> Stock is moved by **staff** when an order leaves `pending`, in one transaction
> in `OrderService.transitionOrderStatus`. Customers never write `products`. The
> customer stock branch of the product rule was deleted outright.

That single decision supersedes most of this document's recommendations,
including its advice to reconcile the client and the rules on stock writes.
Lowering the rules gate was the direction considered and **rejected** — it is the
hole that let a forged order drain inventory.

It also predates three things worth knowing about:

- **Notifications are in-app only.** `@capacitor/push-notifications` is removed
  and will not return. The feed is derived from `statusHistory`, so it cannot
  drift from the orders.
- **`deliveryFee` had no validation at all** and now does. Before that fix,
  `totalAmount: 1000, discountAmount: 0, deliveryFee: -450, grandTotal: 550`
  satisfied every clause in the rules — ₱450 removed from an order with no
  zero-price line item anywhere.
- **Cloud Functions cannot be deployed** on the free Spark plan. `functions/src/`
  is kept as a specification only; nothing in it has ever run.

## Part 6 (pre-demo checklist) — struck

This document's "verify before demoing" list is obsolete. Do not work from it.
The current checklist is in `CUTOVER.md`.

## Where to look now

| Question | File |
|---|---|
| What can each role actually write? | `firestore.rules` |
| What does the app do, and not do? | `README.md` |
| What is honestly promised to users? | `PRIVACY.md`, `TERMS.md` |

The full original text is in the repository history at commit `036af37`.
