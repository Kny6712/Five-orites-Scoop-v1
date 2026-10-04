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
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#6B3FA0',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#6B3FA0',
    },
  },
};

export default config;
