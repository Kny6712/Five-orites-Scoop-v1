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
// This project is on Firebase's free Spark plan. The Cloud Functions in
// `functions/src/` exist on disk but CANNOT BE DEPLOYED on that plan, so there is
// nothing to fan a notification out through and a customer only ever sees one
// while the app is open. That is a design decision, not a bug, and it is
// documented in the README rather than hidden. (The wording matters: three
// functions do exist, they just cannot run. "There is no Cloud Function" would
// be its own kind of lie.)
//
// Framework-free on purpose: no Angular, no Firebase, no `@angular/fire`. The
// timestamp type is structural (see `toEpochMs`) rather than Firestore's
// `Timestamp`, so this file can be unit-tested by `tests/logic.test.ts` with
// `node:test` - the same rule every other module in `core/logic` follows.

import type { OrderStatus } from '@core/models/order.model';

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
 * Every step of ONE order, collapsed into the single card the feed renders.
 *
 * WHY THIS EXISTS. `buildNotificationFeed` emits one entry per statusHistory
 * step, so a single delivered order produces five: received, confirmed,
 * preparing, out_for_delivery, delivered. The feed was rendering those as five
 * separate cards saying, in effect, the same thing — and every one of them links
 * to the order tracker, which already draws the whole progression as a
 * timeline. Three orders delivered in a day put fifteen cards on a page whose
 * entire job is to be scannable, and at PAGE_SIZE 12 they pushed the Yesterday
 * and Earlier sections off page one completely.
 *
 * So the feed shows an ORDER, not an EVENT: `latest` is what the card says and
 * `steps` is what the progress strip draws.
 */
export interface OrderThread {
  readonly orderId: string;
  /** The newest step. Drives title, body, timestamp, day section and badge. */
  readonly latest: FeedEntry;
  /** Every step, newest first. Drives the progress strip. */
  readonly steps: readonly FeedEntry[];
  /** True when ANY step is unread — not just the newest one. */
  readonly unread: boolean;
}

/**
 * Collapses a flat event feed into one thread per order.
 *
 * GROUPED BY orderId, NEVER BY ADJACENCY, and that is the whole subtlety. The
 * feed is sorted newest-first ACROSS ALL ORDERS, so one order's steps can be
 * split apart by another order's. Order A at 10:00, order B at 10:30, order A at
 * 11:00 sorts to A@11:00, B@10:30, A@10:00 — a contiguity scan sees two
 * separate one-step "threads" for A and silently drops two of its steps from
 * the progress strip. Hence the Map.
 *
 * `unread` is an ANY, deliberately: the read marker is a single timestamp over
 * the whole feed, so a thread straddling it is half-read. Collapsing to
 * `latest.read` would hide a step the user has genuinely not seen, and the card
 * would stop being bold at exactly the moment it should be.
 *
 * Sorted by `latest.at` descending, with `orderId` as the tiebreak so two
 * orders advanced in the same millisecond cannot swap places between renders —
 * the same instability the sort in `buildNotificationFeed` already guards.
 */
