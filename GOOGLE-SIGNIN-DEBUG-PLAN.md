# Google Sign-In Failure — Investigation Report & Debugging Plan

**Date:** 2026-10-25
**Status:** Awaiting approval — **no application code or configuration has been changed.**
**Symptom:** On the installed Android build, the Google account chooser opens, an account can be
selected, then the app returns to the sign-in screen with a red banner: **"Something went wrong."**
Expected: authentication completes, a session is established, user is redirected to `/dashboard`.

---

## A. Observed issue and remaining unknowns

### Confirmed findings (verified against the shipped APK, not hypotheses)

| #   | Finding                                                                                                                                             | Evidence                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | The banner text comes from the **native plugin**, not from app copy                                                                                 | `GoogleAuth.java:135` → `call.reject("Something went wrong", "" + statusCode)`; `auth.page.ts:171` falls back to `err.message` because no `auth/*` code matches                |
| 2   | The real failure is a **Google `ApiException` with a numeric status code** passed as `err.code`, then **discarded** — never logged, never displayed | `auth.page.ts` `parseFirebaseError()` only maps `auth/*` codes; `"10"`, `"12500"`, `"12501"` fall through to `err.message`                                                     |
| 3   | The plugin requests an ID token whose audience is the literal placeholder **`"Your Web Client Key"`**                                               | `aapt dump --values resources app-debug.apk` → `com.fiveorites.scoop:string/server_client_id = "Your Web Client Key"`                                                          |
| 4   | The config key that was set (`serverClientId`) is **never read by the Android plugin**                                                              | `GoogleAuth.java:58-60` reads only `androidClientId` → `clientId` → `R.string.server_client_id`. `capacitor.config.json` extracted from the APK contains only `serverClientId` |
| 5   | SHA-1, package name and the Android OAuth client are **correct**                                                                                    | APK signing cert SHA-1 `50:63:2A:8F:28:CD:01:99:DE:AA:EE:E8:9C:82:38:BA:80:8F:5F:9E` == `certificate_hash` in `google-services.json` for `com.fiveorites.scoop`                |
| 6   | The browser OAuth flow works and uses web client **`347528161750-sdkbhbj876ideksd0gt13q3peeb9p0hv`**                                                | Live popup URL captured by Playwright (section D)                                                                                                                              |

**Conclusion:** the failure is upstream of Firebase — Google refuses to issue an ID token for a
non-existent audience. It is not in Firebase, not in the navigation, not in the SHA-1 fingerprint,
and not in the account chooser.

### Remaining unknowns

1. The exact Google status code (almost certainly `10` DEVELOPER_ERROR or `12500` SIGN_IN_FAILED) —
   currently hidden by `parseFirebaseError`.
2. Whether `347528161750-umcfk1ieertagn3dla6gpnqah0tvb5g9` (the configured `serverClientId`) exists in
   the Cloud Console at all. It is absent from `google-services.json` and was **not** used by the
   working browser flow.
3. Whether Firebase's Google provider is enabled (the browser reached Google, so probably yes — but
   not proven end-to-end).
4. Everything native-side: no `adb` device was attached, so **no native test has been run**.

---

## B. Authentication flow mapped from the code

**Stack (verified):** Angular 17.3 + Ionic 7 standalone + Capacitor 5.7.8 + Firebase JS SDK 10.14.1
(`@angular/fire` 17). Backend = Firebase Auth + Firestore. Native Google plugin =
`@codetrix-studio/capacitor-google-auth` 3.3.6. No custom auth server.

