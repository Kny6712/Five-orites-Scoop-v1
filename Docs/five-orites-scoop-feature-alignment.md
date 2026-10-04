# Five-orites Scoop — Feature Alignment Audit

> **STALE — superseded. Retained for provenance only.**
>
> This audit was written on 2026-09-30, **before** the stock-fulfilment decision
> that changed the app's central model. Do not cite it as current.
>
> **The source of truth is `README.md` and `firestore.rules`.**

## The one thing that invalidates most of it

This document's feature table was written on the assumption that **stock is
reserved at checkout by the customer**. That is no longer true, and the change
is architectural rather than cosmetic:

> Stock is now moved by **staff**, when an order leaves `pending`, inside a single
> Firestore transaction. A customer never writes a product document.

Everything downstream of that assumption is out of date — in particular any row
about checkout behaviour, stock reservation, cancellation restocking, or who is
permitted to write `products`. Firestore rules cannot express "this order was
paid for", so a client-side reservation would have left forged orders able to
drain stock; gating stock behind staff removes that ability by construction.

## Conclusions that survive

- The audit compared the project **against itself**, not against a specification.
  That caveat was correct and still applies to any re-run of this exercise.
- The planned modules were all present. This remains true.
- Cones and sundaes absent, price filter and sort missing, soft delete instead
  of hard delete — all still accurate, and none was addressed afterwards.

## Where to look now

| Question | File |
|---|---|
| What can each role actually do? | `firestore.rules` |
| What does the app do, and what does it deliberately not do? | `README.md` |
| How did we get here, and what is cut over? | `CUTOVER.md` |
| What is honestly promised to users? | `PRIVACY.md`, `TERMS.md` |

The full original text is in the repository history at commit `036af37`.
