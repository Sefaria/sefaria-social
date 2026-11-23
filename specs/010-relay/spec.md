---
id: "010"
title: Room relay on Cloudflare with a token check, a status read and a drop for deleted users
status: approved
features: [SESS-010, IDENT-041, SESS-042, IDENT-043]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

Each room needs one place that orders its messages: a Cloudflare Worker with one Durable Object per room, as the reader's
follow relay already does (`reader-next/relay/`). The reader's relay checks only the Origin and the room id. Social's must
also know who is connecting (plan 6.1: the same Sefaria identity token the server accepts, verified from the JWKS, never
minted here), must give cards a cheap status read (plan 4.5, 6.4) and must drop a user whose account was deleted (plan 6.3).

## Acceptance criteria

- AC-001 WHEN a WebSocket upgrade arrives at `/r/<roomId>` from an Origin on `ALLOWED_ORIGINS` THE SYSTEM SHALL hand it to
  the Durable Object named after that room id, which runs the room from `@sefaria-social/session`, so two sockets in one
  room receive each other's presence; a path whose id does not match `^[A-Za-z0-9_-]{8,128}$` gets 404, a request without
  `Upgrade: websocket` 426, and any other Origin 403. The tests run in the Workers runtime (workerd through Miniflare).
- AC-002 WHEN an upgrade carries no token, or a token that fails verification against `JWKS_URL` (RS256 signature, `iss`
  equal to `TOKEN_ISSUER`, `aud` `sefaria-social`, not expired) THE SYSTEM SHALL answer 401 before any room sees it. The
  token is read only from `Sec-WebSocket-Protocol` (offered as `sefaria-social.v1, bearer.<token>`); a token in the URL is
  ignored, and an accepted socket answers with the subprotocol `sefaria-social.v1` alone.
- AC-003 WHEN a verified socket sends `join` THE SYSTEM SHALL replace the participant's `id` with the token's `sub` and
  `name` with the token's `name`, so nobody can join as someone else.
- AC-004 WHEN `GET /internal/status/<roomId>` is called with `Authorization: Bearer <RELAY_INTERNAL_SECRET>` THE SYSTEM
  SHALL answer `{ref, title, participants}`: `ref` and `title` from the `social.summary` slice of the spotlight holder's
  stream and `participants` the number joined, or `{ref: null, title: null, participants: 0}` for a room nobody is in; it
  does not otherwise read reader snapshots. Without the right secret it answers 401.
- AC-005 WHEN `POST /internal/drop-user` is called with the secret and `{userId, rooms}` THE SYSTEM SHALL close that user's
  sockets in those rooms and refuse that user's upgrades to any room for 30 minutes (longer than a token lives); without
  the right secret it answers 401 and drops nobody.

## Out of scope

- Deploying the relay (a human step on the setup checklist); membership checks (the room id is the invitation, spec 011).
- Rate limits beyond the room's own; hibernation (the room lives in memory, as in the reader).

## Notes for the planner

- `wrangler.toml` without account ids; secrets (`RELAY_INTERNAL_SECRET`) via `wrangler secret put`. `npm run relay:dev`
  runs it locally with `.dev.vars` (gitignored; an example file is committed).
- `@cloudflare/vitest-pool-workers` supports Vitest 4 only (this repo has Vitest 5): drive workerd with Miniflare from
  Node tests, bundling the Worker with esbuild; record the choice in `docs/decisions/`.
- Tombstones live in one Durable Object (`TOMBSTONES`, by name `global`) the Worker asks on every upgrade.
