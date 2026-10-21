// src/app/features/products/products.page.ts

import {
  Component,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSearchbar,
  IonLabel,
  IonGrid,
  IonRow,
  IonCol,
  IonSkeletonText,
  IonCard,
  IonRefresher,
  IonRefresherContent,
  IonButtons,
  IonMenuButton,
  IonToggle,
  IonSelect,
  IonSelectOption,
  IonSegment,
  IonSegmentButton,
  IonButton,
  IonModal,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { EmptyStateComponent } from '@shared/components/ui/empty-state.component';
import { PaginationComponent } from '@shared/components/ui/pagination.component';
import { AppFooterComponent } from '@shared/components/commerce/app-footer.component';
import { Subscription } from 'rxjs';
import { catchError, of } from 'rxjs';
import { InventoryService } from '@core/services/catalog/inventory.service';
import { WishlistService } from '@core/services/identity/wishlist.service';
import { Product, FlavorSet, SizeVariant, ProductSort } from '@core/models/product.model';
import { ProductCardComponent } from '@shared/components/commerce/product-card.component';
import { QuickViewService } from '@core/services/catalog/quick-view.service';
import { CartButtonComponent } from '@shared/components/commerce/cart-button.component';
import { SET_NAMES, SIZE_DISPLAY_LABELS } from '@core/config/pricing.config';
interface SetChip {
  label: string;
  value: FlavorSet | null;
  /**
   * The `slug` field that used to live here is GONE with the chip row.
   *
   * It was the CSS modifier key that picked one of the nine `--flavor-*` pastels
   * per set, and a `<select>` paints no per-option background — so keeping it
   * meant a computed string that nothing read. `flavourSlug()` in
   * core/logic/flavour.ts is exported and still has its own tests, so the helper
   * survives; only this page's use of it is gone.
   *
   * That last claim was wrong, and this comment is here so it is not repeated:
   * on `interface="popover"` Ionic DOES paint per-option backgrounds, because
   * `createPopoverOptions` in select.js copies each `<ion-select-option>`'s own
   * classList onto the `ion-item` it renders. The colours were built on that and
   * worked — contrast passed at 5.32:1 to 10.01:1.
   *
   * What actually failed was the WIDTH override shipped alongside them, not the
   * colours. A CSS `--width` and Ionic's JS positioning cannot both be trusted:
   * the panel is positioned from a measurement taken before the stylesheet
   * applies, so the two desynchronise and the panel overflows. Both went together.
   */
}
interface SelectOption<T> {
  label: string;
  value: T;
}

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
  { label: '₱1,000 or less', value: 1000 },
];

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonSearchbar,
    IonLabel,
    IonGrid,
    IonRow,
    IonCol,
    IonSkeletonText,
    IonCard,
    IonRefresher,
    IonRefresherContent,
    IonButtons,
    IonMenuButton,
    IonToggle,
    IonSelect,
    IonSelectOption,
    IonSegment,
    IonSegmentButton,
    IonButton,
    IonModal,
    ProductCardComponent,
    CartButtonComponent,
    AppIconComponent,
    EmptyStateComponent,
    PaginationComponent,
    AppFooterComponent,
  ],
  templateUrl: './products.page.html',
  styleUrls: ['./products.page.scss'],
})
export class ProductsPage implements OnInit, OnDestroy {
  private inventoryService = inject(InventoryService);
  private wishlistService = inject(WishlistService);
  /** The flavour quick-view, which the app shell renders over everything. */
  private quickView = inject(QuickViewService);
  private route = inject(ActivatedRoute);
  private routeSub?: Subscription;
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

  /** Size the shopper is shopping for. null = "any size". */
  readonly selectedSize = signal<SizeVariant | null>(null);
  /** Price ceiling in pesos, null = no ceiling. */
  readonly maxPrice = signal<number | null>(null);
  readonly sortBy = signal<ProductSort>('featured');

  /**
   * THE CATEGORY FILTER USED TO LIVE HERE and was removed from the storefront.
   *
   * It read flavor / sundae / cone, and the plan behind it asked for "flavors,
   * tubs, cones, sundaes" — tubs are covered by the pint and half-gallon sizes, so
   * the category existed only to isolate sundaes and cones. On the page it was
   * labelled "Type", which was doing the filter no favours: a sundae is not a type
   * of ice cream, and the label was the only thing distinguishing "sundae" from
   * "the other 56 things".
   *
   * WHAT THIS COST. Six sundaes and two cones can no longer be isolated from the
   * storefront, and they are the only products not already inside a named set — so
   * they are now reachable by search or by scrolling, and by nothing else.
   *
   * WHAT THIS DID NOT TOUCH. The `category` field is still on the model, still
   * written by the seeder, still validated by `categoryIsValid()` in
   * firestore.rules, and still shown on the product detail page. Only the storefront
   * filter is gone, so nothing about the data or the rules changed.
   */

