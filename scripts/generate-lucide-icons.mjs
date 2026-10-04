// One-time codegen: extract Lucide SVG node data for the icons this app uses.
//
// WHY THIS EXISTS
// ---------------
// Neither official Angular package works on Angular 17:
//   - `@lucide/angular@1.49.0` ships metadata targeting Angular 22 and its
//     component template uses `@let`, an Angular 18.1+ control-flow block. Its
//     own peerDependency claims ">=17.0.0" but it does not compile on 17.
//   - `lucide-angular@1.0.0` is Angular-13-era output (works, but deprecated,
//     NgModule-based, and 2.5 MB of module graph).
//
// The artwork itself is plain data — arrays of [tag, attrs] — with no framework
// coupling. So we take the genuine Lucide geometry and render it ourselves in a
// ~60-line component. Same icons, no deprecated dependency, no version fragility.
//
// Run from the project root:  npm run icons:generate
//
// The source bundle is NOT a project dependency — the generated geometry is
// committed, and the package is fetched only when you actually need to add or
// update an icon:
//
//   npm i --no-save lucide-angular@1.0.0
//   npm run icons:generate
//   (add any new app-name -> Lucide-name pair to WANTED below first)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const BUNDLE = resolve('node_modules/lucide-angular/fesm2020/lucide-angular.mjs');
const OUT = resolve('src/app/core/icons/lucide-icon-data.ts');

if (!existsSync(BUNDLE)) {
  console.error(`Source bundle not found: ${BUNDLE}`);
  console.error('');
  console.error('Lucide geometry is committed, so this is only needed when adding an');
  console.error('icon. Fetch the source package, then re-run:');
  console.error('');
  console.error('  npm i --no-save lucide-angular@1.0.0');
  console.error('  npm run icons:generate');
  process.exit(1);
}

