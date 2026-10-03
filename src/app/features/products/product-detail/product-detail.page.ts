// src/app/features/products/product-detail/product-detail.page.ts
// Five-orites Scoop — Product Detail Page
// Author: Five-orites Scoop team (see README)

import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonButton,
  IonSkeletonText,
  IonBadge,
  IonChip,
  IonLabel,
  IonText,
  IonItem,
  IonNote,
  IonTextarea,
  ToastController,
  AlertController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { QtyStepperComponent } from '../../../shared/components/qty-stepper/qty-stepper.component';
import { Subscription, catchError, of } from 'rxjs';
import { InventoryService } from '../../../core/services/inventory.service';
import { CartService } from '../../../core/services/cart.service';
import { ReviewService, REVIEWS_PAGE_LIMIT } from '../../../core/services/review.service';
import { WishlistService } from '../../../core/services/wishlist.service';
import { Product, SizeVariant } from '../../../core/models/product.model';
import { Review } from '../../../core/models/review.model';
import { AuthService } from '../../../core/services/auth.service';
import { summarizeRatings } from '../../../core/logic/rating';
import { PesoPipe } from '../../../shared/pipes/peso.pipe';
import { CloudinaryPipe } from '../../../shared/pipes/cloudinary.pipe';
import { StarRatingComponent } from '../../../shared/components/star-rating/star-rating.component';
import { CartButtonComponent } from '../../../shared/components/cart-button/cart-button.component';
import { AppFooterComponent } from '../../../shared/components/app-footer/app-footer.component';
import { SIZE_DISPLAY_LABELS } from '../../../core/config/pricing.config';
import { ShopSettingsService } from '../../../core/services/shop-settings.service';

