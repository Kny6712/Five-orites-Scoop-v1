// src/app/shared/components/app-footer/app-footer.component.ts
// Five-orites Scoop — Site footer, on every page
//
// ── Why it lives in a shared component ────────────────────────────────────────
// There was no footer anywhere in the app. The only element named one was a
// page-scoped credit block on Developers, and the only <ion-footer> was the
// action bar inside an admin modal. Every page simply ended at its last card.
//
// ── WHERE IT SITS, AND WHY IT CHANGED ─────────────────────────────────────────
// This used to be a flex SIBLING of <ion-content> — the last child of the page's
// own ion-page — which pinned it to the bottom of the viewport on every page. It
// is now the LAST CHILD INSIDE <ion-content>, so it scrolls away with the page
// and is only reached at the end, like an ordinary web footer.
//
// The change was made because the footer grew. Pinned, this layout is a
// meaningful slice of a phone screen taken permanently, on exactly the pages
// that are already the longest. Scroll-away costs nothing while reading.
//
// If this ever goes back to being a flex sibling, note that:
//
//   1. `ion-content` is position: relative, and its .inner-scroll is absolutely
//      positioned with a NEGATIVE bottom offset:
//          .inner-scroll { bottom: calc(var(--offset-bottom) * -1) }
//      Ionic's readDimensions() computes --offset-bottom as the page height
//      minus the content's own box, which is EXACTLY the footer's height. So a
//      pinned footer is permanently overlapped by about its own height of scroll
//      area, and being positioned that scroll area paints ABOVE an in-flow
//      sibling. The footer would need position: relative and a z-index to win
//      the paint order. This stylesheet deliberately does not carry them,
//      because a rule whose comment no longer explains a real hazard is worse
//      than no rule.
//
//   2. Deleting the page-level ":host { display: block }" rules was a separate,
//      earlier bug: they tied on specificity with .ion-page and won on document
//      order, so ion-content fell back from flex:1 to height:100% and the footer
//      rendered below the viewport entirely. Ionic already sets the page host to
//      display: flex. See the guard in tests/logic.test.ts.
//
// ── What is in it ──────────────────────────────────────────────────────────────
// Three columns: who we are, when we are open, where to find us. Then a centred
// row of social links and the copyright. No nav links — the side menu already
// carries those, and repeating them here said nothing new.

import { Component } from '@angular/core';

import { SHOP_FOUNDED_YEAR, SHOP_HOURS, SHOP_LOCATION } from '../../../core/config/shop.config';

interface SocialLink {
  /** Network name, used for the accessible name only. */
  readonly label: string;
  readonly href: string;
}

