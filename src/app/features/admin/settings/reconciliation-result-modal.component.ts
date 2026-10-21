// src/app/features/admin/settings/reconciliation-result-modal.component.ts
// Five-orites Scoop — Stock reconciliation result, shown in a modal after the
// admin runs the check on the admin settings page.
//
// THE FLAT HOUSE. This sheet is the admin side's own vocabulary: a white
// surface with one hairline, solid typography, no drop shadow, no bevel and no
// gradient. Three things carried the old Ionic treatment into it, and all
// three are gone:
//
//   · the sheet's own drop shadow (0 28px 48px rgba(0,0,0,.4)), which Ionic's
//     md modal re-declares from 768px up. It is off now, in global.scss, for
//     every admin sheet;
//   · the CLOSE button, an <ion-button fill="clear"> — uppercase, in the
//     brand hue, with no box to say what it is. It is the app's quiet
//     control now: a white pill, one hairline, a teal label;
//   · the title in the rounded display face, which is the CUSTOMER side's
//     voice. The admin side speaks the plain body face, the same one the flat
//     header's title uses.
//
// The figures are a row of three rather than a run-on sentence. "0 drifted ·
// 260 checked and correct · 4 with no ledger history, not checked · of 264
// stock values in total" is one line of prose that has to be re-read to find
// the number you came for; three labelled figures are read at a glance, and
// the total is a quiet line under them.

import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalController } from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { AlertBannerComponent } from '@shared/components/ui/alert-banner.component';
import { type UnloggedChange } from '@core/services/orders/stock-ledger.service';
import { toCsv, csvFilename } from '@core/logic/csv/cell';
import { CsvExportService } from '@core/services/commerce/csv-export.service';

