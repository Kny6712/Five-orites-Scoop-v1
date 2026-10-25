// src/app/core/platform/google-auth.service.ts
// Five-orites Scoop — Native Google sign-in wrapper
//
// WHY THIS EXISTS
// On native (Android) the Firebase JS SDK's popup/redirect flow loses its
// initial state in the WebView, so Google sign-in fails. This service obtains
// a Google ID token via @codetrix-studio/capacitor-google-auth and hands it
// back so AuthService can sign into Firebase with signInWithCredential.
//
// DYNAMIC IMPORT, DELIBERATE. Every caller is already gated on
// NativeService.isNative(), so a static import would add a native-only plugin
// to every web session's download for a path no browser can reach.

import { Injectable } from '@angular/core';

export interface GoogleNativeSignInResult {
  idToken: string;
}

@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  async signIn(): Promise<GoogleNativeSignInResult> {
    const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');

    GoogleAuth.initialize();

    console.log('[Auth] native: Google account chooser opening');
    let user;
    try {
      user = await GoogleAuth.signIn();
      console.log('[Auth] native: account selected, reading ID token');
    } catch (err) {
      // The plugin turns an ApiException into reject("Something went wrong",
      // "" + statusCode), so `code` carries the only diagnostic that matters
      // (10 = DEVELOPER_ERROR, 12500 = SIGN_IN_FAILED, 12501 = cancelled).
      // Logging it here is what makes a native failure diagnosable from
      // logcat without a guess-and-rebuild cycle.
      const e = (err ?? {}) as { code?: unknown; message?: unknown };
      const code = typeof e.code === 'string' ? e.code : String(e.code ?? '');
      const message =
        typeof e.message === 'string' ? e.message : err instanceof Error ? err.message : '';
      console.warn(
        `[Auth] native: Google sign-in failed (code=${code || 'none'}): ${message || '(no message)'}`,
      );
      throw err;
    }
    const idToken = user?.authentication?.idToken;
    if (!idToken) {
      console.warn('[Auth] native: Google returned an account but no ID token');
      throw new Error('Google sign-in did not return an ID token.');
    }
    console.log('[Auth] native: ID token received');
    return { idToken };
  }
}
