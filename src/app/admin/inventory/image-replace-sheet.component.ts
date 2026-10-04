// src/app/admin/inventory/image-replace-sheet.component.ts
// Five-orites Scoop — Click a product image on the inventory card to replace it
//
// WHY A SEPARATE SHEET
// The inventory card already had a Details modal, but reaching the image
// replace flow meant: open Details, scroll past four text fields, tap the
// image, pick a file, then Save. Six steps to change a photo, and the photo was
// the one thing on that card an admin most often needed to fix.
//
// This is the same upload path (ImageUploadService.uploadProductImage) and the
// same Firestore write, just reached in one tap. It is a sheet rather than a
// full modal because it is one decision with one outcome, and because it has to
// dismiss itself — the card behind it re-renders from the live snapshot, so
// there is nothing to confirm afterwards.
//
// The `object-fit` / `aspect-ratio` contract is the part that matters for the
// "container resizes cleanly" requirement: the card thumbnail is locked to a
// 4:3 box, so a portrait upload and a panorama upload both fill it without
// distorting, and the card's height does not change when the image is replaced.

import { Component, inject, signal } from '@angular/core';
import { ModalController } from '@ionic/angular/standalone';

import { InventoryService } from '../../core/services/inventory.service';
import { ImageUploadService } from '../../core/services/image-upload.service';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import type { Product } from '../../core/models/product.model';

@Component({
  selector: 'app-image-replace-sheet',
  standalone: true,
  imports: [AppIconComponent],
  template: `
    <div class="sheet">
      <header class="sheet-head">
        <h2 class="sheet-title">Product photo</h2>
        <p class="sheet-sub">{{ product?.variantName }}</p>
      </header>

      <button
        type="button"
        class="drop"
        (click)="pick(fileInput)"
        (keydown.enter)="pick(fileInput)"
        (keydown.space)="pick(fileInput); $event.preventDefault()"
        [disabled]="busy()"
        [attr.aria-label]="'Choose a new photo for ' + (product?.variantName ?? 'this product')"
      >
        <!--
          A fixed 4:3 box with object-fit: cover. The card thumbnail uses the
          same ratio, so replacing the image cannot change the card's height —
          which is what stops a portrait upload from making one row on the page
          taller than its neighbours.
        -->
        <span class="drop-frame">
          <img
            [src]="preview || product?.imageUrl || 'assets/placeholder-scoop.svg'"
            alt=""
            class="drop-img"
          />
          @if (busy()) {
            <span class="drop-veil">Uploading…</span>
          } @else {
            <span class="drop-cta">
              <app-icon name="image-plus" />
              <span>Choose photo</span>
            </span>
          }
        </span>
      </button>

      <input #fileInput type="file" accept="image/*" hidden (change)="onPicked($event)" />

      <p class="sheet-note">
        Landscape photos work best. The image is cropped to fill, never stretched.
      </p>

      @if (error()) {
        <p class="sheet-error" role="alert">{{ error() }}</p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .sheet {
        padding: var(--space-5) var(--space-4) var(--space-4);
      }

      .sheet-head {
        margin-bottom: var(--space-4);
      }
      .sheet-title {
        margin: 0;
        font-family: var(--font-display);
        font-size: 19px;
        font-weight: 600;
        color: var(--color-ink);
      }
      .sheet-sub {
        margin: 2px 0 0;
        font-size: 13px;
        color: var(--ion-color-medium);
      }

      .drop {
        display: block;
        width: 100%;
        padding: 0;
        background: none;
        border: 0;
        cursor: pointer;
        font: inherit;
      }
      .drop:disabled {
        cursor: progress;
      }

      .drop-frame {
        position: relative;
        display: block;
        aspect-ratio: 4 / 3;
        border-radius: var(--radius-md);
        overflow: hidden;
        background: var(--tile-powder);
        border: 2px dashed var(--color-primary-ink);
      }

      .drop-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .drop-cta {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        /* A scrim rather than nothing, so the label stays readable over an
         arbitrary photo — a white label on a pale ice-cream shot is not. */
        background: rgb(36 24 51 / 0.55);
        color: var(--color-white);
        font-size: 14px;
        font-weight: 700;
      }
      .drop-cta app-icon {
        --icon-size: 26px;
      }

      .drop-veil {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgb(36 24 51 / 0.55);
        color: var(--color-white);
        font-size: 14px;
        font-weight: 700;
      }

      .sheet-note {
        margin: var(--space-3) 0 0;
        font-size: 12px;
        line-height: 1.45;
        color: var(--ion-color-medium);
      }

      .sheet-error {
        margin: var(--space-3) 0 0;
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-xs);
        background: var(--tone-danger-bg);
        border: 1px solid var(--tone-danger-border);
        color: var(--tone-danger-ink);
        font-size: 12px;
        line-height: 1.45;
      }
    `,
  ],
})
export class ImageReplaceSheetComponent {
  private readonly modalCtrl = inject(ModalController);
  private readonly inventory = inject(InventoryService);
  private readonly uploads = inject(ImageUploadService);

  /** Set by ModalController from the page that presents this sheet. */
  product?: Product;

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly preview = signal('');

  protected pick(input: HTMLInputElement): void {
    if (this.busy()) return;
    this.error.set('');
    input.click();
  }

  protected async onPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset immediately. Without this, picking the SAME file twice in a row
    // fires no change event at all and the second attempt silently does
    // nothing — a genuinely confusing failure on a "choose photo" control.
    input.value = '';
    if (!file || !this.product) return;

    this.busy.set(true);
    this.error.set('');
    // Local preview first, so the sheet shows the new photo immediately rather
    // than the old one until the upload lands.
    this.preview.set(URL.createObjectURL(file));
    try {
      const url = await this.uploads.uploadProductImage(file);
      await this.inventory.updateProductDetails(this.product.id, { imageUrl: url });
      await this.modalCtrl.dismiss(true);
    } catch (err: unknown) {
      this.error.set(
        err instanceof Error ? err.message : 'Could not upload that photo. Try again.',
      );
      this.preview.set('');
    } finally {
      this.busy.set(false);
    }
  }
}
