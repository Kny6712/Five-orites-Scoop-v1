// src/app/core/services/auth.service.ts
// Five-orites Scoop — Authentication Service
// Author: Five-orites Scoop team (see README)

import { Injectable, inject } from '@angular/core';
import {
  Auth,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
  verifyBeforeUpdateEmail,
  reauthenticateWithCredential,
  updatePassword,
  deleteUser,
  EmailAuthProvider,
  User,
} from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from '@angular/fire/firestore';
import { BehaviorSubject, Observable } from 'rxjs';
import { AppUser, isStaffRole } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);

  private currentUserSubject = new BehaviorSubject<AppUser | null>(null);
  readonly currentUser$: Observable<AppUser | null> = this.currentUserSubject.asObservable();

  private authReadySubject = new BehaviorSubject<boolean>(false);
  readonly authReady$ = this.authReadySubject.asObservable();

  constructor() {
    onAuthStateChanged(this.auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const appUser = await this.buildAppUser(firebaseUser);
          this.currentUserSubject.next(appUser);
        } else {
          this.currentUserSubject.next(null);
        }
      } finally {
        if (!this.authReadySubject.getValue()) {
          this.authReadySubject.next(true);
        }
      }
    });
  }

  private async buildAppUser(firebaseUser: User): Promise<AppUser> {
    const userDocRef = doc(this.firestore, `users/${firebaseUser.uid}`);
    let lastError: unknown;

    // Two attempts, not one. A single transient Firestore failure used to drop
    // an admin into the customer view for the whole session, because the catch
    // below fabricates role: 'customer'. Retrying the whole read-then-create
    // body is safe: the create only runs after a read that found nothing.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
          // User doc already exists — return it AS STORED.
          //
          // We deliberately do NOT trim/normalize the role here. `firestore.rules`
          // compares the raw stored string, and the client's `can()`/`isStaffRole()`
          // do the same. Normalizing only on the client (as a former version did)
          // made `isStaffRole('owner')` TRUE while the rules still denied every
          // admin request — a full Admin Panel that 403s on every tap, which is
          // worse than the truthful failure. A role with stray whitespace now
          // fails closed IDENTICALLY in both layers (empty Admin Panel for the
          // user, every write refused by the rules). Fix the stored value, not
          // the read path — and the drift lint in tests/logic.test.ts guards the
          // client/rules boundary.
          return userSnap.data() as AppUser;
        }

        // ── New user — create Firestore document ──────────────────
        const newUser: AppUser = {
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? '',
          displayName: firebaseUser.displayName ?? 'Scoop Lover',
          photoURL: firebaseUser.photoURL ?? undefined,
          role: 'customer', // default role, never trust client input
          createdAt: serverTimestamp() as never,
        };

        // merge: true matters. Without it, a setDoc against a document that
        // already exists is a full overwrite that deletes every omitted field —
        // and this payload hard-codes role: 'customer', so an admin who hit
        // this path would be silently demoted, wiping the very role field the
        // security rules read to authorise them.
        await setDoc(
          userDocRef,
          {
            uid: newUser.uid,
            email: newUser.email,
            displayName: newUser.displayName,
            photoURL: newUser.photoURL ?? null,
            role: 'customer',
            createdAt: serverTimestamp(),
          },
          { merge: true },
        );

        return newUser;
      } catch (err) {
        lastError = err;
      }
    }

    console.error('Error building AppUser:', lastError);
    return {
      uid: firebaseUser.uid,
      email: firebaseUser.email ?? '',
      displayName: firebaseUser.displayName ?? 'Guest',
      role: 'customer',
      createdAt: null as never,
    };
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    const credential = await signInWithEmailAndPassword(this.auth, email, password);
    await this.assertNotSuspended(credential.user.uid);
  }

  /**
   * Signs the user out if their account has been suspended, and says why.
   *
   * WHY THIS IS HERE AND NOT IN THE RULES
   * Firestore rules can block a suspended user's READS and WRITES, but they
   * cannot revoke a Firebase AUTH session that already exists — and this app's
   * carts, wishlists and saved addresses all live in localStorage keyed by uid,
   * so a session that survives the block still has working client state. The
   * honest enforcement point is the moment credentials are accepted.
   *
   * The read itself is permitted: `users/{uid}` is readable by its owner, so
   * this does not need admin rights and works from any sign-in path.
   *
   * Signing out rather than merely refusing matters — if the session were left
   * open the user would sit on a signed-in shell that fails on every query, with
   * no way to tell that the reason was the account and not the network.
   */
  private async assertNotSuspended(uid: string): Promise<void> {
    let reason = '';
    let suspended = false;
    try {
      const snap = await getDoc(doc(this.firestore, `users/${uid}`));
      const data = snap.data() as
        { isSuspended?: boolean; suspendReason?: string | null } | undefined;
      suspended = data?.isSuspended === true;
      reason = data?.suspendReason?.trim() ?? '';
    } catch {
      // If the check itself fails, do NOT block the sign-in. A Firestore outage
      // must not read as "your account is banned", and the rules still gate the
      // data itself.
      return;
    }
    if (!suspended) return;
    await this.signOut();
    throw new Error(
      reason
        ? `This account has been suspended: ${reason}`
        : 'This account has been suspended. Contact the shop if you think this is a mistake.',
    );
  }

  /**
   * Sends a password-reset email.
   *
   * There was no recovery path at all: a customer who forgot their password had
   * no way back into an account that holds their saved addresses and order
   * history. `sendPasswordResetEmail` is deliberately silent about whether an
   * account exists — the UI shows the same confirmation either way, so this
   * cannot be used to discover which emails are registered.
   */
  async sendPasswordResetEmail(email: string): Promise<void> {
    if (!email.trim()) throw new Error('Enter your email address first.');
    await sendPasswordResetEmail(this.auth, email.trim());
  }

  async registerWithEmail(email: string, password: string, displayName: string): Promise<void> {
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    await updateProfile(credential.user, { displayName });

    // createUserWithEmailAndPassword fires onAuthStateChanged before this
    // function resumes, and buildAppUser creates the user document from that
    // event. So this write races it.
    //
    // Two failure modes have to be avoided, and merging a partial payload
    // avoided only one of them:
    //
    //  1. If buildAppUser's create lands first, a partial non-merged setDoc
    //     would overwrite the whole document and delete `uid` and `role`.
    //  2. If THIS write lands first on a document that does not yet exist,
    //     the created document held only {displayName, createdAt} — no `uid`,
    //     no `role` — so firestore.rules `allow create` (which requires both)
    //     rejected it. The user was left with a role-less document they could
    //     never be promoted out of, because the role-immutability check can
    //     never be satisfied by a document that has no role to begin with.
    //
    // So: write a complete, rules-valid payload, and only when the document
    // does not already exist. On an existing document the only thing worth
    // updating is the display name, and merging that alone avoids clobbering
    // an elevated role.
    const userDocRef = doc(this.firestore, `users/${credential.user.uid}`);
    const existing = await getDoc(userDocRef);

    if (existing.exists()) {
      await setDoc(userDocRef, { displayName }, { merge: true });
    } else {
      await setDoc(
        userDocRef,
        {
          uid: credential.user.uid,
          email: credential.user.email ?? '',
          displayName,
          photoURL: null,
          role: 'customer',
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
  }

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    const credential = await signInWithPopup(this.auth, provider);
    // Same check as the password path. A suspension that only applied to email
    // sign-in would be trivially bypassed by signing in with Google instead.
    await this.assertNotSuspended(credential.user.uid);
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
  }

  get currentUserSnapshot(): AppUser | null {
    return this.currentUserSubject.getValue();
  }

  // ── Profile editing ───────────────────────────────────────────────────────

  /**
   * Saves editable profile fields.
   *
   * THREE stores have to agree, and getting this wrong is silent rather than
   * loud:
   *
   *  1. Firebase Auth (`updateProfile`) — the identity record. Google and other
   *     providers read displayName/photoURL from here for OTHER apps.
   *  2. Firestore (`users/{uid}`) — what this app actually renders from.
   *  3. The in-memory `currentUserSubject` — what every subscribed component
   *     currently sees.
   *
   * Why each is required:
   *
   *  - Auth alone REVERTS. `buildAppUser` reads the Firestore document for an
   *    existing user and never consults the Auth record, so the next
   *    `onAuthStateChanged` — which fires on token refresh, on tab focus, and on
   *    every sign-in — rebuilds from the stale Firestore doc and the new name
   *    silently snaps back.
   *  - Firestore alone does not update the UI. `currentUserSubject` is only ever
   *    pushed from inside the `onAuthStateChanged` callback, so a profile save
   *    would leave the menu showing the old name until a page reload.
   *  - The subject alone is lost the moment the app is closed.
   *
   * `merge: true` is MANDATORY, and the reason is an asymmetry in the rules that
   * is easy to get backwards:
   *
   *   `allow update: if isAdmin() || (isOwner(uid) && role unchanged && uid unchanged)`
   *
   * A non-merged `setDoc` from a CUSTOMER omits `role`, so
   * `request.resource.data.role` is null against a stored 'customer' and the
   * comparison FAILS — the write is rejected, loudly, which is safe.
   *
   * The same non-merged write from an ADMIN takes the `isAdmin()` branch, which
   * short-circuits with no validation whatsoever. The write SUCCEEDS and the
   * document loses `role`. For an admin editing themselves that is instant
   * self-demotion and lockout of every admin page.
   *
   * So code that behaves correctly for a customer corrupts silently for an admin.
   * Always merge.
   *
   * `email` is deliberately NOT in the patch type — see changeEmail().
   */
  async updateProfile(patch: ProfilePatch): Promise<AppUser> {
    const firebaseUser = this.auth.currentUser;
    if (!firebaseUser) throw new Error('You must be signed in to update your profile.');

    // Only send what actually changed to Auth. updateProfile() with an explicit
    // `null` photoURL is how you REMOVE a photo, so an absent key means "leave
    // it alone" while a present null means "clear it" — the two must not be
    // conflated by always sending the current value.
    const authPatch: { displayName?: string | null; photoURL?: string | null } = {};
    if (patch.displayName !== undefined) authPatch.displayName = patch.displayName;
    if (patch.photoURL !== undefined) authPatch.photoURL = patch.photoURL;
    if (Object.keys(authPatch).length > 0) {
      await updateProfile(firebaseUser, authPatch);
    }

    // Firestore. `role` and `uid` are absent from the patch, and merge preserves
    // whatever is stored, so the rules' ownership check stays satisfied.
    // Bracket access, not dot access: tsconfig sets
    // `noPropertyAccessFromIndexSignature`, and this is a Record.
    const firestorePatch: Record<string, unknown> = { ...patch };
    if (firestorePatch['displayName'] === undefined) delete firestorePatch['displayName'];
    if (Object.keys(firestorePatch).length > 0) {
      await setDoc(doc(this.firestore, `users/${firebaseUser.uid}`), firestorePatch, {
        merge: true,
      });
    }

    return this.refreshProfile();
  }

  /**
   * Re-reads the user document and pushes it into `currentUserSubject`.
   *
   * This is what makes a profile save show up immediately in the menu and the
   * header. Returns the fresh user so a caller can navigate with it.
   */
  async refreshProfile(): Promise<AppUser> {
    const firebaseUser = this.auth.currentUser;
    if (!firebaseUser) throw new Error('You must be signed in.');

    const snap = await getDoc(doc(this.firestore, `users/${firebaseUser.uid}`));
    const user = snap.exists()
      ? ({ ...snap.data(), uid: firebaseUser.uid } as AppUser)
      : ({
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? '',
          displayName: firebaseUser.displayName ?? 'Scoop Lover',
          photoURL: firebaseUser.photoURL ?? null,
          role: 'customer',
          createdAt: serverTimestamp() as never,
        } as AppUser);

    this.currentUserSubject.next(user);
    return user;
  }

  /**
   * Changes the sign-in email address.
   *
   * Two things make this different from every other field:
   *
   *  - It goes through Firebase Auth ONLY, never straight to Firestore. The
   *    users-collection update rule has no `hasOnly`, so a customer could
   *    otherwise write any string into their own document's `email` — including
   *    somebody else's address, or one that no longer matches their real account.
   *    The two records would then disagree, and the Firestore copy is what the
   *    admin Users page displays.
   *
   *  - It requires RECENT AUTHENTICATION. Firebase rejects the change otherwise,
   *    with an opaque auth error, so the caller must re-authenticate first. See
   *    reauthenticateWithPassword().
   *
   * Unavailable for Google accounts: the address belongs to the Google identity,
   * and changing it here would lock the user out of their own account. The
   * profile page shows it read-only in that case — see isEmailManagedByProvider().
   *
   * `verifyBeforeUpdateEmail` sends a confirmation to the NEW address and only
   * then revokes the old one, which is the behaviour users expect and stops a
   * typo from locking them out.
   */
  async changeEmail(newEmail: string, password: string): Promise<void> {
    const firebaseUser = this.auth.currentUser;
    if (!firebaseUser) throw new Error('You must be signed in to change your email.');

    if (this.isEmailManagedByProvider()) {
      throw new Error('Your email is managed by your Google account and cannot be changed here.');
    }

    const trimmed = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new Error('Enter a valid email address.');
    }
    if (trimmed === firebaseUser.email) return;

    // Re-authenticate FIRST. Without this Firebase throws
    // auth/requires-recent-login, and the user is left staring at an opaque
    // error with no idea a password was needed.
    const credential = EmailAuthProvider.credential(firebaseUser.email ?? '', password);
    await reauthenticateWithCredential(firebaseUser, credential);

    await verifyBeforeUpdateEmail(firebaseUser, trimmed);

    // Keep the Firestore copy in step. This is safe precisely BECAUSE it comes
    // from Auth, not from user input: the value was just verified.
    await setDoc(
      doc(this.firestore, `users/${firebaseUser.uid}`),
      { email: trimmed },
      {
        merge: true,
      },
    );
    await this.refreshProfile();
  }

  /**
   * Confirms the current password.
   *
   * Kept separate from changeEmail so the profile page can re-authenticate
   * BEFORE the user commits to a new address, rather than discovering the need
   * for a password after they have already typed it into the wrong field.
   */
  async reauthenticateWithPassword(password: string): Promise<void> {
    const firebaseUser = this.auth.currentUser;
    if (!firebaseUser) throw new Error('You must be signed in.');
    const credential = EmailAuthProvider.credential(firebaseUser.email ?? '', password);
    await reauthenticateWithCredential(firebaseUser, credential);
  }

  /**
   * Does this account actually have a password to change?
   *
   * The honest gate for a Change Password control, and deliberately NOT the
   * inverse of "signed in with an external provider". Those two are not the same
   * question:
   *
   *   - a Google-only account has NO password credential at all, so there is
   *     nothing to change and `updatePassword` cannot be called on it;
   *   - an account that has signed in with BOTH Google and email/password HAS a
   *     password, and hiding the control from it would be wrong.
   *
   * `providerData` is the only source that distinguishes these, and it is
   * already read for the email-lock check below.
   */
  hasPasswordProvider(): boolean {
    const firebaseUser = this.auth.currentUser;
    if (!firebaseUser) return false;
    return firebaseUser.providerData.some((p) => p.providerId === 'password');
  }

  /**
   * Changes the password, after confirming the current one.
   *
   * The reauthentication is not optional. Firebase rejects `updatePassword` with
   * `auth/requires-recent-login` when the session is older than a few minutes,
   * and this is the one action on the profile page where the failure mode of
   * skipping it is an error dialog with no way forward — the user would simply be
   * told to sign in again, mid-form.
   *
   * The current password is re-checked here rather than relying on the caller's
   * earlier `reauthenticateWithPassword`, so this method is safe to call on its
   * own.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const firebaseUser = this.auth.currentUser;
    if (!firebaseUser) throw new Error('You must be signed in.');
    if (!this.hasPasswordProvider()) {
      throw new Error('This account signs in with Google, so it has no password to change.');
    }
    if (newPassword.length < 6) {
      throw new Error('Choose a password of at least 6 characters.');
    }
    if (currentPassword === newPassword) {
      throw new Error('The new password must be different from the current one.');
    }

    const credential = EmailAuthProvider.credential(firebaseUser.email ?? '', currentPassword);
    await reauthenticateWithCredential(firebaseUser, credential);
    await updatePassword(firebaseUser, newPassword);
  }

  /**
   * Is the email owned by an external identity provider?
   *
   * True for Google sign-in, where the address is the Google account's and is
   * not ours to change. Detected from `providerData`, so it stays correct if
   * another provider is added later.
   */
  isEmailManagedByProvider(): boolean {
    const firebaseUser = this.auth.currentUser;
    if (!firebaseUser) return false;
    const EXTERNAL = ['google.com', 'facebook.com', 'apple.com', 'github.com'];
    return firebaseUser.providerData.some((p) => EXTERNAL.includes(p.providerId));
  }

  // ── Account deletion ───────────────────────────────────────────────────────

  /**
   * Deletes the signed-in user's account. Irreversible.
   *
   * Both app stores require an in-app deletion path for an app that lets people
   * create an account, and PRIVACY.md could only describe a manual email route
   * because nothing could delete anything.
   *
   * ORDER MATTERS, and getting it backwards is the trap:
   *
   *   1. Firestore `users/{uid}` FIRST, via the self-delete rule.
   *   2. The Auth record SECOND, via `deleteUser()`.
   *
   * Doing it the other way round leaves an orphaned user document that the rules
   * still recognise — `myRole()` would keep resolving and the account would look
   * alive in every read, with no way to remove it because `deleteUser()` is
   * irreversible and the session is gone. Doing Firestore first means the worst
   * failure is a user document with no Auth record, which is inert and removable
   * by an owner from the console.
   *
   * `deleteUser()` requires a RECENT sign-in. A user who set their profile up
   * weeks ago and taps Delete will get `auth/requires-recent-login`, so the
   * caller must re-authenticate first; `recentlyAuthenticated()` is exposed so
   * the page can decide whether to prompt for a password before calling this.
   *
   * Staff are refused. If an owner deletes their own account, every admin page is
   * stranded — `isStaff()` fails for everyone and the only recovery is another
   * owner promoting a replacement. A single-account shop would have no other
   * owner, so the message tells them to promote someone else first.
   *
   * Their ORDERS are not deleted, because they are the shop's financial records.
   * `anonymiseDeletedCustomerOrders` (functions/src/index.ts) redacts the
   * personal fields on them once the user document goes.
   */
  async deleteAccount(): Promise<void> {
    const firebaseUser = this.auth.currentUser;
    if (!firebaseUser) throw new Error('You must be signed in to delete your account.');
    const uid = firebaseUser.uid;

    if (isStaffRole(this.currentUserSnapshot?.role)) {
      throw new Error(
        'You cannot delete an account that has staff access. Promote someone else to owner first, then delete this one.',
      );
    }

    await deleteDoc(doc(this.firestore, `users/${uid}`));
    await deleteUser(firebaseUser);

    // Clear local state. The Auth SDK fires its own sign-out for the deleted
    // user, but the in-memory profile is a separate subject and would otherwise
    // keep rendering the deleted user's name until the next full reload.
    this.currentUserSubject.next(null);
  }

  /**
   * Whether the session is recent enough for `deleteUser()` to be accepted.
   *
   * Firebase requires a sign-in within roughly the last few minutes. Checking
   * this before offering the action means the user is prompted for their
   * password up front instead of pressing Delete and getting an opaque
   * `auth/requires-recent-login` failure.
   */
  recentlyAuthenticated(): boolean {
    const firebaseUser = this.auth.currentUser;
    if (!firebaseUser) return false;
    // `creationTime` is the moment of the LAST sign-in, not account creation --
    // Firebase overwrites it on every sign-in, which is exactly the semantic
    // wanted here. It is typed `string | undefined`; absent means "unknown",
    // and treating unknown as stale is the safe direction, because it makes the
    // password field appear rather than letting deleteUser() fail opaquely.
    const signedInAt = firebaseUser.metadata.creationTime;
    if (!signedInAt) return false;
    const elapsed = Date.now() - new Date(signedInAt).getTime();
    // A clock skew that puts the sign-in in the future yields a negative elapsed.
    // That is not "fresh" by accident; treat anything implausible as stale.
    return elapsed >= 0 && elapsed < FIVE_MINUTES_MS;
  }
}

/** Firebase's own freshness window for destructive Auth operations. */
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * The fields a user may change about themselves.
 *
 * Deliberately excludes `role` and `uid`. They are not merely omitted by
 * convention — the Firestore rules independently forbid a customer from changing
 * either, and typing them here would just be a lie the compiler could catch.
 * Excludes `email` too, which must go through changeEmail().
 */
export interface ProfilePatch {
  displayName?: string;
  photoURL?: string | null;
  phone?: string | null;
  notificationsEnabled?: boolean;
  /**
   * Epoch ms of the newest notification the user has seen.
   *
   * A plain number, NOT a `serverTimestamp()`, for two reasons. The feed compares
   * it against normalised epoch ms, and a sentinel read straight back is not
   * resolved yet - this file already documents that `createdAt` comes back that
   * way and that `.toDate()` throws on it. And `suspendedAt` is already stored as
   * epoch ms, so this follows the existing convention rather than inventing a
   * second one.
   *
   * `updateProfile` merges, so writing it never disturbs `role`/`uid`, which the
   * rules require to be preserved.
   */
  notificationsReadAt?: number | null;
}
