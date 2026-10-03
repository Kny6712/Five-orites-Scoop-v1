export const environment = {
  production: false,
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
