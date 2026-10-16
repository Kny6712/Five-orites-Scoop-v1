// scripts/free-emulator-port.mjs
// Five-orites Scoop — make sure nothing is holding the Firestore emulator port
//
// WHY THIS EXISTS
//
// `verify` runs `test:rules` and then `test:integration`. Both use
// `firebase emulators:exec --only firestore`, and on Windows the emulator does
// NOT fully die when `emulators:exec` returns:
//
//   test:rules       -> exits 0, leaves a `java ... cloud-firestore-emulator`
//   test:integration -> "Error: Could not start Firestore Emulator, port taken."
//
// So `npm run verify` could never be green on Windows, and the two suites could
// never run back to back. Reproduced here four times in a row; the orphan is not
// a flake and does not clear itself (waited 45s, still listening).
//
// WHY IT ONLY HAPPENS ON WINDOWS
//
// `emulators:exec` tears the emulator down by signalling its child process tree.
// On Windows a `java.exe` child does not die with its parent the way it does on
// POSIX, so the JVM is reparented and keeps the port. The exit code is still 0 —
// the CLI believes the shutdown worked — so nothing warns and the next suite just
// fails to bind. CI runs `ubuntu-latest` and never sees it.
//
// WHAT IT WILL AND WILL NOT KILL
//
// It kills a process ONLY when all three are true:
//   1. it is LISTENING on the emulator port, and
//   2. its command line names the Firestore emulator jar, and
//   3. it is a java process.
//
// Anything else — a dev's `npm run emulators`, an unrelated server, your IDE —
// is left strictly alone and reported instead. A "port busy" message that names
// the owner is the whole point; silently killing whatever holds a port would be
// a much worse failure than the one this fixes.
//
// HOW TO RUN
//   node scripts/free-emulator-port.mjs          # the configured 8080
//   node scripts/free-emulator-port.mjs 9099     # an explicit port
//
// Exit code is always 0: this is a convenience, never a gate. If the port is
// genuinely held by something else, failing here would just move the error
// message rather than remove it.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** The port `firebase.json` configures, so this script cannot drift from it. */
function configuredPort() {
  try {
    const config = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
    return config?.emulators?.firestore?.port ?? 8080;
  } catch {
    return 8080;
  }
}

const port = Number(process.argv[2]) || configuredPort();

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** Windows: `netstat -ano` prints the PID in the last column of a LISTENING row. */
function listeningPidsWindows(target) {
  const out = run('netstat', ['-ano', '-p', 'TCP']);
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    const local = cols[1] ?? '';
    const pid = Number(cols[cols.length - 1]);
    // `127.0.0.1:8080` — compare the port after the LAST colon, so an IPv6
    // `[::1]:8080` and a plain `0.0.0.0:8080` both match.
    if (local.includes(':') && Number(local.slice(local.lastIndexOf(':') + 1)) === target && pid) {
      pids.add(pid);
    }
  }
  return [...pids];
}

/** POSIX: `lsof -ti` prints bare PIDs, one per line. Absent on Windows. */
function listeningPidsPosix(target) {
  const out = run('lsof', ['-ti', `tcp:${target}`, '-sTCP:LISTEN']);
  return out
    .split(/\r?\n/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function commandLine(pid) {
  if (process.platform === 'win32') {
    const out = run('powershell', [
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
    ]);
    return out;
  }
  return run('ps', ['-p', String(pid), '-o', 'command=']);
}

function kill(pid) {
  if (process.platform === 'win32') {
    // /T kills the tree, /F forces — the JVM ignores a plain terminate while
    // still bound to the port.
    run('taskkill', ['/PID', String(pid), '/T', '/F']);
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

const isWindows = process.platform === 'win32';
const pids = isWindows ? listeningPidsWindows(port) : listeningPidsPosix(port);

if (pids.length === 0) {
  console.log(`Port ${port} is free.`);
  process.exit(0);
}

let killed = 0;
for (const pid of pids) {
  const cmdline = commandLine(pid);
  const isFirestoreEmulator =
    /cloud-firestore-emulator/i.test(cmdline) && (isWindows ? /java/i.test(cmdline) : true);

  if (!isFirestoreEmulator) {
    console.warn(
      `Port ${port} is held by PID ${pid}, which is not the Firestore emulator.\n` +
        `  ${cmdline.trim() || '(command line unavailable)'}\n` +
        `  Left running. Stop it yourself if it is in the way.`,
    );
    continue;
  }

  kill(pid);
  killed += 1;
  console.log(`Freed port ${port}: stopped orphaned Firestore emulator (PID ${pid}).`);
}

// The OS needs a moment to actually release a listening socket. Without this the
// very next `emulators:exec` can still lose the race and fail on a port that is
// closing rather than open.
if (killed > 0) {
  await new Promise((r) => setTimeout(r, 1500));
}

process.exit(0);
