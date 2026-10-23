// src/app/shared/components/ui/badge.component.ts
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-badge',
  standalone: true,
  template: `<span class="badge" [class]="tone()">{{ text() }}</span>`,
  styles: [
    `
      :host {
        display: inline-block;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: var(--radius-chip);
        font-size: 12px;
        font-weight: 700;
      }
      .success {
        background: var(--tone-success-bg);
        color: var(--tone-success-ink);
        border: 1px solid var(--tone-success-border);
      }
      .warning {
        background: var(--tone-warning-bg);
        color: var(--tone-warning-ink);
        border: 1px solid var(--tone-warning-border);
      }
      .danger {
        background: var(--tone-danger-bg);
        color: var(--tone-danger-ink);
        border: 1px solid var(--tone-danger-border);
      }
      .info {
        background: var(--tone-info-bg);
        color: var(--tone-info-ink);
        border: 1px solid var(--tone-info-border);
      }
      .neutral {
        background: var(--ion-color-light);
        color: var(--color-ink);
      }
    `,
  ],
})
export class BadgeComponent {
  readonly text = input.required<string>();
  readonly tone = input<'success' | 'warning' | 'danger' | 'info' | 'neutral'>('neutral');
}
