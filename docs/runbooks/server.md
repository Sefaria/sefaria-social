# The social server: API, configuration, running it, database

Built in milestone P2 (specs 005–008). Design: [PLAN.md](../PLAN.md) sections 6.1–6.3; decisions
[0005](../decisions/0005-server-routes-and-api-layer.md) and [0006](../decisions/0006-openapi-breaking-check.md).

## API surface (`/api/v1`)

| Method and path                            | Access                         | What                                                                                    |
| ------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------- |
| `GET /api/v1/health`                       | public (the only one)          | `select 1` within 2 s: 200 `ok` or 503 `unavailable`                                    |
| `GET /api/v1/rooms`                        | Sefaria token                  | Rooms the caller is a member of, newest first                                           |
| `POST /api/v1/rooms`                       | Sefaria token                  | Create `{title}` (1–120 chars); caller is owner                                         |
| `GET /api/v1/rooms/{roomId}`               | token + member                 | The room; non-member or missing: 404 `room.not_found`                                   |
| `PATCH /api/v1/rooms/{roomId}`             | token + owner                  | Rename `{title}`; member: 403 `room.forbidden`                                          |
| `DELETE /api/v1/rooms/{roomId}`            | token + owner                  | Delete with memberships: 204                                                            |
| `POST /api/v1/internal/user-deleted`       | `X-Sefaria-Signature` (Django) | Account deletion: `processed`/`duplicate`/`ignored`; then the relay drops the user (P3) |
| `GET /api/v1/me`                           | Sefaria token                  | `{userId, name}` from the token (P3, spec 082)                                          |
| `POST /api/v1/rooms/{roomId}/members`      | Sefaria token                  | Join (the room id is the invitation); idempotent; missing room 404 (P3, spec 011)       |
| `DELETE /api/v1/rooms/{roomId}/members/me` | token + member                 | Leave; owner: 403 `room.owner_cannot_leave` (P3)                                        |
| `GET /api/v1/rooms/{roomId}/status`        | token + member                 | `{live, ref, title, participants}` from the relay; offline fallback (P3)                |
| `POST /api/v1/rooms/{roomId}/call/token`   | token + member                 | `{url, token, expiresAt}`: a 10-minute LiveKit token for the room's call (spec 033)     |

- **Token:** `Authorization: Bearer <JWT>` from Django's `POST /api/social/token` (RS256, `aud` `sefaria-social`, `sub` =
  `auth_user.id`, 10 minutes). Verified with `jose` against the JWKS URL (3 s timeout, keys cached, refetch on an unknown
  `kid` at most every 30 s). A tombstoned user gets 401 `auth.user_deleted`.
- **Errors:** `{ "error": { "code", "message" } }`; codes in `app/src/server/http/errors.ts` (`auth.missing_token`,
  `auth.invalid_token`, `auth.user_deleted`, `auth.unavailable` (503), `request.invalid` (400), `request.too_large` (413),
  `method.not_allowed` (405, after auth), `room.not_found`, `room.forbidden`, `webhook.bad_signature`, `internal`).
