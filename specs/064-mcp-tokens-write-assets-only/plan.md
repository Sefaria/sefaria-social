# Plan: 064 MCP tokens write Claude assets only

Source: `LINKED_PANELS_AND_ASSETS_PLAN.md` 7.1 and the "Token" default in section 2. Decision:
`docs/decisions/0015-claude-assets.md` (point 10).

## T-001 The marker on the server and the relay (AC-001 to AC-005)

- `server/auth/identity.ts`: `via` claim, optional, only `"mcp"`; any other value makes the token invalid.
- `server/http/mcp-routes.ts`: `MCP_ENDPOINTS` (`POST /api/v1/claude-assets`, `POST /api/v1/claude-assets/import`).
- `server/http/endpoint.ts`: `EndpointSpec.mcp`; `defineEndpoint` refuses `mcp: true` off the list; the `user` check refuses
  a marked identity (403 `auth.mcp_not_allowed`) unless the endpoint accepts it. `errors.ts` gains the code.
- `contracts.ts`: the two save endpoints say `mcp: true`.
- Relay `auth.ts`: a `via` claim makes the token invalid.
- Tests: `app/src/api.mcp-tokens.int.test.ts` (walks every route with a marked token), `server/auth/identity.test.ts`,
  `server/http/endpoint.test.ts`, relay test in `packages/relay/src/relay.test.ts`.
