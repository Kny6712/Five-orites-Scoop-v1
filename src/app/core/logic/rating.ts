// src/app/core/logic/rating.ts
// Five-orites Scoop — Rating aggregation
//
// Framework-free so the unit tests exercise the real calculation.

// Shape summarizeRatings needs — not part of the public surface.
interface RatingLike {
  rating: number;
}

export interface RatingSummary {
  average: number;
  count: number;
}

/**
 * Mean rating to one decimal place, plus the number of reviews.
 *
 * `Review.rating` is typed `number`, but the document is CUSTOMER-AUTHORED:
 * a review written before the field existed, or with `rating: null`, makes
 * the sum `NaN` and the average `NaN`, and the UI then renders "NaN".
 *
 * So the ratings are filtered to the finite ones first, and the count is the
 * count of ratings that were actually usable. A product with one good review
 * and one broken one has an average, not a NaN.
 */
export function summarizeRatings(reviews: readonly RatingLike[]): RatingSummary {
  const ratings = reviews.map((r) => r.rating).filter((n) => Number.isFinite(n));
  if (ratings.length === 0) return { average: 0, count: 0 };
  const sum = ratings.reduce((s, n) => s + n, 0);
  return { average: Math.round((sum / ratings.length) * 10) / 10, count: ratings.length };
}
