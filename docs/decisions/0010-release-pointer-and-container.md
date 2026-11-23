# 0010. Release layout, the stable pointer, bundle budgets and the server container

- Status: proposed
- Date: 2026-11-23
- Deciders: P5 worker (agent); the owner confirms by approving the P5 PR and specs 019–021

## Context

Plan 7 asks for immutable versioned uploads, a manifest with integrity for every file, a stable pointer that a rollback moves
back, smoke tests, a Dockerfile, a values file and a deploy runbook; plan 8 P5's exit test is "a release and a rollback
performed on staging". Facts that shaped the choices:

- There is no hosting: no bucket, asset domain, registry repository, namespace or credentials (plan 9, D2 is only a default).
- The reader loads one configured manifest URL, resolves paths against the manifest's own URL (after redirects), preloads every
  listed file with its integrity, and relies on the module map for SRI (A1 notes, "How the reader loads the surface").
- Vite's library mode keeps whitespace in ES output; the bundle was 608 kB raw / 164 kB gzip (measured with gzip -9).
- The Start build emits a fetch handler (`dist/server/server.js`) and nothing serves it in production.

## Decision

1. **Layout.** A release target holds `v/<version>/{manifest.json, assets/…}` (immutable, `max-age=31536000, immutable`) and
   `stable/manifest.json` (the pointer, `no-cache`) with `stable/state.json` (current, known-good list of up to 10, rolled back).
2. **The pointer is a rewritten copy, not a redirect.** `stable/manifest.json` is the version's manifest with each path rewritten
   to `../v/<version>/…`. It works on any static store (no redirect support needed), keeps the module URLs identical to what the
   entry's own imports resolve to, and a rollback is one small write. The reader is configured with
   `PUBLIC_SOCIAL_MANIFEST_URL=<asset origin>/surface/stable/manifest.json`.
3. **Promote smoke-tests first; rolled-back versions are never promoted again.** A fix is a new version.
4. **Storage is pluggable.** `file:<dir>` works (rehearsals, CI, e2e); `bucket:<name>` is a stub that refuses until the store
   exists. Real steps in `release.yml` skip with a notice when their variables or secrets are absent.
5. **Source maps are not published.** They are a 30-day private artifact of the release run.
6. **Minify fully and budget it.** `rolldownOptions.output.minify: true`; budgets in `app/surface-budget.json` with 10–17 %
   headroom; an unminified build fails three of the five budgets.
7. **Versions** are `<UTC date>-<run number>.<short sha>` (for example `2026.11.23-57.a1b43e6`), valid under the manifest schema.
8. **Server.** `app/scripts/start.mjs` serves the fetch handler and `dist/client` over Node's http module (no new dependency,
   no Nitro); `app/scripts/migrate.mjs` migrates without tsx. The image is two stages on one pinned Node image
   (`node:22.23.5-bookworm-slim@sha256:e9f5…`), `npm ci --ignore-scripts`, runs as `node`, health check in Node.
9. **A `container` job** joins ci.yml (not in plan 5.8's list): build the image and run it against Postgres on every PR.

## Consequences

- Plan 8 P5's exit test ("on staging") is replaced by a local rehearsal in CI (`e2e/release.spec.ts`, and the rehearsal step
  of `release.yml`); a staging rehearsal is on the setup checklist once hosting exists.
- Whoever builds the hosting implements `BucketTarget` (get, put with content type and cache header, list) for the chosen store
  and fills the deploy step of `release.yml`; `docs/runbooks/deploy.md` lists the steps.
- Rolling the server back is Helm's own rollback; migrations are forward-only, so a release with a migration must stay
  backward compatible with the previous server for one release.
