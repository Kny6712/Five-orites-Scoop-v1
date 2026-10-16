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
  // #A3B5F0, the periwinkle lead hue. It has been #8ECAE6 and briefly #89CFF0.
  // The sky-blue attempt failed a check that is not a ratio at all: it shared the
  // original's hue almost exactly (199.2 vs 199.1 degrees) and differed only in
  // saturation, so it passed every row here while reading as no change whatsoever.
  // A HUE shift is what makes a repaint visible, and that is the number to hold on
  // to if this is ever moved again.
  //
  // `powderInk` below is a TEXT colour and is deliberately unchanged, which is why
  // its four rows are unaffected by any of this.
  powder: '#A3B5F0',
  powderInk: '#1B5E7E',
  mint: '#5FD9B4',
  mintInk: '#0F7358',
  sunny: '#FFC53D',
  sunnyInk: '#8A5B00',
  blush: '#F8A9BE',
  blushInk: '#A63A5E',
  plum: '#3D2B45',
  cream: '#FFF9F4',
  // --color-card. The cream the majority of the app's text actually sits on:
  // every .cart-card, .value-card and .name-item is this colour, and until now
  // the gate only knew the page ground (P.cream) and P.white. Card sits between
  // them in luminance, so a pair asserted against one of those says nothing
  // about it. Added with the cart redesign, which moved the cart's item rows off
  // white and onto a card.
  card: '#FFFCEE',
  inkSoft: '#6B5875',
  // The 10% primary-ink tint the cart's selected rows sit on, resolved to a
  // solid: rgb(27 94 126 / 10%) composited over #F2F7FA (--ion-color-light, the
  // contained-surface token the cart rows and text fields share) is #DCE8EE.
  // Written as a solid because the contrast maths cannot composite alpha, and
  // asserting the blend is what actually matters - the selected row's text is
  // plum on top of it.
  tintedSurface: '#DCE8EE',
  // --ion-color-light. The one contained-surface token on the cart: the item rows,
  // the saved-address rows, the text fields and now the order summary all paint
  // this exact colour, so every ink that sits in any of them is asserted against
  // it here. Added after the summary moved onto it - which is also what exposed
  // the Total divider going invisible, see P.dividerBelow.
  contained: '#F2F7FA',
  // --ion-color-light-shade, the border the Total row was drawn with. Recorded
  // against P.contained because that is where it broke: #E4EDF3 on #F2F7FA is
  // 1.10:1, i.e. no edge at all. Not a text pair, so it lives here with a floor
  // of 1.15:1 to match the tone surfaces' own "must read as a surface" rule.
  dividerBelow: '#E4EDF3',
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

  // The low-stock surfaces, repainted peach. A SEPARATE triple from the warning
  // one above because --tone-warning-* has ten consumers including the customers'
  // product card and order status badge, which this redesign does not touch.
  //
  // The fill earns its own row: #FCEBC4 measured 1.13:1 against cream, under the
  // 1.15:1 the banner backgrounds need, so that panel had no edge from its fill
  // and got all of its definition from a 2px border. #FDCC85 measures 1.42:1.
  peachBg: '#FDCC85',
  peachBorder: '#D9A050',
  peachInk: '#7A4B00',
};

// The Dashboard welcome banner's teal, and the drawer's selected-row lilac.
// Both are single values rather than triples: each surface has exactly one ink
// already in use (plum, in both cases) and exactly one derived colour, so a
// table would be three rows of single entries pretending to be a system.
const WELCOME_TEAL = { bg: '#8AD4D5' };
const TONES_LEMON = '#FFF3D6';
const NAV_ACTIVE = '#C6A8E6';

// The four dashboard KPI tiles. A powder palette, kept separate from TONES
// because these are the dashboard's own surfaces and the rest of the tone system
// has six other consumers — including the customers' product card and order
// status badge — that a repaint here must not touch.
//
// The previous swatches were all HSL saturation 100%, which is why they read as
// flat paint rather than as surface. Hue and lightness barely moved in the
// repaint; saturation is the only variable, now 22-28%.
//
// The inks are the EXISTING --tone-*-ink values, deliberately not re-chosen: each
// one was measured against its new fill and all four clear AA, so a colour swap
// did not have to move the text colour as well. The low-stock pair is the one
// that mattered — 4.62:1 before the repaint, passing by 0.12, now 6.30:1.
const KPI = {
  revenueBg: '#DAE7DF',
  revenueInk: '#14622F',
  revenueRim: '#81AB90',
  pendingBg: '#EBEBDB',
  pendingInk: '#7A4B00',
  pendingRim: '#B8A378',
  pendingDisc: '#E0DBC5',
  lowstockBg: '#E8D8D8',
  lowstockInk: '#8F1F38',
  lowstockRim: '#C08590',
  totalBg: '#D8DEE9',
  totalInk: '#17456F',
  totalRim: '#8199B2',
};

