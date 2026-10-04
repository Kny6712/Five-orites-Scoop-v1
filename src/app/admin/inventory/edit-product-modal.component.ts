// src/app/admin/inventory/edit-product-modal.component.ts
// Five-orites Scoop — Edit Product: variant name, description and image.
// Stock quantities are edited from the inventory list, not here.

import { Component, Input, OnInit, OnDestroy, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonFooter,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonList,
  IonItem,
  IonInput,
  IonTextarea,
  IonSelect,
  IonSelectOption,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { InventoryService } from '../../core/services/inventory.service';
import { ImageUploadService } from '../../core/services/image-upload.service';
import {
  Product,
  ProductCategory,
  SizePricing,
  SizeVariant,
  PRODUCT_CATEGORIES,
  productCategory,
} from '../../core/models/product.model';
import { SIZE_DISPLAY_LABELS } from '../../core/config/pricing.config';
import { flavourOf } from '../../core/logic/flavor';
import { CloudinaryPipe } from '../../shared/pipes/cloudinary.pipe';

@Component({
  selector: 'app-edit-product-modal',
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
    IonInput,
    IonTextarea,
    IonSelect,
    IonSelectOption,
    IonFooter,
    CloudinaryPipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Edit Product</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cancel()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (product) {
        <div class="modal-body">
          <h3 class="section-title">Details</h3>
          <ion-list class="card-list">
            <ion-item>
              <ion-input
                label="Variant name"
                labelPlacement="stacked"
                [(ngModel)]="variantName"
              ></ion-input>
            </ion-item>
            <!--
              Catalog type. Shown pre-filled from the stored value, defaulting to
              'flavor' for a product seeded before the field existed — so opening
              this modal on one of the original 64 and saving does not silently
              relabel it.
            -->
            <!--
              Flavor, derived — not a control.

              Read-only because there is nothing to choose: the flavour IS the
              product's set, and every product already stores a setName. A dropdown
              here would mean a second place to keep the same fact in step with the
              name, which is the shape of most of the bugs this project has had.

              It is NOT derived from the variant name, despite sitting directly
              under it. Seven of the sixty-five products name a different flavour
              inside their variant name — "Chocolate Chip Cookie Dough" is a Cookies
              & Cream, "Coffee Chocolate Chip" is a Coffee — so a name search would
              answer "Chocolate" for every one of them. core/logic/flavor.ts lists
              them.

              Distinct from Type, which answers a different question. Type is what
              FORM the product is (flavor / sundae / cone); Flavor is which FLAVOUR.
            -->
            <ion-item>
              <ion-input
                label="Flavor"
                labelPlacement="stacked"
                [value]="flavour()"
                readonly
                aria-label="Flavor, derived from the product's set"
              ></ion-input>
            </ion-item>
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
                rows="3"
                [(ngModel)]="description"
              ></ion-textarea>
            </ion-item>
          </ion-list>

          <!--
            Per-size pricing.

            This is the fix for a documented permanent bug: corrected-gap-analysis.md:308
            recorded that "admin-created flavor sets above number 8 are permanently
            mispriced" because getPricingForSet falls back to the Chocolate tier and
            NOTHING in the app could ever change it — updateProductDetails accepted a
            pricing patch all along, but no UI exposed one.

            Only sent when a price actually changed, so renaming a flavor cannot
            silently rewrite its pricing.
          -->
          <h3 class="section-title">Pricing per size</h3>
          <p class="pricing-note">
            Prices are per variant, not per set — two variants in the same set can charge
            differently.
          </p>
          <ion-list class="card-list price-grid">
            @for (row of priceFields; track row.key) {
              <ion-item>
                <ion-input
                  [label]="row.label"
                  labelPlacement="stacked"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  [ngModel]="price[row.key]"
                  (ngModelChange)="onPriceInput(row.key, $event)"
                ></ion-input>
              </ion-item>
            }
          </ion-list>

          <!-- The preview lives outside the card so it can be centred in the
               leftover space between the card and the footer action bar.
               Clickable so a photo can be replaced or added after the product
               already exists — previously the image could only be set at
               creation time, leaving no way to fix a wrong or missing photo. -->
          <div
            class="image-frame"
            (click)="pickImage(fileInput)"
            (keydown.enter)="pickImage(fileInput)"
            (keydown.space)="pickImage(fileInput); $event.preventDefault()"
            tabindex="0"
            role="button"
            [attr.aria-label]="previewImage ? 'Change product photo' : 'Add a product photo'"
          >
            <img
              [src]="(previewImage | cloudinary: 600) || 'assets/placeholder-scoop.svg'"
              [alt]="variantName || 'Product image'"
              class="image-preview"
              [class.is-stale]="removeImage"
              (error)="onImageError($event)"
            />
            @if (isUploading) {
              <span class="image-frame-badge">Uploading…</span>
            } @else if (pendingFile) {
              <span class="image-frame-badge">Tap to choose a different photo</span>
            } @else {
              <span class="image-frame-badge">
                {{ previewImage ? 'Tap to change photo' : 'Tap to add a photo' }}
              </span>
            }
          </div>
          <input #fileInput type="file" accept="image/*" hidden (change)="onFilePicked($event)" />
          @if (!uploadService.isConfigured) {
            <p class="config-hint">
              ⚠️ Cloudinary is not set up yet — add cloudName + uploadPreset in environment.ts to
              enable photo uploads.
            </p>
          }
          @if (pendingFile || (product.imageUrl && !removeImage)) {
            <div class="image-actions">
              @if (pendingFile) {
                <ion-button size="small" fill="clear" color="medium" (click)="clearPending()">
                  Discard new photo
                </ion-button>
              }
              @if (product.imageUrl && !pendingFile && !removeImage) {
                <ion-button size="small" fill="clear" color="danger" (click)="removeImage = true">
                  Remove current photo
                </ion-button>
              }
              @if (removeImage) {
                <ion-button size="small" fill="clear" color="medium" (click)="removeImage = false">
                  Keep current photo
                </ion-button>
              }
            </div>
          }
        </div>
      }
    </ion-content>

    <ion-footer>
      <ion-toolbar>
        <ion-button
          expand="block"
          fill="outline"
          color="primary"
          (click)="save()"
          [disabled]="isSaving || !product"
          class="save-btn"
        >
          {{ isSaving ? 'Saving…' : 'Save Changes' }}
        </ion-button>
      </ion-toolbar>
    </ion-footer>
  `,
  styles: [
    `
      .section-title {
        font-size: 15px;
        font-weight: 800;
        color: var(--ion-color-dark);
        margin: 18px 2px 8px;
      }
      .section-title:first-of-type {
        margin-top: 2px;
      }
      .card-list {
        border-radius: 14px;
        overflow: hidden;
        box-shadow: var(--shadow-card);
      }
      .pricing-note {
        margin: -4px 0 8px;
        padding: 0 16px;
        font-size: 12px;
        line-height: 1.4;
        color: var(--ion-color-medium);
      }
      /* Two columns of price boxes rather than four stacked rows — the four sizes
       are a set the admin reads ACROSS, not a list they read down. */
      .price-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0 8px;
      }
      @media (max-width: 380px) {
        .price-grid {
          grid-template-columns: 1fr;
        }
      }
      /* Fills ion-content's scroll area so margin-block: auto below has some free
       space to distribute. The 100% resolves because ion-content's .inner-scroll
       is position:absolute with all four offsets set, giving it a definite
       height — that is the only way in, since .inner-scroll is shadow DOM and
       cannot be styled from here. min-height (not height) so a long description
       still grows the body and scrolls instead of being clipped. */
      .modal-body {
        min-height: 100%;
        display: flex;
        flex-direction: column;
      }
      /* Centred in whatever space is left between the card and the action bar.
       Auto margins collapse to 0 once the content outgrows the area, so the
       layout degrades to normal flow rather than overflowing. */
      .image-frame {
        position: relative;
        margin-block: auto;
        margin-inline: auto;
        width: 100%;
        max-width: 420px;
        border-radius: 12px;
        overflow: hidden;
        background: var(--color-brand-light);
        border: 1px solid rgba(107, 63, 160, 0.14);
        cursor: pointer;
        transition:
          border-color 150ms ease,
          box-shadow 150ms ease;
      }
      .image-frame:hover {
        border-color: rgba(107, 63, 160, 0.34);
      }
      .image-frame:focus-visible {
        outline: 2px solid var(--color-brand-primary);
        outline-offset: 2px;
      }
      /* contain, not cover: cover cropped a 4:3 shot down to its middle 35% and
       cut the top off the scoop. The frame is close to 3:2 so the letterboxing
       on either side stays small. */
      .image-preview {
        display: block;
        width: 100%;
        height: 280px;
        object-fit: contain;
      }
      /* Faded while a removal is staged, so "this photo will go" is obvious
       before anything is saved. */
      .image-preview.is-stale {
        opacity: 0.3;
      }
      .image-frame-badge {
        position: absolute;
        left: 50%;
        bottom: 12px;
        transform: translateX(-50%);
        padding: 5px 14px;
        border-radius: 20px;
        background: rgba(0, 0, 0, 0.66);
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        pointer-events: none;
      }
      .image-actions {
        display: flex;
        justify-content: center;
        gap: 4px;
        margin-top: 6px;
        ion-button {
          --border-radius: 10px;
          font-size: 13px;
        }
      }
      .config-hint {
        font-size: 12px;
        color: var(--ion-color-warning-shade, #9a6b00);
        text-align: center;
      }
      /* Pinned action bar: the button stays at the bottom while ion-content scrolls.
       The hairline separates it from the scrolling card; the violet strip closes
       the modal off and echoes the header. .large-sheet-modal is Ionic's
       .modal-wrapper, which is border-radius + overflow: hidden, so the strip is
       clipped to the same 18px curve as the header instead of poking out square. */
      ion-footer {
        box-shadow: 0 -1px 6px rgba(0, 0, 0, 0.06);
        border-bottom: 3px solid var(--color-primary-ink);
      }
      /* variables.scss paints every ion-toolbar brand-violet, which is right for
       the header but wrong here — this bar must read as part of the white
       content area. Only the bar changes; the button is an outline treatment. */
      ion-footer ion-toolbar {
        --background: var(--ion-background-color, #f8f8f8);
        --color: var(--ion-text-color, #000000);
        /* Collapse the toolbar's default 56px so the button tucks right up against
         the top hairline, with the extra room left underneath for reach. */
        --min-height: 0;
        --padding-start: 16px;
        --padding-end: 16px;
        --padding-top: 2px;
        --padding-bottom: 14px;
      }
      /* Selector is 'ion-button.save-btn' rather than '.save-btn' on purpose:
       Ionic's :host(.button-outline) compiles to the same specificity as a
       component-style class, so the --border-width override would be a coin
       flip on stylesheet injection order. */
      ion-button.save-btn {
        --background: transparent;
        --color: var(--color-brand-primary);
        --border-color: var(--color-primary-ink);
        --border-style: solid;
        --border-width: 1.5px;
        --border-radius: 12px;
        --padding-top: 18px;
        --padding-bottom: 18px;
        font-weight: 700;
        font-size: 15px;
        letter-spacing: 0.06em;
        /* ion-button only uppercases in md mode; this modal also runs on device,
         where Ionic uses ios mode and would render 'Save Changes' verbatim. */
        text-transform: uppercase;
        margin: 0;
        min-height: 48px;
      }
    `,
  ],
})
export class EditProductModalComponent implements OnInit, OnDestroy {
  private inventoryService = inject(InventoryService);
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  readonly uploadService = inject(ImageUploadService);

  @Input() product: Product | null = null;

  /**
   * The product's flavour, derived from its set.
   *
   * A `computed` rather than a field assigned in `ngOnInit`, so it cannot go stale
   * if `product` is re-assigned while the modal stays open.
   */
  readonly flavour = computed(() => flavourOf(this.product));

  variantName = '';
  description = '';
  /** Catalog type, pre-filled from the stored value in ngOnInit. */
  category: string = 'flavor';
  readonly categoryOptions: { label: string; value: string }[] = PRODUCT_CATEGORIES.map((c) => ({
    label: c.label,
    value: c.value,
  }));
  isSaving = false;

  /**
   * Live price editing, in pesos.
   *
   * Held as a plain object because it is driven by `ngModel` over a dynamic set
   * of four controls, and the `priceChanged` getter below tracks whether anything
   * moved so an untouched modal never writes the field.
   */
  price: Record<SizeVariant, number> = { cup: 0, pint: 0, halfGallon: 0, gallon: 0 };
  private storedPrice: SizePricing | null = null;

  readonly priceFields: readonly { key: SizeVariant; label: string }[] = (
    ['cup', 'pint', 'halfGallon', 'gallon'] as const
  ).map((k) => ({ key: k, label: SIZE_DISPLAY_LABELS[k] }));

  /**
   * Coerces whatever `ion-input` hands back into a whole peso count.
   *
   * An empty field arrives as `''` and a partially-typed number as a string, so
   * this cannot assume a number. 0 is the floor: a negative price is not a
   * discount, it is a bug that would let checkout credit the customer.
   */
  onPriceInput(key: SizeVariant, value: unknown): void {
    const n = Math.round(Number(value));
    this.price[key] = Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** True when any price differs from what is stored. */
  private get priceChanged(): boolean {
    if (!this.storedPrice) return false;
    return (['cup', 'pint', 'halfGallon', 'gallon'] as const).some(
      (k) => this.price[k] !== this.storedPrice![k],
    );
  }

  /** A photo chosen in this session, uploaded to Cloudinary on save. */
  pendingFile: File | null = null;
  private previewObjectUrl = '';
  isUploading = false;
  /** Staged removal — only committed on save, so Cancel really cancels. */
  removeImage = false;

  ngOnInit(): void {
    if (this.product) {
      this.variantName = this.product.variantName;
      this.description = this.product.description ?? '';
      // productCategory() maps a missing field to 'flavor', so a product seeded
      // before categories existed opens with the right value selected rather
      // than an empty control that would overwrite it on save.
      this.category = productCategory(this.product);
      // Seed the price boxes from what is stored, and remember that value so
      // `priceChanged` can tell a real edit from a form that was merely opened.
      const p = this.product.pricing;
      this.price = {
        cup: p?.cup ?? 0,
        pint: p?.pint ?? 0,
        halfGallon: p?.halfGallon ?? 0,
        gallon: p?.gallon ?? 0,
      };
      this.storedPrice = { ...this.price };
    }
  }

  ngOnDestroy(): void {
    this.revokePreview();
  }

  /**
   * What the frame shows: the freshly picked local file if there is one,
   * otherwise whatever is already stored (or nothing, for the placeholder).
   * A staged removal reads as "no photo" so the state is visible before saving.
   */
  get previewImage(): string {
    if (this.removeImage) return '';
    return this.previewObjectUrl || this.product?.imageUrl || '';
  }

  pickImage(input: HTMLInputElement): void {
    if (this.isUploading || this.isSaving) return;
    if (!this.uploadService.isConfigured) {
      void this.toast('Photo uploads are not set up on this build.', 'danger');
      return;
    }
    input.click();
  }

  onFilePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset immediately, otherwise re-picking the same file fires no change event.
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      void this.toast('Please choose an image file.', 'danger');
      return;
    }
    this.revokePreview();
    this.removeImage = false;
    this.pendingFile = file;
    this.previewObjectUrl = URL.createObjectURL(file);
  }

  clearPending(): void {
    this.revokePreview();
    this.pendingFile = null;
  }

  private revokePreview(): void {
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = '';
    }
  }

  /** Falls back to the placeholder so a broken Cloudinary URL is not a blank box. */
  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img && !img.src.endsWith('placeholder-scoop.svg')) {
      img.src = 'assets/placeholder-scoop.svg';
    }
  }

  cancel(): void {
    void this.modalCtrl.dismiss();
  }

  async save(): Promise<void> {
    if (!this.product || this.isSaving) return;
    const name = this.variantName.trim();
    if (!name) {
      await this.toast('Variant name is required.', 'danger');
      return;
    }

    this.isSaving = true;
    try {
      // Upload before writing the product doc, so a failed upload leaves the
      // stored URL untouched rather than blanking the photo.
      let imageUrl: string | undefined;
      if (this.pendingFile) {
        this.isUploading = true;
        try {
          imageUrl = await this.uploadService.uploadProductImage(this.pendingFile);
        } finally {
          this.isUploading = false;
        }
      } else if (this.removeImage) {
        imageUrl = '';
      }

      // Stock is deliberately not touched here — it is edited from the
      // inventory list's steppers, so this modal only owns the descriptive
      // fields and the price.
      const patch: Parameters<InventoryService['updateProductDetails']>[1] = {
        variantName: name,
        description: this.description.trim(),
      };
      // Only when a price actually moved. Sending it unconditionally would
      // rewrite the pricing map on every rename, which is how an unrelated edit
      // turns into a silent price change.
      if (this.priceChanged) patch.pricing = { ...this.price };
      // Only send category when it actually differs from what is stored, so
      // renaming a flavor of a category-less product does not backfill the field
      // as a side effect of an unrelated edit.
      if (this.category !== productCategory(this.product)) {
        patch.category = this.category as ProductCategory;
      }
      // Only send imageUrl when it actually changes, so an unrelated rename
      // never rewrites the photo field.
      if (imageUrl !== undefined) patch.imageUrl = imageUrl;

      await this.inventoryService.updateProductDetails(this.product.id, patch);
      await this.toast('✅ Product updated.', 'success');
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err: unknown) {
      await this.toast(err instanceof Error ? err.message : 'Failed to update product.', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, color, duration: 2500, position: 'top' });
    await t.present();
  }
}
