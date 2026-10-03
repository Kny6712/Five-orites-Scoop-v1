// src/app/core/logic/series.ts
// Five-orites Scoop — Time-series bucketing for the revenue trend
//
// Framework-free so `npm run test:logic` can assert the bucketing directly.
//
// WHY THIS EXISTS
// The analytics page could only ever show AGGREGATES — one revenue figure for
// "last 30 days". The bar chart answers "which flavour sells most", the donut
// answers "what is the status mix", and neither answers the question an owner
// actually asks first: is the shop getting busier or quieter?
//
// Bucketing is separated from drawing because the interesting part is the
// EDGES. A naive `Math.floor(daysAgo / bucketDays)` puts an order at 8:59pm on
// the wrong side of midnight, and an off-by-one in the day index silently
// shifts the whole trend by a day — which looks like a plausible chart and is
// wrong.

export interface Bucket {
  /** `YYYY-MM-DD` in local time. */
  date: string;
  /** Inclusive start, epoch ms. */
  start: number;
  /** Exclusive end, epoch ms. */
  end: number;
  /** Human label for the axis, e.g. "Oct 2". */
  label: string;
}

/**
 * Calendar-day buckets covering the last `days` days, oldest first.
 *
 * CALENDAR days, not rolling 24-hour windows: "revenue on Oct 2" has to mean
 * the day a person was awake for, and a rolling window would place an order at
 * 23:50 on "yesterday" for one reader and "today" for another.
 *
 * Each bucket starts at local midnight and ends at the next local midnight, so
 * DST transitions produce a 23- or 25-hour day and the arithmetic still lands on
 * the right calendar date.
 */
export function calendarBuckets(days: number, now: Date): Bucket[] {
  const n = Math.max(1, Math.floor(days));
  const out: Bucket[] = [];
  // Start from today's midnight and step BACKWARDS, so the last bucket is always
  // today rather than "the last full 24 hours", which at 9am would exclude this
  // morning's sales and make the final point of the trend look like a collapse.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(today);
    start.setDate(start.getDate() - i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    out.push({
      date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
      start: start.getTime(),
      end: end.getTime(),
      label: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    });
  }
  return out;
}

/**
 * Buckets for a 30+ day window, collapsed into weekly columns.
 *
 * Thirty daily bars on a phone is thirty hairlines and no readable axis, so a
 * long range is bucketed by WEEK and labelled with the week start. The sum is
 * still every order in the window — nothing is dropped, only displayed less
 * often.
 */
export function weeklyBuckets(days: number, now: Date): Bucket[] {
  const daily = calendarBuckets(days, now);
  const out: Bucket[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    out.push({
      date: chunk[0].date,
      start: chunk[0].start,
      // The LAST day's exclusive end, so a partial final week still ends now
      // rather than spilling into the future.
      end: chunk[chunk.length - 1].end,
      label: chunk[0].label,
    });
  }
  return out;
}

/** Picks daily or weekly based on how wide the window is. */
export function bucketsFor(days: number, now: Date): Bucket[] {
  return days > 14 ? weeklyBuckets(days, now) : calendarBuckets(days, now);
}

/**
 * Sums `value` into whichever bucket each timestamp falls in.
 *
 * Every bucket is emitted, including empty ones. A trend line with gaps is
 * misleading — a missing column reads as "no sales", and the eye draws a
 * straight line across it, which is a different claim from "flat".
 *
 * Timestamps outside the window are ignored rather than clamped: an order at
 * 23:59 on the day before the window opened belongs to no column, and putting
 * it in the nearest one would invent a spike.
 */
export function bucketize<T>(
  buckets: Bucket[],
  rows: readonly T[],
  toMs: (row: T) => number,
  value: (row: T) => number
): number[] {
  const sums = new Array<number>(buckets.length).fill(0);
  if (!buckets.length) return sums;
  const first = buckets[0].start;
  const last = buckets[buckets.length - 1].end;

  for (const row of rows) {
    const ms = toMs(row);
    if (!Number.isFinite(ms) || ms < first || ms >= last) continue;
    for (let i = 0; i < buckets.length; i++) {
      if (ms >= buckets[i].start && ms < buckets[i].end) {
        sums[i] += value(row);
        break;
      }
    }
  }
  return sums;
}

/**
 * Running total, for the "cumulative revenue" series.
 *
 * Starts at 0 on the first bucket so the line begins at the window's baseline
 * rather than at the first day's total, which would overstate the opening value.
 */
export function runningTotal(values: readonly number[]): number[] {
  let total = 0;
  return values.map((v) => (total += v));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}