// .prettierrc.js
// Five-orites Scoop — Prettier
//
// WHY THIS IS .js AND NOT .json
// The reasoning behind each setting is worth more than the setting, and JSON
// cannot hold a comment. Two files in this repo (.eslintrc.js and this one)
// therefore carry prose that a future contributor will actually read before
// changing something.
//
// WHY SINGLE QUOTES AND 100 COLUMNS
// Single quotes because that is what the entire existing codebase uses, without
// exception. A formatter that disagrees with the code produces a diff touching
// every file and achieves nothing.
//
// 100 columns because the existing code is already written to roughly that
// width. `printWidth` is here a description of what is there, not a preference.
//
// `trailingComma: "all"` because that is the TypeScript 3+ default and what the
// code already does. An "es5" default would strip trailing commas from
// multi-line argument lists on save, which is pure noise in review.
//
// NOTE: this file is in .prettierignore, so prettier will not try to reformat
// its own configuration. There is a recursion problem otherwise.

module.exports = {
  singleQuote: true,
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  trailingComma: 'all',
  bracketSpacing: true,
  arrowParens: 'always',
  // Stored LF in the repository. Without this, prettier on Windows writes CRLF
  // and every file shows as modified on a Unix checkout.
  endOfLine: 'lf',
  overrides: [
    {
      files: '*.html',
      options: {
        parser: 'angular',
        // Ionic's custom elements are deliberately kept on one line per element
        // with their attributes together. A 100-column width reflows them and
        // the diff is unreadable.
        printWidth: 120,
      },
    },
    {
      files: ['*.json', '*.yml', '*.yaml'],
      options: { printWidth: 120 },
    },
    {
      files: '*.md',
      options: {
        // "preserve" rather than "always": the README and Docs use hard-wrapped
        // prose and tables, and rewrapping them produces a diff that touches
        // every line and changes nothing about the content.
        proseWrap: 'preserve',
      },
    },
  ],
};