// src/app/core/logic/date.ts
// Five-orites Scoop — Date formatting
//
// Framework-free so `npm run test:logic` can assert it directly.
//
// WHY THIS EXISTS
// Three modules formatted `YYYY-MM-DD` and they did not agree:
//   - voucher.ts  — LOCAL time (correct: the admin date input speaks local)
//   - series.ts   — LOCAL time (correct: a bucket is a calendar day)
//   - csv.ts      — UTC     (wrong for this shop: a file exported at 8am in
//                            Manila was stamped with the PREVIOUS day's date)
//
// Two copies of a date formatter are two formats by the next change, so there
// is one now, and it is local, because every date the shop writes down — a
// voucher's window, a bucket's column, a CSV's filename — is a date a human
// in Manila read off a screen.

/** `YYYY-MM-DD` in LOCAL time. */
export function formatLocalDate(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD` in local time, from a `Date`. */
export function formatLocalDateFromDate(date: Date): string {
  return formatLocalDate(date.getTime());
}

/**
 * The last instant of a local calendar day, in epoch ms.
 *
 * Used where a stored timestamp means "the end of the day it names" rather
 * than "the moment the day began". `new Date(y, m, d + 1).getTime() - 1` is
 * local-midnight arithmetic, so it stays correct across a DST transition —
 * subtracting a fixed 86400 000 ms does not, because that day was 23 or 25
 * hours long.
 */
export function endOfLocalDay(ms: number): number {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return ms;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1;
}

/** Zero-pads to two digits. */
export function pad(n: number): string {
  return String(n).padStart(2, '0');
}
