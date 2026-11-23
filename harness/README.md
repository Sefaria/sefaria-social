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

Tests set the interface language, the theme or a viewer before load with
`window.__HARNESS_CONFIG__ = { interfaceLang, theme, viewer }` (Playwright `addInitScript`); the page also has controls for
the language and the viewer. `window.__fakeHost` exposes the fake for debugging.

- The page carries a copy of the reader's design tokens (`src/reader-tokens.css`) and sets `data-theme` on `<html>` like the
  reader, so social's markup looks as it does in the reader in light, dark and sepia.
- `serve.mjs` answers Sefaria's public text API (`/api/v3/texts/<ref>`) from recorded answers in `fixtures/texts/` (public
  data, trimmed). Record another ref with `node harness/fixtures/record-texts.mjs "<ref>"`; an unrecorded ref is 404.
