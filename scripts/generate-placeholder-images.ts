// scripts/generate-placeholder-images.ts
// Five-orites Scoop — per-flavor placeholder art
//
// WHY THIS EXISTS
// `seed-products.ts` writes `imageUrl: ''` for all 64 products, so every card
// and product page rendered the same generic `placeholder-scoop.svg`. Cloudinary
// is fully wired and correct but entirely unused, because the uploader's source
// folder was a hardcoded `D:\...` path that resolves nowhere else. A storefront
// of 64 identical placeholders reads as broken, so this generates one distinct
// image per flavor, deterministically, from the catalog itself.
//
// These are clearly stylised placeholders, not photography. To use real photos:
// drop them in assets/images/ and run `npm run upload:images`.
//
// Run: npx ts-node --project scripts/tsconfig.json scripts/generate-placeholder-images.ts
// or:  npm run images:generate

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PRODUCT_CATALOG } from './seed-products';

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, 'assets', 'images');
const WIDTH = 400;
const HEIGHT = 300;

/** Deterministic hash so a given flavor always gets the same palette. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Two-tone palette derived from the flavor name, kept light enough for text. */
function palette(seed: string): { bg: string; scoop: string; accent: string } {
  const h = hash(seed);
  const hue = h % 360;
  const hue2 = (hue + 40 + (h % 50)) % 360;
  return {
    bg: `hsl(${hue}, 70%, 92%)`,
    scoop: `hsl(${hue}, 62%, 74%)`,
    accent: `hsl(${hue2}, 55%, 62%)`,
  };
}

function svgFor(variantName: string, setName: string, setNumber: number): string {
  const { bg, scoop, accent } = palette(variantName);
  const cx = 200 + ((hash(variantName) % 40) - 20);
  const r1 = 58 + (hash(setName) % 10);
  const label = variantName.replace(/[<>&"']/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${label}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${bg}"/>
  <circle cx="${cx}" cy="118" r="${r1}" fill="${scoop}"/>
  <circle cx="${cx - 30}" cy="96" r="20" fill="${accent}" opacity="0.85"/>
  <circle cx="${cx + 28}" cy="100" r="17" fill="${accent}" opacity="0.7"/>
  <path d="M150 140 h100 l-50 96 z" fill="hsl(35,55%,62%)"/>
  <path d="M150 140 h100 l-10 18 h-80 z" fill="hsl(35,45%,50%)" opacity="0.35"/>
  <text x="200" y="272" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="20" font-weight="bold" fill="hsl(${hash(setName) % 360},35%,32%)">${label}</text>
  <text x="200" y="290" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="12" fill="hsl(0,0%,45%)">Set ${setNumber} · ${setName.replace(/[<>&"']/g, '')}</text>
</svg>
`;
}

/** Filesystem-safe name, e.g. "Classic Mango Sorbet" -> "classic-mango-sorbet". */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
for (const product of PRODUCT_CATALOG) {
  const file = path.join(OUT_DIR, `${slugify(product.variantName)}.svg`);
  fs.writeFileSync(file, svgFor(product.variantName, product.setName, product.setNumber), 'utf8');
  written++;
}

console.log(`Wrote ${written} placeholder images to ${path.relative(ROOT, OUT_DIR)}`);
console.log('Seed them with:  npm run images:seed');