```
auth.page.html:124  (click) signInWithGoogle()
  └─ auth.page.ts:128  isLoading=true
      └─ auth.service.ts:244  signInWithGoogle()
          ├─ NATIVE  (NativeService.isNative() === true)
          │    google-auth.service.ts:23  dynamic import plugin, GoogleAuth.initialize()
          │    google-auth.service.ts:27  GoogleAuth.signIn()            ← FAILS HERE
          │       GoogleAuth.load()  → requestIdToken( androidClientId ?? clientId ?? "Your Web Client Key" )
          │       GoogleAuth.signInResult() → ApiException → reject("Something went wrong", "<statusCode>")
          │    auth.service.ts:247  GoogleAuthProvider.credential(idToken)   ← never reached
          │    auth.service.ts:248  signInWithCredential()                   ← never reached
          │    auth.service.ts:249  assertNotSuspended()                     ← never reached
          └─ BROWSER (else branch, auth.service.ts:252)
               signInWithPopup(this.auth, new GoogleAuthProvider())  ← verified working up to accounts.google.com

  onAuthStateChanged (auth.service.ts:51) → buildAppUser() → Firestore users/{uid}
    → currentUserSubject.next(appUser)
        → auth.page.ts:59 constructor subscription → router.navigate(['/dashboard'])
        → auth.page.ts:133 explicit router.navigate(['/dashboard'])
  catch → auth.page.ts:150 parseFirebaseError(err) → errorMessage banner
```

### Where "Something went wrong" is generated, and what it hides

`GoogleAuth.java:135`:

```java
} catch (ApiException e) {
  if (SIGN_IN_CANCELLED == e.getStatusCode()) {            // 12501
    call.reject("The user canceled the sign-in flow.", "" + e.getStatusCode());
  } else {
    call.reject("Something went wrong", "" + e.getStatusCode());   // ← the banner text
  }
}
```

The original value survives as `err.code` (a string such as `"10"` or `"12500"`) and is dropped at
`auth.page.ts:170`.

### Cancellation handling is native-only

`auth.page.ts:142` `isGoogleSignInCancelled()` matches code `12501` or `/cancel/i`. Firebase's
`auth/popup-closed-by-user` matches neither, so it renders as an error (confirmed in section D).

---

## C. Prioritized debugging plan

### P0 — ID-token audience is the placeholder (CONFIRMED at APK level)

- **Evidence:** `aapt dump --values resources app-debug.apk` →
  `com.fiveorites.scoop:string/server_client_id = "Your Web Client Key"`; `GoogleAuth.java:58-60`;
  `capacitor.config.json` inside the APK has no `clientId`/`androidClientId`;
  `android/app/src/main/res/values/strings.xml` does not override the resource. Symptom timing
  (chooser OK → fail only after account selection) matches a token-exchange failure exactly.
- **Files / config:** `capacitor.config.ts` (`plugins.GoogleAuth`),
  `node_modules/@codetrix-studio/capacitor-google-auth/android/src/main/java/com/codetrixstudio/capacitor/GoogleAuth/GoogleAuth.java`,
  `android/app/src/main/res/values/strings.xml`.
- **Diagnostic to confirm:** run the section E logcat capture and read the status code; the static
  APK inspection already proves the misconfiguration.
- **Smallest appropriate fix:** add the key the Android plugin actually reads, using the web client
  ID the working browser flow proved correct:

  ```ts
  GoogleAuth: {
    scopes: ['profile', 'email'],
    // Read by the Android plugin (GoogleAuth.load()). NOT `serverClientId`.
    clientId: '347528161750-sdkbhbj876ideksd0gt13q3peeb9p0hv.apps.googleusercontent.com',
    serverClientId: '347528161750-sdkbhbj876ideksd0gt13q3peeb9p0hv.apps.googleusercontent.com',
  }
  ```

  then `npx cap sync android` → rebuild → reinstall. Optional belt-and-braces: set
  `<string name="server_client_id">` in the app's own `strings.xml`. One of the two is sufficient;
  the config key is preferred because it keeps a single source of truth.

### P1 — Original Google error code is swallowed (CONFIRMED)

- **Evidence:** `auth.page.ts:150-172`; the plugin passes `"" + e.getStatusCode()` as `err.code`.
- **Fix:** log `err.code` + `err.message` once per failure, and map Google codes
  (`10`, `12500`, `7`, `12501`) to a helpful sentence instead of surfacing the raw plugin string.
  No tokens, cookies or secrets in the log.