/** app icon name -> [candidate Lucide export names, newest first] */
const WANTED = {
  home: ['House', 'Home'],
  'ice-cream': ['IceCreamCone', 'IceCream2'],
  cart: ['ShoppingCart'],
  receipt: ['Receipt', 'ReceiptText'],
  layers: ['Layers'],
  clipboard: ['ClipboardList', 'Clipboard'],
  'clipboard-check': ['ClipboardCheck'],
  chart: ['ChartColumn', 'BarChart3', 'BarChart'],
  info: ['Info'],
  users: ['Users', 'Users2'],
  user: ['User'],
  'user-cog': ['UserCog'],
  'log-out': ['LogOut'],
  menu: ['Menu'],
  settings: ['Settings'],
  clock: ['Clock', 'Clock3'],
  'circle-check': ['CircleCheck', 'CheckCircle'],
  'circle-check-big': ['CircleCheckBig', 'CheckCircle2'],
  'circle-alert': ['CircleAlert', 'AlertCircle'],
  'triangle-alert': ['TriangleAlert', 'AlertTriangle'],
  'circle-x': ['CircleX', 'XCircle'],
  bike: ['Bike'],
  check: ['Check'],
  'check-check': ['CheckCheck'],
  'cloud-off': ['CloudOff'],
  loader: ['LoaderCircle', 'Loader2'],
  'wifi-off': ['WifiOff'],
  plus: ['Plus'],
  minus: ['Minus'],
  trash: ['Trash2'],
  pencil: ['Pencil', 'Edit3'],
  save: ['Save'],
  copy: ['Copy'],
  eye: ['Eye'],
  'eye-off': ['EyeOff'],
  lock: ['Lock'],
  mail: ['Mail'],
  // The notification affordance: the header bell and the notifications page.
  // Added with the in-app notification feed - `mail` was doing double duty as
  // the only mail-ish glyph and reading as "email" rather than "your alerts".
  bell: ['Bell'],
  filter: ['Funnel', 'Filter'],
  refresh: ['RefreshCw'],
  'arrow-right': ['ArrowRight'],
  'arrow-left': ['ArrowLeft'],
  'chevron-right': ['ChevronRight'],
  'chevron-down': ['ChevronDown'],
  x: ['X'],
  heart: ['Heart'],
  star: ['Star'],
  'star-half': ['StarHalf'],
  zap: ['Zap'],
  'shield-check': ['ShieldCheck'],
  smartphone: ['Smartphone'],
  banknote: ['Banknote'],
  'trending-up': ['TrendingUp'],
  code: ['Code', 'CodeSlash'],
  frown: ['Frown'],
  image: ['Image', 'ImageIcon'],
  camera: ['Camera'],
  package: ['Package'],
  store: ['Store'],
  truck: ['Truck'],
  sparkles: ['Sparkles'],
  palette: ['Palette'],
  'map-pin': ['MapPin'],
  navigation: ['Navigation'],
  map: ['Map'],
  ticket: ['TicketPercent', 'Ticket'],
  phone: ['Phone'],
  gift: ['Gift'],
  wallet: ['Wallet'],
  percent: ['Percent'],
  tag: ['Tag'],
  'chart-pie': ['ChartPie', 'PieChart'],
  'chart-bar': ['ChartBar', 'BarChart'],
  peso: ['PhilippinePeso'],

  // ── Added for the UI polish pass ──────────────────────────────────────────
  // Pagination. Only ChevronRight was registered before, which made a one-sided
  // pager — a "Previous" affordance had no icon to use.
  'chevron-left': ['ChevronLeft'],
  'chevrons-left': ['ChevronsLeft'],
  'chevrons-right': ['ChevronsRight'],
  // Search inputs. `filter` was registered but is a funnel, not a magnifier,
  // and a funnel next to a text field reads as "open filters" rather than
  // "type to search".
  search: ['Search'],
  // Table/list affordances for the admin pages that became real tables.
  list: ['List'],
  'chart-column': ['ChartColumnBig', 'ChartColumn'],
  gauge: ['Gauge'],
  // Export / external navigation.
  download: ['Download'],
  // Import. The inventory CSV trigger referenced this name before it existed here,
  // so the button rendered with an empty <svg> and no icon at all.
  upload: ['Upload'],
  'external-link': ['ExternalLink'],
  // The redesigned cart affordance and its menu entry. ShoppingCart reads as a
  // wireframe trolley; ShoppingBag is the shape most people picture.
  'shopping-bag': ['ShoppingBag'],
  // Inventory: the card's replace-image and delete actions, and the size
  // steppers that replaced the "Edit Stock" button.
  'image-plus': ['ImagePlus'],
  'square-pen': ['SquarePen'],
  'circle-minus': ['CircleMinus'],
  'circle-plus': ['CirclePlus'],
  // Users table (joined date) and Settings.
  calendar: ['Calendar'],
  'text-cursor-input': ['TextCursorInput'],
  'sliders-horizontal': ['SlidersHorizontal'],
  contrast: ['Contrast'],
  'map-pinned': ['MapPinned'],
};

const src = readFileSync(BUNDLE, 'utf8');

/**
 * Extracts the array literal assigned to `const <Name> = [...]`.
 *
 * Brace/bracket counting rather than a regex, because the path data itself
 * contains both `(` and `)` and `'` characters that would desynchronise a lazy
 * pattern.
 *
 * The literal is then evaluated rather than text-transformed into JSON. A
 * text transform looks tempting but is a losing game: the source is formatted
 * across multiple lines with trailing commas, so every attempt has to handle
 * whitespace, trailing commas and unquoted keys, and each one that looks right
 * silently drops a node. `new Function` returns the exact value the icon library
 * itself would have, which is the property that actually matters here.
 */
