// src/app/features/products/products.page.ts

import {
  Component, OnInit, OnDestroy, ElementRef, ViewChild, inject, signal, computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonSearchbar, IonChip, IonLabel, IonGrid, IonRow, IonCol,
  IonSkeletonText, IonCard, IonCardContent, IonText, IonRefresher, IonRefresherContent,
  IonButtons, IonMenuButton, IonToggle, IonItem,
  IonInfiniteScroll, IonInfiniteScrollContent,
  IonSelect, IonSelectOption, IonSegment, IonSegmentButton, IonButton,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { Subscription } from 'rxjs';
import { catchError, of } from 'rxjs';
import { InventoryService } from '../../core/services/inventory.service';
import { WishlistService } from '../../core/services/wishlist.service';
import { Product, FlavorSet, SizeVariant, ProductSort, ProductCategory, PRODUCT_CATEGORIES, productCategory } from '../../core/models/product.model';
import { ProductCardComponent } from '../../shared/components/product-card/product-card.component';
import { CartButtonComponent } from '../../shared/components/cart-button/cart-button.component';
import { SET_NAMES, SIZE_DISPLAY_LABELS } from '../../core/config/pricing.config';

interface SetChip { label: string; value: FlavorSet | null; }
interface SelectOption<T> { label: string; value: T; }

/**
 * Price ceiling presets, in pesos.
 *
 * Presets rather than a free-text box: the pricing matrix only has four tiers
 * (cup ≈60–70, pint ≈190–210, half gallon ≈480–520, gallon ≈900–980), so a
 * slider/stepper over raw pesos would be 900 taps of dead space. `null` is the
 * "no ceiling" state and is what the Any option sets.
 */
const MAX_PRICE_OPTIONS: SelectOption<number | null>[] = [
  { label: 'Any price', value: null },
  { label: '₱100 or less', value: 100 },
  { label: '₱250 or less', value: 250 },
  { label: '₱550 or less', value: 550 },
  { label: '₱1,000 or less', value: 1000 }];

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonSearchbar, IonChip, IonLabel, IonGrid, IonRow, IonCol,
    IonSkeletonText, IonCard, IonCardContent, IonText,
    IonRefresher, IonRefresherContent,
    IonButtons, IonMenuButton, IonToggle,
    IonInfiniteScroll, IonInfiniteScrollContent,
    IonSelect, IonSelectOption, IonSegment, IonSegmentButton, IonButton,
    ProductCardComponent, CartButtonComponent,
    AppIconComponent, EmptyStateComponent, AppFooterComponent],
  templateUrl: './products.page.html',
  styleUrls: ['./products.page.scss'],
})
export class ProductsPage implements OnInit, OnDestroy {
  private inventoryService = inject(InventoryService);
  private wishlistService = inject(WishlistService);
  private sub?: Subscription;
  private wishlistSub?: Subscription;