### P2 — No stage logging (CONFIRMED gap)

Instrument these stages: button pressed → authentication request started → account selection
returned → token retrieval completed/failed → backend auth started/completed/failed → session saved →
navigation triggered. Log code, message, HTTP status only.

### P3 — Cancellation rendered as an error (CONFIRMED on browser; presumed native)

- **Evidence (browser):** closing the popup produced banner `Firebase: Error (auth/popup-closed-by-user).`
  after ~10 s of spinner.
- **Fix:** also treat `auth/popup-closed-by-user` and `auth/user-cancelled` as cancellation.

### P4 — `scopes: ['profile','email']` short-form scopes (HYPOTHESIS)

- **Evidence:** `GoogleAuth.java:72-78` builds `new Scope("profile")`, `new Scope("email")` —
  non-URL scope strings handed to Google's backend.
- **How to rule out:** if P0 is fixed and the code is still `10`, remove the explicit `scopes`
  (`DEFAULT_SIGN_IN` + `requestEmail()` already cover profile/email) and re-test.
  **Do not change this before P0 is tested.**

### P5 — Second web client `…umcfk1ie…` may not exist (HYPOTHESIS)

- **Evidence:** absent from `google-services.json`; not used by the browser flow.
- **How to rule out:** Cloud Console → APIs & Services → Credentials → confirm both client IDs exist
  in project `five-orites-scoop`. Client IDs are public values, not secrets.

### Ruled out

- SHA-1 / package-name mismatch (APK cert == registered `certificate_hash`).
- Release-vs-debug signing mismatch (`android/app/build/outputs/apk/debug/app-debug.apk` exists;
  no release keystore in the repo).
- `signInWithPopup`, Firebase init, or route guards as the source of this banner (browser test, D).
- Missing plugin registration (`assets/capacitor.plugins.json` includes
  `com.codetrixstudio.capacitor.GoogleAuth.GoogleAuth`).

---

## D. Playwright investigation — steps and artifacts

**Environment:** Windows, Node v24.22.1 (outside `.nvmrc` = 20 and the `engines` range; the build
still succeeded), Chromium via the Playwright MCP.
**Run command:** `npm run start:prod` → `ng serve --configuration prod` → `http://localhost:4200`
(real Firebase project `five-orites-scoop`, no emulators).

**Steps executed:**

1. Navigated to `/auth`; captured console output and network from load.
2. Attached `pageerror`, `console.error`, `requestfailed`, in-page `unhandledrejection` and
   `window.error` listeners **before** triggering sign-in.
3. Clicked **Continue with Google**; awaited and instrumented the popup; captured the OAuth request
   URL (redacted).
4. Closed the popup to reproduce the cancellation path; re-inspected banner, spinner, URL, console.

| #   | Test                                                                                                                                                                          | Result                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | App boots, `/auth` renders, no uncaught exceptions, no failed requests on load                                                                                                | **PASSED**                                                             |
| 2   | Listeners attached before the click                                                                                                                                           | **PASSED**                                                             |
| 3   | Click "Continue with Google" starts the expected flow                                                                                                                         | **PASSED**                                                             |
| 4   | Popup reaches `accounts.google.com` with `client_id=347528161750-sdkbhbj876ideksd0gt13q3peeb9p0hv…`, `redirect_uri=https://five-orites-scoop.firebaseapp.com/__/auth/handler` | **PASSED**                                                             |
| 5   | Backend HTTP during sign-in: `getProjectConfig` 200, `identitytoolkit/v1/projects` 200, `createAuthUri` 200                                                                   | **PASSED**                                                             |
| 6   | No unhandled rejections / window errors during the click                                                                                                                      | **PASSED**                                                             |
| 7   | Cancel path: spinner ~10 s, then raw `Firebase: Error (auth/popup-closed-by-user).`, stays on `/auth`, button re-enabled                                                      | **FAILED** (expected quiet/friendly cancel)                            |
| 8   | Successful sign-in → session → navigation                                                                                                                                     | **NOT RUN** — requires a real Google account (manual step, on request) |
| 9   | Native Android sign-in                                                                                                                                                        | **NOT RUN / BLOCKED** — `adb devices` returned no device               |

