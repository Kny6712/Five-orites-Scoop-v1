// src/app/shared/components/admin/admin-footer.component.ts
// Five-orites Scoop — The admin pages' footer
//
// A TOOL'S FOOTER, not the shop's.
//
// Every admin page ended with the public footer: the logo, the brand name,
// the tagline, the opening hours, the address, three social discs and the
// copyright. It is a storefront footer inside a working surface, it said
// nothing an admin needs, and on a phone it took 220px of the screen to say
// it — on exactly the pages that are already the longest.
//
// What replaces it is one hairline and one line of text: where you are, the
// copyright, and a way back to the shop. About 44px.
//
// IT IS A SEPARATE COMPONENT rather than a `variant` input on the customer
// footer, because a component with two designs is a component with two sets
// of styles, and only one of them is ever on screen. One component, one
// design.
//
// The customer footer is untouched and keeps the full public block.

import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-admin-footer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <footer class="admin-foot">
      <p class="admin-foot-copy">
        Five-orites Scoop <span class="admin-foot-sep">&middot;</span> Admin
      </p>

      <div class="admin-foot-right">
        <!--
          A way back to the shop. The admin and the storefront are the same app
          and the drawer carries both, so this is a convenience rather than a
          necessity — which is exactly the weight it should carry in the
          layout.
        -->
        <a class="admin-foot-link" routerLink="/products">View shop</a>
        <span class="admin-foot-sep">&middot;</span>
        <span class="admin-foot-copy">&copy; {{ year }}</span>
      </div>
    </footer>
  `,
  styles: [
    `
      /* Block, not display: contents — same reasoning as the customer footer:
         inside ion-content it is an ordinary block at the end of the scroll
         flow, and there is nothing to hoist.

         margin-top: auto is the customer footer's arrangement and it is the
         right one: ion-content's scroll element is a column flexbox, so the
         auto margin absorbs the free space and the footer sits at the bottom
         of the viewport on a short page instead of floating in the middle of
         the cream. */
      :host {
        display: block;
        margin-top: auto;
      }

      /* White surface, one hairline along the top — the app's flat edge, the
         same one the cards and the admin header carry. The customer footer's
         top rule is the lighter --ion-color-light-shade; the admin's is
         --tile-powder-deep, which is the hairline the flat surfaces use. */
      .admin-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        flex-wrap: wrap;

        background: var(--color-white);
        border-top: 1px solid var(--tile-powder-deep);
        margin-top: var(--space-6);
        padding: var(--space-3) var(--space-4);

        font-size: 12px;
        color: var(--ion-color-medium);
      }

      .admin-foot-copy {
        margin: 0;
      }

      .admin-foot-right {
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }

      .admin-foot-sep {
        opacity: 0.55;
      }

      .admin-foot-link {
        font-weight: 700;
        color: var(--color-primary-ink);
        text-decoration: none;
        white-space: nowrap;
      }

      .admin-foot-link:hover {
        text-decoration: underline;
      }
    `,
  ],
})
export class AdminFooterComponent {
  /**
   * The current year, and only the current year.
   *
   * The customer footer shows the range it is entitled to ("2026–2027") because
   * it is the public face of the shop. The admin footer is a line of
   * identification, not a copyright notice, and a year range there would be
   * more precision than the line can carry.
   */
  protected readonly year = new Date().getFullYear();
}
