// src/app/core/logic/image-url.ts
// Five-orites Scoop — Cloudinary delivery-URL resizing
//
// Pure logic, no Angular imports, so it is unit-testable (see tests/logic.test.ts).
// The CloudinaryPipe is a thin wrapper around this.

/** Only Cloudinary delivery URLs carry this segment. */
const UPLOAD_SEGMENT = '/image/upload/';

/**
 * A Cloudinary version segment, e.g. `v1756200000`.
 *
 * The version is optional, and in a URL that carries a transformation it sits
 * BEFORE the transformation. A URL that has already been through this
 * function puts the transformation first and the version second, so both
 * positions have to be recognised.
 */
const VERSION_SEGMENT = /^v\d+$/;

/**
 * A single transformation flag, e.g. `w_400`, `f_auto`, `c_fill`, `q_auto:good`.
 *
 * Deliberately tight: the segment must be a short flag name, an underscore and
 * a value with no dot and no slash. That is what keeps a public id like
 * `my_product.jpg` — which also starts with two letters and an underscore —
 * from being mistaken for a transformation and deleted from the URL.
 */
const TRANSFORM_FLAG = /^[a-z]{1,3}_[0-9a-z:]+$/;

/**
 * Does this path segment look like a Cloudinary transformation?
 *
 * Two shapes qualify: a chained transformation (`f_auto,q_auto,w_400`, which
 * contains a comma) and a single flag (`w_400`).
 */
function looksLikeTransform(segment: string): boolean {
  if (!segment) return false;
  if (segment.includes(',')) return true;
  return TRANSFORM_FLAG.test(segment);
}

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
 *
 * WHY THE PATH IS PARSED RATHER THAN REGEX-REPLACED
 * The old implementation stripped an existing transformation with a regex
 * that matched the `/image/upload/` segment followed by ONE path segment
 * containing `f_auto`. That only matches when the transformation is the FIRST
 * segment after `/image/upload/`. Cloudinary's canonical order is
 * `version/transformation/public-id`, so on a real Cloudinary URL —
 * `.../upload/v1756200000/f_auto,q_auto,w_400/x.jpg` — the regex did not
 * match, the old transformation survived, and the new one was prepended on top
 * of it. The transformations STACKED, which is precisely the thing this
 * function exists to prevent.
 *
 * The test only ever fed the function's own output back in, so the round trip
 * passed while every real URL broke.
 *
 * The public id may itself contain slashes (`products/a.jpg`), so the leading
 * run of metadata segments is consumed and everything after it is the public
 * id, untouched.
 */
export function buildCloudinaryUrl(url: string | null | undefined, width: number): string {
  if (!url || !url.includes(UPLOAD_SEGMENT)) return url ?? '';

  const head = url.indexOf(UPLOAD_SEGMENT);
  const prefix = url.slice(0, head);
  const rest = url.slice(head + UPLOAD_SEGMENT.length);
  const segments = rest.split('/');

  // Consume the leading metadata run: an optional version, then any number of
  // transformation segments. Everything after it is the public id.
  let version = '';
  let i = 0;
  for (; i < segments.length; i++) {
    const segment = segments[i];
    if (!version && VERSION_SEGMENT.test(segment)) {
      version = segment;
      continue;
    }
    if (looksLikeTransform(segment)) continue;
    break;
  }
  const publicId = segments.slice(i).join('/');

  const w = Number(width);
  const transform =
    Number.isFinite(w) && w > 0 ? `f_auto,q_auto,w_${Math.round(w)}` : 'f_auto,q_auto';

  // Canonical order for this app: transformation, then version, then the
  // public id. That is the shape the seeded URLs use and the shape the app
  // has always emitted.
  return `${prefix}${UPLOAD_SEGMENT}${transform}/${version ? `${version}/` : ''}${publicId}`;
}
