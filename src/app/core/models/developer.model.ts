// src/app/core/models/developer.model.ts
// Five-orites Scoop — a team member on the public credits page
//
// WHY THIS IS A MODEL AND NOT FIVE LINES OF TEMPLATE.
//
// The developers page was a hardcoded array of five literals in the component.
// That is fine right up until someone wants to fix a typo in a name or replace a
// photo, at which point the only route is a developer, a rebuild and a deploy —
// and the person who most needs to change it is the owner, who should not need the
// Firebase console to correct their own credits.
//
// So the records move to Firestore, and this file is the contract. The rules gain
// a `developers` block so the write is actually gated; without it the catch-all
// deny at the bottom of firestore.rules rejects every write for every role,
// including owner, and a UI-only permission control would be cosmetic.

/**
 * One developer, as stored.
 *
 * `id` is the document id and is NOT a stored field: Firestore already carries it,
 * and duplicating it in the body is a second copy that can disagree.
 */
export interface DeveloperDoc {
  /** Display name, shown on the credits page and used to derive initials. */
  name: string;

  /**
   * Roles, free text, in display order.
   *
   * Free text rather than a closed enum because these are credits, not
   * permissions — "Main Project Lead" and "Documentation" are not a vocabulary
   * anyone else needs to agree on. The chip COLOUR is matched by substring
   * (DevelopersPage.getRoleColour), so an unrecognised role degrades to the
   * neutral tone instead of failing.
   */
  roles: string[];

  /**
   * Disc colour behind the initials, as a hex string.
   *
   * Constrained to the app's own palette by the rules, not by this type, because a
   * union of five literals here would be a compile error rather than a rejection at
   * write time. `DEVELOPER_ACCENTS` is the vocabulary.
   */
  accent: string;

  /**
   * Cloudinary URL of an uploaded photo, or null.
   *
   * Null rather than absent, so "no photo" is one unambiguous value — the same
   * convention `AppUser.photoURL` uses, and for the same reason.
   */
  photoURL: string | null;

  /**
   * Display position, ascending. Firestore has no inherent order, so an explicit
   * integer is what makes the credits page stable between loads. Single field, so
   * it needs no composite index.
   */
  order: number;
}

/** The palette a developer disc may use, and the reason it is a closed set. */
export const DEVELOPER_ACCENTS: ReadonlyArray<{ hex: string; label: string }> = [
  { hex: '#CFE4F2', label: 'Powder' },
  { hex: '#CDEAD9', label: 'Mint' },
  { hex: '#F8D2DD', label: 'Blush' },
  { hex: '#FBE9BE', label: 'Lemon' },
  { hex: '#D3DDF7', label: 'Periwinkle' },
];

/** A developer as the UI consumes it: the stored fields plus the document id. */
export interface Developer extends Omit<DeveloperDoc, 'photoURL'> {
  id: string;
  photoURL: string | null;
}

/**
 * The four records the page started with, kept as an offline fallback.
 *
 * Not decoration. The credits page is PUBLIC - no route guard, so a signed-out
 * guest reaches it - and a Firestore read that fails would otherwise render a blank
 * page where there used to be four names. Falling back to the last-known-good
 * contents is the difference between a degraded page and an empty one. Mirrors the
 * `DEFAULT_SHOP_SETTINGS` pattern in ShopSettingsService.
 *
 * `scripts/seed-developers.ts` writes exactly these to Firestore.
 *
 * -- THIS LIST IS NOT WHAT THE PAGE RENDERS. --
 *
 * `DevelopersPage` reads `DeveloperService.developers`, which is a computed over a
 * live `onSnapshot` of the `developers` collection. This array is reached only when
 * that read fails or resolves to zero documents. Removing an entry here changes the
 * degraded path and the no-backend path, and NOTHING about the page as a visitor
 * sees it.
 *
 * That is why a departure is never a one-line change. Removing a credit is TWO
 * edits in TWO places:
 *
 *   1. this array, for the fallback, and
 *   2. the Firestore document itself, via the owner-only delete on
 *      `/admin/developers` - or, failing a session, the Firebase console.
 *
 * Doing only the first leaves the card on the live page while the fallback quietly
 * disagrees with it, which is the worst of the two outcomes: right in one place,
 * wrong in the other, and no visible sign of the split.
 *
 * Do not reach for `npm run seed:developers -- --force` to reconcile them. The
 * seeder is additive by construction - every write is a `setDoc` with
 * `merge: true` and it never issues a delete - so it can add the four but is
 * structurally incapable of removing a fifth that is still stored.
 *
 * The `order` values below are NOT contiguous, and that is deliberate. `watch()`
 * sorts with `orderBy('order', 'asc')`, which needs a total order, not a gapless
 * one, so 1/3/4/5 is perfectly valid. Renumbering here would also drift from the
 * live documents, which keep their own values, leaving the two sources to disagree
 * about a field that neither the page nor the admin list displays.
 *
 * Heaven Alvior left the group, which is why this reads four and not five. Their
 * document still has to be deleted at the source, and their photo, if one was ever
 * uploaded, stays in the Cloudinary media library - the admin delete warns about
 * exactly that, and nothing here cleans it up.
 */
export const DEFAULT_DEVELOPERS: readonly Developer[] = [
  {
    id: 'kenn-karlo-umadhay',
    name: 'Kenn Karlo Umadhay',
    roles: ['Main Project Lead', 'Full Stack Dev', 'UI/UX Designer Lead', 'QA', 'Documentation'],
    accent: '#CFE4F2',
    photoURL: null,
    order: 1,
  },
  {
    id: 'justin-curby-esguerra',
    name: 'Justin Curby P. Esguerra',
    roles: ['Full Stack Dev', 'UI/UX Designer', 'QA', 'Documentation'],
    accent: '#F8D2DD',
    photoURL: null,
    order: 3,
  },
  {
    id: 'renz-de-la-cruz',
    name: 'Renz Gabriel De la Cruz',
    roles: ['QA', 'Documentation'],
    accent: '#FBE9BE',
    photoURL: null,
    order: 4,
  },
  {
    id: 'antonio-villanueva',
    name: 'Antonio Miguel Villanueva',
    roles: ['Full Stack Dev', 'UI/UX Designer', 'QA', 'Documentation'],
    accent: '#D3DDF7',
    photoURL: null,
    order: 5,
  },
];
