// src/app/core/logic/credits.ts
// Five-orites Scoop — what the ADMIN credits page should show, given a load state
//
// WHY THIS IS A SEPARATE MODULE, and not three `@if` blocks in a template.
//
// The decision "can I write to the credits list?" is the answer to two
// independent questions, ANDed together:
//
//     is the reader allowed to manage the team?
//     AND is there anything real loaded to write TO?
//
// The second half is not decoration. That bug shipped: an empty or failed
// Firestore read left the admin page rendering `DEFAULT_DEVELOPERS`, so it showed
// four healthy names with live Add / Edit / Reorder / Delete controls. Every one
// of those wrote to a document id that did not exist, and `firestore.rules`
// refused each with PERMISSION_DENIED — a failure the UI renders identically to
// a broken button, which is how it was reported and why it took a while to find.
//
// It is a pure function of two values, so it belongs here where `tests/logic.test.ts`
// can assert it without a Firestore emulator. The template's job is to render
// the answer, not to re-derive it.
//
// THE PUBLIC PAGE DELIBERATELY DISAGREES. `/developers` has no route guard and a
// signed-out guest reaches it, so there it is strictly better to show four
// slightly stale names than a blank credits page. The same fallback is a trap on
// an admin page, whose entire purpose is editing real records. Hence two answers
// to one question, and this file only speaks for the admin one.

import { asRole } from '@core/models/user.model';

/**
 * Moves one entry within a list and renumbers the result contiguously from 0.
 *
 * WHY RENUMBER RATHER THAN SWAP TWO VALUES.
 *
 * The previous implementation swapped the two `order` values and wrote them in
 * two separate `setDoc` calls. That is wrong in two independent ways, and both
 * were reported as "the arrows don't work on some rows".
 *
 * 1. NOT ATOMIC. Between the two writes both records carry the SAME `order`,
 *    which is a tie under `orderBy('order','asc')` and therefore has no defined
 *    sort position. The snapshot that lands in between can render the pair in
 *    either arrangement, so a click visibly jitters and then settles.
 *
 * 2. A TIE IS A SILENT NO-OP, FOREVER. Swapping two records that already share
 *    an `order` writes `x -> x` and `x -> x`. Nothing changes, nothing throws,
 *    no toast fires, and the pair stays stuck across reloads because the swap is
 *    a no-op *by construction*. That is the "some pairs work and some silently
 *    do nothing" symptom exactly. Renumbering from 0 removes the precondition:
 *    after this, no two records can ever share an `order`.
 *
 * Pure, and it takes ids rather than records, so `tests/logic.test.ts` can pin
 * the ordering arithmetic without a Firestore emulator.
 *
 * Returns the new order keyed by id. An out-of-range index is a no-op returning
 * an empty map, rather than a throw: this is called from a click handler.
 */
export function reorderIds(
  ids: readonly string[],
  from: number,
  delta: number,
): Map<string, number> {
  const next = [...ids];
  const to = from + delta;

  // BOTH ends have to be real indices.
  //
  // The old guard checked only `to`, so `from === ids.length` passed it:
  // `splice(from, 1)` then removed nothing at all, `moved` came back
  // `undefined`, and the map that was returned had an `undefined` KEY. The
  // caller (`AdminDevelopersPage.move`) passes that straight to
  // `DeveloperService.writeOrder`, which would have written a Firestore
  // document literally named "undefined".
  //
  // `from === ids.length` is reachable: the index comes from a rendered list,
  // and the list can shrink between the render and the click.
  if (!Number.isInteger(from) || from < 0 || from >= next.length) return new Map();
  if (!Number.isInteger(to) || to < 0 || to >= next.length) return new Map();

  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return new Map(next.map((id, i) => [id, i]));
}

/**
 * Assigns contiguous orders 0..n-1 to ids already in their intended order.
 *
 * This is the REPAIR for records that already hold tied or gapped `order` values
 * — the state left behind by the old non-atomic swap, which nothing else can
 * undo. Given the ids as `watch()` currently sorts them (which is stable even
 * when the values tie), it writes a total order back so every future swap is a
 * real move rather than `x -> x`.
 */
export function normaliseOrder(idsInOrder: readonly string[]): Map<string, number> {
  return new Map(idsInOrder.map((id, i) => [id, i]));
}

/** How the read resolved. Mirrors `DeveloperService.state`. */
export type CreditsLoadState = 'failed' | 'empty' | 'loaded';

/**
 * True for `manager` and `owner`, and deliberately NOT `admin`.
 *
 * This is a literal list rather than `canManageTeam()`, and the difference is a
 * real bug rather than a stylistic choice.
 *
 * `canManageTeam()` is a RANK comparison — `rank >= rank('manager')` — and admin
 * outranks manager, so it returns TRUE for admin. `firestore.rules` instead spells
 * the same intent as `myRole() in ['manager', 'owner']`, which excludes admin.
 *
 * The two therefore disagree for exactly one role, and the UI believed the wrong
 * one: an `admin` opening /admin/developers saw Add, Edit, Reorder and Delete all
 * enabled, and every one of those writes came back PERMISSION_DENIED. The comment
 * on `canManageTeam()` says admin is excluded "because tests/logic.test.ts asserts
 * the ladder invariant" — the intent was always exclusion; only the implementation
 * of the CLIENT half of it was wrong.
 *
 * Rules are the authority. Where a client predicate and a rule disagree, the rule
 * wins, and this list is transcribed from it so the two cannot drift apart quietly
 * again. `test:rules` covers the rules side; the assertions below cover this one.
 */
export function canManageCredits(role: string | null | undefined): boolean {
  const r = asRole(role);
  return r === 'manager' || r === 'owner';
}

/**
 * Whether a write can possibly succeed.
 *
 * False when the load failed or came back empty, even for an owner — because the
 * write would be addressed to a document that does not exist, so the role is not
 * the thing standing in the way.
 */
export function canWriteCredits(role: string | null, load: CreditsLoadState): boolean {
  return load === 'loaded' && canManageCredits(role);
}

/** Owner-only, and only when there is something real to act on. */
export function canDeleteCredit(role: string | null, load: CreditsLoadState): boolean {
  return load === 'loaded' && role === 'owner';
}

/**
 * What the admin page should present.
 *
 * Splitting 'failed' from 'empty' is the whole point. They used to be one
 * boolean (`usingFallback`) and needed opposite advice: an outage is not
 * something the owner can fix from this screen, whereas an empty collection is
 * a real state they can seed or add their way out of.
 */
export function creditsViewState(
  role: string | null,
  load: CreditsLoadState,
): 'error' | 'empty' | 'list' {
  if (load === 'failed') return 'error';
  if (load === 'empty') return 'empty';
  return 'list';
}
