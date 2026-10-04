// src/app/admin/inventory/csv-import-modal.component.ts
// Five-orites Scoop — bulk CSV import, as a modal
//
// WHY A MODAL. This panel used to live at the BOTTOM of the inventory page,
// after the product grid and the pagination, behind a trigger near the top of the
// viewport. So tapping "Import CSV" changed something roughly 1,500px below the
// fold: nothing appeared to happen, and a first-time user had no way to guess
// where the bulk-import UI had gone. Presented as a modal it opens in the centre
// of the screen, next to the finger that asked for it.
//
// The three-state flow is unchanged — pick a file, read the errors, confirm the
// write — and so is its all-or-nothing contract: `parseProductCsv` returns zero
// valid rows if any row fails, so there is no partial-import state to design for.
//
// It owns its state rather than receiving it. The page passes only the existing
// product ids, which the CSV parser needs to report a row that would silently
// overwrite a live flavour, and gets back `{ imported, failures }` on dismiss so
// it can refresh exactly when something actually changed.

import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';

import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { InventoryService } from '../../core/services/inventory.service';
import { CsvExportService } from '../../core/services/csv-export.service';
import {
  parseProductCsv,
  PRODUCT_CSV_TEMPLATE,
  type ImportPlan,
} from '../../core/logic/csv-import';
import { csvFilename } from '../../core/logic/csv';

