// src/app/features/settings/settings.page.ts
// Five-orites Scoop — Settings
//
// SCOPE NOTE, READ BEFORE ADDING TO THIS PAGE
// There is deliberately no text-size control here. See the header of
// AppSettingsService for the full reason: roughly 60% of font sizes in this app
// are hardcoded pixels in per-component styles rather than token reads, so a
// scale control would visibly do nothing to most of the screen. Everything on
// this page is backed by a mechanism that genuinely reaches the whole app.
//
// The notification toggle reads the SAME Firestore document the Profile page
// writes, through OrderNotificationService. It used to be tempting to give
// Settings its own copy, which would have produced two toggles on two screens
// that disagree with each other — the Profile toggle is a per-user document and
// is the one that drives the actual push behaviour, so Settings mirrors it
// rather than owning anything.

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  IonButtons,
  IonContent,
  IonHeader,
  IonLabel,
  IonMenuButton,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular/standalone';

import { AppSettingsService } from '@core/services/shop/app-settings.service';
import { NotificationService } from '@core/services/orders/notification.service';
import { AuthService } from '@core/services/identity/auth.service';
import type { AppUser } from '@core/models/user.model';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { AppFooterComponent } from '@shared/components/commerce/app-footer.component';
import { SectionHeaderComponent } from '@shared/components/ui/section-header.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    RouterLink,
    IonButtons,
    IonContent,
    IonHeader,
    IonLabel,
    IonMenuButton,
    IonSegment,
    IonSegmentButton,
    IonTitle,
    IonToggle,
    IonToolbar,
    AppIconComponent,
    AppFooterComponent,
    SectionHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
})
export class SettingsPage {
  protected readonly settings = inject(AppSettingsService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);

  protected readonly version = '1.0.0';

  /**
   * The signed-in user, as a SIGNAL.
   *
   * This was a computed reading `auth.currentUserSnapshot` directly, and that
   * is the same trap the profile page documents: a computed caches on signal
   * reads, and currentUserSnapshot is a plain getter over a BehaviorSubject, so
   * the computed read no signal, was evaluated once, and was frozen for the
   * life of the page. The toggle then showed the account that happened to be
   * signed in when the page was first opened — and stayed on it after the
   * account changed.
   *
   * Holding the user in a signal fed by currentUser$ makes the computed
   * actually reactive, and the account change now moves the toggle with it.
   */
  private readonly currentUser = signal<AppUser | null>(null);

  /**
   * Mirrors the Profile page's notification logic rather than inventing a second
   * path, so the two screens can never disagree about the state.
   *
   * This used to be a three-state model - `granted` / `blocked` / `off` - because
   * the app asked the OS for notification permission so it could register for
   * FCM. Notifications are now in-app only, so there is no permission to grant and
   * no blocked state to render: the stored preference is the whole truth.
   */
  protected readonly updatesOn = computed(() =>
    this.notifications.isEnabled(this.currentUser()?.notificationsEnabled),
  );

  constructor() {
    this.auth.currentUser$.pipe(takeUntilDestroyed()).subscribe((u) => this.currentUser.set(u));
  }

  /**
   * A pure preference write, in both directions.
   *
   * There is no prompt to request and no denial to reconcile, which is what this
   * collapses to. It also means the toggle can no longer get into the dishonest
   * state it was built to avoid - it used to be able to sit visually ON with
   * nothing delivered, and needed a browser-permission prompt and a rollback path
   * to prevent it. With no second axis there is nothing to fall out of step.
   */
  protected async onNotifications(event: CustomEvent<{ checked: boolean }>): Promise<void> {
    await this.auth.updateProfile({ notificationsEnabled: event.detail.checked });
  }

  protected onAppearance(event: CustomEvent): void {
    const value = (event.detail as { value?: string }).value;
    if (value === 'light' || value === 'dark' || value === 'system') {
      this.settings.setTheme(value);
    }
  }
}
