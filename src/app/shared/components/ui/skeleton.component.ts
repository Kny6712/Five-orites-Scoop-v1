// src/app/shared/components/ui/skeleton.component.ts
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-skeleton',
  standalone: true,
  template: `<span
    class="skel"
    [class.line]="variant() === 'line'"
    [class.block]="variant() === 'block'"
    [class.circle]="variant() === 'circle'"
    [style.width]="width()"
    [style.height]="height()"
  ></span>`,
  styles: [
    `
      :host {
        display: inline-block;
      }
      .skel {
        display: inline-block;
        background: linear-gradient(
          90deg,
          var(--ion-color-light) 0%,
          var(--ion-color-light-tint) 50%,
          var(--ion-color-light) 100%
        );
        background-size: 200% 100%;
        animation: skel-shimmer 1.2s linear infinite;
        border-radius: var(--radius-sm);
      }
      .skel.line {
        height: 12px;
        width: 100%;
      }
      .skel.block {
        height: 80px;
        width: 100%;
      }
      .skel.circle {
        border-radius: 50%;
      }
      @keyframes skel-shimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }
      html[data-motion='reduced'] .skel {
        animation: none !important;
      }
    `,
  ],
})
export class SkeletonComponent {
  readonly variant = input<'line' | 'block' | 'circle'>('line');
  readonly width = input<string>('100%');
  readonly height = input<string | null>(null);
}