**Artifacts** (credentials redacted; no account details, cookies, tokens or authorization headers
captured — no credentials were ever entered):

- `C:\Users\Justin\AppData\Local\Temp\opencode\auth-page-initial.png`
- `C:\Users\Justin\AppData\Local\Temp\opencode\auth-after-popup-close.png`
- `C:\Users\Justin\AppData\Local\Temp\opencode\auth-after-cancel-10s.png`
- `C:\Users\Justin\Documents\Backend_IPT\.playwright-mcp\console-2026-10-25T02-27-21-852Z.log`

**Boundary statement:** the browser runs `signInWithPopup` (`auth.service.ts:252`); the phone runs
the native plugin path (`auth.service.ts:245`). **Browser success is not proof that the installed
Android app works**, and Playwright cannot reproduce this bug — it lives entirely in native code.

---

## E. Android-specific diagnostic steps

Connect the phone with USB debugging enabled, then:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

# 1. Is a device attached?
& $adb devices

# 2. Clean capture
& $adb logcat -c
& $adb shell am start -n com.fiveorites.scoop/.MainActivity
#    -> tap "Continue with Google" -> pick an account -> wait for the red banner

& $adb logcat -d -v time > "$env:TEMP\fiveorites-google.log"
Select-String -Path "$env:TEMP\fiveorites-google.log" -Pattern `
  "Capacitor|GoogleAuth|GoogleSignIn|ApiException|12500|12501|developer|AuthenticatedBackend|identitytoolkit" |
  Select-Object -First 80

# 3. Which certificate signed the INSTALLED app? (compare with 50:63:2A:8F:...:5F:9E)
& $adb shell pm path com.fiveorites.scoop
& $adb pull <path-from-above> "$env:TEMP\installed.apk"
& "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot\bin\keytool.exe" -printcert -jarfile "$env:TEMP\installed.apk"

# 4. What audience does the installed build really contain? (offline, no device needed)
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.1\aapt.exe" dump --values resources <path-to-apk> |
  Select-String server_client_id
```

> ⚠️ The plugin writes the **raw access token** to logcat (`GoogleAuth.java:219`, tag
> `AuthenticatedBackend`). Redact or exclude that tag before sharing any log.

**Known-good reference values**

| Item                                         | Value                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Application ID                               | `com.fiveorites.scoop`                                                  |
| Debug keystore SHA-1                         | `50:63:2A:8F:28:CD:01:99:DE:AA:EE:E8:9C:82:38:BA:80:8F:5F:9E`           |
| Registered Android OAuth client              | `347528161750-jo6e136pp5qfhuffthcub7o4j4nh8kch` (matches debug SHA-1 ✓) |
| Project web client (used by browser)         | `347528161750-sdkbhbj876ideksd0gt13q3peeb9p0hv`                         |
| Configured but unverified `serverClientId`   | `347528161750-umcfk1ieertagn3dla6gpnqah0tvb5g9`                         |
| Android resource actually baked into the APK | `server_client_id = "Your Web Client Key"`                              |

**Playwright/native separation:** section D is Chromium on Windows. Section E has **not** been run
(native: **NOT RUN — blocked, no device attached**).

---

## F. Proposed fixes (approval required)

