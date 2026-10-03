// scripts/seed-admin.ts
// Five-orites Scoop — Promote an existing account to a staff role
//
// WHY THIS EXISTS
// `firestore.rules` is `allow create: if ... && request.resource.data.role ==
// 'customer'`, so no client can create itself an admin — which is correct and
// deliberate. But it means the FIRST admin has to be promoted out of band: sign
// in, then open the Firebase console and hand-edit a `users/{uid}` document.
//
// That is the documented bootstrap today, and it has a documented failure mode.
// A role typed as "owner\n" (a trailing newline from a console paste) matches no
// tier, so the owner silently loses every admin page with no error anywhere — see
// tests/logic.test.ts and the emulator test 'a role of "owner\n" gets NOTHING'.
// Recovery was another manual console edit.
//
// This script does that promotion properly: it validates the role against the
// same vocabulary the client and the rules use, and refuses anything malformed
// before writing.
//
// IT DOES NOT CREATE ACCOUNTS
// The account must already exist, because a Firebase Auth user document is
// created by the app on first sign-in. Sign in once through the app (or through
// the Firebase console) so `users/{uid}` exists, then run this.
//
//   npm run seed:admin -- <uid> [role]
//
// Credentials come from scripts/serviceAccountKey.json, same as the other seeders.

const admin = require('firebase-admin');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, 'serviceAccountKey.json');

/**
 * The five roles, mirrored from src/app/core/models/user.model.ts.
 *
 * Duplicated deliberately, and validated against the real model by a test in
 * tests/logic.test.ts — the same arrangement as the delivery constants, for the
 * same reason. A script that accepted a role the rules did not know would write
 * an account that can authenticate and see nothing, which is the exact silent
 * failure this script exists to prevent.
 */
const ROLES = ['customer', 'staff', 'manager', 'admin', 'owner'] as const;
type Role = (typeof ROLES)[number];

/** Only owner may manage the user directory, so promoting to owner is deliberate. */
const DEFAULT_ROLE: Role = 'admin';

let firestore: any;
function getDb() {
  if (!firestore) {
    const serviceAccount = require(SERVICE_ACCOUNT_PATH);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firestore = admin.firestore();
  }
  return firestore;
}

/**
 * Parses argv without depending on a CLI library.
 *
 * Rejects anything that is not exactly a known role, including a role with
 * surrounding whitespace. That strictness is the whole point: "owner " and
 * "owner\n" are the failure this script was written to make impossible, and a
 * silent `.trim()` would just move the problem to the next person who forgets.
 */
function parseRole(raw: string | undefined): Role {
  if (raw === undefined) return DEFAULT_ROLE;
  if (!(ROLES as readonly string[]).includes(raw)) {
    throw new Error(
      `"${raw}" is not a valid role.\n` +
        `  Valid roles: ${ROLES.join(', ')}\n` +
        `  Roles are matched EXACTLY. A trailing space or newline is rejected on ` +
        `purpose -- "owner\\n" matches no tier in firestore.rules and silently ` +
        `hides every admin page.`,
    );
  }
  return raw as Role;
}

async function promote(uid: string, role: Role): Promise<void> {
  const db = getDb();
  const ref = db.doc(`users/${uid}`);

  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`\nNo user document at users/${uid}.`);
    console.error(
      'Sign in through the app once first — that is what creates the document.\n' +
        'Check the uid in the Firebase console: Authentication -> your user -> UID.',
    );
    process.exitCode = 1;
    return;
  }

  const before = snap.data() as { role?: string; email?: string };
  console.log(`Found users/${uid}${before.email ? ` (${before.email})` : ''}`);
  console.log(`  role: ${JSON.stringify(before.role)} -> ${JSON.stringify(role)}`);

  if (before.role === role) {
    console.log('\nAlready that role. Nothing written.');
    return;
  }

  await ref.update({ role, updatedAt: new Date() });
  console.log(`\nDone. Sign out and back in — the role is read from the user document on load.`);
}

async function main(): Promise<void> {
  const [uid, rawRole] = process.argv.slice(2);

  if (!uid) {
    console.error(
      'Usage: npm run seed:admin -- <uid> [role]\n' +
        `  uid   the Firebase Auth UID of an EXISTING account\n` +
        `  role  one of: ${ROLES.join(', ')} (default: ${DEFAULT_ROLE})`,
    );
    process.exitCode = 1;
    return;
  }

  const role = parseRole(rawRole);
  await promote(uid, role);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