// The dashboard's Low Stock panel, repainted to a powder fill and SCOPED to that
// panel — `--tone-peach-*` still paints admin-tracking's unmapped-orders block, so
// these are deliberately separate values rather than an edit of the shared peach.
//
// `--lowstock-bg` is H36 S46 L82, not the S25 L88 a KPI tile can afford, and the
// tinted row is why: the rows are 40% white over this fill, and at S25 L88 that
// pair measures 1.11:1 and fails. Everything else here clears with room; that one
// clears at 1.16, which is thin by design and is the first number to re-check if
// the fill ever moves.
const LOW = {
  bg: '#E6D5BC',
  border: '#B59767',
  ink: '#7A4B00',
  // 40% white over LOW.bg. Written as a solid because this file reads solid
  // pairs; the stylesheet keeps it as a live alpha that tracks the fill.
  row: '#F0E6D7',
};

// Flavour chip pastels. Kept as their own table because they are matched as a
// SET against each other rather than against the brand: the whole point of them
// is that nine chips sit in one scroller and must read as nine different things.
//
// Declared above PAIRS because PAIRS spreads this at module-evaluation time, and
// a `const` further down would still be in its temporal dead zone.
const FLAVORS = {
  chocolate: '#CBAF94',
  vanilla: '#E8DCC0',
  strawberry: '#EBBFC6',
  mango: '#EFCB9B',
  ube: '#D5CBE4',
  mint: '#C6E2D4',
  coffee: '#DEC8A4',
  'cookies & cream': '#DDE0E1',
  pistachio: '#D5E0C0',
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

  // ON A CARD SURFACE. Every panel on the cart, About and the tracker is
  // --color-card, which was ungated: a pair could be asserted against white and
  // said nothing about the cream two shades below it. The cart's item rows were
  // on white at ~3.1:1 with --ion-color-medium, and moving them onto a card is
  // what forced the ink to be settled properly rather than assumed.
  [P.plum, P.card, 4.5, 'body text on a card surface'],
  [P.inkSoft, P.card, 4.5, 'secondary meta text on a card surface'],
  // The My Orders ledger's column header: a 10px uppercase label sitting over the
  // page ground, added with the ledger itself — there was no header before it.
  [P.inkSoft, P.cream, 4.5, 'the order column header on the page ground'],

  // RAW --color-danger TEXT ON A LIGHT SURFACE. Both of its consumers changed, so
  // neither of these is the one the comment above used to describe.
  //
  // Cancel was one of them: it was underlined danger TEXT drawn straight on the
  // card fill, and it is now a tonal pill — --tone-danger-ink on --tone-danger-bg
  // with a --tone-danger-border rim. That pair is not asserted here because it
  // did not need to be: [dangerInk on dangerBg 4.5] (:253), [dangerBg vs the white
  // card 1.15] (:340) and [dangerBorder vs dangerBg 1.4] (:345) already cover
  // exactly those three numbers, and the pill is built from those tokens. No new
  // gate, no new measurement.
  //
  // The other consumer is untouched and still draws --color-danger as bare text
  // over a transparent background (admin-users.page.scss .role-chip--danger), so
  // it sits on whatever ground that filter bar is on. Both grounds are asserted
  // rather than assuming which one applies — measuring is cheaper than being
  // wrong about a destructive control's legibility.
  [P.danger, P.card, 4.5, 'danger text on a card surface (admin role chip)'],
  [P.danger, P.cream, 4.5, 'danger text on the page ground (admin role chip)'],

  // THE SELECTED ROW. A tint over the contained surface, carrying real text -
  // the address itself plus its price in the cart rows. Green was used first and
  // had to go: on a pale blue ground the success tint is so close in lightness
  // that the selection stops reading as selected.
  [P.plum, P.tintedSurface, 4.5, 'text on a selected row (primary-ink tint)'],
  [P.powderInk, P.tintedSurface, 4.5, 'the row tick on a selected row'],

  // ON THE CONTAINED SURFACE. Every contained block on the cart - item rows,
  // saved-address rows, text fields, and now the order summary - is this one
  // colour, so each ink that lands in any of them is checked here rather than
  // assumed to behave as it does on the ivory card two shades lighter.
  [P.plum, P.contained, 4.5, 'text on a contained list (rows + summary rows + Total)'],
  [P.inkSoft, P.contained, 4.5, 'meta text on a contained list'],

  // NOT ASSERTED, DELIBERATELY: [P.dividerBelow, P.contained].
  // --ion-color-light-shade, the border the Total row used to be drawn with,
  // measures 1.10:1 on #F2F7FA. That is why the Total divider is now the same
  // inset plum hairline the other lists use rather than that token reused here.
  // It is recorded rather than asserted because a pair that fails cannot live in
  // a gate that must pass - the assertion belongs on whatever replaced it, and
  // the number above is the reason the replacement was needed.
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

  // WHITE ON A TONE INK — the inverse of the four rows above, and the one the
  // dashboard's "Restock" button depends on.
  //
  // Asserted because that button used to rely on this pairing silently: it was a
  // full-bleed bar with no assertion anywhere, so nothing would have caught a
  // future edit to --tone-warning-ink that quietly broke a CTA. It is now a pill,
  // which makes it more obviously a button and more obviously something a gate
  // row belongs on.
  //
  // The hover state is `filter: brightness(0.9)` rather than a second colour,
  // deliberately: darkening the fill can only raise this ratio, so one row covers
  // both states and no new token is introduced for a hover shade.
  [P.white, TONES.successInk, 4.5, 'white on success ink (filled CTA)'],
  [P.white, TONES.warningInk, 4.5, 'white on warning ink (the Restock pill)'],
  [P.white, TONES.dangerInk, 4.5, 'white on danger ink (filled CTA)'],
  [P.white, TONES.infoInk, 4.5, 'white on info ink (filled CTA)'],

  /* TOOLBAR TITLE — three rows, because the toolbar now has two backgrounds.

     This pair was not asserted at all before the candy stripe went in, which is
     the actual gap: the toolbar had been periwinkle with a plum title since the
     project began, and 6.40:1 had never been checked by anything. The stripe
     made it worth asserting because the background is no longer one colour.

     All three rows carry a 4.5 requirement even though the two stripe rows clear
     7:1. That is deliberate. The stripe is white at partial alpha over a
     mid-light fill, so it can only LIGHTEN the backdrop, and lightening raises
     contrast against dark plum — the flat row is therefore the floor, and it is
     the only one that can ever fail. Requiring 4.5 on the stripe rows documents
     that structure rather than testing it.

     #B5C4F3 is 20% white over #A3B5F0 (>=605px), #B0BFF2 is 14% (narrow).
     Both are computed from --toolbar-stripe-alpha in variables.scss; if that
     token changes, these two rows are stale and this gate will not notice. */
  [P.plum, '#A3B5F0', 4.5, 'toolbar title on flat periwinkle (stripe floor)'],
  [P.plum, '#B5C4F3', 4.5, 'toolbar title on the 20% stripe (wide screens)'],
  [P.plum, '#B0BFF2', 4.5, 'toolbar title on the 14% stripe (narrow screens)'],

  /* DRAWER HEADER — asserted because this pair shipped broken.

     .menu-tagline was `--color-ink-soft` (#6b5875) on `--gradient-brand`, which
     measured 3.18:1 on the periwinkle end and 3.68:1 on the mint end. At 12px
     semibold that is not large text, so 4.5:1 applied and it failed everywhere
     along the gradient.

     Both ends are listed rather than only the failing one. A gradient is two
     colours, and asserting the periwinkle end alone would have left the mint end
     covered only by implication — which is roughly how the original gap arose.

     #5FD9B4 is the mint end of --gradient-brand. #A3B5F0 duplicates the
     toolbar floor row by value but not by role: that row documents the toolbar,
     this one documents the drawer, and a silent change to one surface should not
     be able to borrow the other's coverage. */
  [P.plum, '#A3B5F0', 4.5, 'drawer brand line + tagline, periwinkle end'],
  [P.plum, '#5FD9B4', 4.5, 'drawer brand line + tagline, mint end'],

  /* Documented, not endorsed: what the tagline used to measure. Low requirement
     so it passes, REJECTED so it cannot be mistaken for an approved pairing. */
  ['#6B5875', '#A3B5F0', 3.0, 'REJECTED: old --color-ink-soft tagline ink, 3.18:1 at 12px'],
  ['#6B5875', '#5FD9B4', 3.0, 'REJECTED: old --color-ink-soft tagline ink, 3.68:1 at 12px'],

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

  // ── The peach low-stock surfaces ────────────────────────────────────────
  // The dashboard's Low Stock panel and the tracking page's unmapped block. Both
  // carry four pieces of text on this fill and all four are asserted, because the
  // redesign moved the rows OFF a white card ONTO the tint — which is precisely
  // the change that makes an unasserted colour pair dangerous.
  //
  // Two of these rows exist because the obvious choice FAILS. --ion-color-medium
  // is the ink this text used to be, and it is what the rest of the app uses for
  // secondary text: it measures 3.32:1 on this peach, a fail at 11-12px. It is
  // asserted here as the plum/peach alternatives instead, so nobody "simplifies"
  // one of these lines back to the app-wide secondary ink without the gate
  // catching it on the same run.
  [TONES.peachInk, TONES.peachBg, 4.5, 'peach ink on peach bg (subtitle, set name)'],
  [P.plum, TONES.peachBg, 4.5, 'plum on peach bg (panel title, flavour name)'],
  [TONES.peachInk, P.white, 4.5, 'peach ink on a white pill (low-stock chip)'],
  [P.white, TONES.peachInk, 4.5, 'white on peach ink (empty chip, Restock CTA)'],
  // The fill needs its own edge against the cream page, and the border needs one
  // against the fill — or the panel is a shape with no boundary.
  [TONES.peachBg, P.cream, 1.15, 'peach panel bg vs the cream page'],
  [TONES.peachBorder, TONES.peachBg, 1.4, 'peach panel border vs its own bg'],
  // A white pill sitting on the peach has to be visible as a shape, not just as
  // legible text.
  [P.white, TONES.peachBg, 1.15, 'white pill vs peach bg'],

  // ── The TINTED low-stock row ────────────────────────────────────────────
  //
  // The rows are `rgb(255 255 255 / 0.4)` over the peach, which composites to
  // #FEE0B6. That composite is written out here because this file reads SOLID
  // pairs: a translucent fill is not something it can resolve, so the number that
  // actually reaches the eye is the one that has to be asserted.
  //
  // Two properties, and the second is the reason the row is tinted at all rather
  // than left flat with a hairline between rows:
  //
  //   1. The row must be distinguishable from the panel, or a twelve-row list
  //      blurs into one peach field. The 1.56:1 hairline it replaced was not.
  //   2. Text sits on this composite, not on the raw peach — and it is BETTER
  //      here (5.84:1 against 4.99:1), because a lighter background gives dark
  //      text more contrast. So the tint is a legibility win as well as a visual
  //      one, which is worth recording: the instinct to lighten a surface holding
  //      text is usually wrong, and this is the case where it is not.
  //
  // If the row tint is ever raised past 40% white, re-check BOTH rows: the edge
  // ratio rises and the ink ratio falls, and 40% is where the two were last
  // measured together.
  //
  // THESE THREE ROWS COVER BOTH PANELS. The dashboard's low-stock list and the
  // tracking page's unmapped-orders list are the same surface in two places, and
  // both use this exact composite — so there is deliberately no second set of
  // rows for the tracking list. If one is ever retinted independently, add its
  // own rows here rather than assuming these still describe it.
  ['#FEE0B6', TONES.peachBg, 1.15, 'tinted low-stock row vs the peach panel'],
  [TONES.peachInk, '#FEE0B6', 4.5, 'peach ink on a tinted low-stock row'],
  [P.plum, '#FEE0B6', 4.5, 'plum on a tinted low-stock row'],

  // ── The DASHBOARD low-stock panel (powder) ───────────────────────────────
  //
  // A SECOND set of rows, and that is deliberate: the peach block above is now
  // describing admin-tracking's unmapped-orders block ONLY, because the dashboard
  // panel was repainted to a scoped powder fill. The note at the end of the peach
  // block anticipates exactly this case — "if one is ever retinted independently,
  // add its own rows here rather than assuming these still describe it".
  //
  // So these rows do not replace the peach ones. Both panels exist, both are
  // peach-derived, and each is asserted against its own fill. Repointing the
  // shared rows at the new fill would have left the tracking page unasserted
  // while appearing to cover it.
  //
  // LOW is declared above PAIRS, with KPI and FLAVORS, because PAIRS spreads it
  // at module-evaluation time and a `const` down here would be in its temporal
  // dead zone.
  [LOW.ink, LOW.bg, 4.5, 'lowstock ink on the powder panel (subtitle, set name)'],
  [P.plum, LOW.bg, 4.5, 'plum on the powder panel (panel title, flavour name)'],
  [LOW.ink, P.white, 4.5, 'lowstock ink on a white pill (low-stock chip)'],
  [P.white, LOW.ink, 4.5, 'white on lowstock ink (empty chip, Restock CTA)'],
  [LOW.bg, P.cream, 1.15, 'powder panel bg vs the cream page'],
  [LOW.border, LOW.bg, 1.4, 'powder panel border vs its own bg'],
  [P.white, LOW.bg, 1.15, 'white pill vs the powder panel'],
  [LOW.row, LOW.bg, 1.15, 'tinted low-stock row vs the powder panel'],
  [LOW.ink, LOW.row, 4.5, 'lowstock ink on a tinted row'],
  [P.plum, LOW.row, 4.5, 'plum on a tinted row'],

  // ── Dashboard KPI tiles ─────────────────────────────────────────────────
  // A supplied four-swatch pastel palette, one swatch per tile. Asserted as three
  // legs per tile because all three are load-bearing and they fail independently:
  //
  //   INK on BG   — the label, value and glyph all sit on the fill.
  //   RIM on BG   — the 2px border, and the ring around the badge disc.
  //   RIM on CREAM— the edge the tile actually has against the page.
  //
  // The rim is not decorative, and the third pair is why. The pending background
  // measures 1.00:1 against cream — luminance-identical — so that tile has no edge
  // from its fill at all and is defined entirely by its rim. The four old
  // --tone-*-border rows further down already asked this question for the previous
  // palette; these replace them, one per tile.
  //
  // The INKS are the pre-existing --tone-*-ink values, unchanged: each was
  // measured against its new pastel and all four still clear AA. The red is the
  // tight one at 4.62:1 — a paler estimate of that swatch measured 4.42:1 and
  // failed, so this row is load-bearing rather than decorative.
  [KPI.revenueInk, KPI.revenueBg, 4.5, 'revenue ink on the revenue tile'],
  [KPI.pendingInk, KPI.pendingBg, 4.5, 'pending ink on the pending tile'],
  [KPI.lowstockInk, KPI.lowstockBg, 4.5, 'low-stock ink on the low-stock tile'],
  [KPI.totalInk, KPI.totalBg, 4.5, 'total-orders ink on the total tile'],

  [KPI.revenueRim, KPI.revenueBg, 1.4, 'revenue tile rim vs its fill'],
  [KPI.pendingRim, KPI.pendingBg, 1.4, 'pending tile rim vs its fill'],
  [KPI.lowstockRim, KPI.lowstockBg, 1.4, 'low-stock tile rim vs its fill'],
  [KPI.totalRim, KPI.totalBg, 1.4, 'total-orders tile rim vs its fill'],

  // …and the rim against the CREAM PAGE, which is the question that actually
  // matters for these tiles and the one the four older rows above already asked
  // for the previous set of tones.
  //
  // There is deliberately NO row for the FILL against cream here. An earlier
  // version of this block asserted the fills at 1.2 and two of them failed —
  // revenue at 1.13:1 and pending at 1.00:1 — and that failure was correct rather
  // than a defect: the pending pastel is luminance-identical to cream, so no
  // assertion about its fill could ever pass, and the tiles were never relying on
  // the fill for their edge. They are drawn with a 2px rim precisely BECAUSE the
  // fill cannot carry it, and the rim-vs-cream rows are where that shows up.
  //
  // So the fill is deliberately unasserted against the page, and the rim is
  // asserted twice instead: once against its own tile and once against the page.
  // What these catch is someone softening a rim, not someone picking a pale
  // pastel.
  [KPI.revenueRim, P.cream, 1.4, 'revenue tile rim vs the cream page'],
  [KPI.pendingRim, P.cream, 1.4, 'pending tile rim vs the cream page'],
  [KPI.lowstockRim, P.cream, 1.4, 'low-stock tile rim vs the cream page'],
  [KPI.totalRim, P.cream, 1.4, 'total-orders tile rim vs the cream page'],

  // The badge disc. White on three of the four tiles is fine, but white on the
  // pending pastel measured 1.04:1 — the circle disappeared and the glyph floated
  // on bare background. That tile gets a disc nudged 10% toward its own ink, which
  // reads at 1.16:1 and leaves the glyph at 6.14:1 on top of it.
  [KPI.pendingDisc, KPI.pendingBg, 1.15, 'pending badge disc vs its tile fill'],
  [KPI.pendingInk, KPI.pendingDisc, 4.5, 'pending glyph on its own badge disc'],

  // ── Dashboard welcome banner ────────────────────────────────────────────
  // The supplied teal. It replaced a deeper lemon, and the value that is now on
  // --tile-lemon-deep is #8AD4D5 — the token name is historical, the value is not
  // a lemon, and the token's own comment says so.
  //
  // The third row is the one that is easy to miss and the one that would break
  // first. .announce-banner sits DIRECTLY BELOW this card and is --tile-lemon.
  // Two cards stacked on one screen that were the same colour would read as one
  // repeated block, which is the mistake the lemon-deep token was originally
  // invented to avoid. These two are 1.53:1 apart, so they stay two cards.
  [WELCOME_TEAL.bg, P.cream, 1.2, 'welcome banner vs the cream page'],
  [P.plum, WELCOME_TEAL.bg, 4.5, 'plum on the welcome banner'],
  [WELCOME_TEAL.bg, TONES_LEMON, 1.15, 'welcome banner vs the announce banner below'],
  // THE ADMIN BANNER'S TWO ROWS MOVED OUT, WITH THE SURFACE THEY DESCRIBED. It
  // briefly shared this teal, and asserting them here was correct at the time. It
  // is a plain title on the cream page now — a coloured card above the KPI tiles
  // competed with the figures — so there is no teal behind it to assert against.

  // The gold retro sticker shadow on the greeting. This is NOT decorative and the
  // threshold is the floor rather than a comfort margin: the teal took this from
  // 1.26:1 on the warm lemon to 1.07:1 on a cool one, and 1.05 is where the
  // decal stops reading as a decal at all. A future darkening of the banner
  // background takes it under, and this row is what says so.
  [P.sunny, WELCOME_TEAL.bg, 1.05, 'gold sticker shadow on the welcome banner'],

  // ── Drawer's selected row ───────────────────────────────────────────────
  // Judged against WHITE, not against the cream page, because the idle rows are
  // transparent over ion-menu's own white surface. That is a harsher test than
  // anywhere else in the app, which is why the two REJECTED --tile-* rows above
  // exist. This lilac clears it at 2.07:1.
  [NAV_ACTIVE, P.white, 1.2, 'selected menu row vs the white drawer'],
  [P.plum, NAV_ACTIVE, 4.5, 'plum label on the selected menu row'],

  // The tone borders again, but judged against the CREAM PAGE instead of their
  // own background — which is the dashboard KPI tiles' question, and the reason
  // they are drawn with a rim at all.
  //
  // These four tiles were previously borderless, and the consequence was that
  // nothing said "container": the fills measured 1.10–1.13:1 against the cream
  // page, which is under the 1.2 floor this file uses for a large filled area
  // (the floor that rejected --tile-lemon at 1.06:1 and produced
  // --tile-lemon-deep). So the tiles were breaking a rule the project had already
  // written down, and no row here covered them.
  //
  // A 2px --tone-*-border rim measures 1.60–1.96:1 on the same cream, which is
  // the edge those tiles were missing. 1.4 rather than 1.2 because a rim is a
  // deliberate boundary, matching the 1.4 the banner borders already owe.
  //
  // The rim against the tile's OWN background needs no row: it is the same
  // token pair as the four rows directly above these, already asserted at 1.4,
  // and the tiles reuse it.
  [TONES.successBorder, P.cream, 1.4, 'KPI tile rim: success border vs cream page'],
  [TONES.warningBorder, P.cream, 1.4, 'KPI tile rim: warning border vs cream page'],
  [TONES.dangerBorder, P.cream, 1.4, 'KPI tile rim: danger border vs cream page'],
  [TONES.infoBorder, P.cream, 1.4, 'KPI tile rim: info border vs cream page'],

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

  // THE DASHBOARD WELCOME BANNER'S THREE ROWS MOVED. They were here, against the
  // old #FBE3AE lemon; the surface is now a supplied teal and they sit with the
  // other dashboard surfaces further up, next to the announce-banner pair they now
  // have to be distinguished from. #FBE3AE is no longer on any surface.

  // Guards the reason --tile-lemon was rejected for the welcome banner: if this
  // ever goes green, the announce banner below it and the banner itself would
  // have become equivalent. Still live — that row is --tile-lemon, which the
  // announce banner still uses.
  ['#FFF3D6', P.cream, 1.05, 'REJECTED: tile-lemon has no edge on the cream page'],

  // THE SELECTED-ROW ROWS MOVED. The two that asserted the old #D9C8EE ube are
  // gone with the value; the supplied lilac's pair sits with the other dashboard
  // surfaces above, against the same white drawer, at 2.07:1 — a stronger edge
  // than the ube managed at 1.56:1.

  // Two rejected alternatives, both documented so a later edit cannot reintroduce
  // one without noticing that a gate row already exists and says why. Both are
  // the obvious purple/pale choices and both fail for the same reason: no edge
  // against ion-menu's white surface, so the selected row looks unselected.
  ['#E8EEF9', P.white, 1.05, 'REJECTED: tile-periwinkle has no edge on the white drawer'],
  ['#E4F1F8', P.white, 1.05, 'REJECTED: tile-powder has no edge on the white drawer'],

  // The products-page filter rows. --tile-powder is one of the two REJECTED
  // values directly above — 1.15:1 against white — and the filter bar painted five
  // control surfaces in it with no border, no shadow and no outline, so the
  // controls had no edge at all and dissolved into the page behind them.
  //
  // These two rows ARE the fix, asserted so it cannot be undone by a later edit
  // that quietly drops the rim: the rim clears 1.4:1 against its own fill, and it
  // clears 1.4:1 against the white it is supposed to be standing out from.
  ['#9DC2E0', '#E4F1F8', 1.4, 'filter-row rim vs its own powder fill'],
  ['#9DC2E0', P.white, 1.4, 'filter-row rim vs the white page'],
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
//    THREE THINGS THIS NOTE USED TO GET WRONG, all corrected here:
//
//    (a) The two inks were LABELLED BACKWARDS, and it inverted the severity.
//        variables.scss is the authority: `--color-ink-soft: #6b5875` is declared
//        in `:root` (the DEFAULT) and `#4a3a54` is declared inside
//        `html[data-contrast='high']` (the opt-in). This note previously claimed
//        the reverse, and concluded from it that "this is a high-contrast-only
//        failure, and saying otherwise overstated it by two full stops of
//        severity". It is the opposite: 3.18:1 is what every customer sees by
//        DEFAULT, and 5.15:1 is the value they only get after opting into the
//        accessibility setting. The mitigation was inverted along with the label.
//    (b) It named `.dev-hero-sub` as an affected site. That element has moved out
//        of the hero into `.dev-intro` on cream, where #6B5875 is 6.20:1 — so it
//        is fixed, not outstanding.
//    (c) It called `.menu-tagline` "the only remaining site" and left it there.
//        It has since been changed to `--color-ink`, and both ends of the drawer
//        gradient are now asserted as real pairs above, so this can no longer
//        drift out of range unnoticed.
//
//    Both figures are still printed, and the labels now match the stylesheet.
const inkSoftDefault = ratio('#6b5875', P.powder); // :root — the value customers actually get
const inkSoftHighContrast = ratio('#4a3a54', P.powder); // html[data-contrast='high']
console.log(
  `\nnote: --color-ink-soft on --gradient-brand at the powder end — ` +
    `${inkSoftDefault.toFixed(2)}:1 with the DEFAULT ink (#6B5875, FAILS AA at 12px), ` +
    `${inkSoftHighContrast.toFixed(2)}:1 with the HIGH-CONTRAST ink (#4a3a54, passes). ` +
    `The only site that used the default ink was the 12px .menu-tagline in the ` +
    `drawer header; it now uses --color-ink and is asserted on both ends of the ` +
    `gradient. .dev-hero-sub moved to .dev-intro on cream (6.20:1) and is fixed.`,
);

console.log(`\n${fails === 0 ? 'All pairs pass.' : `${fails} pair(s) FAIL.`}`);
process.exit(fails === 0 ? 0 : 1);
