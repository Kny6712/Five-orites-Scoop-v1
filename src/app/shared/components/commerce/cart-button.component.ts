// src/app/shared/components/commerce/cart-button.component.ts
// Five-orites Scoop — Shared Toolbar Cart Button
// Author: Five-orites Scoop team (see README)

import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CartService } from '@core/services/commerce/cart.service';

/**
 * Cart button for a page toolbar.
 *
 * Usage — wrap it in `ion-buttons` and put *that* in the toolbar's `end` slot:
 *
 * ```html
 * <ion-toolbar color="primary">
 *   <ion-buttons slot="start">
 *     <ion-menu-button></ion-menu-button>
 *   </ion-buttons>
 *   <ion-title>Our Flavors</ion-title>
 *   <ion-buttons slot="end">
 *     <app-cart-button></app-cart-button>
 *   </ion-buttons>
 * </ion-toolbar>
 * ```
 *
 * Do NOT put `slot="end"` on this component's host instead. It is tempting,
 * because `ion-toolbar` is a shadow-DOM component that orders its children
 * with `::slotted([slot=end]) { order: 6 }` — but `order` only applies to a
 * generated box, and `display: contents` (needed here to strip out the wrapper)
 * generates none. The `order: 6` is silently discarded, the inner link is
 * promoted straight into the toolbar's flex container, and it lands at the
 * initial `order: 0` — ahead of `ion-title` at `order: 3`. The button then
 * renders immediately to the left of the page title instead of hard right,
 * which is exactly where it does not belong.
 *
 * Going through `ion-buttons` avoids all of that: it is a real box, so it keeps
 * `order: 6` and `text-align: end`; `ion-toolbar.componentWillLoad` also finds
 * it via its `querySelectorAll('ion-buttons')` pass and tags it
 * `buttons-last-slot` for the trailing margin. Inside it, `display: contents`
 * is harmless because `ion-buttons` is itself `display: flex` — the promoted
 * link is simply a flex item, and nothing inside needs reordering.
 */