  /** The size a price is read from; falls back to the cup (see filteredProducts). */
  readonly priceBasisSize = computed<SizeVariant>(() => this.selectedSize() ?? 'cup');

  readonly sizeOptions: SelectOption<SizeVariant | null>[] = [
    { label: 'Any size', value: null },
    ...(Object.keys(SIZE_DISPLAY_LABELS) as SizeVariant[]).map((s) => ({
      label: SIZE_DISPLAY_LABELS[s],
      value: s,
    })),
  ];
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
    { label: 'Sort by name, A to Z', short: 'A–Z', value: 'name' },
  ];

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
      this.sortBy() !== 'featured',
  );

  /**
   * The filter SHEET's open state.
   *
   * The sheet is the phone's home for the five filter controls. On a phone the
   * band used to carry all five itself, stacked — 234px of sticky furniture on
   * an 800px screen, with a 36px Flavors box, a 34px pair of toggles and a
   * 16px-tall switch hit area squeezed into it.
   *
   * So the controls leave the band on a phone, and what stays on screen is the
   * search and the sort. This flag is the whole difference.
   */
  readonly filterSheetOpen = signal(false);

  /**
   * How many of the sheet's five filters are set.
   *
   * NOT `hasActiveFilters()`: that one also counts the search text and the
   * sort, neither of which the sheet contains. The badge on the trigger has to
   * count what is behind the button, or it lies.
   */
  readonly activeFilterCount = computed(() => {
    let n = 0;
    if (this.effectiveSet() !== null) n++;
    if (this.selectedSize() !== null) n++;
    if (this.maxPrice() !== null) n++;
    if (this.inStockOnly()) n++;
    if (this.wishlistOnly()) n++;
    return n;
  });

  /**
   * The `ngTemplateOutlet` contexts for the two copies of the filter controls.
   *
   * They exist to give each copy its own element ids — two elements cannot
   * share an id, and the band and the sheet are both in the document while the
   * sheet is open — and to give each copy its own `justify`, which is where
   * the select paints its value inside its own box.
   *
   * They are plain fields, not computed signals, on purpose: `ngTemplateOutlet`
   * compares its context object by identity, and a fresh object on every
   * change-detection pass would tear down and rebuild the embedded view on
   * every tick.
   *
   * `space-between` in the band is what it already was, unchanged: the band
   * gives each control a box exactly as wide as its content, so the value and
   * its chevron sit together at the left.
   *
   * `end` in the sheet is the other half of the sheet's layout: a row that is
   * a full-width line, with the caption on the left and the value hard right
   * against the edge — a settings line, not a chip.
   */
  readonly bandContext = { uid: 'band', justify: 'space-between' as const };
  readonly sheetContext = { uid: 'sheet', justify: 'end' as const };

  openFilterSheet(): void {
    this.filterSheetOpen.set(true);
  }

  closeFilterSheet(): void {
    this.filterSheetOpen.set(false);
  }

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
        p.setName?.trim() || SET_NAMES[p.setNumber] || `Set ${p.setNumber}`,
      );
    }
    return [
      { label: 'All', value: null },
      ...[...labelByNumber.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([value, label]) => ({
          label,
          value: value as FlavorSet,
        })),
    ];
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

    if (q)
      products = products.filter(
        (p) => p.variantName.toLowerCase().includes(q) || p.setName.toLowerCase().includes(q),
      );
    if (this.inStockOnly())
      products = products.filter(
        (p) => p.stock.cup > 0 || p.stock.pint > 0 || p.stock.halfGallon > 0 || p.stock.gallon > 0,
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
            a.variantName.localeCompare(b.variantName),
        );
        break;
      case 'price-desc':
        out.sort(
          (a, b) =>
            this.priceOf(b, size) - this.priceOf(a, size) ||
            a.setNumber - b.setNumber ||
            a.variantName.localeCompare(b.variantName),
        );
        break;
      case 'name':
        out.sort((a, b) => a.variantName.localeCompare(b.variantName) || a.setNumber - b.setNumber);
        break;
    }
    return out;
  }

  /**
   * Twelve flavors a page.
   *
   * This was an infinite scroll that grew the grid by twenty as the user reached
   * the bottom. On a catalog that filters down to a handful of results, that read
   * as a list that had simply stopped — there was no page to go back to, nothing
   * said how many matched, and after narrowing a filter the user landed on a
   * short grid with no way to tell "that is all of them" from "that is where the
   * scroll ran out".
   *
   * The pager fixes all three at once: it says how many matched, it makes any
   * match reachable in a known number of taps, and it survives a filter change.
   *
   * The full filtered set stays in `filteredProducts` — this only decides what is
   * rendered, so the filter logic, the sort and the set chips are unaffected.
   */
  readonly PAGE_SIZE = 12;
  readonly page = signal(1);

  readonly pagedProducts = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.filteredProducts().slice(start, start + this.PAGE_SIZE);
  });

  skeletonItems = Array(8).fill(0);

  ngOnInit(): void {
    this.loadProducts();
    this.wishlistSub = this.wishlistService.wishlist$.subscribe((ids) => this.wishlistIds.set(ids));
    // A flavour in the URL opens the quick-view over the grid. This is the
    // deep link (/products/:id hands its id over) and the way back out of it:
    // the parameter is taken off the URL when the dialog closes, so the
    // browser's back button never walks into it again.
    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const open = params.get('open');
      if (open === this.quickView.productId()) return;
      if (open) this.quickView.open(open);
      else this.quickView.close();
    });
  }
  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.wishlistSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    // The quick-view lives in the shell, so it outlives this page by
    // construction — which means this page has to close it on its way out.
    // Navigating away with the quick-view still open would leave a dialog
    // floating over whatever came next.
    this.quickView.close();
  }

  /**
   * The flavour whose quick-view is open, if any.
   *
   * The state is the service's, not this page's: the dialog is rendered by
   * the app shell, over the whole app rather than over this page's column
   * of the screen. See QuickViewService for why.
   */
  readonly openProductId = computed(() => this.quickView.productId());

  loadProducts(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.sub?.unsubscribe();
    this.sub = this.inventoryService
      .getProducts()
      .pipe(
        catchError(() => {
          this.errorMessage.set('Failed to load products. Pull to refresh.');
          return of([]);
        }),
      )
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

  onFlavorSetChange(event: CustomEvent): void {
    this.selectSet(event.detail.value as FlavorSet | null);
  }

  onSortChange(event: CustomEvent): void {
    this.sortBy.set((event.detail.value as ProductSort) ?? 'featured');
    this.resetPagination();
  }

  /**
   * Back to the first page. Every filter handler calls this, and it is the only
   * place the page moves: a filter change usually shrinks the result set, so
   * without it a user who was on page 3 would be left on an empty tail of the
   * grid with the pager pointing at pages that no longer exist.
   */
  private resetPagination(): void {
    this.page.set(1);
  }

  /**
   * Reset every filter. The searchbar is cleared through the element as well
   * as the signal — otherwise the input would keep showing the old text while
   * the grid showed everything, which reads as a broken control.
   */
  clearFilters(): void {
    this.clearFilterSelections();
    this.searchQuery.set('');
    this.sortBy.set('featured');
    if (this.searchbar?.nativeElement) this.searchbar.nativeElement.value = '';
    this.resetPagination();
  }

  /**
   * Reset the five FILTERS — the ones the sheet contains — and nothing else.
   *
   * The sheet's own "Clear filters" button calls this, not `clearFilters()`.
   * Clearing the search text from inside a sheet called "Filters" would take
   * away something the user cannot see and cannot undo from there; clearing
   * the sort would too. The band keeps its "Clear all", which does clear
   * everything, because the band holds all of it.
   */
  clearFilterSelections(): void {
    this.selectedSet.set(null);
    this.inStockOnly.set(false);
    this.wishlistOnly.set(false);
    this.selectedSize.set(null);
    this.maxPrice.set(null);
    this.resetPagination();
  }

  handleRefresh(event: CustomEvent): void {
    this.loadProducts();
    setTimeout(() => (event.target as HTMLIonRefresherElement).complete(), 1000);
  }

  trackProduct(_: number, p: Product): string {
    return p.id;
  }
}
