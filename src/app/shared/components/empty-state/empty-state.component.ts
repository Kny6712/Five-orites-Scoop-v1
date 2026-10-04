// src/app/shared/components/empty-state/empty-state.component.ts
// Five-orites Scoop — One empty state, with a way out
//
// WHY A SHARED COMPONENT
// The audit found `.empty-state` defined THREE times with conflicting values —
// padding 60px vs 80px, and `.empty-title` carrying a colour in two files and not
// the third — plus a fourth bespoke variant on the cart and a fifth on inventory.
// Five definitions of the same idea, none of them matching.
//
// An empty screen is an invitation to act. So the copy is mandatory and the
// action is optional; there is no way to render a dead-end empty state, only a
// short one.

import { Component, input, output } from '@angular/core';
import { IonButton } from '@ionic/angular/standalone';
import { AppIconComponent } from '../app-icon/app-icon.component';
import type { AppIcon } from '../../../core/icons/app-icons';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [AppIconComponent, IonButton],
  template: `
    <div class="empty" [class.compact]="compact()">
      <span class="empty-glyph">
        <app-icon [name]="icon()" class="empty-icon" />
      </span>
      <h2 class="empty-title">{{ title() }}</h2>
      @if (message()) {
        <p class="empty-text">{{ message() }}</p>
      }
      @if (actionLabel()) {
        <ion-button size="default" class="empty-action" (click)="action.emit()">
          {{ actionLabel() }}
        </ion-button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-7) var(--space-4);
        text-align: center;
      }

      /* The cart's variant was a genuinely tight space (below the fold on a phone),
       so a compact mode exists rather than the size being guessed per page. */
      .empty.compact {
        padding: var(--space-6) var(--space-4);
      }

      .empty-glyph {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 92px;
        height: 92px;
        border-radius: var(--radius-lg);
        background: var(--tile-powder);
        margin-bottom: var(--space-2);
      }
      .empty.compact .empty-glyph {
        width: 68px;
        height: 68px;
      }

      /* The icon sits in a pastel tile rather than being tinted directly: a pastel
       glyph on a cream page measures 1.71:1, which is decoration pretending to be
       an affordance. The tile gives it an edge, and the ink inside is legible. */
      .empty-icon {
        --icon-size: 56px;
        color: var(--color-primary-ink);
      }

      .compact .empty-icon {
        --icon-size: 40px;
      }

      .empty-title {
        font-family: var(--font-display);
        font-size: 19px;
        font-weight: 600;
        color: var(--color-ink);
        margin: var(--space-2) 0 0;
      }

      .empty-text {
        margin: 0;
        font-size: 14px;
        line-height: 1.55;
        color: var(--ion-color-medium);
        /* Keeps a long sentence from stretching the full width of a phone. */
        max-width: 40ch;
      }

      .empty-action {
        --background: var(--color-brand-primary);
        --color: var(--color-ink);
        --border-radius: var(--radius-pill);
        font-weight: 800;
        margin-top: var(--space-3);
        min-height: 46px;
      }
    `,
  ],
})
export class EmptyStateComponent {
  readonly icon = input.required<AppIcon>();
  readonly title = input.required<string>();
  readonly message = input<string | null>(null);
  readonly actionLabel = input<string | null>(null);
  readonly compact = input<boolean>(false);
  readonly action = output<void>();
}
