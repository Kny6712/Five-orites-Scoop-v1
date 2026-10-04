// src/app/core/logic/firestore-error.ts
// Five-orites Scoop — Turning a Firestore failure into something a user can act on
//
// WHY THIS EXISTS
// ---------------
// Every page that reads Firestore used to collapse any failure into one sentence:
// "Could not load X. Check your connection and try again."
//
// That sentence is wrong for almost every failure it is shown for. The concrete
// case that prompted this: `getCustomerOrders()` runs
// `where('customerId','==',uid) + orderBy('createdAt','desc')`, which needs a
// composite index. The index is declared in firestore.indexes.json but was never
// deployed, so the query fails with `failed-precondition` on every customer load
// — and the UI blamed the user's wifi.
//
// The three cases that actually matter, and what the user should be told:
//
//   failed-precondition  A required database index is missing. Nothing the user
//                        does will fix it; a developer has to deploy. Telling
//                        them to "check their connection" sends them off to
//                        toggle wifi for no reason.
//   permission-denied    Firestore rules rejected the read. Usually a genuine
//                        bug or a role that has not resolved yet.
//   unavailable          The network is genuinely down. This is the ONLY case
//                        where "check your connection" is the right advice.
//
// Anything else is a genuine unknown and gets a deliberately non-specific
// message, because inventing a cause is worse than admitting we do not know one.
//
// Pure logic — no Angular, no Firestore import — so tests/logic.test.ts can
// exercise it directly, following the same pattern as core/logic/voucher.ts.

/** The subset of a FirestoreError we actually look at. */
interface FirestoreErrorLike {
  code?: unknown;
  message?: unknown;
}

/**
 * Normalises a Firebase error code to its bare form.
 *
 * Some transports prefix the code (`firestore/failed-precondition`), and some
 * surfaces hand back the enum rather than the string, so compare on the tail.
 */
function bareCode(code: unknown): string {
  if (typeof code !== 'string') return '';
  return code.includes('/') ? code.slice(code.lastIndexOf('/') + 1) : code;
}

/**
 * A short, user-facing explanation of why a read failed.
 *
 * `what` names the thing that could not be loaded ("your recent orders"), and is
 * only used for the genuinely-unknown case — the specific codes say something
 * more useful than "your X".
 */
export function describeFirestoreError(what: string, err: unknown): string {
  const code = bareCode((err as FirestoreErrorLike | null)?.code);

  switch (code) {
    case 'failed-precondition':
      return 'This part of the app is missing a database index, so it cannot load yet. Please try again later.';

    case 'permission-denied':
    case 'unauthenticated':
      return `We do not have permission to load ${what}. If you think this is wrong, please sign in again.`;

    case 'unavailable':
    case 'deadline-exceeded':
      return 'You appear to be offline. Check your connection and try again.';

    case 'resource-exhausted':
    case 'unimplemented':
    case 'internal':
      return 'The service is temporarily unavailable. Please try again in a moment.';

    default:
      return `Could not load ${what}. Please try again.`;
  }
}

/**
 * Is this the missing-composite-index failure?
 *
 * Worth branching on separately at the call site when the developer-facing
 * remedy ("run `npm run deploy:firestore`") should be surfaced in a dev build
 * even though it would be meaningless to an end user.
 */
export function isMissingIndexError(err: unknown): boolean {
  return bareCode((err as FirestoreErrorLike | null)?.code) === 'failed-precondition';
}

/**
 * Did the security rules refuse this?
 *
 * Needed on the WRITE path, which `describeFirestoreError` above cannot serve.
 * Its `permission-denied` branch reads "We do not have permission to load …",
 * which is simply wrong for a write: nothing was being loaded, something was
 * being changed, and the remedy is not "sign in again".
 *
 * The case that made this necessary is the stock transition in `OrderService`.
 * Moving an order off `pending` writes the product documents inside the same
 * transaction, and that write is gated on `canRunShop()` — manager and above.
 * A staff shift lead can open the fulfilment queue and press the button, and
 * the transaction fails as a whole with an opaque `permission-denied` that
 * names no field, no role and no next step. See the note in
 * `transitionOrderStatus` for why the gate cannot simply be lowered instead.
 */
export function isPermissionDeniedError(err: unknown): boolean {
  const code = bareCode((err as FirestoreErrorLike | null)?.code);
  return code === 'permission-denied' || code === 'unauthenticated';
}
