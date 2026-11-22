# Plan: 006 identity token verification and protect-by-default API

## Approach

- `app/src/server/auth/verify.ts`: one `createRemoteJWKSet` per JWKS URL (3 s timeout, 30 s cooldown, 10 min cache) and
  `jwtVerify` with `algorithms: ["RS256"]`, issuer, audience and 30 s clock tolerance; claims validated with zod
  (`app/src/server/auth/identity.ts`). jose errors map to `auth.invalid_token`; a JWKS timeout or fetch failure maps to
  503 `auth.unavailable`.
- `app/src/server/http/endpoint.ts`: access `user` (the default for every endpoint) reads `Authorization: Bearer`, verifies
  it, and hands the identity to the handler. Access `public` is accepted only for a `METHOD /path` on the list in
  `app/src/server/http/public-routes.ts`; otherwise defining the endpoint throws (AC-005).
- Every route gets an `ANY` handler answering 405 for other methods, through the same wrapper, so even an unknown method is
  refused before anything runs.

## Tests

- `app/src/server/auth/verify.test.ts` (unit, local JWKS on a random port): accepted token, each invalid case, cache and
  refetch on unknown kid, timeout.
- `app/src/api.auth.int.test.ts` (acceptance): AC-001..003 through a real route with tokens from the global setup's key and
  JWKS; AC-005 through the wrapper.
- `app/src/api.routes.int.test.ts` (acceptance, AC-004): builds the router, enumerates every route under `/api/` with server
  handlers, calls each method with no credentials, expects 401 for all but the public list. It also asserts that the
  routes it found include the known ones, so an empty enumeration cannot pass. A negative test shows the enumeration
  reports an unprotected handler.

## Risks

- The JWKS URL, issuer and audience are configuration; a mismatch with Django's settings fails closed (401), never open.
