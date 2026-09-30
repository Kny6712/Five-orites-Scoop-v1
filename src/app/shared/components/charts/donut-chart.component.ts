// src/app/shared/components/charts/donut-chart.component.ts
// Five-orites Scoop — SVG donut chart
//
// WHY HAND-ROLLED SVG RATHER THAN A CHART LIBRARY
// A donut is a circle with a dasharray. Chart.js would add ~200kb to a bundle
// already at 1.55mb against a 2.2mb budget, and theming it to this palette means
// overriding most of its defaults anyway. The geometry here is about thirty lines
// and has no runtime.
//
// ── How the arc maths works ───────────────────────────────────────────────────
// The technique: draw a full circle, then use stroke-dasharray to reveal only the
// portion we want. `circumference` is 2πr; setting dasharray to
// `arc, circumference` draws the first `arc` units and leaves the rest as gap.
// Rotating the element -90° moves the start to 12 o'clock, because SVG angles
// start at 3 o'clock.
//
// This is exact, has no seam artefacts at the segment joins, and animates by
// transitioning one attribute.

import { Component, computed, input } from '@angular/core';

export interface DonutSlice {
  label: string;
  value: number;
  /** One of the brand hues. */
  tone: 'primary' | 'mint' | 'sunny' | 'danger' | 'neutral';
}

const TONE_FILL: Record<DonutSlice['tone'], string> = {
  primary: 'var(--color-brand-primary)',
  mint: 'var(--color-brand-light)',
  sunny: 'var(--color-brand-accent)',
  danger: 'var(--ion-color-danger)',
  neutral: 'var(--ion-color-medium)',
};

@Component({
  selector: 'app-donut-chart',
  standalone: true,
  template: `
    @if (total() > 0) {
      <div class="donut-wrap">
        <svg
          class="donut"
          [attr.viewBox]="'0 0 ' + SIZE + ' ' + SIZE"
          role="img"
          [attr.aria-label]="ariaLabel()"
        >
          <!-- Track: the unfilled ring behind the segments. -->
          <circle
            class="track"
            [attr.cx]="center"
            [attr.cy]="center"
            [attr.r]="radius"
            fill="none"
            [attr.stroke-width]="thickness"
          />
          @for (seg of segments(); track seg.label) {
            <circle
              class="seg"
              [class.animated]="animate()"
              [attr.cx]="center"
              [attr.cy]="center"
              [attr.r]="radius"
              fill="none"
              [attr.stroke]="seg.fill"
              [attr.stroke-width]="thickness"
              [attr.stroke-dasharray]="seg.dash"
              [attr.stroke-dashoffset]="seg.offset"
            />
          }
        </svg>

        <div class="centre">
          <span class="centre-value">{{ total() }}</span>
          <span class="centre-label">{{ centreLabel() }}</span>
        </div>
      </div>

      <!--
        A real <ul>, not a div of coloured boxes. The chart's meaning has to be
        available to a screen reader, and it cannot be read off a set of arcs.
      -->
      <ul class="legend">
        @for (seg of segments(); track seg.label) {
          <li class="legend-item">
            <span class="swatch" [style.background]="seg.fill" aria-hidden="true"></span>
            <span class="legend-label">{{ seg.label }}</span>
            <span class="legend-value">{{ seg.value }} ({{ seg.percent }}%)</span>
          </li>
        }
      </ul>
    } @else {
      <p class="no-data">{{ emptyMessage() }}</p>
    }
  `,
  styles: [`
    :host { display: block; }

    .donut-wrap {
      position: relative;
      width: 190px;
      height: 190px;
      margin: 0 auto;
    }

    .donut { width: 100%; height: 100%; transform: rotate(-90deg); }

    .track { stroke: var(--ion-color-light); }

    /* Only the dash offset animates, and only from a full offset — animating
       stroke-dasharray itself forces a layout on every frame. */
    .seg {
      transition: stroke-dashoffset 0.5s ease-out;
    }

    .centre {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }

    .centre-value {
      font-family: var(--font-display);
      font-size: 30px;
      font-weight: 600;
      color: var(--color-ink);
      line-height: 1;
    }

    .centre-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--ion-color-medium);
      margin-top: 3px;
    }

    .legend {
      list-style: none;
      margin: var(--space-4) 0 0;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: 13px;
    }

    .swatch {
      width: 12px;
      height: 12px;
      border-radius: 4px;
      flex: 0 0 auto;
    }

    .legend-label {
      flex: 1;
      min-width: 0;
      color: var(--color-ink);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .legend-value {
      font-weight: 700;
      color: var(--ion-color-medium);
      flex: 0 0 auto;
    }

    .no-data {
      margin: 0;
      padding: var(--space-5) 0;
      text-align: center;
      font-size: 14px;
      color: var(--ion-color-medium);
    }
  `],
})
export class DonutChartComponent {
  readonly slices = input.required<DonutSlice[]>();
  readonly centreLabel = input<string>('Total');
  readonly ariaLabel = input<string>('Distribution chart');
  readonly emptyMessage = input<string>('No data yet.');
  readonly animate = input<boolean>(true);

  protected readonly SIZE = 120;
  protected readonly center = 60;
  protected readonly radius = 48;
  protected readonly thickness = 20;

  protected readonly total = computed(() =>
    this.slices().reduce((sum, s) => sum + Math.max(0, s.value), 0)
  );

  /**
   * Per-slice dash and offset.
   *
   * `GAP` is a small angular gap between segments, subtracted from each arc so
   * adjacent colours do not blur together. It is taken off the arc rather than
   * added to the offset, which keeps the ring's total circumference constant and
   * stops the last segment from wrapping past the start.
   */
  protected readonly segments = computed(() => {
    const total = this.total();
    if (total <= 0) return [];

    const circumference = 2 * Math.PI * this.radius;
    const GAP = 1.6;
    let consumed = 0;

    return this.slices()
      .filter((s) => s.value > 0)
      .map((s) => {
        const fraction = s.value / total;
        const arc = Math.max(0, fraction * circumference - GAP);
        const seg = {
          label: s.label,
          value: s.value,
          // Rounded to a whole percent so the legend cannot read "33%" three
          // times and sum to 98% or 101%.
          percent: Math.round(fraction * 100),
          fill: TONE_FILL[s.tone],
          dash: `${arc} ${circumference - arc}`,
          offset: -consumed,
        };
        consumed += fraction * circumference;
        return seg;
      });
  });
}
