// src/app/core/services/notification.service.ts
// Five-orites Scoop — In-app notification service
//
// SCOPE, AND WHY IT IS ONLY THIS
//
// This app notifies INSIDE itself and nowhere else. That is a deliberate scope
// decision for a college project on Firebase's free Spark plan, which cannot
// deploy Cloud Functions at all - and therefore cannot fan anything out through
// FCM when the app is closed.
//
// WHAT USED TO BE HERE, AND WHY IT IS GONE
//
// This file previously modelled a three-state permission model
// (`granted` / `blocked` / `off`), asked the OS for notification permission via
// `@capacitor/push-notifications`, and fired a Web `new Notification()`.
//
// Every bit of that is dead under an in-app-only scope, and keeping it would
// have been worse than dead - it would have been LYING:
//
//   - `requestPermission()` called `PushNotifications.register()`, but nothing
//     ever listened for the `registration` event, so no FCM token was ever
//     captured and nothing could ever have been delivered. The toggle still said
//     "on".
//   - `showBrowserNotification()` used the Web Notification API. Inside a
//     Capacitor WebView on Android that does not produce an Android system
//     notification at all, so on the actual phone - the thing that matters - the
//     customer saw nothing.
//   - The permission state machine existed to explain a "blocked" state the
//     product can no longer reach. A control that can render a state it cannot
//     escape is a control that looks broken.
//
// So the permission model is deleted rather than disabled, and what replaces it
// is much smaller: a preference, a toast, and a derived feed. The feed itself
// lives in `core/logic/notifications.ts` (pure, unit-tested) and is surfaced by
// `OrderNotificationService` and the notifications page.
//
// THE HONEST LIMIT
// Nothing arrives when the app is closed. That is stated in the README under
// "Known limitations" rather than being papered over.

import { Injectable, inject } from '@angular/core';
import { ToastController } from '@ionic/angular/standalone';
import { OrderStatus } from '../models/order.model';
import { ORDER_STATUS_NOTICES, statusToastLine } from '../logic/notifications';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private toastCtrl = inject(ToastController);

  /**
   * Whether the user wants in-app order notifications.
   *
   * ABSENT MEANS ENABLED. Every account that predates the `notificationsEnabled`
   * field has no such field, and defaulting them to opted-out would silently
   * stop notifications for everyone who signed up before it shipped. The same
   * rule as the other optional user fields - absent is not false.
   *
   * Note what this is NOT any more: there is no second axis. The OS permission
   * is gone because there is nothing to grant - an in-app toast needs no
   * permission, and a notification the user has not enabled needs no permission
   * to be withheld. One boolean, one meaning.
   */
  isEnabled(preference: boolean | undefined): boolean {
    return preference !== false;
  }

  /**
   * The one transient notification surface: a toast over the current screen.
   *
   * A toast is not a notification system - it auto-dismisses and leaves no
   * record - which is exactly why the feed in `core/logic/notifications.ts`
   * exists alongside it. The toast is for "your action had an effect"; the feed
   * is for "here is what happened to your orders".
   */
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
      // out of the ionicons registry, not out of this app's icon set - so it was
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

  /**
   * Announces an order's new status to whoever is looking at the app.
   *
   * Called by `OrderNotificationService` when the listener observes a genuine
   * transition on the signed-in user's own orders - NOT by whichever client
   * performed the write, which is what this used to do and which meant the toast
   * appeared on the admin's phone instead of the customer's.
   *
   * The copy comes from `ORDER_STATUS_NOTICES`, shared with the feed, so the
   * toast and the notification list cannot drift into describing the same event
   * differently.
   */
  async notifyOrderStatusChange(orderId: string, newStatus: OrderStatus): Promise<void> {
    if (!ORDER_STATUS_NOTICES[newStatus]) return;
    await this.showToast(
      `${statusToastLine(newStatus)} (#${orderId.slice(-6).toUpperCase()})`,
      newStatus === 'cancelled' ? 'danger' : 'success',
    );
  }
}
