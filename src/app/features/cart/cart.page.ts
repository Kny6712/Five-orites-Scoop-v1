// src/app/features/cart/cart.page.ts
// Five-orites Scoop — Cart & Checkout (Fixed double-decrement bug)

import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonButton,
  IonText,
  IonTextarea,
  IonInput,
  IonSpinner,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { catchError, of, Subscription } from 'rxjs';
import { CartService } from '@core/services/commerce/cart.service';
import { OrderService } from '@core/services/orders/order.service';
import { PaymentService } from '@core/services/orders/payment.service';
import {
  PAYMENT_CHANNEL_META,
  PaymentOutcome,
  ReturnHint,
  XenditChannelCode,
  parseReturnHint,
} from '@core/models/payment.model';
import { Order } from '@core/models/order.model';
import { AddressService } from '@core/services/identity/address.service';
import { VoucherService } from '@core/services/commerce/voucher.service';
import { InventoryService } from '@core/services/catalog/inventory.service';
import { Cart, CartItem, getDeliveryFee, FREE_DELIVERY_THRESHOLD } from '@core/models/cart.model';
import { Product, SizeVariant } from '@core/models/product.model';
import { PesoPipe } from '@shared/pipes/peso.pipe';
import { CloudinaryPipe } from '@shared/pipes/cloudinary.pipe';
import { SIZE_DISPLAY_LABELS } from '@core/config/pricing.config';
import { PENDING_VOUCHER_KEY } from '@core/models/voucher.model';
import { QtyStepperComponent } from '@shared/components/commerce/qty-stepper.component';
import { EmptyStateComponent } from '@shared/components/ui/empty-state.component';
import { AlertBannerComponent } from '@shared/components/ui/alert-banner.component';
import { AppFooterComponent } from '@shared/components/commerce/app-footer.component';

/**
 * Ceiling used when live stock is unknown.
 *
 * Only reached when the stock read failed, and the page already says so. A low
 * value here would be a second, contradictory statement about the same thing.
 */
const FALLBACK_QTY_CEILING = 99;
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

/**
 * How long a returned customer gets the "Checking your payment…" screen before
 * the page admits it does not have an answer yet.
 *
 * Xendit's webhook is normally seconds behind the redirect, but "normally" is
 * not a guarantee and a screen that spins forever is worse than one that says
 * "we haven't confirmed this yet". After this window the page falls back to the
 * honest unpaid screen — and keeps listening, so a late webhook still lands as
 * a success rather than stranding a paid order as unpaid.
 */
const PAYMENT_CHECK_GRACE_MS = 20_000;

/**
 * The order the customer is currently paying for, remembered across a reload.
 *
 * The return from Xendit is a full page load, and so is pressing the browser's
 * back button out of it — which loses every signal in memory. Without this the
 * second tap on "Continue to Payment" would mint a SECOND order for the same
 * basket, which is exactly what the plan's duplicate-handling section forbids.
 *
 * `signature` + `address` + `notes` are what make reuse honest rather than
 * blind: if the basket or the delivery details have changed since the order
 * was written, the stored id describes something the customer is no longer
 * buying, so it is dropped and a fresh order is created instead.
 */
interface RememberedOrder {
  id: string;
  address: string;
  notes: string;
  signature: string;
}

