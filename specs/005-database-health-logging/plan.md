# Plan: 005 database, migrations, health check and request logging

## Approach

- Drizzle schema in `app/src/server/db/schema.ts` for the seven tables; `drizzle-kit generate` writes the SQL migration into
  `app/src/server/db/migrations/` (committed). `app/src/server/db/migrate.ts` applies them (tests, `npm run db:migrate`).
  CI regenerates and fails when the schema and the migrations differ.
- `app/src/server/db/migration-rules.ts`: the expand/contract check over migration SQL (AC-002), with negative tests.
- `app/src/server/config.ts`: environment parsed with zod, lazily, so importing server code never needs a database.
- `app/src/server/http/endpoint.ts`: the one wrapper every API handler goes through (correlation id, access, zod parsing,
  error mapping, one log line). Access kinds arrive with 006/008; 005 needs `public`.
- `app/src/server/log/logger.ts`: JSON lines to stdout; the message is a member of a fixed union; fields are scalars; a
  sink can be swapped by tests.
- `GET /api/v1/health` (`app/src/routes/api/v1/health.ts`) calls `app/src/server/services/health.ts`: `select 1` under a
  2 s statement timeout on a dedicated short-timeout connection.

## Tests (real Postgres)

- New Vitest project `integration` for `app/src/**/*.int.test.ts`, one file at a time (shared database), with a global
  setup that creates the test database, runs the migrations, makes an RSA key and serves a local JWKS (used from 006).
- Acceptance tests sit directly in `app/src` (entry level, so they may import the route tree) and reach the API through
  the served route tree (`getRouter()`), the way Start dispatches. Each test first asserts that its route is served (or
  its module is present), so on the merge base it fails on that assertion; then it loads the shared harness.
- AC-001: information_schema / pg_catalog queries. AC-002: rule check on fixture SQL. AC-003/004: health route, then the
  service against an unreachable port. AC-005/006: capture the log sink around a request with a token and a body.
- CI: an `integration` job with a Postgres service container; it also runs the migration drift check and a smoke test of
  the built Start server (`dist/server/server.js` fetch handler: health 200).

## Risks

- Start's server-route API was a `[CHECK]`; confirmed against 1.169 (`createFileRoute(path)({ server: { handlers } })`) and
  recorded in `docs/decisions/0005-server-routes-and-api-layer.md`.
