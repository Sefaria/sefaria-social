# Plan: 020 release pipeline

## Approach

`app/scripts/release/` (run with tsx, like the other scripts):

- `storage.ts`: the `StorageTarget` interface (`get`, `put`, `list`, `describe`), `FileTarget` (a folder; writes a
  `.meta.json` sidecar per object with its content type and cache header, which the static server sends), `BucketTarget`
  (stub that refuses), `targetFromEnv`.
- `publish.ts`: read `manifest.json` from the build folder, validate with the pinned schema, hash-check every file, upload
  files then the manifest under `v/<version>/`.
- `smoke.ts`: read a version back through the target (or over HTTP for the deployed origin) and check schema, contract and
  every hash; server smoke (`/api/v1/health` 200, protected routes 401) when an API origin is given.
- `pointer.ts`: `promote`, `rollback`, `status` over `stable/manifest.json` and `stable/state.json`.
- `serve.ts`: a static server for a filesystem target with CORS and the stored cache headers (the e2e and local rehearsal).
- `cli.ts`: `publish | promote | rollback | status | smoke | serve | budget`. `scripts/rollback` calls `rollback`.

`.github/workflows/release.yml` on push to main and `workflow_dispatch` (input `rollback_to`). The harness learns
`manifestUrl` and `allowedOrigins` from its config, and checks origins like the reader.

## Tasks

- T-001 Storage targets, publish, smoke, promote and rollback (AC-001..AC-004): `app/scripts/release/**`, `scripts/rollback`,
  `factory/test/acceptance-020.test.mjs`, `package.json`
- T-002 release.yml (AC-005): `.github/workflows/release.yml`, `factory/test/acceptance-020.test.mjs`
- T-003 Local release and rollback e2e (AC-006): `e2e/release.spec.ts`, `harness/src/**`, `app/vite.surface.config.ts`,
  `playwright.config.ts`

## Tests

AC-001..AC-005 drive the release CLI and read the workflow from `factory/test/acceptance-020.test.mjs`. AC-006 is the
Playwright journey `e2e/release.spec.ts` (desktop project).
