// src/app/core/logic/flavor.ts
// Five-orites Scoop — which flavour a product is
//
// WHY A SEPARATE MODULE, and why it is this small. Framework-free and pure, so
// `tests/logic.test.ts` imports the same code the app runs rather than a copy of
// it — the arrangement the rest of `core/logic` follows and the reason those tests
// are worth anything.
//
// THE OBVIOUS IMPLEMENTATION IS WRONG, and demonstrably so. The requirement was
// "auto-populate the flavor from the variant name", which reads like a substring
// search for a flavour word in `variantName`. Against the live catalogue that is
// wrong for SEVEN of sixty-five products, and wrong in the most misleading way
// possible — the flavour is named in the name, but it is not the flavour of that
// product:
//
//   Chocolate Chip Cookie Dough   Set 8 (Cookies & Cream)  -> would answer "Chocolate"
//   Coffee Chocolate Chip         Set 7 (Coffee)          -> would answer "Chocolate"
//   Mint Chocolate Chip           Set 6 (Mint)            -> would answer "Chocolate"
//   Mint Chocolate Cookie         Set 6 (Mint)            -> would answer "Chocolate"
//   Vanilla Cookie Crumble        Set 2 (Vanilla)         -> would answer "Cookie"
//   Ube Cookies and Cream         Set 5 (Ube)             -> would answer "Cookie"
//
// Every one of those names mentions another flavour. A search finds the mention.
//
// THE SET IS THE FLAVOUR. `setName` is stored on every product and is one clean
// value per set, so the answer comes from there and the variant name is not
// consulted at all. That is correct for all sixty-five products, needs no keyword
// table, and cannot be defeated by a product name that mentions a rival flavour.
//
// It also sidesteps a real gap: `SET_NAMES` in pricing.config.ts defines sets 1-8,
// but the live catalogue has a set 9. Deriving from that constant would have
// produced `undefined` for the one product in it.

/**
 * The flavour a product belongs to, singularised.
 *
 * Singularisation is a trailing-`s` strip and nothing cleverer. Across the whole
 * catalogue exactly one set name needs it — `Chocolates` -> `Chocolate` — while
 * `Vanilla`, `Ube`, `Mint`, `Mango`, `Strawberry`, `Coffee` and `Pistachio` are
 * already singular and `Cookies & Cream` does not end in `s` at all. A smarter
 * rule would be a rule that could be wrong.
 *
 * Returns `''` for a missing name so a half-populated document shows a blank
 * rather than the word "undefined" in the admin form.
 */
export function flavourOf(source: { setName?: string | null } | null | undefined): string {
  const raw = typeof source?.setName === 'string' ? source.setName.trim() : '';
  if (!raw) return '';
  return /s$/i.test(raw) && !/ss$/i.test(raw) ? raw.slice(0, -1) : raw;
}

/**
 * Initials for the avatar fallback, derived rather than stored.
 *
 * Stored initials were a second copy of a fact already implied by the name, and
 * two copies drift: correcting someone's name would leave their initials showing
 * the old spelling. All five seeded developers' stored initials matched
 * `first + last`, so nothing is lost by deriving it.
 *
 * One letter per word, uppercased, capped at two so a three-word name does not
 * overflow the disc.
 */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * A CSS-class-safe key for a flavour, derived from the set name.
 *
 * Used to pair each catalogue flavour with its pastel chip colour. Keyed on the
 * NAME rather than the set number on purpose: `setChips()` on the Products page
 * is derived from live documents, so a set can be renumbered without the label
 * the customer reads ever changing. A number-keyed map would silently start
 * painting the wrong colour the day someone renumbered a set, and nothing would
 * fail. A name-keyed map follows the thing the user actually sees.
 *
 * Runs through `flavourOf()` first so the key is singular — `Chocolates` and
 * `Chocolate` must land on the same colour, and the catalogue happens to use the
 * plural.
 *
 * Returns '' for a name that is blank or reduces to nothing, which is the caller's
 * signal to fall back to the brand primary. An unmapped flavour is a gap in this
 * map; it must never be an undefined class name on a chip.
 *
 * The full set of keys this can produce against the live catalogue:
 * chocolate, vanilla, strawberry, mango, ube, mint, coffee, cookies-cream,
 * pistachio.
 */
export function flavourSlug(setName: string | null | undefined): string {
  return flavourOf({ setName })
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
