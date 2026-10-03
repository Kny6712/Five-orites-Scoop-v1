// scripts/preflight-rules-audit.mjs
// Five-orites Scoop — pre-deploy rules audit (READ ONLY)
//
// WHY THIS EXISTS
// `firestore.rules` validates the SHAPE of a document every time it is written,
// including writes that were not meant to touch the field being validated. Two
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
// Both are now handled in the rules, which is why this script is a
// CONFIDENCE CHECK rather than a gate. It tells you what shape your live data
// is in BEFORE you deploy, so a surprise is a line of output instead of a
// failed order at the counter.
//
// IT ONLY READS. It cannot write, update or delete anything.
//
// HOW TO RUN
//   npx firebase login:ci                       # one-off, prints a token
//   $env:FIREBASE_TOKEN = "<the token>"         # PowerShell
//   node scripts/preflight-rules-audit.mjs
//
// Revoke the token afterwards with `firebase login:ci --reauth`, or delete the
// CI account from Firebase Console > Project settings > Service accounts.
// Alternatively `npx firebase login:ci --no-local` prints the token without
// storing anything on this machine.
//
// Cost: one read per product and per order. The Spark plan allows 50,000 reads
// per DAY, so this is a rounding error against that budget.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'five-orites-scoop';

if (!process.env.FIREBASE_TOKEN && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    'No credential found.\n\n' +
      '  Run `npx firebase login:ci` and set the token it prints:\n' +
      '    $env:FIREBASE_TOKEN = "<token>"      # PowerShell\n\n' +
      'This script only reads. To revoke the token afterwards, run\n' +
      '`npx firebase login:ci --reauth`.',
  );
  process.exit(1);
}

const SIZES = ['cup', 'pint', 'halfGallon', 'gallon'];
const STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled',
];

const app = initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app);

/** Collected problems, keyed by collection so the summary can group them. */
const problems = [];

function report(collection, id, field, detail) {
  problems.push({ collection, id, field, detail });
}

/**
 * Mirrors `isWellFormedProduct()` in firestore.rules, minus the whole-document
 * re-validation that the narrow stock clause deliberately does not require.
 * Kept in step with that function by hand; if you change one, change both.
 */
function checkProduct(id, p) {
  if (typeof p !== 'object' || p === null) return report('products', id, '(doc)', 'not a map');

  // `isWellFormedProduct` reads each price with a dot access, so an absent price
  // is an evaluation error and every write to the product is denied.
  for (const size of SIZES) {
    const v = p.pricing?.[size];
    if (!Number.isInteger(v)) {
      report(
        'products',
        id,
        `pricing.${size}`,
        `is ${JSON.stringify(v)}, needs a whole peso (is int)`,
      );
    }
  }
  if (!Number.isInteger(p.setNumber) || p.setNumber < 1) {
    report('products', id, 'setNumber', `is ${JSON.stringify(p.setNumber)}, needs an int >= 1`);
  }
  if (typeof p.isActive !== 'boolean') {
    report('products', id, 'isActive', `is ${JSON.stringify(p.isActive)}, needs a bool`);
  }
  // `stockIsSane()` requires `stock` to be a map, but tolerates a missing SIZE.
  if (typeof p.stock !== 'object' || p.stock === null) {
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

  // Handled by `historyLen()` in the rules now, but worth knowing how many of
  // your orders rely on that tolerance rather than on a real timeline.
  if (!Array.isArray(o.statusHistory)) {
    report(
      'orders',
      id,
      'statusHistory',
      `is ${JSON.stringify(o.statusHistory)}, not an array — advanceable only because ` +
        'historyLen() treats absent as empty',
    );
  }
  if (!STATUSES.includes(o.status)) {
    report(
      'orders',
      id,
      'status',
      `is ${JSON.stringify(o.status)}, not one of the six known statuses — staff ` +
        'cannot advance it and the tracker cannot render it',
    );
  }
  // `allow create` requires these; `allow update` does not re-check them, so a
  // legacy order with a float or absent fee is still advanceable. Informational.
  if (!Number.isInteger(o.deliveryFee)) {
    report(
      'orders',
      id,
      'deliveryFee',
      `is ${JSON.stringify(o.deliveryFee)}, not a whole peso — tolerated on update, ` +
        'but a NEW order like this would be refused',
    );
  }
}

console.log(`Auditing live project "${PROJECT_ID}" (read only)...\n`);

const products = await db.collection('products').get();
const orders = await db.collection('orders').get();

console.log(`  ${products.size} products read`);
console.log(`  ${orders.size} orders read`);

for (const d of products.docs) checkProduct(d.id, d.data());
for (const d of orders.docs) checkOrder(d.id, d.data());

if (problems.length === 0) {
  console.log('\nOK. Nothing in the live data would be refused by the current rules.\n');
  process.exit(0);
}

const byCollection = new Map();
for (const p of problems) {
  if (!byCollection.has(p.collection)) byCollection.set(p.collection, []);
  byCollection.get(p.collection).push(p);
}

console.log(`\n${problems.length} problem(s) found:\n`);
for (const [collection, list] of byCollection) {
  console.log(`  ${collection} — ${list.length}`);
  for (const p of list) {
    console.log(`    ${p.id}  ${p.field}: ${p.detail}`);
  }
  console.log('');
}

console.log(
  'The two rules fixes in this commit make the stock and timeline entries\n' +
    'non-blocking (see historyLen() and the narrow stock clause). The rest are\n' +
    'NOT automatic — a staff account cannot advance an order whose status is not\n' +
    'one of the six, and that will keep failing until the data is corrected.\n',
);
process.exit(1);
