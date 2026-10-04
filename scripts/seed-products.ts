// scripts/seed-products.ts
// Five-orites Scoop — Firestore Product Seed Script (64 SKUs)
// Compatible with Node.js v26

const admin = require('firebase-admin');
const path = require('path');
const fsExtra = require('fs');

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, 'serviceAccountKey.json');
const DEFAULT_STOCK = { cup: 50, pint: 30, halfGallon: 20, gallon: 10 };
const PRESERVE_STOCK = process.env.PRESERVE_STOCK === 'true';

/**
 * Asset images live outside the Angular build, so they are copied into
 * src/assets/images by `npm run images:generate`. When that flag is set, the
 * seeder points each product at its local file instead of leaving the URL
 * empty — which is how all 64 products shipped without a photo.
 */
const USE_ASSET_IMAGES = process.env.IMAGE_FROM_ASSETS === 'true';
const ASSET_IMAGE_SRC = path.resolve(__dirname, '..', 'assets', 'images');
const ASSET_IMAGE_DEST = 'assets/images';

/** Local asset path for a flavor, or '' when there is no matching artwork. */
function localImageFor(variantName: string): string {
  if (!USE_ASSET_IMAGES) return '';
  const slug = variantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${ASSET_IMAGE_DEST}/${slug}.svg`;
}

/** Copies generated artwork into the Angular assets folder so it gets bundled. */
function syncAssetImages(): void {
  if (!USE_ASSET_IMAGES || !fsExtra.existsSync(ASSET_IMAGE_SRC)) return;
  const dest = path.resolve(__dirname, '..', 'src', 'assets', 'images');
  fsExtra.mkdirSync(dest, { recursive: true });
  for (const file of fsExtra.readdirSync(ASSET_IMAGE_SRC)) {
    if (!file.endsWith('.svg')) continue;
    fsExtra.copyFileSync(path.join(ASSET_IMAGE_SRC, file), path.join(dest, file));
  }
}

// Credentials are loaded lazily, inside seedProducts(). Reading them at module
// scope meant that merely IMPORTING this file — which
// scripts/generate-placeholder-images.ts does for PRODUCT_CATALOG — threw
// "Cannot find module serviceAccountKey.json" before any art could be made.
// Typed as any on purpose. `admin` here is a `require()`, so it is a value and
// not a namespace, and the dotted type annotation could never resolve. scripts/
// is excluded from the app typecheck (tsconfig.app.json lists only src/main.ts),
// so nothing was catching it.
let firestore: any;
function getDb() {
  if (!firestore) {
    // THE EMULATOR BRANCH. When `FIRESTORE_EMULATOR_HOST` is set, firebase-admin
    // connects to the local emulator and needs NO credentials — and must not be
    // given any. Requiring `serviceAccountKey.json` unconditionally is what made
    // the emulator unusable for local development: that file is deliberately
    // absent from most checkouts, so `npm run seed` could not populate a sandbox
    // even once the app was pointed at one.
    //
    // Same reasoning as the `emulator` build configuration: local development
    // should not require production credentials to be useful.
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID ?? 'demo-five-orites-scoop',
      });
    } else {
      const serviceAccount = require(SERVICE_ACCOUNT_PATH);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    firestore = admin.firestore();
  }
  return firestore;
}

// Prices per set, in pesos.
//
// SET 9 IS HERE, and its absence was a third instance of the same blind spot:
// `SET_NAMES` in pricing.config.ts stops at 8, `addProduct()` in the inventory
// page fell back to 8 on an empty catalogue, and this table did too. The live
// catalogue carries a set 9 (Pistachio), so all three were quietly wrong about a
// set that actually exists — and a seeded set 9 would have landed with no pricing
// at all rather than failing loudly.
//
// The numbers are the owner's, not derived from a formula; sets 1, 3, 4, 6 and 8
// genuinely do share a price.
const PRICING_MATRIX: Record<number, any> = {
  1: { cup: 65, pint: 200, halfGallon: 500, gallon: 950 },
  2: { cup: 60, pint: 190, halfGallon: 480, gallon: 900 },
  3: { cup: 65, pint: 200, halfGallon: 500, gallon: 950 },
  4: { cup: 65, pint: 200, halfGallon: 500, gallon: 950 },
  5: { cup: 70, pint: 210, halfGallon: 520, gallon: 980 },
  6: { cup: 65, pint: 200, halfGallon: 500, gallon: 950 },
  7: { cup: 70, pint: 210, halfGallon: 520, gallon: 980 },
  8: { cup: 65, pint: 200, halfGallon: 500, gallon: 950 },
  9: { cup: 70, pint: 210, halfGallon: 520, gallon: 980 },
};

/**
 * Catalog type per variant name.
 *
 * The plan asks for "flavors, tubs, cones, sundaes". Tubs are covered by the
 * pint and half-gallon sizes, so they needed no separate type. What was missing
 * was cones and sundaes, and without a `category` field on the model a search for
 * either returned nothing.
 *
 * An explicit named list rather than a pattern match, so promoting a flavor is a
 * deliberate one-line decision and the whole catalog can be reviewed by reading
 * this. Every entry MUST name a variant that exists in PRODUCT_CATALOG below —
 * assertProductCategories() fails the seed otherwise, because a typo here would
 * otherwise silently do nothing and the category filter would show an empty
 * result with no error anywhere.
 *
 * Everything not named is a plain 'flavor', which is also what
 * `productCategory()` assumes for a document with no category field.
 */
const CATEGORY_BY_VARIANT: Record<string, 'flavor' | 'sundae' | 'cone'> = {
  // ── Cones: sold as a cone, not a tub ──────────────────────────────
  // The sorbets are the honest existing candidates — dairy-free, sold as a
  // single scoop, the way a cone is. Nothing in the catalog was invented to
  // fill this category; the shop can add real cone products in the admin UI
  // and tag them there.
  'Classic Mango Sorbet': 'cone',
  'Mango Tango Twist': 'cone',
  // ── Sundaes: layered/topped builds, served in a dish or glass ────
  // These are the layered, ribbon-and-chunk products that read as a sundae
  // rather than a plain scoop.
  'Mango Graham': 'sundae',
  'Ube Halo-Halo Style': 'sundae',
  'Ube Leche Flan': 'sundae',
  'Strawberry Cheesecake': 'sundae',
  'Mango Cheesecake': 'sundae',
  'Mint Cheesecake': 'sundae',
};

/** Catalog type for a seeded product; 'flavor' unless the list above says otherwise. */
export function categoryFor(variantName: string): 'flavor' | 'sundae' | 'cone' {
  return CATEGORY_BY_VARIANT[variantName] ?? 'flavor';
}

/**
 * Fails loudly if CATEGORY_BY_VARIANT names a product that is not in the
 * catalog, or if a name is listed twice.
 *
 * Without this, a typo would be indistinguishable from "that product does not
 * exist yet" and the category filter would silently return nothing.
 */
function assertProductCategories(): void {
  const names = new Set(PRODUCT_CATALOG.map((p) => p.variantName));
  const problems: string[] = [];

  for (const variant of Object.keys(CATEGORY_BY_VARIANT)) {
    if (!names.has(variant)) {
      problems.push(`CATEGORY_BY_VARIANT names "${variant}", which is not in PRODUCT_CATALOG`);
    }
  }

  const seen = new Map<string, number>();
  for (const p of PRODUCT_CATALOG) {
    seen.set(p.variantName, (seen.get(p.variantName) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) problems.push(`PRODUCT_CATALOG lists "${name}" ${count} times`);
  }

  if (problems.length > 0) {
    throw new Error(`Category check failed:\n  - ${problems.join('\n  - ')}`);
  }
}

export const PRODUCT_CATALOG = [
  // Set 1 · Chocolates
  {
    setNumber: 1,
    setName: 'Chocolates',
    variantName: 'Chocolate Fudge Brownie',
    description:
      "Rich chocolate ice cream swirled with gooey fudge ribbons and loaded with chewy brownie chunks. A chocolate lover's dream.",
  },
  {
    setNumber: 1,
    setName: 'Chocolates',
    variantName: 'Double Dark Chocolate',
    description:
      'Intensely deep dark chocolate base with dark chocolate chips. For those who crave the purest, most serious chocolate experience.',
  },
  {
    setNumber: 1,
    setName: 'Chocolates',
    variantName: 'Chocolate Therapy',
    description:
      'Velvety chocolate ice cream with chocolate cookies, mini chocolate chips, and a swirl of chocolate fudge. The ultimate comfort scoop.',
  },
  {
    setNumber: 1,
    setName: 'Chocolates',
    variantName: 'Mexican Chocolate',
    description:
      'Warm cinnamon and a hint of chili spice woven into smooth chocolate ice cream — inspired by traditional Mexican hot chocolate.',
  },
  {
    setNumber: 1,
    setName: 'Chocolates',
    variantName: 'Phish Food Style',
    description:
      'Chocolate ice cream with fudge fish, marshmallow swirls, and caramel ribbons. A playful and indulgent classic.',
  },
  {
    setNumber: 1,
    setName: 'Chocolates',
    variantName: 'Rocky Road',
    description:
      'A beloved classic: creamy chocolate ice cream with fluffy marshmallows and crunchy roasted almonds. Timeless and satisfying.',
  },
  {
    setNumber: 1,
    setName: 'Chocolates',
    variantName: 'Chocolate Peanut Butter Cup',
    description:
      'Smooth peanut butter swirled through chocolate ice cream with chunks of peanut butter cups in every bite.',
  },
  {
    setNumber: 1,
    setName: 'Chocolates',
    variantName: 'New York Super Fudge Chunk',
    description:
      'Chocolate ice cream packed with white and dark chocolate chunks, walnuts, almonds, and chocolate-covered almonds. No holding back.',
  },
  // Set 2 · Vanilla
  {
    setNumber: 2,
    setName: 'Vanilla',
    variantName: 'Classic Madagascar Vanilla',
    description:
      'Pure, clean, and elegant — vanilla ice cream made with authentic Madagascar vanilla beans for that floral, warm depth of flavour.',
  },
  {
    setNumber: 2,
    setName: 'Vanilla',
    variantName: 'Vanilla Bean Supreme',
    description:
      'Extra-generous vanilla bean specks in every spoonful. A premium, custard-style vanilla that stands alone beautifully.',
  },
  {
    setNumber: 2,
    setName: 'Vanilla',
    variantName: 'French Vanilla Custard',
    description:
      'Richer and creamier than classic vanilla, with an egg-custard base that delivers a silky, velvety texture and deeper flavour.',
  },
  {
    setNumber: 2,
    setName: 'Vanilla',
    variantName: 'Vanilla Cookie Crumble',
    description:
      'Smooth vanilla ice cream layered with crisp vanilla cookie crumbles for delightful texture in every scoop.',
  },
  {
    setNumber: 2,
    setName: 'Vanilla',
    variantName: 'Vanilla Caramel Swirl',
    description:
      'Classic vanilla base kissed with golden ribbons of buttery caramel. Simple, sweet, and irresistible.',
  },
  {
    setNumber: 2,
    setName: 'Vanilla',
    variantName: 'Tahitian Vanilla Bourbon',
    description:
      'An exotic Tahitian vanilla paired with a subtle bourbon extract for a complex, sophisticated adult dessert experience.',
  },
  {
    setNumber: 2,
    setName: 'Vanilla',
    variantName: 'Vanilla Toffee Crunch',
    description:
      'Creamy vanilla ice cream studded with shards of buttery English toffee for sweet crunch in every bite.',
  },
  {
    setNumber: 2,
    setName: 'Vanilla',
    variantName: 'Vanilla Honeycomb',
    description:
      'Velvety vanilla with crunchy honeycomb candy pieces that slowly melt into toffee sweetness as you eat.',
  },
  // Set 3 · Strawberry
  {
    setNumber: 3,
    setName: 'Strawberry',
    variantName: 'Strawberry Cheesecake',
    description:
      'Creamy strawberry ice cream with ribbons of strawberry compote and chunks of graham-crusted cheesecake. Perfectly indulgent.',
  },
  {
    setNumber: 3,
    setName: 'Strawberry',
    variantName: 'Strawberry Shortcake',
    description:
      'Strawberry ice cream layered with buttery shortcake crumbles and bright strawberry sauce — a summer classic reimagined.',
  },
  {
    setNumber: 3,
    setName: 'Strawberry',
    variantName: 'Wild Strawberry Swirl',
    description:
      'Intensely fruity wild strawberry ice cream with a bright swirl of strawberry jam bursting with real berry flavour.',
  },
  {
    setNumber: 3,
    setName: 'Strawberry',
    variantName: 'Strawberry Balsamic',
    description:
      'A sophisticated pairing of sweet strawberry ice cream with a tangy aged balsamic reduction. Elegant and unexpected.',
  },
  {
    setNumber: 3,
    setName: 'Strawberry',
    variantName: 'Strawberry Fields Forever',
    description:
      'Whole-strawberry pieces suspended in a light, fresh strawberry base — like walking through a strawberry field in every spoonful.',
  },
  {
    setNumber: 3,
    setName: 'Strawberry',
    variantName: 'Strawberry Yogurt Blend',
    description:
      'A lighter option blending real strawberry with tangy Greek yogurt for a refreshing, health-inspired frozen treat.',
  },
  {
    setNumber: 3,
    setName: 'Strawberry',
    variantName: 'Strawberry Basil',
    description:
      'Garden-fresh basil infused into smooth strawberry ice cream — a bright and herbaceous flavour pairing that surprises and delights.',
  },
  {
    setNumber: 3,
    setName: 'Strawberry',
    variantName: 'Strawberry Cream Delight',
    description:
      'Soft and pillowy strawberries-and-cream flavour with swirls of rich white cream throughout a rosy pink base.',
  },
  // Set 4 · Mango
  {
    setNumber: 4,
    setName: 'Mango',
    variantName: 'Classic Mango Sorbet',
    description:
      'Pure ripe mango, churned into a smooth, dairy-free sorbet. Intensely tropical with natural sweetness and zero distractions.',
  },
  {
    setNumber: 4,
    setName: 'Mango',
    variantName: 'Mango Graham',
    description:
      'Filipino-inspired layered dessert in ice cream form: sweet mango, crushed graham crackers, and condensed cream swirls.',
  },
  {
    setNumber: 4,
    setName: 'Mango',
    variantName: 'Mango Sticky Rice',
    description:
      'Creamy mango ice cream with glutinous rice bits and a hint of coconut milk — a Southeast Asian classic frozen for your enjoyment.',
  },
  {
    setNumber: 4,
    setName: 'Mango',
    variantName: 'Mango Chili Lime',
    description:
      'Sweet Philippine mango with a citrusy lime zing and just enough chili heat. Bold, tropical, and addictively complex.',
  },
  {
    setNumber: 4,
    setName: 'Mango',
    variantName: 'Mango Coconut Cream',
    description:
      'Luscious mango and velvety coconut cream blended into a tropical paradise — smooth, fragrant, and impossibly good.',
  },
  {
    setNumber: 4,
    setName: 'Mango',
    variantName: 'Mango Cheesecake',
    description:
      'Tangy cream cheese base with ribbons of ripe mango and a buttery graham cracker crumble for tropical cheesecake vibes.',
  },
  {
    setNumber: 4,
    setName: 'Mango',
    variantName: 'Mango Tango Twist',
    description:
      'A fiesta of mango sorbet swirled with a tangy mango-tamarind ribbon. Playful, sour, sweet, and absolutely refreshing.',
  },
  {
    setNumber: 4,
    setName: 'Mango',
    variantName: 'Mango Passionfruit',
    description:
      'Sun-ripe mango meets fragrant passionfruit in a creamy ice cream that tastes like a tropical island sunset.',
  },
  // Set 5 · Ube
  {
    setNumber: 5,
    setName: 'Ube',
    variantName: 'Classic Ube Halaya',
    description:
      'The original — traditional purple yam ice cream with the unmistakable earthy-sweet flavour of Filipino ube halaya. A national favourite.',
  },
  {
    setNumber: 5,
    setName: 'Ube',
    variantName: 'Ube Cheese',
    description:
      'Sweet ube ice cream with swirls of salty cream cheese — the iconic Filipino combination that works perfectly every time.',
  },
  {
    setNumber: 5,
    setName: 'Ube',
    variantName: 'Ube Macapuno',
    description:
      'Velvety ube base loaded with tender strands of macapuno (coconut sport) — a classic Pinoy pairing in frozen form.',
  },
  {
    setNumber: 5,
    setName: 'Ube',
    variantName: 'Ube Coconut Swirl',
    description:
      'Creamy ube ice cream with a fragrant coconut cream ribbon weaving through every scoop for layered tropical flavour.',
  },
  {
    setNumber: 5,
    setName: 'Ube',
    variantName: 'Ube Cookies and Cream',
    description:
      'Purple yam meets Oreo — smooth ube ice cream packed with crushed chocolate sandwich cookies for a perfect contrast.',
  },
  {
    setNumber: 5,
    setName: 'Ube',
    variantName: 'Ube Leche Flan',
    description:
      'Creamy ube ice cream with ribbons of rich caramel-kissed leche flan — two Filipino dessert legends in one scoop.',
  },
  {
    setNumber: 5,
    setName: 'Ube',
    variantName: 'Ube Pandan Fusion',
    description:
      'An aromatic blend of ube and pandan — two beloved Filipino flavours creating a beautifully fragrant and layered experience.',
  },
  {
    setNumber: 5,
    setName: 'Ube',
    variantName: 'Ube Halo-Halo Style',
    description:
      'Inspired by the iconic Filipino summer dessert — ube ice cream with kidney beans, nata de coco bits, and pinipig for texture.',
  },
  // Set 6 · Mint
  {
    setNumber: 6,
    setName: 'Mint',
    variantName: 'Mint Chocolate Chip',
    description:
      'The timeless classic: cool, refreshing mint ice cream with generous dark chocolate chips in every scoop.',
  },
  {
    setNumber: 6,
    setName: 'Mint',
    variantName: 'Mint Fudge Swirl',
    description:
      'Icy mint base elevated with thick ribbons of warm chocolate fudge creating a perfectly balanced cool-and-rich flavour.',
  },
  {
    setNumber: 6,
    setName: 'Mint',
    variantName: 'Mint Oreo Crumble',
    description:
      'Cool mint ice cream loaded with crushed Oreo cookies for a cookies-and-cream upgrade with a refreshing minty twist.',
  },
  {
    setNumber: 6,
    setName: 'Mint',
    variantName: 'Mint Chocolate Cookie',
    description:
      'Minty fresh ice cream with chunky chocolate cookie pieces — like your favourite mint cookie in frozen form.',
  },
  {
    setNumber: 6,
    setName: 'Mint',
    variantName: 'Peppermint Bark',
    description:
      'Holiday-inspired peppermint ice cream with white and dark chocolate bark shards. Festive, crunchy, and coolly satisfying.',
  },
  {
    setNumber: 6,
    setName: 'Mint',
    variantName: 'Mint Cheesecake',
    description:
      'Creamy cheesecake base with a burst of cool mint and crushed graham crackers for a chilled, minty cheesecake experience.',
  },
  {
    setNumber: 6,
    setName: 'Mint',
    variantName: 'Mint Brownie Batter',
    description:
      'Cool mint ice cream with swirls of raw brownie batter and chocolate chips — indulgent, daring, and absolutely delicious.',
  },
  {
    setNumber: 6,
    setName: 'Mint',
    variantName: 'Mint Coconut Twist',
    description:
      'A tropical spin on mint: cool peppermint paired with creamy coconut for a refreshing and unexpected flavour combination.',
  },
  // Set 7 · Coffee
  {
    setNumber: 7,
    setName: 'Coffee',
    variantName: 'Classic Coffee Bean',
    description:
      'Pure, robust coffee ice cream with whole roasted coffee beans folded in for an authentic espresso-forward experience.',
  },
  {
    setNumber: 7,
    setName: 'Coffee',
    variantName: 'Mocha Almond Fudge',
    description:
      'Rich mocha ice cream with crunchy roasted almonds and a thick fudge swirl. Deep, nutty, and intensely satisfying.',
  },
  {
    setNumber: 7,
    setName: 'Coffee',
    variantName: 'Cappuccino Crunch',
    description:
      'Frothy cappuccino-flavoured ice cream with espresso granules and crunchy cocoa nibs — your morning coffee, in dessert form.',
  },
  {
    setNumber: 7,
    setName: 'Coffee',
    variantName: 'Coffee Caramel Swirl',
    description:
      'Smooth coffee ice cream with ribbons of buttery salted caramel — a grown-up, cafe-inspired flavour combination.',
  },
  {
    setNumber: 7,
    setName: 'Coffee',
    variantName: 'Tiramisu Style',
    description:
      'Mascarpone-infused coffee ice cream with espresso-soaked ladyfinger crumbles and a dusting of cocoa. Italy in a cup.',
  },
  {
    setNumber: 7,
    setName: 'Coffee',
    variantName: 'Coffee Toffee Bar',
    description:
      'Bold espresso ice cream with toffee bar chunks and a caramel ribbon — crunchy, sweet, and deeply caffeinated.',
  },
  {
    setNumber: 7,
    setName: 'Coffee',
    variantName: 'Vietnamese Coffee',
    description:
      'Inspired by ca phe sua da — a dark drip coffee ice cream swirled with rich condensed milk for that signature sweetness.',
  },
  {
    setNumber: 7,
    setName: 'Coffee',
    variantName: 'Coffee Chocolate Chip',
    description:
      'Classic coffee ice cream studded with dark chocolate chips — a simple yet perfect flavour pairing for any time of day.',
  },
  // Set 8 · Cookies & Cream
  {
    setNumber: 8,
    setName: 'Cookies & Cream',
    variantName: 'Classic Cookies and Cream',
    description:
      'The all-time favourite: creamy vanilla ice cream generously packed with crushed chocolate sandwich cookies.',
  },
  {
    setNumber: 8,
    setName: 'Cookies & Cream',
    variantName: 'Double Stuffed Cookie',
    description:
      'Extra cream filling from double-stuffed cookies swirled into vanilla ice cream — for those who always eat the filling first.',
  },
  {
    setNumber: 8,
    setName: 'Cookies & Cream',
    variantName: 'Cookie Butter Swirl',
    description:
      'Vanilla ice cream ribboned with creamy Belgian cookie butter (speculoos) and crushed spiced biscuit pieces.',
  },
  {
    setNumber: 8,
    setName: 'Cookies & Cream',
    variantName: 'Cookies and Caramel',
    description:
      'Classic cookies and cream upgraded with a golden caramel swirl for a sweet, salty, and crunchy triple-threat.',
  },
  {
    setNumber: 8,
    setName: 'Cookies & Cream',
    variantName: 'Chocolate Chip Cookie Dough',
    description:
      'Vanilla ice cream with edible chocolate chip cookie dough chunks — because cookie dough is always better than the baked version.',
  },
  {
    setNumber: 8,
    setName: 'Cookies & Cream',
    variantName: 'Birthday Cake Cookie',
    description:
      'Funfetti cake-flavoured ice cream with birthday cake cookie pieces and rainbow sprinkles. Every day is a celebration.',
  },
  {
    setNumber: 8,
    setName: 'Cookies & Cream',
    variantName: 'Cookies and Cream Fudge',
    description:
      'Cookies-and-cream ice cream with a thick fudge ribbon layered throughout for extra chocolate richness in every bite.',
  },
  {
    setNumber: 8,
    setName: 'Cookies & Cream',
    variantName: 'Peanut Butter Cookie Crunch',
    description:
      'Peanut butter ice cream base loaded with peanut butter cookie crumbles and chocolate chips — for the peanut butter fanatic.',
  },
];

async function seedProducts(): Promise<void> {
  console.log('\n🍦  Five-orites Scoop — Firestore Product Seeder');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n');
  console.log(`📦  Total SKUs to seed: ${PRODUCT_CATALOG.length}\n`);

  // Fails before anything is written, so a typo in CATEGORY_BY_VARIANT cannot
  // half-seed the catalog and leave the category filter silently empty.
  assertProductCategories();

  const byCategory = PRODUCT_CATALOG.reduce<Record<string, number>>((acc, p) => {
    const c = categoryFor(p.variantName);
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `🏷️  By type: ${Object.entries(byCategory)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')}\n`,
  );

  syncAssetImages();

  const db = getDb();
  const batch = db.batch();
  const productsCol = db.collection('products');

  for (const product of PRODUCT_CATALOG) {
    const pricing = PRICING_MATRIX[product.setNumber];
    const slug = product.variantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const docId = `set${product.setNumber}_${slug}`;
    const docRef = productsCol.doc(docId);

    // Look up existing stock so we don't clobber real inventory counts
    let stockToWrite = DEFAULT_STOCK;
    if (PRESERVE_STOCK) {
      const existingDoc = await docRef.get();
      const existingStock = existingDoc.exists ? existingDoc.data()?.stock : undefined;
      if (existingStock) {
        stockToWrite = existingStock;
      }
    }

    // Real Timestamps, not ISO strings. `product.model.ts` types createdAt and
    // updatedAt as `Timestamp`; writing `.toISOString()` here produced string
    // fields that violate the app's own model and make any `.toDate()` call
    // throw. The Node admin SDK serialises a JS Date to a Firestore Timestamp.
    const now = new Date();
    batch.set(
      docRef,
      {
        setNumber: product.setNumber,
        setName: product.setName,
        variantName: product.variantName,
        description: product.description,
        imageUrl: localImageFor(product.variantName),
        category: categoryFor(product.variantName),
        pricing,
        stock: stockToWrite,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    console.log(
      `  ✔  Set ${product.setNumber} · ${product.setName.padEnd(15)} → ${product.variantName}`,
    );
  }

  console.log('\n⏳  Writing to Firestore...\n');
  await batch.commit();
  console.log(`\n✅  Seed complete! ${PRODUCT_CATALOG.length} products written.\n`);
  process.exit(0);
}
// Only seed when run directly. This module is also imported by
// scripts/generate-placeholder-images.ts for PRODUCT_CATALOG; an unguarded call
// would write 64 products to Firestore as a side effect of generating artwork.
if (require.main === module) {
  seedProducts().catch((err: any) => {
    console.error('Seed error:', err.message || err);
    process.exit(1);
  });
}
