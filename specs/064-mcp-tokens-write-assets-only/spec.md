---
id: "064"
title: A token issued through the MCP saves Claude assets and is refused everywhere else, the relay included
status: proposed
features: [IDENT-107]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [api, identity]
risk: high
contract_impact: api-minor
---

## Problem

The owner decided that the MCP gets a way to write to Social as the signed-in user (D10). Django will issue the usual identity
token when it is asked with a 5-minute `mcp` token, marked with the claim `via: "mcp"` (plan 7.1). Such a token is held by a
third-party client (Claude) on the user's behalf, so it must do exactly one thing: save a Claude asset. Today Social ignores
unknown claims, so a marked token would be accepted on every route and by the relay.

## Acceptance criteria

- AC-001 WHEN a request to `POST /api/v1/claude-assets` or `POST /api/v1/claude-assets/import` carries a valid token with
  `via: "mcp"` THE SYSTEM SHALL handle it as the token's user, as it does an unmarked token
- AC-002 WHEN a request to any other route that needs a user carries a valid token with `via: "mcp"` THE SYSTEM SHALL answer
  403 `auth.mcp_not_allowed` before reading the body or doing anything; the set of routes that accept such a token SHALL be
  exactly the two of AC-001, checked against every route the server serves
- AC-003 WHEN a token carries a `via` claim with any other value THE SYSTEM SHALL refuse it as invalid (401
  `auth.invalid_token`)
- AC-004 WHEN a socket offers the relay a token that carries a `via` claim THE SYSTEM SHALL refuse it with 401, as it refuses
  any invalid token
- AC-005 WHEN an endpoint is declared to accept MCP tokens without being on the reviewed list THE SYSTEM SHALL refuse to load
  it, the way a public endpoint off the public list is refused

## Out of scope

- Django's side (`POST /api/social/token` on `MCP_ROUTES`, the claim) and the MCP's `save_asset` tool (Phase 4).
- Public routes read no token; a marked token there grants nothing, as no token does.

## Notes for the planner

- `Identity` gains an optional `via: "mcp"`; the claim schema refuses any other `via`. The endpoint wrapper's `user` check
  refuses a marked identity unless the endpoint says `mcp: true`, and `defineEndpoint` allows `mcp: true` only for endpoints
  on `MCP_ENDPOINTS` (`server/http/mcp-routes.ts`, a reviewed list like the public one). The 405 fallback of `serve` stays
  as it is.
- The relay's `verifyToken` returns null for a token with any `via` claim.
- The integration test walks every served route with a marked token, like protect-by-default's walk.
