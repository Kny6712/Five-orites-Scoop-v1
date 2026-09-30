// scripts/upload-product-images.ts
// Five-orites Scoop — upload the product photo library to Cloudinary and
// (optionally) write the resulting URLs into Firestore.
//
// Run:  npm run upload:images                          (dry run — prints the mapping only)
//       npm run upload:images -- --upload
//       npm run upload:images -- --upload --write
//       npm run upload:images -- --upload --write --force
//       npm run upload:images -- --from-manifest --write   (reuse the last upload's URLs)
//
// Flags
//   --upload         actually upload to Cloudinary (default is a dry run)
//   --write          write imageUrl into the matching Firestore product docs
//   --force          overwrite an imageUrl that an admin has already set
//   --from-manifest  skip uploading; reuse scripts/image-urls.json from a previous run
//   --dir=...        override the source folder
//
// Uploading needs no secret: the Cloudinary upload preset is Unsigned, so the
// only values used here are the public cloud name + preset name. Firestore
// writes need scripts/serviceAccountKey.json, same as `npm run seed`.

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
/**
 * Default source folder for product photos.
 *
 * This used to be the absolute path `D:\icecream\icecream\Images`, which could
 * only ever resolve on the machine it was written on. Every other checkout
 * silently fell back to rendering the placeholder, which is how all 64 seeded
 * products ended up imageless. It now defaults to a folder inside the repo and
 * can be overridden with `--dir=...` or the IMAGE_DIR environment variable.
 */
const DEFAULT_IMAGE_DIR = path.resolve(ROOT, 'assets', 'images');
const CLOUDINARY_FOLDER = 'five-orites-scoop/products';

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const argValue = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const DO_UPLOAD = flag('upload');
const DO_WRITE = flag('write');
const FORCE = flag('force');
const FROM_MANIFEST = flag('from-manifest');
const IMAGE_DIR = argValue('dir') ?? process.env.IMAGE_DIR ?? DEFAULT_IMAGE_DIR;

/**
 * Folder number -> app set number.
 *
 * These were briefly out of step: the photo folders were numbered
 * "Set 6 Coffee" / "Set 7 Mint" while the app has always had
 * SET_NAMES 6 = Mint, 7 = Coffee. The folders were renamed to match, so this
 * is now a straight 1:1 map. It is kept explicit (rather than assumed) so a
 * future renumbering shows up here instead of silently mislabeling photos.
 */
const SET_FOLDER: Record<number, string> = {
  1: 'Set 1 Chocolate',
  2: 'Set 2 Vanilla',
  3: 'Set 3 Strawberry',
  4: 'Set 4 Mango',
  5: 'Set 5 Ube',
  6: 'Set 6 Mint',
  7: 'Set 7 Coffee',
  8: 'Set 8 C&C',
};

type Pairing = { set: number; variant: string; file: string };

/**
 * variantName -> photo filename, per set. Hand-verified against the catalog
 * in scripts/seed-products.ts; every one of the 64 has exactly one photo.
 */
