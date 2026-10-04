export const environment = {
  production: true,

  /**
   * The deployed build talks to production. Stated rather than omitted so the
   * property's type comes from a file that is actually compiled in this
   * configuration, and so there is no reading of "absent" that could mean the
   * opposite. See the note in `environment.ts`.
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
  // Same values as environment.ts (unsigned preset — safe for client use).
  cloudinary: {
    cloudName: 'fhtucp4v',
    uploadPreset: 'htyab6bs',
  },
};
