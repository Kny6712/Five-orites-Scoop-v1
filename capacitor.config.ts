// capacitor.config.ts
// Five-orites Scoop — Capacitor Configuration
// Author: [Developer Placeholder]

import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fiveorites.scoop',
  appName: 'Five-orites Scoop',
  webDir: 'www/browser',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // No PushNotifications block. The plugin itself was uninstalled when the
    // notification system became in-app-only: a native push notification renders
    // in the Android notification shade, which is outside the application, and
    // the delivery would have needed FCM — unavailable on the free Spark plan.
    // Leaving the config behind would keep the native side asking for a
    // permission the app has no way to honour.
    SplashScreen: {
      // There IS an `android/` directory now — it was added after this comment was
      // written, and the claim that there wasn't outlived it. `npx cap ls` reports
      // a platform, this file is read on every `cap sync`, and the settings below
      // are live rather than dormant. `ios/` still does not exist.

      // `launchAutoHide: false` is the load-bearing value here. It was `true`, with a
      // 2000ms duration, which is the setting that CAUSES the white flash it exists
      // to prevent: the splash is dismissed on a fixed timer whether or not the app
      // has painted, so on any cold start slower than 2s the user gets cream, then
      // white, then the app. This bundle is ~1.5mb and Firestore initialises on top
      // of it. The splash is instead hidden by `AppComponent.dismissBootSplash`,
      // which fires on real first paint via `afterNextRender`.
      //
      // `launchShowDuration` is retained as the value the OS uses while waiting for
      // that call, not as a timer anything counts down.
      launchShowDuration: 2000,
      launchAutoHide: false,

      // #fff9f4 is `--color-cream`, and `--ion-background-color` resolves to it —
      // so this is the exact colour of the app's first real frame.
      //
      // It was `#6B3FA0`, a purple. That is a survivor of the palette
      // `src/theme/variables.scss` already purged: its header records hardcoded
      // purples being removed as "left over from a palette that no longer exists".
      // Left as it was, the native splash launched purple and handed off to a
      // pastel cream app on every cold start.
      backgroundColor: '#fff9f4',

      // The splash artwork is a centred logo on a flat field, so CENTER_CROP is
      // safe: the background is uniform, so cropping cannot cut into the mark.
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      // 'DARK' is dark ICONS, which is the correct pairing for the cream splash and
      // cream app that now sit behind this bar.
      style: 'DARK',
      // Was '#6B3FA0' — same dead purple, same reason. See above.
      backgroundColor: '#fff9f4',
    },
  },
};

export default config;
