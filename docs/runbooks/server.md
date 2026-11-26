# The social server: API, configuration, running it, database

Built in milestone P2 (specs 005–008). Design: [PLAN.md](../PLAN.md) sections 6.1–6.3; decisions
[0005](../decisions/0005-server-routes-and-api-layer.md) and [0006](../decisions/0006-openapi-breaking-check.md).

## API surface (`/api/v1`)

| Method and path                            | Access                         | What                                                                                                          |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/health`                       | public (the only one)          | `select 1` within 2 s: 200 `ok` or 503 `unavailable`                                                          |
| `GET /api/v1/rooms`                        | Sefaria token                  | Rooms the caller is a member of, newest first                                                                 |
| `POST /api/v1/rooms`                       | Sefaria token                  | Create `{title}` (1–120 chars); caller is owner                                                               |
| `GET /api/v1/rooms/{roomId}`               | token + member                 | The room; non-member or missing: 404 `room.not_found`                                                         |
| `PATCH /api/v1/rooms/{roomId}`             | token + owner                  | Rename `{title}`; member: 403 `room.forbidden`                                                                |
| `DELETE /api/v1/rooms/{roomId}`            | token + owner                  | Delete with memberships: 204                                                                                  |
| `POST /api/v1/internal/user-deleted`       | `X-Sefaria-Signature` (Django) | Account deletion: `processed`/`duplicate`/`ignored`; then the relay drops the user (P3)                       |
| `POST /api/v1/internal/livekit/webhook`    | LiveKit-signed `Authorization` | Joins, leaves and finished calls keep `call_status` per room (spec 038)                                       |
| `GET /api/v1/me`                           | Sefaria token                  | `{userId, name}` from the token (P3, spec 082)                                                                |
| `POST /api/v1/rooms/{roomId}/members`      | Sefaria token                  | Join (the room id is the invitation); idempotent; missing room 404 (P3, spec 011)                             |
| `DELETE /api/v1/rooms/{roomId}/members/me` | token + member                 | Leave; owner: 403 `room.owner_cannot_leave` (P3)                                                              |
| `GET /api/v1/rooms/{roomId}/status`        | token + member                 | `{live, ref, title, participants}` from the relay; offline fallback (P3)                                      |
| `POST /api/v1/rooms/{roomId}/call/token`   | token + member                 | `{url, token, expiresAt}`: a 10-minute LiveKit token for the room's call; 20/min per user and room (spec 033) |
| `POST /api/v1/rooms/{roomId}/call/mute`    | token + owner                  | `{participant, source}`: mute a participant's microphone, camera or screen share (spec 039)                   |
| `POST /api/v1/rooms/{roomId}/call/remove`  | token + owner                  | `{participant}`: remove from the call; their call tokens are refused for 15 min (spec 039)                    |

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

| Variable                      | Required              | Meaning                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | yes (has a default)   | Postgres URL. Default `postgres://localhost:5432/sefaria_social`                                                                                                                                                                                                                                                           |
| `SOCIAL_JWKS_URL`             | yes                   | Django's keys: `https://<sefaria origin>/.well-known/sefaria-social-jwks.json`. Unset: every token call is 503                                                                                                                                                                                                             |
| `SOCIAL_TOKEN_ISSUER`         | yes                   | Must equal Django's `SOCIAL_TOKEN_ISSUER` (default there: the English library origin, e.g. `https://www.sefaria.org`)                                                                                                                                                                                                      |
| `SOCIAL_TOKEN_AUDIENCE`       | no                    | Default `sefaria-social` (Django's fixed `aud`)                                                                                                                                                                                                                                                                            |
| `USER_DELETED_WEBHOOK_SECRET` | yes                   | Same value as Django's `USER_DELETED_WEBHOOK_SECRET`. Unset: the webhook answers 503 (Django retries)                                                                                                                                                                                                                      |
| `RELAY_INTERNAL_URL`          | no                    | The relay's base URL for its internal routes (status, drop-user). Unset: status is always offline and deletions are not sent to the relay (P3)                                                                                                                                                                             |
| `RELAY_INTERNAL_SECRET`       | with the above        | Same value as the relay's `RELAY_INTERNAL_SECRET` (P3)                                                                                                                                                                                                                                                                     |
| `SOCIAL_ALLOWED_ORIGINS`      | yes (for the surface) | Comma-separated browser origins allowed by CORS: the reader's origins, e.g. `https://www.sefaria.org,https://www.sefaria.org.il` (P3). Also the `frame-ancestors` of Claude asset files (spec 061)                                                                                                                         |
| `LIVEKIT_URL`                 | for calls             | The LiveKit server browsers connect to, `wss://…` (spec 033). Locally, with the dev server: `ws://localhost:7880`                                                                                                                                                                                                          |
| `LIVEKIT_API_KEY`             | for calls             | LiveKit API key; signs call tokens                                                                                                                                                                                                                                                                                         |
| `LIVEKIT_API_SECRET`          | for calls             | LiveKit API secret. Secret: never sent to a browser or logged                                                                                                                                                                                                                                                              |
| `CALLS_ENABLED`               | for calls             | Calls are offered only when this is `true` and the three LiveKit variables are set. Keep `false` in production until owner decision D-AV4                                                                                                                                                                                  |
| `RECORDINGS_ENABLED`          | no                    | Session recordings (spec 041). `false` switches them off (503 `recording.unavailable`); unset or anything else leaves them on                                                                                                                                                                                              |
| `ASSET_STORE_DIR`             | no                    | Spec 051: the directory of the filesystem object store for recordings and Claude assets (spec 060) (default `.data/assets` under the working directory). Needs a volume on a server; a cloud bucket replaces it later                                                                                                      |
| `SOFER_API_KEY`               | no (secret)           | Spec 054: the Sofer.ai key for transcripts. Without it every transcript is `unavailable` and shiurim still play                                                                                                                                                                                                            |
| `SOFER_API_URL`               | no                    | Spec 054: the Sofer.ai API base (default `https://api.sofer.ai`); tests point it at a fake                                                                                                                                                                                                                                 |
| `RESEND_API_KEY`              | no (secret)           | Spec 059: the Resend key for invitation emails. Without it an email in the invite bar answers `unavailable`; handles work                                                                                                                                                                                                  |
| `RESEND_API_URL`              | no                    | Spec 059: Resend's API base (default `https://api.resend.com`); tests point it at a fake                                                                                                                                                                                                                                   |
| `INVITE_EMAIL_FROM`           | no                    | Spec 059: the invitation's sender, on a domain verified with Resend (default `Sefaria <invitations@sefaria.org>`)                                                                                                                                                                                                          |
| `ROOM_LINK_ORIGIN`            | no                    | Spec 059: where an emailed room link points: `<origin>/social/r/<roomId>` (default `https://www.sefaria.org`)                                                                                                                                                                                                              |
| `SEFARIA_LOOKUP_URL`          | no                    | Spec 059: Sefaria's `POST /api/social/user-lookup`. With the secret, an invited address with an account is told in Social instead of emailed                                                                                                                                                                               |
| `SEFARIA_LOOKUP_SECRET`       | no (secret)           | Spec 059: the HMAC key shared with Django's `SOCIAL_LOOKUP_SECRET`, signing each lookup                                                                                                                                                                                                                                    |
| `SOCIAL_PUBLIC_ORIGIN`        | no                    | Spec 054: the public origin of this server (e.g. `https://social.example.org`). When set, Sofer.ai fetches a shiur's audio from its public URL; otherwise the audio is sent inline, up to 40 MB                                                                                                                            |
| `ASSET_WORKER`                | no                    | Spec 052: `off` keeps the asset processing worker from starting in this process; it otherwise starts with the first health check. Needs `ffmpeg` and `ffprobe` on the PATH (the image has them; or `FFMPEG_PATH`, `FFPROBE_PATH`)                                                                                          |
| `SEFARIA_API_ORIGIN`          | no                    | Spec 060: the Sefaria API that checks and expands a Claude asset's refs (`POST <origin>/api/refs/expand`; default `https://www.sefaria.org`). Unreachable: saves answer 503 `asset.refs_unavailable`                                                                                                                       |
| `ASSET_MAX_BYTES`             | no                    | Spec 060: a Claude asset file's size limit (default 5242880, 5 MB)                                                                                                                                                                                                                                                         |
| `ASSET_DAILY_LIMIT`           | no                    | Spec 060: new asset versions one user may save in 24 hours (default 20)                                                                                                                                                                                                                                                    |
| `ASSET_MAX_SEGMENTS`          | no                    | Spec 060: the most segments one asset's refs may expand to (default 2000)                                                                                                                                                                                                                                                  |
| `ASSET_CONTENT_ORIGIN`        | for production        | Spec 061: the origin that serves asset files, a registrable domain of its own (never `sefaria.org` or this server's API host). When set, content routes answer 404 on any other origin. Unset: content URLs use `http://127.0.0.1:3200`, which in development is this server under another host name than `localhost:3200` |
| `ASSET_CONTENT_SECRET`        | no (secret)           | Spec 061: HMAC key for a shiur's open-network asset URLs (30-minute grants). Unset: shiurim give no such URL; public URLs work                                                                                                                                                                                             |
| `ASSET_TRUSTED_CDNS`          | no                    | Spec 061: hosts public assets may load scripts, styles and fonts from (default `cdnjs.cloudflare.com,cdn.jsdelivr.net,unpkg.com,fonts.googleapis.com,fonts.gstatic.com`)                                                                                                                                                   |
| `ASSET_TRUSTED_CDNS_ENABLED`  | no                    | Spec 061: `true` adds those hosts to the public policy; off by default                                                                                                                                                                                                                                                     |
| `LOG_LEVEL`                   | no                    | `debug` / `info` (default) / `warn` / `error`                                                                                                                                                                                                                                                                              |
| `TEST_DATABASE_URL`           | tests only            | Default `postgres://localhost:5432/sefaria_social_test`; the name must contain `test` (it is reset)                                                                                                                                                                                                                        |

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
| `call_status`      | `room_id` → rooms cascade, `live`, `participants`, `started_at`, `updated_at` (LiveKit webhooks)          | none                       |
| `call_removals`    | (`room_id` → rooms cascade, `user_id`), `until`                                                           | the removed user           |
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

## LiveKit webhooks (spec 038)

In the LiveKit project (Cloud: Settings → Webhooks; self-hosted: `webhook.urls` in its config) add
`<social origin>/api/v1/internal/livekit/webhook`, signed with the same API key as `LIVEKIT_API_KEY`. Without it, the lobby
and cards never show a call as live; nothing else breaks.