@Component({
  selector: 'app-footer',
  standalone: true,
  template: `
    <footer class="site-foot">
      <div class="foot-top">
        <div class="foot-brand">
          <img
            src="/assets/images/logo-ice_cream.png"
            alt=""
            class="foot-logo"
            aria-hidden="true"
          />
          <div class="foot-brand-text">
            <span class="foot-name">Five-orites Scoop</span>
            <span class="foot-tag">Premium ice cream, scooped to your door</span>
          </div>
        </div>

        <!--
          The schedule as a label/value grid rather than two strings.

          font-variant-numeric: tabular-nums on the values is what makes the
          "9:00" and "10:00" start in the same column instead of looking ragged,
          and the clock spans both rows rather than repeating beside each one.
        -->
        <div class="foot-hours">
          <svg
            class="foot-ico foot-hours-lead"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span class="foot-hours-label">Weekdays</span>
          <span class="foot-hours-value">{{ weekdays }}</span>
          <span class="foot-hours-label">Weekends</span>
          <span class="foot-hours-value">{{ weekends }}</span>
        </div>

        <div class="foot-place">
          <svg class="foot-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"
            />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <div class="foot-place-text">
            <span class="foot-address">{{ address }}</span>
            <a class="foot-map" [href]="mapsUrl" target="_blank" rel="noopener noreferrer">
              Open in Maps
            </a>
          </div>
        </div>
      </div>

      <div class="foot-bottom">
        <!--
          PLACEHOLDER HANDLES. The shop has no accounts on any of these networks
          and there is no Instagram, Facebook or email address anywhere in the
          repository to link to, so these resolve to plausible-looking URLs that
          go nowhere. Replace them with the real accounts before this ships, or
          delete the entries — a dead link in the one place a customer would
          expect to be able to reach you is worse than no link.

          The glyphs are inline SVG rather than <app-icon>. Lucide is a
          deliberately brand-free set: LUCIDE_ICON_DATA has no instagram or
          facebook key, and hand-adding one to a file whose header reads
          "generated, do not hand-edit" would be silently undone by the next
          icons:generate run. They are therefore local to the one component that
          uses them. mail IS in the vocabulary but is inline here too, so all
          three marks share one loop and one set of styles.

          NOTE: these comments are deliberately free of backticks. They live
          inside a TypeScript template literal, and a backtick here ends the
          string. That mistake was made and cost a build once already. -->
        <ul class="foot-social">
          @for (social of socials; track social.label) {
            <li>
              <a
                class="foot-social-link"
                [href]="social.href"
                [attr.aria-label]="social.label"
                target="_blank"
                rel="noopener noreferrer"
              >
                @switch (social.label) {
                  @case ('Instagram') {
                    <svg class="foot-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <rect x="2" y="2" width="20" height="20" rx="5" />
                      <circle cx="12" cy="12" r="4" />
                      <circle cx="17.5" cy="6.5" r="1" class="foot-ico-fill" />
                    </svg>
                  }
                  @case ('Facebook') {
                    <svg class="foot-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
                    </svg>
                  }
                  @default {
                    <svg class="foot-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                    </svg>
                  }
                }
              </a>
            </li>
          }
        </ul>

        <p class="foot-copy">
          &copy; {{ copyrightYears }} Five-orites Scoop &middot; Est. {{ foundedYear }}
        </p>
      </div>
    </footer>
  `,
  styles: [
    `
      /* Block, not display: contents. The footer used to be a flex item of
         ion-page, where display: contents was what let it become chrome at all.
         Inside ion-content it is an ordinary block at the end of the scroll flow,
         and there is nothing to hoist. */
      :host {
        display: block;
        margin-top: auto;
      }

      .site-foot {
        background: var(--color-white);
        border-top: 1px solid var(--ion-color-light-shade);
        margin-top: var(--space-6);
        padding: var(--space-5) var(--space-4) var(--space-4);
      }

      .foot-top {
        max-width: var(--container-max);
        margin: 0 auto;
        display: grid;
        grid-template-columns: 1.25fr 1fr 1fr;
        gap: var(--space-5);
        align-items: center;
      }

      /* ── Column 1: who we are ─────────────────────────────────────────── */
      .foot-brand {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        min-width: 0;
      }

      .foot-logo {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        flex: 0 0 auto;
        /* The logo art is a circle on a transparent square. cover is a no-op
           against a square source in a square box, but it keeps this honest if
           the art is ever swapped for a non-square one. */
        object-fit: cover;
      }

      .foot-brand-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .foot-name {
        /* Retro, matching the other brand-title strings. Stated explicitly
           because this is an <h2>-ish block, not a heading element, and would
           otherwise inherit the body face from .site-foot.

           700, where this used to be 600. Lobster Two ships only 700, so a 600
           request is not honoured by the font — the browser synthesises the
           extra weight by smearing the outlines, which on a script face fills in
           the counters. It looks bolder and worse at the same time.

           NO display-scale shadow here: 0.06em is 1.08px at 18px, which is a third of the
           weight it has on the About hero at 36px and reads as "black text" rather
           than as a decal. --display-sticker-shadow-small is 0.09em, which lands at
           1.62px — the same absolute weight as the display strings, deliberately
           on the subtle end.

           It is applied on WHITE, which is a departure from the rule the other
           sites follow, and it is safe: the gold lands under the glyph, where
           plum on gold measures 8.16:1 — better than the 13.10:1 it replaces is
           irrelevant because the shadow only covers part of the backdrop. The
           gold's own edge against white is 1.58:1, asserted in check-contrast.mjs
           as decorative. It reads as a warm edge rather than a sticker, which is
           the intent at this size. */
        font-family: var(--font-display-retro);
        font-weight: 700;
        font-size: 18px;
        color: var(--color-ink);
        line-height: 1.2;
        text-shadow: var(--display-sticker-shadow-small);

        /* .foot-brand-text is a flex column with NO gap, and .foot-name had no
           margin, so clearance to .foot-tag below was exactly 0px — the only
           zero-clearance brand string left in the app. Now that the name carries
           a 1.62px downward shadow, that 0px would put gold on the tagline.
           --space-1 is 4px, which clears it and stays visually quiet. */
        margin: 0 0 var(--space-1);
      }

      .foot-tag {
        font-size: 13px;
        color: var(--ion-color-medium);
        line-height: 1.35;
      }

      /* ── Column 2: the schedule ───────────────────────────────────────── */
      /* Icon | label | value, with the icon spanning both rows. Tabular figures
         on the values are the whole point: without them "9:00" and "10:00" start
         in different columns and the pair reads as ragged rather than aligned. */
      .foot-hours {
        display: grid;
        grid-template-columns: auto auto 1fr;
        gap: 3px var(--space-2);
        align-items: center;
        justify-content: center;
      }

      .foot-hours-lead {
        grid-column: 1;
        grid-row: 1 / 3;
      }

      .foot-hours-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-ink-soft);
        white-space: nowrap;
      }

      .foot-hours-value {
        font-size: 13px;
        font-weight: 700;
        color: var(--color-ink);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      /* ── Column 3: where to find us ───────────────────────────────────── */
      .foot-place {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2);
        justify-content: flex-end;
      }

      .foot-place-text {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        min-width: 0;
      }

      .foot-address {
        font-size: 13px;
        color: var(--ion-color-medium);
        line-height: 1.4;
        text-align: right;
      }

      .foot-map {
        font-size: 13px;
        font-weight: 700;
        color: var(--color-primary-ink);
        text-decoration: none;
        white-space: nowrap;
      }
      .foot-map:hover {
        text-decoration: underline;
      }

      .foot-ico {
        width: 17px;
        height: 17px;
        flex: 0 0 auto;
        color: var(--color-primary-ink);
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      /* Instagram's centre dot is a filled circle, not a stroked ring. */
      .foot-ico-fill {
        fill: currentColor;
        stroke: none;
      }

      /* ── Centred block below the rule ─────────────────────────────────── */
      .foot-bottom {
        max-width: var(--container-max);
        margin: var(--space-5) auto 0;
        padding-top: var(--space-4);
        border-top: 1px solid var(--ion-color-light-shade);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-3);
      }

      .foot-social {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        list-style: none;
        margin: 0;
        padding: 0;
      }

      /* A tinted disc rather than a bare glyph, matching the icon wells used
         across the app (see .feature-icon-wrap on About). */
      .foot-social-link {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: var(--tile-powder);
        color: var(--color-primary-ink);
        transition: background 0.15s ease;
      }
      .foot-social-link:hover {
        background: var(--tile-mint);
      }

      .foot-copy {
        margin: 0;
        font-size: 12px;
        color: var(--ion-color-medium);
        text-align: center;
      }

      /* ── Narrow ────────────────────────────────────────────────────────── */
      /* Three columns cannot hold this much type below ~760px. Centred and
         stacked rather than left-aligned and ragged. */
      @media (max-width: 760px) {
        .site-foot {
          padding: var(--space-4) var(--space-3);
        }
        .foot-top {
          grid-template-columns: 1fr;
          justify-items: center;
          gap: var(--space-4);
        }
        .foot-hours {
          justify-content: start;
        }
        .foot-place {
          justify-content: center;
        }
        .foot-place-text {
          align-items: center;
        }
        .foot-address {
          text-align: center;
        }
        .foot-tag {
          text-align: center;
        }
      }
    `,
  ],
})
export class AppFooterComponent {
  protected readonly year = new Date().getFullYear();
  protected readonly foundedYear = SHOP_FOUNDED_YEAR;

  /**
   * The founding year, widened to a range once the calendar moves past it.
   *
   * `2026` in the founding year, `2026-2027` after. Never `2026-2026`, which is
   * what a naive `${founded}-${now}` produces for the whole first year and is
   * why this is not just an interpolation. Read once at construction, like
   * `year`: a page open across midnight on New Year's Eve is not a case worth
   * a signal.
   */
  protected readonly copyrightYears =
    this.year > this.foundedYear ? `${this.foundedYear}–${this.year}` : `${this.foundedYear}`;

  protected readonly address = SHOP_LOCATION.address;
  protected readonly mapsUrl = SHOP_LOCATION.mapsUrl;
  protected readonly weekdays = SHOP_HOURS.weekdays;
  protected readonly weekends = SHOP_HOURS.weekends;

  /** See the PLACEHOLDER note in the template. */
  protected readonly socials: readonly SocialLink[] = [
    { label: 'Instagram', href: 'https://instagram.com/fiveoritesscoop' },
    { label: 'Facebook', href: 'https://facebook.com/fiveoritesscoop' },
    { label: 'Email', href: 'mailto:hello@fiveoritesscoop.com' },
  ];
}
