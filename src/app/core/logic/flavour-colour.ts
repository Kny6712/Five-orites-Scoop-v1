// src/app/core/logic/flavour-colour.ts
// Five-orites Scoop — the pastel a flavour is painted in
//
// WHY THIS EXISTS, and why it is a function and not a lookup table.
//
// The nine `--flavor-*` pastels in theme/variables.scss are already paired with
// the nine flavours by NAME, and `flavourSlug()` in core/logic/flavour.ts already
// produces exactly those nine keys — it was built for this and its own docstring
// says so. So this module holds no mapping of its own. That matters: a second
// copy of the flavour→colour table would be a second thing to forget when a
// flavour is renamed, and nothing would fail when the two disagreed.
//
// KEYED ON THE NAME, NOT THE SET NUMBER, deliberately. `flavourSlug()`'s comment
// makes the case at length and it is worth repeating here because it is the whole
// reason this takes a name: the Products page builds its filters from live
// documents, so a set can be renumbered without the label the customer reads ever
// changing. A number-keyed map would silently start painting the wrong colour the
// day someone renumbered a set.
//
// WHY A FUNCTION AND NOT A CONSTANT: the fallback. `flavourSlug` returns '' for a
// blank name, and the catalogue once contained a set 9 that `SET_NAMES` does not
// define. Interpolating that into `var(--flavor-)` yields a token that does not
// exist and the badge silently loses its fill — a failure with no error anywhere.
// Returning a real, always-valid token instead means an unmapped flavour looks
// exactly like the pre-tint badge rather than looking broken.
//
// NOTHING HERE CHOOSES A COLOUR. The value is a `var()` reference, so the colour
// still lives in exactly one place (variables.scss) and a palette change is still
// a one-line edit with no TypeScript touched.

import { flavourSlug } from './flavour';

/** The nine pastels are defined in theme/variables.scss, not here. */
export const FLAVOUR_TOKEN_FALLBACK = 'var(--flavor-all)';

/**
 * A `background` value painting this product's flavour in its pastel.
 *
 * The parameter is narrowed to just what is read, so this accepts anything
 * carrying a set name — a Product, or the subset an inventory row happens to have.
 *
 * Returns `var(--flavor-all)` for a blank or unrecognised flavour. That token is
 * `var(--color-brand-primary)`, which is precisely the fill these badges wore
 * before they were tinted, so the fallback is indistinguishable from the status
 * quo rather than a hole in the design.
 */
export function flavourBackground(source: { setName?: string | null } | null | undefined): string {
  const slug = flavourSlug(source?.setName);
  return slug ? `var(--flavor-${slug})` : FLAVOUR_TOKEN_FALLBACK;
}
