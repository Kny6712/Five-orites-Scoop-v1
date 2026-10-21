// src/app/shared/components/charts/bar-chart.component.ts
// Five-orites Scoop — Horizontal SVG bar chart
//
// Horizontal rather than vertical because the categories here are FLAVOUR NAMES.
// A vertical bar chart needs either rotated x-axis labels (unreadable on a phone)
// or a truncated label per bar, and "Strawberryfields Forever" truncated to
// "Strawberryfiel…" identifies nothing. Horizontal bars give every label the full
// width it needs and stay legible at 320px.
//
// Bars are sorted descending by the caller, not here, so a page can choose its
// own ordering without fighting the component.

import { Component, computed, input } from '@angular/core';

export interface BarDatum {
  label: string;
  value: number;
  /** Optional right-hand annotation, e.g. "₱1,240". */
  annotation?: string;
  /** Tints the bar and fills its value text when the number is a money figure. */
  tone?: 'primary' | 'mint' | 'sunny';
}

const TONE_FILL: Record<NonNullable<BarDatum['tone']>, string> = {
  primary: 'var(--color-brand-primary)',
  mint: 'var(--color-brand-light)',
  sunny: 'var(--color-brand-accent)',
};

@Component({
  selector: 'app-bar-chart',
  standalone: true,
  template: `
    @if (max() > 0) {
      <ul class="bars">
        @for (bar of bars(); track bar.label; let i = $index) {
          <li class="bar-row">
            <span class="bar-label" [title]="bar.label">{{ bar.label }}</span>
            <div class="bar-track">
              <div
                class="bar-fill"
                [class.animated]="animate()"
                [style.width.%]="bar.percent"
                [style.background]="bar.fill"
              ></div>
            </div>
            <span class="bar-value">{{ bar.valueText }}</span>
            @if (bar.annotation) {
              <span class="bar-note">{{ bar.annotation }}</span>
            }
          </li>
        }
      </ul>
    } @else {
      <p class="no-data">{{ emptyMessage() }}</p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .bars {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-3);
      }

      .bar-row {
        display: grid;
        /* label | track | value | note — the note is on the SAME ROW as the
           value now.

           It used to be pinned to column 3, which put it on a second line under
           the value, and every row of every chart was two lines tall with a
           ragged right edge: the number on one line and its money on the next,
           eight pixels apart. The annotation is the value's other half, so it
           belongs beside it. */
        grid-template-columns: minmax(80px, 34%) 1fr auto auto;
        align-items: center;
        gap: var(--space-2);
      }

      .bar-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-ink);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .bar-track {
        /* 10px tall with a full pill radius: the brief asks for soft, rounded
         shapes, and a square bar reads as a different design language.

         THE TRACK IS A RIMMED RAIL. It was --ion-color-light (#F2F7FA), which
         measures 1.08:1 against a white card — the empty part of the bar was
         invisible, and only the filled part was drawn. Now it is powder with a
         1px hairline in the app's standard rim colour, and the rim carries the
         edge the fill cannot: #E4F1F8 on white is 1.15:1, #9DC2E0 on white is
         1.87:1. */
        height: 10px;
        box-sizing: border-box;
        border: 1px solid var(--tile-powder-deep);
        border-radius: var(--radius-pill);
        background: var(--tile-powder);
        overflow: hidden;
      }

      .bar-fill {
        height: 100%;
        border-radius: var(--radius-pill);
        min-width: 4px;
      }

      .bar-fill.animated {
        /* Grows from zero on first paint. Width is the only animated property, and
         it is a composited-friendly layout change on a fixed-height track. */
        animation: grow 0.45s ease-out both;
      }

      @keyframes grow {
        from {
          width: 0;
        }
      }

      .bar-value {
        font-size: 13px;
        font-weight: 800;
        color: var(--color-ink);
        white-space: nowrap;
      }

      .bar-note {
        grid-column: 4;
        font-size: 12px;
        color: var(--ion-color-medium);
        white-space: nowrap;
      }

      .no-data {
        margin: 0;
        padding: var(--space-5) 0;
        text-align: center;
        font-size: 14px;
        color: var(--ion-color-medium);
      }

      /* Respect the global reduced-motion block: this is one of the animations it
       collapses, so the bars appear at full width rather than never appearing. */
      @media (prefers-reduced-motion: reduce) {
        .bar-fill.animated {
          animation: none;
        }
      }
    `,
  ],
})
export class BarChartComponent {
  readonly data = input.required<BarDatum[]>();
  /** Formats the value shown beside each bar. */
  readonly format = input<(value: number) => string>((v) => String(v));
  readonly emptyMessage = input<string>('No data yet.');
  readonly animate = input<boolean>(true);

  protected readonly max = computed(() => this.data().reduce((m, d) => Math.max(m, d.value), 0));

  protected readonly bars = computed(() => {
    const max = this.max();
    const fmt = this.format();
    if (max <= 0) return [];
    return this.data().map((d) => ({
      label: d.label,
      value: d.value,
      valueText: fmt(d.value),
      annotation: d.annotation,
      fill: TONE_FILL[d.tone ?? 'primary'],
      // Clamped to 100 so a lone maximum bar fills its track exactly rather than
      // overflowing by a rounding error.
      percent: Math.min(100, (d.value / max) * 100),
    }));
  });
}
