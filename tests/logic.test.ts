// tests/logic.test.ts
// Five-orites Scoop — business logic tests
//
// These import the REAL implementations from src/app/core/logic. The previous
// version of this file re-implemented every rule inline, so it would still pass
// if the app itself were deleted. Do not inline logic here — import it.
//
// Run: npm run test:logic

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DELIVERY_FEE,
  FREE_DELIVERY_THRESHOLD,
  getDeliveryFee,
} from '../src/app/core/logic/delivery';
import { calculateDiscount, MAX_PERCENT_DISCOUNT } from '../src/app/core/logic/voucher';
import { summarizeRatings } from '../src/app/core/logic/rating';
import {
  assertCanAddToCart,
  clampToStock,
  normaliseStockLines,
  totalStock,
  SIZE_VARIANTS,
} from '../src/app/core/logic/stock';
import {
  reconcileSize,
  RESET_REASONS,
  RECONCILE_SIZES,
  STOCK_REASON_LABELS,
} from '../src/app/core/logic/ledger-reconcile';
import { flavourOf, initialsOf } from '../src/app/core/logic/flavor';
import { buildCloudinaryUrl } from '../src/app/core/logic/image-url';
import {
  describeFirestoreError,
  isMissingIndexError,
  isPermissionDeniedError,
} from '../src/app/core/logic/firestore-error';
import {
  buildNotificationFeed,
  countUnread,
  groupByDay,
  relativeTime,
  toEpochMs,
  asOrderStatus,
  ORDER_STATUS_NOTICES,
  statusToastLine,
  FEED_LIMIT,
} from '../src/app/core/logic/notifications';
import { readCachedGeo, interpolate, distanceMetres } from '../src/app/core/logic/geo';
import { productCategory, PRODUCT_CATEGORIES } from '../src/app/core/models/product.model';
import * as voucherModel from '../src/app/core/models/voucher.model';
import { toCsv, sanitiseCell, csvFilename, toIsoDate } from '../src/app/core/logic/csv';
import {
  calendarBuckets,
  weeklyBuckets,
  bucketsFor,
  bucketize,
  runningTotal,
} from '../src/app/core/logic/series';
import {
  parseCsvLine,
  parseProductCsv,
  slug,
  PRODUCT_CSV_TEMPLATE,
} from '../src/app/core/logic/csv-import';
import {
  ROLE_CAPABILITIES,
  ROLE_LABELS,
  ROLE_RANK,
  can,
  isStaffRole,
  asRole,
  type Capability,
  type UserRole,
} from '../src/app/core/models/user.model';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fnConfig from '../functions/src/config';
// ── Role / capability model ───────────────────────────────────────────────
// THE PRODUCTION INCIDENT: a user document's `role` read `"owner\n"` (a
// trailing newline from a hand edit in the Firebase console). Both the client
// (`can()` → ROLE_CAPABILITIES[role] → undefined → fail closed) and
// firestore.rules (`myRole() in [...]`) compare role strings EXACTLY, so the
// owner silently lost every admin page with no error anywhere. These tests pin
// the capability map's internal invariants and — crucially — that the client
// fails closed on the whole malformed-role corpus. The paired emulator test in
// firestore.rules.test.ts ('a role of "owner\n" gets NOTHING') is the other
// half; this half is the client. If either layer ever starts normalizing, the
// other half must too, or the split-brain returns.

const ALL_ROLES: UserRole[] = ['customer', 'staff', 'manager', 'admin', 'owner'];
const ALL_CAPABILITIES: Capability[] = [
  'view_dashboard',
  'manage_orders',
  'manage_inventory',
  'view_analytics',
  'manage_vouchers',
  'moderate_reviews',
  'manage_users',
  'manage_settings',
];

/** Every way a hand-entered role string can be wrong. All must fail closed. */
const MALFORMED_ROLES = [
  'owner\n',
  'owner\n\n',
  'owner ',
  ' owner',
  '\towner',
  'owner\t',
  'admin\n',
  'staff ',
  'Manager',
  'OWNER',
  'owner\r\n',
  'superuser',
  'adminx',
  '',
  '  ',
] as const;

describe('role tiers: the capability map', () => {
  it('grants a customer nothing at all', () => {
    for (const cap of ALL_CAPABILITIES) {
      assert.equal(can('customer', cap), false, `customer must not hold ${cap}`);
    }
  });

  it('never lets a LOWER tier hold a capability a HIGHER tier lacks', () => {
    // staff ⊂ manager ⊂ admin ⊂ owner. This is the invariant the whole ladder
    // rests on; widening a lower row past a higher one is a security bug.
    const chain: UserRole[] = ['staff', 'manager', 'admin', 'owner'];
    for (let i = 1; i < chain.length; i++) {
      for (const cap of ROLE_CAPABILITIES[chain[i - 1]]) {
        assert.ok(
          ROLE_CAPABILITIES[chain[i]].includes(cap),
          `${chain[i]} must keep ${cap}, which ${chain[i - 1]} has`,
        );
      }
    }
  });

  it('keeps manage_users and manage_settings OWNER-only', () => {
    // These two ARE the owner tier. `canManageUsers()` in firestore.rules is the
    // authoritative server-side copy of exactly this restriction.
    for (const role of ALL_ROLES) {
      for (const cap of ['manage_users', 'manage_settings'] as Capability[]) {
        assert.equal(can(role, cap), role === 'owner', `${role} / ${cap}`);
      }
    }
  });

  it('grants nothing outside the declared Capability union', () => {
    for (const role of ALL_ROLES) {
      for (const cap of ROLE_CAPABILITIES[role]) {
        assert.ok(ALL_CAPABILITIES.includes(cap), `${cap} is not a declared capability`);
      }
    }
  });

  it('declares no dead capability — every member is referenced by a grant or a guard', () => {
    // A capability that is declared but never granted/used is a lie the model
    // tells admins (ROLE_SUMMARY is shown in the promotion dialog). Guard against
    // the `repair_stock` class of defect: every declared capability must appear in
    // at least one ROLE_CAPABILITIES row.
    const granted = new Set(ALL_ROLES.flatMap((r) => [...ROLE_CAPABILITIES[r]]));
    for (const cap of ALL_CAPABILITIES) {
      assert.ok(granted.has(cap), `${cap} is declared but granted to nobody`);
    }
    for (const cap of granted) {
      assert.ok(ALL_CAPABILITIES.includes(cap), `${cap} is granted but not declared`);
    }
  });

  it('has a label, a rank and promotion-dialog copy for every tier', () => {
    for (const role of ALL_ROLES) {
      assert.ok(ROLE_LABELS[role].length > 0, `${role} label`);
      assert.equal(typeof ROLE_RANK[role], 'number', `${role} rank`);
    }
  });

  it('ranks the tiers ascending in privilege, as ROLE_CAPABILITIES declares them', () => {
    assert.deepEqual(
      [...ALL_ROLES].sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]),
      ALL_ROLES,
    );
  });
});

describe('can() — the malformed-role corpus from the incident', () => {
  it('grants on an EXACT match only', () => {
    assert.equal(can('owner', 'manage_users'), true);
    assert.equal(can('staff', 'view_dashboard'), true);
    assert.equal(can('manager', 'manage_inventory'), true);
    assert.equal(can('admin', 'manage_vouchers'), true);
  });

  it('fails CLOSED on every malformed role string — including "owner\\n"', () => {
    for (const bad of MALFORMED_ROLES) {
      assert.equal(can(bad, 'manage_users'), false, `can(${JSON.stringify(bad)})`);
      assert.equal(isStaffRole(bad), false, `isStaffRole(${JSON.stringify(bad)})`);
    }
  });

  it('fails CLOSED on null and undefined', () => {
    for (const bad of [null, undefined]) {
      assert.equal(can(bad, 'view_dashboard'), false);
      assert.equal(isStaffRole(bad), false);
    }
  });

  it('is exactly what isStaffRole is built from, so the two cannot disagree', () => {
    for (const role of [...ALL_ROLES, ...MALFORMED_ROLES]) {
      assert.equal(isStaffRole(role), can(role, 'view_dashboard'), JSON.stringify(role));
    }
  });
});

describe('asRole()', () => {
  it('passes the four staff tiers through', () => {
    for (const role of ['staff', 'manager', 'admin', 'owner'] as UserRole[]) {
      assert.equal(asRole(role), role);
    }
  });

  it('maps anything else to customer — INCLUDING a malformed staff role', () => {
    for (const bad of [...MALFORMED_ROLES, null, undefined, 42, {}, ['owner']]) {
      assert.equal(asRole(bad as never), 'customer', JSON.stringify(bad));
    }
  });

  it('never reports a rank for a value it did not normalise', () => {
    assert.equal(ROLE_RANK[asRole('owner\n' as never)], ROLE_RANK.customer);
  });
});

