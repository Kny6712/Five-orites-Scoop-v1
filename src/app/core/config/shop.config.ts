// src/app/core/config/shop.config.ts
// Five-orites Scoop — Where the shop is
//
// The tracking map needs a fixed origin for every delivery. It lives here rather
// than in a component so there is exactly one source of truth: the customer
// tracker, the admin tracking map and anything else that draws a route all read
// the same coordinates.
//
// The coordinates were resolved from the Google Maps short link
// (maps.app.goo.gl/Ky6gmq7WzDBSVAqU8), whose place pin is 14.6188159, 121.1029457
// and which reverse-geocodes to "Q-Plaza Square Avenue, Cainta, Rizal, 1900".
// Nominatim's own result for that address sits 41 metres away, so the two
// independent sources agree.
//
// The short plus code "J493+G5G" is 8 characters — too short to decode on its own,
// since an Open Location Code needs a reference locality to resolve the rest.

export interface ShopLocation {
  /** The brand name, as the app knows it. */
  name: string;
  /** The address a human would write on a parcel. */
  address: string;
  lat: number;
  lng: number;
  /** Open in Maps link. */
  mapsUrl: string;
}

export const SHOP_LOCATION: ShopLocation = {
  name: 'Five-orites Scoop',
  address: 'J493+G5G, Q. Plaza Square, Cainta, 1900 Rizal',
  lat: 14.6188159,
  lng: 121.1029457,
  mapsUrl: 'https://maps.app.goo.gl/Ky6gmq7WzDBSVAqU8',
};

/** Opening hours, shown on the About and tracking pages. */
export const SHOP_HOURS = {
  weekdays: '10:00 AM – 9:00 PM',
  weekends: '9:00 AM – 10:00 PM',
  phone: '',
} as const;

/**
 * The year the shop opened, shown in the site footer.
 *
 * A constant, not a setting. The hours above are editable at runtime because an
 * admin genuinely changes them; nobody re-opens a shop. It lives here rather
 * than in AppFooterComponent because it is a fact about the BUSINESS, not about
 * the footer — the About story reads the same value.
 */
export const SHOP_FOUNDED_YEAR = 2026;
