// src/app/shared/components/charts/line-chart.component.ts
// Five-orites Scoop — Revenue trend over time
//
// WHY A NEW COMPONENT
// The app had a horizontal bar chart and a donut, neither of which can show a
// TREND. "Revenue per day" is a time series: the order of the points is the
// entire message, and a bar chart of the same numbers reorders that message
// into "which day was biggest", which is a different question.
//
// SVG rather than a charting library, matching bar-chart and donut-chart. Three
// components' worth of dependency is a lot of bundle to render a polyline, and
// these charts are already the house style.

import { Component, computed, input } from '@angular/core';

export interface LinePoint {
  label: string;
  value: number;
}

@Component({
  selector: 'app-line-chart',
  standalone: true,
  template: `
    @if (hasData()) {
      <figure class="chart">
        <figcaption class="sr-only">
          {{ seriesLabel() }} over time, {{ points().length }} points,
          highest {{ peakText() }}
        </figcaption>

        <svg
          class="plot"
          [attr.viewBox]="'0 0 ' + W + ' ' + H"
          preserveAspectRatio="none"
          role="img"
          [attr.aria-label]="seriesLabel() + ' over time'"
        >
          <!-- Baseline gridlines at 0, 25, 50, 75, 100% of the peak. Four is
               enough to read a level off without turning the plot into graph
               paper. -->
          @for (gy of gridLines(); track gy) {
            <line class="grid" [attr.x1]="0" [attr.x2]="W" [attr.y1]="gy" [attr.y2]="gy" />
          }

          @if (areaPath()) {
            <path class="area" [attr.d]="areaPath()" [class.animated]="animate()" />
          }
          <path class="line" [attr.d]="linePath()" [class.animated]="animate()" />

          @for (p of plotted(); track p.label; let i = $index) {
            <circle
              class="dot"
              [class.is-peak]="i === peakIndex()"
              [attr.cx]="p.x"
              [attr.cy]="p.y"
              r="3"
            >
              <title>{{ p.label }}: {{ format()(p.value) }}</title>
            </circle>
          }
        </svg>

        <!-- Axis labels are HTML, not SVG text: they scale with the page's font
             instead of being stretched by preserveAspectRatio="none", which is
             what makes naive SVG axes unreadable on a phone. -->
        <div class="axis" aria-hidden="true">
          <span class="axis-start">{{ firstLabel() }}</span>
          <span class="axis-end">{{ lastLabel() }}</span>
        </div>

        <p class="peak">
          Best day: <strong>{{ peakText() }}</strong> on {{ peakLabel() }}
        </p>
      </figure>
    } @else {
      <p class="no-data">{{ emptyMessage() }}</p>
    }
  `,
  styles: [`
    :host { display: block; }

    .chart { margin: 0; }

    .plot {
      display: block;
      width: 100%;
      height: 180px;
      overflow: visible;
    }

    .grid {
      stroke: var(--ion-color-light);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }

    .line {
      fill: none;
      stroke: var(--color-brand-primary);
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }

    .area { fill: var(--color-brand-primary); opacity: 0.16; }

    .line.animated, .area.animated { animation: fade 0.5s ease-out both; }

    @keyframes fade {
      from { opacity: 0; }
    }

    .dot { fill: var(--color-brand-primary); stroke: var(--color-white); stroke-width: 1.5; }
    /* The peak is the one point worth looking for first, so it gets a filled
       ring rather than relying on colour alone. */
    .dot.is-peak { fill: var(--color-brand-accent); stroke: var(--color-ink); }

    .axis {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      font-size: 11px;
      color: var(--ion-color-medium);
    }

    .peak {
      margin: 8px 0 0;
      font-size: 12px;
      color: var(--ion-color-medium);
      text-align: center;
    }
    .peak strong { color: var(--color-ink); }

    .no-data {
      margin: 0;
      padding: var(--space-5) 0;
      text-align: center;
      font-size: 14px;
      color: var(--ion-color-medium);
    }

    .sr-only {
      position: absolute;
      width: 1px; height: 1px;
      margin: -1px; padding: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }

    @media (prefers-reduced-motion: reduce) {
      .line.animated, .area.animated { animation: none; }
    }
  `],
})
export class LineChartComponent {
  readonly points = input.required<LinePoint[]>();
  readonly format = input<(value: number) => string>((v) => String(v));
  readonly seriesLabel = input<string>('Revenue');
  readonly emptyMessage = input<string>('No data for this range yet.');
  readonly animate = input<boolean>(true);

  // A fixed internal viewBox; `preserveAspectRatio="none"` lets it stretch to
  // the container. Every stroke carries `vector-effect: non-scaling-stroke` so
  // the line keeps its weight instead of fattening on a wide screen.
  protected readonly W = 320;
  protected readonly H = 100;

  protected readonly hasData = computed(
    () => this.points().length > 0 && this.points().some((p) => Number.isFinite(p.value) && p.value > 0)
  );

  protected readonly peak = computed(() =>
    this.points().reduce((m, p) => Math.max(m, p.value), 0)
  );

  protected readonly peakIndex = computed(() => {
    const pts = this.points();
    let best = -1;
    let bestValue = -Infinity;
    pts.forEach((p, i) => {
      if (p.value > bestValue) { bestValue = p.value; best = i; }
    });
    return best;
  });

  /**
   * X positions spread evenly, Y scaled against the peak with a floor at 1.
   *
   * The floor matters: a flat all-zero series would divide by zero and produce
   * NaN coordinates, which renders as nothing at all rather than as a flat line.
   */
  protected readonly plotted = computed(() => {
    const pts = this.points();
    const peak = Math.max(this.peak(), 1);
    const last = Math.max(pts.length - 1, 1);
    return pts.map((p, i) => ({
      label: p.label,
      value: p.value,
      x: (i / last) * this.W,
      // SVG y grows downward, so the value is inverted against the peak.
      y: this.H - (p.value / peak) * (this.H - 6) - 3,
    }));
  });

  protected readonly linePath = computed(() =>
    this.plotted()
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ')
  );

  /** The same path closed down to the baseline, so the area sits on the axis. */
  protected readonly areaPath = computed(() => {
    const pts = this.plotted();
    if (pts.length < 2) return '';
    const first = pts[0];
    const last = pts[pts.length - 1];
    return `${this.linePath()} L${last.x.toFixed(2)},${this.H} L${first.x.toFixed(2)},${this.H} Z`;
  });

  protected readonly gridLines = computed(() =>
    [0, 0.25, 0.5, 0.75, 1].map((f) => this.H - f * this.H)
  );

  protected readonly firstLabel = computed(() => this.points()[0]?.label ?? '');
  protected readonly lastLabel = computed(
    () => this.points()[this.points().length - 1]?.label ?? ''
  );
  protected readonly peakLabel = computed(
    () => this.points()[this.peakIndex()]?.label ?? ''
  );
  protected readonly peakText = computed(() => {
    const i = this.peakIndex();
    return i >= 0 ? this.format()(this.points()[i].value) : '';
  });
}