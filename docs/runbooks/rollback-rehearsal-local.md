# Release and rollback rehearsal, local (2026-11-23)

Plan 8 P5's exit test asks for a release and a rollback on staging. There is no staging, asset origin or cluster yet (plan 9,
D2), so the rehearsal was done locally, end to end, and is automated so it runs on every PR. A staging rehearsal is on the
setup checklist for when the hosting exists.

## Automated (runs in CI)

- **`e2e/release.spec.ts`** (Playwright, in the `e2e-harness` job): builds two versions of the surface, publishes each to a
  filesystem release target, promotes them, serves the target with `release serve` on `127.0.0.1:3410` (another origin than the
  harness on `localhost:3300`, so CORS and SRI apply as they do for the reader), and loads it in the harness through
  `stable/manifest.json` with the reader's rules (origin allowlist, every file preloaded with its integrity). Then
  `scripts/rollback` moves the pointer and the harness loads the first version again. Finally a published chunk is altered on
  disk: the HTTP smoke test reports the hash mismatch and the harness refuses to run the surface (`data-surface-state=failed`).
- **The rehearsal step of `release.yml`** does the same pointer lifecycle without a browser on every push to main.
- **`factory/test/acceptance-020.test.mjs`**: publish, immutability, promote, refusals and rollback, on temporary targets.

## By hand, on the P5 branch

Two builds (`SURFACE_VERSION=2026.11.23-1.local` and `-2.local`, each with its own `SURFACE_OUT_DIR`), the target served by
`npm run release -- serve --dir <work>/target --port 3411`, `RELEASE_TARGET=file:<work>/target`:

```
$ npm run release -- publish --dir b1
published 2026.11.23-1.local to file:<work>/target: 11 uploaded, 0 already there
$ npm run release -- promote 2026.11.23-1.local
stable -> 2026.11.23-1.local (last known-good: none)
$ npm run release -- smoke --url http://127.0.0.1:3411/stable/manifest.json --origin http://localhost:3300
manifest version 2026.11.23-1.local
smoke: PASS
$ npm run release -- publish --dir b2
published 2026.11.23-2.local to file:<work>/target: 11 uploaded, 0 already there
$ npm run release -- promote 2026.11.23-2.local
stable -> 2026.11.23-2.local (last known-good: 2026.11.23-1.local)
$ curl -sI http://127.0.0.1:3411/stable/manifest.json
HTTP/1.1 200 OK
access-control-allow-origin: *
content-type: application/json; charset=utf-8
cache-control: no-cache
$ scripts/rollback
rolled back: stable -> 2026.11.23-1.local (rolled back: 2026.11.23-2.local)
$ npm run release -- status
current:     2026.11.23-1.local
known-good:  (none)
rolled back: 2026.11.23-2.local
$ npm run release -- smoke --url http://127.0.0.1:3411/stable/manifest.json --origin http://localhost:3300
manifest version 2026.11.23-1.local
smoke: PASS
$ npm run release -- promote 2026.11.23-2.local
x refusing to promote 2026.11.23-2.local: it was rolled back. Fix: publish a new version with the fix (SURFACE_VERSION) and promote that.
(exit 1)
$ scripts/rollback
x refusing to roll back: there is no known-good version to go back to (current: 2026.11.23-1.local; rolled back: 2026.11.23-2.local). Fix: publish and promote a fixed version, or turn the reader's social lab off (feature.reader.labs.social) meanwhile.
(exit 1)
$ curl -sI http://127.0.0.1:3411/v/2026.11.23-1.local/manifest.json
cache-control: public, max-age=31536000, immutable
```

The Playwright journey, locally: `npx playwright test e2e/release.spec.ts --project desktop` → `1 passed (7.2s)`; the whole
suite `npx playwright test` → `16 passed (9.1s)`. CI evidence is in the P5 PR body.

## What this does not prove

- Nothing about the real object store, CDN caching, or the reader's own loader against a hosted origin (the harness copies the
  reader's loader; A1's e2e tests the reader's loader itself).
- SRI enforcement in Firefox and Safari (Chromium only).
- The server deploy and `helm rollback` (no cluster). The image is built and run by CI's `container` job.
