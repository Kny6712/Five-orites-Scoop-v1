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
    <ion-button [routerLink]="'/cart'" [attr.aria-label]="cartLabel()" class="cart-btn">
      <app-icon name="cart" slot="icon-only" class="cart-icon" />
      @if (itemCount() > 0) {
        <span class="cart-count">{{ itemCount() }}</span>
      }
    </ion-button>
  `,
  styles: [`
    /* Safe here (unlike in the toolbar itself) because the parent ion-buttons
       is a flex container — see the note above. */
    :host { display: contents; }

    /* ion-button's inner .button-native is the positioned ancestor, so the
       count anchors to the clickable box rather than to the glyph. */
    .cart-btn { position: relative; }
    .cart-icon { --icon-size: 29px; }

    /* 29px is what the old icon rendered at. Ionic used to size an
       ion-icon[slot=icon-only] at 1.8em via ::slotted, which cannot reach an
       app-icon -- the new icon is sized by --icon-size, not font-size -- so the
       size is now stated explicitly rather than inherited.
       Inside a button that ion-buttons pads by 8px per side, the glyph's edge
       sits ~8px clear of the button edge, which is what lets the count sit
       mostly outside the cart rather than on top of it. */

    /* A plain span, deliberately not <ion-badge>. ion-badge is a shadow-DOM
       component whose :host sets display:inline-block, font-size:0.8125rem and
       3px vertical padding, so pinning a height on it leaves the digit riding
       high in the bubble — overriding those from a document-level class means
       winning a tree-context cascade against the shadow stylesheet, which is
       fragile and browser-dependent. It also carries contain:content (paint
       containment), which clips at the padding box. A span has neither problem.

       Flex centring is what actually centres the digit: an inline-block with a
       fixed height just parks the line box at the top. box-sizing is stated
       because Ionic resets it globally, which would otherwise treat the height
       as content-box and let the padding skew the bubble. border-radius:999px
       keeps it a true circle for one digit and turns it into a pill for two. */
    .cart-count {
      position: absolute;
      top: 0;
      /* Pushed past the button's padding box, not flush with it. At right:0 the
         ring sat wholly inside the clickable box, which read as a badge
         *attached* to the corner; letting it hang ~4px out puts the bubble's own
         centre on the cart glyph's top-right, matching the reference design. */
      right: -4px;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      /* ion-button's .button-native sets letter-spacing: 0.0335em, which the
         span inherits. That trailing track is added *after* the glyph, so the
         flex-centred text is pushed a couple of pixels left of the bubble's
         true middle. Zeroing it is what actually centres the digit — flex
         centring alone cannot, because the box it centres is already off-centre. */
      letter-spacing: 0;
      color: var(--ion-color-danger-contrast, #ffffff);
      background: var(--ion-color-danger, #c62828);
      border-radius: 999px;
      /* Thin ring in the toolbar's own colour so the bubble reads as sitting on
         top of the cart stroke instead of merging into it. */
      box-shadow: 0 0 0 2px var(--ion-color-primary, #6b3fa0);
      /* Decoration on top of the button — clicks belong to the button, not to
         the number sitting in its corner. */
      pointer-events: none;
    }
  `],
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
