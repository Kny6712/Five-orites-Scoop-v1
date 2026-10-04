# Five-orites Scoop: Gap Analysis and Improvement Report

> **SUPERSEDED — retained for provenance only. Do not act on this document.**
>
> This was the original gap analysis, written before any remediation. Its
> findings have since been re-derived, corrected, and largely fixed. Several of
> its conclusions are now wrong, and following them would undo the fixes.
>
> **The source of truth is `firestore.rules` and `README.md`.** Where this file
> and either of those disagree, they are right and this is wrong.

## What was right

- Every planned module did have an implementation. That assessment held up.
- Push notifications were in-app only, and the recommendation to confirm with the
  professor was correct. The follow-up decision was made: notifications are
  in-app only, permanently. `@capacitor/push-notifications` has been removed and
  will not return, because FCM cannot be used on the free Spark plan.
- Soft delete (deactivate) instead of hard delete was the right call, and is now
  enforced by `allow delete: if false`.

## What was wrong, and what happened instead

| This document said | Reality |
|---|---|
| Rules allow `products` update for admins only, so a customer's checkout "should be rejected" — *test with a non-admin account now* | Correct observation, wrong conclusion. Stock is no longer touched at checkout by anyone. It is moved by **staff**, inside the order-status transaction in `OrderService.transitionOrderStatus`. The customer branch of the product rule was deleted; see the products block in `firestore.rules`. |
| Rules conflict with `validateAndDecrementStock` at checkout | The client call was removed rather than the rule being loosened. That was the single highest-value fix of the remediation: it closed a hole where a forged order drained stock, at zero cost and with no Blaze upgrade. |
| Full push compliance needs FCM plus a Cloud Function on the Blaze plan | Correct, and it will not happen — the owner is not upgrading. Replaced by the in-app notification feed derived from `statusHistory`. |
| Line-number citations into the source tree | Every citation here is stale. The tree has been refactored repeatedly since. |

## Kept as history

The full original text is preserved in the repository history at commit
`036af37` and earlier. It is not reproduced here because it would be read as
current.