@Component({
  selector: 'app-csv-import-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonButton,
    AppIconComponent,
    AlertBannerComponent,
  ],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Bulk import flavors</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cancel()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (!plan()) {
        <p class="note">
          Upload a CSV of flavors. Every row is checked before anything is written — if one row is
          wrong, nothing is imported.
        </p>
        <input #csvInput type="file" accept=".csv,text/csv" hidden (change)="onCsvPicked($event)" />
        <div class="actions">
          <ion-button size="small" (click)="csvInput.click()">Choose CSV file</ion-button>
          <ion-button size="small" fill="clear" (click)="downloadTemplate()">
            <app-icon name="download" slot="start" />
            Template
          </ion-button>
        </div>
        <details class="help">
          <summary>Which columns?</summary>
          <p>
            <code>set_number, set_name, variant_name</code> are required. <code>description</code>,
            <code>category</code> (flavor / sundae / cone) and the four price and stock columns are
            optional. Names are matched loosely, so <code>Price (Half Gallon)</code> works as well
            as <code>half_gallon_price</code>. Lines starting with <code>#</code> are ignored.
          </p>
        </details>
      } @else {
        @if (errors().length) {
          <app-alert-banner
            tone="danger"
            title="Nothing was imported"
            [message]="
              errors().length +
              ' problem' +
              (errors().length === 1 ? '' : 's') +
              ' found. Fix the file and try again.'
            "
          />
          <ul class="errors">
            @for (e of errors(); track e.line) {
              <li>
                <strong>Line {{ e.line }}:</strong> {{ e.message }}
              </li>
            }
          </ul>
          <div class="actions">
            <ion-button size="small" fill="outline" (click)="reset()"
              >Choose another file</ion-button
            >
          </div>
        } @else {
          <app-alert-banner
            tone="success"
            title="File is ready"
            [message]="
              valid().length + ' flavor' + (valid().length === 1 ? '' : 's') + ' validated.'
            "
          />
          @if (unknown().length) {
            <p class="note">
              Ignored unknown column{{ unknown().length === 1 ? '' : 's' }}:
              {{ unknown().join(', ') }}
            </p>
          }
          <div class="summary">
            @for (row of valid().slice(0, 8); track row.setNumber + row.variantName) {
              <span class="pill">{{ row.variantName }}</span>
            }
            @if (valid().length > 8) {
              <span class="pill more">+{{ valid().length - 8 }} more</span>
            }
          </div>
          <div class="actions">
            <ion-button size="small" (click)="commit()" [disabled]="importing()">
              {{ importing() ? 'Importing...' : 'Import ' + valid().length + ' flavors' }}
            </ion-button>
            <ion-button size="small" fill="clear" (click)="cancel()">Cancel</ion-button>
          </div>
        }
      }
    </ion-content>
  `,
  styles: [
    `
      .note {
        margin: 0 0 12px;
        font-size: 13px;
        line-height: 1.5;
        opacity: 0.85;
      }
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .errors {
        margin: 8px 0 12px;
        padding-left: 18px;
        font-size: 13px;
        line-height: 1.6;
      }
      .summary {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 12px;
      }
      .pill {
        padding: 2px 10px;
        border-radius: 999px;
        background: var(--ion-color-light, #eef2f7);
        font-size: 12px;
      }
      .pill.more {
        opacity: 0.7;
      }
      .help summary {
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
      }
      .help p {
        font-size: 12px;
        line-height: 1.6;
        opacity: 0.8;
      }
    `,
  ],
})
export class CsvImportModalComponent {
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly inventory = inject(InventoryService);
  private readonly csvExport = inject(CsvExportService);

  /**
   * Existing product keys, as `<setNumber>_<slug>`, so the parser can report a
   * row that would silently overwrite a live flavor instead of quietly doing it.
   */
  existingKeys: string[] = [];

  readonly plan = signal<ImportPlan | null>(null);
  readonly importing = signal(false);

  readonly valid = computed(() => this.plan()?.valid ?? []);
  readonly errors = computed(() => this.plan()?.errors ?? []);
  readonly unknown = computed(() => this.plan()?.unknownColumns ?? []);

  async onCsvPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset immediately or re-picking the same file fires no change event.
    input.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      await this.toast('That file is over 2 MB. Split it into smaller files.', 'danger');
      return;
    }
    let text = '';
    try {
      text = await file.text();
    } catch {
      await this.toast('Could not read that file.', 'danger');
      return;
    }
    this.plan.set(parseProductCsv(text, new Set(this.existingKeys)));
  }

  reset(): void {
    this.plan.set(null);
    this.importing.set(false);
  }

  cancel(): void {
    void this.modalCtrl.dismiss();
  }

  /**
   * Writes the validated rows.
   *
   * Sequential, not parallel: `createProduct` is a `setDoc` each, and firing 64 of
   * them at once is how a mobile browser earns a rate-limit error halfway through,
   * leaving a partial import — the exact state the validator exists to prevent.
   *
   * The count of failures is reported rather than swallowed. A run that stopped at
   * the first error would leave the admin with a partial catalog AND no idea how
   * far it got; continuing and reporting is recoverable, stopping is not.
   */
  async commit(): Promise<void> {
    const rows = this.valid();
    if (!rows.length || this.importing()) return;

    this.importing.set(true);
    let written = 0;
    const failures: string[] = [];

    for (const row of rows) {
      try {
        await this.inventory.createProduct({
          setNumber: row.setNumber,
          setName: row.setName,
          variantName: row.variantName,
          description: row.description || `${row.variantName} — ${row.setName}.`,
          imageUrl: '',
          category: row.category,
          pricing: row.pricing,
          stock: row.stock,
        });
        written++;
      } catch {
        failures.push(row.variantName);
      }
    }

    this.importing.set(false);

    if (failures.length) {
      // Stay OPEN and surface the failures as errors, rather than dismissing and
      // reporting a number. This is the behaviour the inline panel had and it is
      // the recoverable one: the admin can see WHICH flavors did not write, fix
      // them, and retry, instead of being handed a partial catalogue and a toast
      // that has already scrolled away.
      await this.toast(`${written} imported, ${failures.length} failed.`, 'warning');
      this.plan.set({
        valid: [],
        errors: failures.map((name, i) => ({
          line: i + 1,
          message: `"${name}" could not be written`,
        })),
        unknownColumns: [],
        skipped: 0,
      });
      return;
    }

    await this.modalCtrl.dismiss({ imported: written, failures });
  }

  /**
   * The import template is the one export a phone most needs.
   *
   * It is also the export most likely to be used on a device: an admin standing
   * in the shop with stock to add is exactly who has no laptop. The old
   * anchor-click did nothing there, so the import feature was unreachable on the
   * platform the app ships to.
   *
   * `PRODUCT_CSV_TEMPLATE` is already a CSV string, so it is exported verbatim —
   * not run through `toCsv`, which takes rows of cells.
   */
  downloadTemplate(): void {
    this.csvExport.export(PRODUCT_CSV_TEMPLATE, csvFilename('flavors-template'));
  }

  private async toast(
    message: string,
    color: 'danger' | 'success' | 'warning' = 'danger',
  ): Promise<void> {
    const t = await this.toastCtrl.create({ message, color, duration: 2500, position: 'top' });
    await t.present();
  }
}
