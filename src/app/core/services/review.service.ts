// src/app/core/services/review.service.ts
// Five-orites Scoop — Product Reviews (Firestore `reviews` collection)

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Review } from '../models/review.model';
import { AuthService } from './auth.service';

/**
 * How many reviews a product detail page loads.
 *
 * This is a DISPLAY cap, not the product's lifetime review total, and every
 * caller derives its average and its count from this same set (see
 * `summarizeRatings` in core/logic/rating.ts) so the two can never disagree
 * with each other. It used to default to 50 while the dead `getRatingSummary`
 * quietly used 200 for the same underlying query — so the number rendered
 * next to the stars was a 50-review average presented as if it were the whole
 * story. 200 matches the catalog cap used by InventoryService, which is the
 * same order of magnitude a single flavor realistically accumulates.
 */
export const REVIEWS_PAGE_LIMIT = 200;

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);

  getProductReviews(productId: string, maxResults = REVIEWS_PAGE_LIMIT): Observable<Review[]> {
    return new Observable<Review[]>((observer) => {
      const col = collection(this.firestore, 'reviews');
      const q = query(
        col,
        where('productId', '==', productId),
        orderBy('createdAt', 'desc'),
        limit(maxResults)
      );
      const unsub = onSnapshot(
        q,
        (snap) => observer.next(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Review[]),
        (err) => observer.error(err)
      );
      return () => unsub();
    });
  }

  /**
   * Writes a review under a DETERMINISTIC document id: `${productId}_${uid}`.
   *
   * This used to be `addDoc`, which generated a random id. That had two
   * consequences: a user could post unlimited reviews for the same product, and
   * because `firestore.rules` reserves `update`/`delete` for admins, neither
   * the author nor any admin UI could remove one — spam was unremovable in
   * practice, which is worse than the original report's "nothing stops repeat
   * reviews" caveat.
   *
   * With a fixed id the second write for a given pair is an *update*, so the
   * user edits their own review instead of duplicating it. `upsertDoc` is used
   * rather than `setDoc` to avoid a blind overwrite of fields we do not manage.
   */
  async addReview(productId: string, rating: number, comment: string): Promise<string> {
    const user = this.authService.currentUserSnapshot;
    if (!user) throw new Error('Sign in to leave a review.');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('Rating must be 1–5 stars.');
    }
    if (!comment.trim()) throw new Error('Please write a short review.');

    const ref = doc(this.firestore, 'reviews', this.reviewId(productId, user.uid));
    await setDoc(
      ref,
      {
        productId,
        userId: user.uid,
        displayName: user.displayName || 'Scoop Lover',
        rating,
        comment: comment.trim().slice(0, 500),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return ref.id;
  }

  /** The deterministic id for a user's review of a product. */
  reviewId(productId: string, uid: string): string {
    return `${productId}_${uid}`;
  }

  /**
   * Deletes the signed-in user's own review of a product.
   *
   * Previously impossible: `firestore.rules` allowed `delete` only for admins,
   * and no admin UI implemented the delete the rules already permitted. A user
   * who regretted a review simply had to live with it.
   */
  async deleteMyReview(productId: string): Promise<void> {
    const user = this.authService.currentUserSnapshot;
    if (!user) throw new Error('Sign in to manage your review.');
    await deleteDoc(doc(this.firestore, 'reviews', this.reviewId(productId, user.uid)));
  }
}
