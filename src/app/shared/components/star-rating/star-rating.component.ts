// src/app/shared/components/star-rating/star-rating.component.ts
// Five-orites Scoop — Interactive Star Rating Component

import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { AppIcon } from '../../../core/icons/app-icons';
import { AppIconComponent } from '../app-icon/app-icon.component';

@Component({
  selector: 'app-star-rating',
  standalone: true,
  imports: [CommonModule, AppIconComponent],
  template: `
    <!-- Non-interactive: role="img" so the wrapper's aria-label is actually
         exposed — a bare div has no role, so the label was never announced.
         Interactive: the wrapper is a group of its own controls, so it drops
         role/aria-label and leaves naming to the per-star buttons, which
         already say "Rate N stars". -->
    <div
      class="stars-wrap"
      [attr.role]="interactive ? null : 'img'"
      [attr.aria-label]="interactive ? null : 'Rating: ' + rating + ' out of 5'"
    >
      @for (i of starIndices; track i) {
        <!-- Focus/blur mirror mouseenter/mouseleave: without them the hover
             preview is mouse-only and a keyboard user cannot see what they are
             about to pick before committing. -->
        <app-icon
          [name]="getStarName(i)"
          class="star"
          [class.interactive]="interactive"
          [class.active]="i <= (hovered() || rating)"
          [attr.role]="interactive ? 'button' : null"
          [attr.tabindex]="interactive ? 0 : null"
          [attr.aria-pressed]="interactive ? rating === i : null"
          [attr.aria-label]="interactive ? 'Rate ' + i + ' star' + (i > 1 ? 's' : '') : null"
          (mouseenter)="interactive && hovered.set(i)"
          (mouseleave)="interactive && hovered.set(0)"
          (focus)="interactive && hovered.set(i)"
          (blur)="interactive && hovered.set(0)"
          (click)="interactive && ratingChange.emit(i)"
          (keydown.enter)="interactive && ratingChange.emit(i)"
          (keydown.space)="interactive && onStarKey(i, $event)"
        />
      }
      @if (showCount && reviewCount !== undefined) {
        <span class="review-count">({{ reviewCount }})</span>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }
      .stars-wrap {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .star {
        --icon-size: 18px;
        --icon-stroke: 2;
        color: #d0d0d0;
        transition: color 0.1s ease;
      }
      /* Lucide has one star glyph, outline-style, for both states. Filling it with
       currentColor is what produces a solid star, and it inherits the active
       colour from .star.active -- so no second icon is needed. */
      .star.active {
        color: var(--color-brand-accent);
      }
      .star.active svg {
        fill: currentColor;
      }
      .star.interactive {
        cursor: pointer;
      }
      .star.interactive:focus-visible {
        outline: 2px solid var(--color-brand-accent);
        outline-offset: 2px;
        border-radius: 4px;
      }
      .review-count {
        font-size: 13px;
        color: var(--ion-color-medium);
        margin-left: 4px;
      }
    `,
  ],
})
export class StarRatingComponent {
  @Input() rating: number = 0;
  @Input() interactive: boolean = false;
  @Input() showCount: boolean = false;
  @Input() reviewCount?: number;
  @Output() ratingChange = new EventEmitter<number>();

  hovered = signal(0);
  starIndices = [1, 2, 3, 4, 5];

  /**
   * Space on a star commits the rating, and stops the page from scrolling under
   * the focused star. Kept in a method so the template handler stays a single
   * expression and the keydown result is discarded for the Enter path.
   */
  onStarKey(index: number, event: Event): void {
    if (!this.interactive) return;
    event.preventDefault();
    this.ratingChange.emit(index);
  }

  /**
   * Two names, not three. ionicons had a separate `star-outline`; Lucide's star
   * is outline by default and is filled with CSS when active, so the outline
   * state is simply the absence of `.active`.
   */
  getStarName(index: number): AppIcon {
    const effective = this.hovered() || this.rating;
    if (index - 0.5 <= effective && index > Math.floor(effective)) return 'star-half';
    if (index <= Math.floor(effective)) return 'star';
    return 'star';
  }
}
