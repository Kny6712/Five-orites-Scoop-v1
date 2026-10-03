// src/app/admin/inventory/inventory.page.ts
// Five-orites Scoop — Admin Inventory Manager

import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton,
  IonSearchbar,
  IonButton, IonSkeletonText, IonRefresher, IonRefresherContent,
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonChip, AlertController, ToastController, ModalController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { CloudinaryPipe } from '../../shared/pipes/cloudinary.pipe';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { Subscription } from 'rxjs';
import { InventoryService } from '../../core/services/inventory.service';
import { Product, SizeVariant, StockLevel } from '../../core/models/product.model';
import { SIZE_DISPLAY_LABELS } from '../../core/config/pricing.config';
import { ShopSettingsService } from '../../core/services/shop-settings.service';
import { parseProductCsv, slug, PRODUCT_CSV_TEMPLATE, type ImportPlan } from '../../core/logic/csv-import';
import { CsvExportService } from '../../core/services/csv-export.service';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { AddProductModalComponent } from './add-product-modal.component';
import { EditProductModalComponent } from './edit-product-modal.component';
import { ImageReplaceSheetComponent } from './image-replace-sheet.component';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton,
    IonSearchbar,
    IonButton,
    IonSkeletonText, IonRefresher, IonRefresherContent,
    IonCard, IonCardContent, IonCardHeader, IonCardTitle,
    IonChip,
    AppIconComponent, EmptyStateComponent, PaginationComponent, CloudinaryPipe,
    AppFooterComponent, AlertBannerComponent],
  templateUrl: './inventory.page.html',
  styleUrls: ['./inventory.page.scss'],
})
export class InventoryPage implements OnInit, OnDestroy {
  private inventoryService = inject(InventoryService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private modalCtrl = inject(ModalController);
  private sub?: Subscription;

  /**
   * Eight cards a page.
   *
   * The catalog is 64 flavor variants, and rendering all of them meant a scroll
   * long enough that the Active pill and the quantity steppers — the two things
   * this page exists for — were below the fold on a phone. The live Firestore
   * snapshot still holds every product; only the RENDER is paged, so a stock
   * change arriving from a customer checkout on page 3 still repaints
   * correctly, and a search still spans the whole catalog.
   */
  readonly PAGE_SIZE = 8;

  products = signal<Product[]>([]);
  filteredProducts = signal<Product[]>([]);
  isLoading = signal(true);
  /**
   * Set when the catalog read fails. An empty list here used to mean two very
   * different things — "the shop has no products" and "we were not allowed /
   * could not reach Firestore" — and the page showed the same screen for both.
   */
  loadError = signal('');

  /** 1-based. Reset to 1 on search, so a filtered set never opens on a page 4. */
  readonly page = signal(1);

  readonly totalCount = computed(() => this.filteredProducts().length);

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalCount() / this.PAGE_SIZE))
  );

  readonly pagedProducts = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.filteredProducts().slice(start, start + this.PAGE_SIZE);
  });

  /**
   * Product id whose stock steppers are mid-write, if any.
   *
   * One id rather than a set: at most one adjust is in flight, and both
   * stepper buttons on EVERY card are disabled while it runs — so the global
   * early-return in adjustStock() can never be reached via an enabled-looking
   * button. Matches the `busySizeId() !== null` disable summary in the template.
   */
  readonly busySizeId = signal<string | null>(null);

  readonly sizes: SizeVariant[] = ['cup', 'pint', 'halfGallon', 'gallon'];
  readonly sizeLabels = SIZE_DISPLAY_LABELS;
  /**
   * The admin-editable threshold.
   *
   * `watch()` rather than `load()`: this page renders stock pills against the
   * threshold, so a change made on the Shop Settings page should repaint the
   * list rather than needing a reload.
   */
  private readonly shop = inject(ShopSettingsService);
  private csvExport = inject(CsvExportService);
  readonly lowStockThreshold = computed(() => this.shop.lowStockThreshold());
  skeletonItems = Array(6).fill(0);

  // ── Bulk CSV import ────────────────────────────────────────────────────────
  /* README and REFACTOR_PLAN.md both deferred "CSV bulk product import". The
     validation lives in `core/logic/csv-import.ts` and is all-or-nothing: one
     bad row rejects the whole file, because a partial import is the one outcome
     an admin cannot recover from — 40 of 64 flavors written with no record of
     which 40 leaves a catalog nothing else can describe as correct. */
  readonly importOpen = signal(false);
  readonly importPlan = signal<ImportPlan | null>(null);
  readonly importing = signal(false);

  readonly importValid = computed(() => this.importPlan()?.valid ?? []);
  readonly importErrors = computed(() => this.importPlan()?.errors ?? []);
  readonly importUnknown = computed(() => this.importPlan()?.unknownColumns ?? []);

  toggleImport(): void {
    this.importOpen.update((v) => !v);
    if (!this.importOpen()) this.resetImport();
  }

  closeImport(): void {
    this.importOpen.set(false);
    this.resetImport();
  }

  resetImport(): void {
    this.importPlan.set(null);
    this.importing.set(false);
  }

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

    // Existing ids, so a row that would silently UPDATE a live flavor is
    // reported rather than quietly overwriting it.
    const existing = new Set(this.products().map((p) => `${p.setNumber}_${slug(p.variantName)}`));
    this.importPlan.set(parseProductCsv(text, existing));
  }

  /**
   * Writes the validated rows.
   *
   * Sequential, not parallel: `createProduct` is a `setDoc` each, and firing 64
   * of them at once is how a mobile browser earns a rate-limit error halfway
   * through, leaving a partial import — the exact state the validator exists to
   * prevent.
   *
   * The count of failures is reported rather than swallowed. A run that stops at
   * the first error would leave the admin with a partial catalog AND no idea how
   * far it got; continuing and reporting is recoverable, stopping is not.
   */
  async commitImport(): Promise<void> {
    const rows = this.importValid();
    if (!rows.length || this.importing()) return;

    this.importing.set(true);
    let written = 0;
    const failures: string[] = [];

    for (const row of rows) {
      try {
        await this.inventoryService.createProduct({
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
    await this.loadProducts();

    if (failures.length) {
      await this.toast(
        `${written} imported, ${failures.length} failed: ${failures.slice(0, 3).join(', ')}`,
        'warning'
      );
      // The failures stay in the panel so they can be fixed and re-tried, rather
      // than disappearing along with the successful ones.
      this.importPlan.set({
        valid: [],
        errors: failures.map((name, i) => ({ line: i + 1, message: `"${name}" could not be written` })),
        unknownColumns: [],
        skipped: 0,
      });
      return;
    }

    await this.toast(`${written} flavor${written === 1 ? '' : 's'} imported.`, 'success');
    this.closeImport();
  }

  /**
   * The import template is the one export a phone most needs.
   *
   * It is also the export most likely to be used on a device: an admin standing
   * in the shop with stock to add is exactly who has no laptop. The old
   * anchor-click did nothing there, so the import feature was unreachable on the
   * platform the app ships to.
   */
  async downloadTemplate(): Promise<void> {
    await this.csvExport.export(PRODUCT_CSV_TEMPLATE, 'five-orites-product-template.csv');
  }

  ngOnInit(): void {
    this.shop.watch();
    this.loadProducts();
  }
  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.shop.stop();
  }

  loadProducts(): void {
    this.isLoading.set(true);
    this.loadError.set('');
    this.sub?.unsubscribe();
    // getAllProducts, not getProducts: the admin must see deactivated products,
    // otherwise there is no card to edit their stock or flip them back on.
    this.sub = this.inventoryService.getAllProducts().subscribe({
      next: (products) => {
        const normalised = products.map((p) => ({
          ...p,
          // Defence: a legacy/partial doc may lack some or all of `stock`, and
          // the template dereferences product.stock[size] directly. Normalise to a
          // full four-key map here so the page renders the product instead of
          // throwing on the first partial doc.
          stock: { cup: 0, pint: 0, halfGallon: 0, gallon: 0, ...((p.stock as Partial<StockLevel>) ?? {}) },
        }));
        this.products.set(normalised);
        this.filteredProducts.set(normalised);
        this.page.set(1);
        this.isLoading.set(false);
      },
      error: (err: unknown) => {
        // console.error alone was not enough: the page still rendered "0
        // products" with an empty list, which an admin reads as a wiped
        // catalog rather than a failed read.
        console.error('Load products error:', err);
        this.products.set([]);
        this.filteredProducts.set([]);
        this.loadError.set(describeFirestoreError('the catalog', err));
        this.isLoading.set(false);
      },
    });
  }

  onSearch(event: CustomEvent): void {
    const q = (event.detail.value ?? '').toLowerCase();
    this.filteredProducts.set(
      q ? this.products().filter(
        (p) => p.variantName.toLowerCase().includes(q) || p.setName.toLowerCase().includes(q)
      ) : this.products()
    );
    // A search can shrink the result set below the current page, which would
    // otherwise leave the list blank with the pager on page 4 of 1.
    this.page.set(1);
  }

  /**
   * Move one size's stock by +/- 1.
   *
   * The write is a transaction (see InventoryService.adjustStock), so two admins
   * adjusting the same size at the same time both land rather than one increment
   * being lost to a read-modify-write race. The value on screen comes from the
   * live snapshot, so the displayed number updates when Firestore confirms — not
   * when the click is handled. That is why there is no optimistic local
   * increment here: it would be overwritten a moment later by the snapshot, and
   * if the write failed the flash would have to be walked back.
   */
  async adjustStock(product: Product, size: SizeVariant, delta: number): Promise<void> {
    if (this.busySizeId()) return;
    this.busySizeId.set(product.id);
    try {
      await this.inventoryService.adjustStock(product.id, size, delta);
    } catch (err: unknown) {
      await this.toast(describeFirestoreError('stock levels', err), 'danger');
    } finally {
      this.busySizeId.set(null);
    }
  }

  /**
   * Open the photo replacement sheet for a product.
   *
   * No reload on dismiss: the Firestore snapshot is live, so the card behind the
   * sheet repaints by itself the moment the URL lands. Reloading would throw away
   * the scroll position and the current page number for a one-field change.
   *
   * busyImageId is therefore no longer needed here — the sheet owns its own
   * uploading state and dismisses itself on success, so there is never a state
   * left behind on the card to clear.
   */
  async replaceImage(product: Product): Promise<void> {
    const sheet = await this.modalCtrl.create({
      component: ImageReplaceSheetComponent,
      componentProps: { product },
      cssClass: 'large-sheet-modal',
    });
    await sheet.present();
  }

  async toggleActive(product: Product): Promise<void> {
    const action = product.isActive ? 'deactivate' : 'activate';
    const alert = await this.alertCtrl.create({
      header: `${product.isActive ? 'Deactivate' : 'Activate'} Product`,
      message: `Are you sure you want to ${action} "${product.variantName}"?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          handler: async () => {
            try {
              await this.inventoryService.updateProductActive(product.id, !product.isActive);
              await this.toast(`Product ${action}d.`, 'success');
            } catch (err: unknown) {
              await this.toast(
                describeFirestoreError('that product', err),
                'danger'
              );
            }
          },
        }],
    });
    await alert.present();
  }

  /**
   * Confirm and perform a permanent delete.
   *
   * The dialog states the consequence in the message rather than only in the
   * button label, because "Delete" on a confirm dialog is ambiguous about
   * whether it is reversible — and here it is not. To take a flavor off the
   * shelf without losing it, the Active pill is the control; the two do very
   * different things and the copy says so.
   *
   * The flavor's total stock is named in the message so an admin about to lose
   * 40 units of inventory can see the size of the mistake first.
   */
  async confirmDelete(product: Product): Promise<void> {
    const total = this.sizes.reduce((sum, s) => sum + (product.stock?.[s] ?? 0), 0);
    const alert = await this.alertCtrl.create({
      header: `Delete ${product.variantName}?`,
      cssClass: 'alert-danger',
      message:
        `This permanently removes the flavor and its ${total} units of stock. ` +
        `It cannot be undone. To take it off the shelf without losing it, use the ` +
        `Active pill instead.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete permanently',
          cssClass: 'alert-danger-button',
          handler: async () => {
            try {
              await this.inventoryService.deleteProduct(product.id);
              await this.toast(`${product.variantName} deleted.`, 'success');
              // If the deleted card was the only one on the last page, step back
              // rather than leaving the pager on a page that no longer exists.
              if (this.page() > this.totalPages()) this.page.set(this.totalPages());
            } catch (err: unknown) {
              await this.toast(
                describeFirestoreError('that flavor', err),
                'danger'
              );
            }
          },
        },
      ],
    });
    await alert.present();
  }

  handleRefresh(event: CustomEvent): void {
    this.loadProducts();
    setTimeout(() => (event.target as HTMLIonRefresherElement).complete(), 1000);
  }

  async bulkRestock(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Bulk Restock',
      message: 'Add the same amount to EVERY size of ALL active products.',
      inputs: [{ name: 'amount', type: 'number', placeholder: 'e.g. 10', min: 1 }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Restock All',
          handler: async (data) => {
            const amount = Math.floor(Number(data?.amount));
            if (!Number.isInteger(amount) || amount <= 0) {
              void this.toast('Enter a positive whole number.', 'danger');
              return;
            }
            try {
              const count = await this.inventoryService.bulkRestock(amount);
              await this.toast(`Restocked ${count} products (+${amount} each size).`, 'success');
            } catch (err: unknown) {
              await this.toast(describeFirestoreError('the catalog', err), 'danger');
            }
          },
        }],
    });
    await alert.present();
  }

  // ── Add Product: dropdown form (flavor-set list + New), with description ───
  async addProduct(): Promise<void> {
    const loaded = this.products();
    const modal = await this.modalCtrl.create({
      component: AddProductModalComponent,
      componentProps: {
        maxSetNumber: loaded.length > 0 ? Math.max(...loaded.map((p) => p.setNumber)) : 8,
        // isActive travels with each variant so the modal can list deactivated
        // flavors as unavailable rather than silently omitting them — otherwise
        // the only way to bring one back is to create a duplicate.
        variants: loaded.map((p) => ({
          setNumber: p.setNumber,
          setName: p.setName,
          variantName: p.variantName,
          isActive: p.isActive,
        })),
      },
    });
    await modal.present();
  }

  async editDetails(product: Product): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: EditProductModalComponent,
      componentProps: { product },
      cssClass: 'large-sheet-modal',
    });
    await modal.present();
  }

  private async toast(message: string, color: 'success' | 'danger' | 'warning'): Promise<void> {
    const t = await this.toastCtrl.create({ message, color, duration: 2500, position: 'top' });
    await t.present();
  }
}