const PENDING_PAYMENT_ORDER_KEY = 'pendingPaymentOrder';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonMenuButton,
    IonButton,
    IonText,
    IonTextarea,
    IonInput,
    IonSpinner,
    PesoPipe,
    CloudinaryPipe,
    AppIconComponent,
    QtyStepperComponent,
    EmptyStateComponent,
    AlertBannerComponent,
    AppFooterComponent,
  ],
  templateUrl: './cart.page.html',
  styleUrls: ['./cart.page.scss'],
})
export class CartPage implements OnInit, OnDestroy {
  private cartService = inject(CartService);
  private orderService = inject(OrderService);
  private paymentService = inject(PaymentService);
  private route = inject(ActivatedRoute);
  private addressService = inject(AddressService);
  private voucherService = inject(VoucherService);
  private inventoryService = inject(InventoryService);
  private router = inject(Router);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  cart = signal<Cart>({ items: [], totalAmount: 0, itemCount: 0 });
  /**
   * Which screen the page is showing.
   *
   * Replaces the old `checkoutStep: 1 | 3` pair, which could only say "cart"
   * or "order placed" — a single outcome that no longer describes a journey
   * where the customer leaves the app and comes back with money either taken
   * or not taken. See `PaymentOutcome`.
   */
  paymentOutcome = signal<PaymentOutcome>('idle');
  deliveryAddress = '';
  notes = '';
  /**
   * True only while a payment session is being created.
   *
   * Guards BOTH entry points against a double tap: a second call while one is
   * in flight would either mint two orders or mint two Xendit sessions for the
   * same one.
   */
  isPreparingPayment = signal(false);
  errorMessage = signal('');
  lastOrderId = signal<string | null>(null);
  /** Display figure until the order document supplies the authoritative one. */
  lastOrderTotal = signal(0);
  /** What the return URL CLAIMED, kept only to choose the wording on screen. */
  returnHint = signal<ReturnHint | null>(null);
  /** Channel chosen before leaving the app. Sent to the backend, never trusted as money. */
  selectedChannel = signal<XenditChannelCode>('GCASH');
  savedAddresses = signal<string[]>([]);
  /** Which saved address, if any, is currently chosen. Drives the radio row. */
  selectedAddress = signal<string | null>(null);
  /**
   * Whether the saved-address rows are showing their delete affordances.
   *
   * The list is a chooser first: picking an address happens every time, and
   * deleting one almost never. Showing four permanent trash icons gave the
   * destructive action the visual weight and the permanent real estate, while
   * the common action was a bare radio circle with nothing saying "use this".
   * That is backwards, and this flag is the correction - the default state has
   * no delete affordance at all.
   */
  managingAddresses = signal(false);
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
  /** The channel picker's rows. Same three the backend allowlists. */
  readonly channels = PAYMENT_CHANNEL_META;

  /**
   * The short human handle on an order id — `A5ICWL` from `…A5ICWL`.
   *
   * Deliberately the same six characters the backend puts in the return URL's
   * `ref` parameter, so the id a customer reads on a result screen is the id
   * they can quote to the shop.
   */
  readonly orderRef = computed(() => {
    const id = this.lastOrderId();
    return id ? id.slice(-6).toUpperCase() : '';
  });

  deliveryFee = computed(() => getDeliveryFee(this.cart().totalAmount));
  isFreeDelivery = computed(() => this.deliveryFee() === 0 && this.cart().items.length > 0);
  amountAwayFromFreeDelivery = computed(() =>
    Math.max(this.freeDeliveryThreshold - this.cart().totalAmount, 0),
  );
  grandTotal = computed(
    () => this.cart().totalAmount - this.voucherDiscount() + this.deliveryFee(),
  );

