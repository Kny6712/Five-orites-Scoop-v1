// Validates the proposed palette against WCAG 2.1 AA before it goes into
// variables.scss. Guessing contrast ratios is how "accessible redesign" turns
// out not to be, so this computes them.
//
//   node scripts/check-contrast.mjs

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
  strawberry: '#FF6B8A',
  strawberryDeep: '#D93A62',
  mint: '#5FD9B4',
  mintDeep: '#12866A',
  sunny: '#FFC53D',
  sunnyDeep: '#8A5B00',
  plum: '#3D2B45',
  cream: '#FFF9F4',
  white: '#FFFFFF',
};

// [foreground, background, requirement, label]
const PAIRS = [
  [P.plum, P.cream, 4.5, 'body text on cream'],
  [P.plum, P.white, 4.5, 'body text on white card'],
  [P.white, P.strawberry, 4.5, 'WHITE on strawberry (primary button?)'],
  [P.white, P.strawberryDeep, 4.5, 'WHITE on strawberryDeep (primary button?)'],
  [P.plum, P.strawberry, 4.5, 'plum text on strawberry'],
  [P.plum, P.sunny, 4.5, 'plum text on sunny'],
  [P.sunnyDeep, P.sunny, 4.5, 'sunnyDeep text on sunny'],
  [P.mintDeep, P.cream, 4.5, 'mintDeep text on cream'],
  [P.plum, P.mint, 4.5, 'plum text on mint'],
  [P.white, P.mintDeep, 4.5, 'white on mintDeep'],
  [P.white, P.sunnyDeep, 4.5, 'white on sunnyDeep'],
  // Non-text UI components only need 3:1 (WCAG 1.4.11)
  [P.strawberry, P.cream, 3, 'strawberry border/icon on cream'],
  [P.mintDeep, P.cream, 3, 'mintDeep border/icon on cream'],
  [P.sunnyDeep, P.cream, 3, 'sunnyDeep border/icon on cream'],
];

let fails = 0;
console.log('ratio  req   verdict  pair');
console.log('-----  ----  -------  ----------------------------------------');
for (const [fg, bg, req, label] of PAIRS) {
  const r = ratio(fg, bg);
  const ok = r >= req;
  if (!ok) fails++;
  console.log(
    `${r.toFixed(2).padStart(5)}  ${String(req).padStart(4)}  ${(ok ? 'PASS' : 'FAIL').padStart(7)}  ${label}`
  );
}
console.log(`\n${fails === 0 ? 'All pairs pass.' : `${fails} pair(s) FAIL.`}`);