// ── Client ↔ rules drift lint ─────────────────────────────────────────────
// The client and firestore.rules are two hand-maintained sources of truth with
// no shared definition. Four of the security findings in the last audit existed
// ONLY because they drifted. This parses the deployed rules file and asserts the
// role sets agree with the client model, so a future edit to one without the
// other fails CI instead of silently widening or narrowing access.
describe('client ↔ firestore.rules drift lint', () => {
  const rulesPath = join(process.cwd(), 'firestore.rules');
  let rules: string;
  try {
    rules = readFileSync(rulesPath, 'utf8');
  } catch {
    rules = '';
  }

  const hasRules = rules.length > 0;

  it('finds the rules file to lint against', () => {
    assert.ok(hasRules, 'firestore.rules must be readable for the drift lint');
  });

  it('the rules isStaff tier set matches the client staff roles', () => {
    if (!hasRules) return;
    const m = rules.match(/myRole\(\) in \[([^\]]+)\]/);
    assert.ok(m, 'isStaff() role list not found in firestore.rules');
    const rulesSet = m![1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .sort();
    const clientStaff = ALL_ROLES.filter((r) => r !== 'customer').sort();
    assert.deepEqual(rulesSet, clientStaff, 'isStaff() set drifted from the client staff roles');
  });

  /**
   * Every field `updateProfile` can write must be permitted by the rules branch
   * that governs it.
   *
   * This is the third time a client write and a rules allow-list have drifted
   * apart, and the third time nothing noticed:
   *
   *   - `stockRestored` appeared in NO allow-list, so the admin stock-repair
   *     panel was PERMISSION_DENIED for every role including owner.
   *   - `notificationsReadAt` was omitted from all THREE `users` update lists, so
   *     tapping any notification produced "Could not update your
   *     notifications" for customer, staff, admin and owner alike.
   *
   * The pattern is the same each time and it is not a typo problem. `users/{uid}`
   * is written through `setDoc(..., { merge: true })` with a `hasOnly` guard, and
   * adding a field to the model and to `ProfilePatch` is invisible from the rules
   * file. Both halves were individually correct and each had its own tests; no
   * test asserted that they agreed, so the join was untested by construction.
   *
   * So this asserts the join directly: read `ProfilePatch` out of the service,
   * read the allow-lists out of the rules, and require that a field the client
   * can write is a field the rules let that role write. Drift becomes a red test
   * at the moment someone adds the field, which is the only moment it is cheap.
   */
  describe('ProfilePatch and the rules user-update allow-lists agree', () => {
    const authSrc = readFileSync(
      join(__dirname, '..', 'src', 'app', 'core', 'services', 'auth.service.ts'),
      'utf8',
    );

    /** Field names declared on the ProfilePatch interface. */
    function profilePatchFields(): string[] {
      const body = authSrc.match(/export interface ProfilePatch \{([\s\S]*?)\n\}/)?.[1] ?? '';
      assert.ok(body, 'ProfilePatch interface not found in auth.service.ts');
      return [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
    }

    /**
     * The three lists that gate a write to a user document, kept SEPARATE.
     *
     * There are three, and they are not all in the same place: two sit inside the
     * `users/{uid}` match block (the owner branch and the self-service branch)
     * and the third, `isAdminUserEdit()`, is a helper defined far above it.
     *
     * They are deliberately not unioned. An earlier version of this guard took
     * the union of all three, which passed while a field was still missing from
     * one of them — so it caught the original all-three-missing bug and would
     * have sailed straight through the far more likely partial fix, where two
     * lists are corrected and the third is forgotten. Per-list is the only
     * formulation that fails on the mistake actually being made.
     */
    function rulesUserAllowLists(): Record<string, Set<string>> {
      if (!hasRules) return {};
      const block = rules.match(/match \/users\/\{uid\} \{([\s\S]*?)\n {4}\}/)?.[1] ?? '';
      const helper = rules.match(/function isAdminUserEdit\(\) \{([\s\S]*?)\n {4}\}/)?.[1] ?? '';
      assert.ok(block, 'users match block not found in firestore.rules');
      assert.ok(helper, 'isAdminUserEdit() helper not found in firestore.rules');

      const fromBlock = [...block.matchAll(/hasOnly\(\[([\s\S]*?)\]\)/g)];
      assert.equal(
        fromBlock.length,
        2,
        'expected the users block to hold exactly two hasOnly lists (owner, self-service)',
      );
      const keysOf = (src: string) => new Set([...src.matchAll(/'([^']+)'/g)].map((m) => m[1]));
      const fromHelper = [...helper.matchAll(/hasOnly\(\[([\s\S]*?)\]\)/g)];
      assert.equal(fromHelper.length, 1, 'expected isAdminUserEdit() to hold one hasOnly list');

      // The self-service list is the shorter of the two in-block lists and the
      // one that does NOT mention `role`; that distinguishes it from the owner
      // branch without depending on statement order.
      const withRole = fromBlock.findIndex((l) => l[1].includes("'role'"));
      const selfIdx = withRole === 0 ? 1 : 0;
      return {
        owner: keysOf(fromBlock[withRole === 0 ? 0 : 1][1]),
        self: keysOf(fromBlock[selfIdx][1]),
        admin: keysOf(fromHelper[0][1]),
      };
    }

    it('finds both sides', () => {
      assert.ok(profilePatchFields().length > 0, 'ProfilePatch must declare at least one field');
      if (!hasRules) {
        assert.ok(
          Object.keys(rulesUserAllowLists()).length === 3,
          'expected three user-update allow-lists',
        );
      }
    });

    it('every client-writable profile field is permitted by EVERY user-update branch', () => {
      if (!hasRules) return;
      const lists = rulesUserAllowLists();
      // `role` and `uid` are deliberately NOT in ProfilePatch: a profile save must
      // never carry them, and AuthService documents that as the reason the merge
      // is safe. They are asserted absent below rather than skipped here.
      const clientWritable = profilePatchFields().filter((f) => f !== 'role' && f !== 'uid');
      for (const [branch, permitted] of Object.entries(lists)) {
        const missing = clientWritable.filter((f) => !permitted.has(f));
        assert.deepEqual(
          missing,
          [],
          `updateProfile can write [${missing.join(', ')}] but the ${branch} branch ` +
            'of the users update rule does not permit it — that role gets ' +
            'PERMISSION_DENIED on every profile save and every notification tap',
        );
      }
    });

    it('the client never sends role or uid through a profile save', () => {
      // The mirror image: the rules protect `role` by keeping it out of the
      // self-service list, which is only safe while the client agrees.
      const fields = profilePatchFields();
      assert.ok(
        !fields.includes('role'),
        'ProfilePatch must not carry `role` — the rules keep it out of the self-service list',
      );
      assert.ok(!fields.includes('uid'), 'ProfilePatch must not carry `uid`');
    });
  });

  it('the rules canRunShop tier set matches the client manage_inventory grants', () => {
    if (!hasRules) return;
    const m = rules.match(
      /function canRunShop\(\)\s*\{\s*return isStaff\(\) && myRole\(\) in \[([^\]]+)\]/,
    );
    assert.ok(m, 'canRunShop() role list not found in firestore.rules');
    const rulesSet = m![1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .sort();
    const clientShop = ALL_ROLES.filter((r) => can(r, 'manage_inventory')).sort();
    assert.deepEqual(
      rulesSet,
      clientShop,
      'canRunShop() set drifted from the client manage_inventory grants',
    );
  });

  it('the rules canManageUsers is owner-only, matching manage_users', () => {
    if (!hasRules) return;
    assert.match(
      rules,
      /function canManageUsers\(\)\s*\{\s*return isStaff\(\) && myRole\(\) == 'owner'/,
    );
    assert.equal(ALL_ROLES.filter((r) => can(r, 'manage_users')).length, 1);
  });

  it('shopSettings write is owner-only in the rules, matching manage_settings', () => {
    if (!hasRules) return;
    // `allow write: if isAdmin()` on shopSettings used to over-grant admin a
    // write the client denies. It must be canManageUsers() (owner) now.
    const shopBlock = rules.match(/match \/shopSettings\/\{docId\}[^{]*\{([^}]*\n[^}]*)\n\s*\}/);
    assert.ok(shopBlock, 'shopSettings match block not found');
    assert.match(shopBlock![1], /allow (create|update): if canManageUsers\(\)/);
    assert.doesNotMatch(shopBlock![1], /allow write: if isAdmin\(\)/);
  });

  it('the orders create rule has a keys() allow-list (laundering defense)', () => {
    if (!hasRules) return;
    const orderCreate = rules.match(/match \/orders\/\{orderId\}[^]*?allow create: if([^;]*);/s);
    assert.ok(orderCreate, 'orders allow create not found');
    assert.match(orderCreate![1], /keys\(\)\.hasOnly\(/, 'orders create must restrict keys');
    assert.match(
      orderCreate![1],
      /grandTotal\s*==?\s*request\.resource\.data\.totalAmount/,
      'grandTotal identity check missing',
    );
  });

  it('a role of "owner\\n" gets NOTHING — the client half of the incident', () => {
    // The rules half of this assertion lives in firestore.rules.test.ts against
    // the emulator. Here we pin the CLIENT half: a trailing-newline owner must
    // NOT reach the admin area, so the UI and the server agree on the outcome.
    assert.equal(isStaffRole('owner\n'), false);
    assert.equal(can('owner\n', 'manage_users'), false);
    assert.equal(can('owner\n', 'manage_settings'), false);
    // ...and the well-formed owner DOES reach them, proving the check is not
    // simply always-false.
    assert.equal(isStaffRole('owner'), true);
    assert.equal(can('owner', 'manage_users'), true);
  });
});

describe('delivery fee', () => {
  // The Cloud Function prices the order the customer is actually charged, from a
  // COPY of these constants (functions/src/config.ts) — the functions package is
  // deployed separately and cannot import from src/. If the two copies drift, the
  // cart quotes one number and the order records another, which is invisible in
  // review and obvious at checkout. So the equality is asserted, not assumed.
  it('the function copy of the delivery fee matches the client copy', () => {
    assert.equal(fnConfig.DELIVERY_FEE, DELIVERY_FEE);
    assert.equal(fnConfig.FREE_DELIVERY_THRESHOLD, FREE_DELIVERY_THRESHOLD);
  });

  it('the function computes the same fee for the same subtotals', () => {
    for (const subtotal of [0, 65, 115, 499, 500, 501, 1000, 5000]) {
      assert.equal(
        fnConfig.getDeliveryFee(subtotal),
        getDeliveryFee(subtotal),
        `fee mismatch at subtotal ${subtotal}`,
      );
    }
  });

  it('charges the flat fee below the threshold', () => {
    assert.equal(getDeliveryFee(0), DELIVERY_FEE);
    assert.equal(getDeliveryFee(FREE_DELIVERY_THRESHOLD - 1), DELIVERY_FEE);
  });

  it('is free at and above the threshold', () => {
    assert.equal(getDeliveryFee(FREE_DELIVERY_THRESHOLD), 0);
    assert.equal(getDeliveryFee(1200), 0);
  });
});

describe('scripts/seed-admin.ts: the role vocabulary cannot drift', () => {
  // The script duplicates the role list rather than importing it, because scripts/
  // is deployed and run with its own tsconfig and cannot reach into src/. A
  // duplicated list can drift, and the failure it produces is silent: the script
  // writes a role the rules do not recognise, the account authenticates fine, and
  // every admin page is hidden with no error anywhere. That is the same failure
  // mode as the "owner\n" incident above, reached by a different route.
  //
  // So the two lists are asserted equal here, in the same spirit as the delivery
  // constants.
  const scriptSource = readFileSync(join(__dirname, '..', 'scripts', 'seed-admin.ts'), 'utf8');
  const declared = scriptSource.match(/const ROLES = \[([^\]]+)\]/)?.[1] ?? '';
  const scriptRoles = [...declared.matchAll(/'([^']+)'/g)].map((m) => m[1]);

  it('declares exactly the five roles the client model defines', () => {
    assert.deepEqual(
      [...scriptRoles].sort(),
      [...ALL_ROLES].sort(),
      'scripts/seed-admin.ts ROLES has drifted from UserRole — a role the script writes but the rules do not know is a silently powerless admin',
    );
  });

  it('rejects a role with stray whitespace instead of trimming it', () => {
    // The script's parseRole deliberately has no `.trim()`. Trimming would be
    // friendlier and would also re-open the exact incident this project already
    // had: "owner\n" matching no tier. Assert the intent so a later "cleanup"
    // does not reintroduce it.
    assert.ok(
      !/\.trim\(\)/.test(scriptSource.match(/function parseRole[\s\S]*?\n}/)?.[0] ?? ''),
      'parseRole must not trim — exact matching is the guard against "owner\\n"',
    );
  });
});

describe('CI runs `verify` rather than a second copy of it', () => {
  // The same duplication problem as the two blocks above, but between two
  // REPOSITORIES rather than two languages — and it had already cost real
  // coverage.
  //
  // `.github/workflows/ci.yml` used to spell out eleven `npm run <script>` steps
  // by hand, duplicating the `verify` chain in package.json. It drifted three
  // separate ways:
  //
  //   - `test:integration` was added to `verify` and never added here, so the 23
  //     tests that caught stock inflating on every non-take transition, a pending
  //     cancel restocking stock that was never taken, and an unauthorizable
  //     cancel-and-restock never ran in CI. It passed anyway.
  //   - `format:check` was `continue-on-error: true` here, blocking in `verify`.
  //   - The cloud-functions typecheck existed ONLY here, so it could not be run
  //     locally before pushing.
  //
  // Drift between two copies of a checklist is silent: nothing fails, a check
  // just quietly stops running. These assertions make CI/verify divergence a
  // test failure instead.
  const workflowPath = join(__dirname, '..', '.github', 'workflows', 'ci.yml');
  const workflow = readFileSync(workflowPath, 'utf8');
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('delegates the whole chain to npm run verify', () => {
    assert.match(
      workflow,
      /run:\s*npm run verify/,
      'ci.yml must run `npm run verify` — the single copy of the gate',
    );
  });

  it('does not enumerate individual project scripts', () => {
    // `npm ci` and `npm --prefix functions ci` are INSTALLS, not checks, and are
    // allowed. Anything that names one of the project's own scripts as a step is
    // a second copy of the chain.
    const projectScripts = new Set(Object.keys(pkg.scripts));
    const offenders = [...workflow.matchAll(/run:\s*(.+)/g)]
      .map((m) => m[1].trim())
      .filter((cmd) => {
        if (/^npm ci\b/.test(cmd)) return false; // install
        if (/^npm --prefix functions ci\b/.test(cmd)) return false; // install
        if (/^npm run verify\b/.test(cmd)) return false; // the delegation itself
        return [...cmd.matchAll(/npm run ([\w:-]+)/g)].some((s) => projectScripts.has(s[1]));
      });

    assert.deepEqual(
      offenders,
      [],
      'ci.yml names individual project scripts, which re-creates the copy that drifted',
    );
  });

  it('covers every script the verify chain invokes', () => {
    // Belt and braces: whatever `verify` runs, the workflow must reach it. If
    // someone reintroduces a hand-rolled step this is the check that names it.
    const invoked = [...pkg.scripts.verify.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
    const missing = invoked.filter((name) => name !== 'verify');
    for (const name of missing) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(pkg.scripts, name),
        `verify invokes \`npm run ${name}\` but package.json defines no such script`,
      );
    }
    assert.ok(invoked.length >= 8, 'verify should be a substantial chain, not one step');
  });

  it('pins a JDK at or above the firebase-tools floor', () => {
    // firebase-tools 15.x refuses to start on anything below 21:
    //   "firebase-tools no longer supports Java version before 21"
    // It was pinned to 17 on purpose — to avoid the newest JDKs — and that
    // defensive choice is what broke CI while the developer's own Java 24 kept
    // the local run green. The lesson: pin the FLOOR, do not chase the newest,
    // and never pin below what the tool declares.
    const java = workflow.match(/java-version:\s*'?(\d+)/)?.[1];
    assert.ok(java, 'ci.yml must pin a java-version — the Firestore emulator is a Java process');
    assert.ok(
      Number(java) >= 21,
      `ci.yml pins Java ${java}, but firebase-tools 15.x requires 21 or above`,
    );
  });

  it('runs the cloud-functions typecheck inside verify, not only in CI', () => {
    // A check nobody can run on demand is a check that fails in CI instead.
    assert.match(
      pkg.scripts.verify,
      /typecheck:functions/,
      'the cloud-functions typecheck must be reachable locally via verify',
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(pkg.scripts, 'typecheck:functions'),
      'package.json must define typecheck:functions',
    );
  });

  it('the developers palette matches the rules, which is the only thing enforcing it', () => {
    // `check:contrast` validates design tokens. It cannot see a hex typed into a
    // runtime colour picker, which is exactly why the rules constrain the value:
    // the initials are plum on a PASTEL disc and a dark disc would make them
    // unreadable. So the client vocabulary and the rules list must be the same list,
    // or a swatch the UI offers is a value the database refuses.
    const modelSrc = readFileSync(
      join(__dirname, '..', 'src', 'app', 'core', 'models', 'developer.model.ts'),
      'utf8',
    );
    const hexes = [...modelSrc.matchAll(/hex: '(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1]);
    assert.ok(hexes.length > 0, 'DEVELOPER_ACCENTS must declare at least one colour');

    // Read the rules here rather than borrowing the drift-lint suite's `rules`
    // local, so this test stands alone.
    const rulesSrc = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8');
    for (const hex of hexes) {
      assert.ok(
        rulesSrc.includes(`'${hex}'`),
        `${hex} is offered by DEVELOPER_ACCENTS but developerIsWellFormed() in ` +
          'firestore.rules does not list it — the picker would offer a value every save is refused for',
      );
    }
  });

  it('the developers accent set cannot shrink without the rules following', () => {
    // Five, because that is the set the pastels were chosen as. A silent removal is
    // the kind of change that reads as a cleanup and strands a stored document whose
    // accent is no longer writable.
    const modelSrc = readFileSync(
      join(__dirname, '..', 'src', 'app', 'core', 'models', 'developer.model.ts'),
      'utf8',
    );
    const hexes = [...modelSrc.matchAll(/hex: '(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1]);
    assert.equal(hexes.length, 5, 'DEVELOPER_ACCENTS should still hold the five palette discs');
    assert.equal(new Set(hexes).size, 5, 'the palette must not contain a duplicate');
  });

  /**
   * THE LOCAL-DEVELOPMENT SAFETY INVARIANT.
   *
   * `npm start` used to serve the admin app against the PRODUCTION database:
   * `environment.ts` hard-codes `projectId: 'five-orites-scoop'` and the
   * `development` build configuration does not replace it. Every control in that app
   * writes — stock levels, products, roles, order cancellations — so exercising a UI
   * change mutated live data and appended rows to the stock ledger describing
   * changes nobody made, which is exactly the corruption the reconciliation panel
   * exists to detect.
   *
   * `npm start` now selects the `emulator` build configuration, and reaching
   * production takes the explicit `npm run start:prod`.
   *
   * This is asserted rather than documented because the failure mode is INVISIBLE.
   * Nothing breaks if someone adds `--configuration production` to `start`: the app
   * builds, boots, looks perfect, and quietly writes to the real database. A README
   * line saying "start is safe" would not survive the first well-meaning tweak, and
   * the cost of that tweak is measured in corrupted production data rather than a
   * red build.
   */
  describe('local development cannot reach production by accident', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const angularSrc = readFileSync(join(__dirname, '..', 'angular.json'), 'utf8');
    const envSrc = readFileSync(
      join(__dirname, '..', 'src', 'environments', 'environment.ts'),
      'utf8',
    );
    const emulatorEnvSrc = readFileSync(
      join(__dirname, '..', 'src', 'environments', 'environment.emulator.ts'),
      'utf8',
    );

    it('`npm start` selects the emulator configuration', () => {
      assert.match(
        pkg.scripts.start,
        /--configuration emulator\b/,
        '`npm start` must build with the emulator configuration, or it serves the admin ' +
          'app against production — every control there writes',
      );
    });

    it('`npm start` names no production configuration', () => {
      // Belt and braces against the first assertion: a script could satisfy the check
      // above and still add a second configuration.
      assert.ok(
        !/--configuration\s+(production|prod)\b/.test(pkg.scripts.start),
        '`npm start` must not name a production configuration',
      );
    });

    it('reaching production requires a differently-named script', () => {
      // The opt-in has to exist, or `npm start` being redirected would leave no way
      // to look at real data and the change would get reverted.
      assert.match(pkg.scripts['start:prod'] ?? '', /--configuration prod\b/);
    });

    it('the emulator build configuration replaces the environment file', () => {
      // Without the fileReplacement the `emulator` configuration is just a name: it
      // would compile environment.ts and connect to production while appearing to
      // be the safe one.
      assert.match(
        angularSrc,
        /"emulator"[\s\S]{0,400}?fileReplacements[\s\S]{0,400}?environment\.emulator\.ts/,
        'the `emulator` build configuration must swap environment.ts for environment.emulator.ts',
      );
    });

    it('the default environment states useEmulator: false, not an absent key', () => {
      // `undefined` is falsy so the runtime behaves correctly either way, but an
      // absent key means nobody decided — and the emulator file is swapped in by
      // angular.json, so TypeScript only ever sees THIS file's shape.
      assert.match(
        envSrc,
        /useEmulator:\s*false/,
        'environment.ts must state `useEmulator: false` so the property type is settled ' +
          'by the file TypeScript actually compiles',
      );
    });

    it('the emulator environment opts in and does not name the real project', () => {
      assert.match(emulatorEnvSrc, /useEmulator:\s*true/);

      // Match ASSIGNMENTS, not prose. The first version of this assertion was a plain
      // regex over the whole file and it failed on the very reasoning that justifies
      // it: environment.emulator.ts's own header comment quotes
      // `projectId: 'five-orites-scoop'` while explaining why that value must not
      // appear, so the test flagged its own explanation. Anchoring to a line that
      // actually assigns the key is what makes this about code.
      const assignments = [...emulatorEnvSrc.matchAll(/^\s*projectId:\s*'([^']+)'/gm)].map(
        (m) => m[1],
      );
      assert.ok(assignments.length > 0, 'expected at least one projectId assignment');
      for (const id of assignments) {
        assert.notEqual(
          id,
          'five-orites-scoop',
          'environment.emulator.ts must not carry the production projectId - the ' +
            'emulators ignore it, but naming it would make an accidental live call ' +
            'succeed quietly',
        );
        assert.match(id, /^demo-/, `emulator projectId "${id}" should use the demo- prefix`);
      }
    });

    it('the seeded price matrix covers every set the live catalogue has', () => {
      // Set 9 exists in production and was missing here, in `SET_NAMES`, and in the
      // inventory page's empty-catalogue fallback — three copies of the same list, all
      // stopping at 8, none of which could notice the others were short.
      const seedSrc = readFileSync(join(__dirname, '..', 'scripts', 'seed-products.ts'), 'utf8');
      const matrix = seedSrc.match(/const PRICING_MATRIX[\s\S]*?\n};/)?.[0] ?? '';
      assert.ok(matrix, 'PRICING_MATRIX not found in scripts/seed-products.ts');
      const sets = [...matrix.matchAll(/^\s*(\d+):\s*\{/gm)].map((m) => Number(m[1]));
      assert.ok(
        sets.includes(9),
        'PRICING_MATRIX must include set 9 — it exists in the live catalogue',
      );
    });
  });

  it('includes every test suite in verify', () => {
    // The suites that found real bugs, named explicitly. `test:integration` is
    // the one that caught three severe defects while 308 other tests passed.
    for (const suite of ['test:logic', 'test:rules', 'test:integration']) {
      assert.match(
        pkg.scripts.verify,
        new RegExp(suite.replace(/[-:]/g, '\\$&')),
        `verify must run ${suite}`,
      );
    }
  });

  /**
   * The README documents the gate by enumerating it, and that copy was four steps
   * out of date — it claimed seven, the chain has eleven.
   *
   * Worth a guard rather than a fix, because a README that lists the gate is a
   * copy of the gate in exactly the way ci.yml was, and it had drifted in the same
   * direction: `typecheck:functions`, `typecheck:templates`, `test:integration`
   * and `format:check` were all missing, and `format:check` was separately
   * described as "non-blocking in CI" after `verify` had started blocking on it.
   *
   * It costs a reader something specific and hard to notice: someone deciding
   * whether they need the emulator before pushing reads a list that does not
   * mention `test:integration`, concludes the 23 stock tests are optional, and
   * skips them.
   *
   * The row is compared against package.json rather than a hand-written list, so
   * the assertion cannot itself become the stale copy it is checking.
   */
  describe('the README documents the same gate', () => {
    const readme = readFileSync(join(__dirname, '..', 'README.md'), 'utf8');

    const verifySteps = pkg.scripts.verify
      .split('&&')
      .map((s) => s.trim().replace(/^npm run /, ''))
      .filter(Boolean);

    it('names every step the verify chain runs', () => {
      const row = readme.split(/\r?\n/).find((l) => l.includes('| `npm run verify`'));
      assert.ok(row, 'README must document `npm run verify`');
      const missing = verifySteps.filter((s) => !row.includes(`\`${s}\``));
      assert.deepEqual(
        missing,
        [],
        `verify runs these but the README row omits them: ${missing.join(', ')}`,
      );
    });

    it('does not describe format:check as non-blocking', () => {
      // It stopped being non-blocking when `verify` chained it, and CI runs
      // `verify`. A reader told it is advisory will not fix formatting locally.
      const row = readme.split(/\r?\n/).find((l) => l.includes('| `npm run format:check`'));
      assert.ok(row, 'README must document `npm run format:check`');
      assert.ok(
        !/non-blocking/i.test(row),
        'format:check blocks inside `verify` and CI runs `verify`, so it is not non-blocking',
      );
    });

    it('documents every script the gate runs', () => {
      // The reverse direction, scoped to the GATE rather than to every script in
      // package.json. A first attempt asserted that for the whole file and
      // reported `ng`, `watch`, `prepare`, `build:android`, `build:ios`,
      // `fix:encoding` and `icons:generate` as undocumented — all of them either
      // Angular scaffolding or one-shot dev utilities that were never part of the
      // gate, and padding the assertion with exceptions for each would have made
      // it weaker rather than stronger.
      //
      // What matters is narrower: anything you are told to run before pushing must
      // be findable. That is exactly the verify chain.
      //
      // Scoped to the reference TABLE, and matched on the FULL invocation.
      //
      // Two weaker versions of this assertion both passed while a canary had
      // renamed the row, and each failure is instructive:
      //
      //   1. A whole-document `includes` was satisfied by a PROSE sentence - six
      //      places in this file mention `npm run test:rules` outside the table.
      //   2. Scoping to table rows was still not enough, because the
      //      `npm run test` row legitimately reads
      //      "`test:logic` + `test:rules` + `test:integration`", which contains
      //      the bare backticked name. So the check has to be for
      //      `npm run <script>` - the thing a reader would actually type.
      //
      // Neither was caught by reading the assertion. Both were caught by a canary
      // that renamed the row and checking that the test went red.
      //
      // While doing that, the file turned out to carry FOUR copies of the chain
      // (a quick-commands block, two prose paragraphs and the verify row). Three
      // were already wrong. They were replaced with a reference to the single
      // copy rather than refreshed, so the same drift cannot recur.
      const tableRows = readme
        .split(/\r?\n/)
        .filter((l) => l.trimStart().startsWith('|'))
        .join('\n');
      const undocumented = verifySteps.filter((s) => !tableRows.includes(`\`npm run ${s}\``));
      assert.deepEqual(
        undocumented,
        [],
        `verify runs these and the README command table has no row invoking them: ${undocumented.join(', ')}`,
      );
    });
  });
});

describe('voucher discount: client and function copies agree', () => {
  // Same duplication, higher stakes. `reconcileOrderStock` recomputes the
  // discount from the voucher document and OVERWRITES the client's figure, so
  // the function's copy is the one that decides what the shop keeps. If the two
  // disagree the cart quotes a number the order will not honour — and the
  // customer finds out at the moment the order is confirmed, not before.
  const VOUCHER_SHAPES = [
    { type: 'percent', value: 10, minOrder: 200, isActive: true },
    { type: 'percent', value: 90, minOrder: 0, isActive: true },
    { type: 'percent', value: 100, minOrder: 0, isActive: true },
    { type: 'fixed', value: 50, minOrder: 500, isActive: true },
    { type: 'fixed', value: 99999, minOrder: 0, isActive: true },
    { type: 'fixed', value: -20, minOrder: 0, isActive: true },
    { type: 'percent', value: 10, minOrder: 1000, isActive: false },
  ] as const;
  const SUBTOTALS = [0, 99, 100, 199, 200, 201, 499, 500, 1200, 5000];

  it('the function copy of the percent ceiling matches the client copy', () => {
    assert.equal(fnConfig.MAX_PERCENT_DISCOUNT, MAX_PERCENT_DISCOUNT);
  });

  it('computes an identical discount across every voucher shape and subtotal', () => {
    for (const voucher of VOUCHER_SHAPES) {
      for (const subtotal of SUBTOTALS) {
        assert.equal(
          fnConfig.calculateDiscount(subtotal, voucher),
          calculateDiscount(subtotal, voucher),
          `discount mismatch for ${voucher.type} ${voucher.value} at subtotal ${subtotal}`,
        );
      }
    }
  });

  it('never returns a negative discount on either copy', () => {
    for (const voucher of VOUCHER_SHAPES) {
      for (const subtotal of SUBTOTALS) {
        assert.ok(
          fnConfig.calculateDiscount(subtotal, voucher) >= 0,
          `function copy went negative for ${voucher.type} ${voucher.value} at ${subtotal}`,
        );
        assert.ok(
          calculateDiscount(subtotal, voucher) >= 0,
          `client copy went negative for ${voucher.type} ${voucher.value} at ${subtotal}`,
        );
      }
    }
  });

  it('never discounts more than the subtotal on either copy', () => {
    // The invariant the function relies on when it recomputes grandTotal: an
    // over-large fixed voucher must not manufacture a negative order total.
    for (const voucher of VOUCHER_SHAPES) {
      for (const subtotal of SUBTOTALS) {
        assert.ok(
          fnConfig.calculateDiscount(subtotal, voucher) <= subtotal,
          `function copy exceeded subtotal for ${voucher.type} ${voucher.value} at ${subtotal}`,
        );
        assert.ok(
          calculateDiscount(subtotal, voucher) <= subtotal,
          `client copy exceeded subtotal for ${voucher.type} ${voucher.value} at ${subtotal}`,
        );
      }
    }
  });
});

describe('cart stock cap', () => {
  it('allows a quantity within available stock', () => {
    assert.doesNotThrow(() => assertCanAddToCart('Rocky Road (pint)', 2, 3, 10));
  });

  it('rejects overselling', () => {
    assert.throws(
      () => assertCanAddToCart('Rocky Road (pint)', 8, 3, 10),
      /Exceeds available|Only 10 x Rocky Road/,
    );
  });

  it('rejects an out-of-stock line', () => {
    assert.throws(() => assertCanAddToCart('Rocky Road (pint)', 0, 1, 0), /out of stock/);
  });

  it('rejects a non-positive quantity', () => {
    assert.throws(() => assertCanAddToCart('Rocky Road (pint)', 0, 0, 10), /at least 1/);
  });
});

describe('totalStock', () => {
  it('sums every size', () => {
    assert.equal(totalStock({ cup: 20, pint: 30, halfGallon: 20, gallon: 20 }), 90);
  });

  it('counts a missing size as zero rather than NaN', () => {
    // A legacy document with only two sizes must still produce a number. `reduce`
    // over the incoming keys would have produced NaN, which the card and the delete
    // confirmation would then have disagreed about.
    assert.equal(totalStock({ cup: 5, pint: 7 } as Partial<Record<string, number>>), 12);
  });

  it('ignores a non-finite level instead of poisoning the total', () => {
    assert.equal(totalStock({ cup: 5, pint: NaN, halfGallon: 2, gallon: 3 }), 10);
  });

  it('is zero for nothing', () => {
    assert.equal(totalStock(null), 0);
    assert.equal(totalStock(undefined), 0);
    assert.equal(totalStock({}), 0);
  });

  it('ignores an unexpected extra size key', () => {
    // Iterates SIZE_VARIANTS rather than the document's own keys, so a stray field
    // cannot inflate the number and the function cannot drift from the size list.
    assert.equal(totalStock({ cup: 1, pint: 1, halfGallon: 1, gallon: 1, tub: 999 } as never), 4);
  });
});

describe('flavourOf: the SET is the flavour', () => {
  it('singularises the one set name that needs it', () => {
    assert.equal(flavourOf({ setName: 'Chocolates' }), 'Chocolate');
  });

  it('leaves already-singular names alone', () => {
    for (const name of ['Vanilla', 'Ube', 'Mint', 'Mango', 'Strawberry', 'Coffee', 'Pistachio']) {
      assert.equal(flavourOf({ setName: name }), name);
    }
  });

  it('does not strip the s in "Cookies & Cream"', () => {
    assert.equal(flavourOf({ setName: 'Cookies & Cream' }), 'Cookies & Cream');
  });

  /**
   * The reason this helper exists rather than a substring search on the variant
   * name. Every row below is a REAL product in the live catalogue whose variant
   * name mentions a DIFFERENT flavour; a name search answers with the mention,
   * which is wrong on all seven.
   */
  const MENTIONS_ANOTHER_FLAVOUR: Array<[string, string, string]> = [
    ['Chocolate Chip Cookie Dough', 'Cookies & Cream', 'Cookies & Cream'],
    ['Coffee Chocolate Chip', 'Coffee', 'Coffee'],
    ['Mint Chocolate Chip', 'Mint', 'Mint'],
    ['Mint Chocolate Cookie', 'Mint', 'Mint'],
    ['Vanilla Cookie Crumble', 'Vanilla', 'Vanilla'],
    ['Ube Cookies and Cream', 'Ube', 'Ube'],
  ];

  for (const [variantName, setName, expected] of MENTIONS_ANOTHER_FLAVOUR) {
    it(`"${variantName}" is ${expected}, not the flavour its name mentions`, () => {
      assert.equal(flavourOf({ setName }), expected);
      // And the name genuinely does contain a rival flavour word, so this test
      // would be vacuous if the fixture were wrong.
      const rivals = [
        'Chocolate',
        'Vanilla',
        'Strawberry',
        'Mango',
        'Ube',
        'Mint',
        'Coffee',
        'Cookie',
      ];
      assert.ok(
        rivals.some((r) => variantName.toLowerCase().includes(r.toLowerCase())),
        `${variantName} is supposed to name another flavour, for this test to mean anything`,
      );
    });
  }

  it('handles the screenshot case', () => {
    assert.equal(flavourOf({ setName: 'Chocolates' }), 'Chocolate');
  });

  it('answers for a set that SET_NAMES does not define', () => {
    // Set 9 "Pistachio" exists in the live catalogue and is absent from
    // `SET_NAMES` in pricing.config.ts, which stops at 8. Reading the product's
    // own setName cannot break on it the way reading that constant would; its
    // single variant is "Choco Pistachio", which names a flavour it is not.
    assert.equal(flavourOf({ setName: 'Pistachio' }), 'Pistachio');
  });

  it('is empty rather than "undefined" for a missing name', () => {
    assert.equal(flavourOf(null), '');
    assert.equal(flavourOf({}), '');
    assert.equal(flavourOf({ setName: '   ' }), '');
  });
});

describe('initialsOf', () => {
  it('takes the first and last word', () => {
    assert.equal(initialsOf('Kenn Karlo Umadhay'), 'KU');
    assert.equal(initialsOf('Justin Curby P. Esguerra'), 'JE');
  });

  it('copes with a single name', () => {
    assert.equal(initialsOf('Prince'), 'PR');
  });

  it('never returns more than two letters', () => {
    assert.equal(initialsOf('Antonio Miguel Villanueva'), 'AV');
    assert.equal(initialsOf('A B C D'), 'AD');
  });

  it('has a placeholder rather than an empty avatar', () => {
    assert.equal(initialsOf(''), '?');
    assert.equal(initialsOf(null), '?');
    assert.equal(initialsOf('   '), '?');
  });

  it('ignores punctuation-only words', () => {
    assert.equal(initialsOf('  ,  .  '), '?');
  });
});

describe('reconcileSize: the anchor is an EPOCH, not the oldest row', () => {
  /**
   * The real production data this rule exists for. Four rows, all for one flavour,
   * and they contradict each other: the oldest says the level became 2, the newest
   * says 48.
   *
   * They got that way because `createProduct` wrote stock onto the product
   * document with no movement row at all, and the CSV importer calls the same
   * method — so 65 of 66 products had no history, and the four rows that existed
   * were anchored to a level nothing else agreed with.
   */
  const INCOHERENT: Array<{ delta: number; balanceAfter: number; reason: string; size: string }> = [
    // NEWEST FIRST — the order `orderBy('createdAt','desc')` returns.
    { delta: -1, balanceAfter: 48, reason: 'manual_adjust', size: 'cup' },
    { delta: -2, balanceAfter: 49, reason: 'sale', size: 'cup' },
    { delta: 1, balanceAfter: 51, reason: 'admin_restock', size: 'cup' },
    { delta: 1, balanceAfter: 2, reason: 'admin_restock', size: 'cup' },
  ];

  it('reproduces the +48 false positive WITHOUT a reset row', () => {
    // The bug, pinned. Anchoring on the oldest row gives opening = 2 - 1 = 1, the
    // deltas sum to -1, so expected = 0 against a stored 48. The check was right
    // about the arithmetic and wrong about the premise.
    const r = reconcileSize(INCOHERENT);
    assert.equal(r.anchored, true);
    assert.equal(r.expected, 0);
  });

  it('a baseline row supersedes the incoherent history above it', () => {
    // The repair. `balanceAfter: 48, delta: +48` asserts "as of now it is 48";
    // everything above it describes a level that assertion has replaced.
    const withBaseline = [
      { delta: 48, balanceAfter: 48, reason: 'baseline', size: 'cup' },
      ...INCOHERENT,
    ];
    const r = reconcileSize(withBaseline);
    assert.equal(r.anchored, true);
    assert.equal(r.expected, 48, 'the baseline must win over the incoherent rows');
    assert.equal(r.supersededRows, 4, 'all four incoherent rows are superseded');
  });

  it('a stock_intake row works identically — the two reset reasons agree', () => {
    const withIntake = [
      { delta: 48, balanceAfter: 48, reason: 'stock_intake', size: 'cup' },
      ...INCOHERENT,
    ];
    assert.equal(reconcileSize(withIntake).expected, 48);
  });

  it('returns null, NOT zero, when there is no history at all', () => {
    // The single most damaging thing this function could do is answer 0 here: a
    // product born with 48 cups and no opening movement would be indistinguishable
    // from real tampering. Null means "cannot be checked".
    const r = reconcileSize([]);
    assert.equal(r.anchored, false);
    assert.equal(r.expected, null);
  });

  it('a coherent chain still anchors on the oldest row when there is no reset', () => {
    const coherent = [
      { delta: -2, balanceAfter: 8, reason: 'sale', size: 'cup' },
      { delta: -1, balanceAfter: 10, reason: 'sale', size: 'cup' },
      { delta: 20, balanceAfter: 11, reason: 'admin_restock', size: 'cup' },
    ];
    // opening = 11 - 20 = -9; deltas -2 -1 +20 = 17; expected 8.
    assert.equal(reconcileSize(coherent).expected, 8);
    assert.equal(reconcileSize(coherent).supersededRows, 0);
  });

  it('detects real drift AFTER a reset, which is the whole point', () => {
    // Baseline says 48, then someone moved it to 45 through no app path.
    const rows = [
      { delta: -3, balanceAfter: 45, reason: 'manual_adjust', size: 'cup' },
      { delta: 48, balanceAfter: 48, reason: 'baseline', size: 'cup' },
    ];
    assert.equal(reconcileSize(rows).expected, 45, 'expected must follow real movements');
  });

  it('uses the OLDEST reset when there are several', () => {
    const rows = [
      { delta: -1, balanceAfter: 19, reason: 'manual_adjust', size: 'cup' },
      { delta: 5, balanceAfter: 20, reason: 'baseline', size: 'cup' },
      { delta: 10, balanceAfter: 15, reason: 'baseline', size: 'cup' },
      { delta: 2, balanceAfter: 5, reason: 'admin_restock', size: 'cup' },
    ];
    // Newest-first, so the OLDEST reset is the LAST one: delta 10, balanceAfter
    // 15. The opening is that row's OWN pair, 15 - 10 = 5 — not its predecessor's
    // delta, which is the mistake this test was first written with. Everything at
    // or after the anchor sums -1 + 5 + 10 = 14, so the level is 19.
    //
    // Anchoring on the NEWEST reset would give 20, so this distinguishes the two.
    // The oldest `admin_restock` row is superseded and ignored.
    assert.equal(reconcileSize(rows).expected, 19);
    assert.equal(reconcileSize(rows).supersededRows, 1);
  });

  it('a reset row with delta 0 is a pure assertion of the level', () => {
    assert.equal(
      reconcileSize([{ delta: 0, balanceAfter: 33, reason: 'baseline', size: 'cup' }]).expected,
      33,
    );
  });

  describe('the reset-reason list cannot drift from the service', () => {
    it('every reason in the union has a label', () => {
      // A reason added to the union without a label renders as a blank chip in the
      // movements table, which reads as a rendering bug rather than missing copy.
      const labelled = Object.keys(STOCK_REASON_LABELS);
      for (const reason of RESET_REASONS) {
        assert.ok(
          labelled.includes(reason),
          `${reason} resets the epoch but has no entry in STOCK_REASON_LABELS`,
        );
      }
      // And the other direction: a label with no reason is dead copy.
      for (const label of labelled) {
        assert.ok(
          (Object.keys(STOCK_REASON_LABELS) as string[]).includes(label),
          `${label} has a label`,
        );
      }
    });

    it('the reset set holds only real reasons', () => {
      for (const reason of RESET_REASONS) {
        assert.ok(
          reason in STOCK_REASON_LABELS,
          `${reason} resets the epoch but is not a member of the reason vocabulary`,
        );
      }
    });

    it('the reconcile size list matches the app size list', () => {
      // `totalStockValues` is products x sizes.length, so a stale copy would change
      // the denominator the coverage line divides by without any error surfacing.
      assert.deepEqual([...RECONCILE_SIZES], [...SIZE_VARIANTS]);
    });
  });
});

describe('clampToStock', () => {
  it('caps the requested quantity at available stock', () => {
    assert.equal(clampToStock(9, 4), 4);
  });

  it('leaves the quantity alone when stock is unknown', () => {
    assert.equal(clampToStock(9, undefined), 9);
  });

  it('never returns a negative quantity', () => {
    assert.equal(clampToStock(5, -3), 0);
  });
});

describe('normaliseStockLines', () => {
  const line = (productId: string, size: string, quantity: number) => ({
    productId,
    size,
    quantity,
  });

  it('passes through a single valid line unchanged', () => {
    const result = normaliseStockLines([line('p1', 'cup', 2)]);
    assert.equal(result.length, 1);
    assert.equal(result[0].quantity, 2);
  });

  it('rejects a negative quantity, which would otherwise raise stock', () => {
    // The exploit this guards: `available < quantity` is false for 5 < -5, and
    // the write is `stock - quantity`, so stock would INCREASE.
    assert.throws(() => normaliseStockLines([line('p1', 'cup', -5)]), /Invalid quantity/);
  });

  it('rejects zero, which would decrement nothing', () => {
    assert.throws(() => normaliseStockLines([line('p1', 'cup', 0)]), /Invalid quantity/);
  });

  it('rejects a fractional quantity', () => {
    assert.throws(() => normaliseStockLines([line('p1', 'cup', 1.5)]), /Invalid quantity/);
  });

  it('rejects NaN rather than letting it reach Firestore', () => {
    assert.throws(() => normaliseStockLines([line('p1', 'cup', NaN)]), /Invalid quantity/);
  });

  it('sums duplicate product+size pairs so the charge matches the decrement', () => {
    // Two cart lines for the same size were previously charged twice while the
    // transaction wrote the document once.
    const result = normaliseStockLines([line('p1', 'cup', 1), line('p1', 'cup', 1)]);
    assert.equal(result.length, 1);
    assert.equal(result[0].quantity, 2);
  });

  it('keeps the same product in different sizes apart', () => {
    const result = normaliseStockLines([line('p1', 'cup', 1), line('p1', 'pint', 3)]);
    assert.equal(result.length, 2);
  });

  it('keeps different products apart', () => {
    const result = normaliseStockLines([line('p1', 'cup', 1), line('p2', 'cup', 1)]);
    assert.equal(result.length, 2);
  });

  it("does not mutate the caller's input objects", () => {
    const input = [line('p1', 'cup', 1), line('p1', 'cup', 1)];
    normaliseStockLines(input);
    assert.equal(input[0].quantity, 1);
  });

  it('returns an empty list for no lines', () => {
    assert.deepEqual(normaliseStockLines([]), []);
  });
});

describe('vouchers', () => {
  it('applies a percentage above its minimum order', () => {
    assert.equal(
      calculateDiscount(1000, { type: 'percent', value: 10, minOrder: 200, isActive: true }),
      100,
    );
  });

  it('ignores a percentage below its minimum order', () => {
    assert.equal(
      calculateDiscount(100, { type: 'percent', value: 10, minOrder: 200, isActive: true }),
      0,
    );
  });

  it('caps a fixed discount at the subtotal', () => {
    assert.equal(calculateDiscount(30, { type: 'fixed', value: 50, isActive: true }), 30);
  });

  it('ignores inactive vouchers', () => {
    assert.equal(calculateDiscount(1000, { type: 'percent', value: 10, isActive: false }), 0);
  });

  it('never discounts more than the maximum percentage', () => {
    assert.equal(
      calculateDiscount(1000, { type: 'percent', value: 500, isActive: true }),
      (1000 * MAX_PERCENT_DISCOUNT) / 100,
    );
  });

  it('has no built-in voucher list to fall back to', () => {
    // The built-in list (SCOOP10 / FREE50) is gone, and this pins why it must not
    // come back. It used to be consulted whenever the Firestore lookup came back
    // empty OR THREW, which meant switching a voucher off in the admin UI did
    // nothing — the hardcoded copy answered anyway. It was also never seeded, so
    // the cart page's "try SCOOP10" hint produced "Voucher not found" every time.
    assert.equal(
      Object.keys(voucherModel).includes('BUILT_IN_VOUCHERS'),
      false,
      'a built-in voucher list overrides admin control and must not return',
    );
  });
});

describe('reviews', () => {
  it('returns a zeroed summary for no reviews', () => {
    assert.deepEqual(summarizeRatings([]), { average: 0, count: 0 });
  });

  it('averages to one decimal place', () => {
    assert.deepEqual(summarizeRatings([{ rating: 5 }, { rating: 4 }]), {
      average: 4.5,
      count: 2,
    });
  });
});

describe('order cancel policy', () => {
  // NOTE: this re-declares the rule inline. The app has three separate
  // implementations — orders.page.ts canCancel(), order-tracker.page.ts
  // canCancel(), and the firestore.rules predicate — so there is no single
  // function to import here. The rules test asserts the authoritative copy
  // (tests/firestore.rules.test.ts). This block is a readability statement of
  // intent, NOT proof that the app enforces it.
  const customerCanCancel = (status: string) => status === 'pending';

  it('lets a customer cancel only while pending', () => {
    assert.equal(customerCanCancel('pending'), true);
    assert.equal(customerCanCancel('confirmed'), false);
    assert.equal(customerCanCancel('delivered'), false);
  });
});

describe('pre-dispatch stock return', () => {
  // Mirrors PRE_DISPATCH_STATUSES in order.service.ts. Stock only comes back if
  // the order never left the shop — restocking an out_for_delivery order would
  // invent inventory the store then oversells.
  const PRE_DISPATCH = ['pending', 'confirmed', 'preparing'];

  it('returns stock for an order that has not shipped', () => {
    for (const status of PRE_DISPATCH) {
      assert.ok(PRE_DISPATCH.includes(status), `${status} should restock`);
    }
  });

  it('does NOT return stock once the order is out for delivery or delivered', () => {
    assert.equal(PRE_DISPATCH.includes('out_for_delivery'), false);
    assert.equal(PRE_DISPATCH.includes('delivered'), false);
    assert.equal(PRE_DISPATCH.includes('cancelled'), false);
  });
});

describe('product category', () => {
  it('treats a product with no category as a flavor', () => {
    // The 64 seeded products predate the field. Defaulting keeps them visible
    // under Flavors instead of vanishing from the catalog.
    assert.equal(productCategory({}), 'flavor');
    assert.equal(productCategory({ category: undefined }), 'flavor');
  });

  it('passes through a recognised category', () => {
    assert.equal(productCategory({ category: 'sundae' }), 'sundae');
    assert.equal(productCategory({ category: 'cone' }), 'cone');
    assert.equal(productCategory({ category: 'flavor' }), 'flavor');
  });

  it('falls back to flavor for an unrecognised value', () => {
    // Defensive: a document written by a future version, or a typo, must not
    // render as an empty catalog section.
    assert.equal(productCategory({ category: 'popsicle' }), 'flavor');
    assert.equal(productCategory({ category: '' }), 'flavor');
  });

  it('covers every category with a display label', () => {
    const values = PRODUCT_CATEGORIES.map((c) => c.value);
    assert.deepEqual(values, ['flavor', 'sundae', 'cone']);
    for (const c of PRODUCT_CATEGORIES) {
      assert.ok(c.label.length > 0, 'each category needs a label');
    }
  });
});

describe('cloudinary delivery url', () => {
  const STORED =
    'https://res.cloudinary.com/fhtucp4v/image/upload/v1756200000/five-orites-scoop/products/a.jpg';

  it('injects sizing and auto-format before the version segment', () => {
    assert.equal(
      buildCloudinaryUrl(STORED, 400),
      'https://res.cloudinary.com/fhtucp4v/image/upload/f_auto,q_auto,w_400/v1756200000/five-orites-scoop/products/a.jpg',
    );
  });

  it('rounds the requested width', () => {
    assert.ok(buildCloudinaryUrl(STORED, 399.6).includes('w_400'));
  });

  it('keeps the public id and folder intact', () => {
    assert.ok(
      buildCloudinaryUrl(STORED, 1000).endsWith('v1756200000/five-orites-scoop/products/a.jpg'),
    );
  });

  it('does not stack transforms when applied twice', () => {
    const once = buildCloudinaryUrl(STORED, 400);
    const twice = buildCloudinaryUrl(once, 200);
    assert.equal(
      twice,
      'https://res.cloudinary.com/fhtucp4v/image/upload/f_auto,q_auto,w_200/v1756200000/five-orites-scoop/products/a.jpg',
    );
    assert.equal(times2Count(twice, 'f_auto'), 1);
  });

  it('omits the width when none is given', () => {
    assert.ok(buildCloudinaryUrl(STORED, 0).includes('f_auto,q_auto/'));
    assert.ok(!buildCloudinaryUrl(STORED, 0).includes('w_'));
    assert.ok(!buildCloudinaryUrl(STORED, Number.NaN).includes('w_'));
  });

  it('passes through anything that is not a cloudinary url', () => {
    assert.equal(
      buildCloudinaryUrl('assets/placeholder-scoop.svg', 400),
      'assets/placeholder-scoop.svg',
    );
    assert.equal(buildCloudinaryUrl('https://example.com/x.jpg', 400), 'https://example.com/x.jpg');
    assert.equal(buildCloudinaryUrl('', 400), '');
    assert.equal(buildCloudinaryUrl(null, 400), '');
    assert.equal(buildCloudinaryUrl(undefined, 400), '');
  });
});

describe('firestore error messages', () => {
  /**
   * The bug this exists for: `getCustomerOrders()` needs a composite index on
   * (customerId ASC, createdAt DESC). While that index was undeployed, every
   * customer dashboard showed "Check your connection and try again" for what was
   * in fact a schema problem. These assertions pin the split so the two can never
   * be reported as the same thing again.
   */
  it('does not blame the connection for a missing index', () => {
    const msg = describeFirestoreError('your recent orders', { code: 'failed-precondition' });
    assert.ok(!/connection/i.test(msg), `must not suggest a connection fix: ${msg}`);
    assert.ok(/index/i.test(msg));
  });

  it('does not blame the connection for a permissions failure', () => {
    const msg = describeFirestoreError('orders', { code: 'permission-denied' });
    assert.ok(!/connection/i.test(msg), `must not suggest a connection fix: ${msg}`);
    assert.ok(/permission/i.test(msg));
  });

  it('blames the connection only when genuinely offline', () => {
    assert.match(describeFirestoreError('orders', { code: 'unavailable' }), /offline/i);
    assert.match(describeFirestoreError('orders', { code: 'deadline-exceeded' }), /offline/i);
  });

  it('falls back to a non-specific message for an unknown failure', () => {
    const msg = describeFirestoreError('flavors', { code: 'something-new' });
    assert.ok(!/connection/i.test(msg), `must not invent a cause: ${msg}`);
    assert.match(msg, /flavors/, 'the unknown case is the only one that names the thing');
  });

  it('survives a null, undefined or code-less error', () => {
    for (const bad of [null, undefined, {}, 'a string', 42, { code: 7 }]) {
      const msg = describeFirestoreError('orders', bad);
      assert.equal(typeof msg, 'string');
      assert.ok(msg.length > 0);
    }
  });

  it('handles a transport-prefixed code', () => {
    assert.equal(
      describeFirestoreError('orders', { code: 'firestore/failed-precondition' }),
      describeFirestoreError('orders', { code: 'failed-precondition' }),
    );
  });

  it('identifies the missing-index case separately', () => {
    assert.equal(isMissingIndexError({ code: 'failed-precondition' }), true);
    assert.equal(isMissingIndexError({ code: 'firestore/failed-precondition' }), true);
    assert.equal(isMissingIndexError({ code: 'permission-denied' }), false);
    assert.equal(isMissingIndexError(null), false);
  });

  /**
   * The staff-gate case. A shift lead who advances an order off `pending` has
   * their whole transaction refused because the product write inside it needs a
   * manager, and without this the user is shown a bare `permission-denied`.
   */
  describe('isPermissionDeniedError', () => {
    it('is true for a rules refusal, with or without the SDK prefix', () => {
      assert.equal(isPermissionDeniedError({ code: 'permission-denied' }), true);
      assert.equal(isPermissionDeniedError({ code: 'firestore/permission-denied' }), true);
    });

    it('treats a lost session as the same problem, so the message still fits', () => {
      assert.equal(isPermissionDeniedError({ code: 'unauthenticated' }), true);
      assert.equal(isPermissionDeniedError({ code: 'firestore/unauthenticated' }), true);
    });

    it('is false for the other failures, so it cannot swallow them', () => {
      assert.equal(isPermissionDeniedError({ code: 'unavailable' }), false);
      assert.equal(isPermissionDeniedError({ code: 'failed-precondition' }), false);
      assert.equal(isPermissionDeniedError({ code: 'resource-exhausted' }), false);
      assert.equal(isPermissionDeniedError({ code: 'deadline-exceeded' }), false);
    });

    it('is false for a non-error, rather than throwing', () => {
      assert.equal(isPermissionDeniedError(null), false);
      assert.equal(isPermissionDeniedError(undefined), false);
      assert.equal(isPermissionDeniedError({}), false);
      assert.equal(isPermissionDeniedError(new Error('boom')), false);
    });

    it('exists because the read-oriented message is wrong for a write', () => {
      // `describeFirestoreError`'s permission branch says "permission to LOAD",
      // which is inaccurate in every particular when a write was refused: nothing
      // was being loaded, and "sign in again" is not the remedy. This pins that
      // wording so the reason for the separate helper is not quietly forgotten.
      const readMessage = describeFirestoreError('the order', { code: 'permission-denied' });
      assert.match(readMessage, /permission to load/i);
      assert.doesNotMatch(readMessage, /change|save|update/i);
    });
  });
});

describe('cached geocode validation', () => {
  /**
   * `order.geo` is CUSTOMER-AUTHORED. The order create rule validates eleven
   * specific fields and contains no `hasOnly`, so a customer can attach any `geo`
   * they like at checkout. `L.latLng()` throws on out-of-range coordinates, so an
   * unvalidated read means a map that renders nothing at all — these assertions
   * are the only thing standing between that and a blank page.
   */
  it('accepts a well-formed cached point', () => {
    const point = readCachedGeo({ lat: 14.6188159, lng: 121.1029457, label: 'Cainta', at: 1 });
    assert.ok(point);
    assert.equal(point!.lat, 14.6188159);
    assert.equal(point!.label, 'Cainta');
  });

  it('rejects out-of-range coordinates', () => {
    assert.equal(readCachedGeo({ lat: 91, lng: 0 }), null);
    assert.equal(readCachedGeo({ lat: 0, lng: 181 }), null);
    assert.equal(readCachedGeo({ lat: -91, lng: 0 }), null);
  });

  it('rejects non-numeric and non-finite values', () => {
    assert.equal(readCachedGeo({ lat: '14.6', lng: '121.1' }), null);
    assert.equal(readCachedGeo({ lat: Number.NaN, lng: 121 }), null);
    assert.equal(readCachedGeo({ lat: Number.POSITIVE_INFINITY, lng: 121 }), null);
    assert.equal(readCachedGeo({ lat: null, lng: null }), null);
  });

  it('rejects a missing or malformed container', () => {
    for (const bad of [null, undefined, {}, '14.6,121.1', 42, [14.6, 121.1]]) {
      assert.equal(readCachedGeo(bad), null);
    }
  });

  it('tolerates a missing label and timestamp', () => {
    const point = readCachedGeo({ lat: 14.6, lng: 121.1 });
    assert.ok(point);
    assert.equal(point!.label, '');
    assert.equal(point!.at, 0);
  });
});

describe('csv serialisation', () => {
  /**
   * The escaping rules used to live in a private method on the analytics page,
   * which meant the four admin exports added afterwards had no shared rule to
   * follow. A review comment or a delivery address containing a comma is not an
   * edge case — "Taft Ave, Manila" is the normal shape of a Filipino address —
   * so an unquoted cell silently shifts every column after it.
   */
  it('quotes a cell containing a comma', () => {
    assert.equal(sanitiseCell('Taft Ave, Manila'), '"Taft Ave, Manila"');
  });

  it('doubles an embedded quote', () => {
    assert.equal(sanitiseCell('Best "ube" ever'), '"Best ""ube"" ever"');
  });

  it('quotes unconditionally so no column can be a latent bug', () => {
    assert.equal(sanitiseCell('plain'), '"plain"');
    assert.equal(sanitiseCell(42), '"42"');
    assert.equal(sanitiseCell(false), '"false"');
  });

  it('renders null and undefined as an empty cell, never "null"', () => {
    assert.equal(sanitiseCell(null), '""');
    assert.equal(sanitiseCell(undefined), '""');
  });

  it('preserves a newline inside a quoted cell', () => {
    const csv = toCsv([['a'], ['line one\nline two']]);
    assert.equal(csv, '"a"\n"line one\nline two"');
  });

  it('emits a header plus one line per row', () => {
    const csv = toCsv([
      ['id', 'name'],
      ['1', 'Rocky Road'],
      ['2', 'Ube Halaya'],
    ]);
    assert.equal(csv.split('\n').length, 3);
    assert.ok(csv.startsWith('"id","name"'));
  });

  it('returns an empty string for no rows', () => {
    assert.equal(toCsv([]), '');
  });

  it('builds a dated filename', () => {
    assert.match(csvFilename('orders'), /^five-orites-orders-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.match(
      csvFilename('delivered-sales', '30d'),
      /^five-orites-delivered-sales-30d-\d{4}-\d{2}-\d{2}\.csv$/,
    );
  });

  /**
   * `createdAt` is a Firestore Timestamp in the app but can arrive as a string
   * from a cache, and is absent on some legacy documents. A formatter that
   * throws takes down the whole export rather than blanking one cell.
   */
  it('accepts a Timestamp-like object, a string, or nothing', () => {
    const stamp = { toDate: () => new Date('2026-10-02T03:04:05.000Z') };
    assert.equal(toIsoDate(stamp), '2026-10-02T03:04:05.000Z');
    assert.equal(toIsoDate('2026-10-02T03:04:05.000Z'), '2026-10-02T03:04:05.000Z');
    for (const bad of [null, undefined, 'not-a-date', {}, 42]) {
      assert.equal(toIsoDate(bad), '');
    }
  });
});

describe('revenue trend bucketing', () => {
  // A fixed clock, because these assertions are about calendar arithmetic and
  // running them "today" would silently start failing in some months.
  const NOW = new Date(2026, 9, 2, 14, 30); // 2 Oct 2026, 2:30pm local
  /** A timestamp on October `d` 2026 at `h`:00 local. */
  const at = (d: number, h = 12) => new Date(2026, 9, d, h, 0, 0).getTime();
  /** A timestamp on September `d` 2026 — the window opens in September. */
  const sept = (d: number, h = 12) => new Date(2026, 8, d, h, 0, 0).getTime();

  it('produces one bucket per day, oldest first, ending today', () => {
    const b = calendarBuckets(7, NOW);
    assert.equal(b.length, 7);
    assert.equal(b[0].date, '2026-09-26');
    assert.equal(b[6].date, '2026-10-02', 'the last bucket must be today');
    for (let i = 1; i < b.length; i++) {
      assert.ok(b[i].start > b[i - 1].start, 'buckets must increase');
    }
  });

  it('ends each bucket at the next local midnight, not 24h later', () => {
    // This is the DST case: a rolling 86_400_000ms step lands on 23:00 or 01:00
    // and silently shifts the whole trend by an hour.
    const b = calendarBuckets(2, NOW);
    for (const bucket of b) {
      assert.equal(new Date(bucket.end).getHours(), 0, 'each bucket ends at midnight');
      assert.equal(new Date(bucket.start).getHours(), 0, 'each bucket starts at midnight');
    }
  });

  it('sums each order into exactly one bucket', () => {
    const b = calendarBuckets(7, NOW);
    const sums = bucketize(
      b,
      [at(2), at(2), at(1), sept(26)],
      (t) => t,
      () => 100,
    );
    assert.equal(sums.length, 7);
    assert.equal(sums[6], 200, 'two orders today');
    assert.equal(sums[5], 100, 'one yesterday');
    assert.equal(sums[0], 100, 'one on the first day of the window');
    assert.equal(
      sums.reduce((a, b2) => a + b2, 0),
      400,
    );
  });

  it('separates 11:59pm from 12:01am across a day boundary', () => {
    const b = calendarBuckets(2, NOW);
    const late = new Date(2026, 9, 1, 23, 59).getTime();
    const early = new Date(2026, 9, 2, 0, 1).getTime();
    const sums = bucketize(
      b,
      [late, early],
      (t) => t,
      () => 1,
    );
    assert.equal(sums[0], 1, '11:59pm belongs to yesterday');
    assert.equal(sums[1], 1, '12:01am belongs to today');
  });

  it('ignores orders outside the window rather than clamping them in', () => {
    const b = calendarBuckets(7, NOW);
    // Two inside the window, one from January, one from TOMORROW — both strays
    // must be dropped rather than clamped into the nearest column, which would
    // invent a spike at each edge.
    const sums = bucketize(
      b,
      [at(1), at(2), new Date(2026, 0, 1).getTime(), at(3)],
      (t) => t,
      () => 10,
    );
    assert.equal(
      sums.reduce((a, b2) => a + b2, 0),
      20,
    );
  });

  it('emits empty buckets so the line has no gaps', () => {
    const b = calendarBuckets(5, NOW);
    const sums = bucketize(
      b,
      [at(2)],
      (t) => t,
      () => 500,
    );
    assert.equal(sums.length, 5);
    assert.deepEqual(sums, [0, 0, 0, 0, 500]);
  });

  it('survives an unparseable timestamp instead of dropping the bucket', () => {
    const b = calendarBuckets(3, NOW);
    const sums = bucketize(
      b,
      [Number.NaN, at(2)],
      (t) => t,
      () => 50,
    );
    assert.equal(
      sums.reduce((a, b2) => a + b2, 0),
      50,
    );
  });

  it('collapses a long window into weeks and keeps every order', () => {
    const daily = calendarBuckets(30, NOW);
    // One order in each of the three weeks of the window, so a weekly bug that
    // dropped or double-counted a column would show up as a different total.
    const sample = [at(2), sept(20), sept(5)];
    const dailySums = bucketize(
      daily,
      sample,
      (t) => t,
      () => 10,
    );
    const weekly = weeklyBuckets(30, NOW);
    const weeklySums = bucketize(
      weekly,
      sample,
      (t) => t,
      () => 10,
    );
    assert.ok(weekly.length < daily.length, 'weeks must be fewer columns than days');
    assert.equal(
      dailySums.reduce((a, b) => a + b, 0),
      weeklySums.reduce((a, b) => a + b, 0),
      'bucketing weekly must not drop or double-count any order',
    );
  });

  it('switches to weekly above 14 days and stays daily below', () => {
    assert.equal(bucketsFor(7, NOW).length, 7);
    assert.equal(bucketsFor(14, NOW).length, 14);
    assert.ok(bucketsFor(30, NOW).length <= 5);
  });

  it('accumulates a running total from zero', () => {
    // Starts at the first bucket, not at the first day's own value, which would
    // overstate the opening figure.
    assert.deepEqual(runningTotal([100, 50, 25]), [100, 150, 175]);
    assert.deepEqual(runningTotal([]), []);
  });

  it('handles a zero-length or negative window without throwing', () => {
    assert.equal(calendarBuckets(0, NOW).length, 1);
    assert.equal(calendarBuckets(-5, NOW).length, 1);
  });
});

describe('csv line parsing', () => {
  it('splits on commas', () => {
    assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
  });

  it('keeps a comma inside quotes instead of splitting on it', () => {
    // The same failure the CSV writer guards against, read backwards: a naive
    // split here would shift every column after the flavor name.
    assert.deepEqual(parseCsvLine('1,Chocolates,"Rocky Road, chunky",flavor'), [
      '1',
      'Chocolates',
      'Rocky Road, chunky',
      'flavor',
    ]);
  });

  it('unescapes a doubled quote', () => {
    assert.deepEqual(parseCsvLine('"Best ""ube"" ever"'), ['Best "ube" ever']);
  });

  it('tolerates a line ending inside quotes', () => {
    assert.deepEqual(parseCsvLine('"one\ntwo",b'), ['one\ntwo', 'b']);
  });

  it('returns an empty trailing field rather than dropping it', () => {
    assert.deepEqual(parseCsvLine('a,'), ['a', '']);
    assert.deepEqual(parseCsvLine(''), ['']);
  });
});

describe('product csv import', () => {
  const HEADER =
    'set_number,set_name,variant_name,description,category,cup_price,pint_price,half_gallon_price,gallon_price,cup_stock,pint_stock,half_gallon_stock,gallon_stock';

  it('parses a well-formed file', () => {
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocolates,Rocky Road,Nuts,flavor,65,200,500,950,3,2,1,0`,
    );
    assert.equal(plan.errors.length, 0);
    assert.equal(plan.valid.length, 1);
    assert.equal(plan.valid[0].variantName, 'Rocky Road');
    assert.equal(plan.valid[0].pricing.gallon, 950);
    assert.equal(plan.valid[0].stock.cup, 3);
    assert.equal(plan.valid[0].category, 'flavor');
  });

  it('defaults a missing category to flavor', () => {
    const plan = parseProductCsv(`${HEADER}\n1,Chocolates,Rocky Road,,,65,200,500,950,,,,`);
    assert.equal(plan.valid[0].category, 'flavor');
  });

  it('rejects the WHOLE file when any row is bad', () => {
    // The whole point: an admin must never end up with 40 of 64 flavors written
    // and no way to tell which 40.
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocolates,Rocky Road,,flavor,65,200,500,950,,,,` +
        `\n1,Chocolates,Broken,,flavor,abc,200,500,950,,,,`,
    );
    assert.equal(plan.valid.length, 0, 'nothing may be accepted');
    assert.equal(plan.errors.length, 1);
    assert.match(plan.errors[0].message, /cup price/);
  });

  it('reports the original line number, header included', () => {
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocolates,Good,,flavor,65,200,500,950,,,,` +
        `\n1,Chocolates,Bad,,flavor,-5,200,500,950,,,,`,
    );
    assert.equal(plan.errors[0].line, 3, 'line 1 is the header');
  });

  it('rejects a negative price', () => {
    const plan = parseProductCsv(`${HEADER}\n1,Chocolates,X,,flavor,-5,200,500,950,,,,`);
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /0 or more/);
  });

  it('rejects fractional and negative stock', () => {
    assert.equal(parseProductCsv(`${HEADER}\n1,C,X,,flavor,65,200,500,950,1.5,,,`).valid.length, 0);
    assert.equal(parseProductCsv(`${HEADER}\n1,C,X,,flavor,65,200,500,950,-2,,,`).valid.length, 0);
  });

  it('rejects a non-integer set number', () => {
    const plan = parseProductCsv(`${HEADER}\n0,Chocolates,X,,flavor,65,200,500,950,,,,`);
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /setNumber/);
  });

  it('rejects an unknown category instead of silently making it a flavor', () => {
    const plan = parseProductCsv(`${HEADER}\n1,C,X,,popsicle,65,200,500,950,,,,`);
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /category/);
  });

  it('rejects a row missing a required name', () => {
    assert.equal(parseProductCsv(`${HEADER}\n1,,X,,flavor,65,200,500,950,,,,`).valid.length, 0);
    assert.equal(
      parseProductCsv(`${HEADER}\n1,Chocolates,,,flavor,65,200,500,950,,,,`).valid.length,
      0,
    );
  });

  it('rejects a duplicate pair inside one file', () => {
    // The document id is derived from the pair, so a duplicate silently
    // overwrites the earlier row.
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocolates,Rocky Road,,flavor,65,200,500,950,,,,` +
        `\n1,Chocolates,Rocky Road,,flavor,99,200,500,950,,,,`,
    );
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /duplicate/);
  });

  it('rejects a row that already exists in the catalog', () => {
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocolates,Rocky Road,,flavor,65,200,500,950,,,,`,
      new Set(['1_rocky_road']),
    );
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /already exists/);
  });

  it('refuses a file with no price column rather than importing everything at zero', () => {
    // `isWellFormedProduct` allows pricing.cup === 0, so a header typo would
    // otherwise create 64 products nobody can buy.
    const plan = parseProductCsv('set_number,set_name,variant_name\n1,Chocolates,Rocky Road');
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /price column/i);
  });

  it('resolves an absent price column to 0 rather than to a tier default', () => {
    // The shape a shop that only sells two sizes actually exports: the other two
    // columns are simply not in the file. Both must land at ₱0 — neither an error
    // nor DEFAULT_SET_PRICING, which is the create form's business.
    const plan = parseProductCsv(
      'set_number,set_name,variant_name,category,cup_price,pint_price\n1,Chocolates,Rocky Road,flavor,65,200',
    );
    assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));
    assert.deepEqual(plan.valid[0].pricing, { cup: 65, pint: 200, halfGallon: 0, gallon: 0 });
  });

  it('treats a present-but-blank price cell exactly like an absent column', () => {
    // `get` returns '' for both, so the tier is ₱0 either way. They must not
    // drift apart, or the same catalog exported two ways would import two ways.
    const plan = parseProductCsv(`${HEADER}\n1,Chocolates,Rocky Road,,flavor,65,200,,950,,,,`);
    assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));
    assert.deepEqual(plan.valid[0].pricing, { cup: 65, pint: 200, halfGallon: 0, gallon: 950 });
  });

  it('refuses a file whose price columns are present but entirely blank', () => {
    // The other half of the same guard: the columns ARE there, so anything
    // checking only the header waves this through — yet nothing parses, and the
    // result would be every product at ₱0, which the rules allow.
    const plan = parseProductCsv(`${HEADER}\n1,Chocolates,Rocky Road,,flavor,,,,,,,,`);
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /price column/i);
  });

  it('rounds a fractional price to whole pesos instead of refusing the row', () => {
    // firestore.rules requires `pricing.* is int`, so a 65.4999 from a spreadsheet
    // division has to be rounded here or the server rejects the whole import with
    // no line number. Contrast the stock case above: half a scoop is a mistake,
    // half a peso is arithmetic.
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocolates,Rocky Road,,flavor,65.5,200.4999,500,950,,,,`,
    );
    assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));
    assert.deepEqual(plan.valid[0].pricing, {
      cup: 66,
      pint: 200,
      halfGallon: 500,
      gallon: 950,
    });
  });

  it('reports the missing required columns when the header is wrong', () => {
    const plan = parseProductCsv('a,b,c\n1,2,3');
    assert.match(plan.errors[0].message, /Missing required column/);
  });

  it('lists unknown columns so a typo is visible rather than silently ignored', () => {
    const plan = parseProductCsv(`${HEADER}\n1,Chocolates,X,,flavor,65,200,500,950,,,,`);
    assert.deepEqual(plan.unknownColumns, []);
    const typo = parseProductCsv(
      'set_number,set_name,variant_name,category,cup_prce,pint_price,half_gallon_price,gallon_price\n1,C,X,flavor,65,200,500,950',
    );
    assert.ok(typo.unknownColumns.includes('cup_prce'), 'the typo must be named');
  });

  it('accepts header variants a human would actually type', () => {
    for (const header of [
      'Set,Name,Flavor,Type,Price (Cup),Price (Pint),Price (Half Gallon),Price (Gallon)',
      'setNumber,setName,variantName,category,cupPrice,pintPrice,halfGallonPrice,gallonPrice',
      'SET NUMBER,SET NAME,VARIANT NAME,CATEGORY,CUP PRICE,PINT PRICE,HALF GALLON PRICE,GALLON PRICE',
    ]) {
      const plan = parseProductCsv(`${header}\n1,Chocolates,Rocky Road,flavor,65,200,500,950`);
      assert.equal(plan.valid.length, 1, `header not understood: ${header}`);
      assert.equal(plan.valid[0].pricing.gallon, 950);
    }
  });

  it('still understands a stock column written either way round', () => {
    // Each stock alias list carried a duplicate of its own first element, which
    // was pruned as dead text. This pins the survivors, both orderings, for all
    // four sizes — the prune must not cost a header shape a human would write.
    for (const header of [
      'set_number,set_name,variant_name,category,cup_price,cup_stock,pint_stock,half_gallon_stock,gallon_stock',
      'set_number,set_name,variant_name,category,cup_price,stock_cup,stock_pint,stock_half_gallon,stock_gallon',
    ]) {
      const plan = parseProductCsv(`${header}\n1,Chocolates,Rocky Road,flavor,65,1,2,3,4`);
      assert.equal(plan.valid.length, 1, `header not understood: ${header}`);
      assert.deepEqual(plan.valid[0].stock, { cup: 1, pint: 2, halfGallon: 3, gallon: 4 });
    }
  });

  it('skips blank lines and comments instead of failing on them', () => {
    const plan = parseProductCsv(
      `${HEADER}\n\n# exported 2 Oct\n1,Chocolates,Rocky Road,,flavor,65,200,500,950,,,,\n\n`,
    );
    assert.equal(plan.valid.length, 1);
    assert.equal(plan.errors.length, 0);
  });

  it('reports an empty file rather than importing nothing quietly', () => {
    const plan = parseProductCsv('');
    assert.equal(plan.valid.length, 0);
    assert.match(plan.errors[0].message, /empty/i);
  });

  it('handles a quoted comma inside a description', () => {
    const plan = parseProductCsv(
      `${HEADER}\n1,Chocoletes,Rocky Road,"Rich, fudgy, nutty",flavor,65,200,500,950,,,,`,
    );
    assert.equal(plan.valid[0].description, 'Rich, fudgy, nutty');
  });

  it('builds the same document id as the seeder', () => {
    assert.equal(slug('Rocky Road'), 'rocky_road');
    assert.equal(slug('Strawberryfields Forever'), 'strawberryfields_forever');
    assert.equal(slug('  Ube Halaya!  '), 'ube_halaya');
  });

  it('ships a template that parses', () => {
    const plan = parseProductCsv(PRODUCT_CSV_TEMPLATE);
    assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));
    assert.equal(plan.valid.length, 1);
  });
});

