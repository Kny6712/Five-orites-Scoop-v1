// src/app/shared/components/cart-button/cart-button.component.ts
// Five-orites Scoop — Shared Toolbar Cart Button
// Author: Five-orites Scoop team (see README)

import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IonButton } from '@ionic/angular/standalone';
import { AppIconComponent } from '../app-icon/app-icon.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CartService } from '../../../core/services/cart.service';

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
 * generates none. The `order: 6` is silently discarded, the inner `ion-button`
 * is promoted straight into the toolbar's flex container, and it lands at the
 * initial `order: 0` — ahead of `ion-title` at `order: 3`. The button then
 * renders immediately to the left of the page title instead of hard right,
 * which is exactly where it does not belong.
 *
 * Going through `ion-buttons` avoids all of that: it is a real box, so it keeps
 * `order: 6` and `text-align: end`; `ion-toolbar.componentWillLoad` also finds
 * it via its `querySelectorAll('ion-buttons')` pass and tags it
 * `buttons-last-slot` for the trailing margin. Inside it, `display: contents`
 * is harmless because `ion-buttons` is itself `display: flex` — the promoted
 * `ion-button` is simply a flex item, and nothing inside needs reordering.
 */
@Component({
  selector: 'app-cart-button',
  standalone: true,
  imports: [CommonModule, RouterLink, IonButton, AppIconComponent],
  template: `
    <ion-button
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
    </ion-button>
  `,
  styles: [
    `
      /* Safe here (unlike in the toolbar itself) because the parent ion-buttons
       is a flex container — see the note above. */
      :host {
        display: contents;
      }

      /* ── The redesign, and why ─────────────────────────────────────────────
       The old button was a bare 29px wireframe trolley glyph with a red number
       wedged into its top-right corner, hanging 4px outside the button box. It
       read as two overlapping things rather than one icon, and the number was
       the only saturated colour on a powder-blue toolbar.

       Three changes:
         1. A ShoppingBag glyph instead of ShoppingCart. A wireframe trolley
            reads as a generic commerce icon; a bag is the shape people picture
            when they think about what they are carrying.
         2. The glyph sits in a rounded tile, so the count has a surface to sit
            against and the button has a visible hit area on a pastel toolbar.
         3. The count is a filled pill INSIDE that tile rather than a red bubble
            overlapping the stroke. Nothing overlaps anything now, and the pill
            takes the brand ink instead of the danger red — a cart with two
            things in it is not an error state. */
      .cart-btn {
        --padding-start: 4px;
        --padding-end: 4px;
        --border-radius: var(--radius-sm);
        --background: transparent;
      }

      .cart-icon-wrap {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 38px;
        height: 38px;
        border-radius: var(--radius-sm);
        background: rgb(255 255 255 / 0.55);
        transition: background-color 0.15s ease;
      }

      .cart-btn:hover .cart-icon-wrap {
        background: rgb(255 255 255 / 0.8);
      }
      .cart-btn.has-items .cart-icon-wrap {
        background: var(--color-white);
      }

      .cart-icon {
        --icon-size: 21px;
        color: var(--color-primary-ink);
      }

      .cart-count {
        position: absolute;
        top: -5px;
        right: -5px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        min-width: 19px;
        height: 19px;
        padding: 0 5px;
        font-size: 11px;
        font-weight: 800;
        line-height: 1;
        /* Zeroed because ion-button's .button-native sets letter-spacing, and that
         trailing track lands after the glyph and pushes a flex-centred digit
         left of the pill's true middle. */
        letter-spacing: 0;
        color: var(--color-ink);
        background: var(--color-brand-accent);
        border-radius: 999px;
        /* A ring in the toolbar's own colour so the pill reads as sitting on the
         tile rather than merging into it. */
        box-shadow: 0 0 0 2px var(--color-brand-primary);
        /* Decoration on top of the button — clicks belong to the button, not to
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
