// src/app/core/logic/csv-import.ts
// Five-orites Scoop — Product CSV parsing and validation
//
// Framework-free, and separated from the write, because the interesting part is
// WHAT GETS REJECTED. A bulk importer that half-applies a file is worse than one
// that refuses: an admin who imports 64 flavors and gets 40 written has no way
// to tell which 40, and the catalog is left in a state neither the UI nor the
// rules can describe as correct.
//
// So the whole file is validated FIRST and nothing is written until every row
// passes. `parseProductCsv` returns a plan — valid rows and per-row errors — and
// the caller decides what to do with it.
//
// README lists "CSV bulk product import" under Out of Scope, and
// REFACTOR_PLAN.md:245 repeats it. This is that feature.

import type { ProductCategory } from '../models/product.model';

export interface ProductRow {
  setNumber: number;
  setName: string;
  variantName: string;
  description: string;
  category: ProductCategory;
  pricing: { cup: number; pint: number; halfGallon: number; gallon: number };
  stock: { cup: number; pint: number; halfGallon: number; gallon: number };
}

export interface RowError {
  /** 1-based line number in the ORIGINAL file, header included. */
  line: number;
  message: string;
}

export interface ImportPlan {
  valid: ProductRow[];
  errors: RowError[];
  /** Header names that were not recognised, so a typo'd column is visible. */
  unknownColumns: string[];
  /** Rows that parsed but produced nothing (blank line, comment). */
  skipped: number;
}

const VALID_CATEGORIES: ProductCategory[] = ['flavor', 'sundae', 'cone'];
const SIZES = ['cup', 'pint', 'halfGallon', 'gallon'] as const;

/**
 * Header aliases, so a file exported from a spreadsheet in any reasonable shape
 * works.
 *
 * Lower-cased and stripped of spaces and underscores on both sides, which is why
 * `Price (Half Gallon)`, `price_half_gallon` and `pricehalfgallon` all reach the
 * same key. Without that, a column header written by a human rather than by code
 * silently imports as empty and every price becomes 0.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  setNumber: ['setnumber', 'set', 'setno', 'flavorset'],
  setName: ['setname', 'name', 'collection'],
  variantName: ['variantname', 'variant', 'flavor', 'flavour', 'flavorname'],
  description: ['description', 'desc', 'details'],
  category: ['category', 'type', 'catalogtype'],
  cupPrice: ['cupprice', 'pricecup', 'cup'],
  pintPrice: ['pintprice', 'pricepint', 'pint'],
  halfGallonPrice: ['halfgallonprice', 'pricehalfgallon', 'halfgallon', 'halfgallonprice'],
  gallonPrice: ['gallonprice', 'pricegallon', 'gallon'],
  cupStock: ['cupstock', 'stockcup', 'cupstock'],
  pintStock: ['pintstock', 'stockpint', 'pintstock'],
  halfGallonStock: ['halfgallonstock', 'stockhalfgallon', 'halfgallonstock'],
  gallonStock: ['gallonstock', 'stockgallon', 'gallonstock'],
};

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-()]/g, '');
}

/**
 * Parses one CSV line, honouring quoted fields.
 *
 * Written by hand rather than pulled in as a dependency because RFC 4180's rules
 * are short and a parser is exactly the kind of code that must be right: a naive
 * `split(',')` turns `Rocky Road, "chunky"` into two fields and shifts every
 * column after it, which is the same failure the CSV *writer* had to avoid.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
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
 * Validates a whole file and returns a plan. Writes nothing.
 *
 * EVERY row is checked before any is accepted, and the errors are per-line so an
 * admin can fix the file rather than guess. Duplicate set/variant pairs inside
 * the file are rejected here too — the document id is derived from that pair, so
 * a duplicate in one upload silently overwrites the earlier row.
 */
