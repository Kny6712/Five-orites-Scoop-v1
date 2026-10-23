// src/app/shared/components/ui/error-state.component.ts
import { Component, input, output } from '@angular/core';
import { IonButton } from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import type { AppIcon } from '@core/icons/app-icons';

@Component({
  selector: 'app-error-state',
  standalone: true,
  imports: [AppIconComponent, IonButton],
  template: `
    <div class="error">
      <span class="error-glyph"><app-icon [name]="icon()" class="error-icon" /></span>
      <h2 class="error-title">{{ title() }}</h2>
      @if (message()) {
        <p class="error-text">{{ message() }}</p>
      }
      @if (retryLabel()) {
        <ion-button size="default" class="error-action" (click)="retry.emit()">
          {{ retryLabel() }}
        </ion-button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .error {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-7) var(--space-4);
        text-align: center;
      }
      .error-glyph {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 92px;
        height: 92px;
        border-radius: var(--radius-lg);
        background: var(--tone-danger-bg);
        margin-bottom: var(--space-2);
      }
      .error-icon {
        --icon-size: 56px;
        color: var(--tone-danger-ink);
      }
      .error-title {
        font-family: var(--font-display);
        font-size: 19px;
        font-weight: 600;
        color: var(--color-ink);
        margin: var(--space-2) 0 0;
      }
      .error-text {
        margin: 0;
        font-size: 14px;
        line-height: 1.55;
        color: var(--ion-color-medium);
        max-width: 40ch;
      }
      .error-action {
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
export class ErrorStateComponent {
  readonly icon = input<AppIcon>('circle-alert');
  readonly title = input.required<string>();
  readonly message = input<string | null>(null);
  readonly retryLabel = input<string | null>('Try again');
  readonly retry = output<void>();
}
