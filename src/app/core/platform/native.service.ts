// src/app/core/platform/native.service.ts
// Five-orites Scoop — Capacitor platform detection and native shell control
//
// WHY THIS EXISTS
// Capacitor plugin calls used to be written inline wherever they were needed:
// `SplashScreen` was imported by app.component.ts, and `Filesystem`/`Share` were
// dynamically imported inside CsvExportService. That is three rules in three
// places, and each one had to be rediscovered by whoever touched the file next:
//
//   1. Is this code running natively, or in a browser?
//   2. May I import the plugin statically, or does a static import drag a
//      native-only plugin into the web bundle where it can never work?
//   3. If the call fails, is that fatal, or is there a web fallback?
//
// Answering (1) belongs to exactly one file, and it is this one. Answering (2)
// belongs to the service that wraps the plugin, because the answer only matters
// at the import site.
//
// SCOPE, DELIBERATELY NARROW
// This is not a general "platform" abstraction and does not grow into one. It
// answers "am I native?" and owns the splash screen, because both of those are
// questions about the *shell*, not about any one feature. Anything a specific
// feature needs from Capacitor gets its own wrapper in this folder — file
// operations in file.service.ts, the share sheet in share.service.ts — so that
// the reason a plugin is imported is always one directory away from the call.

import { Injectable, inject } from '@angular/core';
import { Platform } from '@ionic/angular/standalone';
import { SplashScreen } from '@capacitor/splash-screen';

@Injectable({ providedIn: 'root' })
export class NativeService {
  private platform = inject(Platform);

  /**
   * True inside a Capacitor WebView, false in a plain browser.
   *
   * Backed by Ionic's `Platform` rather than by sniffing `window.Capacitor`
   * directly, because `Platform` is already initialised from the same runtime
   * check and is what every other platform check in this codebase already used.
   * Two ways of asking the same question is how they drift apart.
   *
   * NOTE this is a capability question, not a brand question. It does not try to
   * tell Android from iOS, because nothing in this app currently needs to. If
   * something does, add a named method here rather than exposing `Platform` —
   * an exported `platform` field is how the abstraction leaks.
   */
  isNative(): boolean {
    return this.platform.is('capacitor');
  }

  /**
   * Tears down the boot splash, with the fade the shell was designed around.
   *
   * Never rejects. A failure here is non-fatal by definition: with no native
   * platform there is no splash to leave stuck, and on a real device a rejection
   * means the native splash hid itself anyway. But it IS logged rather than
   * swallowed, because silence here is how a stuck splash ends up being debugged
   * from a screenshot instead of from the console.
   *
   * The STATIC import is correct for this plugin and only this plugin. It is
   * the one Capacitor call that must happen before anything else has rendered,
   * so it cannot be deferred to a dynamic import — the chunk would have to
   * download while the splash is still up, and `hide()` would land late enough
   * to be visible as a stutter. The web build pays roughly 1KB for the
   * plugin's web shim, which resolves to a no-op, and the splash on web is a
   * CSS pseudo-element in index.html rather than a plugin resource anyway.
   *
   * Every other plugin in this folder is dynamically imported, for the exact
   * opposite reason: they are only reached on a code path that is already
   * native-gated, so their cost is never paid by a browser session at all.
   */
  hideSplash(fadeOutDuration: number): void {
    void SplashScreen.hide({ fadeOutDuration }).catch((err: unknown) =>
      console.error('Could not hide the native splash screen.', err),
    );
  }
}
