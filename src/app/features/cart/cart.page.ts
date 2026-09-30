// src/app/features/cart/cart.page.ts
// Five-orites Scoop — Cart & Checkout (Fixed double-decrement bug)

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton,
  IonButton, IonText,
  IonTextarea, IonSpinner,
  AlertController, ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { catchError, of } from 'rxjs';
import { CartService } from '../../core/services/cart.service';
import { OrderService } from '../../core/services/order.service';
import { AddressService } from '../../core/services/address.service';
import { VoucherService } from '../../core/services/voucher.service';
import { InventoryService } from '../../core/services/inventory.service';
import { Cart, CartItem, getDeliveryFee, FREE_DELIVERY_THRESHOLD } from '../../core/models/cart.model';
import { Product, SizeVariant } from '../../core/models/product.model';
import { PesoPipe } from '../../shared/pipes/peso.pipe';
import { CloudinaryPipe } from '../../shared/pipes/cloudinary.pipe';
import { SIZE_DISPLAY_LABELS } from '../../core/config/pricing.config';
import { PENDING_VOUCHER_KEY } from '../dashboard/voucher-cards/voucher-cards.component';
import { QtyStepperComponent } from '../../shared/components/qty-stepper/qty-stepper.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';

/**
 * Ceiling used when live stock is unknown.
 *
 * Only reached when the stock read failed, and the page already says so. A low
 * value here would be a second, contradictory statement about the same thing.
 */
const FALLBACK_QTY_CEILING = 99;
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type CheckoutStep = 1 | 2 | 3;

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton,
    IonButton, IonText,
    IonTextarea, IonSpinner,
    PesoPipe, CloudinaryPipe,
    AppIconComponent, QtyStepperComponent, EmptyStateComponent, AlertBannerComponent],
  templateUrl: './cart.page.html',
  styleUrls: ['./cart.page.scss'],
})
export class CartPage implements OnInit {
  private cartService = inject(CartService);
  private orderService = inject(OrderService);
  private route = inject(ActivatedRoute);
  private addressService = inject(AddressService);
  private voucherService = inject(VoucherService);
  private inventoryService = inject(InventoryService);
  private router = inject(Router);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  cart = signal<Cart>({ items: [], totalAmount: 0, itemCount: 0 });
  checkoutStep = signal<CheckoutStep>(1);
  deliveryAddress = '';
  notes = '';
  isPlacingOrder = signal(false);
  errorMessage = signal('');
  lastOrderId = signal<string | null>(null);
  savedAddresses = signal<string[]>([]);
  voucherCode = '';
  voucherDiscount = signal(0);
  appliedVoucher = signal<string | null>(null);
  voucherMessage = signal('');

  /** Live stock per `${productId}|${size}` so the stepper cannot oversell. */
  private stockMap = new Map<string, number>();

  /**
   * True when the live stock read failed. The quantity steppers then stop
   * pretending to know what is available instead of silently allowing an
   * uncapped quantity through.
   */
  readonly stockUnavailable = signal(false);

  readonly sizeLabels = SIZE_DISPLAY_LABELS;
  readonly freeDeliveryThreshold = FREE_DELIVERY_THRESHOLD;

  deliveryFee = computed(() => getDeliveryFee(this.cart().totalAmount));
  isFreeDelivery = computed(() => this.deliveryFee() === 0 && this.cart().items.length > 0);
  amountAwayFromFreeDelivery = computed(() =>
    Math.max(this.freeDeliveryThreshold - this.cart().totalAmount, 0)
  );
  grandTotal = computed(() => this.cart().totalAmount - this.voucherDiscount() + this.deliveryFee());

  constructor() {

    this.cartService.cart$
      .pipe(takeUntilDestroyed())
      .subscribe((c) => {
        this.cart.set(c);
        // Re-validate voucher when cart changes.
        if (this.appliedVoucher()) {
          this.voucherService.validateVoucher(this.appliedVoucher()!, c.totalAmount)
            .then(({ discount }) => this.voucherDiscount.set(discount))
            .catch(() => {
              this.voucherDiscount.set(0);
              this.appliedVoucher.set(null);
              this.voucherMessage.set('Voucher no longer valid for this cart total.');
            });
        }
      });
    this.addressService.addresses$
      .pipe(takeUntilDestroyed())
      .subscribe((a) => this.savedAddresses.set(a));

    // Track live stock so quantity changes are capped at what's actually
    // available, instead of failing at checkout.
    //
    // This must not collapse to an empty list on failure. An empty stockMap
    // makes availableFor() return undefined, and clampToStock passes the
    // quantity through uncapped when availability is unknown — so a failed read
    // would silently DISABLE the stock cap. The user is told instead, and the
    // server-side check in validateAndDecrementStock remains the backstop.
    this.inventoryService
      .getProducts()
      .pipe(
        takeUntilDestroyed(),
        catchError((err) => {
          console.error('Failed to load stock levels.', err);
          this.stockUnavailable.set(true);
          return of([] as Product[]);
        })
      )
      .subscribe((products) => {
        const map = new Map<string, number>();
        for (const p of products) {
          for (const size of Object.keys(p.stock ?? {}) as SizeVariant[]) {
            map.set(`${p.id}|${size}`, p.stock[size] ?? 0);
          }
        }
        this.stockMap = map;
      });
  }

  ngOnInit(): void {
    this.consumeHandedOverVoucher();
  }

  goToProducts(): void {
    void this.router.navigate(['/products']);
  }

