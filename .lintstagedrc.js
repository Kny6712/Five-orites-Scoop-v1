# Five-orites Scoop — lint-staged
#
# Run from .husky/pre-commit over staged files only.
#
# Order matters. Prettier/formatter runs FIRST so that eslint --fix then operates
# on already-formatted source: running them the other way round means the
# formatter's output can reintroduce something the linter would flag, and the
# next commit fixes it again. Formatting then linting avoids that loop.
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