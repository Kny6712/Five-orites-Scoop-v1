// src/app/shared/components/product-card/product-card.component.ts
// Fixed double-add bug with isAdding lock

import {
  Component, Input, Output, EventEmitter,
  signal, computed, OnInit, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  IonCard, IonCardContent, IonButton,
  IonSkeletonText, IonChip, IonLabel, IonSegment, IonSegmentButton,
  ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../app-icon/app-icon.component';
import { Product, SizeVariant } from '../../../core/models/product.model';
import { CartService } from '../../../core/services/cart.service';
import { WishlistService } from '../../../core/services/wishlist.service';
import { PesoPipe } from '../../pipes/peso.pipe';
import { CloudinaryPipe } from '../../pipes/cloudinary.pipe';
import { SIZE_DISPLAY_LABELS } from '../../../core/config/pricing.config';
import { LOW_STOCK_THRESHOLD } from '../../../core/config/stock.config';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [
    CommonModule, RouterLink,
    IonCard, IonCardContent, IonButton,
    IonSkeletonText, IonChip, IonLabel, IonSegment, IonSegmentButton,
    PesoPipe, CloudinaryPipe, AppIconComponent,
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
  sizes: SizeVariant[] = ['cup', 'pint', 'halfGallon', 'gallon'];
  lowStockThreshold = LOW_STOCK_THRESHOLD;

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
      img.src = 'assets/placeholder-scoop.svg';
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