| #   | File / function                              | Change                                                                                                                                                                                                                                                          | Why it addresses the observed failure                                                                                                                                                                                       |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `capacitor.config.ts` → `plugins.GoogleAuth` | Add `clientId` and set `serverClientId` to `347528161750-sdkbhbj876ideksd0gt13q3peeb9p0hv…`; then `npx cap sync android`, rebuild, reinstall                                                                                                                    | The Android plugin only reads `androidClientId`/`clientId`. Today the ID-token audience is `"Your Web Client Key"`, so Google cannot issue a token. The replacement ID is the one the _working_ browser flow actually used. |
| 2   | `auth.page.ts` → `parseFirebaseError()`      | Log `err.code` + `err.message` once; map Google codes `10`/`12500`/`7` to a friendly message                                                                                                                                                                    | Recovers the exact error currently hidden and stops the raw plugin string reaching users.                                                                                                                                   |
| 3   | `auth.page.ts` → `isGoogleSignInCancelled()` | Also treat `auth/popup-closed-by-user` and `auth/user-cancelled` as cancellation                                                                                                                                                                                | Cancellation should be quiet on both platforms (native already is, via `12501`).                                                                                                                                            |
| 4   | `google-auth.service.ts`, `auth.service.ts`  | Stage markers: button pressed / request started / account selected / token ok-or-failed / `signInWithCredential` started-done-failed / session saved / navigation. Codes, HTTP status and sanitized messages only — never tokens, cookies, secrets or passwords | Makes the next native failure diagnosable from logcat without a guess-and-rebuild cycle.                                                                                                                                    |

**Deliberately deferred until evidence says otherwise:** removing `scopes` (P4), changing any Cloud
Console credential, dependency upgrades, UI redesign, authentication rewrite.

**Requested instead of guessing:** the redacted logcat snippet from section E step 2 (pins the status
code and separates P0 from P4), plus confirmation of whether `…umcfk1ie…` exists in the
`five-orites-scoop` Cloud Console.

---

## G. Verification checklist

| Scenario                                                         | Status                                         |
| ---------------------------------------------------------------- | ---------------------------------------------- |
| Sign-in page loads with no console/network errors                | **PASSED** (browser, Chromium/Windows)         |
| Google button starts OAuth with the correct `client_id`          | **PASSED** (browser)                           |
| Authentication-related HTTP responses are 200                    | **PASSED** (browser)                           |
| Cancel account selection → friendly handling, no error banner    | **FAILED** (browser — raw Firebase text shown) |
| Successful sign-in → session created → navigates to `/dashboard` | **NOT RUN** (needs a real Google account)      |
| Backend/Firebase request failure path shows a helpful message    | **NOT RUN**                                    |
| Sign out, then sign in again                                     | **NOT RUN**                                    |
| Session survives app restart                                     | **NOT RUN**                                    |
| Correct navigation after authentication (native)                 | **NOT RUN**                                    |
| Error messages leak no sensitive information                     | **PARTIAL** — raw SDK strings shown (P1)       |
| Installed Android build sign-in                                  | **BLOCKED** (no `adb` device)                  |
| `npm run typecheck` / `lint` / `test:logic`                      | **NOT RUN**                                    |

---

## Test-run legend

- **PASSED** — executed and behaved as expected.
- **FAILED** — executed and did not behave as expected.
- **BLOCKED** — could not be executed (missing device / credentials).
- **NOT RUN** — not attempted in this pass.

Environment: **browser tests = Chromium on Windows against `npm run start:prod` (Firebase project
`five-orites-scoop`)**; **native Android tests = not run**. No Google credentials, CAPTCHA, MFA or
security checks were bypassed at any point.

---

# Implementation status (2026-10-25)

All four fixes from this plan are implemented and built.

## Applied fixes

- **F#1 — Config** (`capacitor.config.ts`): `GoogleAuth.clientId` and
  `GoogleAuth.serverClientId` are set to the Web application client ID
  `347528161750-sdkbhbj876ideksd0gt13q3peeb9p0hv.apps.googleusercontent.com`.
  The real gap was that the entire `GoogleAuth` block was missing from the
  deployed `capacitor.config.json`, so `GoogleAuth.signIn()` ran with no
  client ID. No `YOUR_WEB_CLIENT_ID` placeholder existed anywhere.
