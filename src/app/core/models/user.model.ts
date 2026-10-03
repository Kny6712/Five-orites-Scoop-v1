// src/app/core/models/user.model.ts
// Five-orites Scoop — User Data Models
// Author: Five-orites Scoop team (see README)

import { Timestamp } from '@angular/fire/firestore';

/**
 * What a user is allowed to reach.
 *
 * WAS BINARY. `admin-users.page.ts:270` described a single undifferentiated
 * role: one admin can "manage inventory, orders, analytics, vouchers and every
 * user account". For a shop with one owner that is exactly right. For a shop with
 * a part-timer taking orders, it means the minimum useful privilege is full
 * control over the user directory — and there is no tier between "can do
 * everything" and "can do nothing".
 *
 * `owner` is the ORIGINAL admin role, renamed for accuracy: it is the one that
 * can promote and demote. A shop that upgrades keeps working, because
 * `staffRole` treats every legacy `'admin'` as full access.
 *
 * THE ORDER MATTERS. `staffRole` is checked in sequence, so put the most
 * privileged first and the fallback last.
 */
export type UserRole = 'customer' | 'staff' | 'manager' | 'admin' | 'owner';

/** Display labels, in ascending privilege. */
export const ROLE_LABELS: Record<UserRole, string> = {
  customer: 'Customer',
  staff: 'Staff',
  manager: 'Manager',
  admin: 'Admin',
  owner: 'Owner',
};

