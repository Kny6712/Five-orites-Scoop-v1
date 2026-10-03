// src/app/core/logic/notifications.ts
// Five-orites Scoop — In-app notification feed, derived from order history.
//
// WHY THIS EXISTS, AND WHY IT IS DERIVED RATHER THAN STORED
//
// The obvious design for a notification system is its own collection:
// `users/{uid}/notifications/{id}` written on every status change. This app does
// not do that, and the reason is worth stating before someone "fixes" it.
//
// Every order ALREADY carries the complete history of its status changes in
// `statusHistory` - `[{ status, timestamp }]`, appended by `OrderService` on
// create (`placeOrder`) and on every transition (`updateOrderStatus`,
// `cancelOrder`). So the entire feed is already written, atomically, by the code
// that actually performed the transition.
//
// Deriving it from there means:
//   - zero extra Firestore writes. A stored collection would add one write per
//     status change forever, for data that is a pure projection of a field that
//     is already there. On the Spark (free) plan that is 20K writes/day of pure
//     duplication.
//   - no new collection, no new security rules, no migration.
//   - the feed cannot disagree with the order. A stored notification written by
//     a failed transaction, or missed by a trigger that errored, is a class of
//     bug this design does not have at all.
//   - it is correct after an app restart, on a second device, and for a
//     different signed-in user, with no unread-state bookkeeping to get wrong.
//
// Read state is the ONLY thing that genuinely has to be stored, because it is
// about the reader rather than about the order. That is one timestamp on the user
// document (`notificationsReadAt`), and it is what `buildNotificationFeed`
// compares against.
//
// THE HONEST LIMIT OF "IN-APP ONLY"
// This is a college project with no Cloud Functions and no push provider, so a
// notification exists only while the app is open. That is a design decision, not
// a bug, and it is documented in the README rather than hidden.
//
// Framework-free on purpose: no Angular, no Firebase, no `@angular/fire`. The
// timestamp type is structural (see `toEpochMs`) rather than Firestore's
// `Timestamp`, so this file can be unit-tested by `tests/logic.test.ts` with
// `node:test` - the same rule every other module in `core/logic` follows.

import type { OrderStatus } from '../models/order.model';

/**
 * The customer-facing sentence for each status.
 *
 * Lives here, not in `NotificationService`, because the toast and the feed are
 * two renderings of the same event and must not be able to disagree about what
 * it said. The service imports this; it does not own a second copy.
 *
 * The emoji are deliberate and load-bearing for the toast. They are NOT safe to
 * put in an SMS (one character outside GSM-7 triples the carrier's per-segment
 * bill), which is one more reason any external channel would need its own
 * templates rather than reusing these.
 */
export const ORDER_STATUS_NOTICES: Record<
  OrderStatus,
  { emoji: string; title: string; body: string }
> = {
  pending: {
    emoji: '🍦',
    title: 'Order received',
    body: "We've got your order and we're reviewing it now.",
  },
  confirmed: {
    emoji: '✅',
    title: 'Order confirmed',
    body: 'Your order has been confirmed by the shop.',
  },
  preparing: {
    emoji: '👨‍🍳',
    title: 'Being prepared',
    body: 'Our scoop artists are preparing your order.',
  },
  out_for_delivery: {
    emoji: '🛵',
    title: 'Out for delivery',
    body: 'Your scoops are on the way!',
  },
  delivered: {
    emoji: '🎉',
    title: 'Delivered',
    body: 'Enjoy your scoops!',
  },
  cancelled: {
    emoji: '❌',
    title: 'Order cancelled',
    body: 'This order has been cancelled.',
  },
};

/**
 * The one-line form used by the transient toast.
 *
 * A function rather than a fourth stored field, because it is only ever this
 * exact combination - deriving it means a copy edit cannot leave the toast and
 * the feed saying different things about the same event.
 */
export function statusToastLine(status: OrderStatus): string {
  const notice = ORDER_STATUS_NOTICES[status];
  return `${notice.emoji} ${notice.body}`;
}

/** One row in the notification feed. */
export interface FeedEntry {
  /** Stable identity for `@for` tracking: `${orderId}#${index}`. */
  readonly id: string;
  readonly orderId: string;
  readonly status: OrderStatus;
  /** Epoch ms. Normalised, because the stored value is a Firestore Timestamp. */
  readonly at: number;
  readonly title: string;
  readonly body: string;
  readonly read: boolean;
}

/**
 * How many entries the feed keeps.
 *
 * The input is every status change on every order the customer has, so it grows
 * without bound. Nothing in the UI scrolls further than this, and truncating here
 * means the caller cannot accidentally render an unbounded list. Kept generous
 * because the realistic total for a customer is well under it.
 */
export const FEED_LIMIT = 50;

/** The minimum shape this module needs from an order. Structural, on purpose. */
export interface OrderWithHistory {
  readonly id: string;
  readonly statusHistory?: readonly { status?: unknown; timestamp?: unknown }[] | null;
}

/**
 * Coerces the many shapes a timestamp arrives in to epoch ms.
 *
 * Returns `null` rather than a fabricated number when the value is unusable,
 * because the alternative is `NaN` propagating into a sort comparator - and a
 * comparator that returns `NaN` is not "slightly wrong", it makes the sort
 * engine's output implementation-defined, which reorders the whole feed in a way
 * that changes between browsers. Callers drop the entry instead.
 *
 * Handles: Firestore `Timestamp` (has `toMillis`), the legacy `toDate()` shape,
 * `Date`, epoch number, and an ISO string. Everything else is untrusted.
 */
