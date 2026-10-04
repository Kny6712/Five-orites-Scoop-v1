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

console.log(`\n${fails === 0 ? 'All pairs pass.' : `${fails} pair(s) FAIL.`}`);
process.exit(fails === 0 ? 0 : 1);