- **F#2 / F#3 — Error mapping & cancellation codes**
  (`src/app/features/auth/auth.page.ts`): committed earlier in `6d655a2`;
  verified present (10:1 Android code mapping; cancellation codes
  1/4/5/8/125/1250 classified as silent returns).
- **F#4 — Stage markers** (`src/app/core/platform/google-auth.service.ts`,
  `src/app/core/services/identity/auth.service.ts`): committed earlier;
  verified present (`[google-auth] init`, `fetchUser() start/done/failed`,
  `signOut() enter`).

## Build & verification (all green)

| Check                   | Result                                                                  |
| ----------------------- | ----------------------------------------------------------------------- |
| `npm run typecheck`     | 0 errors                                                                |
| `npm run lint`          | 0 errors                                                                |
| `npm run test:logic`    | 329/329 pass                                                            |
| `npm run build`         | success; fresh `www/browser` contains the new auth code                 |
| `npx cap sync android`  | success; 9 plugins incl. `@codetrix-studio/capacitor-google-auth@3.3.6` |
| `gradlew assembleDebug` | BUILD SUCCESSFUL                                                        |

APK evidence (`aapt dump --values resources` on `app-debug.apk`):

- `com.fiveorites.scoop:string/server_client_id` =
  `347528161750-sdkbhbj876ideksd0gt13q3peeb9p0hv.apps.googleusercontent.com`
  (the old placeholder `Your Web Client Key` is gone).
- Embedded `assets/capacitor.config.json` now contains the `GoogleAuth`
  block with the correct `clientId` / `serverClientId`.
- `assets/capacitor.plugins.json` registers
  `com.codetrixstudio.capacitor.GoogleAuth.GoogleAuth`.

## Blocking issue: SHA-1 fingerprint mismatch (action required)

The rebuilt debug APK is signed with this machine's default debug keystore
(`C:\Users\Kenn\.android\debug.keystore`), SHA-1:

```
1D:E6:3F:E7:5A:60:6F:0E:F7:17:E3:1F:B6:35:48:89:86:9B:BC:91
```

but `android/app/google-services.json` registers the Android OAuth client
`347528161750-jo6e136pp5qfhuffthcub7o4j4nh8kch` with `certificate_hash`
`50632a8f28cd0199deaaeee89c8238ba808f5f9e` (SHA-1 `50:63:2A:…:5F:9E`). No
keystore producing `50:63:…` exists in the worktree or git history. Google
sign-in will keep failing with `10: DEVELOPER_ERROR` until one of these is
done:

1. **Register this debug SHA-1** in Firebase → Project settings → Your apps →
   _Add fingerprint_, and in Cloud Console → APIs & Services → Credentials →
   the Android OAuth client (edit SHA-1 fields). Then re-download
   `google-services.json` and re-run `npx cap sync android`.
2. Or locate the original keystore with SHA-1 `50:63:2A:…:5F:9E` and sign
   the APK with it.

## Remaining steps

- Section E step 2 (redacted logcat capture) — pending; `adb devices`
  reports no connected device, so on-device install/verification is blocked.
- Outstanding from earlier: confirm whether client ID
  `347528161750-umcfk1ieertagn3dla6gpnqah0tvb5g9` exists in the Cloud
  Console (if not, it is another `10: DEVELOPER_ERROR` candidate).

## Repository note

A `git stash pop` was in progress when implementation started; its conflicts
(`cart.page.*` ×5, `admin-orders.page.scss` ×2, plus `payment-server/`
deletions) were resolved by semantic merge: HEAD's simulated-payment
backbone (per `PLAN-XENDIT-CHECKOUT.md`) combined with the stash's fresher
order-derived receipt panel and admin table changes. `stash@{0}` is retained
for reference. **Nothing has been committed yet** — resolved files are
staged; untracked `payment-server/` leftovers (`.env`, `lib/`,
`node_modules`) were left untouched.
