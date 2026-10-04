// Repairs UTF-8 text that was decoded as windows-1252 and written back out.
// Reverses: bytes -> (mis)decoded as cp1252 -> string -> re-encoded as UTF-8.
import { readFileSync, writeFileSync } from 'node:fs';

// The 0x80-0x9F block is the only part of cp1252 that differs from latin1, and
// it is exactly where the damage concentrates: box-drawing dashes, curly quotes,
// ellipsis and the euro all live there.
const CP1252_HIGH = [
  0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0xfffd, 0x017d, 0xfffd, 0xfffd, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0xfffd, 0x017e, 0x0178,
];

// codepoint -> byte. Built from the table rather than checked by range, because
// the damaged characters sit ABOVE 0xFF (an em dash is U+2014, not U+94) — a
// range test looks for the byte values and finds nothing there.
const HIGH_TO_BYTE = new Map();
for (let i = 0; i < CP1252_HIGH.length; i++) {
  const cp = CP1252_HIGH[i];
  if (cp !== 0xfffd) HIGH_TO_BYTE.set(cp, 0x80 + i);
}

function cp1252ToBytes(str) {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) {
      out.push(cp);
    } else if (HIGH_TO_BYTE.has(cp)) {
      out.push(HIGH_TO_BYTE.get(cp));
    } else {
      return null; // A genuine non-cp1252 char — this file is not wholly mojibake.
    }
  }
  return Buffer.from(out);
}

function looksMojibake(s) {
  return /â|Ã|Å|ð|ï¿½|Â/.test(s);
}

function decodeOnce(str) {
  const bytes = cp1252ToBytes(str);
  if (!bytes) return null;
  const decoded = bytes.toString('utf8');
  // If the round trip produced U+FFFD it was not valid UTF-8 to begin with.
  if (decoded.includes('\uFFFD')) return null;
  return decoded;
}

function repair(str) {
  let cur = str;
  // Two passes: dashboard.page.scss was already broken once and got broken again.
  for (let i = 0; i < 3; i++) {
    if (!looksMojibake(cur)) break;
    const next = decodeOnce(cur);
    if (!next || next === cur) break;
    cur = next;
  }
  return cur;
}

const files = process.argv.slice(2);
let touched = 0;
for (const f of files) {
  const original = readFileSync(f, 'utf8');
  if (!looksMojibake(original)) continue;
  const fixed = repair(original);
  if (fixed !== original) {
    writeFileSync(f, fixed, 'utf8');
    touched++;
    const before = (original.match(/â|Ã/g) || []).length;
    const after = (fixed.match(/â|Ã/g) || []).length;
    console.log(`FIXED ${f}  (suspect chars ${before} -> ${after})`);
  } else {
    console.log(`SKIP  ${f}  (no clean repair found)`);
  }
}
console.log(`\n${touched} file(s) repaired.`);
