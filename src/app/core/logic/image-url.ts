// src/app/core/logic/image-url.ts
// Five-orites Scoop — Cloudinary delivery-URL resizing
//
// Pure logic, no Angular imports, so it is unit-testable (see tests/logic.test.ts).
// The CloudinaryPipe is a thin wrapper around this.

/** Only Cloudinary delivery URLs carry this segment. */
const UPLOAD_SEGMENT = '/image/upload/';

/** Strips an existing transformation chain so transforms never stack. */
const EXISTING_TRANSFORM = /\/image\/upload\/[^/]*f_auto[^/]*\//;

/**
 * Builds a sized, auto-formatted delivery URL from a stored Cloudinary URL:
 *
 *   in:  .../image/upload/v123/products/a.jpg
 *   out: .../image/upload/f_auto,q_auto,w_400/v123/products/a.jpg
 *
 * `f_auto` negotiates WebP/AVIF per browser and `q_auto` picks a quality
 * level, so a small screen never downloads the full-size original.
 *
 * Any URL that is not a Cloudinary delivery URL — the placeholder SVG, a
 * hand-pasted link — is returned untouched, so callers can apply this
 * unconditionally.
 */
export function buildCloudinaryUrl(url: string | null | undefined, width: number): string {
  if (!url || !url.includes(UPLOAD_SEGMENT)) return url ?? '';

  const base = url.replace(EXISTING_TRANSFORM, UPLOAD_SEGMENT);
  const w = Number(width);
  const transform =
    Number.isFinite(w) && w > 0 ? `f_auto,q_auto,w_${Math.round(w)}` : 'f_auto,q_auto';

  return base.replace(UPLOAD_SEGMENT, `${UPLOAD_SEGMENT}${transform}/`);
}
