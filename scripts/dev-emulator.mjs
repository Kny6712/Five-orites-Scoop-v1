// scripts/dev-emulator.mjs
// Five-orites Scoop — bring up a complete local sandbox in one command
//
// WHY THIS EXISTS
//
// The pieces already existed and did not compose. `npm run emulators` starts the
// Firestore and Auth emulators, `npm run seed` fills Firestore, `npm start` serves
// the app — and getting the ORDER right, knowing the seed needs
// `FIRESTORE_EMULATOR_HOST` set, and knowing the app needs the `emulator` build
// configuration, was three pieces of knowledge that existed only in the head of
// whoever last did it.
//
// That is precisely the state that leads someone to skip the emulator and run
// `npm run start:prod` against live data. Removing the need to remember is the
// fix; the ordering being documented in a README is not.
//
// WHAT IT DOES, IN ORDER
//   1. `firebase emulators:start` (Firestore 8080, Auth 9099)
//   2. waits for the Firestore emulator to answer on 8080
//   3. seeds products into it, with NO credentials — the emulator does not accept
//      them and does not need them
//   4. `ng serve --configuration emulator`
//
// CLOUDINARY IS STILL REAL. There is no Cloudinary emulator, so a photo uploaded
// through this sandbox lands in the real media library and the URL that comes back
// is stored in the local Firestore. The README says so. Redirecting it would mean
// standing up a stub for an unsigned-preset upload endpoint, which is more
// machinery than the problem deserves.
//
// Ctrl-C tears the emulator down with it.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const FIRESTORE_PORT = 8080;
const AUTH_PORT = 9099;

const children = [];

function run(label, command, args, env) {
  console.log(`\n=== ${label} ===`);
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  console.log('\nShutting down…');
  for (const c of children) {
    try {
      // The emulator needs a moment to flush; SIGKILL here loses the export dir.
      c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 1200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// ── 1. emulators ────────────────────────────────────────────────────────────
const emulators = run('Firebase emulators (firestore + auth)', 'npx', [
  'firebase',
  'emulators:start',
  '--project',
  'demo-five-orites-scoop',
]);
emulators.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`\nEmulators exited with ${code}.`);
    shutdown(code);
  }
});

// ── 2. wait for Firestore ───────────────────────────────────────────────────
process.stdout.write('\nWaiting for the Firestore emulator');
let ready = false;
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    const r = await fetch(
      `http://localhost:${FIRESTORE_PORT}/v1/projects/demo-five-orites-scoop/databases/(default)/documents`,
    );
    // Any HTTP answer means it is listening; 403/401 would mean "up but unhappy",
    // which is still up.
    if (r.status > 0) {
      ready = true;
      break;
    }
  } catch {
    /* not listening yet */
  }
  process.stdout.write('.');
  await sleep(500);
}
process.stdout.write('\n');

if (!ready) {
  console.error(
    `The Firestore emulator never came up on port ${FIRESTORE_PORT}.\n` +
      `Is something already using it? Try: firebase emulators:start --only firestore,auth`,
  );
  shutdown(1);
} else {
  console.log(`Firestore emulator is up on ${FIRESTORE_PORT}.`);
}

// ── 3. seed ─────────────────────────────────────────────────────────────────
// No credentials: the emulator accepts unauthenticated Admin SDK writes and
// REJECTS a real service account, so passing one would fail rather than help.
console.log('\nSeeding the emulator (no credentials — it must not be given any)…');
const seed = spawn(
  'npx',
  ['ts-node', '--project', 'scripts/tsconfig.json', 'scripts/seed-products.ts'],
  {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: `localhost:${FIRESTORE_PORT}`,
      FIREBASE_PROJECT_ID: 'demo-five-orites-scoop',
    },
  },
);

const seedCode = await new Promise((resolve) => {
  seed.on('exit', resolve);
  seed.on('error', () => resolve(1));
});

if (seedCode !== 0) {
  console.error('\nSeeding failed. The app will still start, with an empty catalogue.');
} else {
  console.log('\nSeed complete.');
}

// ── 4. the app ──────────────────────────────────────────────────────────────
console.log(
  '\n=== Angular dev server (emulator configuration) ===\n' +
    '  Firestore  localhost:' +
    FIRESTORE_PORT +
    '   (local, discarded on exit)\n' +
    '  Auth       localhost:' +
    AUTH_PORT +
    '\n' +
    '  Nothing here touches production. Cloudinary is NOT emulated.\n',
);
run('ng serve', 'npx', ['ng', 'serve', '--configuration', 'emulator']);

console.log(
  '\nSandbox running. Create an account in the Auth emulator UI at http://localhost:4000',
);
console.log('to sign in, then give it a role — the emulator rules require it.');
