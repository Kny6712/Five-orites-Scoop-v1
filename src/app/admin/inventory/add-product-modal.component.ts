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
import { SET_NAMES, getPricingForSet } from '../../core/config/pricing.config';
import { PRODUCT_CATEGORIES, ProductCategory } from '../../core/models/product.model';

/** Minimal shape for a select option; avoids a dependency on a UI types file. */
interface SelectOption {
  label: string;
  value: string;
}

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
          Catalog type. Defaults to Flavor, which is what every one of the 64
          seeded products is, so an admin adding another flavor does not have to
          think about it. Scones and cones exist because the plan names them.
        -->
        <ion-item>
          <ion-select
            label="Type"
            labelPlacement="stacked"
            interface="popover"
            [(ngModel)]="category"
            aria-label="Product type"
          >
            @for (opt of categoryOptions; track opt.value) {
              <ion-select-option [value]="opt.value">{{ opt.label }}</ion-select-option>
            }
          </ion-select>
        </ion-item>

        <ion-item>
          <ion-textarea
            label="Description"
            labelPlacement="stacked"
            placeholder="Describe this flavor…"
            rows="3"
            [(ngModel)]="description"
          ></ion-textarea>
        </ion-item>

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
  /**
   * Catalog type. Defaults to 'flavor' so the common case needs no decision.
   * Typed as a string rather than ProductCategory because it round-trips
   * through ngModel, and ProductCategory is imported for the options list and
   * for the cast at save time.
   */
  category: string = 'flavor';
  readonly categoryOptions: SelectOption[] = PRODUCT_CATEGORIES.map((c) => ({
    label: c.label,
    value: c.value,
  }));
  pendingFile: File | null = null;
  previewObjectUrl = '';
  isSaving = false;
  isUploading = false;

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
        category: this.category as ProductCategory,
        pricing: getPricingForSet(setNumber),
        stock: { cup: 0, pint: 0, halfGallon: 0, gallon: 0 },
      });
      await this.toast(
        this.isNewSet
          ? `✅ Set ${setNumber} · ${setName} created. Set its stock next.`
          : '✅ Product created. Set its stock next.',
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
