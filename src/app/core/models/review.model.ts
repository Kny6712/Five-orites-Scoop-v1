// src/app/core/models/review.model.ts
// Five-orites Scoop — Product Review Data Models

import { Timestamp } from '@angular/fire/firestore';

// summarizeRatings lives in core/logic/rating.ts so the unit tests can import
// it without pulling in AngularFire. Re-exported here for the callers that
// already talk to this model.
//
// Only the FUNCTION is re-exported. `RatingSummary` used to be re-exported
// alongside it, but nothing imported the type from here — the one consumer
// imports `summarizeRatings` from `@core/logic/rating` directly — so the type
// re-export was a second path to a type that already had one.
export { summarizeRatings } from '@core/logic/rating';

export interface Review {
  id: string;
  productId: string;
  userId: string;
  displayName: string;
  rating: number; // 1-5
  comment: string;
  createdAt: Timestamp;
  /**
   * A public staff reply, written from the admin moderation queue.
   *
   * Optional because every review that predates the queue lacks it, and because
   * `clearReply()` removes it with `deleteField()` rather than blanking it — an
   * empty string and "never answered" are different states and only the second
   * one should read as unanswered.
   */
  adminResponse?: string;
  adminRespondedAt?: Timestamp;
  adminResponderName?: string;
}
