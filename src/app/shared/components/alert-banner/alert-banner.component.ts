// src/app/shared/components/alert-banner/alert-banner.component.ts
// Five-orites Scoop — One banner for every kind of "something went wrong / went right"
//
// WHY A SHARED COMPONENT
// The audit found SIX copies of this idea and FOUR different visual treatments:
//   - `.error-banner` in cart.page.scss and auth.page.scss (red)
//   - inline `style="background:#fde8e8;…"` in dashboard.page.html and
//     analytics.page.html — byte-identical to each other, and duplicating an
//     `.error-banner` rule that already existed elsewhere
//   - inline amber banner in analytics.page.html
//   - `.stock-warning` / `.queue-warning` (identical bodies, different margins)
//
// So a failure could look like a red box on one page and a differently-shaped red
// box on another, and two of them were hardcoded in a `style` attribute where no
// theme token could reach them. One component, one set of tones.
//
// The `role` is deliberate: `danger` and `warning` interrupt, so they announce as
// `role="alert"`. `success` and `info` are confirmations and use `role="status"`
// so they are polite rather than interrupting a screen reader mid-sentence.

import { Component, input, output } from '@angular/core';
import { AppIconComponent } from '../app-icon/app-icon.component';
import type { AppIcon } from '../../../core/icons/app-icons';

export type AlertTone = 'danger' | 'warning' | 'success' | 'info';

const TONE_ICON: Record<AlertTone, AppIcon> = {
  danger: 'circle-alert',
  warning: 'triangle-alert',
  success: 'circle-check',
  info: 'info',
};

@Component({
  selector: 'app-alert-banner',
  standalone: true,
  imports: [AppIconComponent],
  template: `
    <div
      class="banner"
      [class]="'tone-' + tone()"
      [attr.role]="tone() === 'danger' || tone() === 'warning' ? 'alert' : 'status'"
    >
      <app-icon [name]="icon()" class="banner-icon" />
      <div class="banner-body">
        @if (title()) {
          <p class="banner-title">{{ title() }}</p>
        }
        <p class="banner-text">{{ message() }}</p>
        @if (actionLabel()) {
          <button type="button" class="banner-action" (click)="action.emit()">
            {{ actionLabel() }}
          </button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        margin: var(--space-3) var(--space-4);
      }

      .banner {
        display: flex;
        gap: var(--space-3);
        align-items: flex-start;
        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-sm);
        border: 1px solid transparent;
        font-size: 14px;
        line-height: 1.45;
      }

      .banner-icon {
        --icon-size: 20px;
        margin-top: 1px;
      }

      .banner-body {
        min-width: 0;
        flex: 1;
      }

      .banner-title {
        margin: 0 0 2px;
        font-weight: 800;
        font-size: 14px;
      }

      .banner-text {
        margin: 0;
        font-weight: 500;
      }

      /* The retry affordance. A real <button>, so it is reachable by keyboard and
       announced as a control — the "Try again" it replaces was an ion-button
       inside a div, which had no such guarantee. */
      .banner-action {
        margin-top: var(--space-2);
        background: none;
        border: 1px solid currentColor;
        border-radius: var(--radius-pill);
        padding: 6px 14px;
        font: inherit;
        font-weight: 700;
        color: inherit;
        cursor: pointer;
        min-height: 36px;
        transition: background-color 0.15s ease;
      }
      .banner-action:hover {
        background: rgb(255 255 255 / 0.55);
      }

      /* Tinted surface + a same-hue border, so the tone is legible without
       relying on colour alone — the text states the problem too.

       These four triples were the canonical definition of the banner tones, but
       they were written as literals while eleven other files had grown their own
       private copies of the same pastels. They are tokens now: the copies are
       gone, and the high-contrast setting in variables.scss can reach all of
       them at once, which it could not do when each file owned its values. */
      .tone-danger {
        background: var(--tone-danger-bg);
        border-color: var(--tone-danger-border);
        color: var(--tone-danger-ink);
      }
      .tone-warning {
        background: var(--tone-warning-bg);
        border-color: var(--tone-warning-border);
        color: var(--tone-warning-ink);
      }
      .tone-success {
        background: var(--tone-success-bg);
        border-color: var(--tone-success-border);
        color: var(--tone-success-ink);
      }
      .tone-info {
        background: var(--tone-info-bg);
        border-color: var(--tone-info-border);
        color: var(--tone-info-ink);
      }
    `,
  ],
})
export class AlertBannerComponent {
  readonly tone = input<AlertTone>('danger');
  readonly message = input.required<string>();
  /** Optional bold line above the message. */
  readonly title = input<string | null>(null);
  /** When set, renders a retry/action button. */
  readonly actionLabel = input<string | null>(null);
  readonly action = output<void>();

  protected readonly icon = () => TONE_ICON[this.tone()];
}