- **Every response** carries `X-Correlation-Id` (the caller's if it is 8–64 of `[A-Za-z0-9._-]`, else a new UUID) and
  `Cache-Control: no-store`.
- The contract is `packages/api-client/openapi.json`, generated from `app/src/server/api/contracts.ts`; clients use
  `@sefaria-social/api-client`.

Adding an endpoint: declare it in `contracts.ts` and add it to `ENDPOINTS`; bind it in a route file under
`app/src/routes/api/v1/` with `serve({ METHOD: bind(contract, handler) })`; put logic in `app/src/server/services/`; run
`npm run build` (route tree) and `npm run api:generate`; add it to the atlas. Making one public means adding it to
`app/src/server/http/public-routes.ts` with a reason; the route-enumeration test (`app/src/api.routes.int.test.ts`) fails
for any route that answers without credentials and is not on that list.

## Environment variables

| Variable                      | Required              | Meaning                                                                                                                                        |
| ----------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | yes (has a default)   | Postgres URL. Default `postgres://localhost:5432/sefaria_social`                                                                               |
| `SOCIAL_JWKS_URL`             | yes                   | Django's keys: `https://<sefaria origin>/.well-known/sefaria-social-jwks.json`. Unset: every token call is 503                                 |
| `SOCIAL_TOKEN_ISSUER`         | yes                   | Must equal Django's `SOCIAL_TOKEN_ISSUER` (default there: the English library origin, e.g. `https://www.sefaria.org`)                          |
| `SOCIAL_TOKEN_AUDIENCE`       | no                    | Default `sefaria-social` (Django's fixed `aud`)                                                                                                |
| `USER_DELETED_WEBHOOK_SECRET` | yes                   | Same value as Django's `USER_DELETED_WEBHOOK_SECRET`. Unset: the webhook answers 503 (Django retries)                                          |
| `RELAY_INTERNAL_URL`          | no                    | The relay's base URL for its internal routes (status, drop-user). Unset: status is always offline and deletions are not sent to the relay (P3) |
| `RELAY_INTERNAL_SECRET`       | with the above        | Same value as the relay's `RELAY_INTERNAL_SECRET` (P3)                                                                                         |
| `SOCIAL_ALLOWED_ORIGINS`      | yes (for the surface) | Comma-separated browser origins allowed by CORS: the reader's origins, e.g. `https://www.sefaria.org,https://www.sefaria.org.il` (P3)          |
| `LIVEKIT_URL`                 | for calls             | The LiveKit server browsers connect to, `wss://…` (spec 033). Locally, with the dev server: `ws://localhost:7880`                              |
| `LIVEKIT_API_KEY`             | for calls             | LiveKit API key; signs call tokens                                                                                                             |
| `LIVEKIT_API_SECRET`          | for calls             | LiveKit API secret. Secret: never sent to a browser or logged                                                                                  |
| `CALLS_ENABLED`               | for calls             | Calls are offered only when this is `true` and the three LiveKit variables are set. Keep `false` in production until owner decision D-AV4      |
| `LOG_LEVEL`                   | no                    | `debug` / `info` (default) / `warn` / `error`                                                                                                  |
| `TEST_DATABASE_URL`           | tests only            | Default `postgres://localhost:5432/sefaria_social_test`; the name must contain `test` (it is reset)                                            |

Django side (Sefaria-Project PR #4121): set `SOCIAL_TOKEN_PRIVATE_KEYS`, `SOCIAL_TOKEN_ISSUER`, `USER_DELETED_WEBHOOK_URLS`
(`<social origin>/api/v1/internal/user-deleted`) and `USER_DELETED_WEBHOOK_SECRET`.

## Run it locally

Put the variables in a `.env` at the repository root (ignored by git) and load it with `set -a; source .env; set +a` before
`npm run dev`; nothing loads it automatically.

```bash
createdb sefaria_social                       # local Postgres 15+ (or: docker run -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17)
export DATABASE_URL=postgres://localhost:5432/sefaria_social
export SOCIAL_JWKS_URL=http://localhost:8000/.well-known/sefaria-social-jwks.json   # a dev Django with keys configured
export SOCIAL_TOKEN_ISSUER=http://localhost:8000
export USER_DELETED_WEBHOOK_SECRET=dev-only-secret
npm run db:migrate                            # apply app/src/server/db/migrations
npm run dev                                   # http://localhost:3200/api/v1/health
```

Tests: `npm run test:integration` (needs Postgres; creates and resets `sefaria_social_test`), `npm test` (unit). After a
build, `npm run smoke:server` calls the built server's own fetch handler. Staff purge for a lost deletion webhook:
`DATABASE_URL=… npm run purge-user -- <userId>`.

## Database

Postgres, Drizzle schema in `app/src/server/db/schema.ts`, SQL migrations in `app/src/server/db/migrations/` (a protected
path). User ids are Sefaria `auth_user.id` as `bigint`; no tables shared with Django; timestamps are `timestamptz`; every
foreign key is indexed (tested).

| Table              | Columns (key first)                                                                                       | User data                  |
| ------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------- |
| `rooms`            | `id` uuid, `owner_user_id`, `title`, `created_at`, `updated_at`                                           | owner                      |
| `room_members`     | (`room_id` → rooms cascade, `user_id`), `role` owner/member, `joined_at`                                  | member                     |
| `shiurim`          | `id`, `room_id` → rooms set null, `teacher_user_id`, `title`, `ref`, `visibility`, `scheduled_at`, times  | teacher                    |
| `shiur_recordings` | `id`, `shiur_id` → shiurim cascade, `owner_user_id`, `storage_key` (pointer), `duration_ms`, `visibility` | owner (private)            |
| `user_display`     | `user_id`, `name`, `img`, `updated_at` (cache of token claims)                                            | the user                   |
| `deleted_users`    | `user_id`, `deleted_at`, `event_id` (tombstone)                                                           | the only place an id stays |
| `webhook_receipts` | `event_id`, `event_type`, `received_at` (idempotency)                                                     | none                       |

Changing the schema: edit `schema.ts`, run `npm run db:generate -- --name <what>`, commit the migration. CI fails when
schema and migrations differ, and the migration check refuses drop/rename/retype/new NOT NULL without a `-- contract:` line.
A new table holding a user id must be added to `deleteUserData` (`app/src/server/services/users.ts`) and to the seed in
`test/integration/schema-walk.ts`; the walk-the-schema test fails until both are done.

## QA and e2e environments (P3)

- `npm run qa:server` (after `npm run build`; needs `SOCIAL_ENV=test-<anything>` and `QA_PERSONA_SECRET`): the built server
  plus the test-only persona routes (spec 082) on 127.0.0.1:3200; `npm run qa:relay`, `npm run qa:harness`,
  `npm run qa:seed -- <scenario>|--all`, `npm run qa:reset`. Contract: `e2e/qa/README.md` (F2).
- `npm run test:e2e` starts `e2e/stack/start.ts` itself (Postgres `E2E_DATABASE_URL`, a JWKS, the API, the relay).
