// src/app/core/services/notification.service.ts
// Five-orites Scoop — Push Notification Service (Capacitor + PWA fallback)
// Author: Five-orites Scoop team (see README)

import { Injectable, inject } from '@angular/core';
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
   * What has the BROWSER actually allowed?
   *
   * `Notification.permission` is readable without prompting, which is what lets
   * the dashboard show the true state on load rather than assuming "off" until
   * someone taps.
   */
  browserPermission(): 'granted' | 'denied' | 'default' {
    if (this.platform.is('capacitor')) {
      // Native push has no equivalent synchronous query; the Capacitor plugin
      // exposes no such getter. Treat native as "ask me" rather than guessing,
      // so the user is prompted once and the answer is remembered in the profile.
      return 'default';
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

  async requestPermission(): Promise<boolean> {
    if (this.platform.is('capacitor')) {
      try {
        // Dynamic import to avoid SSR issues
        const { PushNotifications } = await import(
          '@capacitor/push-notifications'
        );
        const result = await PushNotifications.requestPermissions();
        if (result.receive === 'granted') {
          await PushNotifications.register();
          return true;
        }
        return false;
      } catch (err) {
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
    duration = 3000
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

  async notifyOrderStatusChange(
    orderId: string,
    newStatus: OrderStatus
  ): Promise<void> {
    const statusMessages: Record<OrderStatus, string> = {
      pending: '🍦 Order received! We\'re reviewing it now.',
      confirmed: '✅ Your order has been confirmed!',
      preparing: '👨‍🍳 Our scoop artists are preparing your order!',
      out_for_delivery: '🛵 Your scoops are on the way!',
      delivered: '🎉 Order delivered! Enjoy your scoops!',
      cancelled: '❌ Your order has been cancelled.',
    };

    const message = statusMessages[newStatus];
    if (message) {
      await this.showToast(
        message,
        newStatus === 'cancelled' ? 'danger' : 'success'
      );
      this.showBrowserNotification('Five-orites Scoop', `${message} (#${orderId.slice(-6).toUpperCase()})`);
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
