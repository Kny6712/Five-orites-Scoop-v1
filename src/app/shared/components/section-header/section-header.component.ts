// src/app/shared/components/section-header/section-header.component.ts
// Five-orites Scoop — Section heading, with an optional trailing action
//
// WHY A SHARED COMPONENT
// The audit found TEN near-identical "section header" rules under FOUR different
// class names — `.section-header`/`.section-title`, a standalone `.section-title`,
// `.section-heading`, `.form-title`, `.review-section-title` — and four different
// brand-colour choices between them. Same idea, five names, five looks.
//
// `<h3>` rather than a styled div, so the document outline is real: a screen
// reader can jump between sections, which it cannot do with a pile of divs.

import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton } from '@ionic/angular/standalone';

@Component({
  selector: 'app-section-header',
  standalone: true,
  imports: [RouterLink, IonButton],
  template: `
    <div class="section-header">
      <h3 class="section-title">{{ title() }}</h3>
      @if (actionLabel()) {
        <ion-button fill="clear" size="small" class="see-all" [routerLink]="actionLink()">
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

      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        padding: var(--space-4) var(--space-4) var(--space-1);
      }

      .section-title {
        font-family: var(--font-display);
        font-size: 17px;
        font-weight: 600;
        color: var(--color-ink);
        margin: 0;
        min-width: 0;
      }

      .see-all {
        --color: var(--color-primary-ink);
        --border-radius: var(--radius-pill);
        font-weight: 800;
        font-size: 13px;
        flex: 0 0 auto;
      }
    `,
  ],
})
export class SectionHeaderComponent {
  readonly title = input.required<string>();
  /** Trailing action label. Omit for a plain heading. */
  readonly actionLabel = input<string | null>(null);
  readonly actionLink = input<string | null>(null);
}
