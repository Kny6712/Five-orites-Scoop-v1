// scripts/baseline-ledger.ts
// Five-orites Scoop — give every product an opening balance in the stock ledger
//
// WHY THIS EXISTS
//
// `InventoryService.createProduct` used to write a product's stock straight onto
// the product document and log NOTHING. The CSV importer calls the same method, so
// every seeded product was born with stock the ledger had never seen.
//
// The consequence showed up in the admin integrity panel as a confident,
// meaningless number. Audited against production, the ENTIRE stock ledger was four
// rows, all for one flavour:
//
//   2026-10-03T02:26  +1  balanceAfter=2    admin_restock
//   2026-10-03T16:01  +1  balanceAfter=51   admin_restock
//   2026-10-03T16:05  -2  balanceAfter=49   sale
//   2026-10-04T04:12  -1  balanceAfter=48   manual_adjust
//
// Those rows contradict each other: the oldest says the level became 2, the
// newest says 48. 65 of 66 products had no movement rows at all.
//
// `createProduct` now logs a `stock_intake` opening movement in the same
// transaction as the product write, so new products are covered from birth. This
// script covers the ones that already exist.
//
// WHY IT ADDS ROWS RATHER THAN REPAIRING THEM
//
// `stockMovements` has `allow update, delete: if false` in firestore.rules, and
// that is correct — an audit trail that can be rewritten is not one. Rather than
// delete the four incoherent rows above, this writes a `baseline` row at the
// current level. Reconciliation treats `baseline` and `stock_intake` as EPOCH
// STARTS (`STOCK_REASON_RESET`): everything before the newest such row describes
// a level that row supersedes. So the anchor moves, the arithmetic becomes
// coherent, and the history is preserved rather than destroyed.
//
//   npm run baseline:ledger              # dry run, prints the plan
//   npm run baseline:ledger -- --apply   # writes
//
// DRY RUN IS THE DEFAULT. This writes to an audit trail, and a baseline that
// records the WRONG level is worse than no baseline: it would launder real drift
// into a row that says the drift was fine. Read the dry-run output first.
//
// WHY IT USES THE ADMIN SDK
//
// Because it must be able to write rows the client rules would not allow for a
// one-off migration, and because it needs to read the whole catalogue rather than
// a 200-row window. It needs scripts/serviceAccountKey.json.

import * as admin from 'firebase-admin';
import * as path from 'path';

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, 'serviceAccountKey.json');

/** Mirrors `SIZE_VARIANTS` in src/app/core/logic/stock.ts. */
const SIZES = ['cup', 'pint', 'halfGallon', 'gallon'] as const;

/**
 * Stock values at or above this are a re-stock worth a movement row of its own.
 *
 * Zero is skipped: an opening balance of 0 records nothing, and the catalogue
 * holds enough of them to matter.
 */
const SKIP_BELOW = 0;

/** Firestore refuses more than 500 writes per batch; well under, but explicit. */
const BATCH_SIZE = 400;

interface PlanEntry {
  productId: string;
  variantName: string;
  size: string;
  level: number;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const credential = require(SERVICE_ACCOUNT_PATH);
  admin.initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID });
  const db = admin.firestore();

  const products = await db.collection('products').get();

  // Which product/size pairs ALREADY have an epoch row? Re-baselining is not
  // harmful — it just supersedes itself — but skipping them keeps the script
  // honest about what it actually changed and makes a second run a no-op.
  const movements = await db.collection('stockMovements').get();
  const alreadyAnchored = new Set<string>();
  for (const doc of movements.docs) {
    const d = doc.data() as { productId?: string; size?: string; reason?: string };
    if (d.reason === 'baseline' || d.reason === 'stock_intake') {
      alreadyAnchored.add(`${d.productId}/${d.size}`);
    }
  }

  const plan: PlanEntry[] = [];
  const skipped = { noStock: 0, zero: 0, alreadyAnchored: 0 };

  for (const productDoc of products.docs) {
    const p = productDoc.data() as {
      variantName?: string;
      stock?: Record<string, number> | null;
    };
    const variantName = (p.variantName ?? '').trim() || productDoc.id;
    const stock = p.stock;
    if (!stock) {
      skipped.noStock++;
      continue;
    }
    for (const size of SIZES) {
      const raw = stock[size];
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        skipped.noStock++;
        continue;
      }
      if (raw <= SKIP_BELOW) {
        skipped.zero++;
        continue;
      }
      if (alreadyAnchored.has(`${productDoc.id}/${size}`)) {
        skipped.alreadyAnchored++;
        continue;
      }
      plan.push({ productId: productDoc.id, variantName, size, level: raw });
    }
  }

  console.log(`Products in catalogue : ${products.size}`);
  console.log(`Movement rows present : ${movements.size}`);
  console.log(`Already anchored      : ${alreadyAnchored.size} product/size pairs`);
  console.log(`To write              : ${plan.length} opening balance(s)`);
  console.log(
    `Skipped               : ${skipped.noStock} missing, ${skipped.zero} at zero, ` +
      `${skipped.alreadyAnchored} already anchored`,
  );

  const bySize = new Map<string, number>();
  for (const e of plan) bySize.set(e.size, (bySize.get(e.size) ?? 0) + 1);
  if (bySize.size) {
    console.log('\nBy size:');
    for (const [size, n] of [...bySize].sort()) console.log(`  ${size.padEnd(11)} ${n}`);
  }

  if (!plan.length) {
    console.log('\nNothing to do — every non-zero stock value already has an opening balance.');
    return;
  }

  if (!apply) {
    console.log('\nDRY RUN. Nothing was written. Re-run with --apply to record these levels:');
    console.log('  npm run baseline:ledger -- --apply');
    console.log('\nFirst 15, so the levels can be eyeballed before they become history:');
    for (const e of plan.slice(0, 15)) {
      console.log(`  ${e.variantName.padEnd(30)} ${e.size.padEnd(11)} ${e.level}`);
    }
    if (plan.length > 15) console.log(`  ... and ${plan.length - 15} more`);
    return;
  }

  console.log('\nWriting opening balances…');
  const now = admin.firestore.FieldValue.serverTimestamp();
  let written = 0;

  for (let i = 0; i < plan.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const e of plan.slice(i, i + BATCH_SIZE)) {
      batch.set(db.collection('stockMovements').doc(), {
        productId: e.productId,
        variantName: e.variantName,
        size: e.size,
        // delta is the whole level because before this row the level was, for the
        // purposes of the ledger, zero. The anchor arithmetic is
        // `balanceAfter - delta` then sum forward, which lands on `level`.
        delta: e.level,
        balanceAfter: e.level,
        reason: 'baseline',
        orderId: null,
        // Names the migration rather than a person: there is no uid to attribute
        // this to, and inventing one would put a false actor in the audit trail.
        actorUid: 'baseline-ledger',
        createdAt: now,
      });
    }
    await batch.commit();
    written += Math.min(BATCH_SIZE, plan.length - i);
    process.stdout.write(`\r  ${written}/${plan.length}`);
  }

  console.log(`\n\nWrote ${written} opening balance(s).`);
  console.log('Run the reconciliation check in admin > Settings > Stock integrity to confirm.');
}

main().catch((err: unknown) => {
  console.error('Baseline failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
