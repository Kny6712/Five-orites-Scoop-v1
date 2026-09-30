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
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonButton,
  IonInput, IonItem, IonLabel, IonAvatar, IonToggle,
  IonSelect, IonSelectOption, IonSkeletonText,
  AlertController, ToastController, ModalController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { AuthService } from '../../core/services/auth.service';
import { describeFirestoreError } from '../../core/logic/firestore-error';
import { CloudinaryPipe } from '../../shared/pipes/cloudinary.pipe';
import { AppUser, UserRole } from '../../core/models/user.model';
import {
  Firestore, collection, getDocs, doc, setDoc, query, orderBy, limit,
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

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonButton,
    IonInput, IonItem, IonLabel, IonAvatar, IonToggle,
    IonSelect, IonSelectOption, IonSkeletonText,
    AppIconComponent, AlertBannerComponent, CloudinaryPipe,
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
  truncated = signal(false);
  busyUid = signal<string | null>(null);

  search = signal('');
  roleFilter = signal<'all' | UserRole>('all');

  // Editor
  editing = signal(false);
  editUid = signal<string | null>(null);
  editName = '';
  editPhone = '';
  editRole: UserRole = 'customer';

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

  readonly filteredUsers = computed(() => {
    const term = this.search().trim().toLowerCase();
    const role = this.roleFilter();
    return this.users().filter((u) => {
      if (role !== 'all' && u.role !== role) return false;
      if (!term) return true;
      return (
        (u.displayName ?? '').toLowerCase().includes(term) ||
        (u.email ?? '').toLowerCase().includes(term) ||
        (u.phone ?? '').toLowerCase().includes(term)
      );
    });
  });

  readonly adminCount = computed(() => this.users().filter((u) => u.role === 'admin').length);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    try {
      const snap = await getDocs(
        query(collection(this.firestore, 'users'), orderBy('uid', 'asc'), limit(USERS_MAX))
      );
      this.users.set(snap.docs.map((d) => ({ ...d.data(), uid: d.id }) as AppUser));
      this.truncated.set(snap.size >= USERS_MAX);
    } catch (err) {
      this.errorMessage.set(describeFirestoreError('users', err));
    } finally {
      this.isLoading.set(false);
    }
  }

  startEdit(user: AppUser): void {
    this.editing.set(true);
    this.editUid.set(user.uid);
    this.editName = user.displayName ?? '';
    this.editPhone = user.phone ?? '';
    this.editRole = user.role;
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
    if (uid === this.myUid && this.editRole !== 'admin') {
      this.errorMessage.set(
        'You cannot remove your own admin access — that would lock you out of every admin page.'
      );
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
        },
        { merge: true }
      );
      this.cancelEdit();
      await this.load();
      await this.toast.create({
        message: 'User updated.',
        color: 'success',
        duration: 2000,
        position: 'top',
      }).then((t) => t.present());
    } catch (err) {
      this.errorMessage.set(describeFirestoreError('that user', err));
    } finally {
      this.busyUid.set(null);
    }
  }

  /**
   * Promotes or demotes directly from the list.
   *
   * Demoting yourself is blocked outright, and the reason is surfaced in the
   * dialog rather than swallowed: `isAdmin()` is re-evaluated on every subsequent
   * request, so a self-demotion is immediate and total, with no recovery path
   * from inside the app.
   */
  async changeRole(user: AppUser, role: UserRole): Promise<void> {
    if (user.uid === this.myUid && role !== 'admin') {
      this.errorMessage.set(
        'You cannot remove your own admin access — that would lock you out of every admin page.'
      );
      return;
    }

    const promoting = role === 'admin';
    const alert = await this.alertCtrl.create({
      header: promoting ? `Make ${user.displayName || user.email} an admin?` : `Remove admin access?`,
      message: promoting
        ? 'They will be able to manage inventory, orders, analytics, vouchers and every user account.'
        : 'They will keep their account and orders, but lose access to every admin page.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: promoting ? 'Make admin' : 'Remove access',
          role: promoting ? 'confirm' : 'destructive',
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
