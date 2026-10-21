// src/app/shared/components/ui/pagination.component.ts
// Five-orites Scoop — One pager, for every list that has outgrown a scroll
//
// WHY A SHARED COMPONENT
// There was no pagination anywhere in the app before this. Six admin lists
// (dashboard recent orders, inventory, fulfilment, tracking, users, plus the
// analytics tables) each cap their data in a different ad-hoc way — a hard
// `.slice(0, 10)` in one, a service max-results cap in another, and in a third
// case neither, which is how the users list ended up rendering every match.
//
// The component is deliberately dumb: it does not know what it is paginating and
// never touches the source array. The owning page keeps the full list, passes
// `total`, and slices with the `page` this emits. That keeps filtering, sorting
// and counting logic where it already lives instead of moving it into a helper
// that would have to be told about all six shapes.

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IonButton } from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';

/** How many numbered buttons to show either side of the current page. */
const WINDOW = 1;
/** Above this many pages the numbered strip is replaced by a range readout. */
const STRIP_LIMIT = 7;

@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [AppIconComponent, IonButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totalPages() > 1) {
      <nav class="pager" aria-label="Pagination">
        <div class="pager-side">
          <ion-button
            size="small"
            fill="clear"
            class="pager-step"
            [disabled]="page() <= 1"
            (click)="go(page() - 1)"
          >
            <app-icon name="chevron-left" slot="icon-only" />
          </ion-button>
        </div>

        @if (showStrip()) {
          <ol class="pager-pages">
            @if (firstPage() > 1) {
              <li>
                <button type="button" class="pager-num" (click)="go(firstPage())">1</button>
              </li>
              @if (firstPage() > 2) {
                <li class="pager-gap" aria-hidden="true">&hellip;</li>
              }
            }
            @for (p of strip(); track p) {
              <li>
                <button
                  type="button"
                  class="pager-num"
                  [class.is-current]="p === page()"
                  [attr.aria-current]="p === page() ? 'page' : null"
                  [attr.aria-label]="'Page ' + p"
                  (click)="go(p)"
                >
                  {{ p }}
                </button>
              </li>
            }
            @if (lastPage() < totalPages()) {
              @if (lastPage() < totalPages() - 1) {
                <li class="pager-gap" aria-hidden="true">&hellip;</li>
              }
              <li>
                <button type="button" class="pager-num" (click)="go(lastPage())">
                  {{ lastPages() }}
                </button>
              </li>
            }
          </ol>
        } @else {
          <p class="pager-readout">Page {{ page() }} of {{ totalPages() }}</p>
        }

        <div class="pager-side">
          <ion-button
            size="small"
            fill="clear"
            class="pager-step"
            [disabled]="page() >= totalPages()"
            (click)="go(page() + 1)"
          >
            <app-icon name="chevron-right" slot="icon-only" />
          </ion-button>
        </div>
      </nav>
    }

    @if (showRange()) {
      <p class="pager-range">{{ rangeLabel() }}</p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .pager {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        padding: var(--space-3) var(--space-4) 0;
      }

      /* THE PAGER SCROLLS WHEN THE PAGE NUMBERS DO NOT FIT.

         Seven 44px page buttons and two arrows are 320px of buttons plus
         their gaps, and inside a settings panel on a 375px phone there are
         307px of room for them — so the last arrow was cut off by two
         pixels, which is enough to lose a button.

         Scrolling is the honest answer: the pager is wider than the space
         it was given, and the alternative is to shrink the buttons below the
         touch target, which trades a two-pixel clip for something worse.

         The scrollbar is hidden because a visible one under a row of page
         numbers reads as a mistake rather than as an affordance. */
      .pager {
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .pager::-webkit-scrollbar {
        display: none;
      }
      .pager > * {
        flex: 0 0 auto;
      }

      .pager-side {
        display: flex;
      }

      .pager-step {
        --border-radius: var(--radius-pill);
        --padding-start: 10px;
        --padding-end: 10px;
        min-height: 40px;
        min-width: 40px;
        color: var(--color-primary-ink);
      }
      .pager-step:disabled {
        opacity: 0.35;
      }

      .pager-pages {
        display: flex;
        align-items: center;
        gap: 2px;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      /* A real <button>, not a bare number, so each page is reachable by keyboard
       and announces itself. The native list marker is removed by .pager-pages. */
      .pager-num {
        appearance: none;
        background: none;
        border: 1px solid transparent;
        border-radius: var(--radius-xs);
        color: var(--color-ink-soft);
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        min-width: 38px;
        min-height: 38px;
        cursor: pointer;
        transition:
          background-color 0.15s ease,
          color 0.15s ease;
      }
      .pager-num:hover {
        background: var(--tile-powder);
        color: var(--color-primary-ink);
      }

      /* 44x44 ON A PHONE.

         These two set their own min-width and min-height, so the app-wide
         button rule does not reach them — a rule that sets a minimum needs
         the same specificity to replace another minimum.

         38px and 40px are the desktop sizes and they stay the desktop sizes. */
      @media (max-width: 768px) {
        .pager-num {
          min-width: 44px;
          min-height: 44px;
        }
        .pager-step {
          min-width: 44px;
          min-height: 44px;
        }
      }

      /* The current page is marked by a FILL, not by a pastel border. A pastel
       stroke on a white page measures 1.79:1, which is not a state a user can
       see — the fill carries it instead. */
      .pager-num.is-current {
        background: var(--color-brand-primary);
        border-color: var(--color-primary-ink);
        color: var(--color-ink);
      }

      .pager-gap {
        color: var(--ion-color-medium);
        padding: 0 2px;
        font-weight: 700;
      }

      .pager-readout {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        color: var(--ion-color-medium);
      }

      .pager-range {
        margin: var(--space-1) 0 0;
        text-align: center;
        font-size: 12px;
        color: var(--ion-color-medium);
      }
    `,
  ],
})
export class PaginationComponent {
  /** 1-based current page. */
  readonly page = input.required<number>();
  /** Total item count across all pages, not the count on this page. */
  readonly total = input.required<number>();
  /** Items per page. */
  readonly pageSize = input.required<number>();
  /** Noun for the range line, e.g. "flavor variants". */
  readonly itemLabel = input<string>('items');
  /** Set false to hide the "Showing X–Y of Z" line. */
  readonly showRange = input<boolean>(true);

  /** Emits the requested page. The page clamps before emitting. */
  readonly pageChange = output<number>();

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / Math.max(1, this.pageSize()))),
  );

  readonly firstPage = computed(() =>
    Math.max(1, Math.min(this.page() - WINDOW, this.totalPages() - WINDOW * 2)),
  );

  readonly lastPage = computed(() => Math.min(this.totalPages(), this.firstPage() + WINDOW * 2));

  readonly lastPages = computed(() => this.totalPages());

  readonly showStrip = computed(() => this.totalPages() <= STRIP_LIMIT);

  protected readonly strip = computed(() => {
    const from = this.firstPage();
    const to = this.lastPage();
    const pages: number[] = [];
    for (let p = from; p <= to; p++) pages.push(p);
    return pages;
  });

  protected readonly rangeLabel = computed(() => {
    const size = Math.max(1, this.pageSize());
    const start = (this.page() - 1) * size + 1;
    const end = Math.min(this.total(), this.page() * size);
    if (this.total() === 0) return `No ${this.itemLabel()}`;
    return `Showing ${start}\u2013${end} of ${this.total()} ${this.itemLabel()}`;
  });

  protected go(p: number): void {
    const clamped = Math.max(1, Math.min(p, this.totalPages()));
    if (clamped !== this.page()) this.pageChange.emit(clamped);
  }
}
