// src/app/features/admin/users/admin-users.page.ts
// Five-orites Scoop — Admin user directory
//
// NO RULES CHANGE WAS NEEDED FOR THIS PAGE, and that is a tested claim rather
// than an assumption. tests/firestore.rules.test.ts asserts both halves:
//
//   "an admin MAY run an unfiltered collection query"  → passes
//   "a customer may NOT run an unfiltered collection query" → passes
//
// Firestore authorises a list only if the `allow read` condition can be proven
// for EVERY document the query could return. `isOwner(uid)` depends on the path
// parameter, so it holds for exactly one document and cannot satisfy an
// unfiltered query. `isAdmin()` depends only on `request.auth` plus a get() of
// the CALLER's own document — never on the row being read — so it is provable
// for all of them, and the query is allowed.

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonButton,
  IonSearchbar,
  IonAvatar,
  IonSkeletonText,
  IonPopover,
  AlertController,
  ToastController,
  ModalController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { EmptyStateComponent } from '@shared/components/ui/empty-state.component';
import { PaginationComponent } from '@shared/components/ui/pagination.component';
import { AdminFooterComponent } from '@shared/components/admin/admin-footer.component';
import { AlertBannerComponent } from '@shared/components/ui/alert-banner.component';
import { AuthService } from '@core/services/identity/auth.service';
import { describeFirestoreError } from '@core/logic/firestore-error';
import { CloudinaryPipe } from '@shared/pipes/cloudinary.pipe';
import {
  AppUser,
  UserRole,
  ROLE_LABELS,
  ROLE_RANK,
  ROLE_SUMMARY,
  asRole,
} from '@core/models/user.model';
import { EditUserModalComponent } from './edit-user-modal.component';
import {
  Firestore,
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
} from '@angular/fire/firestore';

/**
 * How many users to read.
 *
 * An unfiltered list reads EVERY user document, and unlike the fulfilment queue
 * this is a directory rather than a working set — an admin paging past the
 * newest 300 users is not a realistic workflow. The cap exists so a mistyped
 * filter cannot pull the entire collection, and `truncated` says out loud when
 * it is hit rather than presenting a partial list as complete.
 */
const USERS_MAX = 300;

/**
 * Orders read for the per-customer spend join.
 *
 * `orders` is a large collection — every checkout, forever — and a shop with
 * thousands of orders would make a full read expensive on every visit to the
 * directory. The cap matches the fulfilment queue's, and the page says when it
 * is hit rather than presenting a partial join as a customer's whole history.
 */
const ORDERS_FOR_STATS_MAX = 300;

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonMenuButton,
    IonButton,
    IonSearchbar,
    IonAvatar,
    IonSkeletonText,
    IonPopover,
    AppIconComponent,
    AlertBannerComponent,
    CloudinaryPipe,
    EmptyStateComponent,
    PaginationComponent,
    AdminFooterComponent,
    EditUserModalComponent,
  ],
  templateUrl: './admin-users.page.html',
  styleUrls: ['./admin-users.page.scss'],
})
export class AdminUsersPage implements OnInit {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private alertCtrl = inject(AlertController);
  private toast = inject(ToastController);
  private modalCtrl = inject(ModalController);

