---
id: "006"
title: Identity token verification and protect-by-default API
status: approved
features: [IDENT-006, API-006]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: api-minor
---

## Problem

The social server must know which Sefaria user is calling, and must never be able to mint that identity itself. Django
signs a short-lived RS256 token for social and publishes its public keys as a JWKS (plan section 6.1, option A, decided
by the owner; the Django side is `POST /api/social/token` and `GET /.well-known/sefaria-social-jwks.json`). The server
has to verify that token on every call, and every API route must refuse anonymous callers unless it is deliberately
public, so that forgetting to protect a new route is impossible rather than merely unlikely.

## Acceptance criteria

- AC-001 WHEN a request to a protected route carries `Authorization: Bearer <token>`, where the token is an RS256 JWT whose
  `kid` names a key in the configured JWKS, whose `iss` equals the configured issuer, whose `aud` is `sefaria-social`,
  which is unexpired, and whose `sub` is a positive integer, THE SYSTEM SHALL run the handler as Sefaria user `sub` with
  the token's `name`, `picture` and `staff` claims.
- AC-002 WHEN the token is missing, malformed, expired, signed by a key not in the JWKS, signed with another algorithm
  (for example HS256), has the wrong issuer or audience, or has a `sub` that is not a positive integer, THE SYSTEM SHALL
  respond 401 with error code `auth.missing_token` (no token) or `auth.invalid_token` (any other case) and SHALL NOT run
  the handler.
- AC-003 WHEN the JWKS cannot be fetched within 3 seconds THE SYSTEM SHALL respond 503 with `auth.unavailable`; WHEN keys
  were fetched once THE SYSTEM SHALL reuse them for later tokens without fetching again, and SHALL refetch when a token
  names an unknown `kid`.
- AC-004 WHEN any route the server serves under `/api/` is called without credentials THE SYSTEM SHALL refuse it with
  401, except the routes on the explicit public list (today only `GET /api/v1/health`); a test enumerates every route in
  the served route tree and checks this.
- AC-005 WHEN an endpoint is declared public but its method and path are not on the public list THE SYSTEM SHALL refuse
  to define it (an error at module load naming the endpoint), so a route cannot be made public by accident.

## Out of scope

- The Django side (Sefaria-Project PR #4121) and the surface's token fetching (`host.viewer.identityToken()`).
- The relay's token check (P3).
- Roles beyond the `staff` claim.
- Revocation before `exp` other than the deleted-user tombstone (spec 008).

## Notes for the planner

- Contract from the Django side: header `{"typ":"JWT","alg":"RS256","kid":…}`; claims `iss` (per deployment, configured
  in social as `SOCIAL_TOKEN_ISSUER`), `aud` `"sefaria-social"` (a string), `sub` = `str(auth_user.id)`, `name` (may be
  empty), `picture` (absolute http(s) URL, omitted when none), `staff` (boolean), `iat`, `exp` (iat + 600 by default), `jti`.
  JWKS served with `Cache-Control: public, max-age=300`; rotation appends a key, so refetch on an unknown `kid`.
- Verify with `jose` (`createRemoteJWKSet` + `jwtVerify`, `algorithms: ["RS256"]`), never by hand; small clock tolerance.
- Configuration: `SOCIAL_JWKS_URL`, `SOCIAL_TOKEN_ISSUER`, `SOCIAL_TOKEN_AUDIENCE` (default `sefaria-social`).
- Tests generate an RSA key at test time and serve it from a local JWKS server; no key material in the repo.
- Tokens are never logged, stored or put in a URL.
