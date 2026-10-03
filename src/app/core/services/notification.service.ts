// src/app/core/services/notification.service.ts
// Five-orites Scoop — Push Notification Service (Capacitor + PWA fallback)
// Author: Five-orites Scoop team (see README)

import { Injectable, inject, signal } from '@angular/core';
import { ToastController, Platform } from '@ionic/angular/standalone';
import { OrderStatus } from '../models/order.model';

/**
 * The three states a notification toggle actually has to represent.
 *
 * A plain boolean cannot express this. The trap: a user can tap "enable", be
 * denied by the browser, and the toggle would sit there reading "on" while
 * nothing ever arrives. Worse, once a browser permission is denied it cannot be
 * re-granted from a page at all — the user has to change it in site settings.
 * A toggle that appears broken and offers no way out is worse than one that says
 * why.
 */
export type NotificationPermissionState =
  /** Preference on AND the browser allows it. Notifications will arrive. */
  | 'granted'
  /** Preference on, but the browser has blocked it. Needs a site-settings change. */
  | 'blocked'
  /** Preference off, or permission never requested. */
  | 'off';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private toastCtrl = inject(ToastController);
  private platform = inject(Platform);

  /**
   * What the native permission prompt last answered, for this session.
   *
   * Null until `requestPermission()` has run on a device. See
   * `browserPermission()` for why this has to exist at all.
   */
  private readonly nativePermission = signal<'granted' | 'denied' | 'default' | null>(null);

  /**
   * What has the BROWSER actually allowed?
   *
   * `Notification.permission` is readable without prompting, which is what lets
   * the dashboard show the true state on load rather than assuming "off" until
   * someone taps.
   */
  browserPermission(): 'granted' | 'denied' | 'default' {
    if (this.platform.is('capacitor')) {
      // Native push has no synchronous equivalent of Notification.permission — the
      // Capacitor plugin exposes no getter. Returning a hard-coded 'default'
      // (which is what this used to do) meant `permissionState` below could only
      // ever return 'granted' on a device, so BOTH the Settings and Profile
      // toggles read "on" even after the user tapped Deny. There was no way to
      // reflect a real native refusal.
      //
      // So the answer is remembered instead of guessed: `nativePermission` is set
      // from what `requestPermissions()` actually returned, and it survives for
      // the session. Absent means we have never asked — which is genuinely
      // 'default', the one case where reporting "on" is defensible, because the
      // user has not declined anything yet.
      return this.nativePermission() ?? 'default';
    }
    if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
    const p = (window as unknown as { Notification?: { permission: string } }).Notification;
    return p?.permission === 'granted'
      ? 'granted'
      : p?.permission === 'denied'
        ? 'denied'
        : 'default';
  }

  /**
   * Combines the user's stored preference with what the browser will allow.
   *
   * The preference lives on the user document, not in localStorage, so it
   * follows the user to a new device. See AppUser.notificationsEnabled — absent
   * means ENABLED, so nobody who signed up before this field existed is silently
   * opted out.
   */
  permissionState(preference: boolean | undefined): NotificationPermissionState {
    if (preference === false) return 'off';
    return this.browserPermission() === 'denied' ? 'blocked' : 'granted';
  }

  /**
   * The user's explicit OFF switch, as distinct from what the OS will allow.
   *
   * Separate from `permissionState` because the two answer different questions.
   * `permissionState` is "will a notification actually appear?", which is the
   * honest thing to show next to a toggle that cannot do anything — a toggle
   * reading "on" while the OS has denied permission is worse than no toggle.
   *
   * This is the stored preference, and it is the signal the switches bind to.
   */
  isEnabledByPreference(preference: boolean | undefined): boolean {
    // Absent means enabled: nobody who signed up before this field existed
    // should be silently opted out. Same rule as AppUser.notificationsEnabled.
    return preference !== false;
  }

  async requestPermission(): Promise<boolean> {
    if (this.platform.is('capacitor')) {
      try {
        // Dynamic import to avoid SSR issues
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const result = await PushNotifications.requestPermissions();
        // Record the answer before branching, so a DENIAL is remembered too.
        // Without this the next render falls back to 'default' -> 'granted' and
        // the toggle snaps back to "on" the moment the user says no.
        const granted = result.receive === 'granted';
        this.nativePermission.set(granted ? 'granted' : 'denied');
        if (granted) {
          await PushNotifications.register();
          return true;
        }
        return false;
      } catch (err) {
        // A thrown registration is not the same as a refusal, but it does mean
        // notifications are not going to arrive — reporting 'denied' is closer to
        // the truth than leaving the toggle claiming permission.
        this.nativePermission.set('denied');
        console.warn('Push notification registration error:', err);
        return false;
      }
    }
    // PWA: browser notification API
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return false;
  }

  async showToast(
    message: string,
    color: 'success' | 'warning' | 'danger' | 'primary' = 'primary',
    duration = 3000,
  ): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration,
      color,
      position: 'top',
      // No `buttons: [{ icon: 'close-outline' }]`.
      //
      // That field is rendered by Ionic's INTERNAL ion-icon and resolves names
      // out of the ionicons registry, not out of this app's icon set — so it was
      // only ever working by accident, whenever some other component happened to
      // have registered `closeOutline` first. There is no app-icon equivalent,
      // because ion-toast renders its own chrome.
      //
      // The toast is dismissible by tapping the backdrop and auto-dismisses on
      // its timer, so a close button is a convenience rather than the only exit.
      // Leaving it off removes the last runtime dependency on ionicons.
    });
    await toast.present();
  }

  async notifyOrderStatusChange(orderId: string, newStatus: OrderStatus): Promise<void> {
    const statusMessages: Record<OrderStatus, string> = {
      pending: "🍦 Order received! We're reviewing it now.",
      confirmed: '✅ Your order has been confirmed!',
      preparing: '👨‍🍳 Our scoop artists are preparing your order!',
      out_for_delivery: '🛵 Your scoops are on the way!',
      delivered: '🎉 Order delivered! Enjoy your scoops!',
      cancelled: '❌ Your order has been cancelled.',
    };

    const message = statusMessages[newStatus];
    if (message) {
      await this.showToast(message, newStatus === 'cancelled' ? 'danger' : 'success');
      this.showBrowserNotification(
        'Five-orites Scoop',
        `${message} (#${orderId.slice(-6).toUpperCase()})`,
      );
    }
  }

  private showBrowserNotification(title: string, body: string): void {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      // eslint-disable-next-line no-new
      new Notification(title, { body });
    } catch {
      // Notifications unsupported/blocked — toast already shown.
    }
  }
}
