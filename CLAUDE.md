# Sefaria Social

Shared learning in the Sefaria reader: rooms, following another learner's place, presence on segments, shiurim, a feed of them.
Social is a **surface** loaded at runtime into the reader page (`reader-next`); the reader is the host, social is not a host.
It talks to the reader only through the SurfaceHost contract, has its own server and Postgres, and learns who the user is from
Django. One TanStack Start codebase, two builds: the Start app (server + standalone pages) and the client-only surface bundle.
The full design is `docs/PLAN.md`; when this file and the plan disagree, the plan wins, and code beats both.

```
 browser (www.sefaria.org, new reader only)
 SHELL (reader-next): header, sign-in, router, surface loader
   ├─ READER surface (built in)        refs, library, search …
   └─ SOCIAL surface (this repo)       page mount /social/*   +   persistent mount (any route)
            │ SurfaceHost v1 (plain JS objects, no React)          │ HTTPS + Bearer token
            ▼                                                      ▼
 Django ── short-lived identity token, user-deleted webhook ──▶ SOCIAL SERVER (Start, Postgres) · RELAY (Worker + DO)
```

## Map: read when

| File                                      | Read it when                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `docs/PLAN.md`                            | Before any milestone; it is the source of truth (sections 0–3 first)                                    |
| `docs/ARCHITECTURE.md`                    | Adding a file under `app/src` or a package; deciding which layer owns code                              |
| `docs/ROUTING.md`                         | Anything that reads or changes the URL, links, enlarge/minimise (R1–R18)                                |
| `docs/CONTRACT.md`                        | Anything that touches the host object, the surface entry, or the pinned contract                        |
| `docs/decisions/`                         | Before re-deciding something; record a new decision as `NNNN-slug.md` (format: `0000-record-format.md`) |
| `docs/runbooks/setup-checklist.md`        | A step needs a human (settings, secrets, owners); append it there                                       |
| `docs/runbooks/working-in-the-factory.md` | Before any spec, task or PR: the pipeline, spec numbers, trailers, what the gate says                   |
| `REVIEW.md`                               | Reviewing a PR, or wondering what reviewers block on                                                    |
| `.claude/rules/routing.md`                | Loaded for `app/src/**` and `packages/session/**`: R1–R18 verbatim                                      |
| `.claude/rules/surface-contract.md`       | Loaded for `app/src/surface/**`, `packages/host-contract/**`, `harness/**`                              |
| `.claude/rules/server-api.md`             | Loaded for `app/src/server/**`, `app/src/routes/api/**`, `packages/api-client/**`                       |
| `.claude/rules/db.md`                     | Loaded for `app/src/server/db/**`                                                                       |
| `.claude/rules/relay.md`                  | Loaded for `packages/relay/**`, `packages/session/**`                                                   |
| `.claude/rules/tests.md`                  | Loaded for test files and `e2e/**`                                                                      |
| `.claude/rules/security.md`               | Loaded for server, auth, webhooks, workflows                                                            |
| `.claude/rules/specs.md`                  | Loaded for `specs/**` and the atlas                                                                     |
| `.claude/rules/styling-i18n.md`           | Loaded for `*.tsx`, `*.css`                                                                             |

## How work flows

spec → work order → one task per session → verify → PR. A human agrees to every spec and approves every merge.

1. `/shape-spec` writes `specs/NNN-slug/spec.md` + `acceptance.feature`; a human code owner reviews it and runs
   `npm run factory -- approve NNN --by <email>` (never an agent: the command refuses agent sessions).
2. `/plan-spec NNN` writes `plan.md` + `tasks.yaml`; `npm run factory -- compile NNN` writes `workorder.json`
   (`--draft` before approval: buildable locally, refused by CI's `spec-gate`).
3. `/build-task NNN/T-xxx` builds one task test-first, in one session, as one PR; commits carry `Spec: NNN` / `Task: T-xxx`.
4. `/verify` records each check's command and real output, ending with a VERDICT line.

## Non-negotiables (each is enforced by the named check)

- No product code without an active work order. [`guard-paths` hook and CI `spec-gate`]
- A spec change is its own PR, reviewed by a human owner; never change an agreed spec and product code together. [`spec-gate`]
- A feature is not done until its atlas entry (`docs/features/features.json`) is updated and has a tagged test. [`factory atlas` in CI `static`]
- The surface never imports server code or the Start runtime; server never imports React; layers import only to their left.
  [`test/architecture/` in CI `static`]
- Never touch `window.history` or `location`; navigate through the host (R1). Only `app/src/surface/host-history.ts` may.
  [ESLint `no-restricted-syntax` + `test/architecture/history.test.ts`]
- Validate everything that crosses a boundary with a zod schema; a TypeScript cast is not validation. [review: CRITICAL]
- Tokens stay in memory. Never log a token, a request body or a header. [review: CRITICAL; secret scan from F2]
- Real Postgres in tests. No mocks of our own database. [`.claude/rules/tests.md`; review]
- A claim of done is a command and its output. [`/verify`; review]
- No ticket ids in source, no personal data in fixtures, no secrets in the repo.

## Commands

```bash
npm ci                    # install (Node >= 22.12; CI uses Node 22)
npm run dev               # Start app on http://localhost:3200/social (3100 is the reader)
npm run typecheck         # tsc, strict, app + root (tests, configs)
npm run lint              # ESLint 9 flat config, warnings fail
npm run format:check      # Prettier (npm run format to fix)
npm run test:arch         # L0 architecture tests (CI static job)
npm test                  # L1 unit tests (CI unit job)
npm run test:e2e          # Playwright (empty until P1; passes with no tests)
npm run build             # Start build (the surface build arrives with spike S1)
npm run test:factory      # the factory's own negative tests (CI static job)
npm run factory -- help   # compile, approve (humans only), gate, doctor, prove-red, atlas, atlas:build
```

CI: `.github/workflows/ci.yml`; the only required check is `result`.

## Browser support

Target: Baseline **widely available** (features interoperable across the major browsers for at least 30 months). A feature that is
only Baseline "newly available" may be used if it degrades to a working page without it, and no more than a short fallback budget
of such fallbacks is kept: at most five, each listed with its removal date in `docs/decisions/`. No polyfills for anything outside
Baseline widely available without a decision record.

## Gotchas

- `npm install` with npm 10 (bundled with Node 22/23) crashes with "Cannot read properties of null (reading 'edgesOut')" on this
  tree. Use `npx -y npm@11 install` to add or change dependencies; `npm ci` works with npm 10. Commit `package-lock.json`.
- `app/src/routeTree.gen.ts` is generated by the router plugin on `dev`/`build` and committed (typecheck needs it). After adding a
  route, run `npm run build` (or `dev`) and commit the regenerated file.
- Architecture tests scan with the TypeScript parser; the `~/` alias means `app/src`. A new top-level folder under `app/src` is a
  violation until it is added as a layer in `test/architecture/rules.ts` and `docs/ARCHITECTURE.md`.
- `docs/PLAN.md` is excluded from Prettier on purpose; do not reformat the owner's plan.
- The guard hook blocks Edit/Write on `app/`, `packages/`, `harness/`, `e2e/` without `.factory/active.json` (set by
  `/build-task`) and on protected paths always (`factory/lib/paths.mjs`). Specs are open; `specs/approvals.json` never is.
