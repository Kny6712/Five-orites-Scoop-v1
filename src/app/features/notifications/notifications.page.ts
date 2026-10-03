// src/app/features/notifications/notifications.page.ts
// Five-orites Scoop — the persistent in-app notification feed
//
// WHY A PAGE AND NOT JUST A TOAST
//
// A toast auto-dismisses and leaves no record. That is fine for "your action had
// an effect" and useless for "what has happened to my orders" — the second
// question needs something the user can come back to, scroll, and re-read. This
// page is that something.
//
// The entries are NOT stored. They are derived from each order's `statusHistory`
// by `buildNotificationFeed`, which means this page cannot show a notification
// the order itself does not support, and cannot go blank when a write that would
// have created a notification row failed. See core/logic/notifications.ts for
// the full reasoning.
//
// SCOPE: in-app only. No Cloud Functions in this project, so nothing arrives
// when the app is closed. That limitation is stated in the README rather than
// hidden here.

import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonButtons,
  IonButton,
  IonMenuButton,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
} from '@ionic/angular/standalone';
import { ToastController } from '@ionic/angular/standalone';
import type { ViewWillEnter } from '@ionic/angular';
import { OrderNotificationService } from '../../core/services/order-notification.service';
import { FeedEntry, groupByDay, relativeTime } from '../../core/logic/notifications';
import type { OrderStatus } from '../../core/models/order.model';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonMenuButton,
    IonTitle,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    RouterLink,
    AppIconComponent,
    AppFooterComponent,
  ],
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
})
export class NotificationsPage implements ViewWillEnter {
  private readonly notifications = inject(OrderNotificationService);
  private readonly toastCtrl = inject(ToastController);
  private readonly router = inject(Router);

  /**
   * One clock for the whole list.
   *
   * `relativeTime` takes `now` as a parameter precisely so this is possible:
   * calling it per row would let a row rendered at 11:59:59.999 say "just now"
   * next to one rendered at 11:59:60.001 saying "1m" for what is the same instant
   * of user attention.
   */
  protected readonly now = signal(Date.now());

  /** Day sections, derived from the same feed the badge counts. */
  protected readonly groups = computed(() => groupByDay(this.notifications.entries(), this.now()));

  protected readonly isEmpty = computed(() => this.notifications.entries().length === 0);

  protected readonly unreadCount = this.notifications.unreadCount;

  /** Which statuses deserve the attention colour rather than the calm one. */
  private static readonly ALERT_STATUSES: readonly OrderStatus[] = ['cancelled'];

  /**
   * The entry's classes as ONE string.
   *
   * Bound via `[class]` rather than mixing `[class]` with `[class.foo]`. Those
   * two forms fight: a `[class]="someString"` binding replaces the class
   * attribute wholesale, so a sibling `[class.entry--unread]` is silently
   * dropped and the unread styling just never appears — a bug that looks like a
   * CSS mistake and is actually a binding one.
   */
  protected entryClasses(entry: FeedEntry): string {
    const classes = ['entry'];
    if (!entry.read) classes.push('entry--unread');
    if (NotificationsPage.ALERT_STATUSES.includes(entry.status)) classes.push('entry--alert');
    return classes.join(' ');
  }

  protected ago(entry: FeedEntry): string {
    return relativeTime(entry.at, this.now());
  }

  /**
   * The accessible name for one row.
   *
   * Built rather than left to the button's contents, because the visible time is
   * a bare abbreviation ("12m", "3h"). Read literally that is ambiguous — "3h"
   * could be three hours or three hundred — and it would be the only place in
   * the app where a screen reader met an unexplained abbreviation.
   *
   * Also states the unread status, which is otherwise carried purely by a colour
   * and a font weight and therefore invisible to anyone who cannot see them.
   */
  protected entryAriaLabel(entry: FeedEntry): string {
    const when = new Date(entry.at).toLocaleString();
    const state = entry.read ? 'read' : 'unread';
    return `${entry.title}, ${state}. ${entry.body} Order ${this.shortOrderId(entry.orderId)}, ${when}.`;
  }

  protected shortOrderId(orderId: string): string {
    return `#${orderId.slice(-6).toUpperCase()}`;
  }

  /**
   * Opens the order this entry is about, and marks the feed read.
   *
   * Marking read happens on OPEN rather than on arrival, which is the behaviour
   * people expect from every mail and message list they use. It is deliberately
   * not done on page load: someone who lands here and immediately taps through to
   * an order has read the list in every sense that matters, and someone who
   * arrives, sees the badge clear itself without reading anything, has not.
   */
  protected async open(entry: FeedEntry): Promise<void> {
    await this.markRead();
    await this.router.navigate(['/orders', entry.orderId]);
  }

  /**
   * Clears the unread badge.
   *
   * Failure is reported rather than swallowed. A badge that silently stays lit
   * looks like the app is broken, and the user has no way to tell whether their
   * tap registered.
   */
  protected async markRead(): Promise<void> {
    if (this.unreadCount() === 0) return;
    try {
      await this.notifications.markAllRead();
    } catch (err) {
      console.error('Could not mark notifications read', err);
      const toast = await this.toastCtrl.create({
        message: 'Could not update your notifications. Please try again.',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await toast.present();
    }
  }

  /**
   * Re-evaluates every "12m ago" label when the page is (re-)entered.
   *
   * The Ionic lifecycle hook rather than a timer or a subscription. A one-minute
   * interval would keep the labels honest on a screen left open, but it also
   * means a wake-up every minute for a page that is usually read once and left —
   * and when the app has been backgrounded, the resumed refresh is the only thing
   * that matters anyway.
   */
  ionViewWillEnter(): void {
    this.refreshLabels();
  }

  protected refreshLabels(): void {
    this.now.set(Date.now());
  }

  protected async handleRefresh(event: CustomEvent): Promise<void> {
    this.refreshLabels();
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    (event.target as HTMLIonRefresherElement).complete();
  }
}
