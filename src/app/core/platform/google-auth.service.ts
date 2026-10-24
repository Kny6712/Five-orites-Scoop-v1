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

    const user = await GoogleAuth.signIn();
    const idToken = user?.authentication?.idToken;
    if (!idToken) {
      throw new Error('Google sign-in did not return an ID token.');
    }
    return { idToken };
  }
}
