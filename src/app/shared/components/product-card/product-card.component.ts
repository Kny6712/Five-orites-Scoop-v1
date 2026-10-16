// src/app/shared/components/product-card/product-card.component.ts
// Fixed double-add bug with isAdding lock

import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal,
  computed,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  IonCard,
  IonCardContent,
  IonButton,
  IonSkeletonText,
  IonChip,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/app-icon/app-icon.component';
import { Product, SizeVariant } from '@core/models/product.model';
import { CartService } from '@core/services/cart.service';
import { WishlistService } from '@core/services/wishlist.service';
import { PesoPipe } from '@shared/pipes/peso.pipe';
import { CloudinaryPipe } from '@shared/pipes/cloudinary.pipe';
import { SIZE_DISPLAY_LABELS } from '@core/config/pricing.config';
import { flavourBackground } from '@core/logic/flavour-colour';
import { ShopSettingsService } from '@core/services/shop-settings.service';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    IonCard,
    IonCardContent,
    IonButton,
    IonSkeletonText,
    IonChip,
    IonLabel,
    IonSegment,
    IonSegmentButton,
    PesoPipe,
    CloudinaryPipe,
    AppIconComponent,
  ],
  templateUrl: './product-card.component.html',
  styleUrls: ['./product-card.component.scss'],
})
export class ProductCardComponent implements OnInit {
  @Input({ required: true }) product!: Product;
  @Output() addedToCart = new EventEmitter<void>();

  private cartService = inject(CartService);
  private wishlistService = inject(WishlistService);
  private toastCtrl = inject(ToastController);

  selectedSize = signal<SizeVariant>('cup');
  imageLoaded = signal(false);
  isAdding = signal(false); // ← lock prevents double-add
  isWished = signal(false);

  sizeLabels = SIZE_DISPLAY_LABELS;

  /**
   * The abbreviated labels this card's segment actually renders.
   *
   * DELIBERATELY LOCAL to the card. `SIZE_DISPLAY_LABELS` is read by ten other
   * surfaces — inventory, analytics, orders, cart, product detail — and
   * abbreviating it there would shorten every table in the app to suit a
   * 250px-wide card.
   *
   * WHY ABBREVIATION IS NEEDED RATHER THAN NICER TYPOGRAPHY: Ionic gives every
   * `ion-segment-button` a 90px floor, so four buttons cannot render in less
   * than 360px. This card's segment measures 162px at a 190px card and 282px
   * at a 310px one — below the floor at EVERY width, which is why `.size-
   * segment { overflow: hidden }` was amputating the last button ("Gallon"
   * rendered as "GALLO"). "Half Gallon" needs 83px of text and its button
   * offers 58px, so it ellipsised too. No font size or padding change fixes
   * that; the labels have to be shorter and the floor has to be released (see
   * `.size-btn` in the component's SCSS).
   *
   * `sizeLabels` is still the source of truth for the FULL word, and the
   * template puts it on each button's aria-label, so a screen reader announces
   * "Half Gallon" and "Gallon" rather than the abbreviations below.
   */
  readonly sizeLabelsShort: Record<SizeVariant, string> = {
    cup: 'Cup',
    pint: 'Pint',
    halfGallon: '½ Gal',
    gallon: 'Gal',
  };

  sizes: SizeVariant[] = ['cup', 'pint', 'halfGallon', 'gallon'];

  /**
   * The set badge painted in this product's flavour pastel.
   *
   * A computed rather than a plain getter so a card re-rendered with a different
   * `product` input repaints the badge. The fallback is `--flavor-all`, which is
   * the brand primary — the colour this badge wore before it was tinted — so an
   * unrecognised flavour degrades to the status quo instead of to nothing.
   */
  readonly setFlavourBackground = computed(() => flavourBackground(this.product));

  /**
   * The admin-editable low-stock cutoff, not the build-time constant.
   *
   * This read `LOW_STOCK_THRESHOLD` directly, which is `environment
   * .lowStockThreshold` frozen at build time. So an owner who set the threshold
   * to 25 in Admin -> Settings saw the dashboard's low-stock panel honour it
   * while every product card in the storefront kept flagging stock at 10 — the
   * two surfaces disagreed, and the one an owner is most likely to change had no
   * effect on the one customers actually look at.
   *
   * `subscribeToLowStock` already preferred the stored value; this was the
   * display half that was missed. A signal, so the pill updates the moment the
   * setting is saved rather than needing a reload.
   */
  readonly lowStockThreshold = inject(ShopSettingsService).lowStockThreshold;

  currentPrice = computed(() => this.product.pricing[this.selectedSize()]);
  currentStock = computed(() => this.product.stock?.[this.selectedSize()] ?? 0);
  isOutOfStock = computed(() => this.currentStock() === 0);

  ngOnInit(): void {
    this.isWished.set(this.wishlistService.isWished(this.product.id));
  }

  onSizeChange(event: CustomEvent): void {
    this.selectedSize.set(event.detail.value as SizeVariant);
  }

  onImageLoad(): void {
    this.imageLoaded.set(true);
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img && !img.src.endsWith('placeholder-scoop.svg')) {
      img.src = '/assets/placeholder-scoop.svg';
    }
    this.imageLoaded.set(true);
  }

  async addToCart(): Promise<void> {
    if (this.isOutOfStock() || this.isAdding()) return;

    this.isAdding.set(true);
    try {
      this.cartService.addItem(this.product, this.selectedSize(), 1);
      this.addedToCart.emit();

      const toast = await this.toastCtrl.create({
        message: `${this.product.variantName} added to cart! 🍦`,
        duration: 2000,
        color: 'success',
        position: 'bottom',
      });
      await toast.present();
    } catch (err) {
      console.error('Add to cart error:', err);
      const toast = await this.toastCtrl.create({
        message: err instanceof Error ? err.message : 'Could not add to cart.',
        duration: 3000,
        color: 'warning',
        position: 'bottom',
      });
      await toast.present();
    } finally {
      // Reset lock after 800ms to prevent rapid double-tap
      setTimeout(() => this.isAdding.set(false), 800);
    }
  }

  async toggleWishlist(event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
    try {
      const added = this.wishlistService.toggle(this.product.id);
      this.isWished.set(added);
      const toast = await this.toastCtrl.create({
        message: added ? 'Saved to wishlist! 💖' : 'Removed from wishlist.',
        duration: 1500,
        color: 'primary',
        position: 'bottom',
      });
      await toast.present();
    } catch (err) {
      const toast = await this.toastCtrl.create({
        message: err instanceof Error ? err.message : 'Sign in to use wishlist.',
        duration: 2500,
        color: 'warning',
        position: 'bottom',
      });
      await toast.present();
    }
  }
}
