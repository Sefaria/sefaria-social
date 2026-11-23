# Plan: 014 following

- Follow controls in the room UI (`features/session/FollowBar.tsx`, shown in the persistent mount while in a context):
  status (following X / on your own / leading), Follow again, Lead; Follow buttons in the presence list.
- Breaking away: the session client already pauses on the reader's local input; the controller maps it to the machine's
  `detach` and back to `rejoin`.
- e2e: `e2e/stack/` global setup (JWKS server, Start server on Postgres, `wrangler dev` relay), harness reader controls,
  `e2e/rooms.spec.ts` with two contexts; `e2e/reader/rooms.reader.spec.ts` the L4b version, skipped by config until A1.

## Tests

- `surface/room-following.test.tsx` (AC-001..003, jsdom, fake host, test relay).
- `e2e/rooms.spec.ts` (AC-004, Playwright, harness).
