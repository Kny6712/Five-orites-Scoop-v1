// src/app/core/models/cart.model.ts
// Five-orites Scoop — Cart Data Models
// Author: Five-orites Scoop team (see README)

import { SizeVariant } from './product.model';

export interface CartItem {
  productId: string;
  variantName: string;
  setName: string;
  size: SizeVariant;
  quantity: number;
  unitPrice: number;
  imageUrl?: string;
}

export interface Cart {
  items: CartItem[];
  totalAmount: number;
  itemCount: number;
}

// Delivery figures live in core/logic/delivery.ts so the unit tests can import
// them without pulling in Angular. Re-exported here for existing call sites.
export { FREE_DELIVERY_THRESHOLD, getDeliveryFee } from '../logic/delivery';

export const EMPTY_CART: Cart = {
  items: [],
  totalAmount: 0,
  itemCount: 0,
};
