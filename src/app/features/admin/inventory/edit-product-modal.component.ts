// src/app/features/admin/inventory/edit-product-modal.component.ts
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
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { InventoryService } from '@core/services/catalog/inventory.service';
import { ImageUploadService } from '@core/services/catalog/image-upload.service';
import { Product, SizePricing, SizeVariant } from '@core/models/product.model';
import { SIZE_DISPLAY_LABELS } from '@core/config/pricing.config';
import { flavourOf } from '@core/logic/flavour';
import { CloudinaryPipe } from '@shared/pipes/cloudinary.pipe';

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
    IonFooter,
    CloudinaryPipe,
  ],
  template: `
    <!--
      The FLAT header, the same one the admin's pages carry: a white bar, one
      hairline along the bottom, and the title in the plain body face.

      It was the storefront's header — the candy stripe, the retro script, the
      gold sticker shadow under the letters — inside a form an admin uses all
      day. The stripe is a gradient and the sticker is a hard offset shadow,
      which is the opposite of what a sheet of fields should look like.
    -->
    <ion-header class="flat-header">
      <ion-toolbar>
        <ion-title>Edit Product</ion-title>
        <ion-buttons slot="end">
          <ion-button class="close-btn" (click)="cancel()">Close</ion-button>
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
                class="modal-input"
              ></ion-input>
            </ion-item>
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
              answer "Chocolate" for every one of them. core/logic/flavour.ts lists
              them.

              This used to be described as distinct from a Type control answering a
              different question (what FORM the product is, vs which FLAVOUR).
              There is no Type control in this modal any more: it was removed
              because nothing here can change a product's form, and the one
              non-flavor in the catalog was never edited from here. See the note on
              category in save().
            -->
            <ion-item>
              <ion-input
                label="Flavor"
                labelPlacement="stacked"
                [value]="flavour()"
                readonly
                aria-label="Flavor, derived from the product's set"
                class="modal-input"
              ></ion-input>
            </ion-item>
            <ion-item>
              <ion-textarea
                label="Description"
                labelPlacement="stacked"
                rows="3"
                [(ngModel)]="description"
                class="modal-input"
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
                  class="modal-input"
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
              [src]="(previewImage | cloudinary: 600) || '/assets/placeholder-scoop.svg'"
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
      <!--
        A PLAIN <button>, not an ion-button, and that is a bug fix rather than a
        preference.

        Ionic paints a solid button that sits INSIDE A TOOLBAR with the toolbar's
        colour rather than the button's own — the inner element's background is
        var(--ion-toolbar-color, var(--background)). In this app the toolbar
        colour is the plum, so the Save action came out a plum slab with plum
        text on it — invisible, and the one control in the sheet that had to
        work.

        The plain button is also the app's own pattern: every gold CTA in the
        admin is a plain <button>, and this is the same treatment — an amber
        fill, plum ink, one radius, no border, no shadow, and a teal hover.
      -->
      <button type="button" class="save-btn" [disabled]="isSaving || !product" (click)="save()">
        {{ isSaving ? 'Saving…' : 'Save Changes' }}
      </button>
    </ion-footer>
  `,
  styles: [
    `
      /* ROOM. The sheet was 680px wide with 16px of padding and a field every
         few pixels, which is what "cramped" means: nothing had space around
         it, so the form read as a stack of boxes rather than as a set of
         questions. The width is the shared .large-sheet-modal's business; the
         padding and the gaps between the fields are here. */
      ion-content {
        --padding: 20px 24px 24px;
      }

      .section-title {
        font-size: 15px;
        font-weight: 800;
        color: var(--color-ink);
        margin: 24px 0 10px;
      }
      .section-title:first-of-type {
        margin-top: 4px;
      }

      /* THE FIELDS ARE SEPARATE BOXES, not rows pressed together.

         The list was a rounded card with a drop shadow and the fields inside
         it, touching: one rounded block with four boxes in it, which is two
         surfaces saying the same thing. Now the list is nothing — no card, no
         shadow, no radius — and each field is its own flat box with room
         between it and the next.

         The row's padding is the gap: ion-item's --padding-bottom is what
         separates one field from the next, and the item itself adds no
         background or border of its own. */
      .card-list {
        background: transparent;
        border: 0;
        border-radius: 0;
        box-shadow: none;
        padding: 0;
        margin: 0;
        overflow: visible;
      }
      .card-list ion-item {
        --background: transparent;
        --padding-start: 0;
        --padding-end: 0;
        --inner-padding-end: 0;
        --border-width: 0;
        padding-bottom: 12px;
      }
      .pricing-note {
        margin: -6px 0 12px;
        font-size: 12px;
        line-height: 1.45;
        color: var(--ion-color-medium);
      }
      /* Two columns of price boxes rather than four stacked rows — the four sizes
       are a set the admin reads ACROSS, not a list they read down. */
      .price-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0 14px;
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
      /* The image preview gets room too: the frame was 420px wide and the
         picture 280px tall, which on a 760px sheet left the photo looking
         like a stamp in the middle of the page. */
      .image-frame {
        position: relative;
        margin-block: auto;
        margin-inline: auto;
        width: 100%;
        max-width: 480px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        background: var(--color-brand-light);
        border: 1px solid var(--tile-powder-deep);
        cursor: pointer;
        transition:
          border-color 150ms ease,
          box-shadow 150ms ease;
      }
      .image-frame:hover {
        border-color: var(--color-primary-ink);
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
        height: 320px;
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
      .modal-input {
        width: 100%;
        min-height: 44px;
        border: 1px solid var(--tile-powder-deep);
        border-radius: var(--radius-xs);
        background: var(--color-white);
        color: var(--color-ink);
        font: inherit;
        font-size: 15px;
      }
      /* Host element, not ::part(input): Ionic 7 exposes no shadow part on
         ion-input / ion-textarea, so ::part(input) matched nothing and the
         padding written through it was silently dropped. The text inset comes
         from --padding-start / --padding-end in global.scss, which is the only
         mechanism that actually reaches the native control. */
      .modal-input:focus-within {
        border-color: var(--color-primary-ink) !important;
      }
      /* Pinned action bar: the button stays at the bottom while ion-content scrolls.

         A HAIRLINE, not a shadow, and NO violet strip. The strip was there to
         "close the modal off" — three pixels of brand violet along the bottom
         edge of a sheet — which is the poster voice, and it put a second accent
         under a form whose action is already the loudest thing in it. One
         hairline says "the content stops here" and says nothing else. */
      ion-footer {
        box-shadow: none;
        border-top: 1px solid var(--tile-powder-deep);
        background: var(--color-white);
        padding: 14px 24px 18px;
      }
      /* The quiet Close control in the header: a pill of plain type in the
         primary ink, sentence case. It was a bare "CLOSE" in the toolbar's own
         voice — uppercase, tracked out, the same shout the modal had all over
         it. */
      ion-button.close-btn {
        --color: var(--color-primary-ink);
        --background: transparent;
        --background-hover: var(--tile-powder);
        --background-hover-opacity: 1;
        --border-radius: var(--radius-pill);
        --padding-start: 14px;
        --padding-end: 14px;
        font-size: 13px;
        font-weight: 700;
        text-transform: none;
        letter-spacing: 0;
        margin: 0;
      }
      /* THE APP'S GOLD CTA, the same one the admin's pages use for their primary
         action: an amber fill with plum ink, one radius, no border, no shadow.

         THE HOVER IS TEAL, and the focus ring goes with it, for the same reason
         the admin's gold CTAs do it: a teal outline drawn around a gold button
         reads as a sticker around it; a teal fill is the button itself changing
         state. */
      .save-btn {
        display: block;
        width: 100%;
        min-height: 48px;
        border: 0;
        border-radius: var(--radius-pill);
        background: var(--color-brand-accent);
        color: var(--color-ink);
        font: inherit;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0;
        cursor: pointer;
        transition:
          background-color 0.15s ease,
          color 0.15s ease;
      }
      .save-btn:hover:not(:disabled) {
        background: var(--color-primary-ink);
        color: var(--color-white);
      }
      .save-btn:focus-visible {
        outline: 2px solid var(--color-primary-ink);
        outline-offset: 2px;
      }
      .save-btn:disabled {
        opacity: 0.55;
        cursor: default;
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
      img.src = '/assets/placeholder-scoop.svg';
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

      // Stock is deliberately not touched here — it is entered when a product is
      // created and adjusted from the inventory list's steppers, so this modal
      // only owns the descriptive fields and the price.
      const patch: Parameters<InventoryService['updateProductDetails']>[1] = {
        variantName: name,
        description: this.description.trim(),
      };
      // Only when a price actually moved. Sending it unconditionally would
      // rewrite the pricing map on every rename, which is how an unrelated edit
      // turns into a silent price change.
      if (this.priceChanged) patch.pricing = { ...this.price };
      // `category` is absent from this patch ON PURPOSE, and it is the one field
      // whose absence is load-bearing rather than merely untidy.
      //
      // `updateProductDetails` calls `updateDoc`, which is a field-level merge:
      // keys the patch does not mention are left exactly as they are. Omitting
      // `category` therefore means the sundae in the catalog keeps its
      // `category: 'sundae'`, and the sixty-five products written before the
      // field existed keep having no field at all — neither group can be
      // flattened by renaming a flavor here.
      //
      // The alternative was to carry the loaded value through on every save,
      // which would BACKFILL `category: 'flavor'` onto all sixty-five as a side
      // effect of an unrelated edit. There is no Type control left in this modal
      // to make that a deliberate act, so there is nothing to send.
      // Only imageUrl is written when it actually changes, so an unrelated
      // rename never rewrites the photo field.
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
