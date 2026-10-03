// src/app/core/services/inventory.service.ts
// Five-orites Scoop — Real-Time Inventory Service

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  limit,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  runTransaction,
  QueryConstraint,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import {
  Product,
  FlavorSet,
  SizeVariant,
  StockLevel,
  ProductFilter,
  ProductCategory,
  productCategory,
} from '../models/product.model';
import { normaliseStockLines, SIZE_VARIANTS } from '../logic/stock';
import { AuthService } from './auth.service';
import { ShopSettingsService } from './shop-settings.service';

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private firestore = inject(Firestore);
  /** For the ledger's `actorUid` — who made the change, not just that one did. */
  private authService = inject(AuthService);
  /** The admin-editable low-stock threshold, falling back to the build default. */
  private shopSettings = inject(ShopSettingsService);

  // ── Real-time product stream ──────────────────────────────────────────────────
  /**
   * The shared, UNFILTERED storefront stream: `isActive == true` only, sorted
   * by setNumber then variantName, no `filters` applied.
   *
   * products.page.ts, cart.page.ts and dashboard.page.ts all call
   * getProducts() and used to each open their OWN onSnapshot listener on the
   * same collection — three live listeners, three snapshot payloads and three
   * deserialisation passes for one identical query. Caching the unfiltered
   * stream behind shareReplay collapses that to a single Firestore listener
   * that every subscriber tails, and replays the last value so a page opened
   * later renders immediately instead of waiting for the next write.
   *
   * `refCount: true` means the listener is torn down when the last subscriber
   * leaves and re-opened on the next subscribe, so an idle app holds no
   * listener. The cache is keyed on the (maxResults, includeInactive) pair via
   * the maps below: the admin query is a genuinely different Firestore query
   * and must never be served from — or served into — the storefront cache, or
   * deactivated products would appear on the storefront (and stop appearing in
   * the admin list).
   */
  private storefrontStreams = new Map<number, Observable<Product[]>>();
  private allStreams = new Map<number, Observable<Product[]>>();

  /**
   * @param includeInactive Return deactivated products too. Defaults to false,
   *   which is what the storefront wants. The admin inventory page must pass
   *   true — see getAllProducts().
   *
   * `filters` is accepted and APPLIED, but no caller currently passes one: the
   * storefront pages filter in memory from this same shared stream so they all
   * ride one Firestore listener (see streamFor). The parameter exists because
   * filtering belongs here rather than being re-implemented per page, and
   * because it keeps the behaviour correct for the first caller that does use
   * it. Do not move filtering into the query — that would need a composite
   * index per filter combination and would undo the shareReplay.
   */
  getProducts(
    filters?: ProductFilter,
    maxResults = 200,
    includeInactive = false,
  ): Observable<Product[]> {
    return this.streamFor(maxResults, includeInactive).pipe(applyProductFilters(filters));
  }

  /**
   * Memoized raw snapshot stream for one (maxResults, includeInactive) query.
   * The storefront and admin variants go in separate maps, never one cache.
   */
  private streamFor(maxResults: number, includeInactive: boolean): Observable<Product[]> {
    const cache = includeInactive ? this.allStreams : this.storefrontStreams;
    const cached = cache.get(maxResults);
    if (cached) return cached;

    const stream = new Observable<Product[]>((observer) => {
      const productsCol = collection(this.firestore, 'products');

      // Simple query — no composite index needed.
      // The isActive filter is applied here rather than client-side on purpose:
      // a storefront query must never even fetch deactivated products.
      const constraints: QueryConstraint[] = [limit(maxResults)];
      if (!includeInactive) constraints.unshift(where('isActive', '==', true));
      const q = query(productsCol, ...constraints);

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const products = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          })) as Product[];

          // Sort client-side to avoid needing Firestore composite indexes
          products.sort((a, b) => {
            if (a.setNumber !== b.setNumber) return a.setNumber - b.setNumber;
            return a.variantName.localeCompare(b.variantName);
          });

          observer.next(products);
        },
        (error) => {
          console.error('Inventory snapshot error:', error);
          observer.error(error);
        },
      );

      return () => unsubscribe();
      // shareReplay is applied HERE, on the raw stream: every subscriber to
      // this exact (maxResults, includeInactive) pair shares ONE Firestore
      // listener, and the last value is replayed so a late subscriber renders
      // immediately instead of waiting for the next write. refCount tears the
      // listener down when the last subscriber leaves.
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

    cache.set(maxResults, stream);
    return stream;
  }

  /**
   * Every product, deactivated ones included.
   *
   * The admin inventory page needs this. getProducts() filters to
   * `isActive == true` in the query, so a deactivated product vanished from the
   * admin list along with its card — which made deactivation a one-way door:
   * no card meant no way to edit that flavor's stock, no Details modal, and no
   * pill to switch it back on. The Add Product modal then inherited the same
   * gap, because its variant dropdown is built from this same stream.
   */
  getAllProducts(maxResults = 200): Observable<Product[]> {
    // includeInactive = true puts this on the separate `allStreams` cache, so
    // the admin query never shares (and never pollutes) the storefront cache.
    return this.getProducts(undefined, maxResults, true);
  }

  getProductById(productId: string): Observable<Product> {
    return new Observable<Product>((observer) => {
      const productDocRef = doc(this.firestore, `products/${productId}`);

      const unsubscribe = onSnapshot(
        productDocRef,
        (docSnap) => {
          if (docSnap.exists()) {
            observer.next({ id: docSnap.id, ...docSnap.data() } as Product);
          } else {
            observer.error(new Error(`Product ${productId} not found`));
          }
        },
        (error) => {
          console.error('Product snapshot error:', error);
          observer.error(error);
        },
      );

      return () => unsubscribe();
    });
  }

  /**
   * Products with any size at or below the threshold.
   *
   * `threshold` now defaults to the ADMIN-EDITABLE value from
   * `ShopSettingsService`, falling back to `LOW_STOCK_THRESHOLD` (the build-time
   * environment number) when nothing has been saved. Callers that already hold
   * the current value can pass it explicitly, which is what the dashboard and
   * the product card do so they show the same number the query used.
   */
  subscribeToLowStock(threshold?: number): Observable<Product[]> {
    const cutoff = threshold ?? this.shopSettings.lowStockThreshold();
    return new Observable<Product[]>((observer) => {
      const productsCol = collection(this.firestore, 'products');
      const q = query(productsCol, where('isActive', '==', true));

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const lowStock = snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Product)
            .filter(
              (p) =>
                p.stock.cup < cutoff ||
                p.stock.pint < cutoff ||
                p.stock.halfGallon < cutoff ||
                p.stock.gallon < cutoff,
            );
          observer.next(lowStock);
        },
        (error) => {
          // This one is easy to miss: the query itself is a bare
          // `where('isActive', '==', true)` with no orderBy or limit, so a
          // rules/index regression here looks exactly like "nothing is low".
          // Log it so a failure is visible even if the caller swallows it.
          console.error('Low stock snapshot error:', error);
          observer.error(error);
        },
      );

      return () => unsubscribe();
    });
  }

  async updateProductActive(productId: string, isActive: boolean): Promise<void> {
    const productRef = doc(this.firestore, `products/${productId}`);
    await updateDoc(productRef, {
      isActive,
      updatedAt: serverTimestamp(),
    });
  }

  /**
   * Permanently remove a product document.
   *
   * THIS IS IRREVERSIBLE. There is no archive flag and no recovery path, which
   * is the whole point of the distinction the UI draws:
   *
   *   updateProductActive(false)  keeps the document, hides it from sale
   *   deleteProduct()             erases the document, its stock, its image
   *                                reference and every trace of it
   *
   * An admin who wants to take a flavor off the shelf should be using the
   * Active pill. This exists for the case where the flavor was created in error
   * and should not be recoverable.
   *
   * `deleteDoc` rather than `setDoc` with a tombstone: a tombstone would still
   * appear in getAllProducts() (which has no deleted filter) and would reappear
   * in the storefront if the rule ever changed, which is precisely the failure
   * mode a "complete removal" is supposed to rule out.
   */
  async deleteProduct(productId: string): Promise<void> {
    const productRef = doc(this.firestore, `products/${productId}`);
    await deleteDoc(productRef);
  }

  /**
   * Change one size's quantity by a delta, atomically.
   *
   * The inventory page's +/- buttons call this rather than read-modify-write
   * client-side, because a client-side round trip is a race: two admins tapping
   * "+1" on the same size at the same time both read 4, both write 5, and one
   * increment is lost. runTransaction makes the read and the write one atomic
   * unit, so concurrent taps queue and each one lands.
   *
   * Returns the quantity actually stored afterwards, which may be higher than
   * the caller expected if someone else changed it in between — the caller uses
   * that to resync rather than to assume.
   */
  async adjustStock(productId: string, size: SizeVariant, delta: number): Promise<number> {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new Error('Adjustment must be a non-zero whole number.');
    }
    const productRef = doc(this.firestore, `products/${productId}`);
    return runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(productRef);
      if (!snap.exists()) {
        throw new Error('That product no longer exists.');
      }
      const current = ((snap.data() as Product).stock?.[size] ?? 0) as number;
      // Clamped at zero rather than allowed to go negative: a negative stock
      // level means "sell N of something you do not have", and the cart's own
      // validation would have to catch it downstream.
      const next = Math.max(current + delta, 0);
      if (next !== current) {
        tx.update(productRef, {
          stock: { ...(snap.data() as Product).stock, [size]: next } as StockLevel,
          updatedAt: serverTimestamp(),
        });
        // The ledger row is written INSIDE the same transaction, so a movement
        // can never be recorded for a change that did not happen, or missed for
        // one that did. `applied` rather than `delta`, because the clamp above
        // means the two can differ.
        const ledgerRef = doc(collection(this.firestore, 'stockMovements'));
        tx.set(ledgerRef, {
          productId,
          variantName: (snap.data() as Product).variantName ?? 'Unknown',
          size,
          delta: next - current,
          balanceAfter: next,
          reason: delta > 0 ? 'admin_restock' : 'manual_adjust',
          orderId: null,
          actorUid: this.authService.currentUserSnapshot?.uid ?? null,
          createdAt: serverTimestamp(),
        });
      }
      return next;
    });
  }

  // ── Admin Product CRUD ────────────────────────────────────────────────────
  async createProduct(input: {
    setNumber: FlavorSet;
    setName: string;
    variantName: string;
    description: string;
    imageUrl?: string;
    category?: ProductCategory;
    pricing: { cup: number; pint: number; halfGallon: number; gallon: number };
    stock: { cup: number; pint: number; halfGallon: number; gallon: number };
  }): Promise<string> {
    if (!input.variantName.trim()) throw new Error('Variant name is required.');
    const productsCol = collection(this.firestore, 'products');
    const ref = await addDoc(productsCol, {
      setNumber: input.setNumber,
      setName: input.setName.trim(),
      variantName: input.variantName.trim(),
      description: (input.description || '').trim(),
      imageUrl: (input.imageUrl || '').trim(),
      // Always written, defaulting to 'flavor', so new documents are complete.
      // Existing documents without the field remain valid — the rule only
      // constrains the value when it is present.
      category: input.category ?? 'flavor',
      pricing: input.pricing,
      stock: input.stock,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  }

  async updateProductDetails(
    productId: string,
    patch: Partial<
      Pick<
        Product,
        | 'variantName'
        | 'description'
        | 'imageUrl'
        | 'pricing'
        | 'setName'
        | 'setNumber'
        | 'category'
      >
    >,
  ): Promise<void> {
    const productRef = doc(this.firestore, `products/${productId}`);
    await updateDoc(productRef, { ...patch, updatedAt: serverTimestamp() });
  }

  // ── Bulk restock: add `amount` to EVERY size of EVERY active product ──────
  async bulkRestock(amount: number): Promise<number> {
    if (!Number.isInteger(amount) || amount <= 0)
      throw new Error('Restock amount must be a positive whole number.');
    const { getDocs } = await import('@angular/fire/firestore');
    const productsCol = collection(this.firestore, 'products');
    const snap = await getDocs(query(productsCol, where('isActive', '==', true), limit(200)));
    let updated = 0;
    for (const d of snap.docs) {
      // Transactional, and the base is re-read INSIDE the transaction.
      //
      // This used to be a plain getDocs + a loop of updateDocs computing the
      // new value from the snapshot taken before the loop. A customer checkout
      // committing between the read and the write was silently overwritten, so
      // the restock could erase a real sale. Every other stock writer in this
      // service is transactional; this was the exception.
      const ref = doc(this.firestore, `products/${d.id}`);
      await runTransaction(this.firestore, async (transaction) => {
        const fresh = await transaction.get(ref);
        if (!fresh.exists()) return;
        const current = fresh.data() as Product;
        transaction.update(ref, {
          'stock.cup': (current.stock?.cup ?? 0) + amount,
          'stock.pint': (current.stock?.pint ?? 0) + amount,
          'stock.halfGallon': (current.stock?.halfGallon ?? 0) + amount,
          'stock.gallon': (current.stock?.gallon ?? 0) + amount,
          updatedAt: serverTimestamp(),
        });
      });
      updated++;
    }
    return updated;
  }

  // validateAndDecrementStock used to live here: 42 lines that opened a
  // transaction, checked every line had stock, and wrote the decrements. It had
  // no callers -- OrderService.placeOrder stopped calling it when stock moved to
  // the reconcileOrderStock Cloud Function -- and it was still being cited in
  // cart.page.ts as "the server-side check ... remains the backstop", which was
  // false: a function nothing calls is not a backstop, and worse, it read like a
  // live guarantee to anyone auditing checkout.
  //
  // The transaction discipline in it is not lost, it is in functions/src/index.ts
  // where it belongs: one transaction, every line re-read inside it, all lines
  // applied or none. See CUTOVER.md.

  // ── Restock (e.g. order cancelled) ──────────────────────────────────────────
  async restockItems(
    items: { productId: string; size: SizeVariant; quantity: number }[],
  ): Promise<void> {
    if (items.length === 0) return;
    // Same guard as the decrement path: a negative quantity here would
    // *remove* stock instead of returning it.
    const lines = normaliseStockLines(items);
    await runTransaction(this.firestore, async (transaction) => {
      for (const item of lines) {
        const ref = doc(this.firestore, `products/${item.productId}`);
        const snap = await transaction.get(ref);
        if (!snap.exists()) continue;
        const product = { id: snap.id, ...snap.data() } as Product;
        const current = product.stock?.[item.size] ?? 0;
        transaction.update(ref, {
          [`stock.${item.size}`]: current + item.quantity,
          updatedAt: serverTimestamp(),
        });
      }
    });
  }
}

/**
 * Client-side ProductFilter application, deliberately a plain operator rather
 * than part of the shared stream.
 *
 * It has to run DOWNSTREAM of the shareReplay: if the filters were baked into
 * the cached stream, every distinct filters object would mint its own
 * Observable and therefore its own Firestore listener again — exactly the
 * duplication shareReplay exists to remove.
 *
 * The catalog is capped at `limit(200)` and already fully in memory, so
 * filtering there rather than in the query is what keeps us off composite
 * Firestore indexes. products.page.ts deliberately does the same thing itself
 * (it calls getProducts() with no arguments).
 */
function applyProductFilters(filters?: ProductFilter) {
  return (source: Observable<Product[]>): Observable<Product[]> =>
    new Observable<Product[]>((observer) =>
      source.subscribe({
        next: (products) => {
          if (!filters) {
            observer.next(products);
            return;
          }
          let out = products;
          if (filters.setNumber !== undefined) {
            out = out.filter((p) => p.setNumber === filters.setNumber);
          }
          if (filters.category !== undefined) {
            // productCategory() defaults a missing field to 'flavor', so a
            // product seeded before the field existed still appears under
            // Flavors rather than vanishing from the catalog.
            const wanted = filters.category;
            out = out.filter((p) => productCategory(p) === wanted);
          }
          if (filters.searchQuery) {
            const search = filters.searchQuery.toLowerCase();
            out = out.filter(
              (p) =>
                p.variantName.toLowerCase().includes(search) ||
                p.setName.toLowerCase().includes(search),
            );
          }
          if (filters.inStockOnly) {
            // Every size, or just one. The old form was
            // `filters.inStockOnly && filters.size`, so asking for in-stock
            // WITHOUT naming a size silently did nothing — the exact opposite
            // of the storefront page, which checks all four sizes in that case.
            // A filter that quietly no-ops is worse than an absent one.
            const size = filters.size;
            out = size
              ? out.filter((p) => (p.stock?.[size] ?? 0) > 0)
              : out.filter((p) => SIZE_VARIANTS.some((s) => (p.stock?.[s] ?? 0) > 0));
          }
          // Price basis: `size` when given, else the CUP price — the cup is the
          // cheapest tier, so a "max price" set with no size picks the strictest
          // sensible reading. Mirrors products.page.ts.
          if (typeof filters.maxPrice === 'number') {
            const size = filters.size ?? 'cup';
            out = out.filter((p) => priceFor(p, size) <= filters.maxPrice!);
          }
          observer.next(sortProducts(out, filters.sortBy, filters.size));
        },
        error: (err) => observer.error(err),
        complete: () => observer.complete(),
      }),
    );
}

function priceFor(product: Product, size: SizeVariant): number {
  return product.pricing?.[size] ?? Number.POSITIVE_INFINITY;
}

function sortProducts(
  products: Product[],
  sortBy: ProductFilter['sortBy'],
  size?: SizeVariant,
): Product[] {
  if (!sortBy || sortBy === 'featured') return products;
  const sizeForPrice = size ?? 'cup';
  const out = [...products];
  switch (sortBy) {
    case 'price-asc':
      out.sort((a, b) => priceFor(a, sizeForPrice) - priceFor(b, sizeForPrice));
      break;
    case 'price-desc':
      out.sort((a, b) => priceFor(b, sizeForPrice) - priceFor(a, sizeForPrice));
      break;
    case 'name':
      out.sort((a, b) => a.variantName.localeCompare(b.variantName));
      break;
  }
  return out;
}
