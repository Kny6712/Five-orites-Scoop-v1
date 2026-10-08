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

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButtons,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular/standalone';

import { AppSettingsService } from '../../core/services/app-settings.service';
import { NotificationService } from '../../core/services/notification.service';
import { AuthService } from '../../core/services/auth.service';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { SectionHeaderComponent } from '../../shared/components/section-header/section-header.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    RouterLink,
    IonButtons,
    IonContent,
    IonHeader,
    IonMenuButton,
    IonTitle,
    IonToggle,
    IonToolbar,
    AppIconComponent,
    AppFooterComponent,
    SectionHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-menu-button aria-label="Open navigation menu"></ion-menu-button>
        </ion-buttons>
        <ion-title>Settings</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content fullscreen>
      <div class="settings-body">
        <app-section-header title="Display" />

        <section class="panel">
          <div class="row">
            <span class="row-icon" aria-hidden="true">
              <app-icon name="zap" />
            </span>
            <div class="row-text">
              <span class="row-title">Reduce motion</span>
              <span class="row-sub"> Collapses animations and transitions across the app. </span>
            </div>
            <ion-toggle
              [checked]="settings.effectiveReduceMotion()"
              (ionChange)="settings.setReduceMotion($event.detail.checked)"
              aria-label="Reduce motion"
            ></ion-toggle>
          </div>

          <p class="row-note">
            Already on because your device asks for it. Turning this off will not override that.
          </p>

          <div class="row">
            <span class="row-icon" aria-hidden="true">
              <app-icon name="contrast" />
            </span>
            <div class="row-text">
              <span class="row-title">Higher contrast</span>
              <span class="row-sub"> Darker text and stronger borders on pale surfaces. </span>
            </div>
            <ion-toggle
              [checked]="settings.highContrast()"
              (ionChange)="settings.setHighContrast($event.detail.checked)"
              aria-label="Higher contrast"
            ></ion-toggle>
          </div>
        </section>

        <app-section-header title="Notifications" />

        <section class="panel">
          <div class="row">
            <span class="row-icon" aria-hidden="true">
              <app-icon name="bell" />
            </span>
            <div class="row-text">
              <span class="row-title">Order updates</span>
              <span class="row-sub">Tell me when an order changes status.</span>
            </div>
            <ion-toggle
              [checked]="updatesOn()"
              (ionChange)="onNotifications($event)"
              aria-label="Order update notifications"
            ></ion-toggle>
          </div>

          <!--
            States the scope instead of assuming it. There is no blocked state and
            no permission to grant any more — notifications are in-app only, so
            this is a plain preference — but a user who closes the app still
            receives nothing, and that has to be said somewhere the user can read
            it before they rely on it.
          -->
          <p class="row-note">
            Notifications appear inside this app, in your notifications list and as a message while
            it is open. Nothing is sent while the app is closed.
          </p>

          <p class="row-note">
            <a routerLink="/notifications" class="inline-link">Open your notifications</a> &mdash;
            and see the same setting on your
            <a routerLink="/profile" class="inline-link">profile page</a>.
          </p>
        </section>

        <app-section-header title="About" />

        <section class="panel">
          <div class="row row-link" routerLink="/about">
            <span class="row-icon" aria-hidden="true"><app-icon name="info" /></span>
            <div class="row-text">
              <span class="row-title">About Five-orites Scoop</span>
              <span class="row-sub">Our story, mission and vision.</span>
            </div>
            <app-icon name="chevron-right" class="row-chevron" />
          </div>

          <div class="row row-link" routerLink="/developers">
            <span class="row-icon" aria-hidden="true"><app-icon name="code" /></span>
            <div class="row-text">
              <span class="row-title">The team</span>
              <span class="row-sub">Who built this.</span>
            </div>
            <app-icon name="chevron-right" class="row-chevron" />
          </div>

          <div class="row row-link" routerLink="/profile">
            <span class="row-icon" aria-hidden="true"><app-icon name="user" /></span>
            <div class="row-text">
              <span class="row-title">My profile</span>
              <span class="row-sub">Name, photo, email and password.</span>
            </div>
            <app-icon name="chevron-right" class="row-chevron" />
          </div>
        </section>

        <p class="version">Five-orites Scoop &middot; v{{ version }}</p>
      </div>
      <app-footer></app-footer>
    </ion-content>
  `,
  styles: [
    `
      .settings-body {
        max-width: 640px;
        margin: 0 auto;
        padding: var(--space-4) var(--space-4) var(--space-6);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }

      .panel {
        background: var(--color-white);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-card);
        padding: var(--space-2) var(--space-4) var(--space-3);
        margin-bottom: var(--space-3);
      }

      .row {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-3) 0;
      }

      /* Rows are separated by a hairline rather than each being its own card, so
       the page reads as three groups instead of nine floating boxes. The last
       row has no rule, which is why the padding sits on .panel instead. */
      .row + .row {
        border-top: 1px solid var(--ion-color-light-shade);
      }

      .row-icon {
        width: 36px;
        height: 36px;
        flex: 0 0 auto;
        border-radius: var(--radius-sm);
        background: var(--tile-powder);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .row-icon app-icon {
        --icon-size: 18px;
        color: var(--color-primary-ink);
      }

      .row-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .row-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--color-ink);
      }

      .row-sub {
        font-size: 12px;
        color: var(--ion-color-medium);
        line-height: 1.4;
        margin-top: 1px;
      }

      .row-note {
        margin: 0 0 var(--space-2);
        padding-left: calc(36px + var(--space-3));
        font-size: 12px;
        line-height: 1.45;
        color: var(--ion-color-medium);
      }

      .row-note-warn {
        color: var(--tone-warning-ink);
      }

      .inline-link {
        color: var(--color-primary-ink);
        font-weight: 700;
      }

      .row-spinner {
        width: 32px;
        height: 32px;
        flex: 0 0 auto;
      }

      /* A routerLink row needs the whole row to look tappable, not just its text. */
      .row-link {
        cursor: pointer;
      }
      .row-link:hover .row-title {
        color: var(--color-primary-ink);
      }
      .row-chevron {
        --icon-size: 18px;
        color: var(--ion-color-medium);
        flex: 0 0 auto;
      }

      .version {
        margin: var(--space-2) 0 0;
        text-align: center;
        font-size: 12px;
        color: var(--ion-color-medium);
      }
    `,
  ],
})
export class SettingsPage {
  protected readonly settings = inject(AppSettingsService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);

  protected readonly version = '1.0.0';

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
    this.notifications.isEnabled(this.auth.currentUserSnapshot?.notificationsEnabled),
  );

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
}
