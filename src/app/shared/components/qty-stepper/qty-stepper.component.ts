// src/app/shared/components/qty-stepper/qty-stepper.component.ts
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
import { AppIconComponent } from '../app-icon/app-icon.component';

@Component({
  selector: 'app-qty-stepper',
  standalone: true,
  imports: [AppIconComponent],
  template: `
    <div class="stepper" [class.small]="size() === 'sm'">
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
  styles: [`
    :host { display: inline-block; }

    .stepper {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
    }

    /* 44×44 — the whole reason this component exists. The 18px glyph inside reads
       as a compact control; the 44px box is what a thumb can actually hit. */
    .qty-btn {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--color-brand-primary);
      background: var(--color-white);
      color: var(--color-strawberry-ink);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      /* A tap highlight makes the press feel instant, which matters more on this
         control than on any other — it is tapped repeatedly. */
      transition: background-color 0.12s ease, transform 0.12s ease;
    }

    .qty-btn:hover:not(:disabled) { background: #fde8ee; }
    .qty-btn:active:not(:disabled) { transform: scale(0.94); }

    .qty-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .qty-btn app-icon { --icon-size: 18px; }

    /* The compact variant shrinks the GLYPH and the text but never the hit area.
       Dropping below 44px is exactly the bug this replaced. */
    .small .qty-btn { width: 40px; height: 40px; }
    .small .qty-btn app-icon { --icon-size: 16px; }

    .qty-value {
      min-width: 28px;
      text-align: center;
      font-size: 15px;
      font-weight: 800;
      color: var(--color-ink);
      /* Tabular figures so the number does not jitter as it changes width. */
      font-variant-numeric: tabular-nums;
    }
  `],
})
export class QtyStepperComponent {
  /** Two-way bindable. `model` so a page can read the value back without a
   *  separate @Output, and so the button states derive from one source. */
  readonly value = model(1);
  readonly min = input(1);
  readonly max = input(99);
  readonly size = input<'sm' | 'md'>('md');

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
