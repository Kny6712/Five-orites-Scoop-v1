// src/app/core/icons/app-icons.ts
// Five-orites Scoop — App icon vocabulary
//
// ── Why there is no icon LIBRARY dependency ───────────────────────────────────
// The official Lucide Angular packages cannot be used on Angular 17:
//
//   - `@lucide/angular` (the current package) ships component metadata targeting
//     Angular 22, and its template uses `@let` — a control-flow block introduced
//     in Angular 18.1. Its `peerDependencies` claim `>=17.0.0`, but the Angular
//     compiler rejects it outright on 17 with:
//       "Incomplete block \"let attrs\"."
//   - `lucide-angular@1.0.0` does compile on 17 (its output targets Angular 13),
//     but it is DEPRECATED in favour of the broken-on-17 package, it is
//     NgModule-based (needing an `importProvidersFrom` shim in an all-standalone
//     app), and it is 2.5 MB of module graph.
//
// The artwork is plain data with no framework coupling: arrays of
// `[tag, attributes]`. So this project takes the genuine Lucide geometry
// (ISC licensed — https://lucide.dev) and renders it in a small component of our
// own. Same icons, no deprecated dependency, and nothing that can break on the
// next Angular upgrade.
//
// Regenerate the geometry with:  npm run icons:generate
//
// ── Why the old per-component `addIcons` calls are gone ───────────────────────
// `addIcons` from ionicons mutates a MODULE-LEVEL GLOBAL map, and every page
// called it in its own constructor. That made icon resolution order-dependent and
// produced three real bugs: `cloud-offline-outline` was registered nowhere at all;
// `alert-circle-outline` was only registered by the inventory/dashboard pages, so
// a cold start on /admin/orders (which is deliberately excluded from preloading)
// rendered a blank glyph; and `trash-outline` was only registered by the cart, so
// withdrawing a review after deep-linking to a product rendered a blank glyph.
//
// Icons are now plain imported data, so registration order cannot matter. Those
// three failures are not "fixed" so much as made structurally impossible — there
// is no registry to get out of sync.

import { LUCIDE_ICON_DATA } from './lucide-icon-data';

export { LUCIDE_ICON_DATA };
export type { IconNode } from './lucide-icon-data';

/**
 * Every icon name the app may reference.
 *
 * This is the whole point of typing `icon` fields as `AppIcon` rather than
 * `string`: a typo, a rename, or a deleted icon becomes a COMPILE error instead
 * of a silently blank glyph. `NavItem.icon`, `Feature.icon` and
 * `OrderStatusMeta.icon` are all retyped to this in their respective files, and
 * `strictTemplates` then checks every binding.
 */
export type AppIcon = keyof typeof LUCIDE_ICON_DATA;

/** Number of icons currently registered. Handy for a smoke test. */
export const APP_ICON_COUNT = Object.keys(LUCIDE_ICON_DATA).length;
