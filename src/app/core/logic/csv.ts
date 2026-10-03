// src/app/core/logic/csv.ts
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
// The DOM half (Blob, object URL, the anchor click) stays in `downloadCsv` below.
// It is no longer what the app calls: every export goes through
// CsvExportService, which uses `downloadCsv` on web and write-then-share on a
// device. Keeping the primitives here means the escaping rules stay testable
// without a DOM.
//
// WHAT IS NOT HANDLED HERE
// Excel's leading-`=` formula injection. A product name beginning with `=` is
// written literally here. `sanitiseCell` is the single place to change if the
// shop ever sells a flavour named "=SUM(A1:A9)"; it is deliberately left out
// because silently rewriting a customer's data to defend against a scenario
// this shop has is worse than the scenario.

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
 * body — there is no difference to express, and a header that is escaped one way
 * and a body another is how the two stop reconciling.
 */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  if (!rows.length) return '';
  return rows.map((row) => row.map(sanitiseCell).join(',')).join('\n');
}

/** `orders`, `2026-10-02` → `five-orites-orders-2026-10-02.csv` */
export function csvFilename(prefix: string, suffix?: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const tail = suffix ? `-${suffix}` : '';
  return `five-orites-${prefix}${tail}-${date}.csv`;
}

/**
 * Hands a CSV to the browser as a download.
 *
 * WEB ONLY, and now unused by the app. It is kept because it is the honest
 * browser primitive and it is small, but nothing calls it: every export goes
 * through `CsvExportService`, which uses this on web and write-then-share on a
 * device.
 *
 * It was previously the ONLY path, and it silently did nothing inside a
 * Capacitor WebView — no download manager, no filesystem permission model, the
 * click resolving to nothing. The export looked like it had worked. That is what
 * CsvExportService exists to fix.
 *
 * The revoke is deferred by 2s rather than done immediately: Safari cancels an
 * in-flight download if its object URL disappears in the same tick as the click.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Firestore Timestamp (or ISO string, or nothing) as `YYYY-MM-DD`.
 *
 * Deliberately tolerant: an order can be read back from a cache or a CSV import
 * where `createdAt` is already a string, and a formatter that throws on that
 * takes down the whole export rather than blanking one cell.
 */
export function toIsoDate(value: unknown): string {
  try {
    const ts = value as { toDate(): Date } | string | undefined | null;
    if (!ts) return '';
    const d = typeof ts === 'string' ? new Date(ts) : ts.toDate();
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  } catch {
    return '';
  }
}