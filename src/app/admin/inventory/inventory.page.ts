// src/app/admin/inventory/inventory.page.ts
// Five-orites Scoop — Admin Inventory Manager

import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonSearchbar,
  IonButton,
  IonSkeletonText,
  IonRefresher,
  IonRefresherContent,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonChip,
  AlertController,
  ToastController,
  ModalController,
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
import { totalStock } from '../../core/logic/stock';
import { ShopSettingsService } from '../../core/services/shop-settings.service';
import { slug } from '../../core/logic/csv-import';
import { CsvImportModalComponent } from './csv-import-modal.component';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { AddProductModalComponent } from './add-product-modal.component';
import { EditProductModalComponent } from './edit-product-modal.component';
import { ImageReplaceSheetComponent } from './image-replace-sheet.component';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonMenuButton,
    IonSearchbar,
    IonButton,
    IonSkeletonText,
    IonRefresher,
    IonRefresherContent,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonChip,
    AppIconComponent,
    EmptyStateComponent,
    PaginationComponent,
    CloudinaryPipe,
    AppFooterComponent,
    AlertBannerComponent,
  ],
  templateUrl: './inventory.page.html',
  styleUrls: ['./inventory.page.scss'],
  /*
    The set-filter chip row, copied verbatim from admin/users
    (.role-chips / .role-chip / .role-chip.active) rather than written fresh, so
    the two admin surfaces look like one app instead of a shared design system
    with two implementations of it.

    In the decorator and not in inventory.page.scss because that file is outside
    the ownership boundary of this change; the rules are the same three blocks,
    and they can move next to .inv-header in the stylesheet whenever the file is
    next opened. No `.active` rule of its own is needed on top of these — the
    pressed state is the filled pill, exactly as on /admin/users.
  */
  styles: [
    `
      .role-chips {
        display: flex;
        gap: var(--space-2);
        margin-top: var(--space-3);
        flex-wrap: wrap;
      }

      .role-chip {
        min-height: 38px;
        padding: 0 var(--space-4);
        border-radius: var(--radius-pill);
        border: 1px solid var(--color-primary-ink);
        background: transparent;
        color: var(--color-primary-ink);
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition:
          background-color 0.15s ease,
          color 0.15s ease;
      }

      .role-chip.active {
        background: var(--color-brand-primary);
        color: var(--color-ink);
      }
    `,
  ],
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
  isLoading = signal(true);
  /**
   * Set when the catalog read fails. An empty list here used to mean two very
   * different things — "the shop has no products" and "we were not allowed /
   * could not reach Firestore" — and the page showed the same screen for both.
   */
  loadError = signal('');

  /**
   * The search text, held as a signal rather than folded straight into a list.
   *
   * `onSearch` used to push the narrowed array straight into `filteredProducts`,
   * which left nothing behind to ask the question the set chips are answered
   * from: what does the search admit, ignoring the set filter?
   */
  searchTerm = signal('');

  /**
   * The set filter: `'all'`, or one `setNumber` from the loaded catalog.
   *
   * A number and not a name, because `setNumber` is what every product actually
   * carries, and it is what the cards already show beside the set name.
   */
  readonly setFilter = signal<number | 'all'>('all');

  /**
   * Everything the SEARCH admits, with the set filter deliberately not applied.
   *
   * This intermediate step exists only so `setChips` can be counted against it.
   * A chip counting the whole catalog makes a promise the click cannot keep:
   * search "mint", read "Chocolates (8)", tap it, and get nothing back — because
   * none of those eight match "mint". A count is a forecast of what clicking
   * will yield, so it has to be computed from the narrower of the two inputs.
   */
  readonly searchScoped = computed(() => {
    const q = this.searchTerm().trim().toLowerCase();
    return q
      ? this.products().filter(
          (p) => p.variantName.toLowerCase().includes(q) || p.setName.toLowerCase().includes(q),
        )
      : this.products();
  });

  /**
   * What the grid renders: the search, then the set filter on top of it.
   *
   * Derived, not written by two handlers into one signal — the count line, the
   * pager and the empty state all read this, and there is now no way for them to
   * describe a different list from the rows.
   */
  readonly filteredProducts = computed(() => {
    const set = this.setFilter();
    return set === 'all'
      ? this.searchScoped()
      : this.searchScoped().filter((p) => p.setNumber === set);
  });

  /**
   * One chip per set in the catalog, each labelled with how many of its flavors
   * the current SEARCH admits.
   *
   * Derived from the loaded products, and NOT from `SET_NAMES` in
   * core/config/pricing.config.ts, which is the obvious thing to reach for and is
   * wrong here: that constant defines sets 1–8 only, while the live catalog
   * carries a ninth — set 9, Pistachio — that it has never heard of. A chip row
   * built from it would list eight of the nine sets and hide Pistachio from the
   * one admin whose entire job is to restock it. Which sets exist is data, and
   * the honest source for it is the data.
   *
   * Two passes because there are two questions. `products()` says which sets
   * exist at all; `searchScoped` says how many of each the search admits. A set
   * the search misses keeps its chip at "(0)" instead of disappearing: a chip row
   * that rearranged itself under a search would drop the ACTIVE chip out of view
   * at the exact moment the grid went empty, leaving no pressed chip to explain
   * the empty grid.
   */
  readonly setChips = computed(() => {
    const counts = new Map<number, number>();
    for (const p of this.searchScoped()) {
      counts.set(p.setNumber, (counts.get(p.setNumber) ?? 0) + 1);
    }
    const names = new Map<number, string>();
    for (const p of this.products()) {
      // First name seen wins, so a doc renamed after its set-mates still yields
      // one chip rather than two. The `||` is the same defence loadProducts
      // applies to a partial doc: a missing setName must not render a chip with
      // nothing in it but a count.
      if (!names.has(p.setNumber)) names.set(p.setNumber, p.setName || `Set ${p.setNumber}`);
    }
    return [...names]
      .map(([setNumber, label]) => ({ setNumber, label, count: counts.get(setNumber) ?? 0 }))
      .sort((a, b) => a.setNumber - b.setNumber);
  });

  /**
   * The active set's name, for the empty state.
   *
   * Needed because a "(0)" chip can be the active one: the grid is then empty,
   * with no card left to show which set is narrowing it, and "no product matches
   * that search" sends the admin to the searchbar over a search that was fine.
   */
  readonly activeSetLabel = computed(
    () => this.setChips().find((c) => c.setNumber === this.setFilter())?.label ?? '',
  );

  /**
   * 1-based. Reset to 1 on search AND on a set chip, so a filtered set never
   * opens on a page 4 — or, worse, stays on page 7 after being narrowed to one
   * page of results.
   */
  readonly page = signal(1);

  readonly totalCount = computed(() => this.filteredProducts().length);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.PAGE_SIZE)));

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

  /**
   * Exposed for the template's family-total chip. A thin alias rather than a
   * second sum in the template, so the card and the delete confirmation cannot
   * drift apart.
   */
  readonly totalStock = totalStock;
  readonly sizeLabels = SIZE_DISPLAY_LABELS;
  /**
   * The admin-editable threshold.
   *
   * `watch()` rather than `load()`: this page renders stock pills against the
   * threshold, so a change made on the Shop Settings page should repaint the
   * list rather than needing a reload.
   */
  private readonly shop = inject(ShopSettingsService);
  readonly lowStockThreshold = computed(() => this.shop.lowStockThreshold());
  skeletonItems = Array(6).fill(0);

  // ── Bulk CSV import ────────────────────────────────────────────────────────
  /* README and REFACTOR_PLAN.md both deferred "CSV bulk product import". The
     validation lives in `core/logic/csv-import.ts` and is all-or-nothing: one
     bad row rejects the whole file, because a partial import is the one outcome
     an admin cannot recover from — 40 of 64 flavors written with no record of
     which 40 leaves a catalog nothing else can describe as correct. */
  /**
   * Opens the bulk-import modal.
   *
   * It used to be an inline panel rendered at the very bottom of the page, after
   * the product grid and the pagination, behind a trigger near the top of the
   * viewport — so tapping it changed something well below the fold and nothing
   * appeared to happen. As a modal it opens in the centre of the screen.
   *
   * The existing product keys are handed over so the CSV parser can report a row
   * that would silently overwrite a live flavor. The modal dismisses with what it
   * actually wrote, and the list is refreshed only then — so a cancelled or
   * failed import costs no reads and shows no phantom change.
   */
  async openImport(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CsvImportModalComponent,
      componentProps: {
        existingKeys: this.products().map((p) => `${p.setNumber}_${slug(p.variantName)}`),
      },
      cssClass: 'large-sheet-modal',
    });
    await modal.present();
    const result = (await modal.onDidDismiss())?.data as
      { imported: number; failures: string[] } | undefined;
    if (!result || result.imported === 0) return;
    await this.loadProducts();
    await this.toast(`Imported ${result.imported} flavors.`, 'success');
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
          stock: {
            cup: 0,
            pint: 0,
            halfGallon: 0,
            gallon: 0,
            ...((p.stock as Partial<StockLevel>) ?? {}),
          },
        }));
        this.products.set(normalised);
        this.page.set(1);
        this.isLoading.set(false);
      },
      error: (err: unknown) => {
        // console.error alone was not enough: the page still rendered "0
        // products" with an empty list, which an admin reads as a wiped
        // catalog rather than a failed read.
        console.error('Load products error:', err);
        this.products.set([]);
        this.loadError.set(describeFirestoreError('the catalog', err));
        this.isLoading.set(false);
      },
    });
  }

  onSearch(event: CustomEvent): void {
    this.searchTerm.set(event.detail.value ?? '');
    // A search can shrink the result set below the current page, which would
    // otherwise leave the list blank with the pager on page 4 of 1.
    this.page.set(1);
  }

  /**
   * Apply a set chip.
   *
   * A method rather than `(click)="setFilter.set(chip.setNumber)"` in the
   * template, solely for the reset — and it resets for the reason onSearch does:
   * narrowing to a set shrinks the result set, and the grid would otherwise sit
   * empty with the pager on page 7 of 1.
   *
   * The filter itself survives a search, and vice versa: they are two facets of
   * the same question, and clearing the searchbar should not silently discard a
   * set the admin chose.
   */
  onSetFilter(set: number | 'all'): void {
    this.setFilter.set(set);
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
              await this.toast(describeFirestoreError('that product', err), 'danger');
            }
          },
        },
      ],
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
    // `totalStock` rather than a local reduce, so this figure and the total shown
    // on the card come from one place and cannot quote different numbers for the
    // same product.
    const total = totalStock(product.stock);
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
              await this.toast(describeFirestoreError('that flavor', err), 'danger');
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
        },
      ],
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