describe('route interpolation and distance', () => {
  const SHOP = { lat: 14.6188159, lng: 121.1029457 };
  const HOME = { lat: 14.65, lng: 121.12 };

  it('returns the endpoints at t=0 and t=1', () => {
    assert.deepEqual(interpolate(SHOP, HOME, 0), SHOP);
    assert.deepEqual(interpolate(SHOP, HOME, 1), HOME);
  });

  it('returns the midpoint at t=0.5', () => {
    const mid = interpolate(SHOP, HOME, 0.5);
    assert.ok(Math.abs(mid.lat - (SHOP.lat + HOME.lat) / 2) < 1e-9);
    assert.ok(Math.abs(mid.lng - (SHOP.lng + HOME.lng) / 2) < 1e-9);
  });

  it('clamps t outside 0..1 rather than overshooting the destination', () => {
    // A courier marker drawn past the customer's house would be nonsense, so the
    // value is pinned rather than extrapolated.
    assert.deepEqual(interpolate(SHOP, HOME, 5), HOME);
    assert.deepEqual(interpolate(SHOP, HOME, -3), SHOP);
  });

  it('reports zero distance to itself', () => {
    assert.equal(Math.round(distanceMetres(SHOP, SHOP)), 0);
  });

  it('measures a plausible great-circle distance', () => {
    // ~5km apart. Loose bounds on purpose: this is a smoke test that the formula
    // is not returning metres-as-degrees or similar, not a geodesy check.
    const metres = distanceMetres(SHOP, HOME);
    assert.ok(metres > 3000 && metres < 6000, `unexpected distance: ${metres}`);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   IN-APP NOTIFICATION FEED
   ═══════════════════════════════════════════════════════════════════════════ */

describe('notification feed', () => {
  /** Minimal order shape the feed needs. `ts` is epoch ms. */
  const order = (id: string, steps: { status: string; ts: number }[]) => ({
    id,
    statusHistory: steps.map((s) => ({ status: s.status, timestamp: { toMillis: () => s.ts } })),
  });

  const T0 = 1_700_000_000_000;

  it('flattens every status change on every order into one list', () => {
    const feed = buildNotificationFeed([
      order('o1', [
        { status: 'pending', ts: T0 },
        { status: 'confirmed', ts: T0 + 1000 },
      ]),
      order('o2', [{ status: 'pending', ts: T0 + 2000 }]),
    ]);

    assert.equal(feed.length, 3);
    assert.deepEqual(
      feed.map((e) => e.orderId),
      ['o2', 'o1', 'o1'],
    );
  });

  it('orders newest first, so the most recent event is at the top', () => {
    const feed = buildNotificationFeed([
      order('o1', [
        { status: 'pending', ts: T0 },
        { status: 'delivered', ts: T0 + 5000 },
        { status: 'confirmed', ts: T0 + 2500 },
      ]),
    ]);

    assert.deepEqual(
      feed.map((e) => e.status),
      ['delivered', 'confirmed', 'pending'],
    );
  });

  it('sorts stably when two transitions share a millisecond', () => {
    // A fast double-advance, or a client clock with coarse resolution, produces
    // equal timestamps. Without a tiebreak the relative order is
    // implementation-defined and the same order can move between renders.
    const feed = buildNotificationFeed([
      order('o1', [
        { status: 'pending', ts: T0 },
        { status: 'confirmed', ts: T0 },
      ]),
      order('o2', [{ status: 'pending', ts: T0 }]),
    ]);

    // Deterministic across repeated calls, which is the actual requirement.
    const once = feed.map((e) => e.id);
    const twice = buildNotificationFeed([
      order('o1', [
        { status: 'pending', ts: T0 },
        { status: 'confirmed', ts: T0 },
      ]),
      order('o2', [{ status: 'pending', ts: T0 }]),
    ]).map((e) => e.id);
    assert.deepEqual(once, twice);
  });

  it('gives every entry a unique id, so @for tracking cannot collide', () => {
    const feed = buildNotificationFeed([
      order('o1', [
        { status: 'pending', ts: T0 },
        { status: 'confirmed', ts: T0 + 1 },
      ]),
    ]);
    assert.equal(new Set(feed.map((e) => e.id)).size, feed.length);
  });

  it('marks everything unread when the user has never opened the feed', () => {
    // ABSENT notificationsReadAt must NOT mean "already seen" - a first-time
    // user needs to see that their order arrived.
    const feed = buildNotificationFeed([order('o1', [{ status: 'pending', ts: T0 }])], null);
    assert.equal(feed[0].read, false);
    assert.equal(countUnread(feed), 1);
  });

  it('marks entries at or before the read marker as read', () => {
    const feed = buildNotificationFeed(
      [
        order('o1', [
          { status: 'pending', ts: T0 },
          { status: 'confirmed', ts: T0 + 1000 },
          { status: 'preparing', ts: T0 + 2000 },
        ]),
      ],
      T0 + 1000,
    );

    // Newest first: preparing(2000) is after the marker, confirmed(1000) is
    // exactly ON it, pending(0) is before it. `<=` is deliberate: an entry the
    // user has seen must never flicker back to unread because the marker landed
    // on the same millisecond.
    assert.deepEqual(
      feed.map((e) => e.read),
      [false, true, true],
    );
    assert.equal(countUnread(feed), 1);
  });

  it('skips an order with no statusHistory instead of throwing', () => {
    // Real: the oldest documents predate the field, and firestore.rules
    // `allow create` does not require it - so one written by hand in the console
    // is rules-valid and would make a bare `.map` throw.
    const feed = buildNotificationFeed([
      { id: 'legacy', statusHistory: undefined },
      { id: 'nulled', statusHistory: null },
      order('o1', [{ status: 'pending', ts: T0 }]),
    ]);
    assert.equal(feed.length, 1);
    assert.equal(feed[0].orderId, 'o1');
  });

  it('skips a status this build does not know about', () => {
    // A future build adding a status must not blank this build's feed.
    const feed = buildNotificationFeed([
      order('o1', [
        { status: 'pending', ts: T0 },
        { status: 'refunded', ts: T0 + 1 },
        { status: '', ts: T0 + 2 },
      ]),
    ]);
    assert.equal(feed.length, 1);
    assert.equal(feed[0].status, 'pending');
  });

  it('drops only the entry with an unusable timestamp, keeping the rest', () => {
    // One good, one garbage, one good. Losing the whole order to a single bad
    // value would hide the transitions that ARE readable.
    const feed = buildNotificationFeed([
      {
        id: 'o1',
        statusHistory: [
          { status: 'pending', timestamp: { toMillis: () => T0 } },
          { status: 'confirmed', timestamp: 'not-a-date' },
          { status: 'preparing', timestamp: { toMillis: () => T0 + 2 } },
        ],
      },
    ]);

    assert.equal(feed.length, 2);
    assert.deepEqual(
      feed.map((e) => e.status),
      ['preparing', 'pending'],
    );
  });

  it('reads a statusHistory entry stored as a real Date, not a Timestamp', () => {
    // A plain Date is an object, so it has to be handled before the generic
    // Timestamp branch or every entry is silently dropped.
    const feed = buildNotificationFeed([
      { id: 'o1', statusHistory: [{ status: 'pending', timestamp: new Date(T0) }] },
    ]);
    assert.equal(feed.length, 1);
    assert.equal(feed[0].at, T0);
  });

  it('caps the feed so the caller cannot render an unbounded list', () => {
    const steps = Array.from({ length: FEED_LIMIT + 25 }, (_, i) => ({
      status: 'pending',
      ts: T0 + i,
    }));
    assert.equal(buildNotificationFeed([order('o1', steps)]).length, FEED_LIMIT);
  });

  it('carries the notice copy so the toast and the list cannot disagree', () => {
    const feed = buildNotificationFeed([order('o1', [{ status: 'delivered', ts: T0 }])]);
    assert.equal(feed[0].title, ORDER_STATUS_NOTICES.delivered.title);
    assert.equal(feed[0].body, ORDER_STATUS_NOTICES.delivered.body);
    // And the toast line is derived from the same record, not a second copy.
    assert.ok(statusToastLine('delivered').includes(ORDER_STATUS_NOTICES.delivered.body));
  });

  it('has notice copy for every status the app can display', () => {
    for (const status of [
      'pending',
      'confirmed',
      'preparing',
      'out_for_delivery',
      'delivered',
      'cancelled',
    ] as const) {
      assert.ok(ORDER_STATUS_NOTICES[status], `no notice for ${status}`);
      assert.ok(ORDER_STATUS_NOTICES[status].title.length > 0);
      assert.ok(ORDER_STATUS_NOTICES[status].body.length > 0);
    }
  });
});

describe('asOrderStatus', () => {
  it('passes a known status through', () => {
    assert.equal(asOrderStatus('delivered'), 'delivered');
  });

  it('rejects anything it does not recognise', () => {
    // The stored status is untrusted document data. A future build adding a
    // status must not blank this build's feed.
    for (const bad of ['refunded', '', 'PENDING', null, undefined, 7, {}]) {
      assert.equal(asOrderStatus(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });
});

describe('toEpochMs', () => {
  it('reads a Firestore Timestamp via toMillis', () => {
    assert.equal(toEpochMs({ toMillis: () => 1234 }), 1234);
  });

  it('reads a legacy Timestamp via toDate', () => {
    assert.equal(toEpochMs({ toDate: () => new Date(5678) }), 5678);
  });

  it("reads Firestore's JSON {seconds, nanoseconds} shape", () => {
    assert.equal(toEpochMs({ seconds: 2, nanoseconds: 500_000_000 }), 2500);
  });

  it('passes a Date and an epoch number straight through', () => {
    assert.equal(toEpochMs(new Date(999)), 999);
    assert.equal(toEpochMs(999), 999);
  });

  it('parses an ISO string', () => {
    assert.equal(toEpochMs('1970-01-01T00:00:01.000Z'), 1000);
  });

  it('returns null rather than NaN for unusable input', () => {
    // NaN in a sort comparator is not "slightly wrong": it makes the engine's
    // ordering implementation-defined, reordering the whole feed.
    for (const bad of [null, undefined, 'not-a-date', {}, [], true, NaN, { toMillis: () => NaN }]) {
      assert.equal(toEpochMs(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  it('rejects an empty string instead of reading it as 0', () => {
    // Number('') is 0, which would silently date every entry to the epoch.
    assert.equal(toEpochMs(''), null);
    assert.equal(toEpochMs('   '), null);
  });
});

describe('groupByDay', () => {
  const DAY = 86_400_000;

  it('splits today from yesterday from earlier, newest section first', () => {
    // Fixed local noon so the test does not depend on the runner's timezone.
    const now = new Date(2026, 2, 10, 12, 0, 0, 0).getTime();
    const entries = buildNotificationFeed([
      {
        id: 'o1',
        statusHistory: [
          { status: 'pending', timestamp: { toMillis: () => now - 5 * DAY } },
          { status: 'confirmed', timestamp: { toMillis: () => now - DAY - 1000 } },
          { status: 'preparing', timestamp: { toMillis: () => now - 60_000 } },
        ],
      },
    ]);

    const groups = groupByDay(entries, now);
    assert.deepEqual(
      groups.map((g) => g.label),
      ['Today', 'Yesterday', 'Earlier'],
    );
    assert.equal(groups[0].entries[0].status, 'preparing');
  });

  it('uses LOCAL midnight, so a late-evening order is not filed under yesterday', () => {
    // 11pm local. Comparing against a UTC midnight is the classic bug that puts
    // this under yesterday for any timezone east of UTC.
    const now = new Date(2026, 2, 10, 23, 0, 0, 0).getTime();
    const entries = buildNotificationFeed([
      {
        id: 'o1',
        statusHistory: [{ status: 'pending', timestamp: { toMillis: () => now - 60_000 } }],
      },
    ]);
    assert.equal(groupByDay(entries, now)[0].label, 'Today');
  });

  it('returns nothing for an empty feed', () => {
    assert.deepEqual(groupByDay([], Date.now()), []);
  });
});

describe('relativeTime', () => {
  const now = 1_700_000_000_000;

  it('collapses anything under 45 seconds to "just now"', () => {
    assert.equal(relativeTime(now, now), 'just now');
    assert.equal(relativeTime(now - 44_000, now), 'just now');
  });

  it('reads as minutes, then hours, then days', () => {
    assert.equal(relativeTime(now - 5 * 60_000, now), '5m');
    assert.equal(relativeTime(now - 3 * 3_600_000, now), '3h');
    assert.equal(relativeTime(now - 2 * DAY_MS, now), '2d');
  });

  it('falls back to a date beyond a week', () => {
    const old = relativeTime(now - 30 * DAY_MS, now);
    assert.ok(!/^\d/.test(old), `expected a date, got ${old}`);
  });

  it('says "just now" for a future timestamp rather than "in 3m"', () => {
    // Clock skew, or a server timestamp ahead of the device. "in 3m" would be
    // inventing a fact; "just now" is the truthful reading.
    assert.equal(relativeTime(now + 3 * 60_000, now), 'just now');
  });
});

const DAY_MS = 86_400_000;

/** Counts non-overlapping occurrences, for the no-stacking assertion. */
function times2Count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
