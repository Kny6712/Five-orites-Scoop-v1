// src/app/core/config/pricing.config.ts
// Five-orites Scoop — Authoritative Pricing Matrix
// Author: Five-orites Scoop team (see README)

import { SizePricing, SizeVariant } from '../models/product.model';

export const PRICING_MATRIX: Record<number, SizePricing> = {
  1: { cup: 65,  pint: 200, halfGallon: 500, gallon: 950 }, // Chocolates
  2: { cup: 60,  pint: 190, halfGallon: 480, gallon: 900 }, // Vanilla
  3: { cup: 65,  pint: 200, halfGallon: 500, gallon: 950 }, // Strawberry
  4: { cup: 65,  pint: 200, halfGallon: 500, gallon: 950 }, // Mango
  5: { cup: 70,  pint: 210, halfGallon: 520, gallon: 980 }, // Ube
  6: { cup: 65,  pint: 200, halfGallon: 500, gallon: 950 }, // Mint
  7: { cup: 70,  pint: 210, halfGallon: 520, gallon: 980 }, // Coffee
  8: { cup: 65,  pint: 200, halfGallon: 500, gallon: 950 }, // Cookies & Cream
};

export const SIZE_DISPLAY_LABELS: Record<SizeVariant, string> = {
  cup: 'Cup',
  pint: 'Pint',
  halfGallon: 'Half Gallon',
  gallon: 'Gallon',
};

export const SET_NAMES: Record<number, string> = {
  1: 'Chocolates',
  2: 'Vanilla',
  3: 'Strawberry',
  4: 'Mango',
  5: 'Ube',
  6: 'Mint',
  7: 'Coffee',
  8: 'Cookies & Cream',
};

// Standard tier applied to admin-created sets until edited.
export const DEFAULT_SET_PRICING: SizePricing = {
  cup: 65, pint: 200, halfGallon: 500, gallon: 950,
};

export function getPricingForSet(setNumber: number): SizePricing {
  return { ...(PRICING_MATRIX[setNumber] ?? DEFAULT_SET_PRICING) };
}
