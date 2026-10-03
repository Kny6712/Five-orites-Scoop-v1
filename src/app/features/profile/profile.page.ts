// src/app/features/profile/profile.page.ts
// Five-orites Scoop — Profile (name, avatar, email, phone) for customers AND admins
//
// ONE PAGE, BOTH ROLES
// The brief asked for a profile page under CLIENT and again under ADMIN. They are
// the same thing: an admin is a signed-in user with a profile, and admins already
// get the customer nav items. A separate admin page would be duplicate logic with
// an extra footgun — the Admin Users page can edit anyone, and the biggest risk
// in this area is a non-merged write silently stripping `role`, which is exactly
// the code you would copy twice.
//
// The admin-only capability (editing OTHER users) lives on /admin/users, where
// the destructive parts (role changes) are visible and confirmed.

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AlertController,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonButton,
  IonSpinner,
  IonInput,
  IonItem,
  IonLabel,
  IonAvatar,
  IonToggle,
  ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { CloudinaryPipe } from '../../shared/pipes/cloudinary.pipe';
import { AuthService } from '../../core/services/auth.service';
import { ImageUploadService } from '../../core/services/image-upload.service';
import { NotificationService } from '../../core/services/notification.service';
import type { AppUser } from '../../core/models/user.model';
import { isStaffRole } from '../../core/models/user.model';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

@Component({
  selector: 'app-profile',
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
    IonSpinner,
    IonInput,
    IonItem,
    IonLabel,
    IonAvatar,
    IonToggle,
    AppIconComponent,
    AlertBannerComponent,
    CloudinaryPipe,
    AppFooterComponent,
  ],
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
})
export class ProfilePage implements OnInit {
  private auth = inject(AuthService);
  private uploads = inject(ImageUploadService);
  private notifications = inject(NotificationService);
  private toast = inject(ToastController);
  private alertCtrl = inject(AlertController);

  user = signal<AppUser | null>(null);

  // Form fields. Seeded from the user, which is why `?? ''` matters throughout:
  // a console-bootstrapped admin has no displayName at all.
  displayName = '';
  phone = '';

  newEmail = '';
  emailPassword = '';
  isChangingEmail = false;

  saveState = signal<SaveState>('idle');
  errorMessage = signal('');
  isUploadingPhoto = signal(false);

  /**
   * Google (and any other external identity) owns the address, so it cannot be
   * changed here without locking the user out of their own account. Detected from
   * providerData rather than hardcoded, so a second provider is handled too.
   */
  readonly emailLocked = computed(() => this.auth.isEmailManagedByProvider());

  /**
   * Three states, not two. A boolean toggle cannot say "you asked for this and
   * the browser said no" — and once a browser permission is denied it cannot be
   * re-granted from a page, so the user has to change it in site settings. Saying
   * so is the difference between a setting and a broken button.
   */
  readonly updatesOn = computed(() =>
    this.notifications.isEnabled(this.user()?.notificationsEnabled),
  );

  /** True when the user has changed something worth saving. */
  readonly isDirty = computed(() => {
    const u = this.user();
    if (!u) return false;
    return this.displayName !== (u.displayName ?? '') || this.phone !== (u.phone ?? '');
  });

  readonly initials = computed(() => {
    const name = this.user()?.displayName ?? '';
    return (
      name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || '?'
    );
  });

  ngOnInit(): void {
    const u = this.auth.currentUserSnapshot;
    if (u) this.applyUser(u);
  }

  private applyUser(u: AppUser): void {
    this.user.set(u);
    this.displayName = u.displayName ?? '';
    this.phone = u.phone ?? '';
    this.newEmail = u.email ?? '';
  }

