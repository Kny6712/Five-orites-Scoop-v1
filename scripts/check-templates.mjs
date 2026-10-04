// scripts/check-templates.mjs
// Five-orites Scoop — Angular TEMPLATE type-check.
//
// WHY THIS EXISTS
// `npm run typecheck` runs `tsc`, which does NOT look at templates. Every
// `[prop]="expr"` and `(event)="handler()"` binding — the whole `<app-pagination>`
// integration, every `@if`/`@for` block, and every icon name — was therefore
// unchecked by CI. `ngc`, the Angular compiler, checks them under
// `strictTemplates: true`.
//
// Node rather than PowerShell on purpose: this has to run on a Windows dev box
// (Windows PowerShell 5.1, no `pwsh`) AND on the `ubuntu-latest` CI runner, and a
// shell script can only be relied on for one of those.
//
// PASS/FAIL IS THE EXIT CODE, NOT A TEXT MATCH. An earlier version of this file
// grepped ngc's output for `error TS`. That is wrong twice over: `ngc` colour-codes
// its diagnostics as `error<ESC>[0m<ESC>[90m TS2322:`, so the literal text "error
// TS" never appears and the grep matches NOTHING — reporting success while the
// build was red, twice, during development. Trusting the exit code removes a whole
// class of silent false pass; the ANSI stripping below is only for making the
// failure legible.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Run the ngc entry with the current Node binary rather than through the `.cmd`
// shim or `npx`. The shim is a batch file (Windows-only, and `shell: true`
// concatenates arguments unescaped — Node DEP0190), and `npx` resolves differently
// per platform. `process.execPath` plus the resolved JS entry behaves the same on
// both runners.
const NGC = join('node_modules', '@angular', 'compiler-cli', 'bundles', 'src', 'bin', 'ngc.js');
if (!existsSync(NGC)) {
  console.error(`[templates] cannot find ${NGC} — run npm ci first.`);
  process.exit(1);
}

const proc = spawnSync(process.execPath, [NGC, '-p', 'tsconfig.app.json', '--noEmit'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

// Display only. Strips CSI sequences and the bare ESC that some tools emit.
const strip = (s) =>
  (s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;?]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(//g, '');

const label = process.argv[2] ?? 'templates';
const clean = strip(`${proc.stdout ?? ''}${proc.stderr ?? ''}`);
const failed = proc.status !== 0;

if (failed) {
  // Keep the diagnostic lines, which ngc prints one per error, and drop the rest.
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '');
  const first = lines.findIndex((l) => /error TS\d+/.test(l));
  console.log(`[${label}] TEMPLATE CHECK FAILED`);
  console.log(lines.slice(Math.max(0, first), Math.max(0, first) + 40).join('\n'));
  process.exit(1);
}

console.log(`[${label}] template check clean`);
