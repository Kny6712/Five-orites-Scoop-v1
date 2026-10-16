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
// SCOPE: in-app only. This project is on Firebase's free Spark plan, so the
// Cloud Functions in `functions/src/` cannot be deployed and nothing arrives when
// the app is closed. That limitation is stated in the README rather than hidden
// here.

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
  IonSelect,
  IonSelectOption,
} from '@ionic/angular/standalone';
import { ToastController } from '@ionic/angular/standalone';
import type { ViewWillEnter } from '@ionic/angular';
import { OrderNotificationService } from '../../core/services/order-notification.service';
import {
  groupByDay,
  countByPeriod,
  filterByPeriod,
  nextPopulatedPeriod,
  type FeedPeriod,
  OrderThread,
  feedTimeLabel,
  absoluteTime,
  STATUS_SEQUENCE,
  stepState,
} from '../../core/logic/notifications';
import type { OrderStatus } from '../../core/models/order.model';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
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
    IonSelect,
    IonSelectOption,
    RouterLink,
    AppIconComponent,
    PaginationComponent,
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

  /**
   * Twelve ORDERS a page — not twelve status events, which is what this number
   * used to mean.
   *
   * That was the real crowding problem. One delivered order emits five entries,
   * so a page of twelve held about two and a half orders, and three orders
   * delivered in a single day overran it — pushing the Yesterday and Earlier
   * sections off page one entirely, because pagination happens before grouping.
   * An order the user had every reason to want was invisible because its
   * neighbours on the same day had already filled the page.
   *
   * PAGINATED BEFORE GROUPING, and that order is still load-bearing rather than
   * stylistic. `groupByDay` turns the newest-first thread list into
   * Today/Yesterday/Earlier sections, and which section a thread belongs to is a
   * property of the THREAD, not of the group. Slicing groups would put "Earlier"
   * on page 1 of a feed whose twelve newest orders all landed today, and would
   * let the unread badge promise orders the current page cannot show. Slicing
   * threads keeps both claims true: `isEmpty` and `unreadCount` still read the
   * whole feed, and the page shows exactly the orders the pager claims it does.
   *
   * It MATTERS MORE NOW THAN IT DID, not less. The period control narrows to one
   * window before this runs, so "Earlier" is no longer dragged onto page 1 by
   * whatever happened today — but a user with thirty archived orders paging
   * through Earlier still needs the pager's `total` and the rows beneath it to
   * be describing the same set, and slicing the group is the change that would
   * break that without any visible error.
   */
  protected readonly PAGE_SIZE = 12;
  protected readonly page = signal(1);

  /**
   * Which day period the feed is narrowed to.
   *
   * `today` IS THE DEFAULT, and `all` IS NOT ONE OF THE OPTIONS. Both were the
   * other way round when this was a four-tab segment, and the reasoning was not
   * bad — this page exists because a toast leaves no record, so opening on a
   * window that hides yesterday behind a tap undersells the whole idea. What
   * changed is that the control is now a dropdown holding three named windows
   * rather than four visible ones.
   *
   * With every window on screen at once, `All` was the default because it was
   * the only option that showed the user anything. With them behind an arrow,
   * the control answers a different question: "what do I want to look at", and
   * for a feed built from order status the answer is almost always the last
   * thing that happened. So the feed opens on Today, and the other two windows
   * are one tap away.
   *
   * The cost is real and is paid in `rescuePeriod` instead of being hidden:
   * anyone whose orders last moved yesterday opens on "Nothing today". That state
   * names the window they are in and hands them a one-tap way to the newest one
   * that has content, so the default costs a single extra tap for those users
   * and saves every other visit the tap entirely.
   *
   * `FeedPeriod` still HAS an `all` member — `filterByPeriod`, `countByPeriod`
   * and their tests all still speak it. It is simply no longer reachable from
   * this page.
   */
  protected readonly filter = signal<FeedPeriod>('today');

  /** The whole feed, unfiltered. Everything below is a view over this. */
  private readonly allThreads = this.notifications.threads;

  /**
   * The same threads, carrying a top-level `at`.
   *
   * `filterByPeriod` and `countByPeriod` both key off `{ at: number }` — the same
   * shape `groupByDay` has always consumed — while a thread keeps its timestamp
   * on `latest`. Flattening it ONCE here rather than at each of the three call
   * sites is the difference between one place that has to agree with
   * `groupByDay` and three.
   */
  private readonly datedThreads = computed(() =>
    this.allThreads().map((thread) => ({ at: thread.latest.at, thread })),
  );

  /**
   * How many orders sit in each of the three windows.
   *
   * Computed ONCE and read by `filterOptions` and `rescuePeriod` alike. Those two
   * ask different questions of the same table — "what can I pick" and "where is
   * anything" — and calling `countByPeriod` in both places would mean the
   * numbers labelling the control and the numbers choosing the escape hatch are
   * two separate walks that could disagree.
   *
   * Derived from the whole feed rather than the current page, so the numbers do
   * not change as the user pages through.
   */
  private readonly periodCounts = computed(() => countByPeriod(this.datedThreads(), this.now()));

  /**
   * The dropdown's options, each carrying how many orders it would show.
   *
   * NO `all` ENTRY. It is still a valid `FeedPeriod` and `countByPeriod` still
   * counts it — this page simply has no reason to offer a window that is not one
   * of the three named days.
   *
   * THE COUNTS ARE NOT DECORATION. "Earlier" is a catch-all — everything older
   * than yesterday — so it is unbounded where Today and Yesterday are typically
   * 0-5. A control whose options are bare words is therefore a trap: the obvious
   * move for someone trying to cut clutter down is to pick the longest-looking
   * option, and in a dropdown there are no options side by side to do better
   * with. With a count on each, "Earlier (24)" is a decision rather than a guess.
   */
  protected readonly filterOptions = computed(
    () =>
      [
        { value: 'today', label: 'Today', count: this.periodCounts().today },
        { value: 'yesterday', label: 'Yesterday', count: this.periodCounts().yesterday },
        { value: 'earlier', label: 'Earlier', count: this.periodCounts().earlier },
      ] as const,
  );

  /** The feed after the filter, before pagination. */
  protected readonly filteredThreads = computed(() =>
    filterByPeriod(this.datedThreads(), this.filter(), this.now()).map((e) => e.thread),
  );

  /** The window of ORDERS this page renders, within the current filter. */
  protected readonly pagedThreads = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.filteredThreads().slice(start, start + this.PAGE_SIZE);
  });

  /**
   * Applies a new period.
   *
   * Takes the raw `CustomEvent` and narrows inside, rather than accepting the
   * value directly. `ion-select` types its value as `any`, and `?? 'today'` is
   * the same defensive read the products page's `onSortChange` uses — a control
   * that can emit no value must not be able to blank the filter.
   *
   * THE PAGE RESET IS THE WHOLE POINT OF THIS METHOD. `page` is not derived from
   * the filter, so nothing else resets it: switching from page 3 of "Earlier" to
   * "Today" — which holds two orders, so one page — would slice [24, 36) out of
   * a two-element array and render nothing at all, with a pager sitting under a
   * blank region claiming there are more. Changing what you are looking at has
   * to put you back at the first page of it.
   *
   * Guarded against a no-op change because `ion-select` fires `ionChange` when it
   * re-renders its selected state, and resetting the page from that would fight
   * the user for control of it.
   */
  protected onFilterChange(event: CustomEvent): void {
    const next = (event.detail.value as FeedPeriod | undefined) ?? 'today';
    if (this.filter() === next) return;
    this.filter.set(next);
    this.page.set(1);
  }

  /**
   * The newest window that actually has orders in it, or `undefined` if none do.
   *
   * THE WAY OUT OF AN EMPTY WINDOW. This used to be "Show all updates" and an
   * `all` tab to land on. The dropdown has no `all`, so the escape hatch needs a
   * different destination, and the only one that is true rather than merely legal
   * is the newest window with something in it.
   *
   * `undefined` is unreachable from the template — it needs an empty feed, and
   * the empty-feed branch renders before this one — but the type says so rather
   * than the template assuming it.
   */
  protected readonly rescuePeriod = computed(() => {
    const period = nextPopulatedPeriod(this.periodCounts());
    return this.filterOptions().find((o) => o.value === period);
  });

  /**
   * The escape-hatch button's text.
   *
   * Branching ONCE here rather than in the template, because the naive
   * `"Show {{ label }}'s updates"` produces "Show earlier's updates" — a phrase
   * nobody says, and the one window most likely to be the rescue target, since
   * it is the only bucket guaranteed not to be empty for anyone who has ordered
   * more than once.
   */
  protected readonly rescueLabel = computed(() => {
    const option = this.rescuePeriod();
    if (!option) return '';
    return option.value === 'earlier'
      ? 'Show earlier updates'
      : `Show ${option.label.toLowerCase()}'s updates`;
  });

  /** To the newest window with content, from the empty-window state. */
  protected showRescuePeriod(): void {
    const option = this.rescuePeriod();
    if (!option) return;
    this.onFilterChange({ detail: { value: option.value } } as CustomEvent);
  }

  /** The label of the active period, for the "nothing here" message. */
  protected readonly activePeriodLabel = computed(
    () => this.filterOptions().find((o) => o.value === this.filter())?.label ?? 'Today',
  );

  /**
   * Day sections, derived from this page's orders rather than the whole feed.
   *
   * AT MOST ONE GROUP NOW. The period control is a three-way dropdown, and each
   * option names one of the three days `groupByDay` can return, so filtering to
   * a period and then grouping cannot produce anything but the single matching
   * section. That is why the headings above these groups are gone: with one
   * group, named by the control the user just tapped, a heading is the same word
   * twice. `groupByDay` is kept rather than bypassed because `filterByPeriod` is
   * built on it, and they must not be able to disagree about where midnight is.
   */
  protected readonly groups = computed(() =>
    groupByDay(
      this.pagedThreads().map((t) => ({ at: t.latest.at, thread: t })),
      this.now(),
    ).map((g) => ({ label: g.label, entries: g.entries.map((e) => e.thread) })),
  );

  /** The steps of the happy path, for the progress strip. Shared with the tracker. */
  protected readonly statusSequence = STATUS_SEQUENCE;

  /**
   * Where one step sits relative to this order's latest status.
   *
   * The same `stepState` the tracker timeline uses, imported rather than
   * reimplemented — the strip and the timeline must not be able to disagree,
   * since one is a summary of the other and they are one tap apart.
   */
  protected stepStateFor(thread: OrderThread, step: OrderStatus): string {
    return stepState(thread.latest.status, step);
  }

  /**
   * The WHOLE feed's length in ORDERS, unfiltered. Drives the empty state.
   *
   * NOT `filteredThreads`, and that distinction is load-bearing. The
   * "No notifications yet" card is a claim about the user's entire history, so it
   * must be answered by the entire history. Reading the filtered count here
   * would put a user with thirty orders and none today in front of a card
   * telling them they have never had one.
   */
  protected readonly totalThreads = computed(() => this.allThreads().length);

  /**
   * The FILTERED count, which is what the pager's `total` wants — so the readout
   * under the feed says "Showing 1-6 of 6" when the filter is Today, rather than
   * counting orders the user cannot see.
   */
  protected readonly totalEntries = computed(() => this.filteredThreads().length);

  protected readonly isEmpty = computed(() => this.totalThreads() === 0);

  /**
   * The filter found nothing, but the feed is not empty.
   *
   * A distinct state from `isEmpty` and it needs its own message: the user has
   * history, they have just narrowed to a window that is empty, and "No
   * notifications yet" would be false. The copy names the window they chose and
   * offers the way back.
   */
  protected readonly filterIsEmpty = computed(
    () => !this.isEmpty() && this.filteredThreads().length === 0,
  );

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
  protected entryClasses(thread: OrderThread): string {
    const classes = ['entry'];
    if (thread.unread) classes.push('entry--unread');
    if (NotificationsPage.ALERT_STATUSES.includes(thread.latest.status))
      classes.push('entry--alert');
    return classes.join(' ');
  }

  /**
   * The card's timestamp cluster — "12m · Oct 15, 2:34 PM", or the bare date
   * in the "Earlier" window.
   *
   * The rule is `feedTimeLabel` in core/logic, next to the two formatters it
   * composes: the window decides whether the relative label is information or
   * duplication, and that decision is a display rule, which lives where the
   * tests can reach it rather than in a template branch.
   *
   * Reads the SAME `now` signal as everything else on the page, so the relative
   * label, the absolute date and the year decision are all computed against
   * one instant rather than one per row (see the note on `now` above).
   */
  protected entryTime(thread: OrderThread): string {
    return feedTimeLabel(thread.latest.at, this.filter(), this.now());
  }

  /**
   * The absolute date and time beside the relative label — "Oct 15, 2:34 PM".
   *
   * Reads the SAME `now` signal as the relative labels, so the year decision
   * and every label on the page are computed against one instant rather than
   * one per row (see the note on `now` above). The formatting itself is
   * `absoluteTime` in core/logic, next to `relativeTime`, because a display
   * rule belongs where the tests can reach it.
   */
  protected absoluteTime(at: number): string {
    return absoluteTime(at, this.now());
  }

  /**
   * The accessible name for one card.
   *
   * Built rather than left to the button's contents, because the visible time
   * is a bare abbreviation ("12m", "3h"). Read literally that is ambiguous — "3h"
   * could be three hours or three hundred — and it would be the only place in
   * the app where a screen reader met an unexplained abbreviation.
   *
   * Also states the unread status, which is otherwise carried purely by a colour
   * and a font weight and therefore invisible to anyone who cannot see them.
   *
   * IT NAMES THE LATEST STATUS ONLY, deliberately, and the progress strip is
   * aria-hidden to match. The card says where the order IS; the intermediate
   * steps are all reachable from the tracker one tap away, and reading five
   * statuses out loud for every card turns a scannable list into a monologue.
   *
   * THE DATE IS THE SAME STRING THE CARD SHOWS, from the same formatter, rather
   * than a separate `toLocaleString()` call. The visible card pairs the relative
   * label with the absolute one, so the spoken name now matches the visible row
   * exactly; two formatters would be two chances to disagree, and the spoken one
   * is the one nobody proofreads.
   */
  protected entryAriaLabel(thread: OrderThread): string {
    const when = this.absoluteTime(thread.latest.at);
    const state = thread.unread ? 'unread' : 'read';
    return `${thread.latest.title}, ${state}. ${thread.latest.body} Order ${this.shortOrderId(
      thread.orderId,
    )} on ${when}.`;
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
  protected async open(thread: OrderThread): Promise<void> {
    await this.markRead();
    await this.router.navigate(['/orders', thread.orderId]);
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
