// scripts/preflight-rules-audit.mjs
// Five-orites Scoop — pre-deploy rules audit (READ ONLY)
//
// WHY THIS EXISTS
// `firestore.rules` validates the SHAPE of a document on every write, including
// writes that were never meant to touch the field being validated. Two
// consequences bit this project, and both only show up against real data:
//
//   1. An order with no `statusHistory` array used to be UNADVANCEABLE. The
//      append-only check read `resource.data.statusHistory.size()`, and a dot
//      access to an absent key is an evaluation error, which denies the whole
//      write. Fixed in the rules by `historyLen()`.
//   2. A product missing one of its four `pricing.*` fields used to have
//      UNMOVABLE STOCK, because every stock movement re-validates the whole
//      catalogue entry. Fixed by a narrow stock-only update clause.
//
// Both are handled in the rules now, which makes this a CONFIDENCE CHECK rather
// than a gate: it reports what shape your live data is in, so a surprise is a
// line of output instead of a failed order at the counter.
//
// IT ONLY EVER ISSUES HTTP GET. There is no code path in this file that can
// write, update or delete anything — no Admin SDK, no credentials with write
// intent, just the public Firestore REST read API with a bearer token.
//
// HOW TO RUN
//   npm run audit:rules
//
// The token is picked up automatically from the Firebase CLI's own credential
// store, which is the same credential `npm run deploy` already uses. No setup.
//
// If the stored token has expired, ANY firebase command refreshes it — for
// example `npx firebase projects:list` — so run that and then run this again.
//
// COST: one document read per product and per order. The Spark plan allows
// 50,000 reads per DAY, so this is a rounding error against that budget.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'five-orites-scoop';
const SIZES = ['cup', 'pint', 'halfGallon', 'gallon'];
const STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled',
];

// ── Credential ──────────────────────────────────────────────────────────

function tokenFromCliStore() {
  const candidates = [
    join(homedir(), '.config', 'configstore', 'firebase-tools.json'),
    join(homedir(), '.config', 'firebase', 'rc.json'),
    join(homedir(), '.firebaserc'),
  ];
  for (const path of candidates) {
    try {
      const json = JSON.parse(readFileSync(path, 'utf8'));
      const token = json?.tokens?.access_token;
      if (!token) continue;
      const expiresAt = Number(json.tokens.expires_at);
      if (Number.isFinite(expiresAt)) {
        const expiryMs = expiresAt > 99999999999 ? expiresAt : expiresAt * 1000;
        if (Date.now() > expiryMs) {
          return {
            error:
              'The Firebase CLI token on this machine has expired. Run any firebase ' +
              'command to refresh it (e.g. `npx firebase projects:list`), then run this again.',
          };
        }
      }
      return { token };
    } catch {
      // Not there, or not readable — try the next candidate.
    }
  }
  return {
    error:
      'No Firebase credential found. Sign in with `npx firebase login`, or set ' +
      'FIREBASE_TOKEN to an access token.',
  };
}

const cred = process.env.FIREBASE_TOKEN
  ? { token: process.env.FIREBASE_TOKEN }
  : tokenFromCliStore();

if (cred.error) {
  console.error(cred.error);
  process.exit(2);
}

// ── Firestore REST reads ────────────────────────────────────────────────

const ENDPOINT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/** Firestore's tagged value union -> a plain JS value. */
function decode(v) {
  if (v === null || v === undefined) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(decode);
  if ('mapValue' in v) return decodeMap(v.mapValue?.fields ?? {});
  return null;
}

function decodeMap(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decode(v);
  return out;
}

async function readCollection(collection) {
  const docs = [];
  let pageToken = null;
  do {
    const url =
      `${ENDPOINT}/${collection}?pageSize=1000` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cred.token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Firestore refused the read (HTTP ${res.status}). The token is probably ` +
            `expired or lacks the Firestore scope.\n${body.slice(0, 300)}`,
        );
      }
      throw new Error(`HTTP ${res.status} reading ${collection}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    for (const d of json.documents ?? []) {
      docs.push({ id: d.name.split('/').pop(), data: decodeMap(d.fields ?? {}) });
    }
    pageToken = json.nextPageToken ?? null;
  } while (pageToken);
  return docs;
}

