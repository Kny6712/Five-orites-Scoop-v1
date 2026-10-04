// src/app/core/services/shop-settings.service.ts
// Five-orites Scoop — Admin-editable shop settings
//
// WHY A NEW COLLECTION
// Three things an admin needs to change were frozen at build time:
//
//   1. The low-stock threshold was `environment.lowStockThreshold`, a literal in
//      a file that only changes on redeploy. The refactor plan's item 2.5 fixed
//      the DUPLICATION of the number (four templates hardcoded `10`) but left it
//      unchangeable by the person who would want to change it.
//   2. There was no announcement surface at all — the corrected gap analysis
//      ranked "admin-editable promo banner" as the #2 next scope.
//   3. Shop hours were hardcoded in `core/config/shop.config.ts`, with
//      `SHOP_HOURS.phone` literally an empty string.
//
// A single `/shopSettings/app` document holds all three, so there is one read and
// one write rather than three singletons.
//
// THE FALLBACK IS THE POINT
// Every getter here falls back to the value that is in the code today, so if the
// document is missing, unreadable, or half-written, the app behaves exactly as
// it did before this existed. A settings read must never be able to break the
// storefront — this is the one service where "fail to load" means "use the
// defaults", not "show an error".

import { Injectable, inject, signal, computed } from '@angular/core';
import { Firestore, doc, getDoc, setDoc, onSnapshot } from '@angular/fire/firestore';
import { environment } from '../../../environments/environment';

export interface ShopSettings {
  /** Units at or below which a SKU is flagged low. */
  lowStockThreshold: number;
  /** Optional banner headline shown on the customer dashboard. Empty = hidden. */
  promoTitle: string;
  promoBody: string;
  promoActive: boolean;
  /** Free-text contact line. Empty falls back to the config value. */
  contactPhone: string;
}

/**
 * What the app uses when nothing is stored.
 *
 * Identical to the pre-existing behaviour, deliberately — `lowStockThreshold` is
 * the same `environment` value the build shipped with, and the promo fields are
 * empty so no banner appears until an admin writes one.
 */
export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  lowStockThreshold: environment.lowStockThreshold,
  promoTitle: '',
  promoBody: '',
  promoActive: false,
  contactPhone: '',
};

const DOC_PATH = 'shopSettings/app';

@Injectable({ providedIn: 'root' })
export class ShopSettingsService {
  private firestore = inject(Firestore);

  /** The stored document, or null when it has never been written. */
  private readonly stored = signal<ShopSettings | null>(null);

  /**
   * The effective settings — stored values merged over the defaults, field by
   * field rather than object-spread.
   *
   * A half-written document (a promo saved before the phone field existed) must
   * not reset the threshold back to its default, which is what a spread would do.
   */
  readonly settings = computed<ShopSettings>(() => {
    const s = this.stored();
    if (!s) return { ...DEFAULT_SHOP_SETTINGS };
    return {
      lowStockThreshold:
        typeof s.lowStockThreshold === 'number' && s.lowStockThreshold > 0
          ? Math.round(s.lowStockThreshold)
          : DEFAULT_SHOP_SETTINGS.lowStockThreshold,
      promoTitle: typeof s.promoTitle === 'string' ? s.promoTitle : '',
      promoBody: typeof s.promoBody === 'string' ? s.promoBody : '',
      promoActive: s.promoActive === true,
      contactPhone: typeof s.contactPhone === 'string' ? s.contactPhone : '',
    };
  });

  readonly lowStockThreshold = computed(() => this.settings().lowStockThreshold);

  /** True only when an admin has written a banner AND left it switched on. */
  readonly promo = computed(() => {
    const s = this.settings();
    return s.promoActive && s.promoTitle.trim() ? s : null;
  });

  private unsubscribe?: () => void;

  /**
   * Starts a live listener.
   *
   * Safe to call more than once — the previous listener is dropped first, so
   * `AppComponent` calling this on every init cannot stack subscriptions.
   */
  watch(): void {
    this.stop();
    try {
      this.unsubscribe = onSnapshot(
        doc(this.firestore, DOC_PATH),
        (snap) => {
          this.stored.set(snap.exists() ? (snap.data() as ShopSettings) : null);
        },
        // A missing document is the normal case, not an error: swallow it and
        // let the defaults stand.
        () => this.stored.set(null),
      );
    } catch {
      this.stored.set(null);
    }
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** One-shot read, for code that cannot hold a subscription (tests, boot). */
  async load(): Promise<ShopSettings> {
    try {
      const snap = await getDoc(doc(this.firestore, DOC_PATH));
      this.stored.set(snap.exists() ? (snap.data() as ShopSettings) : null);
    } catch {
      this.stored.set(null);
    }
    return this.settings();
  }

  async save(patch: Partial<ShopSettings>): Promise<void> {
    const next: ShopSettings = { ...this.settings(), ...patch };
    if (next.lowStockThreshold < 1 || !Number.isFinite(next.lowStockThreshold)) {
      throw new Error('Low-stock threshold must be at least 1.');
    }
    if (next.promoTitle.trim() && !next.promoActive) {
      // A title with the switch off is almost always a mistake, and it hides the
      // only reason someone typed one.
      next.promoActive = true;
    }
    await setDoc(doc(this.firestore, DOC_PATH), next, { merge: true });
    this.stored.set(next);
  }
}
