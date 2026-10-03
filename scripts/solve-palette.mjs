// Finds the darkest-on-brand / light-on-cream variants that actually pass WCAG AA,
// by walking each hue darker until the ratio clears the threshold. The bright
// pastel stays available for surfaces that carry PLUM text on them; only the
// text-bearing variants get pushed down.
//
//   node scripts/solve-palette.mjs

const hex = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const toHex = (rgb) =>
  '#' +
  rgb
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();

const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

/** Darken by scaling toward black until `target` is met against `against`. */
function darkenUntil(startHex, againstHex, target) {
  let rgb = hex(startHex);
  for (let step = 0; step <= 100; step++) {
    if (ratio(rgb, hex(againstHex)) >= target) {
      return { hex: toHex(rgb), ratio: ratio(rgb, hex(againstHex)), steps: step };
    }
    rgb = rgb.map((v) => v * 0.97);
  }
  return null;
}

const CREAM = '#FFF9F4';
const WHITE = '#FFFFFF';

const TARGETS = [
  ['strawberry  (white text on it)', '#FF6B8A', WHITE, 4.5],
  ['mint        (text/icon on cream)', '#5FD9B4', CREAM, 4.5],
  ['mint        (white text on it)', '#5FD9B4', WHITE, 4.5],
  ['sunny       (text/icon on cream)', '#FFC53D', CREAM, 4.5],
  ['strawberry  (border/icon on cream)', '#FF6B8A', CREAM, 3.0],
];

console.log('role                              start     result    ratio  darken-steps');
console.log('--------------------------------  --------  --------  -----  -------------');
for (const [label, start, against, target] of TARGETS) {
  const r = darkenUntil(start, against, target);
  if (!r) {
    console.log(`${label.padEnd(32)}  ${start}  IMPOSSIBLE`);
    continue;
  }
  console.log(
    `${label.padEnd(32)}  ${start}  ${r.hex}  ${r.ratio.toFixed(2).padStart(5)}  ${String(r.steps).padStart(13)}`,
  );
}

// Also report the full bright ramp so we know what the decorative surfaces give.
console.log('\nBright decorative surfaces (carry PLUM text, ratio in brackets):');
const PLUM = hex('#3D2B45');
for (const [name, c] of [
  ['strawberry', '#FF6B8A'],
  ['mint', '#5FD9B4'],
  ['sunny', '#FFC53D'],
]) {
  console.log(`  ${name.padEnd(10)} ${c}  [${ratio(PLUM, hex(c)).toFixed(2)}:1]`);
}