// ── The checks. Each mirrors a clause in firestore.rules. ───────────────

const problems = [];
const notes = [];
const report = (c, id, field, detail) => problems.push({ c, id, field, detail });
const note = (c, id, field, detail) => notes.push({ c, id, field, detail });

function checkProduct(id, p) {
  if (typeof p !== 'object' || p === null) return report('products', id, '(doc)', 'not a map');

  for (const size of SIZES) {
    const v = p.pricing?.[size];
    if (!Number.isInteger(v)) {
      report('products', id, `pricing.${size}`, `is ${JSON.stringify(v)}, needs a whole peso`);
    }
  }
  if (!Number.isInteger(p.setNumber) || p.setNumber < 1) {
    report('products', id, 'setNumber', `is ${JSON.stringify(p.setNumber)}, needs an int >= 1`);
  }
  if (typeof p.isActive !== 'boolean') {
    report('products', id, 'isActive', `is ${JSON.stringify(p.isActive)}, needs a bool`);
  }
  if (typeof p.stock !== 'object' || p.stock === null) {
    // NOT covered by the narrow stock clause, which still calls stockIsSane(),
    // and that requires `stock` to be a map. This one really would block.
    report('products', id, 'stock', `is ${JSON.stringify(p.stock)}, needs a map`);
  } else {
    for (const size of SIZES) {
      const v = p.stock[size];
      if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0)) {
        report('products', id, `stock.${size}`, `is ${JSON.stringify(v)}, needs an int >= 0`);
      }
    }
  }
}

function checkOrder(id, o) {
  if (typeof o !== 'object' || o === null) return report('orders', id, '(doc)', 'not a map');

  if (!Array.isArray(o.statusHistory)) {
    // Tolerated by historyLen() now, so this is a note rather than a blocker.
    note(
      'orders',
      id,
      'statusHistory',
      `is ${JSON.stringify(o.statusHistory)}, not an array — advanceable only because ` +
        'historyLen() treats absent as empty',
    );
  }
  if (!STATUSES.includes(o.status)) {
    // NOT tolerated anywhere. Staff cannot advance this order at all.
    report(
      'orders',
      id,
      'status',
      `is ${JSON.stringify(o.status)}, not one of the six known statuses — staff ` +
        'cannot advance it and the tracker cannot render it',
    );
  }
  if (!Number.isInteger(o.deliveryFee)) {
    // `allow create` requires this but `allow update` does not re-check it.
    note(
      'orders',
      id,
      'deliveryFee',
      `is ${JSON.stringify(o.deliveryFee)}, not a whole peso — tolerated on update, ` +
        'but a NEW order like this would be refused',
    );
  }
  if (!Array.isArray(o.items) || o.items.length === 0) {
    report('orders', id, 'items', 'is empty or missing — stock movement would have no lines');
  }
}

console.log(`Auditing live project "${PROJECT_ID}" over the REST read API...`);
console.log('(GET requests only — this script cannot write)\n');

let products;
let orders;
try {
  products = await readCollection('products');
  orders = await readCollection('orders');
} catch (err) {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
}

console.log(`  ${products.length} products read`);
console.log(`  ${orders.length} orders read`);

for (const d of products) checkProduct(d.id, d.data);
for (const d of orders) checkOrder(d.id, d.data);

function print(list, heading, colour) {
  console.log(`\n${colour}${heading}: ${list.length}${colour}\n`);
  for (const p of list) console.log(`  ${p.c}/${p.id}  ${p.field}: ${p.detail}`);
  if (list.length) console.log('');
}

print(notes, 'TOLERATED (informational)', '[36m');
print(problems, 'BLOCKING — the rules would refuse these', '[31m');

if (problems.length === 0) {
  console.log('\n[32mOK. Nothing in the live data would be refused by the current rules.[0m\n');
  process.exit(0);
}

console.log(
  'Each BLOCKING row above is something staff cannot change until the data is\n' +
    'corrected: an order whose status is not one of the six, a product whose\n' +
    'stock is not a map, or an empty order. Deploying the rules does not create\n' +
    'these — it stops them being fixable through the app. Fix the data (Admin\n' +
    'SDK or console) or delete the row.\n',
);
process.exit(1);