@Component({
  selector: 'app-cart-button',
  standalone: true,
  imports: [CommonModule, RouterLink, AppIconComponent],
  template: `
    <a
      [routerLink]="'/cart'"
      [attr.aria-label]="cartLabel()"
      [class.has-items]="itemCount() > 0"
      class="cart-btn"
    >
      <span class="cart-icon-wrap" aria-hidden="true">
        <app-icon name="shopping-bag" class="cart-icon" />
        @if (itemCount() > 0) {
          <span class="cart-count">{{ itemCount() }}</span>
        }
      </span>
    </a>
  `,
  styles: [
    `
      /* Safe here (unlike in the toolbar itself) because the parent ion-buttons
       is a flex container — see the note above. */
      :host {
        display: contents;
      }

      /* ── The flat cart button ───────────────────────────────────────────────
         It was a 29px wireframe trolley with a red number wedged into its
         top-right corner, then a bag glyph in a translucent white tile with a
         gold pill held off that tile by a 2px box-shadow used as a ring.

         All three of the flat language's prohibitions were in that one control:
           1. The translucent tile — rgb(255 255 255 / 0.55) — is a fifth colour
              on the bar. On the flat WHITE header it is worse than decorative:
              55% white on white is white, so the button had no surface at all
              and the glyph floated on the page.
           2. The pill's ring was a box-shadow. A drop shadow doing the work of a
              border paints a soft tinted halo, which cannot be measured, cannot
              be inherited and is the first thing to look like a smudge when the
              surface behind it changes.
           3. Ionic's own button inside a toolbar takes its background from
              --ion-toolbar-color, which on this app's headers is the plum
              ink — a solid slab, not a control.

         So it is a plain anchor now, and the app's quiet control: a white
         square with ONE hairline, a teal glyph, and a count in a gold pill
         that is KNOCKED OUT of the tile with a one-pixel border rather than
         shadowed off it.

         An anchor, not a button: this is navigation to the cart, and a link
         that opens in a new tab and can be middle-clicked is worth more than
         a button's semantics when the whole control is one icon. */
      .cart-btn {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        width: 38px;
        height: 38px;
        padding: 0;
        background: var(--color-white);
        border: 1px solid var(--tile-powder-deep);
        border-radius: var(--radius-sm);
        text-decoration: none;
        cursor: pointer;
        transition: border-color 0.15s ease;
      }

      /* The hairline darkens, the way the select chip's and the export
         button's do. There is no fill to change and no shadow to grow. */
      .cart-btn:hover {
        border-color: var(--color-primary-ink);
      }

      /* 44x44 ON A PHONE.

         This is an anchor, so the app-wide button rule does not reach it —
         and the app-wide rule could not have resized it anyway, because this
         rule sets width and height rather than a minimum, and a min-width
         needs the same specificity to win.

         38px is the desktop size and it stays the desktop size. A cart button
         in the top corner of a phone is the single most-tapped control in the
         app, and 38px is not a target a thumb can find without looking. */
      @media (max-width: 768px) {
        .cart-btn {
          width: 44px;
          height: 44px;
        }
      }

      /* The focus ring the app gives its quiet controls: two pixels of primary
         ink, two pixels off the edge. */
      .cart-btn:focus-visible {
        outline: 2px solid var(--color-primary-ink);
        outline-offset: 2px;
      }

      .cart-icon-wrap {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        /* THE GLYPH'S OWN BOX, not the tile's. The badge is positioned against
           this box, so it sits on the corner of the BAG rather than on the
           corner of the tile — which is what keeps it inside the tile, keeps
           the tile's hairline unbroken, and keeps the badge from ever
           appearing against the striped header behind it. */
        width: 22px;
        height: 22px;
      }

      .cart-icon {
        /* 22px, and a 1.75px STROKE.

           The glyph is Lucide's shopping bag — a stroked outline, like every
           icon in the app — but the app's default stroke is 2.25px, and on a
           20px box that is 11% of the icon's whole width on every line. At
           that weight the bag's rim, its handle and its body merge into one
           solid shape with a notch in it: it stopped being line art and
           became a filled blob, which is the one thing this vocabulary does
           not have.

           1.75px at 22px is the same proportion as 2px at 25px, so the
           drawing is unchanged and the LINES are what changes: the bag reads
           as an outline with a rim and a handle, which is what it is.

           --icon-stroke is the app-icon component's own hook for this, and
           it is a CSS property rather than a fork of the icon data, so the
           vendored Lucide geometry stays untouched. */
        --icon-size: 22px;
        --icon-stroke: 1.75;
        color: var(--color-primary-ink);
      }

      .cart-count {
        position: absolute;
        /* THE DRAWER'S BADGE GEOMETRY, unchanged: the bubble's centre lands
           two pixels in from the icon's top-right corner, so it overlaps the
           corner of the bag and no more. Seven pixels out puts its far edge
           exactly on the tile's inner edge — inside the tile, so the hairline
           stays continuous. */
        top: -7px;
        right: -7px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        font-size: 11px;
        font-weight: 800;
        line-height: 1;
        /* Zeroed because the app sets a letter-spacing on slotted content, and
           that trailing track lands after the digit and pushes a flex-centred
           number left of the pill's true middle. */
        letter-spacing: 0;
        color: var(--color-ink);
        background: var(--color-brand-accent);
        border-radius: 999px;
        /* A ONE-PIXEL KNOCKOUT, not a shadow. The pill is gold and the glyph
           under it is teal, so the edge between them has to be drawn — and a
           border is the only version of that edge that is one pixel of one
           colour and can be asserted against. It is the tile's own colour, so
           the pill reads as sitting ON the bag rather than behind it. */
        border: 1px solid var(--color-white);
        /* Decoration on top of the link — clicks belong to the link, not to
           the number sitting in its corner. */
        pointer-events: none;
      }
    `,
  ],
})
export class CartButtonComponent {
  private cartService = inject(CartService);

  /**
   * Read from the cart here rather than taking it as an `@Input`, so pages only
   * have to drop the tag in. Every page that hand-rolled this button kept its
   * own `cart$` subscription and `cartItemCount` signal, which is what let the
   * button drift out of sync on some screens and go missing on others.
   */
  readonly itemCount = signal(0);

  /**
   * The count is decorative markup sitting inside the button, so it is folded
   * into the accessible name rather than announced on its own — otherwise a
   * screen reader reads the label and the number as two separate things.
   */
  readonly cartLabel = computed(() => {
    const n = this.itemCount();
    return n > 0 ? `View cart, ${n} item${n === 1 ? '' : 's'}` : 'View cart';
  });

  constructor() {
    this.cartService.cart$
      .pipe(takeUntilDestroyed())
      .subscribe((cart) => this.itemCount.set(cart.itemCount));
  }
}
