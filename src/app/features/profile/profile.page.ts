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
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonButton, IonSpinner,
  IonInput, IonItem, IonLabel, IonAvatar, IonToggle,
  ToastController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { CloudinaryPipe } from '../../shared/pipes/cloudinary.pipe';
import { AuthService } from '../../core/services/auth.service';
import { ImageUploadService } from '../../core/services/image-upload.service';
import { NotificationService, type NotificationPermissionState } from '../../core/services/notification.service';
import type { AppUser } from '../../core/models/user.model';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonButton, IonSpinner,
    IonInput, IonItem, IonLabel, IonAvatar, IonToggle,
    AppIconComponent, AlertBannerComponent, CloudinaryPipe, AppFooterComponent,
  ],
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
})
export class ProfilePage implements OnInit {
  private auth = inject(AuthService);
  private uploads = inject(ImageUploadService);
  private notifications = inject(NotificationService);
  private toast = inject(ToastController);

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
  readonly notificationState = computed<NotificationPermissionState>(() =>
    this.notifications.permissionState(this.user()?.notificationsEnabled)
  );

  /** True when the user has changed something worth saving. */
  readonly isDirty = computed(() => {
    const u = this.user();
    if (!u) return false;
    return (
      this.displayName !== (u.displayName ?? '') ||
      this.phone !== (u.phone ?? '')
    );
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
      await this.toast.create({
        message: 'Profile updated!',
        color: 'success',
        duration: 2000,
        position: 'top',
      }).then((t) => t.present());
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
      await this.toast.create({
        message: 'Photo updated!',
        color: 'success',
        duration: 2000,
        position: 'top',
      }).then((t) => t.present());
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
      await this.toast.create({
        message: 'Check your new email for a confirmation link.',
        color: 'success',
        duration: 4000,
        position: 'top',
      }).then((t) => t.present());
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'Could not change your email.');
    } finally {
      this.isChangingEmail = false;
    }
  }

  /**
   * Turning notifications ON necessarily asks the browser, because the permission
   * can only be requested from a user gesture. Turning them OFF is a pure
   * preference write with no prompt — which is what makes the toggle feel like a
   * switch rather than a dialog.
   */
  async onNotificationsToggle(event: CustomEvent): Promise<void> {
    const enabled = event.detail.checked as boolean;
    this.errorMessage.set('');
    try {
      if (enabled) {
        const granted = await this.notifications.requestPermission();
        if (!granted) {
          // Put the switch back. Writing `false` would silently discard the
          // user's intent, and leaving it visually on while nothing is delivered
          // is the exact dishonesty this control was built to avoid.
          await this.auth.updateProfile({ notificationsEnabled: false });
          const fresh = await this.auth.refreshProfile();
          this.applyUser(fresh);
          this.fail(
            'Your browser blocked notifications. To turn them on, allow notifications for this site in your browser settings.'
          );
          return;
        }
      }
      const updated = await this.auth.updateProfile({ notificationsEnabled: enabled });
      this.applyUser(updated);
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'Could not save that preference.');
    }
  }

  private fail(message: string): void {
    this.errorMessage.set(message);
    this.saveState.set('error');
  }
}