  constructor() {
    this.cartService.cart$.pipe(takeUntilDestroyed()).subscribe((c) => {
      this.cart.set(c);
      // Re-validate voucher when cart changes.
      if (this.appliedVoucher()) {
        this.voucherService
          .validateVoucher(this.appliedVoucher()!, c.totalAmount)
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
    // would silently DISABLE the stock cap. The user is told instead.
    //
    // The comment here used to end "and the server-side check in
    // validateAndDecrementStock remains the backstop". That method had no
    // callers left and was deleted: stock is reserved by the
    // reconcileOrderStock Cloud Function, which decrements in a transaction and
    // cancels the order itself if the shelf is short. That is the backstop now.
    // See CUTOVER.md for why the function has to be live before the customer
    // branch of the products rule is removed.
    this.inventoryService
      .getProducts()
      .pipe(
        takeUntilDestroyed(),
        catchError((err) => {
          console.error('Failed to load stock levels.', err);
          this.stockUnavailable.set(true);
          return of([] as Product[]);
        }),
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
    this.selectedChannel.set(this.paymentService.preferredChannel);
    this.consumePaymentReturn();
  }

  /**
   * The listener on the order document, and the window on the checking screen.
   *
   * The listener is the only thing on this page that can say a payment
   * happened: it is a live snapshot of the one field the verified webhook
   * writes. It survives a wrong answer from the return URL on purpose — a
   * "payment failed" claim gets overwritten the moment the webhook says paid,
   * and the other way around.
   */
  private paymentWatch?: Subscription;
  private checkGraceTimer?: ReturnType<typeof setTimeout>;

  ngOnDestroy(): void {
    this.stopPaymentWatch();
    if (this.checkGraceTimer !== undefined) {
      clearTimeout(this.checkGraceTimer);
      this.checkGraceTimer = undefined;
    }
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

  // ── The return from Xendit ───────────────────────────────────────────────────

  /**
   * Picks the journey back up where the provider handed it over.
   *
   * The query parameters choose which screen opens. They never choose what the
   * screen SAYS about money: `?payment=success` is a string in an address bar,
   * editable by anyone, so the screen opens and then reads the order document —
   * the field only the verified webhook writes — before claiming anything.
   *
   * Two ways in, and they are not equivalent:
   *  - a return URL (`orderId` present) means the customer went to Xendit, so
   *    the outcome is genuinely unknown and the page waits for an answer;
   *  - no return URL but a remembered order means they pressed back out of it,
   *    which means nothing happened, so the page says so immediately.
   */
  private consumePaymentReturn(): void {
    const params = this.route.snapshot.queryParamMap;
    const fromReturnUrl = params.get('orderId')?.trim() || null;
    const hint = parseReturnHint(params.get('payment'));
    const remembered = this.readRememberedOrder();

    const orderId = fromReturnUrl ?? remembered?.id ?? null;
    if (!orderId) return;

    this.lastOrderId.set(orderId);
    this.returnHint.set(hint);
    this.errorMessage.set('');

    if (!fromReturnUrl) {
      // Back-button or a cold reopen: no provider hand-off happened, so the
      // unpaid screen is the truth already and there is nothing to wait for.
      this.paymentOutcome.set('pending');
    } else if (hint === 'failed') {
      this.paymentOutcome.set('failed');
    } else if (hint === 'cancelled') {
      this.paymentOutcome.set('pending');
    } else {
      // Claimed success, or no claim at all. Both are held as "checking"
      // rather than believed, because a success shown before the webhook is a
      // promise the app has no evidence for yet.
      this.paymentOutcome.set('checking');
      this.startCheckGrace();
    }

    this.watchPayment(orderId);
  }

  private watchPayment(orderId: string): void {
    this.stopPaymentWatch();
    this.paymentWatch = this.orderService.trackOrder(orderId).subscribe({
      next: (order) => this.applyPaymentSnapshot(order),
      error: (err) => {
        // The order cannot be read at all. The screen keeps the return URL's
        // claim and invents nothing: on a failed read, guessing an outcome
        // about money is the one thing worse than not answering.
        console.error('Payment status watch failed.', err);
      },
    });
  }

  private stopPaymentWatch(): void {
    this.paymentWatch?.unsubscribe();
    this.paymentWatch = undefined;
  }

  /**
   * Ends the wait, not the question.
   *
   * After the grace window the page stops showing "checking…" — which would be
   * a lie of a different kind if the webhook is never coming — and falls back
   * to the unpaid screen. The listener stays attached, so a webhook that lands
   * a minute later still turns this screen into a success rather than leaving
   * a paid order described as unpaid.
   */
  private startCheckGrace(): void {
    if (this.checkGraceTimer !== undefined) return;
    this.checkGraceTimer = setTimeout(() => {
      this.checkGraceTimer = undefined;
      if (this.paymentOutcome() === 'checking') this.paymentOutcome.set('pending');
    }, PAYMENT_CHECK_GRACE_MS);
  }

  /** Applies what the order document actually says. */
  private applyPaymentSnapshot(order: Order): void {
    this.lastOrderId.set(order.id);
    this.lastOrderTotal.set(order.grandTotal);

    if (order.paymentStatus === 'paid') {
      this.confirmPaid();
      return;
    }
    if (order.paymentStatus === 'failed') {
      this.paymentOutcome.set('failed');
      this.stopCheckGrace();
      return;
    }
    // Still unpaid: whatever screen is open keeps saying what it says until
    // the grace window closes it down.
  }

  /**
   * The one success path on this page.
   *
   * Reached only from a snapshot whose `paymentStatus` is `paid`, which the
   * backend writes only after Xendit's webhook has been authenticated. The
   * redirect, the return URL and this customer's wordings of them are all
   * upstream of this line and none of them can get here.
   */
  private confirmPaid(): void {
    this.stopPaymentWatch();
    this.stopCheckGrace();
    this.paymentOutcome.set('success');
    this.isPreparingPayment.set(false);
    this.errorMessage.set('');
    this.forgetRememberedOrder();
    // THE ONE PLACE THE CART DIES. Not in OrderService: creating the order
    // document is only the first step of the journey, and the basket has to
    // survive it so the customer can come back from Xendit and pay for the
    // same thing. Now the money is provably in, the basket has no further
    // purpose. `clearCart()` itself is unchanged and still serves the
    // explicit "Clear Cart" button.
    this.cartService.clearCart();
  }

  private stopCheckGrace(): void {
    if (this.checkGraceTimer !== undefined) {
      clearTimeout(this.checkGraceTimer);
      this.checkGraceTimer = undefined;
    }
  }

  // ── Remembering the in-flight order ──────────────────────────────────────────

  /**
   * What this basket is, as a value that can be compared after a page load.
   *
   * Lines and total and voucher, and deliberately NOT the address or the
   * notes: neither field survives a reload, so an empty box would read as
   * "changed" on every single return from Xendit and force a duplicate order
   * out of nothing. Those two are compared separately, where an empty value
   * can be treated as "untouched" instead of as a difference.
   */
  private cartSignature(): string {
    const lines = this.cart()
      .items.map((i) => `${i.productId}|${i.size}|${i.quantity}`)
      .join(',');
    return `${lines}#${this.cart().totalAmount}#${this.appliedVoucher() ?? ''}`;
  }

  private rememberOrder(id: string): void {
    const record: RememberedOrder = {
      id,
      address: this.deliveryAddress.trim(),
      notes: this.notes.trim(),
      signature: this.cartSignature(),
    };
    try {
      sessionStorage.setItem(PENDING_PAYMENT_ORDER_KEY, JSON.stringify(record));
    } catch {
      // Storage disabled: the return URL still carries the id, and the only
      // case this loses is a back-button exit without one.
    }
  }

  private readRememberedOrder(): RememberedOrder | null {
    try {
      const raw = sessionStorage.getItem(PENDING_PAYMENT_ORDER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<RememberedOrder>;
      if (typeof parsed.id !== 'string' || !parsed.id) return null;
      return {
        id: parsed.id,
        address: typeof parsed.address === 'string' ? parsed.address : '',
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
        signature: typeof parsed.signature === 'string' ? parsed.signature : '',
      };
    } catch {
      return null;
    }
  }

  private forgetRememberedOrder(): void {
    try {
      sessionStorage.removeItem(PENDING_PAYMENT_ORDER_KEY);
    } catch {
      // ignore
    }
  }

  /**
   * Whether an untouched-after-reload field counts as a change.
   *
   * Blank means the app restarted and re-rendered an empty box, not that the
   * customer cleared it — so only a non-empty value that differs is evidence.
   */
  private fieldChanged(current: string, stored: string): boolean {
    return Boolean(current && stored && current !== stored);
  }

  /**
   * The id of an order this basket may still be charged against, or null.
   *
   * Returns null whenever reusing would be dishonest — the basket moved, the
   * address was rewritten — because the order's own contents can no longer be
   * edited (the rules permit no such write). Dropping the stored id rather
   * than ignoring it means the next attempt writes a fresh order AND stops
   * pointing at a stale one.
   */
  private reusableOrderId(): string | null {
    const remembered = this.readRememberedOrder();
    if (!remembered) return null;

    if (remembered.signature !== this.cartSignature()) {
      this.forgetRememberedOrder();
      return null;
    }
    if (
      this.fieldChanged(this.deliveryAddress.trim(), remembered.address) ||
      this.fieldChanged(this.notes.trim(), remembered.notes)
    ) {
      this.forgetRememberedOrder();
      return null;
    }
    return remembered.id;
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
    this.cartService.updateQuantity(item.productId, item.size, quantity, this.availableFor(item));
  }

  async clearCart(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Clear Cart',
      message: 'Remove all items from your cart?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Clear', role: 'destructive', handler: () => this.cartService.clearCart() },
      ],
    });
    await alert.present();
  }

  useSavedAddress(address: string): void {
    this.selectedAddress.set(address);
    this.deliveryAddress = address;
  }

  /**
   * Handles a pick from the saved-addresses <select>.
   *
   * The cast lives here rather than in the template: `$event.target` is an
   * EventTarget there, and every way of narrowing it in a template — a cast
   * function, a $any() — is looser than the one line this needs.
   */
  onAddressSelected(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!value) return;
    this.useSavedAddress(value);
  }

  /**
   * Clears the saved-address radio when the textarea stops matching it.
   *
   * Necessary rather than cosmetic: picking a saved address writes
   * deliveryAddress, so this fires for programmatic changes too. The value
   * comparison is what separates the two - if what landed in the box is still
   * the selected address, the radio is still true and stays. Type one character
   * into the box and the radio is no longer describing what is there, so it has
   * to go. Without this the UI would claim an address is chosen after the
   * customer had already changed it.
   */
  onAddressTyped(value: string): void {
    if (this.selectedAddress() !== null && value !== this.selectedAddress()) {
      this.selectedAddress.set(null);
    }
  }

  /** Shows or hides the delete affordances on the saved-address rows. */
  toggleManageAddresses(): void {
    this.managingAddresses.update((on) => !on);
  }

  /**
   * Deletes a saved address, behind a confirmation.
   *
   * Confirmed because it is a one-tap destructive action on a list with no undo:
   * recovering means retyping the address. This mirrors clearCart(), which has
   * asked the same way since before the cart was redesigned.
   */
  async removeSavedAddress(address: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete address',
      message: `Remove "${address}" from your saved addresses?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            // Drop the radio if it was pointing at the row being deleted. The
            // textarea is left alone: the text is still in the box, and the
            // order can still ship there - it simply is not a saved shortcut
            // any more.
            if (this.selectedAddress() === address) {
              this.selectedAddress.set(null);
            }
            this.addressService.removeAddress(address);
            // Deleting the last one would otherwise leave the page sitting in
            // manage mode with no rows and no toggle to get out of it.
            if (this.savedAddresses().length === 0) {
              this.managingAddresses.set(false);
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async applyVoucher(): Promise<void> {
    this.voucherMessage.set('');
    try {
      const { voucher, discount } = await this.voucherService.validateVoucher(
        this.voucherCode,
        this.cart().totalAmount,
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

  /**
   * Creates the order, then the payment session, then leaves the app.
   *
   * The order is written BEFORE the redirect and is born unpaid
   * (`status:'pending'`, `paymentStatus:'pending'`), which is what makes every
   * later action — resume, retry, Pay Now — able to reuse this same id instead
   * of minting a duplicate for a basket the customer has already committed to.
   *
   * The blank-address guard and the saveAddress() call live here because
   * nothing sits between the customer and this method any more; the review
   * screen that used to do that job was removed as redundant.
   *
   * Validation runs BEFORE anything is prepared, so a rejected submit does not
   * leave the button spinning.
   */
  async continueToPayment(): Promise<void> {
    if (this.isPreparingPayment()) return; // ← prevents double-tap double-call
    if (!this.deliveryAddress.trim()) {
      this.errorMessage.set('Please enter your delivery address.');
      return;
    }
    // Checked BEFORE an order exists. Writing a document that nothing could
    // ever take payment for would leave a dead row in My Orders and a customer
    // tapping a button that fails identically every time.
    if (!this.paymentService.isConfigured) {
      this.errorMessage.set('Payments are not set up on this build yet.');
      return;
    }
    this.errorMessage.set('');
    this.addressService.saveAddress(this.deliveryAddress.trim());
    this.isPreparingPayment.set(true);

    try {
      // Pass null for empty notes — never undefined
      const notesValue = this.notes.trim().length > 0 ? this.notes.trim() : undefined;
      const address = this.deliveryAddress.trim();

      let orderId = this.reusableOrderId();
      if (orderId) {
        // RESUMING. The order already exists with its own totals, address and
        // notes, so none of that is rewritten here — only a new payment
        // session is minted for it. This is the path the second tap after a
        // return from Xendit takes, and the reason it cannot duplicate.
        this.lastOrderId.set(orderId);
      } else {
        // A result screen may still be describing an order this basket is not.
        // Stop listening to it before writing a new one.
        this.stopPaymentWatch();
        orderId = await this.orderService.placeOrder(address, notesValue, this.appliedVoucher());
        this.lastOrderId.set(orderId);
        this.lastOrderTotal.set(this.grandTotal());
        this.rememberOrder(orderId);
      }

      // Pass only the ORDER ID. The backend re-reads the document and
      // re-prices everything from it — basket, voucher, delivery fee — so the
      // amount Xendit charges cannot be set by this browser. That is also why
      // the notes and the voucher are left alone above: clearing them would
      // change what "the same basket" means on the next tap and force a
      // duplicate order out of a cosmetic difference.
      const session = await this.paymentService.createSession(orderId, this.selectedChannel());
      // Past this line the page is about to be replaced by Xendit's. Whatever
      // happens over there — payment, failure, cancellation, a dead phone —
      // the cart is still here when the customer comes back.
      this.paymentService.goToCheckout(session.checkoutUrl);
    } catch (err: unknown) {
      // An order may well have been created before this threw. It is remembered
      // on purpose: the next tap resumes THAT order instead of writing a second
      // one for the same basket.
      const message =
        err instanceof Error ? err.message : 'We could not start your payment. Please try again.';
      this.errorMessage.set(message);
      const toast = await this.toastCtrl.create({
        message,
        color: 'danger',
        duration: 4000,
        position: 'top',
      });
      await toast.present();
    } finally {
      this.isPreparingPayment.set(false);
    }
  }

  /**
   * New payment session for an order that already exists.
   *
   * Drives both "Resume Payment" (the customer cancelled or never came back)
   * and "Try Again" (it failed) — they are the same operation, differing only
   * in which word the customer arrived on. The order id never changes, which
   * is the whole point: retrying must never produce a second order.
   */
  async resumePayment(): Promise<void> {
    if (this.isPreparingPayment()) return;
    const orderId = this.lastOrderId() ?? this.reusableOrderId();
    if (!orderId) {
      // Nothing to resume — the basket was cleared or the order is gone. My
      // Orders is where an unpaid order is found again.
      void this.router.navigate(['/orders']);
      return;
    }
    if (!this.paymentService.isConfigured) {
      this.errorMessage.set('Payments are not set up on this build yet.');
      return;
    }

    this.errorMessage.set('');
    this.isPreparingPayment.set(true);
    try {
      const session = await this.paymentService.createSession(orderId, this.selectedChannel());
      this.paymentService.goToCheckout(session.checkoutUrl);
    } catch (err: unknown) {
      // The screen the customer was on stays put — it is still the truth —
      // and the failure is reported beside the button that raised it.
      const message =
        err instanceof Error ? err.message : 'We could not restart your payment. Please try again.';
      this.errorMessage.set(message);
      const toast = await this.toastCtrl.create({
        message,
        color: 'danger',
        duration: 4000,
        position: 'top',
      });
      await toast.present();
    } finally {
      this.isPreparingPayment.set(false);
    }
  }

  /**
   * Picks the channel the next session will be created for.
   *
   * Persisted through PaymentService, not held in this page alone: Pay Now on
   * the orders list has to be able to offer the same method without a picker
   * of its own, and the customer should not have to say it twice.
   */
  selectChannel(code: XenditChannelCode): void {
    this.selectedChannel.set(code);
    this.paymentService.preferredChannel = code;
  }

  /**
   * Leaves a result screen for the cart itself, to edit before paying.
   *
   * The listener stays attached: if the payment this customer walked away from
   * lands while they are editing, the page turns into the success screen and
   * clears the basket then — which is what they paid for, and better than
   * letting them re-order it.
   */
  editCart(): void {
    this.paymentOutcome.set('idle');
    this.errorMessage.set('');
  }

  trackItem(_: number, item: CartItem): string {
    return `${item.productId}-${item.size}`;
  }

  orderMore(): void {
    this.editCart();
    void this.router.navigate(['/products']);
  }

  viewTracker(): void {
    const id = this.lastOrderId();
    if (id) void this.router.navigate(['/orders', id]);
    else void this.router.navigate(['/orders']);
  }
}
