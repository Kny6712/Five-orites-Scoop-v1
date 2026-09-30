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
    <div class="banner" [class]="'tone-' + tone()" [attr.role]="tone() === 'danger' || tone() === 'warning' ? 'alert' : 'status'">
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
  styles: [`
    :host { display: block; margin: var(--space-3) var(--space-4); }

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

    .banner-icon { --icon-size: 20px; margin-top: 1px; }

    .banner-body { min-width: 0; flex: 1; }

    .banner-title {
      margin: 0 0 2px;
      font-weight: 800;
      font-size: 14px;
    }

    .banner-text { margin: 0; font-weight: 500; }

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
    .banner-action:hover { background: rgb(255 255 255 / 0.55); }

    /* Tinted surface + a same-hue border, so the tone is legible without
       relying on colour alone — the text states the problem too. */
    .tone-danger { background: #fde8ee; border-color: #f5b8c8; color: #8f1f38; }
    .tone-warning { background: #fff3dc; border-color: #f2d49a; color: #7a4b00; }
    .tone-success { background: #e4f6ea; border-color: #a8d9b8; color: #14622f; }
    .tone-info { background: #e6f1fb; border-color: #a8cbe8; color: #17456f; }
  `],
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