function extractIcon(name) {
  const decl = new RegExp(`(?:const|var|let)\\s+${name}\\s*=\\s*\\[`, 'g');
  const m = decl.exec(src);
  if (!m) return null;

  const start = m.index + m[0].length - 1; // at the '['
  let depth = 0;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return null;

  try {
    // eslint-disable-next-line no-new-func
    const value = new Function(`return ${src.slice(start, end)};`)();
    if (!Array.isArray(value) || value.length === 0) return null;
    // `key` is a source-map artefact carrying no runtime meaning. Dropping it
    // cuts the generated file by roughly a third.
    return value.map(([tag, attrs]) => {
      const { key, ...rest } = attrs ?? {};
      return [tag, rest];
    });
  } catch (err) {
    console.error(`  ! ${name}: could not evaluate (${err.message})`);
    return null;
  }
}

const out = {};
const missing = [];
for (const [appName, candidates] of Object.entries(WANTED)) {
  let node = null;
  let used = null;
  for (const c of candidates) {
    node = extractIcon(c);
    if (node) {
      used = c;
      break;
    }
  }
  if (node) out[appName] = node;
  else missing.push(`${appName} (tried: ${candidates.join(', ')})`);
}

const total = Object.values(out).reduce((n, nodes) => n + nodes.length, 0);
const bytes = JSON.stringify(out).length;

const file = `// src/app/core/icons/lucide-icon-data.ts
// Five-orites Scoop — Lucide icon geometry (generated, do not hand-edit)
//
// GENERATED by scripts/generate-lucide-icons.mjs. Icons are licensed under the
// ISC License, Copyright (c) for Lucide contributors — https://lucide.dev
//
// These are raw SVG node arrays ([tag, attributes]), copied verbatim from the
// Lucide icon set. They carry no framework coupling, which is the point: the
// official Angular wrappers are either built for Angular 22 (@lucide/angular,
// uses the 18.1+ \`@let\` block) or deprecated and NgModule-based
// (lucide-angular). Rendering this data in AppIconComponent works on Angular 17
// and will keep working on whatever version comes next.
//
// Each entry is \`[tag, attrs]\`, where tag is one of the SVG shape elements
// Lucide emits. Regenerate after adding an icon to APP_ICONS.

/** One SVG shape: element name plus its attributes. */
export type IconNode = [tag: string, attrs: Record<string, string>];

/**
 * Icon geometry, keyed by the app-level name used in \`<app-icon name="…">\`.
 *
 * \`satisfies\`, NOT a \`Record<string, IconNode[]>\` annotation, and this line is
 * load-bearing in a way that is easy to undo by accident.
 *
 * An explicit \`Record<string, …>\` annotation WIDENS this object to
 * \`Record<string, IconNode[]>\`, so \`keyof typeof\` below — which is what
 * \`AppIcon\` in app-icons.ts is built from — becomes plain \`string\`. Every
 * \`<app-icon name="…">\` in the app then type-checks against \`string\`, and the
 * promise in that file's comment that a typo becomes a compile error is false.
 *
 * It was not theoretical: \`name="upload"\` on the inventory CSV button was not one
 * of these keys, so it rendered an empty \`<svg>\` and the button lost its icon with
 * nothing reporting a problem. Regenerating this file used to silently restore the
 * broken annotation, which is why the fix lives HERE and not in the generated
 * output.
 *
 * \`satisfies\` keeps the literal key union while still checking every value is a
 * well-formed \`IconNode[]\`, so a name outside the vocabulary stops compiling.
 */
export const LUCIDE_ICON_DATA = ${JSON.stringify(out, null, 2)} satisfies Record<
  string,
  IconNode[]
>;

export type LucideIconName = keyof typeof LUCIDE_ICON_DATA;
`;

writeFileSync(OUT, file, 'utf8');

console.log(
  `Extracted ${Object.keys(out).length} icons, ${total} shapes, ${(bytes / 1024).toFixed(1)} KB of geometry.`,
);
console.log(`Wrote ${OUT}`);
if (missing.length) {
  console.error(`\nMISSING (${missing.length}):`);
  for (const m of missing) console.error(`  - ${m}`);
  process.exit(2);
}