@Component({
  selector: 'app-reconciliation-result-modal',
  standalone: true,
  imports: [CommonModule, AppIconComponent, AlertBannerComponent],
  template: `
    <div class="sheet">
      <header class="sheet-head">
        <h2 class="sheet-title">Stock integrity</h2>
        <p class="sheet-sub">
          Stored stock compared against the sum of logged movements — what was checked, what agrees,
          and what drifted from the ledger.
        </p>
      </header>

      <div class="stack">
        @if (drift.length > 0) {
          <app-alert-banner
            tone="danger"
            title="Stock does not match the ledger"
            [message]="
              drift.length +
              ' ' +
              (drift.length === 1 ? 'value differs' : 'values differ') +
              ' from the recorded movements. Set the correct quantity from the inventory screen; the ledger is the record of what should have happened.'
            "
          />
        } @else if (verifiedCount === 0) {
          <app-alert-banner
            tone="warning"
            title="Nothing could be checked"
            [message]="
              'All ' +
              totalStockValues +
              ' stock values have no ledger history, so none of them were compared. This is expected for products created before opening movements were recorded — run the baseline script to start tracking them.'
            "
          />
        } @else {
          <app-alert-banner
            tone="success"
            title="Everything checked reconciles"
            [message]="
              'All ' +
              verifiedCount +
              ' checked stock values match their logged movements.' +
              (unverifiableCount
                ? ' ' + unverifiableCount + ' have no ledger history and were NOT checked.'
                : '')
            "
          />
        }

        <!--
          THE FIGURES.

          Three, labelled, in a row on a desktop and a LIST on a phone, and
          the total is a caption inside the same ruled block.

          They are the answer to the question the sheet was opened to
          answer, so they are the most prominent thing on it after the banner
          — and a boxed tile grid would have made them three widgets competing
          with the banner, which is the state the report is actually in.
        -->
        <div class="figures-block">
          <dl class="figures">
            <div class="figure">
              <dt class="figure-label">Drifted</dt>
              <dd class="figure-value" [class.figure-value--bad]="drift.length > 0">
                {{ drift.length }}
              </dd>
            </div>
            <div class="figure">
              <dt class="figure-label">Checked, correct</dt>
              <dd class="figure-value">{{ verifiedCount }}</dd>
            </div>
            <div class="figure">
              <dt class="figure-label">No ledger history</dt>
              <dd class="figure-value">{{ unverifiableCount }}</dd>
            </div>
          </dl>

          @if (totalStockValues > 0) {
            <p class="coverage-note">of {{ totalStockValues }} stock values in total</p>
          }
        </div>

        <p class="ledger-note">
          Checked the most recent {{ scannedRows }} stock movements.
          @if (scannedWindow > 0 && scannedRows >= scannedWindow) {
            The ledger is longer than that, so older movements were not inspected.
          } @else {
            That is the entire ledger so far.
          }
        </p>

        @if (drift.length > 0) {
          <div class="table-wrap">
            <table class="drift-table">
              <caption class="visually-hidden">
                Stock values that disagree with the ledger
              </caption>
              <thead>
                <tr>
                  <th scope="col">Flavor</th>
                  <th scope="col">Size</th>
                  <th scope="col" class="num">Stored</th>
                  <th scope="col" class="num">Ledger</th>
                  <th scope="col" class="num">Drift</th>
                </tr>
              </thead>
              <tbody>
                @for (d of drift; track d.productId + d.size) {
                  <tr>
                    <td>{{ d.variantName }}</td>
                    <td>{{ d.size }}</td>
                    <td class="num">{{ d.stored }}</td>
                    <td class="num">{{ d.logged }}</td>
                    <td class="num drift-num">{{ d.drift > 0 ? '+' : '' }}{{ d.drift }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <button type="button" class="csv-btn" (click)="exportDrift()">
            <app-icon name="file" />Export CSV
          </button>
        }
      </div>

      <div class="actions">
        <button type="button" class="close-btn" (click)="cancel()">Close</button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        /* The sheet fits its content, and scrolls when the content is taller
           than the screen. The modal's own wrapper is --overflow: hidden, so
           without this the bottom of a long report — the drift table — would
           simply be cut off. */
        max-height: min(760px, 92vh);
        overflow-y: auto;
      }

      .sheet {
        padding: var(--space-5);
      }

      /* ON A PHONE, THE SHEET'S INSET IS 16px.

         The sheet's own 24px plus the modal wrapper's 12 left the content
         36px in from the edge of a 390px screen, which is 318px of content
         for a report that is mostly text. 16px is the app's own gutter and
         gives the copy 334px — which is most of the difference between the
         banner's message fitting in three lines and fitting in four. */
      @media (max-width: 619px) {
        .sheet {
          padding: var(--space-4);
        }
      }

      .sheet-head {
        margin-bottom: var(--space-6);
      }

      /* THE PLAIN FACE. The rounded display face is the customer side's
         voice; the admin side speaks the body face, the same one the flat
         header's title uses and the same one this sheet's own body copy
         below is set in. */
      .sheet-title {
        margin: 0;
        font-family: var(--font-body);
        font-size: 20px;
        font-weight: 700;
        color: var(--color-ink);
      }

      .sheet-sub {
        margin: 4px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--color-ink-soft);
        max-width: 62ch;
      }

      .stack {
        display: flex;
        flex-direction: column;
        /* 32px, not 24.

           The sections were 24px apart, and with the banner's own 16px of
           padding that left the gap looking like an accident. 32px is the
           app's own "a step apart" space and it lets each part of the report
           be read on its own. */
        gap: var(--space-6);
      }

      /* THE BANNER IS FULL-WIDTH OF THE SHEET.

         The shared banner carries a 16px margin on its host, which is right
         for a banner dropped straight onto a page. Inside a sheet that
         already has 24px of padding it was insetting the banner a SECOND
         time, and the text was left in 278px where it wrapped to four cramped
         lines.

         A document rule on the host beats the banner's own :host rule, so
         this is how the margin is undone where the margin does not belong. */
      app-alert-banner {
        margin-left: 0;
        margin-right: 0;
      }

      /* THE FIGURES AND THEIR CAPTION, IN ONE RULED BLOCK.

         A rule above them, a rule below the caption, and the caption INSIDE
         the rules — so "of 264 stock values in total" reads as a caption ON the
         figures rather than as a caption that happens to be near them.

         The caption used to be pulled UP into the figures' bottom rule with a
         negative margin, which is where the tight came from: the caption sat
         a hairline's width under the numbers, and the block below it started
         again immediately. */
      .figures-block {
        border-top: 1px solid rgb(61 43 69 / 10%);
        border-bottom: 1px solid rgb(61 43 69 / 10%);
        padding: var(--space-4) 0;
      }

      /* THE FIGURES, as a row divided by hairlines.

         The dividers are inset plum at 10%, the same hairline the cart's rows
         and the orders list use between lines of one card: a rule between
         things in a group, not a box around each thing.

         On a phone they are a LIST instead — see the media query at the end
         of this file. */
      .figures {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        margin: 0;
        padding: 0;
      }

      .figure {
        padding: 0 var(--space-4);
        min-width: 0;

        /* THE LABELS SHARE A LINE AND THE NUMBERS SHARE A LINE.

           The three boxes are the same height — the grid stretches them — but
           their CONTENT was not. "Drifted" is one line and "Checked, correct"
           and "No ledger history" are two, so the numbers were 13px apart:

             DRIFTED          CHECKED,       NO LEDGER
                            CORRECT        HISTORY
             0               0              256      â† the first one rode high

           A row of figures is a row of NUMBERS to compare, so the numbers
           have to share a baseline; and a row of figures is a row of LABELS
           to read, so the labels have to share one too.

           space-between puts the label at the top of the box and the value
           at the bottom, and the slack falls between them. All three labels
           start on the same line and all three numbers end on the same line,
           whatever length the labels are. */
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }

      .figure + .figure {
        border-left: 1px solid rgb(61 43 69 / 10%);
      }

      .figure:first-child {
        padding-left: 0;
      }

      .figure:last-child {
        padding-right: 0;
      }

      .figure-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--color-ink-soft);
      }

      /* Tabular figures, so the three numbers line up on their digits and a
         change in one of them does not shift the others. */
      .figure-value {
        margin: 2px 0 0;
        font-family: var(--font-body);
        font-size: 26px;
        font-weight: 800;
        line-height: 1.1;
        color: var(--color-ink);
        font-variant-numeric: tabular-nums;
      }

      /* Danger only where there IS danger. A zero in the same ink as the other
         two would be a third thing to read; in danger red it says "this is
         the one that is wrong" without a word. */
      .figure-value--bad {
        color: var(--color-danger);
      }

      .coverage-note {
        /* 12px under the figures, and no negative margin.

           It used to be pulled UP into the figures' bottom rule — the caption
           sat a hairline's width from the numbers, which is what made the
           block look tight. It is a caption now, inside the ruled block, with
           room under it. */
        margin: var(--space-3) 0 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--color-ink-soft);
      }

      .ledger-note {
        margin: 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--color-ink-soft);
      }

      .table-wrap {
        overflow-x: auto;
        margin: 12px 0;
      }

      .drift-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        font-size: 13px;
        min-width: 420px;
        /* The app's hairline, not --ion-color-light-shade: that one measures
           1.10:1 on white and the table had no edge at all. */
        border: 1px solid var(--tile-powder-deep);
        border-radius: var(--radius-xs);
        overflow: hidden;
      }

      .drift-table th {
        text-align: left;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: var(--color-ink-soft);
        padding: 8px 10px;
        background: var(--tile-powder);
      }

      /* The same inset plum hairline the rest of the app draws between the
         lines of a card. */
      .drift-table td {
        padding: 8px 10px;
        border-top: 1px solid rgb(61 43 69 / 10%);
        color: var(--color-ink);
      }

      .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .drift-num {
        font-weight: 700;
        color: var(--color-danger);
      }

      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-3);
        /* 32px, not 24 — the footer's rule was crowded against the note
           above it. */
        margin-top: var(--space-6);
        padding-top: var(--space-4);
        border-top: 1px solid rgb(61 43 69 / 10%);
      }

      /* THE APP'S QUIET CONTROL: a white pill, one hairline, a teal label.

         It was an <ion-button fill="clear">, which prints its label in
         uppercase, in the brand hue, with nothing around it to say it is a
         control. This is the same shape the cart's Apply button and the
         order tracker's quiet controls use. */
      .close-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 22px;
        border: 1px solid var(--tile-powder-deep);
        border-radius: var(--radius-pill);
        background: var(--color-white);
        color: var(--color-primary-ink);
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: border-color 0.15s ease;
      }

      .close-btn:hover {
        border-color: var(--color-primary-ink);
      }

      .close-btn:focus-visible {
        outline: 2px solid var(--color-primary-ink);
        outline-offset: 2px;
      }

      /* ── On a phone ───────────────────────────────────────────────────────
         THE FIGURES ARE A LIST, NOT THREE COLUMNS.

         Three columns of 114px, less 16px of padding either side of each,
         left 82px of text — and "CHECKED, CORRECT" is 105px wide. It wrapped
         to two lines, "DRIFTED" did not, and the vertical rules crowded what
         was left of the middle one.

         So on a phone they become what they actually are: three lines of a
         report. The caption on the left, the number on the right, a rule
         BETWEEN the lines rather than between the columns, because they are
         no longer side by side.

             DRIFTED                        0
             ─────────────────────────────
             CHECKED, CORRECT             260
             ─────────────────────────────
             NO LEDGER HISTORY              4

         Nothing wraps, nothing is divided by a vertical rule, every number is
         the same size and every number is right-aligned, and the three read
         as one block instead of three squeezed boxes.

         The desktop keeps the three columns: at 620px and up there is room
         for them side by side, and side by side is how a row of figures
         should be read. */
      @media (max-width: 619px) {
        .figures {
          grid-template-columns: 1fr;
        }

        .figure {
          flex-direction: row;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--space-4);
          padding: var(--space-3) 0;
        }

        /* A rule between the ROWS. The vertical one was for a row of
           columns, and there are no columns here. */
        .figure + .figure {
          border-left: 0;
          border-top: 1px solid rgb(61 43 69 / 10%);
        }

        .figure-value {
          margin: 0;
          font-size: 24px;
        }
      }
    `,
  ],
})
export class ReconciliationResultModalComponent {
  private readonly modalCtrl = inject(ModalController);
  private readonly csvExport = inject(CsvExportService);

  @Input() drift: UnloggedChange[] = [];
  @Input() verifiedCount = 0;
  @Input() unverifiableCount = 0;
  @Input() totalStockValues = 0;
  @Input() scannedRows = 0;
  @Input() scannedWindow = 0;

  cancel(): void {
    void this.modalCtrl.dismiss();
  }

  async exportDrift(): Promise<void> {
    const rows = [
      ['flavor', 'size', 'stored', 'ledger_says', 'drift'],
      ...this.drift.map((d) => [d.variantName, d.size, d.stored, d.logged, d.drift]),
    ];
    await this.csvExport.export(toCsv(rows), csvFilename('stock-reconciliation'));
  }
}
