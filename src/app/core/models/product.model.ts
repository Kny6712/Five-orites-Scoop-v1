// src/app/core/models/product.model.ts
// Five-orites Scoop — Product Data Models
// Author: Five-orites Scoop team (see README)

import { Timestamp } from '@angular/fire/firestore';

export type SizeVariant = 'cup' | 'pint' | 'halfGallon' | 'gallon';
// Flavor set number: 1–8 built-in, extensible (admin can add new sets).
export type FlavorSet = number;

/**
 * What kind of item a product is.
 *
 * The plan asked for "flavors, tubs, cones, sundaes" but the model had no way to
 * express a type, so a search for cone or sundae returned nothing. `flavor` is
 * what all 64 seeded products are. `sundae` and `cone` are sellable in the same
 * four sizes, so adding them needed a category field rather than new pricing
 * machinery.
 *
 * Optional on purpose: documents seeded before this field existed have no
 * `category`, and `productCategory()` treats a missing one as 'flavor' rather
 * than hiding the product.
 */
export type ProductCategory = 'flavor' | 'sundae' | 'cone';

/** Display label for a category, and the order they appear in filter chips. */
export const PRODUCT_CATEGORIES: readonly { value: ProductCategory; label: string }[] = [
  { value: 'flavor', label: 'Flavors' },
  { value: 'sundae', label: 'Sundaes' },
  { value: 'cone', label: 'Cones' },
];

/** A product's category, defaulting to 'flavor' for documents written before the field existed. */
export function productCategory(product: { category?: string }): ProductCategory {
  return product.category === 'sundae' || product.category === 'cone' ? product.category : 'flavor';
}

export interface SizePricing {
  cup: number;
  pint: number;
  halfGallon: number;
  gallon: number;
}

export interface StockLevel {
  cup: number;
  pint: number;
  halfGallon: number;
  gallon: number;
}

export interface Product {
  id: string; // Firestore document ID
  setNumber: FlavorSet; // >= 1 (1–8 built-in, extensible via admin)
  setName: string; // e.g. "Chocolates"
  variantName: string; // e.g. "Rocky Road"
  description: string;
  imageUrl: string;
  category?: ProductCategory; // absent on documents seeded before the field existed
  pricing: SizePricing;
  stock: StockLevel;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Catalog sort orders offered by the products page. */
export type ProductSort = 'featured' | 'price-asc' | 'price-desc' | 'name';

/**
 * Filter shape understood by the inventory layer.
 *
 * No caller passes one yet: all three storefront pages call `getProducts()`
 * with no arguments and filter in memory from the shared stream, so they all
 * ride a single Firestore listener. The type and the operator behind it are
 * live and correct, and the moment a caller does pass a filter it works — it
 * is the call sites that are absent, not the machinery.
 *
 * That arrangement is deliberate. Pushing setNumber/size/price into the query
 * would need a composite Firestore index per filter combination, and the
 * catalog is small enough (limit 200) to filter in memory. See the same note
 * on `InventoryService.getProducts()`.
 */
export interface ProductFilter {
  setNumber?: FlavorSet;
  searchQuery?: string;
  inStockOnly?: boolean;
  size?: SizeVariant;
  /** Max price in pesos for the size above (cup when `size` is unset). */
  maxPrice?: number;
  sortBy?: ProductSort;
  /** Narrow to one catalog type. Undefined means all types. */
  category?: ProductCategory;
}