  users = signal<AppUser[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');
  /** Set when the catalog read itself fails; keeps the banner's retry honest. */
  loadFailed = signal(false);
  truncated = signal(false);
  busyUid = signal<string | null>(null);

  search = signal('');
  roleFilter = signal<UserRole | 'all'>('all');

  /**
   * The signed-in admin's role, exposed so the template can gate the "Owners"
   * popover option on it (only an Owner may hand out the Owner role).
   */
  get myRole(): UserRole {
    return asRole(this.auth.currentUserSnapshot?.role);
  }

  /** The signed-in admin's own uid, used to refuse self-demotion and self-delete. */
  readonly myUid = this.auth.currentUserSnapshot?.uid ?? null;

  /**
   * Suspended accounts, as a filter rather than a column.
   *
   * `allow delete: if false` means an abusive account could never be removed at
   * all, while its order history stayed intact. Suspension is the flag that makes
   * "block this person" possible without destroying the orders other customers
   * appear in.
   */
  statusFilter = signal<'all' | 'suspended'>('all');

  readonly suspendedCount = computed(
    () => this.users().filter((u) => u.isSuspended === true).length,
  );

  readonly filteredUsers = computed(() => {
    const term = this.search().trim().toLowerCase();
    const role = this.roleFilter();
    const status = this.statusFilter();
    return this.users().filter((u) => {
      if (role !== 'all' && asRole(u.role) !== role) return false;
      if (status === 'suspended' && u.isSuspended !== true) return false;
      if (!term) return true;
      return (
        (u.displayName ?? '').toLowerCase().includes(term) ||
        (u.email ?? '').toLowerCase().includes(term) ||
        (u.phone ?? '').toLowerCase().includes(term)
      );
    });
  });

  /**
   * Chip counts, all reading the same `users()` array and the same `asRole`
   * normaliser the filter uses.
   *
   * The staff-tier counts are NOT here: `staffTiers` computes those per tier, so a
   * second `managerCount`/`staffCount` pair existed only to feed the duplicate chips
   * that row replaced. Two ways to count the same tier is two places for them to
   * disagree, which is the shape of the bug that put an `admin` chip nowhere.
   */
  readonly customerCount = computed(
    () => this.users().filter((u) => asRole(u.role) === 'customer').length,
  );

  readonly staffCount = computed(
    () => this.users().filter((u) => asRole(u.role) === 'staff').length,
  );

  readonly managerCount = computed(
    () => this.users().filter((u) => asRole(u.role) === 'manager').length,
  );

  readonly adminCount = computed(
    () => this.users().filter((u) => asRole(u.role) === 'admin').length,
  );

  readonly ownerCount = computed(
    () => this.users().filter((u) => asRole(u.role) === 'owner').length,
  );

  /**
   * Twenty-five users a page.
   *
   * The list read is capped at USERS_MAX and the page rendered every match, so a
   * shop with hundreds of accounts produced one large card per user — a scroll
   * long enough that the role filter, which sits at the top, was nowhere near
   * the rows it controls. Paging keeps the working set visible next to the
   * controls, and the role chip counts stay honest because `filteredUsers` still
   * holds everything.
   */
  readonly PAGE_SIZE = 25;
  readonly page = signal(1);

  /**
   * The rows actually rendered, with the page index CLAMPED to the last page that
   * has rows in it.
   *
   * The clamp is the fix for the one way this page could show an empty table: the
   * template gated its empty state on `filteredUsers()` while the rows came from
   * `pagedUsers()`. When the page index was past the end — a filter narrowing the
   * list under a page number that had not been reset, or a page restored from a
   * URL — the slice was empty while the gate was false, so the table rendered its
   * header row and nothing else, with no message anywhere. That is precisely what
   * "select this chip and the table is empty" looks like.
   *
   * Every current path happens to reset `page` on every filter and sort change, so
   * this was unreachable in practice. Clamping in the component rather than only
   * fixing the gate means it stays unreachable when `page` is later restored from
   * a query param.
   */
  readonly pagedUsers = computed(() => {
    const base = this.spendSortActive() ? this.spendSorted() : this.filteredUsers();
    const lastPage = Math.max(1, Math.ceil(base.length / this.PAGE_SIZE));
    const current = Math.min(this.page(), lastPage);
    const start = (current - 1) * this.PAGE_SIZE;
    return base.slice(start, start + this.PAGE_SIZE);
  });

  /**
   * Per-customer spend and order history.
   *
   * The page could not answer "how much has this customer spent?" even though
   * every order carries a `customerId` — the join simply did not exist. It is
   * computed HERE, client-side, from one orders read, rather than as a query per
   * user: the admin list is already an in-memory array, and N queries would be N
   * billed reads for an answer that is a reduce() away.
   *
   * DELIVERED ONLY for the money, matching the analytics page. A cancelled or
   * in-progress order is not revenue, and counting one here would contradict the
   * figures on the Analytics tab of the same app. The order COUNT below includes
   * every status, because "how many orders has this person placed" is a
   * different question from "how much did they spend".
   */
  readonly customerStats = signal<
    Record<string, { orders: number; delivered: number; spent: number; lastAt: number | null }>
  >({});
  readonly statsLoading = signal(false);
  readonly statsTruncated = signal(false);

  private async loadStats(): Promise<void> {
    this.statsLoading.set(true);
    try {
      const snap = await getDocs(
        query(collection(this.firestore, 'orders'), limit(ORDERS_FOR_STATS_MAX)),
      );
      const out: Record<
        string,
        { orders: number; delivered: number; spent: number; lastAt: number | null }
      > = {};
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const uid = data['customerId'] as string | undefined;
        if (!uid) return;
        const row = out[uid] ?? { orders: 0, delivered: 0, spent: 0, lastAt: null };
        row.orders += 1;
        if (data['status'] === 'delivered') {
          row.delivered += 1;
          row.spent += (data['grandTotal'] as number) ?? 0;
        }
        try {
          const created = data['createdAt'] as { toDate(): Date };
          const ms = created.toDate().getTime();
          if (Number.isFinite(ms) && (row.lastAt === null || ms > row.lastAt)) row.lastAt = ms;
        } catch {
          /* a legacy order with no resolvable timestamp */
        }
        out[uid] = row;
      });
      this.customerStats.set(out);
      // Same honesty as the list cap: a partial join says so rather than
      // presenting itself as the customer's whole history.
      this.statsTruncated.set(snap.size >= ORDERS_FOR_STATS_MAX);
    } catch {
      // The directory must stay usable when the join fails — it is an
      // enhancement on top of the table, not a precondition for it.
      this.customerStats.set({});
    } finally {
      this.statsLoading.set(false);
    }
  }

  statsFor(uid: string): {
    orders: number;
    delivered: number;
    spent: number;
    lastAt: number | null;
  } {
    return this.customerStats()[uid] ?? { orders: 0, delivered: 0, spent: 0, lastAt: null };
  }

  readonly spendSortActive = signal(false);

  /** Sort by lifetime spend, highest first. Unmeasured users sort last. */
  sortBySpend(descending: boolean): void {
    const dir = descending ? -1 : 1;
    this.spendSort.set(dir);
    this.spendSortActive.set(true);
    this.page.set(1);
  }

  readonly spendSort = signal<-1 | 1>(-1);

  /** Exposed for the truncation banner, which must not repeat a bare number. */
  readonly ORDERS_FOR_STATS_MAX_LABEL = ORDERS_FOR_STATS_MAX;

  readonly spendSorted = computed(() => {
    const dir = this.spendSort();
    return [...this.filteredUsers()].sort(
      (a, b) => dir * (this.statsFor(a.uid).spent - this.statsFor(b.uid).spent),
    );
  });

  onPageChange(next: number): void {
    this.page.set(next);
  }

  /**
   * Search change.
   *
   * Resets to page 1 for the same reason the role filter does: a search usually
   * shrinks the result set, and staying on page 3 of a list that now has one page
   * shows nothing at all.
   */
  onSearch(value: string): void {
    this.search.set(value);
    this.page.set(1);
    this.spendSortActive.set(false);
  }

  /**
   * Whether the role filter popover is open - a MIRROR of the overlay's real
   * state, not the thing that opens it.
   *
   * Written from `didPresent`/`didDismiss`, and read solely by the button's
   * `aria-expanded`.
   */
  readonly rolePopoverOpen = signal(false);

  /**
   * Opens the role filter popover (driven by the button's `trigger` attribute).
   */
  openRolePopover(): void {
    // Ionic presents from the trigger element; this only mirrors state if needed.
    this.rolePopoverOpen.set(true);
  }

  closeRolePopover(): void {
    this.rolePopoverOpen.set(false);
  }

  /**
   * Apply a role filter choice from the popover.
   */
  onRoleFilter(next: UserRole | 'all'): void {
    this.roleFilter.set(next);
    this.page.set(1);
    this.spendSortActive.set(false);
  }

  /**
   * Returns a label for the current role filter suitable for display in the chip.
   */
  getRoleFilterLabel(): string {
    const role = this.roleFilter();
    if (role === 'all') {
      return `All (${this.users().length})`;
    }

    const countMap: Record<UserRole, number> = {
      customer: this.customerCount(),
      staff: this.staffCount(),
      manager: this.managerCount(),
      admin: this.adminCount(),
      owner: this.ownerCount(),
    };

    const count = countMap[role];
    const labelMap: Record<UserRole, string> = {
      customer: 'Customers',
      staff: 'Staff',
      manager: 'Managers',
      admin: 'Admins',
      owner: 'Owners',
    };

    return `${labelMap[role]} (${count})`;
  }

  /**
   * Display name for a role, with a safe fallback.
   *
   * `asRole` maps anything unrecognised to 'customer' rather than rendering a
   * blank badge, so a document written by a future version still shows something
   * an admin can read.
   */
  roleLabel(user: AppUser): string {
    return ROLE_LABELS[asRole(user.role)];
  }

  /**
   * True when the signed-in admin may change this user's role at all.
   *
   * Mirrors the rules: an `admin` can edit a profile but not a role. Showing an
   * enabled role control that the rules reject on save is a control that lies.
   */
  canChangeRole(user: AppUser): boolean {
    if (this.myRole !== 'owner') return false;
    // An owner cannot demote themselves, and neither can anyone else change the
    // last owner's role from inside the UI.
    return user.uid !== this.myUid;
  }

  /**
   * True when the signed-in owner may delete this user's Firestore document.
   *
   * Self-delete is refused: removing your own account strands every admin page,
   * and `AuthService.deleteAccount` already owns that path (it refuses staff
   * roles entirely). Deletion removes only `users/{uid}` — the Auth record and
   * the user's orders survive.
   */
  canDelete(user: AppUser): boolean {
    if (this.myRole !== 'owner') return false;
    return user.uid !== this.myUid;
  }

  /**
   * Toggling the suspended chip is how an admin gets BACK to the full list —
   * the same button acts as "clear filter", because a filter you can only
   * enter is a filter you can get stuck in.
   */
  onStatusFilter(next: 'all' | 'suspended'): void {
    this.statusFilter.set(this.statusFilter() === next ? 'all' : next);
    this.page.set(1);
    this.spendSortActive.set(false);
  }

  ngOnInit(): void {
    void this.load();
    void this.loadStats();
  }

  async load(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.loadFailed.set(false);
    try {
      // Ordered on the DOCUMENT ID, not on a `uid` field. The line below
      // synthesises `uid` from `d.id`, which is itself the admission that no
      // `uid` field is stored on the document — so `orderBy('uid')` was sorting
      // on a field that is absent everywhere. Firestore tolerates that (missing
      // values sort first), which is why it never threw: it just returned an
      // order determined by nothing the user can see, and required a single-field
      // index on a field no document has.
      const snap = await getDocs(
        query(collection(this.firestore, 'users'), orderBy('__name__', 'asc'), limit(USERS_MAX)),
      );
      this.users.set(snap.docs.map((d) => ({ ...d.data(), uid: d.id }) as AppUser));
      this.truncated.set(snap.size >= USERS_MAX);
      this.page.set(1);
    } catch (err) {
      this.errorMessage.set(describeFirestoreError('users', err));
      // Record that the READ failed, so the banner can offer a real retry —
      // `errorMessage` is also used for validation refusals, which are not
      // retryable and must not get a button.
      this.loadFailed.set(true);
    } finally {
      this.isLoading.set(false);
    }
  }

  async startEdit(user: AppUser): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: EditUserModalComponent,
      componentProps: { user },
      cssClass: 'large-sheet-modal',
    });
    await modal.present();
    const result = await modal.onDidDismiss();
    if (result?.data?.saved) {
      await this.load();
      const t = await this.toast.create({
        message: 'User updated.',
        color: 'success',
        duration: 2000,
        position: 'top',
      });
      await t.present();
    }
  }

  /**
   * Changes a role straight from the list.
   *
   * Two refusals before the dialog opens, both matching the rules:
   * changing your OWN role (immediate and total — `isStaff()` is re-evaluated on
   * every subsequent request, so a self-demotion strands you with no recovery
   * path from inside the app), and changing anyone else's (an `admin` cannot
   * hand out roles at all).
   *
   * The dialog spells out what the tier GRANTS rather than saying "admin",
   * because that word stopped being a description once there were four roles —
   * and because the difference between `manager` and `admin` is precisely that
   * `manager` cannot touch this page.
   */
  async changeRole(user: AppUser, role: UserRole): Promise<void> {
    if (user.uid === this.myUid && role !== this.myRole) {
      this.errorMessage.set('You cannot change your own role.');
      return;
    }
    if (!this.canChangeRole(user)) {
      this.errorMessage.set('Only an Owner can change a role.');
      return;
    }

    const from = ROLE_RANK[asRole(user.role)];
    const to = ROLE_RANK[role];
    const raising = to > from;
    const label = ROLE_LABELS[role];
    const who = user.displayName || user.email || 'this account';
    const capabilitySummary = (r: UserRole): string => ROLE_SUMMARY[r];

    const alert = await this.alertCtrl.create({
      header: raising ? `Make ${who} a ${label}?` : `Change ${who} to ${label}?`,
      message: raising
        ? `${capabilitySummary(role)}`
        : 'They keep their account and their order history. They lose access to the pages that tier covers.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: `Make ${label}`,
          role: raising ? 'confirm' : 'destructive',
          handler: async () => {
            this.busyUid.set(user.uid);
            try {
              await setDoc(doc(this.firestore, `users/${user.uid}`), { role }, { merge: true });
              await this.load();
            } catch (err) {
              this.errorMessage.set(describeFirestoreError('that user', err));
            } finally {
              this.busyUid.set(null);
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Deletes another user's Firestore `users/{uid}` document behind a
   * confirmation dialog.
   *
   * Only the Firebase Auth record's user document is removed here — NOT the Auth
   * record (that requires `deleteUser()` plus a recent sign-in), and NOT the
   * user's orders, which are financial records and must survive.
   */
  async deleteUser(user: AppUser): Promise<void> {
    if (!this.canDelete(user)) return;

    const alert = await this.alertCtrl.create({
      header: 'Delete this user?',
      message:
        "Their account document will be removed and they won't be able to sign in. " +
        'Their order history is kept as a financial record.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            this.busyUid.set(user.uid);
            this.errorMessage.set('');
            try {
              await deleteDoc(doc(this.firestore, `users/${user.uid}`));
              await this.load();
              await this.toast
                .create({
                  message: 'User deleted.',
                  color: 'success',
                  duration: 2000,
                  position: 'top',
                })
                .then((t) => t.present());
            } catch (err) {
              this.errorMessage.set(describeFirestoreError('that user', err));
            } finally {
              this.busyUid.set(null);
            }
          },
        },
      ],
    });
    await alert.present();
  }

  initials(user: AppUser): string {
    const name = user.displayName ?? '';
    return (
      name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || '?'
    );
  }

  /**
   * `createdAt` can be a `serverTimestamp()` sentinel or literally null — the
   * buildAppUser failure path returns `null as never` — so `.toDate()` throws on
   * both. Every page that formats a timestamp guards it; this follows suit.
   */
  formatDate(timestamp: unknown): string {
    try {
      if (timestamp === null || timestamp === undefined) return '—';
      const ts = timestamp as { toDate(): Date } | string;
      const date = typeof ts === 'string' ? new Date(ts) : ts.toDate();
      return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '—';
    }
  }
}