const PHOTOS: Pairing[] = [
  // Set 1 · Chocolates
  { set: 1, variant: 'Chocolate Fudge Brownie', file: 'Fudge.jpg' },
  { set: 1, variant: 'Double Dark Chocolate', file: 'Double dark.jpg' },
  { set: 1, variant: 'Chocolate Therapy', file: 'chocolate-ice-cream.jpg' },
  { set: 1, variant: 'Mexican Chocolate', file: 'Mexican.jpg' },
  { set: 1, variant: 'Phish Food Style', file: 'Phish.jpg' },
  { set: 1, variant: 'Rocky Road', file: 'Rocky road.jpg' },
  { set: 1, variant: 'Chocolate Peanut Butter Cup', file: 'chocolate-pb-icecream-7.jpg' },
  { set: 1, variant: 'New York Super Fudge Chunk', file: 'New york.jpg' },

  // Set 2 · Vanilla
  { set: 2, variant: 'Classic Madagascar Vanilla', file: 'Madagascar_.jpg' },
  { set: 2, variant: 'Vanilla Bean Supreme', file: 'VanillaBeanIC_Hero.jpg' },
  { set: 2, variant: 'French Vanilla Custard', file: 'Custard_.jpg' },
  { set: 2, variant: 'Vanilla Cookie Crumble', file: 'Cookie crumble.jpg' },
  { set: 2, variant: 'Vanilla Caramel Swirl', file: 'Caramel swirl.jpg' },
  { set: 2, variant: 'Tahitian Vanilla Bourbon', file: 'Tahitian.webp' },
  { set: 2, variant: 'Vanilla Toffee Crunch', file: 'Toffee.jpg' },
  { set: 2, variant: 'Vanilla Honeycomb', file: 'Honeycomb.jpg' },

  // Set 3 · Strawberry
  { set: 3, variant: 'Strawberry Cheesecake', file: 'strawberry-cheesecake-cottage-cheese-ice-cream-thumb.jpg' },
  { set: 3, variant: 'Strawberry Shortcake', file: 'Regular strawberry.jpg' },
  { set: 3, variant: 'Wild Strawberry Swirl', file: 'Wild swirl.jpg' },
  { set: 3, variant: 'Strawberry Balsamic', file: 'Balsamic.jpg' },
  { set: 3, variant: 'Strawberry Fields Forever', file: 'Fields forever.jpg' },
  { set: 3, variant: 'Strawberry Yogurt Blend', file: 'Yogurt.jpg' },
  { set: 3, variant: 'Strawberry Basil', file: 'Basil.jpg' },
  { set: 3, variant: 'Strawberry Cream Delight', file: 'Cream delight.jpg' },

  // Set 4 · Mango
  { set: 4, variant: 'Classic Mango Sorbet', file: 'Sorbet Classic mango.jpg' },
  { set: 4, variant: 'Mango Graham', file: 'Graham.jpg' },
  { set: 4, variant: 'Mango Sticky Rice', file: 'mango-sticky-rice-ice-cream-featured.jpg' },
  { set: 4, variant: 'Mango Chili Lime', file: 'mango-chili-lime-ice-cream-tropical-flavor-sweet-fresh-hint-heat-325460269.jpg' },
  { set: 4, variant: 'Mango Coconut Cream', file: 'Mango-Coconut-Nice-Cream.jpg' },
  { set: 4, variant: 'Mango Cheesecake', file: 'Cheesecake.jpg' },
  { set: 4, variant: 'Mango Tango Twist', file: 'Twist.jpg' },
  { set: 4, variant: 'Mango Passionfruit', file: 'Passionfruit.jpg' },

  // Set 5 · Ube
  { set: 5, variant: 'Classic Ube Halaya', file: 'Ube-Ice-Cream-SM-8065.jpg' },
  { set: 5, variant: 'Ube Cheese', file: 'Cheese.jpg' },
  { set: 5, variant: 'Ube Macapuno', file: 'Macapuno.jpg' },
  { set: 5, variant: 'Ube Coconut Swirl', file: 'Coconut swirl.jpg' },
  { set: 5, variant: 'Ube Cookies and Cream', file: 'ube-oreo-ice-cream.jpg' },
  { set: 5, variant: 'Ube Leche Flan', file: 'Leche flan.jpg' },
  { set: 5, variant: 'Ube Pandan Fusion', file: 'Pandan.jpg' },
  { set: 5, variant: 'Ube Halo-Halo Style', file: 'Halo-halo-1.jpg' },

  // Set 6 · Mint
  { set: 6, variant: 'Mint Chocolate Chip', file: 'mint choco chip.jpg' },
  { set: 6, variant: 'Mint Fudge Swirl', file: 'mint fudge.jpg' },
  { set: 6, variant: 'Mint Oreo Crumble', file: 'mint oreo crumble.jpg' },
  { set: 6, variant: 'Mint Chocolate Cookie', file: 'mint chocolate cookie icecream.jpg' },
  { set: 6, variant: 'Peppermint Bark', file: 'ppermint bark icecream.jpg' },
  { set: 6, variant: 'Mint Cheesecake', file: 'mint creamcheese.webp' },
  { set: 6, variant: 'Mint Brownie Batter', file: 'mint brownie.jpg' },
  { set: 6, variant: 'Mint Coconut Twist', file: 'mint coconut icecream.webp' },

  // Set 7 · Coffee
  { set: 7, variant: 'Classic Coffee Bean', file: 'Copy of coffee bean.jpg' },
  { set: 7, variant: 'Mocha Almond Fudge', file: 'Copy of mocha almond fudge.jpg' },
  { set: 7, variant: 'Cappuccino Crunch', file: 'Copy of cappucino icecream.webp' },
  { set: 7, variant: 'Coffee Caramel Swirl', file: 'Copy of coffee caramel icecream.jpg' },
  { set: 7, variant: 'Tiramisu Style', file: 'Copy of tiramisu ice cream.jpg' },
  { set: 7, variant: 'Coffee Toffee Bar', file: 'Copy of coffee tofee icecream.jpg' },
  { set: 7, variant: 'Vietnamese Coffee', file: 'Copy of vietnamese coffee icecream.png' },
  { set: 7, variant: 'Coffee Chocolate Chip', file: 'Copy of coffee chocolate.jpg' },

  // Set 8 · Cookies & Cream
  { set: 8, variant: 'Classic Cookies and Cream', file: 'Copy of cookies and cream classic.jpg' },
  { set: 8, variant: 'Double Stuffed Cookie', file: 'Copy of double stuffed cookie.jpg' },
  { set: 8, variant: 'Cookie Butter Swirl', file: 'Copy of cookie butter swirl.webp' },
  { set: 8, variant: 'Cookies and Caramel', file: 'Copy of Cookies and Caramel.png' },
  { set: 8, variant: 'Chocolate Chip Cookie Dough', file: 'Copy of choco cookie chip.webp' },
  { set: 8, variant: 'Birthday Cake Cookie', file: 'Copy of Birrthday cake cookie.jpg' },
  { set: 8, variant: 'Cookies and Cream Fudge', file: 'Copy of cookies and cream fudge.jpg' },
  { set: 8, variant: 'Peanut Butter Cookie Crunch', file: 'Copy of peanut butter cookie crunch.jpg' },
];

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Mirrors the slug rule in scripts/seed-products.ts. */
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Reads cloudName/uploadPreset from the real environment file so the script
 * can never drift from the app. Falls back to a text scrape if the module
 * cannot be loaded (the scripts tsconfig is nodenext/CommonJS).
 */
