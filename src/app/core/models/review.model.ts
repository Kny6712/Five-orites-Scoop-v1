// src/app/core/models/review.model.ts
// Five-orites Scoop — Product Review Data Models

import { Timestamp } from '@angular/fire/firestore';

// summarizeRatings lives in core/logic/rating.ts so the unit tests can import
// it without pulling in AngularFire. Re-exported here, and that re-export is
// what makes the type available below -- a second `import type` of the same name
// was shadowing nothing and reading as if the re-export did not cover it.
export { summarizeRatings, type RatingSummary } from '../logic/rating';

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