export function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  // A Date is an object, so it has to be caught BEFORE the generic object branch
  // below - that branch knows about Timestamp shapes and would return null for a
  // plain Date, silently dropping every entry written by anything that stored a
  // real Date rather than a Firestore Timestamp.
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }

  // Firestore Timestamp, and anything structurally identical to it.
  if (typeof value === 'object') {
    const candidate = value as { toMillis?: () => number; toDate?: () => Date };
    if (typeof candidate.toMillis === 'function') {
      const n = candidate.toMillis();
      return Number.isFinite(n) ? n : null;
    }
    if (typeof candidate.toDate === 'function') {
      const d = candidate.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
    }
    // Firestore's `Timestamp` JSON shape, which is what you get from the REST
    // API or a document written by hand in the console.
    const seconds = (value as { seconds?: unknown }).seconds;
    const nanos = (value as { nanoseconds?: unknown }).nanoseconds;
    if (typeof seconds === 'number')
      return seconds * 1000 + (typeof nanos === 'number' ? nanos / 1e6 : 0);
    return null;
  }

  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n) && value.trim() !== '') return n;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

const KNOWN_STATUSES = Object.keys(ORDER_STATUS_NOTICES) as OrderStatus[];

/** Narrows an untrusted value to a status this build can describe. */
export function asOrderStatus(value: unknown): OrderStatus | null {
  return typeof value === 'string' && (KNOWN_STATUSES as string[]).includes(value)
    ? (value as OrderStatus)
    : null;
}

/**
 * Turns orders into a newest-first notification feed.
 *
 * `readAt` is the user's `notificationsReadAt`, in epoch ms, or `null` when they
 * have never opened the feed - in which case everything is unread. That is the
 * right default: a first-time user should see that their order arrived.
 *
 * Three defences matter here, and each one is a real thing that exists in the
 * wild:
 *
 * 1. **An order with no `statusHistory` is skipped, not crashed on.** The oldest
 *    documents in this database predate the field, and `allow create` in
 *    `firestore.rules` does not require it - so one written by hand in the
 *    console is rules-valid and would throw on `.map`.
 * 2. **An unknown status is skipped.** The document is untrusted input; a
 *    future build that adds `'refunded'` must not blank this build's feed.
 * 3. **An unusable timestamp drops that ONE entry**, keeping the rest. See
 *    `toEpochMs` for why fabricating a value here is worse than losing a row.
 */
export function buildNotificationFeed(
  orders: readonly OrderWithHistory[],
  readAt: number | null = null,
): FeedEntry[] {
  const entries: FeedEntry[] = [];

  for (const order of orders) {
    const history = order.statusHistory;
    if (!Array.isArray(history)) continue;

    history.forEach((step, index) => {
      const status = asOrderStatus(step?.status);
      if (!status) return;

      const at = toEpochMs(step?.timestamp);
      if (at === null) return;

      const notice = ORDER_STATUS_NOTICES[status];
      entries.push({
        id: `${order.id}#${index}`,
        orderId: order.id,
        status,
        at,
        title: notice.title,
        body: notice.body,
        read: readAt !== null && at <= readAt,
      });
    });
  }

  // Newest first. The tiebreak on `id` matters: two transitions written in the
  // same millisecond (a rapid double-advance, or a client clock with coarse
  // resolution) would otherwise sort unstably, and the same order could appear
  // in a different position on each render.
  entries.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

  return entries.length > FEED_LIMIT ? entries.slice(0, FEED_LIMIT) : entries;
}

/** How many entries are unread. The badge number. */
export function countUnread(entries: readonly FeedEntry[]): number {
  let n = 0;
  for (const entry of entries) if (!entry.read) n += 1;
  return n;
}

/**
 * Groups a feed into day sections for the list view.
 *
 * Day boundaries are computed in the device's LOCAL time, because "Today" is
 * what a person means by it. Comparing epoch ms directly to a UTC midnight is
 * the classic bug that puts an 11pm order under yesterday's heading.
 */
export function groupByDay(
  entries: readonly FeedEntry[],
  now: number = Date.now(),
): { label: string; entries: FeedEntry[] }[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();
  const yesterdayStart = todayStart - 86_400_000;

  const groups: { label: string; entries: FeedEntry[] }[] = [];
  let current: { label: string; entries: FeedEntry[] } | null = null;

  for (const entry of entries) {
    const label =
      entry.at >= todayStart ? 'Today' : entry.at >= yesterdayStart ? 'Yesterday' : 'Earlier';
    if (!current || current.label !== label) {
      current = { label, entries: [] };
      groups.push(current);
    }
    current.entries.push(entry);
  }

  return groups;
}

/**
 * A short relative time ("just now", "12m", "3h", "2d").
 *
 * Takes `now` as a parameter rather than reading the clock, so it is testable
 * and so a caller re-rendering a list gets one consistent "now" for every row
 * instead of a row that says "just now" next to one that says "1m" because the
 * second call happened across a minute boundary.
 */
export function relativeTime(at: number, now: number = Date.now()): string {
  const seconds = Math.floor((now - at) / 1000);

  if (!Number.isFinite(seconds)) return '';
  // A clock that is behind (skew, or a timestamp from the future) would produce
  // a negative age. "just now" is the truthful reading; "in 3m" is not.
  if (seconds < 45) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