async function loadCloudinaryConfig(): Promise<{ cloudName: string; uploadPreset: string }> {
  const envPath = path.join(ROOT, 'src', 'environments', 'environment.ts');
  try {
    const mod: any = await import(envPath);
    const c = mod.environment?.cloudinary;
    if (c?.cloudName && c?.uploadPreset) {
      return { cloudName: c.cloudName, uploadPreset: c.uploadPreset };
    }
  } catch {
    // fall through to the text scrape
  }
  const text = fs.readFileSync(envPath, 'utf8');
  const m = text.match(/cloudinary\s*:\s*\{[\s\S]*?cloudName\s*:\s*['"]([^'"]+)['"][\s\S]*?uploadPreset\s*:\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error(`Could not read cloudinary config from ${envPath}`);
  return { cloudName: m[1], uploadPreset: m[2] };
}

type Resolved = Pairing & { absPath: string; bytes: number };

/**
 * Reuses the URLs from a previous run's manifest instead of re-uploading.
 *
 * Every upload mints a new Cloudinary version, so a plain --upload --write would
 * push all 64 files again and leave 64 redundant derived assets behind for no
 * gain. The photos are already in the cloud; only the Firestore write is left.
 */
function loadManifest(): { set: number; variant: string; url: string }[] {
  const manifestPath = path.join(__dirname, 'image-urls.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Manifest not found: ${manifestPath}\n` +
      '  Run `npm run upload:images -- --upload` once to create it, or drop --from-manifest.'
    );
  }
  const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`Manifest is empty or malformed: ${manifestPath}`);
  }
  const bad = entries.filter(
    (e: any) => typeof e?.url !== 'string' || !/^https?:\/\//.test(e.url)
  );
  if (bad.length) {
    throw new Error(`${bad.length} manifest entr(ies) have no usable url. Re-run with --upload.`);
  }
  return entries.map((e: any) => ({ set: e.set, variant: e.variant, url: e.url }));
}