interface SizeOption {
  key: SizeVariant;
  label: string;
}

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonBackButton,
    IonButton, IonSkeletonText, IonBadge,
    IonChip, IonLabel, IonText, IonItem, IonNote, IonTextarea,
    PesoPipe, StarRatingComponent, CloudinaryPipe, CartButtonComponent,
    AppIconComponent, QtyStepperComponent, AppFooterComponent],
  templateUrl: './product-detail.page.html',
  styleUrls: ['./product-detail.page.scss'],
})
export class ProductDetailPage implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private inventoryService = inject(InventoryService);
  private cartService = inject(CartService);
  private reviewService = inject(ReviewService);
  private wishlistService = inject(WishlistService);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);
  private authService = inject(AuthService);
  private sub?: Subscription;
  private reviewSub?: Subscription;

  product = signal<Product | null>(null);
  isLoading = signal(true);
  errorMessage = signal('');
  selectedSize = signal<SizeVariant>('cup');
  quantity = signal(1);
  isAdding = signal(false);
  isWished = signal(false);
  reviews = signal<Review[]>([]);
  /**
   * Set when the reviews read fails. This is the important one: the handler
   * used to be `error: () => this.reviews.set([])`, so a permission error or a
   * missing `reviews` index rendered "No reviews yet — be the first!" on a
   * product with dozens of them. That is a fabricated success state, not just
   * a missing one, so it needs its own branch rather than reusing the
   * "no reviews" one.
   */
  reviewsError = signal('');
  avgRating = signal(0);
  reviewCount = signal(0);
  newRating = signal(5);
  newComment = '';
  isSubmittingReview = signal(false);

  readonly sizeOptions: SizeOption[] = [
    { key: 'cup', label: SIZE_DISPLAY_LABELS.cup },
    { key: 'pint', label: SIZE_DISPLAY_LABELS.pint },
    { key: 'halfGallon', label: SIZE_DISPLAY_LABELS.halfGallon },
    { key: 'gallon', label: SIZE_DISPLAY_LABELS.gallon }];

  /**
   * True when the loaded review set hit the query's cap, so the count and
   * average describe the most recent N reviews rather than every review this
   * product has ever received. product-detail.page.html needs one line to
   * surface this ("Showing the 200 most recent reviews") — without it the
   * number is still a silent understatement on a heavily reviewed flavor.
   */
  readonly reviewsTruncated = signal(false);

  /**
   * The admin-editable cutoff, not the build-time constant.
   *
   * Same bug as ProductCardComponent: this read `LOW_STOCK_THRESHOLD`
   * directly, so an owner's threshold change moved the dashboard and the admin
   * inventory query but left the customer-facing product page flagging at the
   * build default. Three surfaces, two numbers, no indication which was right.
   */
  readonly lowStockThreshold = inject(ShopSettingsService).lowStockThreshold;

  currentPrice = computed(() => this.product()?.pricing[this.selectedSize()] ?? 0);
  currentStock = computed(() => this.product()?.stock[this.selectedSize()] ?? 0);
  isOutOfStock = computed(() => this.currentStock() === 0);
  /**
   * Deactivated by the admin. getProductById has no isActive filter, so a
   * direct link to /products/:id still resolves a flavor the storefront hides —
   * the product card and the detail page disagreed about whether it existed.
   * Enforced here rather than in InventoryService so the admin's own detail
   * view of a deactivated flavor still loads; see the template note below for
   * the display half.
   */
  isUnavailable = computed(() => this.product()?.isActive === false);
  /** The single gate add-to-cart and the quantity stepper both consult. */
  canPurchase = computed(() => !!this.product() && !this.isUnavailable() && !this.isOutOfStock());
  lineTotal = computed(() => this.currentPrice() * this.quantity());


  ngOnInit(): void {
    const productId = this.route.snapshot.paramMap.get('id');
    if (!productId) {
      this.errorMessage.set('Product not found.');
      this.isLoading.set(false);
      return;
    }

    this.sub = this.inventoryService
      .getProductById(productId)
      .pipe(catchError((err) => {
        this.errorMessage.set('Could not load product. Please go back and try again.');
        return of(null);
      }))
      .subscribe((product) => {
        if (product) {
          this.product.set(product);
          this.isWished.set(this.wishlistService.isWished(product.id));
          this.loadReviews(product.id);
        }
        this.isLoading.set(false);
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.reviewSub?.unsubscribe();
  }

  loadReviews(productId: string): void {
    this.reviewSub?.unsubscribe();
    this.reviewSub = this.reviewService.getProductReviews(productId).subscribe({
      next: (reviews) => {
        this.reviews.set(reviews);
        this.reviewsError.set('');
        // One source for both numbers. The page used to reduce over
        // `reviews.length` inline — a second copy of logic/rating.ts that could
        // drift from the unit-tested one — and it paired a `limit()`-truncated
        // list with a count presented as the product's lifetime total.
        // summarizeRatings() derives the average AND the count from the same
        // array, so the stars and the "(n)" can never disagree.
        const summary = summarizeRatings(reviews);
        this.avgRating.set(summary.average);
        this.reviewCount.set(summary.count);
        this.reviewsTruncated.set(reviews.length >= REVIEWS_PAGE_LIMIT);
      },
      error: (err: unknown) => {
        console.error('Load reviews error:', err);
        this.reviews.set([]);
        this.avgRating.set(0);
        this.reviewCount.set(0);
        this.reviewsTruncated.set(false);
        this.reviewsError.set('Could not load reviews. Please try again.');
      },
    });
  }

  async toggleWishlist(): Promise<void> {
    const product = this.product();
    if (!product) return;
    try {
      this.isWished.set(this.wishlistService.toggle(product.id));
    } catch (err) {
      const toast = await this.toastCtrl.create({
        message: err instanceof Error ? err.message : 'Sign in to use wishlist.',
        duration: 2500, color: 'warning', position: 'bottom',
      });
      await toast.present();
    }
  }

  /** The signed-in user's uid, or null when signed out. */
  currentUserId(): string | null {
    return this.authService.currentUserSnapshot?.uid ?? null;
  }

  /** True when the signed-in user has already reviewed this product. */
  hasMyReview(): boolean {
    const uid = this.currentUserId();
    if (!uid) return false;
    return this.reviews().some((r) => r.userId === uid);
  }

  /** Withdraws the signed-in user's own review. */
  async withdrawReview(review: Review): Promise<void> {
    const product = this.product();
    if (!product || this.isSubmittingReview()) return;
    if (review.userId !== this.currentUserId()) return;

    const confirm = await this.alertCtrl.create({
      header: 'Withdraw review?',
      message: 'Your review of this flavor will be removed. You can always write another.',
      buttons: [
        { text: 'Keep it', role: 'cancel' },
        {
          text: 'Withdraw',
          role: 'destructive',
          handler: async () => {
            this.isSubmittingReview.set(true);
            try {
              await this.reviewService.deleteMyReview(product.id);
              const toast = await this.toastCtrl.create({
                message: 'Review withdrawn.', duration: 2000, color: 'success', position: 'bottom',
              });
              await toast.present();
            } catch (err) {
              const toast = await this.toastCtrl.create({
                message: err instanceof Error ? err.message : 'Could not withdraw review.',
                duration: 3000, color: 'warning', position: 'bottom',
              });
              await toast.present();
            } finally {
              this.isSubmittingReview.set(false);
            }
          },
        }],
    });
    await confirm.present();
  }

  async submitReview(): Promise<void> {
    const product = this.product();
    if (!product || this.isSubmittingReview()) return;
    this.isSubmittingReview.set(true);
    try {
      const editing = this.hasMyReview();
      await this.reviewService.addReview(product.id, this.newRating(), this.newComment);
      this.newComment = '';
      this.newRating.set(5);
      const toast = await this.toastCtrl.create({
        message: editing ? 'Review updated. Thanks!' : 'Thanks for your review! 💖',
        duration: 2000, color: 'success', position: 'bottom',
      });
      await toast.present();
    } catch (err) {
      const toast = await this.toastCtrl.create({
        message: err instanceof Error ? err.message : 'Could not submit review.',
        duration: 3000, color: 'warning', position: 'bottom',
      });
      await toast.present();
    } finally {
      this.isSubmittingReview.set(false);
    }
  }

  selectSize(size: SizeVariant): void {
    this.selectedSize.set(size);
    this.quantity.set(1);
  }

  /**
   * Ceiling for the shared stepper.
   *
   * Always at least 1: an out-of-stock product has `currentStock() === 0`, and a
   * stepper whose max is below its min would render both buttons disabled with a
   * nonsense bound. The add-to-cart button is disabled separately by
   * `isOutOfStock`, so the control is not the thing gating the action.
   */
  readonly stepperMax = computed(() => Math.max(1, this.currentStock()));

  async addToCart(): Promise<void> {
    const product = this.product();
    if (!product || this.isAdding() || !this.canPurchase()) {
      // canPurchase() also covers isUnavailable(). The template's disabled
      // binding only checks isOutOfStock(), so without this guard a
      // deactivated flavor reached by direct link stayed clickable.
      if (product && this.isUnavailable() && !this.isAdding()) {
        const toast = await this.toastCtrl.create({
          message: `${product.variantName} is no longer available.`,
          duration: 3000, color: 'warning', position: 'bottom',
        });
        await toast.present();
      }
      return;
    }

    this.isAdding.set(true);
    try {
      this.cartService.addItem(product, this.selectedSize(), this.quantity());
      const toast = await this.toastCtrl.create({
        message: `${product.variantName} added to your cart!`,
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
      setTimeout(() => this.isAdding.set(false), 500);
    }
  }
}
