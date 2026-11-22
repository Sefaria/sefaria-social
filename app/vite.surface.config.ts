// The surface build (plan section 4.1): a client-only ES module library (`surface.[hash].js`, chunks, one CSS file,
// `manifest.json`) that the reader loads into its page at runtime.
//
// Intentionally empty. Spike S1 fills this in and records the outcome in docs/decisions/0001-two-builds.md. Until then
// nothing builds the surface; `npm run build` builds only the Start app (vite.config.ts).
export {};
