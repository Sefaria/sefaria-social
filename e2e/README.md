# End-to-end tests

L4a (plan 5.5): Playwright journeys on the harness (`harness/`), projects `desktop` and `phone`, each journey in English and
Hebrew. `npm run test:e2e` builds the surface and the harness, then serves them with `harness/serve.mjs` (port 3300). The
real-reader lane (L4b) is a later milestone. Playwright tests are not run by `prove-red` (it runs Vitest only).

## Rooms (P3)

`e2e/rooms.spec.ts` is P3's exit journey: two browser contexts in one room. Playwright starts `e2e/stack/start.ts` as a
second web server: a fresh Postgres database (`E2E_DATABASE_URL`, default `postgres://localhost:5432/sefaria_social_e2e_test`;
the name must contain "test"), an RSA key generated per run behind a local JWKS on port 3299, the built Start server on
3200 and the relay under `wrangler dev` on 8787. Tests mint persona tokens with that key (`e2e/stack/tokens.ts`) and hand
them to the harness's fake host. `e2e/reader/` holds the same journey for the real reader (L4b), disabled until A1 merges.

## Calls (spec 040)

`e2e/calls.spec.ts` puts two learners in one room's call, on the desktop and phone projects, with Chromium's fake camera and
microphone. The stack (`e2e/stack/start.ts`) starts LiveKit in development mode: the `livekit-server` binary when it is on the
PATH (macOS: `brew install livekit`), otherwise the `livekit/livekit-server` container. LiveKit advertises the machine's own
network address, because Chromium gathers no loopback ICE candidates.

- On macOS, Chromium launched from a sandboxed tool cannot capture its fake microphone (`getUserMedia({ audio })` never
  resolves), so the journey joins with the microphone off there and records that audio and mute were not checked. Linux (CI)
  checks them; `E2E_CALL_AUDIO=1` forces them on.
- Ports can be moved off a developer's own servers: `E2E_API_PORT`, `E2E_RELAY_PORT`, `E2E_JWKS_PORT`, `E2E_LIVEKIT_PORT`.