export function collapseToOrderThreads(entries: readonly FeedEntry[]): OrderThread[] {
  const byOrder = new Map<string, FeedEntry[]>();

  for (const entry of entries) {
    const run = byOrder.get(entry.orderId);
    if (run) run.push(entry);
    else byOrder.set(entry.orderId, [entry]);
  }

  const threads: OrderThread[] = [];
  for (const [orderId, steps] of byOrder) {
    // `entries` arrives newest-first, so steps[0] is the newest — but sorting
    // here rather than assuming keeps this correct if a caller ever hands it a
    // differently-ordered array, which is the kind of thing that is true until
    // the day it is not.
    const sorted = [...steps].sort(
      (a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
    threads.push({
      orderId,
      latest: sorted[0],
      steps: sorted,
      unread: sorted.some((s) => !s.read),
    });
  }

  threads.sort(
    (a, b) =>
      b.latest.at - a.latest.at || (a.orderId < b.orderId ? 1 : a.orderId > b.orderId ? -1 : 0),
  );

  return threads;
}

/** How many THREADS carry an unread step. The badge number. */
export function countUnreadThreads(threads: readonly OrderThread[]): number {
  let n = 0;
  for (const t of threads) if (t.unread) n += 1;
  return n;
}

/** How many entries the feed keeps.
 *
 * The input is every status change on every order the customer has, so it grows
 * without bound. Nothing in the UI scrolls further than this, and truncating here
 * means the caller cannot accidentally render an unbounded list. Kept generous
 * because the realistic total for a customer is well under it.
 *
 * NOTE THIS IS A BOUND ON EVENTS, NOT ORDERS, and it was not re-tuned when the
 * feed started collapsing to one card per order. Fifty events is about ten
 * orders, which is still a deliberate render ceiling rather than a limit anyone
 * should feel. Raising it is a product decision about how far back the feed
 * reaches; the guard's job is done either way.
 */
export const FEED_LIMIT = 50;

/**
 * The periods the feed can be narrowed to.
 *
 * `all` is not a fourth bucket — it is the absence of a bucket. Everything
 * older than yesterday shares one heading ("Earlier"), so there is no fourth
 * group for `groupByDay` to return.
 */
export type FeedPeriod = 'all' | 'today' | 'yesterday' | 'earlier';

/**
 * Period -> the group heading it selects, or `null` for "no filter".
 *
 * THE POINT OF THE `null` IS THAT NOTHING ELSE HAS TO KNOW THAT. Deriving the
 * heading from the period name by string-munging — 'today' -> 'Today' — looks
 * harmless and is a second copy of the bucketing decision. The day boundaries
 * would then live in two places: `groupByDay` for the headings, and something
 * else for the filter, and the day an order files under on screen could disagree
 * with the day the filter thinks it belongs to. Reading the label out of this
 * table means both go through `groupByDay` and cannot drift.
 */
export const FEED_PERIOD_LABEL: Record<FeedPeriod, string | null> = {
  all: null,
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
};

/**
 * Narrows a feed to one day period.
 *
 * Built ON `groupByDay` rather than on its own date arithmetic, for the reason
 * in `FEED_PERIOD_LABEL`: one definition of "today", used by both the headings
 * and the filter.
 *
 * `all` returns a copy of the input rather than re-concatenating the groups, so
 * a caller can never alias the service's own array and mutate it in place.
 */
export function filterByPeriod<T extends { at: number }>(
  entries: readonly T[],
  period: FeedPeriod,
  now: number = Date.now(),
): T[] {
  const label = FEED_PERIOD_LABEL[period];
  if (label === null) return [...entries];

  for (const group of groupByDay(entries, now)) {
    if (group.label === label) return group.entries;
  }
  return [];
}

/**
 * How many entries fall in each period — the counts on the filter control.
 *
 * `all` is the whole feed and is set first, so the three buckets can never sum to
 * more than it: a thread is counted once, by the one group it fell into.
 */
export function countByPeriod(
  entries: readonly { at: number }[],
  now: number = Date.now(),
): Record<FeedPeriod, number> {
  const counts: Record<FeedPeriod, number> = {
    all: entries.length,
    today: 0,
    yesterday: 0,
    earlier: 0,
  };
  for (const group of groupByDay(entries, now)) {
    const period = group.label.toLowerCase() as FeedPeriod;
    if (period in FEED_PERIOD_LABEL) counts[period] += group.entries.length;
  }
  return counts;
}

/**
 * The newest period that actually has something in it, or `null` if none do.
 *
 * This exists because the feed's period control no longer offers `all`. The
 * empty-window state used to escape through "Show all updates", which had a
 * destination; with no `all` to jump to it needs somewhere else to send the
 * user, and "somewhere with content" is the only answer that is true rather
 * than merely valid.
 *
 * `all` IS DELIBERATELY NOT CONSIDERED. `countByPeriod` sets it to the length of
 * the whole feed, so a caller's first instinct — `counts.all > 0` — would answer
 * "is there anything at all" and then have to search again for where. This reads
 * the three buckets and nothing else, so one call is the whole question.
 *
 * WALKED IN DESCENDING RECENCY, not in the order the counts happen to be
 * declared. The two happen to coincide today, but the order is the answer to a
 * user question — "where is the most recent thing that happened to me" — and
 * `groupByDay` buckets newest-first too. If the buckets were ever renamed or
 * resorted, this must stay the list above, and this comment is the only thing
 * saying so.
 *
 * `null` IS REACHABLE IN ISOLATION and impossible through the page: it means all
 * three buckets are empty, and `groupByDay` omits empty groups, so that is the
 * same condition as "the feed is empty". Callers that only run after ruling out
 * an empty feed will never see it, but the type is honest about it rather than
 * asserting it cannot happen.
 */
export function nextPopulatedPeriod(
  counts: Record<FeedPeriod, number>,
): Exclude<FeedPeriod, 'all'> | null {
  const byRecency: readonly Exclude<FeedPeriod, 'all'>[] = ['today', 'yesterday', 'earlier'];
  for (const period of byRecency) {
    if (counts[period] > 0) return period;
  }
  return null;
}

/**
 * The happy path, in order — what the progress strip and the tracker timeline
 * both walk.
 *
 * `cancelled` is deliberately NOT here. It is a branch off the side of this
 * sequence rather than a step along it, which is why `stepState` returns
 * 'upcoming' for every step once an order is cancelled: there is no "after", so
 * nothing in the sequence has been reached.
 */
export const STATUS_SEQUENCE: readonly OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
];

/** How a step in `STATUS_SEQUENCE` sits relative to where the order is now. */
export type StepState = 'completed' | 'active' | 'upcoming';

/**
 * The one definition of "where is this order", shared by the tracker's timeline
 * and the feed's progress strip.
 *
 * Lifted out of the tracker's `getStepState` rather than duplicated, because two
 * copies of a three-way branch over an array index is two places for the two
 * surfaces to disagree — and they would disagree VISIBLY, since the strip sits
 * on the card the timeline is one tap away from.
 */
export function stepState(
  current: OrderStatus | undefined,
  step: OrderStatus,
  sequence: readonly OrderStatus[] = STATUS_SEQUENCE,
): StepState {
  if (!current || current === 'cancelled') return 'upcoming';
  const currentIdx = sequence.indexOf(current);
  const stepIdx = sequence.indexOf(step);
  if (stepIdx < currentIdx) return 'completed';
  if (stepIdx === currentIdx) return 'active';
  return 'upcoming';
}

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
 *
 * GENERIC OVER `{ at: number }` RATHER THAN OVER `FeedEntry`, and that is not
 * decoration. The feed groups `OrderThread`s now, which carry `at` only
 * indirectly (on `latest`) — so this constraint is what lets both a raw event
 * feed and a collapsed one flow through the same grouping without a second,
 * near-identical function. `FeedEntry` satisfies it, so every existing caller
 * and every existing test is unchanged: `T` resolves to `FeedEntry`, and the
 * return type is structurally identical to what it was.
 */
export function groupByDay<T extends { at: number }>(
  entries: readonly T[],
  now: number = Date.now(),
): { label: string; entries: T[] }[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();
  const yesterdayStart = todayStart - 86_400_000;

  const groups: { label: string; entries: T[] }[] = [];
  let current: { label: string; entries: T[] } | null = null;

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

/**
 * The absolute date and time ("Oct 15, 2:34 PM"), for when the relative label
 * is not enough on its own.
 *
 * WHY THIS EXISTS BESIDE `relativeTime`. A feed's rows sort by time and the
 * eye groups them by the day headings, but the card itself only carried
 * "12m" — which stops answering the question the moment the window is
 * "Earlier", where twelve rows read "2d", "3d", "6d" with nothing to tell
 * them apart. The relative label says HOW LONG AGO; this says WHEN. They
 * answer different questions and the card shows both, the way every mail and
 * message list does.
 *
 * THE YEAR IS CONDITIONAL, and that is the whole detail. A feed timestamp is
 * nearly always in the current year, where "2026" on every row is noise; the
 * only rows it disambiguates are the ones older than a year, which are
 * exactly the rows a short relative label has already given up on ("6d" and
 * beyond are a bare date in `relativeTime` too). So the year appears exactly
 * when it carries information.
 *
 * Takes `now` as a parameter for the same reason `relativeTime` does — one
 * clock for the whole list, and a testable boundary at New Year.
 *
 * Returns '' for an unusable timestamp rather than "Invalid Date".
 * `buildNotificationFeed` drops such entries before they reach here, so this
 * is defensive rather than reachable — but a component that renders "Invalid
 * Date" is worse than one that renders nothing.
 */
export function absoluteTime(at: number, now: number = Date.now()): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return '';

  const thisYear = new Date(now).getFullYear();
  const sameYear = then.getFullYear() === thisYear;

  return then.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    // Spread rather than `year: sameYear ? 'numeric' : undefined` — an
    // explicit `undefined` is not the same as an absent option to every
    // engine's Intl implementation, and omitting the key is the documented
    // way to say "no year".
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The card's timestamp cluster: the relative label and the absolute date, or
 * just the absolute date in the "Earlier" window.
 *
 * WHY "EARLIER" SHOWS ONE LABEL AND THE OTHERS SHOW TWO. The pair exists
 * because the two halves answer different questions — `relativeTime` says how
 * long ago, `absoluteTime` says when — and on a row that moved an hour ago
 * both are news. Inside the "Earlier" window the pair is duplication: every
 * row there is by definition older than yesterday, so the exact date already
 * carries the ordering and the relative label restates it. At the far end it
 * is worse than restating — past a week `relativeTime` degrades to a bare
 * date, and the card was literally printing "Sep 30 · Sep 30, 9:55 AM".
 *
 * WHY THIS DECISION IS A PARAMETER AND NOT AN `if` IN THE TEMPLATE. The window
 * is the page's state and the rendering rule is a display rule, which belongs
 * in this file next to the two formatters it composes — the same reason
 * `absoluteTime` is here rather than in the page. A template branch would
 * also be untestable, and this is exactly the kind of rule that reads as
 * obviously right until someone screenshots the page.
 *
 * `now` is passed through to BOTH formatters, so a re-render of a list still
 * computes every row against one instant.
 *
 * `all` is treated like the named days rather than like `earlier` on purpose:
 * it is the only window where a 40-day-old row can sit beside a 2-hour-old
 * one, and there the relative half is what ranks a fresh row against a very
 * old one — the one job the absolute date cannot do. The cost, stated rather
 * than buried: its oldest rows repeat their date, exactly as the Earlier
 * window used to. `all` is unreachable from the feed's dropdown, so that cost
 * is unobservable today; if the window ever comes back, this branch is the
 * line to revisit.
 */
export function feedTimeLabel(at: number, period: FeedPeriod, now: number = Date.now()): string {
  const absolute = absoluteTime(at, now);
  if (period === 'earlier') return absolute;
  return `${relativeTime(at, now)} · ${absolute}`;
}
