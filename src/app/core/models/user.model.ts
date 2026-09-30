// src/app/core/models/user.model.ts
// Five-orites Scoop — User Data Models
// Author: Five-orites Scoop team (see README)

import { Timestamp } from '@angular/fire/firestore';

export type UserRole = 'customer' | 'admin';

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
}
