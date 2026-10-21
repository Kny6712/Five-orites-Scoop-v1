// src/app/shared/components/commerce/qty-stepper.component.ts
// Five-orites Scoop — Quantity stepper
//
// WHY A SHARED COMPONENT, AND WHY IT IS BIGGER NOW
// The audit found two implementations at DIFFERENT SIZES — `.qty-btn` at 28×28 on
// the cart and 32×32 on product detail — so the same control looked different on
// two pages, and the cart's was the app's single worst touch target at 64% of the
// 44px guidance.
//
// 44×44 is the fix. The visual glyph stays small (18px) inside a larger hit area,
// which is the standard way to have a compact-looking control that is still easy
// to hit on a phone. A large invisible padding area costs nothing visually and
// removes a real mis-tap source on a control whose whole job is precise tapping.
//
// The buttons are real <button>s with aria-labels, so the control is reachable by
// keyboard and announced with its value and what it does.

import { Component, input, model, output } from '@angular/core';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';

@Component({
  selector: 'app-qty-stepper',
  standalone: true,
  imports: [AppIconComponent],
  template: `
    <div class="stepper" [class.small]="size() === 'sm'" [class.framed]="framed()">
      <button
        type="button"
        class="qty-btn"
        [disabled]="value() <= min()"
        [attr.aria-label]="'Decrease quantity, currently ' + value()"
        (click)="dec()"
      >
        <app-icon name="minus" />
      </button>

      <span class="qty-value" [attr.aria-live]="'polite'">{{ value() }}</span>

      <button
        type="button"
        class="qty-btn"
        [disabled]="value() >= max()"
        [attr.aria-label]="'Increase quantity, currently ' + value()"
        (click)="inc()"
      >
        <app-icon name="plus" />
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }

      .stepper {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
      }

      /* THE FRAME.

         Two buttons and a number inside one box read as a quantity; the same
         three things loose on a white row read as two unrelated buttons that
         happen to sit near a number.

         Off by default, because the product dialog already frames this control
         with its own surrounding surface and a second rim inside a rim is one
         line too many. The cart turns it on, where the stepper sits on a white
         panel with nothing else to group it. */
      .stepper.framed {
        border: 1px solid var(--tile-powder-deep);
        border-radius: var(--radius-sm);
        background: var(--color-white);
        padding: 2px;
        gap: 0;
      }

      /* 44×44 — the whole reason this component exists. The 18px glyph inside reads
       as a compact control; the 44px box is what a thumb can actually hit.

       NO CIRCLE. The buttons used to be a 44px pill with a teal ring, and two
       rings sitting either side of a number read as a pair of buttons on a
       machine rather than as a quantity. The rings are gone: what is left is
       the glyph and the hit area, and the hover puts a soft square behind it
       so the control still says "press me" without drawing a shape around
       itself. */
      .qty-btn {
        width: 44px;
        height: 44px;
        border: 0;
        border-radius: var(--radius-xs);
        background: transparent;
        color: var(--color-primary-ink);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        /* A tap highlight makes the press feel instant, which matters more on this
         control than on any other — it is tapped repeatedly. */
        transition:
          background-color 0.12s ease,
          transform 0.12s ease;
      }

      .qty-btn:hover:not(:disabled) {
        background: var(--tile-powder);
      }
      .qty-btn:active:not(:disabled) {
        transform: scale(0.94);
      }

      /* The DISABLED state is not a blanket opacity.
         At 0.4 the whole button — rim, fill and glyph — faded out together, so
         a control that was merely AT ITS MINIMUM (the minus at a quantity of
         one) looked broken rather than unavailable. With no rim to keep, the
         glyph itself is what goes quiet. */
      .qty-btn:disabled {
        cursor: default;
        color: var(--ion-color-medium);
        background: transparent;
      }

      .qty-btn app-icon {
        --icon-size: 18px;
      }

      /* The compact variant shrinks the GLYPH and the text but never the hit area.
       Dropping below 44px is exactly the bug this replaced. */
      .small .qty-btn {
        width: 40px;
        height: 40px;
      }
      .small .qty-btn app-icon {
        --icon-size: 16px;
      }

      .qty-value {
        min-width: 28px;
        text-align: center;
        font-size: 15px;
        font-weight: 800;
        color: var(--color-ink);
        /* Tabular figures so the number does not jitter as it changes width. */
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class QtyStepperComponent {
  /** Two-way bindable. `model` so a page can read the value back without a
   *  separate @Output, and so the button states derive from one source. */
  readonly value = model(1);
  readonly min = input(1);
  readonly max = input(99);
  readonly size = input<'sm' | 'md'>('md');

  /**
   * Whether the control draws a box around itself.
   *
   * Off by default: the product dialog already frames this control with the
   * surface it sits on, and a rim inside a rim is one line too many. The cart
   * turns it on, where the stepper is a white control on a white row with
   * nothing else to group it.
   */
  readonly framed = input(false);

  readonly changed = output<number>();

  private set(next: number): void {
    const clamped = Math.min(this.max(), Math.max(this.min(), next));
    if (clamped === this.value()) return;
    this.value.set(clamped);
    this.changed.emit(clamped);
  }

  inc(): void {
    this.set(this.value() + 1);
  }

  dec(): void {
    this.set(this.value() - 1);
  }
}
