// src/app/core/logic/csv/cell.ts
// Five-orites Scoop — CSV serialisation, shared by every admin export
//
// WHY IT LIVES HERE
// Analytics had the only export in the app, and it was a private page method
// (`AnalyticsPage.exportCsv`) with its date formatter next to it. That made a
// second export the first copy of it, and the copies drift: the analytics one
// quotes every cell and doubles embedded quotes by hand, which is exactly the
// step that gets forgotten the second time.
//
// This module is framework-free on purpose — `npm run test:logic` imports it
// directly and never touches the DOM — so the escaping rules are asserted
// rather than hoped for.
//
// THE DOM HALF MOVED OUT
// `downloadCsv` used to live here. Nothing called it — every export goes
// through `CsvExportService`, which writes-then-shares on a device and
// downloads on the web — and it was the only `document`/`Blob` reference in
// a module whose whole reason for existing is that it can be tested without
// a browser.
//
// WHAT IS NOT HANDLED HERE
// Excel's leading-`=` formula injection. A product name beginning with `=` is
// written literally here. `sanitiseCell` is the single place to change if the
// shop ever sells a flavour named "=SUM(A1:A9)"; it is deliberately left out
// because silently rewriting a customer's data to defend against a scenario
// this shop has is worse than the scenario.

import { formatLocalDate } from '@core/logic/date';

/** A cell is anything a spreadsheet can show; objects are stringified by the caller. */
export type CsvCell = string | number | boolean | null | undefined;

/**
 * Quotes and escapes one cell.
 *
 * A field containing a comma, a quote or a newline must be wrapped in quotes,
 * and an embedded quote is doubled — the RFC 4180 rule. Quoting EVERY cell
 * unconditionally is also valid and is what this does: it is simpler, and it
 * means a value that happens to contain a comma cannot be a latent bug in a
 * column that did not think about it.
 */
export function sanitiseCell(value: CsvCell): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * A CSV document from a header row and any number of body rows.
 *
 * `rows[0]` is treated as the header and is NOT escaped differently from the
 * body — there is no difference to express, and a header that is escaped one
 * way and a body another is how the two stop reconciling.
 */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  if (!rows.length) return '';
  return rows.map((row) => row.map(sanitiseCell).join(',')).join('\n');
}

/**
 * `orders`, `2026-10-02` → `five-orites-orders-2026-10-02.csv`
 *
 * The date is LOCAL, not UTC. This used to be `new Date().toISOString()`, which
 * stamps the file with the PREVIOUS day for any export made before 8am in
 * Manila — and it sat in a file whose other date columns are local, so one
 * export could carry two different days.
 *
 * `now` is a parameter so the name is deterministic under test.
 */
export function csvFilename(prefix: string, suffix?: string, now: Date = new Date()): string {
  const date = formatLocalDate(now.getTime());
  const tail = suffix ? `-${suffix}` : '';
  return `five-orites-${prefix}${tail}-${date}.csv`;
}

/**
 * A timestamp as an ISO-8601 string, or '' when there is none.
 *
 * Deliberately tolerant: an order can be read back from a cache or a CSV
 * import where `createdAt` is already a string, a Firestore `Timestamp`, or a
 * plain epoch-ms number, and a formatter that throws on any of those takes
 * down the whole export rather than blanking one cell.
 *
 * The number case used to fall through to `value.toDate()`, which is not a
 * function on a number — so it threw, the throw was swallowed by the `catch`,
 * and the cell came out blank with no signal that anything had gone wrong.
 *
 * The docstring used to say `YYYY-MM-DD`, which the code never did — it has
 * always returned a full ISO-8601 timestamp, and the test asserts that. The
 * doc was wrong; this is the code that was always right, now described
 * correctly.
 */
export function toIsoDate(value: unknown): string {
  try {
    if (value === null || value === undefined || value === '') return '';

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return '';
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? '' : value.toISOString();
    }

    if (typeof value === 'object') {
      const toDate = (value as { toDate?: unknown }).toDate;
      if (typeof toDate === 'function') {
        const d = (toDate as () => Date).call(value);
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : '';
      }
    }

    if (typeof value === 'string') {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    }

    return '';
  } catch {
    return '';
  }
}