  /**
   * Applies a voucher handed over from the dashboard's grab-a-code cards.
   *
   * The code arrives as a query parameter AND is mirrored into sessionStorage by
   * the dashboard. The parameter is the primary path; sessionStorage is the
   * fallback for a reload or a back-navigation, where the query string survives
   * anyway but a direct paste of the URL does not.
   *
   * Whichever source is used, the code goes through `applyVoucher()` — the same
   * path a typed code takes, re-validated against the live cart total. Nothing
   * about a code arriving via navigation grants it any privilege, and the discount
   * is still resolved server-side by OrderService at checkout.
   */
  private consumeHandedOverVoucher(): void {
    const fromQuery = this.route.snapshot.queryParamMap.get('voucher');
    let code = fromQuery;

    if (!code) {
      try {
        code = sessionStorage.getItem(PENDING_VOUCHER_KEY);
      } catch {
        // Storage disabled; the query parameter is the only route anyway.
      }
    }
    if (!code) return;

    // Consume it, so a later reload does not silently re-apply a code the user
    // may since have removed.
    try {
      sessionStorage.removeItem(PENDING_VOUCHER_KEY);
    } catch {
      // ignore
    }

    this.voucherCode = code.trim().toUpperCase();
    void this.applyVoucher();
  }

  /** Stock available for this line, or undefined when unknown. */
  availableFor(item: CartItem): number | undefined {
    return this.stockMap.get(`${item.productId}|${item.size}`);
  }

  atStockLimit(item: CartItem): boolean {
    const available = this.availableFor(item);
    return available !== undefined && item.quantity >= available;
  }

  removeItem(item: CartItem): void {
    this.cartService.removeItem(item.productId, item.size);
  }

  /**
   * Ceiling for the shared stepper on this line.
   *
   * When the live stock read FAILED, `availableFor` returns undefined and the
   * ceiling falls back to a generous constant rather than to 1 — the cart already
   * surfaces `stockUnavailable` and explains that quantities cannot be capped, so
   * freezing the stepper at 1 would be a second, contradictory message.
   */
  maxFor(item: CartItem): number {
    return this.availableFor(item) ?? FALLBACK_QTY_CEILING;
  }

  /**
   * Applies a stepper change.
   *
   * Still routed through CartService.updateQuantity rather than writing the value
   * directly, because that is where the stock cap and the cart-total recompute
   * live. The stepper clamps too, but the service remains the authority.
   */
  setQty(item: CartItem, quantity: number): void {
    if (quantity === item.quantity) return;
    this.cartService.updateQuantity(
      item.productId,
      item.size,
      quantity,
      this.availableFor(item)
    );
  }

  incrementQty(item: CartItem): void {
    this.setQty(item, item.quantity + 1);
  }

  decrementQty(item: CartItem): void {
    this.setQty(item, item.quantity - 1);
  }

  async clearCart(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Clear Cart',
      message: 'Remove all items from your cart?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Clear', role: 'destructive', handler: () => this.cartService.clearCart() }],
    });
    await alert.present();
  }

  // Step 1 → Step 2: Validate address then show review
  proceedToReview(): void {
    if (!this.deliveryAddress.trim()) {
      this.errorMessage.set('Please enter your delivery address.');
      return;
    }
    this.errorMessage.set('');
    this.addressService.saveAddress(this.deliveryAddress);
    this.checkoutStep.set(2);
  }

  useSavedAddress(address: string): void {
    this.deliveryAddress = address;
  }

  async applyVoucher(): Promise<void> {
    this.voucherMessage.set('');
    try {
      const { voucher, discount } = await this.voucherService.validateVoucher(
        this.voucherCode, this.cart().totalAmount
      );
      this.appliedVoucher.set(voucher.code);
      this.voucherDiscount.set(discount);
      this.voucherMessage.set(`✅ ${voucher.code} applied — you save ₱${discount}!`);
    } catch (err) {
      this.voucherDiscount.set(0);
      this.appliedVoucher.set(null);
      this.voucherMessage.set(err instanceof Error ? err.message : 'Invalid voucher.');
    }
  }

  removeVoucher(): void {
    this.voucherCode = '';
    this.voucherDiscount.set(0);
    this.appliedVoucher.set(null);
    this.voucherMessage.set('');
  }

  backToCart(): void {
    this.checkoutStep.set(1);
    this.errorMessage.set('');
  }

  // Step 2 → Place Order (called ONCE only from the Review screen)
  async placeOrder(): Promise<void> {
    if (this.isPlacingOrder()) return; // ← prevents double-tap double-call
    this.isPlacingOrder.set(true);
    this.errorMessage.set('');

    try {
      // Pass null for empty notes — never undefined
      const notesValue = this.notes.trim().length > 0 ? this.notes.trim() : undefined;

      // Pass only the voucher CODE. OrderService re-resolves the discount from
      // Firestore so the charged amount can never be dictated by the client.
      const orderId = await this.orderService.placeOrder(
        this.deliveryAddress.trim(),
        notesValue,
        this.appliedVoucher(),
      );

      this.lastOrderId.set(orderId);
      this.notes = '';
      this.removeVoucher();
      this.checkoutStep.set(3);
      setTimeout(() => this.router.navigate(['/orders', orderId]), 4000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to place order. Please try again.';
      this.errorMessage.set(message);
      const toast = await this.toastCtrl.create({
        message,
        color: 'danger',
        duration: 4000,
        position: 'top',
      });
      await toast.present();
    } finally {
      this.isPlacingOrder.set(false);
    }
  }

  trackItem(_: number, item: CartItem): string {
    return `${item.productId}-${item.size}`;
  }

  orderMore(): void {
    this.checkoutStep.set(1);
    this.errorMessage.set('');
    void this.router.navigate(['/products']);
  }

  viewTracker(): void {
    const id = this.lastOrderId();
    if (id) void this.router.navigate(['/orders', id]);
    else void this.router.navigate(['/orders']);
  }
}
