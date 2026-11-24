# Plan: 033 a room member can get a LiveKit token to join the room's call

Design: `docs/design/audio-video.md` sections 5.1 and 5.2. Server only; no surface code (specs 034 and 035 use this).

## Approach

- **Dependency.** `livekit-server-sdk` in `app/package.json`, pinned to an exact version at least two weeks old (2.20.x was
  published 2026-11-19; check `npm view livekit-server-sdk time` when building). It brings its own `jose` 5; ours stays 6.
  It runs on Node 19+; the server image is Node 22.
- **Configuration** (`app/src/server/config.ts`): `LIVEKIT_URL` (`wss:` or `ws:` URL), `LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET`, `CALLS_ENABLED` (`"true"` or anything else, default off). One helper `callsConfig()` returns
  `{ url, key, secret }` or `null`; nothing else reads the four variables. `docs/runbooks/server.md` lists them, secrets marked.
- **Service** `app/src/server/services/livekit.ts`, the only module that imports `livekit-server-sdk`:
  - `callsAvailable(): boolean`.
  - `mintCallToken({ roomId, identity, role }) → { url, token, expiresAt }`: `new AccessToken(key, secret, { identity:
"u:<userId>", name, ttl: 600, metadata: JSON.stringify({ v: 1, role }) })`, `addGrant({ roomJoin: true, room:
"room_<roomId>", canSubscribe: true, canPublish: true, canPublishSources: [MICROPHONE, CAMERA, SCREEN_SHARE],
canPublishData: false })`, `await toJwt()`. `expiresAt` comes from the same clock value as the token's `exp`.
  - Later specs add moderation (039) and webhook verification (038) here.
- **Rooms service** (`rooms.ts`): `getCallToken(identity, roomId)` reuses `membership()` (404 `room.not_found` for a
  non-member and a missing room alike, decision 0008), refreshes the display cache with `upsertDisplay` like `joinRoom`, takes
  the role from the membership row, then mints **outside** any transaction (no I/O in a transaction; minting is local, but the
  rule stays simple). `toDto` gains `calls: { available: callsAvailable() }`, so every `Room` response carries it.
- **Contract** (`server/api/contracts.ts`): `CallToken = { url, token, expiresAt }`; endpoint `getCallToken`,
  `POST /api/v1/rooms/{roomId}/call/token`, access `user`, `errors: [404, 429, 503]`. `Room` gains
  `calls: { available: boolean }` (additive). New error codes in `http/errors.ts`: `call.unavailable` (503),
  `request.rate_limited` (429).
- **Route** `app/src/routes/api/v1/rooms.$roomId.call.token.ts`, thin, like `rooms.$roomId.status.ts`.
- **Rate limit.** There is no limiter today. Add `app/src/server/http/rate-limit.ts`: a fixed one-minute window per key in
  memory, with a size cap and expiry sweep so it cannot grow without bound, and an injectable clock for tests. Key
  `call-token:<userId>:<roomId>`, 20 per minute. `ApiError` gains optional headers so a 429 can carry `retry-after`
  (seconds to the window's end); `endpoint.ts` `run()` merges them into the response. Per-process is acceptable: the
  limit guards against a runaway client, not an attacker with many accounts, and the server runs one replica today. Note it in
  the code for when it scales out.
- **Logging.** Nothing new is logged in the happy path beyond `request.completed`. Errors log only `error.name`. The logger
  already redacts keys matching token/secret; the test checks the actual strings instead of trusting the redaction.
- **OpenAPI and client.** `npm run api:generate` rewrites `packages/api-client/openapi.json` and `src/schema.ts`;
  `npm run api:breaking` must pass (additive only).

## Risks

- `canPublishSources` names: the SDK takes `TrackSource` values from `@livekit/protocol`; check the exported enum when building.
- A `Room` schema change touches every room response: the response validator in `bind` rejects a missing field, so the change
  to `toDto` and the schema must land together (T-002).
- The token is a bearer credential for the media server: it must never be logged, cached in storage or put in a URL (spec 034
  keeps it in memory).

## Test strategy

All acceptance tests are integration tests through the route tree with real Postgres (`app/src/api.calls.int.test.ts`,
`test/integration/harness.ts`), like `api.join.int.test.ts`. Each test first asserts the route is served
(`expect(served("POST", path)).toBeTypeOf("function")`) so it fails on the base for an assertion reason, not an import error
(prove-red). The harness sets `LIVEKIT_*` and `CALLS_ENABLED` per test and calls `resetConfig()`.

| AC     | Test                                                                                                                                                                               | Why it fails today  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| AC-001 | issue a token to a member and to the owner; decode it with `jose` and the test secret: `sub`/identity, `name`, `video.room`, `exp - iat = 600`, `expiresAt`, metadata role         | no route            |
| AC-002 | the decoded `video` grant: `roomJoin`, `room`, `canSubscribe`, `canPublish`, `canPublishSources`, `canPublishData: false`                                                          | no route            |
| AC-003 | a non-member and a missing room answer 404 with identical bodies; no token in either                                                                                               | no route            |
| AC-004 | no token and a bad token answer 401 (the protection report already covers every route; this names it)                                                                              | no route            |
| AC-005 | `CALLS_ENABLED` unset, then each LiveKit variable unset: 503 `call.unavailable`; `GET /rooms/{id}` has `calls.available` false, and true when configured                           | no route, no field  |
| AC-006 | 20 requests pass, the 21st is 429 `request.rate_limited` with a numeric `retry-after`; another room and another user are unaffected; after the window (fake clock) it passes again | no limiter          |
| AC-007 | capture `h.logs` across a success, a 404, a 401 and a 503; assert none contains the issued token, the API key, the API secret or the Django token                                  | no route            |
| AC-008 | `api.contract.test.ts`: the generated document has `getCallToken` and `Room.calls`; `npm run api:breaking` passes                                                                  | not in the document |

Unit test `app/src/server/http/rate-limit.test.ts` for the window, the cap and the sweep.
