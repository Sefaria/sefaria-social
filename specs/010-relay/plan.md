# Plan: 010 room relay

- `packages/relay/src/worker.ts`: the reader's Worker and Durable Object, importing the room from
  `@sefaria-social/session`; Origin check; `auth.ts` reads `Sec-WebSocket-Protocol`, verifies with `jose`
  (`createRemoteJWKSet`, `jwtVerify`, RS256, issuer, audience), asks the tombstones object, and passes the identity to the
  room object in internal headers. The room object rewrites `join` with the identity before the pure room sees it.
- `status` and `drop-user` are internal routes guarded by `RELAY_INTERNAL_SECRET` (constant-time compare).
- `packages/relay/test-support/`: an esbuild bundle of the Worker and a Miniflare factory; tests mint RS256 tokens with a
  key generated per run and serve its JWKS from a local HTTP server.

## Tests

- `packages/relay/src/relay.test.ts` (vitest project `relay`, run in the CI integration job): every AC, through real
  WebSockets against workerd.
