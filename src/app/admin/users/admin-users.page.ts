// src/app/admin/users/admin-users.page.ts
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
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonButton,
  IonInput,
  IonAvatar,
  IonToggle,
  IonSelect,
  IonSelectOption,
  IonSkeletonText,
  IonTextarea,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { AuthService } from '../../core/services/auth.service';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { CloudinaryPipe } from '../../shared/pipes/cloudinary.pipe';
import {
  AppUser,
  UserRole,
  ROLE_LABELS,
  ROLE_RANK,
  ROLE_SUMMARY,
  asRole,
} from '../../core/models/user.model';
import {
  Firestore,
  collection,
  getDocs,
  doc,
  setDoc,
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
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonMenuButton,
    IonButton,
    IonInput,
    IonAvatar,
    IonToggle,
    IonSelect,
    IonSelectOption,
    IonSkeletonText,
    IonTextarea,
    AppIconComponent,
    AlertBannerComponent,
    CloudinaryPipe,
    EmptyStateComponent,
    PaginationComponent,
    AppFooterComponent,
  ],
  templateUrl: './admin-users.page.html',
  styleUrls: ['./admin-users.page.scss'],
})
export class AdminUsersPage implements OnInit {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private alertCtrl = inject(AlertController);
  private toast = inject(ToastController);

