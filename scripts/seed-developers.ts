// scripts/seed-developers.ts
// Five-orites Scoop — publish the credits page to Firestore
//
// WHY THIS EXISTS
//
// The five team credits were five object literals inside `DevelopersPage`, which
// meant a misspelled name or a replaced photo was a developer task — a rebuild and
// a deploy — when the person who most needs to fix it is the owner. They are
// Firestore documents now, editable from `/admin/developers`.
//
// This script moves the existing five across, so nothing has to be retyped and
// nothing is lost. It is IDEMPOTENT: each document is written at a FIXED id
// derived from the name, so running it twice updates rather than duplicates, and
// running it after someone has already edited a record in the app will OVERWRITE
// those edits back to the shipped values. That is why the script prints what it is
// about to do and why `--force` is required for a second run against a live
// project — the alternative, a fresh auto-id per run, would create five duplicate
// credits on every invocation.
//
//   npm run seed:developers
//   npm run seed:developers -- --force
//
// Credentials come from scripts/serviceAccountKey.json, same as the other seeders.

import * as admin from 'firebase-admin';
import * as path from 'path';
import { DEFAULT_DEVELOPERS } from '../src/app/core/models/developer.model';

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, 'serviceAccountKey.json');

/**
 * A stable document id from a name.
 *
 * Stable because the script has to be idempotent (see the header). Slugged
 * because a Firestore document id cannot contain a slash, and a name cannot be
 * trusted to avoid one.
 */
function idFor(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  const credential = require(SERVICE_ACCOUNT_PATH);
  admin.initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID });
  const db = admin.firestore();
  const col = db.collection('developers');

  const existing = await col.get();
  if (!existing.empty && !force) {
    console.error(
      `developers already holds ${existing.size} document(s).`,
      '',
      'This script OVERWRITES records to the values in developer.model.ts, which',
      'discards anything edited in the app. Re-run with --force if that is what you',
      'want. To check what is there first, run:',
      '',
      "  node -e \"const a=require('firebase-admin');a.initializeApp({credential:",
      "    require('./scripts/serviceAccountKey.json')});",
      "  a.firestore().collection('developers').get().then(s=>",
      '    s.docs.forEach(d=>console.log(d.id, JSON.stringify(d.data()))))"',
      '',
      'To edit a record without resetting the others, use /admin/developers.',
    );
    process.exit(1);
  }

  console.log(`Writing ${DEFAULT_DEVELOPERS.length} credit(s) to developers:\n`);
  for (const dev of DEFAULT_DEVELOPERS) {
    const id = idFor(dev.name);
    await col.doc(id).set(
      {
        name: dev.name,
        roles: dev.roles,
        accent: dev.accent,
        photoURL: dev.photoURL,
        order: dev.order,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'seed-developers',
      },
      { merge: true },
    );
    console.log(`  ${id.padEnd(34)} ${dev.name}`);
  }

  console.log('\nDone. Open /admin/developers to edit these without the console.');
}

main().catch((err: unknown) => {
  console.error('Seeding failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
