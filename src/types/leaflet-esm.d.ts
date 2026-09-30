// src/types/leaflet-esm.d.ts
// Type shim for Leaflet's ESM build.
//
// Leaflet 1.9.4 ships `dist/leaflet-src.esm.js` but its package.json declares no
// `module` field, so every bundler falls back to `main` — the UMD build. The
// Angular build then reports:
//
//   Module 'leaflet' is not ESM. CommonJS or AMD dependencies can cause
//   optimization bailouts.
//
// …and, more to the point, a CommonJS module cannot be tree-shaken, so the whole
// of Leaflet lands in the chunk even though this app uses a fraction of it.
//
// Importing the ESM file by its deep path is the standard fix. It needs a
// declaration because the package's own types only describe the root specifier.
//
// The component deliberately does NOT use these types: it declares its own
// minimal `LeafletLike` interface for the handful of methods it calls, so the
// surface it depends on is visible in one place and adding `@types/leaflet` as a
// value import would not drag anything in.

// A DEFAULT export, not `export =`. The ESM file is imported with a dynamic
// `import()`, and under esModuleInterop an `export =` declaration surfaces as a
// namespace object (`{ default: … }`) rather than as the module value, so the
// call would have to be unwrapped for no benefit.
declare module 'leaflet/dist/leaflet-src.esm.js' {
  const leaflet: unknown;
  export default leaflet;
}
