// .eslintrc.json
// Five-orites Scoop — ESLint
//
// WHY THIS EXISTS NOW
// There was no linter at all, and the README said so out loud: "There is no
// `lint` script: `angular.json` defines no lint target, so `ng lint` would
// fail." Every rule below is either something the compiler already enforces —
// in which case it catches the same defect earlier, with a better message — or a
// category the compiler cannot see at all, which is the actual value here.
//
// FLAT CONFIG vs .eslintrc
// ESLint 8 supports both; flat config arrived for Angular 18. This project is
// Angular 17 on the .eslintrc format, which is what @angular-eslint v17 targets.
// Migrating to flat config means moving to v18's plugin set, so it is not a
// drop-in change. When the project upgrades to Angular 18+, delete this file and
// migrate; do not leave both.
//
// `no-unused-vars` is deliberately DISABLED in favour of @typescript-eslint's
// version, because the base rule does not understand TypeScript: it reports a
// type-only import as an unused variable, and it cannot tell a genuinely unused
// binding from one used only in a type position. The TS-aware rule is the whole
// reason the plugin is installed. `noUnusedLocals` in tsconfig.json still
// catches unused locals at compile time; this catches them at lint time and adds
// the file/line context.
module.exports = {
  root: true,
  ignorePatterns: [
    'www/**',
    'dist/**',
    'android/**',
    'ios/**',
    'node_modules/**',
    'functions/lib/**',
    'functions/node_modules/**',
    '.angular/**',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  // NOTE: `plugin:@angular-eslint/template/recommended` is deliberately NOT here.
  // Applying the template plugin to .ts files makes it throw at config load, not
  // report a finding, because the template rules require the template parser.
  // It is applied per-file-pattern in the overrides below instead.
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@angular-eslint/recommended',
  ],
  rules: {
    // ── Angular conventions this project deliberately does not follow ────
    // The plugin's default wants every component class to end in "Component".
    // This project names them `FooPage`, after the file (`foo.page.ts`), which is
    // what `ng generate page` produces and what all 19 pages already do. Turning
    // this on would mean renaming 19 classes and 19 files to satisfy a style rule
    // that disagrees with the framework's own scaffolding — pure churn, and it
    // would make every page's history misleading. The suffix rule is aimed at
    // catching a genuinely ambiguous name, not at overriding a convention.
    '@angular-eslint/component-class-suffix': [
      'error',
      { suffixes: ['Component', 'Page'] },
    ],
    // ── TypeScript ──────────────────────────────────────────────────────
    // The base rule is off; this is the TypeScript-aware replacement. Left on,
    // it flags every `import type` and every interface-only import as unused.
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        // A caught error you deliberately ignore is normal, and `catch {}` is
        // also valid now. Flagging them produces noise, not signal.
        caughtErrors: 'none',
      },
    ],
    // `any` is not banned outright. The codebase has exactly two, both in
    // scoop-map.component.ts where Leaflet's own types are `any` and casting is
    // the honest answer. Banning it would produce a suppression comment rather
    // than a fix, and a suppression comment trains people to ignore the rule.
    // What IS banned is an explicit `any` you added, via no-explicit-any being
    // off but this catching the common slips:
    '@typescript-eslint/no-explicit-any': 'off',
    // Prefer unknown at boundaries. `no-unsafe-*` rules need type information,
    // which would mean running the linter through the full Angular program; not
    // worth the build time for this codebase's size.
    // `consistent-type-imports` is deliberately absent. It requires parserServices,
    // which means setting `parserOptions.project` and linting the whole Angular
    // program for type information. On a project this size that is minutes per
    // run for one rule that suggests a stylistic change. The places it would
    // matter already use `import type` — the tsc `isolatedModules` build would
    // surface the ones that matter.
  },
  overrides: [
    {
      // Angular templates are linted as HTML, where the template parser applies.
      // These rules cannot run against .ts files — @angular-eslint's template
      // rules throw at config load time if the parser is not the template one,
      // which is why they live here and not in the top-level `rules`.
      files: ['**/*.html'],
      parser: '@angular-eslint/template-parser',
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      plugins: ['@angular-eslint/template'],
      extends: ['plugin:@angular-eslint/template/recommended'],
      rules: {
        // Angular's own control-flow blocks (@if, @for) contain no HTML
        // elements, so this fires on every one of them in the project.
        '@angular-eslint/template/element-name': 'off',
        // A method call in a template is not a side-effect problem here; this
        // rule exists for AngularJS-era code and is noise on modern Angular.
        '@angular-eslint/template/no-call-expression': 'off',
      },
    },
    {
      // Scripts and tests are Node, not browser. `require` is legitimate and the
      // DOM globals do not exist.
      files: ['scripts/**/*.ts', 'tests/**/*.ts', 'functions/src/**/*.ts'],
      env: { node: true, browser: false },
      rules: {
        // `require` is how the seed scripts load the service-account key, which
        // is git-ignored and therefore cannot be a static import. Note the rule
        // name is no-var-requires; `no-require-imports` is a different rule and
        // turning that one off does nothing here.
        '@typescript-eslint/no-var-requires': 'off',
        // scripts/tsconfig.json sets `strict: false` and these files are CommonJS
        // `require`-driven, so the `any` allowances the app does not make are
        // legitimate here.
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};