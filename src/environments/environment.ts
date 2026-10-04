export const environment = {
  production: false,

  /**
   * STATED EXPLICITLY rather than omitted.
   *
   * `app.config.ts` reads this to decide whether to redirect Firestore and Auth at
   * the local emulators. Only `environment.emulator.ts` sets it true.
   *
   * It is `false` here rather than absent so that the property's TYPE is settled by
   * this file, which is the one TypeScript compiles against — the emulator file is
   * swapped in by an angular.json `fileReplacement` and is never type-checked in
   * this configuration. Writing it out means a missing key is a visible decision
   * rather than an `undefined` that silently means "production".
   *
   * This file IS the production project id. `npm start` does NOT use it — see the
   * `emulator` build configuration and `npm run start:prod`.
   */
  useEmulator: false,

  firebase: {
    apiKey: 'AIzaSyB0c5002bCaZfhU5an0X3wzq9qEoC98Bl4',
    authDomain: 'five-orites-scoop.firebaseapp.com',
    projectId: 'five-orites-scoop',
    storageBucket: 'five-orites-scoop.firebasestorage.app',
    messagingSenderId: '347528161750',
    appId: '1:347528161750:web:5003d2913414f993fc9c77',
    measurementId: '',
  },
  lowStockThreshold: 10,
  // Cloudinary unsigned upload for product images.
  // Cloudinary Console > Settings > Upload > Upload presets > Add (Signing Mode: Unsigned).
  // Delivery-side resizing happens in the CloudinaryPipe, not here.
  cloudinary: {
    cloudName: 'fhtucp4v',
    uploadPreset: 'htyab6bs',
  },
};