function resolveFiles(): { resolved: Resolved[]; missing: string[]; unused: string[] } {
  const resolved: Resolved[] = [];
  const missing: string[] = [];
  const used = new Set<string>();

  for (const p of PHOTOS) {
    const folder = SET_FOLDER[p.set];
    if (!folder) {
      missing.push(`[set ${p.set}] no folder mapped`);
      continue;
    }
    const absPath = path.join(IMAGE_DIR, folder, p.file);
    if (!fs.existsSync(absPath)) {
      missing.push(`Set ${p.set} → ${p.variant} → ${p.file} (not found in ${folder})`);
      continue;
    }
    used.add(path.resolve(absPath).toLowerCase());
    resolved.push({ ...p, absPath, bytes: fs.statSync(absPath).size });
  }

  const unused: string[] = [];
  for (const [set, folder] of Object.entries(SET_FOLDER)) {
    const dir = path.join(IMAGE_DIR, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.resolve(dir, name);
      if (fs.statSync(full).isFile() && !used.has(full.toLowerCase())) {
        unused.push(`Set ${set} → ${name}`);
      }
    }
  }
  return { resolved, missing, unused };
}

async function uploadOne(cfg: { cloudName: string; uploadPreset: string }, item: Resolved) {
  const bytes = fs.readFileSync(item.absPath);
  const mime = MIME[path.extname(item.absPath).toLowerCase()] ?? 'application/octet-stream';
  const publicId = `set-${item.set}-${slugify(item.variant)}`;

  const send = async (withPublicId: boolean) => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime }), path.basename(item.absPath));
    form.append('upload_preset', cfg.uploadPreset);
    form.append('folder', CLOUDINARY_FOLDER);
    if (withPublicId) form.append('public_id', publicId);
    return fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, {
      method: 'POST',
      body: form,
    });
  };

  let res = await send(true);
  // Some presets forbid a client-supplied public_id; fall back to auto-naming.
  if (!res.ok) res = await send(false);

  const json: any = await res.json();
  if (!res.ok || !json.secure_url) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return { url: json.secure_url as string, publicId: (json.public_id as string) ?? '' };
}

async function writeToFirestore(entries: { set: number; variant: string; url: string }[]) {
  const keyPath = path.join(__dirname, 'serviceAccountKey.json');
  if (!fs.existsSync(keyPath)) {
    throw new Error(
      'scripts/serviceAccountKey.json is missing.\n' +
      '  Download it from Firebase Console → Project Settings → Service Accounts,\n' +
      '  rename it to serviceAccountKey.json and place it in scripts/.'
    );
  }
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
  const db = admin.firestore();
  const productsCol = db.collection('products');

  let updated = 0;
  let skipped = 0;
  const notFound: string[] = [];

  for (const e of entries) {
    // The seeder writes deterministic ids, so try that first; products added
    // later through the admin UI have auto ids, so fall back to a query.
    const docId = `set${e.set}_${slugify(e.variant)}`;
    let snap = await productsCol.doc(docId).get();
    if (!snap.exists) {
      const q = await productsCol
        .where('setNumber', '==', e.set)
        .where('variantName', '==', e.variant)
        .limit(1)
        .get();
      if (!q.empty) snap = q.docs[0];
    }

    if (!snap.exists) {
      notFound.push(`Set ${e.set} · ${e.variant}`);
      continue;
    }
    const current = snap.data()?.imageUrl;
    if (current && !FORCE) {
      skipped++;
      continue;
    }
    await snap.ref.update({ imageUrl: e.url, updatedAt: new Date().toISOString() });
    updated++;
  }

  return { updated, skipped, notFound };
}

