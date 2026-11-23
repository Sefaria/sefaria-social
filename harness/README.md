# Harness

A fake reader page (plan section 4.6). It loads the **built** surface through `manifest.json`, with `modulepreload` and
integrity hashes, the way the reader does, into the fake host (`@sefaria-social/host-contract/fake-host`) backed by the
browser's own history, so Back, Forward, reloads and deep links behave as in the reader. The "reader pane" shows the current
address, the `ctx`, the viewer, the reader snapshot and every call the surface made.

```bash
npm run build:surface && npm run build:harness   # app/dist-surface + harness/dist
npm run harness                                  # http://localhost:3300/social  (HARNESS_PORT to change)
npm run test:e2e                                 # builds both, then Playwright (desktop + phone, English + Hebrew)
```

Tests set the interface language or a viewer before load with `window.__HARNESS_CONFIG__ = { interfaceLang, viewer }`
(Playwright `addInitScript`); the page also has controls for both. `window.__fakeHost` exposes the fake for debugging.