  allProducts = signal<Product[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');
  searchQuery = signal('');
  selectedSet = signal<FlavorSet | null>(null);
  inStockOnly = signal(false);
  wishlistOnly = signal(false);
  wishlistIds = signal<string[]>([]);
  PAGE_SIZE = 20;
  displayedCount = signal(this.PAGE_SIZE);

  /** Size the shopper is shopping for. null = "any size". */
  readonly selectedSize = signal<SizeVariant | null>(null);
  /** Price ceiling in pesos, null = no ceiling. */
  readonly maxPrice = signal<number | null>(null);
  readonly sortBy = signal<ProductSort>('featured');

  /**
   * Catalog type filter, null = all types.
   *
   * The plan asked for "flavors, tubs, cones, sundaes". Tubs are covered by the
   * pint and half-gallon sizes, so the model needed a category only for sundaes
   * and cones — a product is otherwise identical to a flavor. A null value
   * means "show everything", which is the default so the catalog looks the same
   * as it did before categories existed.
   */
  readonly selectedCategory = signal<ProductCategory | null>(null);
  readonly categoryOptions: SelectOption<ProductCategory | null>[] = [
    { label: 'All types', value: null },
    ...PRODUCT_CATEGORIES.map((c) => ({ label: c.label, value: c.value }))];

  /** The size a price is read from; falls back to the cup (see filteredProducts). */
  readonly priceBasisSize = computed<SizeVariant>(() => this.selectedSize() ?? 'cup');

  readonly sizeOptions: SelectOption<SizeVariant | null>[] = [
    { label: 'Any size', value: null },
    ...(Object.keys(SIZE_DISPLAY_LABELS) as SizeVariant[]).map((s) => ({
      label: SIZE_DISPLAY_LABELS[s],
      value: s,
    }))];
  readonly maxPriceOptions = MAX_PRICE_OPTIONS;
  /**
   * `label` is the full phrase and is what the segment button's aria-label
   * uses; `short` is what is painted, because four full phrases in a segment
   * on a phone-width screen truncate to nonsense.
   */
  readonly sortOptions: { label: string; short: string; value: ProductSort }[] = [
    { label: 'Sort by featured order', short: 'Featured', value: 'featured' },
    { label: 'Sort by price, low to high', short: 'Price ↑', value: 'price-asc' },
    { label: 'Sort by price, high to low', short: 'Price ↓', value: 'price-desc' },
    { label: 'Sort by name, A to Z', short: 'A–Z', value: 'name' }];

  /**
   * Any non-default filter state — drives the "Clear filters" button, which
   * would otherwise be a dead control on a freshly loaded page.
   *
   * The set chip is read through effectiveSet(), not selectedSet(): a filter
   * that has already been dropped (its set no longer exists) is not holding
   * anything back, so Clear should not appear for it.
   */
  readonly hasActiveFilters = computed(
    () =>
      this.searchQuery().trim() !== '' ||
      this.effectiveSet() !== null ||
      this.inStockOnly() ||
      this.wishlistOnly() ||
      this.selectedSize() !== null ||
      this.maxPrice() !== null ||
      this.selectedCategory() !== null ||
      this.sortBy() !== 'featured'
  );

  @ViewChild('searchbar') searchbar?: ElementRef<HTMLIonSearchbarElement>;

  /**
   * Set filter chips, derived from the catalog this page actually loaded.
   *
   * This used to be a hand-written list built from SET_NAMES, which only ever
   * held the 8 seeded sets. A set created later saved to Firestore correctly
   * and appeared under "All", but had no chip to filter to — the row could only
   * grow by editing source and redeploying. Deriving it from allProducts() means
   * the chips can never drift from what is on screen.
   *
   * SET_NAMES survives only as a fallback label for a product with a blank
   * setName; the set list itself is no longer taken from it.
   */
  readonly setChips = computed<SetChip[]>(() => {
    const labelByNumber = new Map<number, string>();
    for (const p of this.allProducts()) {
      if (labelByNumber.has(p.setNumber)) continue;
      labelByNumber.set(
        p.setNumber,
        p.setName?.trim() || SET_NAMES[p.setNumber] || `Set ${p.setNumber}`
      );
    }
    return [
      { label: 'All', value: null },
      ...[...labelByNumber.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([value, label]) => ({ label, value: value as FlavorSet }))];
  });

  /**
   * The set actually being filtered by, or null for "All".
   *
   * Now that the chips are derived, a set can stop existing while it is
   * selected — deactivating its last product removes its chip. Falling back to
   * "All" keeps the grid populated instead of stranding the user on a blank page
   * with no button highlighted and no obvious way back. Both the grid and the
   * chip highlight read this, so the two can never disagree.
   */
  readonly effectiveSet = computed<FlavorSet | null>(() => {
    const set = this.selectedSet();
    if (set === null) return null;
    return this.setChips().some((c) => c.value === set) ? set : null;
  });

  filteredProducts = computed(() => {
    let products = this.allProducts();
    const q = this.searchQuery().toLowerCase();
    const set = this.effectiveSet();
    if (set !== null) products = products.filter((p) => p.setNumber === set);

    // productCategory() treats a missing field as 'flavor', so the 64 products
    // seeded before categories existed stay visible under Flavors instead of
    // dropping out of the catalog entirely.
    const category = this.selectedCategory();
    if (category !== null) products = products.filter((p) => productCategory(p) === category);

    if (q) products = products.filter(
      (p) => p.variantName.toLowerCase().includes(q) || p.setName.toLowerCase().includes(q)
    );
    if (this.inStockOnly()) products = products.filter(
      (p) => p.stock.cup > 0 || p.stock.pint > 0 || p.stock.halfGallon > 0 || p.stock.gallon > 0
    );
    if (this.wishlistOnly()) {
      const ids = new Set(this.wishlistIds());
      products = products.filter((p) => ids.has(p.id));
    }

    // ── Size + price ────────────────────────────────────────────────────────
    // Price basis when selectedSize() is null: the CUP price.
    //
    // The alternative was to disable the price controls entirely until a size
    // is chosen, but "Under ₱100" with no size is a perfectly ordinary thing
    // to want, and cup is the cheapest tier — so it is the strictest sensible
    // comparison, and a ceiling set on it still shows every flavor that is
    // affordable in some size. Sorting on the same basis keeps the sort and
    // the filter talking about the same number. A product missing that size's
    // price is treated as unaffordable/unknown and sorts last.
    const size = this.priceBasisSize();
    const max = this.maxPrice();
    if (max !== null) {
      products = products.filter((p) => this.priceOf(p, size) <= max);
    }

    return this.sortProducts(products, size);
  });

  /** Price of a product in a given size; Infinity when that size has no price. */
  private priceOf(product: Product, size: SizeVariant): number {
    return product.pricing?.[size] ?? Number.POSITIVE_INFINITY;
  }

  /**
   * Sorts the already-filtered list. Returns the input untouched for
   * 'featured', because the stream is already in setNumber/variantName order
   * (see inventory.service.ts) and re-sorting would only risk breaking that.
   */
  private sortProducts(products: Product[], size: SizeVariant): Product[] {
    const mode = this.sortBy();
    if (mode === 'featured') return products;

    const out = [...products];
    switch (mode) {
      case 'price-asc':
        out.sort(
          (a, b) =>
            this.priceOf(a, size) - this.priceOf(b, size) ||
            a.setNumber - b.setNumber ||
            a.variantName.localeCompare(b.variantName)
        );
        break;
      case 'price-desc':
        out.sort(
          (a, b) =>
            this.priceOf(b, size) - this.priceOf(a, size) ||
            a.setNumber - b.setNumber ||
            a.variantName.localeCompare(b.variantName)
        );
        break;
      case 'name':
        out.sort(
          (a, b) =>
            a.variantName.localeCompare(b.variantName) ||
            a.setNumber - b.setNumber
        );
        break;
    }
    return out;
  }

  displayedProducts = computed(() =>
    this.filteredProducts().slice(0, this.displayedCount())
  );

  skeletonItems = Array(8).fill(0);


  ngOnInit(): void { this.loadProducts(); this.wishlistSub = this.wishlistService.wishlist$.subscribe((ids) => this.wishlistIds.set(ids)); }
  ngOnDestroy(): void { this.sub?.unsubscribe(); this.wishlistSub?.unsubscribe(); }

  loadProducts(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.sub?.unsubscribe();
    this.sub = this.inventoryService.getProducts()
      .pipe(catchError(() => {
        this.errorMessage.set('Failed to load products. Pull to refresh.');
        return of([]);
      }))
      .subscribe((products) => {
        this.allProducts.set(products);
        this.isLoading.set(false);
      });
  }

  onSearch(event: CustomEvent): void {
    this.searchQuery.set(event.detail.value ?? '');
    this.resetPagination();
  }

  selectSet(value: FlavorSet | null): void {
    this.selectedSet.set(value);
    this.resetPagination();
  }

  onInStockToggle(event: CustomEvent): void {
    this.inStockOnly.set(event.detail.checked);
    this.resetPagination();
  }

  onWishlistToggle(event: CustomEvent): void {
    this.wishlistOnly.set(event.detail.checked);
    this.resetPagination();
  }

  onSizeChange(event: CustomEvent): void {
    this.selectedSize.set((event.detail.value as SizeVariant | null) ?? null);
    this.resetPagination();
  }

  onMaxPriceChange(event: CustomEvent): void {
    const raw = event.detail.value;
    this.maxPrice.set(raw === null || raw === undefined || raw === '' ? null : Number(raw));
    this.resetPagination();
  }

  onCategoryChange(event: CustomEvent): void {
    const raw = event.detail.value as ProductCategory | null | undefined;
    this.selectedCategory.set(raw ?? null);
    this.resetPagination();
  }

  onSortChange(event: CustomEvent): void {
    this.sortBy.set((event.detail.value as ProductSort) ?? 'featured');
    this.resetPagination();
  }

  /**
   * Back to the first page. Every filter handler calls this: without it a user
   * who scrolled page 3 and then narrowed the list would be left staring at an
   * empty tail of the grid with the infinite scroll already disabled.
   */
  private resetPagination(): void {
    this.displayedCount.set(this.PAGE_SIZE);
  }

  /**
   * Reset every filter. The searchbar is cleared through the element as well
   * as the signal — otherwise the input would keep showing the old text while
   * the grid showed everything, which reads as a broken control.
   */
  clearFilters(): void {
    this.searchQuery.set('');
    this.selectedSet.set(null);
    this.inStockOnly.set(false);
    this.wishlistOnly.set(false);
    this.selectedSize.set(null);
    this.maxPrice.set(null);
    this.selectedCategory.set(null);
    this.sortBy.set('featured');
    if (this.searchbar?.nativeElement) this.searchbar.nativeElement.value = '';
    this.resetPagination();
  }

  handleRefresh(event: CustomEvent): void {
    this.loadProducts();
    setTimeout(() => (event.target as HTMLIonRefresherElement).complete(), 1000);
  }

  loadMore(event: CustomEvent): void {
    setTimeout(() => {
      this.displayedCount.update((n) => n + this.PAGE_SIZE);
      (event.target as HTMLIonInfiniteScrollElement).complete();
    }, 500);
  }

  trackProduct(_: number, p: Product): string { return p.id; }
}