async function main() {
  console.log('\n🍦  Five-orites Scoop — Product Image Uploader');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📁  Source:  ${IMAGE_DIR}`);
  console.log(`🔍  Mode:    ${FROM_MANIFEST ? (DO_WRITE ? 'MANIFEST + WRITE' : 'MANIFEST (no upload, no write)') : DO_UPLOAD ? (DO_WRITE ? 'UPLOAD + WRITE' : 'UPLOAD ONLY') : 'DRY RUN (nothing will be sent)'}`);
  console.log(`📄  Pairs:   ${PHOTOS.length}\n`);

  // --from-manifest never touches local files, so the whole photo-folder audit
  // is skipped: it only needs URLs a previous run already produced.
  let resolved: Resolved[] = [];

  if (!FROM_MANIFEST) {
    if (!fs.existsSync(IMAGE_DIR)) {
      throw new Error(`Source folder not found: ${IMAGE_DIR}\n  Override with --dir="C:\\path\\to\\folder"`);
    }

    const audit = resolveFiles();
    resolved = audit.resolved;
    if (audit.missing.length) {
      console.log('❌  Missing files:');
      for (const m of audit.missing) console.log(`     · ${m}`);
      console.log('');
    }
    if (audit.unused.length) {
      console.log('ℹ️  Photos with no product (will be skipped):');
      for (const u of audit.unused) console.log(`     · ${u}`);
      console.log('');
    }

    let currentSet = 0;
    for (const r of resolved) {
      if (r.set !== currentSet) {
        currentSet = r.set;
        console.log(`  ── Set ${r.set} · ${SET_FOLDER[r.set]} ──`);
      }
      console.log(`     ${r.variant.padEnd(30)} ← ${r.file}`);
    }
    console.log(`\n  Matched ${resolved.length}/${PHOTOS.length} products.\n`);

    if (audit.missing.length) {
      throw new Error('Aborting: some photos are missing. Fix the names above and re-run.');
    }
  }

  // --from-manifest skips the photo-folder check entirely: it never reads local
  // files, it only needs the URLs a previous run already produced.
  let entries: { set: number; variant: string; url: string }[] = [];
  const failures: string[] = [];

  if (FROM_MANIFEST) {
    entries = loadManifest();
    console.log(`📄  Reusing ${entries.length} URL(s) from image-urls.json — nothing will be uploaded.\n`);
  } else {
    if (!DO_UPLOAD) {
      console.log('✅  Dry run complete. Add --upload to send these to Cloudinary.\n');
      return;
    }

    const cfg = await loadCloudinaryConfig();
    console.log(`☁️   Uploading to Cloudinary (cloud: ${cfg.cloudName})...\n`);
    let renamed = 0;

    for (const r of resolved) {
      try {
        const { url, publicId } = await uploadOne(cfg, r);
        entries.push({ set: r.set, variant: r.variant, url });
        const intended = `${CLOUDINARY_FOLDER}/set-${r.set}-${slugify(r.variant)}`;
        if (publicId && publicId !== intended) renamed++;
        console.log(`  ✔  Set ${r.set} · ${r.variant}`);
      } catch (err: any) {
        failures.push(`Set ${r.set} · ${r.variant} — ${err.message}`);
        console.log(`  ✘  Set ${r.set} · ${r.variant} — ${err.message}`);
      }
    }

    const manifestPath = path.join(__dirname, 'image-urls.json');
    fs.writeFileSync(manifestPath, JSON.stringify(entries, null, 2), 'utf8');
    console.log(`\n📄  Manifest written: ${manifestPath}`);

    if (renamed) {
      console.log(`ℹ️  ${renamed} file(s) got a Cloudinary-generated name (a previous run may have used a different id).`);
    }
    if (failures.length) {
      console.log(`\n❌  ${failures.length} upload(s) failed:`);
      for (const f of failures) console.log(`     · ${f}`);
    }

    if (!DO_WRITE) {
      console.log(`\n✅  Uploaded ${entries.length}/${resolved.length}. Re-run with --write to save URLs to Firestore.\n`);
      if (failures.length) process.exitCode = 1;
      return;
    }
  }

  if (!DO_WRITE) {
    console.log(`\n✅  ${entries.length} URL(s) ready. Add --write to save them to Firestore.\n`);
    return;
  }

  console.log('\n⏳  Writing imageUrl to Firestore...\n');
  try {
    const { updated, skipped, notFound } = await writeToFirestore(entries);
    console.log(`  ✔  ${updated} product(s) updated`);
    if (skipped) console.log(`  ➖  ${skipped} skipped (already had a photo — use --force to overwrite)`);
    if (notFound.length) {
      console.log(`\n  ⚠️  ${notFound.length} product(s) not found in Firestore (run \`npm run seed\` first):`);
      for (const n of notFound) console.log(`     · ${n}`);
    }
  } catch (err: any) {
    throw err;
  }

  console.log('\n✅  Done.\n');
  if (failures.length) process.exitCode = 1;
}

main().catch((err: any) => {
  console.error(`\n❌  ${err.message || err}\n`);
  process.exit(1);
});
