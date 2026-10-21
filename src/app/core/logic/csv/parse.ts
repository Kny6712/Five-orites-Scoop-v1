// src/app/core/logic/csv/parse.ts
// Five-orites Scoop — CSV line parsing
//
// Framework-free so `npm run test:logic` can assert it directly.
//
// WHY THIS LIVES HERE
// The product importer and the voucher importer each carried their own copy
// of `parseCsvLine` — byte-identical apart from the name, with the voucher
// copy's own comment admitting it ("A COPY of the product importer's
// parser"). Two copies of a CSV parser is two CSV parsers, and the day they
// disagree the importer reads a file one of them cannot.
//
// `normaliseHeader` came along for the same ride: two identical one-liners.

/**
 * Splits one CSV record into its cells.
 *
 * RFC 4180: a field containing a comma, a quote or a newline is wrapped in
 * quotes, and an embedded quote is doubled. Both rules are handled here,
 * which is why the file is split on newlines only where the caller has
 * already established that no quoted field straddles a line break.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote. A single
        // quote closes the field.
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((c) => c.trim());
}

/**
 * Normalises a header cell for comparison.
 *
 * Lower-cased, with spaces, underscores, hyphens and parentheses STRIPPED —
 * not turned into underscores. So "Price (Half Gallon)", "price_half_gallon"
 * and "pricehalfgallon" all reach the same key.
 *
 * This exact rule matters: the column-alias tables on both sides of the app
 * are written in the stripped form ("pricehalfgallon", "setnumber"), so
 * normalising to "price_half_gallon" instead would match nothing and every
 * column would import as empty.
 */
export function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-()]/g, '');
}

/**
 * Splits a CSV document into records, keeping the ORIGINAL line number of each.
 *
 * The naive `split(/\r?\n/).filter(nonEmpty)` loses the mapping back to the
 * file, and every importer that reported line numbers from it was off by the
 * number of blank lines above the offending row — which sent the admin to
 * edit the wrong row. This keeps both: the record's cells, and the line it
 * came from.
 */
export function parseCsvRecords(text: string): { cells: string[]; line: number }[] {
  const lines = text.split(/\r?\n/);
  const out: { cells: string[]; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim().length === 0) continue;
    out.push({ cells: parseCsvLine(raw), line: i + 1 });
  }
  return out;
}
