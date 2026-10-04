// src/app/core/guards/admin.guard.ts
// src/app/core/guards/capability.guard.ts
// Five-orites Scoop — Route guards for the staff area and per-capability access
// Author: Five-orites Scoop team (see README)
//
// WHY TWO GUARDS
// `adminGuard` answers "does this person reach the staff area at all", which is
// the one question the `/admin` parent route asks. `capabilityGuard` answers
// "may this person open THIS page", which is a different question and the one a
// `staff` account needs: a shift lead works the queue and the map, and has no
// business in the user directory.
//
// NEITHER IS A SECURITY BOUNDARY. Both are client-side and both can be bypassed
// by anyone with the raw SDK, because the Angular router does not run on the
// server. The real boundary is `firestore.rules` — which is role-tier-aware,
// but does NOT expose the same 11-name Capability vocabulary as
// `ROLE_CAPABILITIES` (there is no `hasCapability()` it shares with the client,
// despite the historical claim below). This file exists so a
// forbidden page renders a redirect instead of a wall of permission errors.
//
// The intent is one capability name per guard and rule, so any drift in meaning
// can be caught by the drift lint in tests/logic.test.ts rather than silently
// skipped — the two are kept in parity by that lint, not by a shared definition.

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { can, canManageTeam, isStaffRole, type Capability } from '../models/user.model';
import { filter, map, switchMap, take } from 'rxjs/operators';

/** The signed-in user once auth has settled. */
function readyUser(auth: AuthService) {
  return auth.authReady$.pipe(
    filter((ready) => ready),
    take(1),
    switchMap(() => auth.currentUser$.pipe(take(1))),
  );
}

/**
 * Reaches the staff area at all.
 *
 * Was `role === 'admin'`, an EXACT match — which under role tiers would have
 * locked every `staff` and `manager` account out of the whole admin side. Now a
 * capability check, so adding a tier later does not mean hunting for every
 * equality comparison.
 */
export const adminGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return readyUser(authService).pipe(
    map((user) => {
      if (isStaffRole(user?.role)) return true;
      router.navigate(['/dashboard']);
      return false;
    }),
  );
};

/**
 * Requires ONE specific capability on the route.
 *
 * ```ts
 * { path: 'users', canActivate: [capabilityGuard('manage_users')], ... }
 * ```
 *
 * A signed-out or non-staff user is sent to sign-in, not to the dashboard: the
 * difference matters because a signed-out visitor has nothing to see at
 * /dashboard, while a signed-in customer has their orders there and losing them
 * to a redirect is gratuitous.
 */
export function capabilityGuard(capability: Capability): CanActivateFn {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    return readyUser(authService).pipe(
      map((user) => {
        if (!user) {
          router.navigate(['/auth']);
          return false;
        }
        if (can(user.role, capability)) return true;
        // Back to the dashboard rather than a 404: the person is a legitimate
        // staff member who simply may not open this page, and the dashboard is
        // the page that still works for them.
        router.navigate(['/dashboard']);
        return false;
      }),
    );
  };
}

/**
 * Gate for pages a MANAGER may open but an ADMIN may not.
 *
 * There is exactly one such page — editing the public credits — and it cannot be
 * expressed through `capabilityGuard`, because `ROLE_CAPABILITIES` has no
 * capability with that shape: `manage_inventory` includes admin, and
 * `manage_users` is owner-only.
 *
 * Inventing a `manage_team` capability would not work either, and the reason is
 * worth recording. `tests/logic.test.ts` asserts the ladder invariant that every
 * capability a lower tier holds, the tier above it also holds — so granting it to
 * `manager` forces it onto `admin`, or the suite goes red. The honest options were
 * to widen admin's reach to satisfy a test, or to check the rank directly. This
 * is the second, and `firestore.rules` makes the same distinction independently in
 * `canManageTeam()`.
 */
export function teamGuard(): CanActivateFn {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    return readyUser(authService).pipe(
      map((user) => {
        if (!user) {
          router.navigate(['/auth']);
          return false;
        }
        if (canManageTeam(user.role)) return true;
        router.navigate(['/dashboard']);
        return false;
      }),
    );
  };
}
