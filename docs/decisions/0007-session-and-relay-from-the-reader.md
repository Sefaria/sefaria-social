# 0007. The room protocol, client and relay start from the reader's code, kept in step by recorded fixtures

- Status: proposed
- Date: 2026-11-23
- Deciders: milestone P3 worker; a human owner confirms by approving the PR

## Context

Plan 6.4: copy `reader-next/src/lib/session/*` into `packages/session` and `reader-next/relay/*` into `packages/relay`,
record the source commit, and stop the two copies drifting in protocol until follow moves into social (P6) with a contract
test that replays the reader's protocol fixtures. The reader has no protocol fixture files today.

## Decision

- Source: `Sefaria/Sefaria-Project`, branch `reader-next`, commit `70b0804c9e7d2c981b3d1157bac1265e3b368f42` (the session
  code and relay last changed in `6883b3d9b1`). Copied: `src/lib/session/{protocol,ids,room,incoming,outgoing,client}.ts`,
  the reader-state core they need (`types, json, diff, schema, stream, registry, api`, transports `listeners, memory,
websocket`), and their tests. Not copied: `local-room.ts` (in-tab BroadcastChannel room), the broadcast-channel and
  post-message transports. `packages/session/SOURCE.json` holds the sha256 of every copied file and the list of local
  changes.
- Licence: Sefaria-Project is GPL-3.0 at its root; the files carry no per-file header, so none is added. Same
  organisation; the social repo's own licence is still open (D1).
- Local changes, none of which alters the wire format: `canPublish`/`refresh` on the client (social publishes only while
  the viewer is in the room's reader context); a per-connection `protocols` callback on the WebSocket transport (a fresh
  identity token in `Sec-WebSocket-Protocol`); `/social` pages private in the outgoing view; the relay's join rewrite and
  token check (in `packages/relay`, not in the shared room code).
- Fixtures: `packages/session/fixtures/protocol.v1.inputs.json` lists 62 inputs (room-side envelopes and room-to-client
  envelopes, valid and hostile); `scripts/fixtures.mjs --write <checkout>` records the reader's results by running the
  reader's own `room.ts`/`incoming.ts` with tsx (the reader's tsconfig resolves its `~/` alias); `--check <checkout>` names
  every case the reader now answers differently. `src/protocol.contract.test.ts` (contract project, CI `contract` job)
  replays the recorded results against this package, so a change here that alters a result fails CI.
- Relay tests: `@cloudflare/vitest-pool-workers` 0.23 requires Vitest `^4.1`; this repo is on Vitest 5. The relay tests
  therefore run in Node and drive workerd through Miniflare 4 (`new Miniflare({ modules: true, scriptPath, durableObjects
})`, `dispatchFetch` with `Upgrade: websocket`), with the Worker bundled by esbuild in the test's setup. That is still
  the Workers runtime; it gives up per-test storage isolation, which these tests do not need. Revisit when the pool
  supports Vitest 5.
- Miniflare version: 5.20261119.0-beta, the one wrangler 4.166 itself runs (npm's `latest` tag is still 4.x). Its options
  are a new shape; the tests pass the v4 shape through its exported `convertV4MiniflareOptions`. The e2e stack and
  `npm run relay:dev` use `wrangler dev`.

## Consequences

- Drift on the reader's side is found when someone runs `--check` (on the setup checklist, with every re-pin), not on every
  reader commit; the reader repo has no hook into social's CI.
- Adding a protocol case means adding an input and re-recording from a reader checkout, so the expected value always comes
  from the reader's code, never from ours.
