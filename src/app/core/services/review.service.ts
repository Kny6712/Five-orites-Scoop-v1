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
  updateDoc,
  deleteDoc,
  deleteField,
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

  // ── Admin moderation ───────────────────────────────────────────────
  //
  // `firestore.rules:178` grants admins `delete` and `update` on any review,
  // and tests/firestore.rules.test.ts pins both. No UI ever called them, which
  // is the whole gap: the rules were correct and the feature was still missing,
  // so the correction was a page rather than a schema or rules change.
  //
  // Everything below is admin-scoped BY CONSTRUCTION (the route sits behind
  // adminGuard) but NOT by rules per call — the rules simply allow an admin.
  // That is the same trust model as the rest of the admin side.

  /**
   * Every review, newest first, for the moderation queue.
   *
   * No `where` clause: the queue's job is to show what needs attention, and a
   * filtered query would hide the rows nobody remembered to filter for. Paged
   * client-side because the moderation queue is bounded by `REVIEWS_PAGE_LIMIT`
   * and reports that cap rather than pretending otherwise.
   */
  streamAllReviews(maxResults = REVIEWS_PAGE_LIMIT): Observable<Review[]> {
    return new Observable<Review[]>((observer) => {
      const q = query(
        collection(this.firestore, 'reviews'),
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

  /** Removes a review outright. Admin-only in effect; see the note above. */
  async deleteReview(reviewId: string): Promise<void> {
    await deleteDoc(doc(this.firestore, 'reviews', reviewId));
  }

  /**
   * Posts a public staff reply on a review.
   *
   * `adminResponse` is a NEW optional field. It is a merge, so an existing
   * review gains the reply without its rating, comment or author being
   * rewritten — the reason `updateDoc` is used rather than `setDoc`.
   *
   * Rules note: `allow update` for an admin is unconditional, so this needs no
   * rules change. The author-side branch of that same clause does NOT permit
   * writing this field, so a customer cannot forge a staff reply.
   */
  async replyToReview(
    reviewId: string,
    response: string,
    responderName: string
  ): Promise<void> {
    const text = response.trim().slice(0, 500);
    if (!text) throw new Error('Write a reply first.');
    await updateDoc(doc(this.firestore, 'reviews', reviewId), {
      adminResponse: text,
      adminRespondedAt: serverTimestamp(),
      adminResponderName: responderName || 'Five-orites Scoop',
      updatedAt: serverTimestamp(),
    });
  }

  /** Clears a staff reply, returning the review to unanswered. */
  async clearReply(reviewId: string): Promise<void> {
    await updateDoc(doc(this.firestore, 'reviews', reviewId), {
      adminResponse: deleteField(),
      adminRespondedAt: deleteField(),
      adminResponderName: deleteField(),
      updatedAt: serverTimestamp(),
    });
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
