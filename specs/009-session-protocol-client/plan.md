# Plan: 009 room protocol and client

- `packages/session/src/core/**`: the reader-state core as copied (types, json, diff, schema, stream, registry, api,
  transports listeners/memory/websocket) with its tests.
- `packages/session/src/{protocol,ids,room,incoming,outgoing,client}.ts` with the reader's tests; `index.ts` exports what
  the app and the relay use.
- Local changes, each a small diff recorded in `SOURCE.json`: `canPublish?: () => boolean` and `refresh()` on the client;
  `protocols` may be a function on the WebSocket transport (called per connection); `/social` is a private path in
  `outgoing.ts`.
- Fixtures: `fixtures/protocol.v1.json` holds inputs (room-side envelopes and room-to-client envelopes, valid and invalid)
  with the results the reader's code gives. `scripts/fixtures.mjs` (`npm run fixtures -w @sefaria-social/session`)
  records them from a reader checkout (`--write`) or compares (`--check`), loading the reader's room.ts with tsx (it has
  relative imports only, by design). `src/protocol.contract.test.ts` replays them against this package (contract project).

## Tests

- `src/acceptance.test.ts` (AC-001..003) loads the modules through `import.meta.glob`, so the base fails on an assertion.
- `src/protocol.contract.test.ts` (AC-004) and `scripts/fixtures.test.ts`-style case in the same file for AC-005 using a
  temporary fake reader checkout.

## Risks

- The reader may change its protocol before P6; the fixture check is run when re-pinning (setup checklist).
