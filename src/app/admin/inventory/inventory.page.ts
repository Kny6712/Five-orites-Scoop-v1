// src/app/admin/inventory/inventory.page.ts
// Five-orites Scoop — Admin Inventory Manager

import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton,
  IonSearchbar, IonLabel, IonInput,
  IonButton, IonSkeletonText, IonRefresher, IonRefresherContent,
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonChip, AlertController, ToastController, ModalController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { Subscription } from 'rxjs';
import { InventoryService } from '../../core/services/inventory.service';
import { Product, SizeVariant, StockLevel } from '../../core/models/product.model';
import { SIZE_DISPLAY_LABELS } from '../../core/config/pricing.config';
import { LOW_STOCK_THRESHOLD } from '../../core/config/stock.config';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { AddProductModalComponent } from './add-product-modal.component';
import { EditProductModalComponent } from './edit-product-modal.component';
import { CartButtonComponent } from '../../shared/components/cart-button/cart-button.component';

interface EditableStock { cup: number; pint: number; halfGallon: number; gallon: number; }

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton,
    IonSearchbar, IonLabel, IonInput,
    IonButton,
    IonSkeletonText, IonRefresher, IonRefresherContent,
    IonCard, IonCardContent, IonCardHeader, IonCardTitle,
    IonChip, CartButtonComponent,
    AppIconComponent, EmptyStateComponent],
  templateUrl: './inventory.page.html',
  styleUrls: ['./inventory.page.scss'],
})
export class InventoryPage implements OnInit, OnDestroy {
  private inventoryService = inject(InventoryService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private modalCtrl = inject(ModalController);
  private sub?: Subscription;

  products = signal<Product[]>([]);
  filteredProducts = signal<Product[]>([]);
  isLoading = signal(true);
  /**
   * Set when the catalog read fails. An empty list here used to mean two very
   * different things — "the shop has no products" and "we were not allowed /
   * could not reach Firestore" — and the page showed the same screen for both.
   */
  loadError = signal('');
  editingId = signal<string | null>(null);
  savingId = signal<string | null>(null);
  editStock: Record<string, EditableStock> = {};

  readonly sizes: SizeVariant[] = ['cup', 'pint', 'halfGallon', 'gallon'];
  readonly sizeLabels = SIZE_DISPLAY_LABELS;
  readonly lowStockThreshold = LOW_STOCK_THRESHOLD;
  skeletonItems = Array(6).fill(0);


  ngOnInit(): void { this.loadProducts(); }
  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  loadProducts(): void {
    this.isLoading.set(true);
    this.loadError.set('');
    this.sub?.unsubscribe();
    // getAllProducts, not getProducts: the admin must see deactivated products,
    // otherwise there is no card to edit their stock or flip them back on.
    this.sub = this.inventoryService.getAllProducts().subscribe({
      next: (products) => {
        this.products.set(products);
        this.filteredProducts.set(products);
        this.isLoading.set(false);
      },
      error: (err: unknown) => {
        // console.error alone was not enough: the page still rendered "0
        // products" with an empty list, which an admin reads as a wiped
        // catalog rather than a failed read.
        console.error('Load products error:', err);
        this.products.set([]);
        this.filteredProducts.set([]);
        this.loadError.set(describeFirestoreError('the catalog', err));
        this.isLoading.set(false);
      },
    });
  }

  onSearch(event: CustomEvent): void {
    const q = (event.detail.value ?? '').toLowerCase();
    this.filteredProducts.set(
      q ? this.products().filter(
        (p) => p.variantName.toLowerCase().includes(q) || p.setName.toLowerCase().includes(q)
      ) : this.products()
    );
  }

  startEdit(product: Product): void {
    this.editingId.set(product.id);
    // Deep copy current stock values into editStock
    this.editStock[product.id] = {
      cup: product.stock?.cup ?? 0,
      pint: product.stock?.pint ?? 0,
      halfGallon: product.stock?.halfGallon ?? 0,
      gallon: product.stock?.gallon ?? 0,
    };
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  validateStock(productId: string, size: SizeVariant): void {
    const val = Number(this.editStock[productId]?.[size]);
    if (isNaN(val) || val < 0) {
      this.editStock[productId][size] = 0;
    } else {
      this.editStock[productId][size] = Math.floor(val);
    }
  }

  /**
   * Live sum of the four inputs for the row being edited.
   *
   * Clamped the same way saveStock() clamps on the way out, so the number on
   * screen is always what a save would actually persist. validateStock() only
   * runs on blur, so a half-typed negative would otherwise drag the total down.
   */
  totalStock(productId: string): number {
    const stock = this.editStock[productId];
    if (!stock) return 0;
    return this.sizes.reduce(
      (sum, size) => sum + Math.max(Math.floor(Number(stock[size])) || 0, 0),
      0
    );
  }

  async saveStock(product: Product): Promise<void> {
    const newStock = this.editStock[product.id];
    if (!newStock) return;

    this.savingId.set(product.id);
    try {
      // One atomic write for all four sizes. This used to fire four separate
      // per-size transactions in a loop, so a failure halfway through
      // left the product with a half-applied edit.
      const stock: StockLevel = {
        cup: Math.max(Math.floor(Number(newStock.cup)) || 0, 0),
        pint: Math.max(Math.floor(Number(newStock.pint)) || 0, 0),
        halfGallon: Math.max(Math.floor(Number(newStock.halfGallon)) || 0, 0),
        gallon: Math.max(Math.floor(Number(newStock.gallon)) || 0, 0),
      };
      await this.inventoryService.updateStocks(product.id, stock);

      const toast = await this.toastCtrl.create({
        message: `✅ Stock updated for ${product.variantName}!`,
        color: 'success', duration: 2500, position: 'top',
      });
      await toast.present();
      this.editingId.set(null);
    } catch (err: any) {
      const toast = await this.toastCtrl.create({
        message: `❌ Failed to update stock: ${err?.message ?? 'Please try again.'}`,
        color: 'danger', duration: 4000, position: 'top',
      });
      await toast.present();
    } finally {
      this.savingId.set(null);
    }
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
              const toast = await this.toastCtrl.create({
                message: `Product ${action}d successfully.`,
                color: 'success', duration: 2000, position: 'top',
              });
              await toast.present();
            } catch (err: any) {
              const toast = await this.toastCtrl.create({
                message: `Failed to update product: ${err?.message ?? 'Try again.'}`,
                color: 'danger', duration: 3000, position: 'top',
              });
              await toast.present();
            }
          },
        }],
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
              await this.toast(`✅ Restocked ${count} products (+${amount} each size).`, 'success');
            } catch (err: unknown) {
              await this.toast(err instanceof Error ? err.message : 'Bulk restock failed.', 'danger');
            }
          },
        }],
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