export function parseProductCsv(text: string, existingIds: Set<string> = new Set()): ImportPlan {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const plan: ImportPlan = { valid: [], errors: [], unknownColumns: [], skipped: 0, };
  if (!lines.length) {
    plan.errors.push({ line: 0, message: 'The file is empty.' });
    return plan;
  }

  const header = parseCsvLine(lines[0]).map(normaliseHeader);
  const columnIndex: Record<string, number> = {};
  const unknown: string[] = [];

  header.forEach((h, i) => {
    const match = Object.keys(COLUMN_ALIASES).find((key) => COLUMN_ALIASES[key].includes(h));
    if (match) {
      // First column wins on a duplicate header, so a file with both
      // `price` and `price_cup` does not silently take the later one.
      if (!(match in columnIndex)) columnIndex[match] = i;
    } else if (h) {
      unknown.push(lines[0].split(',')[i]?.trim() || h);
    }
  });
  plan.unknownColumns = unknown;

  // The three columns with no sensible default. Everything else can be derived.
  for (const required of ['variantName', 'setName', 'setNumber']) {
    if (!(required in columnIndex)) {
      plan.errors.push({ line: 1, message: `Missing required column: ${required}` });
    }
  }
  if (plan.errors.length) return plan;

  const seen = new Set<string>();
  let hasPrices = false;

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const get = (key: string): string => {
      const idx = columnIndex[key];
      return idx === undefined ? '' : (cells[idx] ?? '');
    };
    const lineNo = i + 1;

    // A line starting with # is a comment, so an exported file can carry notes.
    if ((cells[0] ?? '').startsWith('#')) { plan.skipped++; continue; }

    const variantName = get('variantName');
    const setName = get('setName');
    if (!variantName && !setName) { plan.skipped++; continue; }

    const rowErrors: string[] = [];
    if (!setName) rowErrors.push('setName is required');
    if (!variantName) rowErrors.push('variantName is required');

    const setNumberRaw = get('setNumber');
    const setNumber = Number(setNumberRaw);
    if (!setNumberRaw || !Number.isInteger(setNumber) || setNumber < 1) {
      rowErrors.push(`setNumber must be a whole number of 1 or more (got "${setNumberRaw}")`);
    }

    const categoryRaw = get('category').toLowerCase();
    let category: ProductCategory = 'flavor';
    if (categoryRaw && !VALID_CATEGORIES.includes(categoryRaw as ProductCategory)) {
      rowErrors.push(`category must be one of ${VALID_CATEGORIES.join(', ')} (got "${categoryRaw}")`);
    } else if (categoryRaw) {
      category = categoryRaw as ProductCategory;
    }

    const pricing = {} as ProductRow['pricing'];
    const stock = {} as ProductRow['stock'];
    for (const size of SIZES) {
      const priceRaw = get(`${size}Price`);
      const stockRaw = get(`${size}Stock`);
      // An absent price column leaves the tier default alone; a PRESENT but
      // unparseable one is an error, because 0 and "not set" are different and
      // only the second one is acceptable.
      if (priceRaw) {
        const price = Number(priceRaw);
        if (!Number.isFinite(price) || price < 0) {
          rowErrors.push(`${size} price must be a number of 0 or more (got "${priceRaw}")`);
        } else {
          pricing[size] = Math.round(price);
          hasPrices = true;
        }
      }
      if (stockRaw) {
        const qty = Number(stockRaw);
        if (!Number.isInteger(qty) || qty < 0) {
          rowErrors.push(`${size} stock must be a whole number of 0 or more (got "${stockRaw}")`);
        } else {
          stock[size] = qty;
        }
      }
    }

    // The document id the inventory seeder uses, so a re-import UPDATES rather
    // than duplicating.
    const id = `${setNumber}_${slug(variantName)}`;
    if (seen.has(id)) {
      rowErrors.push(`duplicate of an earlier row in this file (${id})`);
    }
    if (existingIds.has(id)) {
      rowErrors.push(`already exists in the catalog (${id}) — edit it instead`);
    }
    seen.add(id);

    if (rowErrors.length) {
      plan.errors.push({ line: lineNo, message: rowErrors.join('; ') });
      continue;
    }

    plan.valid.push({
      setNumber,
      setName,
      variantName,
      description: get('description'),
      category,
      pricing: {
        cup: pricing.cup ?? 0,
        pint: pricing.pint ?? 0,
        halfGallon: pricing.halfGallon ?? 0,
        gallon: pricing.gallon ?? 0,
      },
      stock: {
        cup: stock.cup ?? 0,
        pint: stock.pint ?? 0,
        halfGallon: stock.halfGallon ?? 0,
        gallon: stock.gallon ?? 0,
      },
    });
  }

  if (!plan.valid.length && !plan.errors.length) {
    plan.errors.push({ line: 0, message: 'No data rows found — only a header?' });
  }

  // A file with no price column at all would create every product at ₱0, which
  // the rules allow (`pricing.cup is int` with no floor). Better to refuse.
  if (plan.valid.length && !hasPrices) {
    plan.errors.push({
      line: 1,
      message: 'No price column found. Add cup_price, pint_price, half_gallon_price and gallon_price.',
    });
    plan.valid = [];
  }

  // ALL OR NOTHING.
  //
  // This is the decision the whole module exists to make. A partial import is
  // the worst outcome available: an admin who uploads 64 flavors and gets 40
  // written cannot tell which 40 from the result, and the catalog is left in a
  // state that neither the UI nor the rules can describe as correct. So one bad
  // row rejects the file, and the errors carry line numbers so the fix is a
  // matter of editing the file rather than guessing.
  if (plan.errors.length) {
    plan.valid = [];
  }

  return plan;
}

/** `Rocky Road` → `rocky_road`, matching the seeder's document id scheme. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * A blank template, so "what columns do I need?" has an answer in the app
 * rather than in someone's notes.
 */
export const PRODUCT_CSV_TEMPLATE =
  'set_number,set_name,variant_name,description,category,cup_price,pint_price,half_gallon_price,gallon_price,cup_stock,pint_stock,half_gallon_stock,gallon_stock\n' +
  '1,Chocolates,Rocky Road,Chocolate ice cream with nuts,flavor,65,200,500,950,10,10,10,10\n' +
  '# Lines starting with # are ignored.\n';