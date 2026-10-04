// src/app/admin/inventory/add-product-modal.component.ts
// Five-orites Scoop — Add Product form (dropdown + New option)

import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonList,
  IonItem,
  IonSelect,
  IonSelectOption,
  IonInput,
  IonTextarea,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { InventoryService } from '../../core/services/inventory.service';
import { ImageUploadService } from '../../core/services/image-upload.service';
import { SET_NAMES, SIZE_DISPLAY_LABELS, getPricingForSet } from '../../core/config/pricing.config';
import { SizeVariant } from '../../core/models/product.model';
import { SIZE_VARIANTS, totalStock } from '../../core/logic/stock';

@Component({
  selector: 'app-add-product-modal',
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
    IonList,
    IonItem,
    IonSelect,
    IonSelectOption,
    IonInput,
    IonTextarea,
    AppIconComponent,
  ],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Add Product</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cancel()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-list>
        <ion-item>
          <ion-select
            label="Flavor Set"
            labelPlacement="stacked"
            interface="popover"
            [(ngModel)]="selectedSet"
            (ionChange)="onSetChange()"
          >
            @for (s of sets; track s.value) {
              <ion-select-option [value]="s.value">
                Set {{ s.value }} · {{ s.label }}
              </ion-select-option>
            }
            <ion-select-option value="new">✨ New flavor set…</ion-select-option>
          </ion-select>
        </ion-item>

        @if (isNewSet) {
          <ion-item>
            <ion-input
              label="New set name"
              labelPlacement="stacked"
              placeholder="e.g. Pistachio"
              [(ngModel)]="newSetName"
            ></ion-input>
          </ion-item>
          <ion-item>
            <ion-input
              label="Variant name"
              labelPlacement="stacked"
              placeholder="e.g. Roasted Pistachio"
              [(ngModel)]="variantName"
            ></ion-input>
          </ion-item>
        } @else {
          <ion-item>
            <ion-select
              label="Variant name"
              labelPlacement="stacked"
              interface="popover"
              placeholder="Choose a variant…"
              [(ngModel)]="selectedVariant"
            >
              @for (v of availableVariants; track v) {
                <ion-select-option [value]="v" [disabled]="!isVariantActive(v)">
                  {{ v }}{{ isVariantActive(v) ? '' : ' — inactive' }}
                </ion-select-option>
              }
              <ion-select-option value="new">✨ New variant…</ion-select-option>
            </ion-select>
          </ion-item>

          @if (isNewVariant) {
            <ion-item>
              <ion-input
                label="New variant name"
                labelPlacement="stacked"
                placeholder="e.g. Rocky Road"
                [(ngModel)]="customVariant"
              ></ion-input>
            </ion-item>
          }
        }

        <!--
          No Type control. Everything this form can create is a flavor, so the
          dropdown was a decision the admin almost never needed to make and had
          no good answer for in the one case that mattered. See the category field
          in create() for why the value is still written.
        -->

        <ion-item>
          <ion-textarea
            label="Description"
            labelPlacement="stacked"
            placeholder="Describe this flavor…"
            rows="3"
            [(ngModel)]="description"
          ></ion-textarea>
        </ion-item>

        <!--
          Initial stock, entered at creation instead of afterwards.

          It used to be hardcoded to zero and the success toast said "Set its
          stock next", so every new product started unbuyable and had to be
          hunted down on the inventory card. Zeros are still the default — a
          flavor catalogued before it is stocked is an ordinary case — but the
          count can now be typed once instead of dialled in one tap at a time.

          Plain number boxes, deliberately NOT steppers: a stepper is right for
          nudging a live figure by one (that is what the inventory card is for)
          and wrong for entering twenty. The split is intentional, not an
          oversight.
        -->
        <h3 class="section-title">Initial stock</h3>
        <p class="section-note">Units on hand right now. Leave at 0 to fill it in later.</p>
        <div class="stock-grid">
          @for (f of stockFields; track f.key) {
            <ion-item>
              <ion-input
                [label]="f.label"
                labelPlacement="stacked"
                type="number"
                inputmode="numeric"
                min="0"
                step="1"
                placeholder="0"
                [ngModel]="stockInput[f.key]"
                (ngModelChange)="onStockInput(f.key, $event)"
              ></ion-input>
            </ion-item>
          }
        </div>
        @if (stockError) {
          <p class="field-error">{{ stockError }}</p>
        }

        <h3 class="section-title">Product Image (optional)</h3>
        <div
          class="img-box"
          (click)="fileInput.click()"
          (keydown.enter)="fileInput.click()"
          (keydown.space)="fileInput.click(); $event.preventDefault()"
          tabindex="0"
          role="button"
          aria-label="Choose image from device"
        >
          @if (previewImage) {
            <img [src]="previewImage" alt="Product image preview" class="img-box-fill" />
            <span class="img-box-change">Tap to change</span>
          } @else {
            <div class="img-box-empty">
              <app-icon name="image" class="img-box-icon" />
              <span>Tap to choose image from device</span>
            </div>
          }
        </div>
        <input #fileInput type="file" accept="image/*" hidden (change)="onFilePicked($event)" />
        @if (pendingFile) {
          <ion-button expand="block" fill="clear" size="small" color="medium" (click)="clearFile()">
            Remove device image
          </ion-button>
        }
        @if (!uploadService.isConfigured) {
          <p class="config-hint">
            ⚠️ Cloudinary is not set up yet — fill cloudName + uploadPreset in environment.ts to
            enable image uploads.
          </p>
        }
      </ion-list>

      <ion-button expand="block" (click)="create()" [disabled]="isSaving" class="create-btn">
        {{
          isUploading
            ? 'Uploading image…'
            : isSaving
              ? 'Creating…'
              : isNewSet
                ? 'Create New Set'
                : 'Create Product'
        }}
      </ion-button>
    </ion-content>
  `,
  styles: [
    `
      .create-btn {
        --background: var(--color-brand-primary);
        --border-radius: 10px;
        font-weight: 700;
        margin-top: 16px;
      }
      .section-title {
        font-size: 14px;
        font-weight: 800;
        color: var(--ion-color-dark);
        margin: 18px 2px 4px;
      }
      .section-note {
        margin: 0 2px 4px;
        font-size: 12px;
        line-height: 1.4;
        color: var(--ion-color-medium);
      }
      /* Two columns of stock boxes rather than four stacked rows — the four
         sizes are a set the admin reads ACROSS, not a list they read down.
         Same treatment as the pricing grid in the edit modal. */
      .stock-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0 8px;
      }
      @media (max-width: 380px) {
        .stock-grid {
          grid-template-columns: 1fr;
        }
      }
      .field-error {
        margin: 8px 2px 0;
        font-size: 12px;
        font-weight: 600;
        color: var(--color-danger, #c62828);
      }
      .img-box {
        position: relative;
        min-height: 180px;
        border-radius: 14px;
        overflow: hidden;
        cursor: pointer;
        border: 2px dashed var(--ion-color-medium, #999);
        background: var(--ion-color-light);
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 4px 2px 0;
      }
      .img-box-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 28px 12px;
        color: var(--ion-color-medium);
        font-size: 13px;
        font-weight: 600;
        text-align: center;
      }
      .img-box-icon {
        font-size: 44px;
      }
      .img-box-fill {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .img-box-change {
        position: absolute;
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.65);
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        padding: 4px 14px;
        border-radius: 20px;
        white-space: nowrap;
      }
      .config-hint {
        font-size: 12px;
        color: var(--ion-color-warning-shade, #9a6b00);
        margin: 6px 2px 0;
      }
    `,
  ],
})
export class AddProductModalComponent {
  private inventoryService = inject(InventoryService);
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  readonly uploadService = inject(ImageUploadService);

  @Input() maxSetNumber: number = 8;
  @Input() variants: {
    setNumber: number;
    setName: string;
    variantName: string;
    isActive: boolean;
  }[] = [];

  /**
   * Built-in sets merged with any admin-created set present in the catalog.
   *
   * This used to list only SET_NAMES (1-8), yet a new set is assigned
   * `maxSetNumber + 1`. Custom sets were therefore unselectable, and creating
   * two of them collided on the same set number.
   */
  get sets(): { value: string; label: string }[] {
    const byNumber = new Map<number, string>();
    for (const [k, v] of Object.entries(SET_NAMES)) byNumber.set(Number(k), v);
    for (const v of this.variants) {
      if (!byNumber.has(v.setNumber)) {
        byNumber.set(v.setNumber, v.setName || `Set ${v.setNumber}`);
      }
    }
    return [...byNumber.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, name]) => ({ value: String(n), label: name }));
  }

  /** Display name for a set number, including admin-created sets. */
  setNameFor(setNumber: number): string {
    return (
      this.sets.find((s) => s.value === String(setNumber))?.label ??
      SET_NAMES[setNumber] ??
      `Set ${setNumber}`
    );
  }

  selectedSet: string = '1';
  selectedVariant: string = '';
  customVariant = '';
  newSetName = '';
  variantName = '';
  description = '';
  pendingFile: File | null = null;
  previewObjectUrl = '';
  isSaving = false;
  isUploading = false;

  /**
   * The four stock boxes, labelled from `SIZE_DISPLAY_LABELS` and ORDERED BY
   * `SIZE_VARIANTS`.
   *
   * Driving both from the shared source is what keeps this section from
   * becoming a third place that has to be edited when a size is added or
   * reordered. (The owner asked for Cup, Pint, Gallon, Half Gallon; that order
   * was not adopted, because it disagrees with the canonical one used by the
   * pricing matrix, the cart and the inventory card.)
   */
  readonly stockFields: readonly { key: SizeVariant; label: string }[] = SIZE_VARIANTS.map((k) => ({
    key: k,
    label: SIZE_DISPLAY_LABELS[k],
  }));

  /**
   * The stock boxes as raw text, not numbers.
   *
   * A `number` model cannot represent what the admin is partway through typing
   * — "" while the field is empty, "-2" while a mistake is being corrected —
   * and coercing on the way in would silently rewrite their typing into
   * something they never wrote. Held raw here, validated on the way out.
   */
  stockInput: Record<SizeVariant, string> = { cup: '', pint: '', halfGallon: '', gallon: '' };

  /**
   * The message for the first size that cannot be written, or null.
   *
   * `sizeIsSane` in firestore.rules is the actual guarantee — a negative or
   * fractional count is rejected server-side whatever this form sends. This
   * exists so the admin gets "Half Gallon must be a whole number of 0 or more"
   * next to the box they typed it into, rather than a rules error after the
   * fact. It is a readable message, not a security boundary.
   *
   * Only the first offending size is named: which box is wrong is a one-glance
   * read, and four simultaneous messages would bury it.
   *
   * An empty box is 0, not an error. A flavor catalogued before it is stocked
   * is an ordinary product, and clearing a box while retyping must not light
   * the form up red.
   */
  get stockError(): string | null {
    for (const { key, label } of this.stockFields) {
      const raw = this.stockInput[key].trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        return `${label} must be a whole number of 0 or more.`;
      }
    }
    return null;
  }

  onStockInput(key: SizeVariant, value: unknown): void {
    this.stockInput[key] = value === null || value === undefined ? '' : String(value);
  }

  /** The raw text as the four numbers to write. Only called once validated. */
  private stockLevels(): Record<SizeVariant, number> {
    const out = {} as Record<SizeVariant, number>;
    for (const { key } of this.stockFields) {
      const raw = this.stockInput[key].trim();
      out[key] = raw === '' ? 0 : Number(raw);
    }
    return out;
  }

  get isNewSet(): boolean {
    return this.selectedSet === 'new';
  }

  get isNewVariant(): boolean {
    return this.selectedVariant === 'new';
  }

  get availableVariants(): string[] {
    const set = Number(this.selectedSet) || 0;
    const names = this.variants.filter((v) => v.setNumber === set).map((v) => v.variantName);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }

  /**
   * A variant with no active row is deactivated, not deleted. It stays in the
   * list so the admin can see it exists, and is told to switch it back on from
   * the inventory list rather than creating a second product with the same name
   * and orphaning the original.
   */
  isVariantActive(name: string): boolean {
    const set = Number(this.selectedSet) || 0;
    return this.variants.some((v) => v.setNumber === set && v.variantName === name && v.isActive);
  }

  onSetChange(): void {
    this.selectedVariant = '';
    this.customVariant = '';
  }

  get previewImage(): string {
    return this.previewObjectUrl;
  }

  onFilePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      void this.toast('Please choose an image file.', 'danger');
      return;
    }
    if (this.previewObjectUrl) URL.revokeObjectURL(this.previewObjectUrl);
    this.pendingFile = file;
    this.previewObjectUrl = URL.createObjectURL(file);
  }

  clearFile(): void {
    if (this.previewObjectUrl) URL.revokeObjectURL(this.previewObjectUrl);
    this.pendingFile = null;
    this.previewObjectUrl = '';
  }

  cancel(): void {
    void this.modalCtrl.dismiss();
  }

  async create(): Promise<void> {
    if (this.isSaving) return;

    let setNumber: number;
    let setName: string;
    let variant: string;
    if (this.isNewSet) {
      const name = this.newSetName.trim();
      if (!name) {
        await this.toast('New set name is required.', 'danger');
        return;
      }
      variant = this.variantName.trim();
      if (!variant) {
        await this.toast('Variant name is required.', 'danger');
        return;
      }
      setNumber = this.maxSetNumber + 1;
      setName = name;
    } else {
      setNumber = Number(this.selectedSet) || 1;
      setName = this.setNameFor(setNumber);
      if (this.isNewVariant) {
        variant = this.customVariant.trim();
        if (!variant) {
          await this.toast('New variant name is required.', 'danger');
          return;
        }
      } else {
        variant = this.selectedVariant;
        if (!variant) {
          await this.toast('Choose a variant, or pick New variant…', 'danger');
          return;
        }
        // Defence in depth: the option is disabled in the list, but a popover can
        // still be driven by keyboard/assistive tech, so re-check on submit.
        if (!this.isVariantActive(variant)) {
          await this.toast(
            `"${variant}" is deactivated. Switch it back on from the inventory list instead of creating a duplicate.`,
            'danger',
          );
          return;
        }
      }
    }

    // Checked after the names rather than before: the boxes sit lower in the
    // form, so a form that is wrong in both places should complain about the
    // thing above first. Toasted as well as shown inline because the button
    // lives at the bottom of a scrolling sheet — the admin may be looking at it,
    // not at the box.
    const stockError = this.stockError;
    if (stockError) {
      await this.toast(stockError, 'danger');
      return;
    }
    const stock = this.stockLevels();

    this.isSaving = true;
    try {
      // Device image → Cloudinary URL first; empty when no image was picked.
      let finalImageUrl = '';
      if (this.pendingFile) {
        this.isUploading = true;
        try {
          finalImageUrl = await this.uploadService.uploadProductImage(this.pendingFile);
        } finally {
          this.isUploading = false;
        }
      }
      await this.inventoryService.createProduct({
        setNumber,
        setName,
        variantName: variant,
        description: this.description.trim() || 'New Five-orites flavor.',
        imageUrl: finalImageUrl,
        // Always 'flavor', and no longer a control.
        //
        // The form used to offer a Type dropdown. Of the 66 products in
        // production, 65 carry no `category` at all and the one that does is a
        // sundae — so the dropdown asked a question with one overwhelmingly
        // obvious answer, and an admin adding a cone or a sundae had to be told
        // that this is where you do that. The VALUE is still written, because
        // what was removed is the control, not the field: a new document should
        // be complete, and categoryIsValid() only constrains the field when it
        // is present.
        category: 'flavor',
        pricing: getPricingForSet(setNumber),
        stock,
      });
      // The "Set its stock next" nudge is gone now that stock is entered above,
      // but only the part that was wrong. A product that really did go in at
      // zero still needs saying: it is live and unbuyable until someone fills it
      // from the inventory list.
      const zeroStockNote = totalStock(stock) === 0 ? ' It starts at zero stock.' : '';
      await this.toast(
        (this.isNewSet ? `✅ Set ${setNumber} · ${setName} created.` : '✅ Product created.') +
          zeroStockNote,
        'success',
      );
      await this.modalCtrl.dismiss({ created: true });
    } catch (err: unknown) {
      await this.toast(err instanceof Error ? err.message : 'Failed to create product.', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, color, duration: 2500, position: 'top' });
    await t.present();
  }
}
