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

/** Mean rating to one decimal place, plus the number of reviews. */
export function summarizeRatings(reviews: readonly RatingLike[]): RatingSummary {
  if (reviews.length === 0) return { average: 0, count: 0 };
  const sum = reviews.reduce((s, r) => s + r.rating, 0);
  return { average: Math.round((sum / reviews.length) * 10) / 10, count: reviews.length };
}
