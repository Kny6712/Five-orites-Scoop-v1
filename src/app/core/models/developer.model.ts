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

/** The hexes, for the rules-parity test and for validating a write. */
export const DEVELOPER_ACCENT_HEXES: readonly string[] = DEVELOPER_ACCENTS.map((a) => a.hex);

/** A developer as the UI consumes it: the stored fields plus the document id. */
export interface Developer extends Omit<DeveloperDoc, 'photoURL'> {
  id: string;
  photoURL: string | null;
}

/**
 * The five records the page started with, kept as an offline fallback.
 *
 * Not decoration. The credits page is PUBLIC — no route guard, so a signed-out
 * guest reaches it — and a Firestore read that fails would otherwise render a blank
 * page where there used to be five names. Falling back to the last-known-good
 * contents is the difference between a degraded page and an empty one. Mirrors the
 * `DEFAULT_SHOP_SETTINGS` pattern in ShopSettingsService.
 *
 * `scripts/seed-developers.ts` writes exactly these to Firestore.
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
    id: 'heaven-alvior',
    name: 'Heaven Alvior',
    roles: ['QA', 'Documentation'],
    accent: '#CDEAD9',
    photoURL: null,
    order: 2,
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
