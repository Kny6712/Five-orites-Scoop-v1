// src/app/core/logic/geo.ts
// Five-orites Scoop — Geocoding the delivery address
//
// WHY A THIRD PARTY IS INVOLVED AT ALL
// The order document stores `deliveryAddress` as free text. There were no
// coordinates anywhere in the data model — no `lat`/`lng` on orders or users, no
// geolocation plugin, no map library. So a map has to be told where the parcel is
// going, and the only way to turn an address into a point is a geocoder.
//
// This uses Nominatim (OpenStreetMap's public instance), which needs no API key.
//
// ── What this costs the user ──────────────────────────────────────────────────
// Their street address leaves the app and is sent to a third-party server. That is
// a real privacy consideration and is why the geocode is CACHED on the order
// document rather than repeated: an address is resolved once, on demand, and
// never re-sent on subsequent page opens.
//
// ── Rules this obeys, because they are easy to break by accident ─────────────
// Nominatim's usage policy is strict and it is a shared free service:
//   - at most 1 request per second, globally per client
//   - no autocomplete-as-you-type; a "search as you type" box would violate this
//   - results must be cached, which is what the on-order cache does
//   - an identifying User-Agent or Referer is required — browsers send Referer
//     automatically, so no proxy is needed
// The 1 req/sec limit is enforced below with a module-level timestamp, so a user
// mashing a button cannot get the app (or the project) rate-limited and blocked.

/** A resolved point, plus enough context to show it honestly. */
export interface GeoPoint {
  lat: number;
  lng: number;
  /** Human-readable label from the geocoder, e.g. "Cainta, Rizal, Philippines". */
  label: string;
  /** When this was resolved, so a stale cache can be identified. */
  at: number;
}

/** The cache shape stored on an order document as `geo`. */
export interface CachedGeo {
  lat: number;
  lng: number;
  label: string;
  at: number;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100;

let lastRequestAt = 0;

/** Throttle to one call per ~1.1s, as Nominatim's policy requires. */
async function respectRateLimit(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();
}

function isUsableLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    // Out-of-range values are what a malformed or hostile `geo` field looks like.
    // `L.latLng()` throws on them, and the order create rule does not validate
    // `geo`, so a customer CAN write arbitrary coordinates at checkout. Coercing
    // here means a bad value degrades to "no map" rather than a blank screen.
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Is a cached value on an order usable as-is?
 *
 * Read BEFORE trusting `order.geo`, which is customer-authored: the order create
 * rule validates eleven specific fields and contains no `hasOnly`, so a customer
 * can attach any `geo` they like at checkout. This is the only thing standing
 * between that and a map that throws on render.
 */
export function readCachedGeo(geo: unknown): GeoPoint | null {
  if (!geo || typeof geo !== 'object') return null;
  const g = geo as Partial<CachedGeo>;
  if (!isUsableLatLng(g.lat, g.lng)) return null;
  // Narrowed by the guard above, but TS cannot see that through `Partial`, so the
  // two fields are read once and checked.
  const lat = g.lat as number;
  const lng = g.lng as number;
  return {
    lat,
    lng,
    label: typeof g.label === 'string' ? g.label : '',
    at: typeof g.at === 'number' ? g.at : 0,
  };
}

/**
 * Resolves a free-text address to a point.
 *
 * Returns null rather than throwing for every failure mode — no result, network
 * down, rate limited, malformed response. The caller is a map, and a map with no
 * pin plus a readable address is a perfectly good outcome; a map stuck behind an
 * error dialog is not.
 */
export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const query = address.trim();
  // Nominatim rejects a bare whitespace query with a 400, and a two-character
  // query is never a real street address.
  if (query.length < 4) return null;

  await respectRateLimit();

  const url =
    `${NOMINATIM}?q=${encodeURIComponent(query)}` + '&format=jsonv2&limit=1&addressdetails=0';

  let payload: unknown;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    payload = await res.json();
  } catch {
    return null;
  }

  if (!Array.isArray(payload) || payload.length === 0) return null;

  const first = payload[0] as { lat?: unknown; lon?: unknown; display_name?: unknown };
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!isUsableLatLng(lat, lng)) return null;

  return {
    lat,
    lng,
    label: typeof first.display_name === 'string' ? first.display_name : query,
    at: Date.now(),
  };
}

/**
 * Point on the segment from `a` to `b`, `t` of the way along.
 *
 * Used to place the courier marker for an order that is `out_for_delivery`: the
 * app has no live driver location (see below), so the marker advances along the
 * route as the status changes, which is a truthful representation of "somewhere
 * between the shop and you" rather than a fabricated GPS trace.
 *
 * Linear interpolation, not spherical — over the few hundred metres between a
 * shop and a customer in one city the difference is far below a pixel.
 */
export function interpolate(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  t: number,
): {
  lat: number;
  lng: number;
} {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    lat: a.lat + (b.lat - a.lat) * clamped,
    lng: a.lng + (b.lng - a.lng) * clamped,
  };
}

/** Great-circle distance in metres, for the "2.4 km away" line. */
export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
