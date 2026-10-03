// src/app/admin/reviews/admin-reviews.page.ts
// Five-orites Scoop — Review moderation queue
//
// WHY THIS PAGE EXISTS
// `firestore.rules:178-181` grants an admin `delete` and `update` on any review,
// and tests/firestore.rules.test.ts asserts both. Until now no UI called them,
// so the capability was real and unreachable: the corrected gap analysis put it
// as *"a user could post unlimited reviews that neither they nor any admin UI
// could remove"*, and the deterministic document id fixed the spam half of that
// but not the moderation half.
//
// No schema or rules change was needed for the delete path. `adminResponse` IS a
// new field, but the author branch of the update clause does not permit writing
// it, so a customer still cannot forge a staff reply.

import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonButton,
  IonSearchbar, IonTextarea, IonChip, IonLabel, IonSkeletonText,
  AlertController, ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { ReviewService } from '../../core/services/review.service';
import { AuthService } from '../../core/services/auth.service';
import { Review } from '../../core/models/review.model';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { toCsv, downloadCsv, csvFilename, toIsoDate } from '../../core/logic/csv';
import { Subscription } from 'rxjs';

const PAGE_SIZE = 12;

/** Star glyphs, so a rating reads at a glance in a dense table. */
const STARS = ['★', '★', '★', '★', '★'] as const;

@Component({
  selector: 'app-admin-reviews',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonButton,
    IonSearchbar, IonTextarea, IonChip, IonLabel, IonSkeletonText,
    AppIconComponent, AlertBannerComponent,
    EmptyStateComponent, PaginationComponent, AppFooterComponent,
  ],
  templateUrl: './admin-reviews.page.html',
  styleUrls: ['./admin-reviews.page.scss'],
})
export class AdminReviewsPage implements OnInit, OnDestroy {
  private reviews = inject(ReviewService);
  private auth = inject(AuthService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  reviews_ = signal<Review[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');
  busyId = signal('');
  page = signal(1);

  search = signal('');
  /** 'all' | 'unanswered' | 'answered' | 'low' */
  filter = signal<'all' | 'unanswered' | 'answered' | 'low'>('all');

  /** The review whose reply box is open. One at a time, deliberately. */
  replyingTo = signal('');
  replyDraft = signal('');

  readonly pageSize = PAGE_SIZE;

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.reviews.streamAllReviews().subscribe({
      next: (rows) => {
        this.reviews_.set(rows);
        this.isLoading.set(false);
        this.errorMessage.set('');
      },
      error: (err: unknown) => {
        this.isLoading.set(false);
        this.errorMessage.set(describeFirestoreError('Could not load reviews.', err));
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /**
   * "Low" means 1–2 stars.
   *
   * The default landing view is `all`, not `low`. A moderation queue that opens
   * on a filtered subset hides the fact that anything else exists, and the
   * person who has to notice a problem is the one who did not set the filter.
   */
  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const mode = this.filter();
    return this.reviews_().filter((r) => {
      if (mode === 'unanswered' && r.adminResponse) return false;
      if (mode === 'answered' && !r.adminResponse) return false;
      if (mode === 'low' && r.rating > 2) return false;
      if (!q) return true;
      return (
        r.comment.toLowerCase().includes(q) ||
        (r.displayName || '').toLowerCase().includes(q) ||
        r.productId.toLowerCase().includes(q)
      );
    });
  });

  readonly paged = computed(() => {
    const start = (this.page() - 1) * PAGE_SIZE;
    return this.filtered().slice(start, start + PAGE_SIZE);
  });

  readonly lowCount = computed(() => this.reviews_().filter((r) => r.rating <= 2).length);
  readonly unansweredCount = computed(() => this.reviews_().filter((r) => !r.adminResponse).length);

  onSearch(value: string | null | undefined): void {
    this.search.set(value ?? '');
    this.page.set(1);
  }

  onFilterChange(next: 'all' | 'unanswered' | 'answered' | 'low'): void {
    this.filter.set(next);
    this.page.set(1);
  }

  starsFor(rating: number): string {
    const n = Math.max(0, Math.min(5, Math.round(rating)));
    return STARS.slice(0, n).join('');
  }

  formatDate(value: unknown): string {
    const iso = toIsoDate(value);
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  /** Every review, not just this page — an export that silently drops rows is worse than none. */
  exportCsv(): void {
    const rows = [
      ['review_id', 'product_id', 'author', 'rating', 'comment', 'staff_reply', 'posted'],
      ...this.filtered().map((r) => [
        r.id, r.productId, r.displayName, r.rating, r.comment,
        r.adminResponse ?? '', toIsoDate(r.createdAt),
      ]),
    ];
    downloadCsv(toCsv(rows), csvFilename('reviews'));
    void this.toast(`Exported ${this.filtered().length} reviews.`, 'success');
  }

  async confirmDelete(review: Review): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete this review?',
      message:
        `"${(review.comment || '').slice(0, 80)}"\n\nThis removes it for everyone and cannot be undone. ` +
        'Consider replying to it instead if it is fair criticism.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            this.busyId.set(review.id);
            try {
              await this.reviews.deleteReview(review.id);
              await this.toast('Review deleted.', 'success');
            } catch (err: unknown) {
              await this.toast(err instanceof Error ? err.message : 'Could not delete.', 'danger');
            } finally {
              this.busyId.set('');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  openReply(review: Review): void {
    this.replyingTo.set(review.id);
    this.replyDraft.set(review.adminResponse ?? '');
  }

  cancelReply(): void {
    this.replyingTo.set('');
    this.replyDraft.set('');
  }

  async saveReply(review: Review): Promise<void> {
    const text = this.replyDraft().trim();
    if (!text) {
      await this.toast('Write a reply first.', 'danger');
      return;
    }
    this.busyId.set(review.id);
    try {
      await this.reviews.replyToReview(
        review.id,
        text,
        this.auth.currentUserSnapshot?.displayName ?? 'Five-orites Scoop'
      );
      this.cancelReply();
      await this.toast('Reply published.', 'success');
    } catch (err: unknown) {
      await this.toast(err instanceof Error ? err.message : 'Could not save reply.', 'danger');
    } finally {
      this.busyId.set('');
    }
  }

  async removeReply(review: Review): Promise<void> {
    this.busyId.set(review.id);
    try {
      await this.reviews.clearReply(review.id);
      await this.toast('Reply removed.', 'success');
    } catch (err: unknown) {
      await this.toast(err instanceof Error ? err.message : 'Could not remove reply.', 'danger');
    } finally {
      this.busyId.set('');
    }
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, color, duration: 2400, position: 'top' });
    await t.present();
  }
}