  async saveProfile(): Promise<void> {
    const name = this.displayName.trim();
    if (!name) {
      this.fail('Please enter a name.');
      return;
    }

    // PH mobile numbers, tolerating the separators people actually type. The
    // group is 09XX XXX XXXX, optionally with a +63 country code in place of the
    // leading 0.
    const digits = this.phone.replace(/[\s()-]/g, '');
    if (digits && !/^(?:\+?63|0)9\d{9}$/.test(digits)) {
      this.fail('Enter a valid PH mobile number, e.g. 0917 123 4567.');
      return;
    }

    this.saveState.set('saving');
    this.errorMessage.set('');
    try {
      const updated = await this.auth.updateProfile({
        displayName: name,
        // Store null rather than '' for an emptied field, so "no phone number"
        // is one unambiguous value instead of two.
        phone: digits || null,
      });
      this.applyUser(updated);
      this.saveState.set('saved');
      await this.toast
        .create({
          message: 'Profile updated!',
          color: 'success',
          duration: 2000,
          position: 'top',
        })
        .then((t) => t.present());
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'Could not save your profile.');
    }
  }

  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset immediately so re-picking the same file fires `change` again —
    // otherwise a user who dislikes a crop and picks the same photo again gets
    // no event and no feedback.
    input.value = '';
    if (!file) return;

    this.isUploadingPhoto.set(true);
    this.errorMessage.set('');
    try {
      const photoURL = await this.uploads.uploadAvatar(file);
      const updated = await this.auth.updateProfile({ photoURL });
      this.applyUser(updated);
      await this.toast
        .create({
          message: 'Photo updated!',
          color: 'success',
          duration: 2000,
          position: 'top',
        })
        .then((t) => t.present());
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'Could not upload that photo.');
    } finally {
      this.isUploadingPhoto.set(false);
    }
  }

  async removePhoto(): Promise<void> {
    this.isUploadingPhoto.set(true);
    try {
      // Explicit null, which is how updateProfile is told to CLEAR a photo
      // rather than leave it alone.
      const updated = await this.auth.updateProfile({ photoURL: null });
      this.applyUser(updated);
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'Could not remove your photo.');
    } finally {
      this.isUploadingPhoto.set(false);
    }
  }

  async changeEmail(): Promise<void> {
    const email = this.newEmail.trim().toLowerCase();
    if (!this.emailPassword) {
      this.fail('Enter your current password to change your email.');
      return;
    }
    this.isChangingEmail = true;
    this.errorMessage.set('');
    try {
      await this.auth.changeEmail(email, this.emailPassword);
      const fresh = await this.auth.refreshProfile();
      this.applyUser(fresh);
      this.emailPassword = '';
      await this.toast
        .create({
          message: 'Check your new email for a confirmation link.',
          color: 'success',
          duration: 4000,
          position: 'top',
        })
        .then((t) => t.present());
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'Could not change your email.');
    } finally {
      this.isChangingEmail = false;
    }
  }

  /**
   * A pure preference write, in both directions.
   *
   * This used to prompt for an OS permission when turning notifications ON and
   * roll the switch back on a denial, because the app registered for FCM push.
   * In-app notifications need no permission, so there is nothing to prompt for and
   * nothing to reconcile — which also removes the failure this method was built
   * around, where the switch could read "on" while nothing was ever delivered.
   */
  async onNotificationsToggle(event: CustomEvent): Promise<void> {
    const enabled = event.detail.checked as boolean;
    this.errorMessage.set('');
    try {
      const updated = await this.auth.updateProfile({ notificationsEnabled: enabled });
      this.applyUser(updated);
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'Could not save that preference.');
    }
  }

  // ── Account deletion ───────────────────────────────────────────────────────

  /** True for any staff tier. The delete UI is hidden for these. */
  readonly isStaff = computed(() => isStaffRole(this.user()?.role));

  readonly isDeleting = signal(false);
  readonly deleteError = signal('');
  deletePassword = '';

  /**
   * Whether the password field must be shown before deleting.
   *
   * `deleteUser()` throws `auth/requires-recent-login` unless the session is
   * fresh, and the only way to refresh it is to re-enter the password. Checking
   * up front means the user is prompted once, here, rather than pressing Delete
   * and being handed an opaque Firebase error code.
   *
   * Google-managed accounts have no password to re-enter — reauthentication is
   * Google's dialog — so the field is skipped entirely for them.
   */
  readonly needsPasswordForDelete = computed(
    () => !this.auth.isEmailManagedByProvider() && !this.auth.recentlyAuthenticated(),
  );

  /**
   * Deletes the account behind a confirmation dialog.
   *
   * The dialog is not decoration. This is the most irreversible action in the
   * app, and a single mis-tap on a button that only appears on one page should
   * not be able to destroy someone's account and order history.
   *
   * THE DIALOG SAYS WHAT ACTUALLY HAPPENS, which is less than it used to claim.
   * This text once ended "…but your name, email and address are removed from
   * them." That was false. The redaction was to be done by the
   * `anonymiseDeletedCustomerOrders` Cloud Function, and this project is on the
   * free Spark plan, so that function has never been deployed and has never run.
   * Deleting the account therefore leaves name, email and delivery address on
   * every order that customer ever placed — those orders are the shop's sales
   * records, and they are retained.
   *
   * PRIVACY.md now says exactly this too. A confirmation dialog is the last place
   * a user reads before an irreversible action, so it is the worst place to be
   * vague: a promise made here is a promise the shop is held to.
   */
  async confirmDeleteAccount(): Promise<void> {
    if (this.isDeleting()) return;
    this.deleteError.set('');

    const alert = await this.alertCtrl.create({
      header: 'Delete your account?',
      message:
        'This permanently deletes your account and cannot be undone. Your past orders are kept as sales records, and they still show the name, email and address you ordered with. Delete your account only if you are comfortable with that.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete my account', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;

    this.isDeleting.set(true);
    try {
      // Re-authenticate first when required, so the session is fresh by the time
      // deleteUser() runs rather than failing after the Firestore document is
      // already gone.
      if (this.needsPasswordForDelete() && this.deletePassword) {
        await this.auth.reauthenticateWithPassword(this.deletePassword);
      }
      await this.auth.deleteAccount();
      // Nothing to navigate to -- the session is gone and every route is behind
      // authGuard, which would bounce to /auth anyway. A full reload clears any
      // cached state that assumed a signed-in user.
      window.location.assign('/auth');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // `auth/requires-recent-login` is the one failure the user can actually
      // act on, so it gets a sentence rather than a code.
      this.deleteError.set(
        /requires-recent-login/i.test(message)
          ? 'Your session is too old for this. Enter your password above and try again.'
          : message,
      );
      this.isDeleting.set(false);
    }
  }

  private fail(message: string): void {
    this.errorMessage.set(message);
    this.saveState.set('error');
  }
}
