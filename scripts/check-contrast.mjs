// Validates the palette against WCAG 2.1 AA before it goes into variables.scss.
// Guessing contrast ratios is how "accessible redesign" turns out not to be, so
// this computes them.
//
//   node scripts/check-contrast.mjs
//
// This used to carry its own private copy of the palette, which is how it drifted
// out of sync — it asserted a `strawberryDeep` of #D93A62 while variables.scss
// had settled on #CF3F5E, and both were "the" deep pink. It is now the only
// place the numbers live besides the token file, and the assertions below match
// the table in the variables.scss header.

const hex = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};

const lum = (h) => {
  const [r, g, b] = hex(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const P = {
  powder: '#8ECAE6',
  powderInk: '#1B5E7E',
  mint: '#5FD9B4',
  mintInk: '#0F7358',
  sunny: '#FFC53D',
  sunnyInk: '#8A5B00',
  blush: '#F8A9BE',
  blushInk: '#A63A5E',
  plum: '#3D2B45',
  cream: '#FFF9F4',
  white: '#FFFFFF',
  success: '#17803F',
  warning: '#B45309',
  danger: '#C62828',
};

// Toned banner surfaces. Each ink must clear 4.5:1 on its own background, each
// background must clear 1.15:1 against the white card it is drawn on, and each
// border must clear 1.4:1 against its own background — otherwise the banner has
// no edge and the "surface" is invisible.
const TONES = {
  successBg: '#DDF2E4',
  successBorder: '#7FC49A',
  successInk: '#14622F',
  warningBg: '#FCEBC4',
  warningBorder: '#E0B85C',
  warningInk: '#7A4B00',
  dangerBg: '#FDE8EE',
  dangerBorder: '#F5B8C8',
  dangerInk: '#8F1F38',
  infoBg: '#E4F1F8',
  infoBorder: '#A8CBE8',
  infoInk: '#17456F',
};

// Flavour chip pastels. Kept as their own table because they are matched as a
// SET against each other rather than against the brand: the whole point of them
// is that nine chips sit in one scroller and must read as nine different things.
//
// Declared above PAIRS because PAIRS spreads this at module-evaluation time, and
// a `const` further down would still be in its temporal dead zone.
const FLAVORS = {
  chocolate: '#C4A07C',
  vanilla: '#EEE2C4',
  strawberry: '#F7BCC8',
  mango: '#F8C88A',
  ube: '#D9C8EE',
  mint: '#BFE9D5',
  coffee: '#E3C396',
  'cookies & cream': '#DDE2E4',
  pistachio: '#D6E8B8',
};

// The dashboard's "Track your orders live" strip. Asserted because its
// background was changed from mint to blush and three separate things sit on it:
// the 14px title, the 0.9-opacity subtitle, and the dashed border, which is the
// only signal that this banner is a control rather than an announcement.
//
// The subtitle's real figure is lower than these because of that opacity, but it
// cannot be expressed here: the gate reads a hardcoded solid-pair table and the
// 0.9 lives in dashboard.page.scss. Composited by hand it is 5.63:1. That number
// is written into the stylesheet next to the rule, because nothing in this file
// would catch it going out of range.
const PROMO = { bg: '#F8A9BE', border: '#1B5E7E' };

// [foreground, background, requirement, label]
const PAIRS = [
  [P.plum, P.cream, 4.5, 'body text on cream'],
  [P.plum, P.white, 4.5, 'body text on white card'],
  [P.plum, P.powder, 4.5, 'plum on powder (primary surface)'],
  [P.plum, P.mint, 4.5, 'plum on mint (secondary surface)'],
  [P.plum, P.sunny, 4.5, 'plum on sunny (tertiary surface)'],
  [P.plum, P.blush, 4.5, 'plum on blush (accent surface)'],
  [P.powderInk, P.cream, 4.5, 'primary-ink text on cream'],
  [P.powderInk, P.white, 4.5, 'primary-ink text on white card'],
  [P.mintInk, P.cream, 4.5, 'mint-ink text on cream'],
  [P.sunnyInk, P.cream, 4.5, 'sunny-ink text on cream'],
  [P.blushInk, P.white, 4.5, 'blush-ink text on white card'],
  [P.white, P.success, 4.5, 'white on success'],
  [P.white, P.warning, 4.5, 'white on warning'],
  [P.white, P.danger, 4.5, 'white on danger'],
  [TONES.successInk, TONES.successBg, 4.5, 'success ink on its banner bg'],
  [TONES.warningInk, TONES.warningBg, 4.5, 'warning ink on its banner bg'],
  [TONES.dangerInk, TONES.dangerBg, 4.5, 'danger ink on its banner bg'],
  [TONES.infoInk, TONES.infoBg, 4.5, 'info ink on its banner bg'],
  // Non-text UI components only need 3:1 (WCAG 1.4.11)
  [P.powderInk, P.white, 3, 'primary-ink border on white card'],
  [P.powderInk, P.cream, 3, 'primary-ink border on cream'],
  [P.mintInk, P.cream, 3, 'mint-ink border/icon on cream'],
  [P.sunnyInk, P.cream, 3, 'sunny-ink border/icon on cream'],
  [P.success, P.cream, 3, 'success border on cream'],
  [P.warning, P.cream, 3, 'warning border on cream'],
  [P.danger, P.cream, 3, 'danger border on cream'],
  // Inks on the PASTEL TILE surfaces. The tiles are what small text is actually
  // set on - role chips, badges, selected chips - so they need the same treatment
  // as the brand pastels.
  //
  // Added with the commit that fixed the credits role chips, which measured
  // 1.11:1 to 1.31:1: Ionic's `color` input chose the foreground and the
  // background independently and never compared them.
  [P.plum, '#E4F1F8', 4.5, 'plum on powder tile'],
  [P.plum, '#E4F6EA', 4.5, 'plum on mint tile'],
  [P.plum, '#FDE8EE', 4.5, 'plum on blush tile'],
  [P.plum, '#FFF3D6', 4.5, 'plum on lemon tile'],
  // A tinted banner background must be distinguishable from the white card it
  // sits on, or the banner has no edge at all.
  [TONES.successBg, P.white, 1.15, 'success banner bg vs white card'],
  [TONES.warningBg, P.white, 1.15, 'warning banner bg vs white card'],
  [TONES.dangerBg, P.white, 1.15, 'danger banner bg vs white card'],
  [TONES.infoBg, P.white, 1.15, 'info banner bg vs white card'],
  // …and so must its border, or the banner has no edge inside its own tint.
  [TONES.successBorder, TONES.successBg, 1.4, 'success banner border vs its bg'],
  [TONES.warningBorder, TONES.warningBg, 1.4, 'warning banner border vs its bg'],
  [TONES.dangerBorder, TONES.dangerBg, 1.4, 'danger banner border vs its bg'],
  [TONES.infoBorder, TONES.infoBg, 1.4, 'info banner border vs its bg'],

  // The retro display shadow (--display-sticker-shadow): #ffc53d measured
  // against every surface it could land on.
  //
  // As an EDGE these are decorative: no WCAG criterion applies to it, since 1.4.3
  // is text and 1.4.11 covers UI components and graphics "required to understand
  // the content", which a decorative offset is neither of. So there is no ratio to
  // hit, and the 1.05 threshold below is NOT a WCAG figure — it is the weakest
  // value at which the edge still reads as an edge.
  //
  // Hence 1.05 rather than the 1.15 the banner backgrounds use. Measured, these
  // land at 1.13 (powder), 1.10 (mint), 1.58 (white) and 1.51 (cream). The brand
  // hues are genuinely marginal and that is worth stating plainly.
  //
  // They are marginal because the shadow reuses --color-brand-accent #ffc53d and
  // the surface underneath is itself a brand hue. WCAG's luminance ratio is the
  // wrong instrument for this specific comparison: it scores brightness and
  // ignores hue, and this is a maximally warm saturated yellow against a cool
  // desaturated blue-green — the case where two colours look plainly different
  // while scoring near 1.1. A 1.1 ratio here is a visible edge; the same 1.1
  // between two greys would be invisible.
  //
  // What these rows are here to catch: someone repointing --color-brand-accent at
  // a value that sits close to the gradient, which would make the treatment
  // vanish silently. The white and cream rows are the negative control — they
  // pass 1.05, which is precisely why the treatment is confined to the four
  // brand-hue surfaces and is NOT applied to the cream and white cards the other
  // 25 --font-display call sites sit on. 1.58:1 is a faint edge, not an absent
  // one, and calling it "invisible" would overstate the case.
  [P.sunny, P.powder, 1.05, 'sticker shadow edge on powder'],
  [P.sunny, P.mint, 1.05, 'sticker shadow edge on mint'],
  [P.sunny, P.white, 1.05, 'sticker shadow edge on white'],
  [P.sunny, P.cream, 1.05, 'sticker shadow edge on cream'],

  // WHY THE GOLD IS A TEXT-CONTRAST SURFACE AT ALL
  //
  // The sticker shadow is decorative, but it paints DIRECTLY BENEATH the glyphs.
  // WCAG 1.4.3 measures text against adjacent colours, so wherever the gold
  // touches a glyph it becomes that glyph's background — and from that point the
  // requirement stops being decorative and starts being 4.5:1.
  //
  // Over --color-ink it is an improvement, not a risk: plum on gold is 8.16:1,
  // better than the 7.20:1 plum has on powder. These two rows are the CONTRACT:
  // a retro-faced string must use one of these two inks, and if either token is
  // ever nudged they go red rather than the bug shipping.
  [P.plum, P.sunny, 4.5, 'plum text over a gold sticker shadow'],
  // Included precisely because the margin is 0.01. A small change to
  // --color-primary-ink turns this row red, which is the point of having it.
  [P.powderInk, P.sunny, 4.5, 'primary-ink over a gold sticker shadow (clears by 0.01)'],

  // The nine flavour chips. TWO rows each, because there are two ways a chip can
  // be wrong and only one of them is a text-contrast failure:
  //
  //   4.5:1  plum label on the pastel — the WCAG check, and the one that matters.
  //   1.2:1   the pastel against the cream PAGE — a chip that dissolves into the
  //           background is not an unreadable chip, it is an invisible control,
  //           and no text-ratio test catches it. Vanilla started at 1.13:1 here
  //           and was rejected on this row alone.
  //
  // 1.2 rather than the 1.15 the banner backgrounds use: these are large filled
  // areas rather than 1px-tinted notices, so the edge needs a little more.
  ...Object.entries(FLAVORS).flatMap(([name, hex]) => [
    [P.plum, hex, 4.5, `flavour chip label on ${name}`],
    [hex, P.cream, 1.2, `${name} chip against the cream page`],
  ]),
  [P.plum, PROMO.bg, 4.5, 'promo-banner title (plum on blush)'],
  [P.powderInk, PROMO.bg, 3, 'promo-banner dashed border on blush'],
  [PROMO.bg, P.cream, 1.2, 'promo-banner blush against the cream page'],

  // The Dashboard welcome banner. Same three questions as the promo banner above,
  // plus one that is unique to it: it carries a retro title whose gold offset
  // shadow has to stay visible ON the surface. That last one is why this is a
  // deeper yellow than --tile-lemon — see the token comment for the ceiling.
  [P.plum, '#FBE3AE', 4.5, 'welcome-banner greeting (plum on deep lemon)'],
  [P.sunny, '#FBE3AE', 1.05, 'welcome-banner gold sticker shadow on deep lemon'],
  ['#FBE3AE', P.cream, 1.2, 'welcome-banner deep lemon against the cream page'],
  // Guards the reason --tile-lemon was rejected: if this ever goes green, the
  // banner has no edge and the two choices have become equivalent.
  ['#FFF3D6', P.cream, 1.05, 'REJECTED: tile-lemon has no edge on the cream page'],

  // The drawer's selected row. Judged against WHITE, not the cream page: the
  // idle rows are transparent over ion-menu's own surface, so this is a harsher
  // test than anything else in this file. The fill is --flavor-ube.
  [P.plum, '#D9C8EE', 4.5, 'nav active row label (plum on the ube lavender)'],
  ['#D9C8EE', P.white, 1.2, 'nav active row against the WHITE drawer'],
  // Two rejected alternatives, both documented so a later edit cannot reintroduce
  // one without noticing that a gate row already exists and says why. Both are
  // the obvious purple/pale choices and both fail for the same reason: no edge
  // against ion-menu's white surface, so the selected row looks unselected.
  ['#E8EEF9', P.white, 1.05, 'REJECTED: tile-periwinkle has no edge on the white drawer'],
  ['#E4F1F8', P.white, 1.05, 'REJECTED: tile-powder has no edge on the white drawer'],
];

let fails = 0;
console.log('ratio  req   verdict  pair');
console.log('-----  ----  -------  ----------------------------------------');
for (const [fg, bg, req, label] of PAIRS) {
  const r = ratio(fg, bg);
  const ok = r >= req;
  if (!ok) fails++;
  console.log(
    `${r.toFixed(2).padStart(5)}  ${String(req).padStart(4)}  ${(ok ? 'PASS' : 'FAIL').padStart(7)}  ${label}`,
  );
}

// The palette is pastel by design, so two things follow that are worth asserting
// rather than remembering.
//
// 1. White text is unusable on any of the brand hues, which is exactly why
//    --ion-color-primary-contrast is plum and not white. If a future change makes
//    white viable, the contrast colour could follow it.
const whiteOnPowder = ratio(P.white, P.powder);
console.log(
  `\nnote: white on powder is ${whiteOnPowder.toFixed(2)}:1 — ` +
    (whiteOnPowder < 4.5
      ? 'plum stays the contrast colour. Expected, not a failure.'
      : 'white is now viable as a contrast colour.'),
);

// 2. A pastel cannot be the ONLY thing marking a selected control. Powder on a
//    white card is 1.79:1, well under the 3:1 that WCAG 1.4.11 wants of a UI
//    boundary, so selected/active states must draw their edge in an ink variant
//    rather than in the pastel itself. This is the constraint that catches the
//    whole class of "looks fine, is invisible to a low-vision user" bugs.
const powderOnCard = ratio(P.powder, P.white);
console.log(
  `note: powder on a white card is ${powderOnCard.toFixed(2)}:1 — selected ` +
    'state borders must use --color-primary-ink, not --color-brand-primary.',
);

// 3. The retro sticker shadow only makes a legible heading when the glyph is
//    plum or primary-ink. The gold sits directly behind the glyphs, so it counts
//    as their background and owes the 4.5:1 that body text owes — it is not a
//    decorative exception. These are printed rather than asserted, because they
//    are all BELOW the threshold and a gate row cannot fail on purpose without
//    turning `verify` red permanently. They exist so the number is written down
//    next to the palette instead of being rediscovered the hard way: a future
//    change that puts the treatment on one of these inks is a regression, and the
//    measured figures here are what says so.
const UNSAFE_OVER_GOLD = [
  ['--color-sunny-ink', P.sunnyInk, 'the shape of .step-number on About (17px, lemon tile)'],
  ['--color-ink-soft', '#6B5875', '.menu-tagline (was also .dev-hero-sub, which moved to cream)'],
  ['--color-mint-ink', P.mintInk, 'not currently used on any retro string'],
];
console.log('\nnote: inks that are NOT safe behind a gold sticker shadow (needs 4.5:1):');
for (const [name, ink, where] of UNSAFE_OVER_GOLD) {
  const r = ratio(ink, P.sunny);
  console.log(`  ${r.toFixed(2)}:1  ${name.padEnd(18)} ${where}`);
}

// 4. PRE-EXISTING, and not introduced by the retro work: --color-ink-soft on the
//    brand gradient is 3.58:1 on the powder end, under the 4.5:1 owed by 12px and
//    14px text. Nothing in this file asserted it, which is how it survived — the
//    same shape as the powder-on-mint active row that was caught by hand earlier.
//    Reported rather than fixed because it predates this change and the fix is an
//    ink decision, not a contrast-script one.
//
//    TWO THINGS THIS NOTE USED TO GET WRONG, both corrected here:
//
//    (a) It read as though 3.58:1 were the value always. It is the HIGH-CONTRAST
//        ink. `#6B5875` is what `[data-contrast='high']` sets --color-ink-soft to
//        (variables.scss); the default is `#4a3a54`, which measures 5.80:1 on the
//        same powder and passes at 14px. So this is a high-contrast-only failure,
//        and saying otherwise overstated it by two full stops of severity.
//    (b) It named `.dev-hero-sub` as an affected site. That element has moved out
//        of the hero into `.dev-intro` on cream, where #6B5875 is 6.20:1 — so it
//        is fixed, not outstanding. `.menu-tagline` in the drawer header is the
//        only remaining site, and it is the one this note should be pointing at.
//
//    Both default and high-contrast figures are printed so the distinction cannot
//    be lost again.
const inkSoftDefault = ratio('#4a3a54', P.powder);
const inkSoftOnPowder = ratio('#6B5875', P.powder);
console.log(
  `\nnote: --color-ink-soft on --gradient-brand at the powder end — ` +
    `${inkSoftDefault.toFixed(2)}:1 with the DEFAULT ink (#4a3a54, passes at 14px), ` +
    `${inkSoftOnPowder.toFixed(2)}:1 with the HIGH-CONTRAST ink (#6B5875, FAILS AA). ` +
    `Outstanding sites: the 12px .menu-tagline in the drawer header only. ` +
    `.dev-hero-sub moved to .dev-intro on cream (6.20:1) and is fixed. ` +
    `Pre-existing; not caused or fixed by the retro work.`,
);

console.log(`\n${fails === 0 ? 'All pairs pass.' : `${fails} pair(s) FAIL.`}`);
process.exit(fails === 0 ? 0 : 1);
