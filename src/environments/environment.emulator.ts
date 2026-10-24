// src/environments/environment.emulator.ts
// Five-orites Scoop — the LOCAL, SAFE configuration
//
// WHY THIS FILE EXISTS
//
// Until now there was exactly one development configuration, and it pointed at
// PRODUCTION: `environment.ts` hard-codes `projectId: 'five-orites-scoop'`, and the
// `development` build configuration does not replace it. So `npm start` served a
// fully working admin app backed by the real database.
//
// That is a loaded gun. Every control in the admin area writes: adjusting stock,
// creating products, cancelling orders, editing roles, uploading images to
// Cloudinary. A developer exercising a UI change against real data does not get a
// sandbox, they get 66 real products mutated and a stock ledger full of rows
// describing changes nobody made — which is precisely the corruption the
// reconciliation panel exists to detect.
//
// The Firestore emulator was already configured in `firebase.json` (auth 9099,
// firestore 8080, hub 4400). Nothing pointed the app at it.
//
// THE SAFETY INVARIANT, which is the whole point:
//
//   `npm start` MUST NOT reach production. It is the command a developer types
//   without thinking, so it is the one that has to be safe by default. Reaching
//   production requires typing `npm run start:prod`.
//
// `tests/logic.test.ts` asserts that invariant against package.json, because an
// invariant nobody checks is a comment.
//
// WHY THE `demo-` PROJECT ID
//
// The Firebase emulators ignore the project id and serve whatever is in the local
// store, but naming it `demo-*` is the documented convention and it makes an
// accidental production call fail loudly rather than silently succeeding against
// real data.
//
// CLOUDINARY IS *NOT* REDIRECTED
//
// There is no Cloudinary emulator, so `uploadPreset` is carried over unchanged and
// a photo uploaded in local development still lands in the real Cloudinary media
// library. That is a genuine gap in this setup and it is called out in the README
// rather than papered over — the Firestore write that references the asset is
// local, but the asset itself is not.

export const environment = {
  production: false,

  /**
   * The switch `app.config.ts` reads to redirect Firestore and Auth at the local
   * emulators. Optional on the other environments so a missing key is a type
   * error rather than a silent `undefined` that means "production".
   */
  useEmulator: true,

  firebase: {
    apiKey: 'demo-five-orites-scoop',
    authDomain: 'demo-five-orites-scoop.firebaseapp.com',
    projectId: 'demo-five-orites-scoop',
    storageBucket: 'demo-five-orites-scoop.firebasestorage.app',
    messagingSenderId: 'demo',
    appId: '1:000000000000:web:0000000000000000000000',
    measurementId: '',
  },

  lowStockThreshold: 10,

  // See the header: there is no Cloudinary emulator, so these are the real ones.
  cloudinary: {
    cloudName: 'fhtucp4v',
    uploadPreset: 'htyab6bs',
  },
};