/** Rank per role. Higher is more privileged. Used for "is this an admin at all" checks. */
export const ROLE_RANK: Record<UserRole, number> = {
  customer: 0,
  staff: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

/**
 * A plain-English summary of what a tier can reach, for the promotion dialog.
 *
 * The dialog used to say "they will be able to manage everything", which stopped
 * being true and stopped being useful the moment there was more than one staff
 * role. This lists the actual PAGES, because the difference between `manager` and
 * `admin` is precisely that a manager cannot open this one.
 */
export const ROLE_SUMMARY: Record<UserRole, string> = {
  customer: 'No admin pages at all.',
  staff: 'They can work the fulfilment queue and the delivery map. Nothing else.',
  manager: 'They can run the shop: orders, inventory, analytics and reviews.',
  admin: 'Everything a manager can, plus vouchers. They cannot change anyone\'s role.',
  owner: 'Full access, including this user directory and the shop settings.',
};

/**
 * Every capability, in one list.
 *
 * A string union rather than booleans scattered across the app, so a new
 * capability cannot be half-implemented: it either appears here or nowhere, and
 * the compiler finds every site that must handle it.
 */
export type Capability =
  | 'view_dashboard'
  | 'manage_orders'
  | 'manage_inventory'
  | 'view_analytics'
  | 'manage_vouchers'
  | 'moderate_reviews'
  | 'manage_users'
  | 'manage_settings';

/**
 * What each role may do.
 *
 * Read this before adding a role: the point of the tiers is that a `staff`
 * account can take orders WITHOUT being able to delete flavors or promote
 * people. Widening a row here is a security decision, not a UI one.
 */
export const ROLE_CAPABILITIES: Record<UserRole, readonly Capability[]> = {
  customer: [],
  // Can work the queue and the map, nothing else.
  staff: ['view_dashboard', 'manage_orders'],
  // Everything staff can do, plus the catalog, the money and review moderation.
  // Matches firestore.rules `canRunShop()`.
  manager: [
    'view_dashboard', 'manage_orders',
    'manage_inventory', 'view_analytics', 'moderate_reviews',
  ],
  // Everything except the user directory and the shop settings — the rows a
  // part-timer and a shift lead must not be able to reach.
  admin: [
    'view_dashboard', 'manage_orders',
    'manage_inventory', 'view_analytics', 'manage_vouchers',
    'moderate_reviews',
  ],
  // The only role that can change roles or the shop settings. This is what the
  // app's original single `admin` role maps to.
  owner: [
    'view_dashboard', 'manage_orders',
    'manage_inventory', 'view_analytics', 'manage_vouchers',
    'moderate_reviews', 'manage_users', 'manage_settings',
  ],
};

/** True when `role` carries `capability`. Unknown/absent roles get nothing. */
export function can(role: string | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  const caps = ROLE_CAPABILITIES[role as UserRole];
  // A role string that is not in the map — a typo, or a document written by a
  // future version — must fail CLOSED. Defaulting to the old behaviour would
  // silently grant access to anyone whose role this build does not know.
  if (!caps) return false;
  return caps.includes(capability);
}

/** True for any role that reaches the admin area at all. */
export function isStaffRole(role: string | null | undefined): boolean {
  return can(role, 'view_dashboard');
}

/** Coerces anything stored onto a known role, defaulting to the safest. */
export function asRole(value: unknown): UserRole {
  return value === 'staff' || value === 'manager' || value === 'admin' || value === 'owner'
    ? value
    : 'customer';
}

export interface AppUser {
  uid: string;
  email: string;
  /**
   * CAN BE ABSENT AT RUNTIME, despite the non-optional type.
   *
   * `buildAppUser` returns `userSnap.data() as AppUser` — an unchecked cast — and
   * the only documented way to create the first admin is by hand in the Firebase
   * console with literally `{ uid, role }`. `firestore.rules` `allow create` does
   * not require `displayName`, so that sparse document is rules-valid. A profile
   * form that calls `displayName.trim()` on such a user throws.
   *
   * Prefer `?? ''` at every call site; `app.component.ts` getUserInitials() is the
   * existing precedent.
   */
  displayName: string;
  /**
   * Stored as `null`, not `undefined` — auth.service writes
   * `photoURL: newUser.photoURL ?? null`. So the honest runtime type is
   * `string | null | undefined`, which `string | undefined` does not express.
   */
  photoURL?: string | null;
  role: UserRole;
  /**
   * CAN BE `null` at runtime. The buildAppUser failure path returns
   * `createdAt: null as never`, and the success path stores a `serverTimestamp()`
   * sentinel rather than a resolved Timestamp. `.toDate()` throws on both. Use
   * the defensive formatDate helpers the pages already carry.
   */
  createdAt: Timestamp;

  /** Contact number, added by the profile page. Optional: pre-existing users have none. */
  phone?: string | null;

  /**
   * Whether the user wants order-status notifications.
   *
   * Optional, and absent means ENABLED. Existing users have no such field, and
   * defaulting them to opted-out would silently stop notifications for everyone
   * who signed up before this shipped.
   *
   * This is the user's *preference* only. The browser's own permission is a
   * separate axis, and a user cannot be granted a permission they have blocked at
   * the browser level — see NotificationService.permissionState().
   */
  notificationsEnabled?: boolean;

  /**
   * Whether an admin has blocked this account.
   *
   * Optional, and ABSENT MEANS NOT SUSPENDED. Every account predating this has
   * no such field, so defaulting it to suspended would lock out every existing
   * customer on upgrade — the same class of bug as `notificationsEnabled`.
   *
   * This is a flag, not a deletion, deliberately. `firestore.rules` has
   * `allow delete: if false` on users, so there was previously NO way to remove
   * an abusive account at all from inside the app, while their order history
   * stayed intact and readable to the other customers in it.
   *
   * Enforced at sign-in by `AuthService` rather than by rules: rules cannot
   * prevent a Firebase AUTH session from existing, only Firestore reads and
   * writes. See `AuthService.isSuspended`.
   */
  isSuspended?: boolean;

  /** Why they were suspended, shown to the admin. Empty for a normal account. */
  suspendReason?: string | null;

  /** Epoch ms. Lets the UI say "suspended 3 days ago" instead of just "yes". */
  suspendedAt?: number | null;

  /**
   * Free-text staff note about this customer.
   *
   * Not customer-facing, and never written by the customer — the owner branch of
   * the users update rule confines changes to a fixed key set, so a note cannot be
   * tampered with or erased from the client.
   */
  adminNote?: string | null;
}
