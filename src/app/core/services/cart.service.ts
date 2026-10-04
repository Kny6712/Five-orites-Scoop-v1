// src/app/core/services/cart.service.ts
// Five-orites Scoop — Cart State Management Service
//
// The cart is persisted per user id (like the wishlist and address book) so a
// shared device never leaks one customer's basket into another's account.

import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Cart, CartItem, EMPTY_CART } from '../models/cart.model';
import { SizeVariant, Product } from '../models/product.model';
import { assertCanAddToCart, clampToStock } from '../logic/stock';
import { AuthService } from './auth.service';

const CART_STORAGE_KEY = 'five_orites_carts_v1';

/** Shape on disk: uid -> cart. */
type CartStore = Record<string, Cart>;

function readAll(): CartStore {
  try {
    return JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '{}') as CartStore;
  } catch {
    return {};
  }
}

function writeAll(all: CartStore): void {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage full / private mode — ignore
  }
}

@Injectable({ providedIn: 'root' })
export class CartService {
  private authService = inject(AuthService);

  private cartSubject = new BehaviorSubject<Cart>({ ...EMPTY_CART });
  readonly cart$: Observable<Cart> = this.cartSubject.asObservable();

  constructor() {
    // Swap the active cart whenever the signed-in user changes. Emits null
    // first (auth not resolved yet), which yields an empty cart.
    this.authService.currentUser$.subscribe((user) => {
      this.cartSubject.next(user ? this.loadUserCart(user.uid) : { ...EMPTY_CART });
    });
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private get uid(): string | null {
    return this.authService.currentUserSnapshot?.uid ?? null;
  }

  private loadUserCart(uid: string): Cart {
    try {
      const stored = readAll()[uid];
      // Always recompute totals: the stored figures may be stale or tampered.
      if (stored && Array.isArray(stored.items)) return this.recalculate(stored.items);
    } catch {
      console.warn('Failed to load persisted cart — starting fresh.');
    }
    return { ...EMPTY_CART };
  }

  private persist(cart: Cart): void {
    const uid = this.uid;
    if (!uid) return; // never persist a cart for a signed-out user
    try {
      const all = readAll();
      all[uid] = cart;
      writeAll(all);
    } catch {
      console.warn('Failed to persist cart to localStorage.');
    }
  }

  // ── Calculation ──────────────────────────────────────────────────────────────

  private recalculate(items: CartItem[]): Cart {
    const totalAmount = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    return { items: [...items], totalAmount, itemCount };
  }

  private updateCart(items: CartItem[]): void {
    const cart = this.recalculate(items);
    this.cartSubject.next(cart);
    this.persist(cart);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  addItem(product: Product, size: SizeVariant, quantity: number): void {
    const currentItems = [...this.cartSubject.getValue().items];
    const existingIndex = currentItems.findIndex(
      (i) => i.productId === product.id && i.size === size,
    );
    const existingQty = existingIndex >= 0 ? currentItems[existingIndex].quantity : 0;
    const available = product.stock?.[size] ?? 0;

    assertCanAddToCart(`${product.variantName} (${size})`, existingQty, quantity, available);

    if (existingIndex >= 0) {
      currentItems[existingIndex] = {
        ...currentItems[existingIndex],
        quantity: existingQty + quantity,
      };
    } else {
      currentItems.push({
        productId: product.id,
        variantName: product.variantName,
        setName: product.setName,
        size,
        quantity,
        unitPrice: product.pricing[size],
        imageUrl: product.imageUrl,
      });
    }

    this.updateCart(currentItems);
  }

  removeItem(productId: string, size: SizeVariant): void {
    const filtered = this.cartSubject
      .getValue()
      .items.filter((i) => !(i.productId === productId && i.size === size));
    this.updateCart(filtered);
  }

  /**
   * Sets the quantity of a line. Pass `available` (live stock) to clamp the
   * value — without it the cart can hold more than the shop can fulfil and the
   * failure only surfaces at checkout.
   */
  updateQuantity(productId: string, size: SizeVariant, quantity: number, available?: number): void {
    if (quantity <= 0) {
      this.removeItem(productId, size);
      return;
    }

    const capped = clampToStock(quantity, available);
    if (capped <= 0) {
      this.removeItem(productId, size);
      return;
    }

    const updated = this.cartSubject
      .getValue()
      .items.map((item) =>
        item.productId === productId && item.size === size ? { ...item, quantity: capped } : item,
      );
    this.updateCart(updated);
  }

  clearCart(): void {
    this.cartSubject.next({ ...EMPTY_CART });
    const uid = this.uid;
    if (!uid) return;
    try {
      const all = readAll();
      delete all[uid];
      writeAll(all);
    } catch {
      // noop
    }
  }

  get currentCart(): Cart {
    return this.cartSubject.getValue();
  }
}
