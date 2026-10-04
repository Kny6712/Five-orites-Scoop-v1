// Five-orites Scoop — lint-staged
//
// Run from .husky/pre-commit over staged files only.
//
// WHY `//` AND NOT `#` FOR THESE COMMENTS — this file was previously commented
// with `#` and every commit failed on Node 24 with:
//
//   ✖ Failed to read config from file ".../.lintstagedrc.js"
//   ✖ No valid configuration found.
//   husky - pre-commit script failed (code 1)
//
// Node treats a `#` on the FIRST LINE of a `.js` file as a hashbang prefix, and
// only accepts it in the `#!` form. A leading `# comment` is a SyntaxError
// ("Invalid or unexpected token"), so the file could not be loaded at all. A
// `//` comment is unambiguous on every Node version, so the config no longer
// depends on which one is installed.
//
// Note this was never caught earlier because it is version-dependent, and
// nothing else in the repo reads this file: `npm run lint` and `npm run
// format:check` read their globs from package.json, so the whole verify chain
// stayed green while the pre-commit hook was dead on arrival. Worth knowing that
// `npm run verify` does NOT cover the hook.
//
// Order matters. Prettier/formatter runs FIRST so that eslint --fix then operates
// on already-formatted source: running them the other way round means the
// formatter's output can reintroduce something the linter would flag, and the
// next commit fixes it again. Formatting then linting avoids that loop.
module.exports = {
  '*.{ts,html}': [
    'prettier --write',
    'eslint --fix --max-warnings=0',
  ],
  '*.{json,yml,yaml,scss,md}': [
    'prettier --write',
  ],
  // Only checks. Rewriting a lockfile produces a diff npm did not produce, and
  // npm owns it. Same reasoning as .prettierignore.
  'package-lock.json': [],
  'functions/package-lock.json': [],
  // No parser exists for the Firestore rules language. Formatting it by hand
  // would fight the deliberate alignment in its comment blocks.
  'firestore.rules': [],
};