  users = signal<AppUser[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');
  /** Set when the catalog read itself fails; keeps the banner's retry honest. */
  loadFailed = signal(false);
  truncated = signal(false);
  busyUid = signal<string | null>(null);

  search = signal('');
  roleFilter = signal<'all' | 'staff' | 'manager' | 'admin' | 'owner' | 'customer'>('all');

  // Editor
  editing = signal(false);
  editUid = signal<string | null>(null);
  editName = '';
  editPhone = '';
  editRole: UserRole = 'customer';

  /**
   * Roles this admin may hand out.
   *
   * An `admin` cannot create an `owner` — handing out the role that grants the
   * user directory is exactly the power `firestore.rules` takes away from them
   * (`isAdminUserEdit` excludes `role` entirely). Offering 'Owner' in this
   * dropdown would be a control the rules reject on save, which is worse than
   * not offering it.
   */
  readonly roleOptions = ((): { value: UserRole; label: string }[] => {
    const all: { value: UserRole; label: string }[] = (
      ['customer', 'staff', 'manager', 'admin', 'owner'] as UserRole[]
    ).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
    return this.myRole === 'owner' ? all : all.filter((r) => r.value !== 'owner');
  })();

  private get myRole(): UserRole {
    return asRole(this.auth.currentUserSnapshot?.role);
  }
  /** Staff note. Admin-only; the rules whitelist forbids a customer writing it. */
  editNote = '';
  isSuspended = false;
  suspendReason = '';

  /**
   * The signed-in admin's own uid, so the page can refuse to let them demote
   * themselves.
   *
   * This is a real hazard, not a hypothetical: `allow update: if isAdmin()` is
   * unconditional, so an admin CAN change their own role to 'customer'. The rules
   * do not prevent it and cannot easily — there is no "keep at least one admin"
   * invariant expressible here. Once demoted, `isAdmin()` is false for every
   * subsequent request and every admin page including this one becomes
   * unreachable. A blocked checkbox is the whole defence.
   */
  private readonly myUid = this.auth.currentUserSnapshot?.uid ?? null;

  readonly isSelf = computed(() => (uid: string) => uid === this.myUid);

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

  onRoleFilter(role: 'all' | 'staff' | 'manager' | 'admin' | 'owner' | 'customer'): void {
    this.roleFilter.set(role);
    this.page.set(1);
    this.spendSortActive.set(false);
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
   * How many staff accounts exist at or above each tier.
   *
   * A single "Admins (3)" count was true only while there was one admin role.
   * With four tiers it is the kind of number that stops meaning anything, and the
   * question it answered — "who could do this before I could?" — is asked per
   * tier.
   */
  readonly staffTiers = computed(() => {
    const rank = ROLE_RANK[this.myRole];
    // `<=`, not `>=`. The page sits behind `capabilityGuard('manage_users')`,
    // which is OWNER-only, so `rank` is always 4 and `>= 4` selected `owner`
    // alone: `admin` — a whole tier — got NO chip anywhere on the page, and the
    // doc comment's "at or above each tier" described the opposite of what the
    // code did.
    //
    // `<=` means "this tier and everyone above it", which is what an owner needs:
    // the question behind this row is "who can do what I cannot?", and the answer
    // for an owner is every tier that exists.
    //
    // This is why group one of the chips (All / Customers / Managers / Staff) has
    // its Managers and Staff entries removed: they appear here already, and
    // leaving both would render two `Staff (1)` chips wired to the same filter,
    // both lighting up as active at once.
    return (['staff', 'manager', 'admin', 'owner'] as UserRole[])
      .filter((r) => ROLE_RANK[r] <= rank)
      .map((role) => ({
        role,
        label: ROLE_LABELS[role],
        count: this.users().filter((u) => asRole(u.role) === role).length,
      }));
  });

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
   * The same check for the open editor, where only the uid is known.
   *
   * A separate method because Angular templates cannot write `as AppUser`, and
   * `AppUser` has eleven fields of which the check reads exactly one. Building a
   * partial object in the template to satisfy a signature would be worse than a
   * one-line method named for what it answers.
   */
  canChangeEditRole(): boolean {
    const uid = this.editUid();
    return !!uid && this.canChangeRole({ uid } as AppUser);
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

  startEdit(user: AppUser): void {
    this.editing.set(true);
    this.editUid.set(user.uid);
    this.editName = user.displayName ?? '';
    this.editPhone = user.phone ?? '';
    this.editRole = asRole(user.role);
    this.editNote = user.adminNote ?? '';
    // `=== true`, not truthy: `isSuspended` is optional and a document written
    // before the field existed must open as NOT suspended, never as "suspended
    // with no reason" because of a stray non-boolean.
    this.isSuspended = user.isSuspended === true;
    this.suspendReason = user.suspendReason ?? '';
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.editUid.set(null);
  }

  /**
   * Saves another user's details.
   *
   * `merge: true` is mandatory here for the same reason it is in AuthService: the
   * admin branch of the users rule is `allow update: if isAdmin()`, with no
   * validation at all. A non-merged write that omits `role` SUCCEEDS and strips
   * it, which silently demotes the target — and if the target is the admin doing
   * the writing, locks them out of the app's admin side entirely.
   *
   * `email` is not editable. The users rule has no `hasOnly`, so an admin could
   * write any string into someone's `email` field — including one that does not
   * match their real Firebase Auth account, which is the address they sign in
   * with. Changing someone's sign-in identity is a different, more dangerous
   * operation than editing a display name, so it is not offered here.
   */
  async save(): Promise<void> {
    const uid = this.editUid();
    if (!uid) return;

    const name = this.editName.trim();
    if (!name) {
      this.errorMessage.set('Enter a display name.');
      return;
    }
    if (uid === this.myUid && this.editRole !== this.myRole) {
      this.errorMessage.set(
        'You cannot change your own role — that would lock you out of the admin pages you can reach.',
      );
      return;
    }
    // Mirrors `isAdminUserEdit()` in the rules. Better to refuse here with a
    // clear sentence than to let the write fail with a permission error the
    // admin has no way to interpret.
    if (uid !== this.myUid && !this.canChangeRole({ uid } as AppUser)) {
      this.errorMessage.set('Only an Owner can change a role.');
      return;
    }

    this.busyUid.set(uid);
    this.errorMessage.set('');
    try {
      await setDoc(
        doc(this.firestore, `users/${uid}`),
        {
          displayName: name,
          phone: this.editPhone.trim() || null,
          role: this.editRole,
          adminNote: this.editNote.trim() || null,
          // A suspension always carries a timestamp and a reason, written
          // together. A bare flag with neither is how an admin forgets why they
          // blocked someone, and the customer gets told nothing at sign-in.
          isSuspended: this.isSuspended,
          ...(this.isSuspended
            ? {
                suspendReason: this.suspendReason.trim() || 'No reason given',
                suspendedAt: Date.now(),
              }
            : { suspendReason: null, suspendedAt: null }),
        },
        { merge: true },
      );
      this.cancelEdit();
      await this.load();
      await this.toast
        .create({
          message: 'User updated.',
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
