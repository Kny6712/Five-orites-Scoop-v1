// src/app/shared/components/app-icon/app-icon.component.ts
// Five-orites Scoop — The app's single icon surface
//
// ── Why a wrapper instead of writing SVG inline at each call site ─────────────
// 1. SIZING. `ion-icon` is a font glyph: it is sized by `font-size` and inherits
//    `color` from the text. Inline SVG has no relationship to font-size, so a
//    1:1 migration would have silently broken all ~19 `font-size: Npx` icon
//    rules in the app's SCSS. This component keeps the familiar model by reading
//    its size from a `--icon-size` custom property, which makes the migration a
//    rename — `.kpi-icon { font-size: 24px }` becomes `.kpi-icon { --icon-size:
//    24px }` — rather than a rewrite of every call site.
//
// 2. ACCESSIBILITY. An icon with no accessible name is decoration and must be
//    hidden from assistive tech; one that IS the label must not be. Getting that
//    right by hand at 60 call sites is how it goes wrong, so the default here is
//    `aria-hidden="true"` and opting in is a single `title` input.
//
// 3. GEOMETRY. Lucide icons are `path`/`circle`/`rect`/`line`/`polygon`/
//    `polyline` nodes. Repeating that switch 60 times would be unmaintainable,
//    so it lives here once. See lucide-icon-data.ts for why the geometry is
//    vendored rather than imported from a package.
//
// Usage:
//   <app-icon name="cart" />                    20px by CSS class
//   <app-icon name="receipt" iconSize="28" />    explicit size
//   <app-icon name="home" title="Home" />       named (so NOT hidden)

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LUCIDE_ICON_DATA, type AppIcon } from '../../../core/icons/app-icons';

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      [style.width]="sizePx()"
      [style.height]="sizePx()"
      [attr.aria-hidden]="title() ? null : 'true'"
      [attr.role]="title() ? 'img' : null"
      focusable="false"
    >
      @if (title(); as t) {
        <title>{{ t }}</title>
      }
      @for (node of nodes(); track $index) {
        @switch (node[0]) {
          @case ('path') {
            <path [attr.d]="node[1]['d']" />
          }
          @case ('circle') {
            <circle [attr.cx]="node[1]['cx']" [attr.cy]="node[1]['cy']" [attr.r]="node[1]['r']" />
          }
          @case ('rect') {
            <rect
              [attr.x]="node[1]['x']"
              [attr.y]="node[1]['y']"
              [attr.width]="node[1]['width']"
              [attr.height]="node[1]['height']"
              [attr.rx]="node[1]['rx']"
              [attr.ry]="node[1]['ry']"
            />
          }
          @case ('line') {
            <line
              [attr.x1]="node[1]['x1']"
              [attr.x2]="node[1]['x2']"
              [attr.y1]="node[1]['y1']"
              [attr.y2]="node[1]['y2']"
            />
          }
          @case ('polyline') {
            <polyline [attr.points]="node[1]['points']" />
          }
          @case ('polygon') {
            <polygon [attr.points]="node[1]['points']" />
          }
        }
      }
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* An icon must not contribute line-box leading, or every flex row of text
           around it shifts down by a few pixels. */
        line-height: 0;
        flex: 0 0 auto;
        color: inherit;
      }

      svg {
        width: var(--icon-size, 20px);
        height: var(--icon-size, 20px);
        /* Lucide's default stroke is 2. A slightly heavier 2.25 reads friendlier
           at the small sizes this app uses most, and it is a CSS property, so it
           overrides without forking a single icon. */
        stroke-width: var(--icon-stroke, 2.25);
      }
    `,
  ],
})
export class AppIconComponent {
  /** Icon name. Typed as `AppIcon`, so a typo is a compile error. */
  readonly name = input.required<AppIcon>();

  /**
   * Explicit pixel size. Leave null to inherit `--icon-size` from CSS, which is
   * how most call sites size icons (via a class).
   */
  readonly size = input<number | null>(null, { alias: 'iconSize' });

  /**
   * Accessible name. Supplying one makes the icon visible to assistive tech;
   * omitting it marks the icon decorative.
   */
  readonly title = input<string | null>(null);

  /**
   * Resolved geometry. `name` is an `AppIcon`, so the lookup cannot be undefined
   * — but an empty array is still handled, because an empty `<svg>` is
   * invisible rather than an exception, and that is the failure mode worth
   * surviving.
   */
  protected readonly nodes = computed(() => LUCIDE_ICON_DATA[this.name()] ?? []);

  /**
   * Inline size, or null so the stylesheet's `var(--icon-size, 20px)` wins.
   * Returning null rather than a default is what lets the cascade size the icon
   * in the common case.
   */
  protected readonly sizePx = computed(() => {
    const s = this.size();
    return s == null ? null : `${s}px`;
  });
}
