---
id: "011"
title: Joining a room from its link, the room status passthrough, and the lobby's Join
status: approved
features: [ROOM-011, API-045, IDENT-049, ROOM-044]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [room-lobby, api]
risk: high
contract_impact: api-minor
---

## Problem

A room's shareable address is its lobby, `/social/r/<roomId>` (R8). Someone who receives the link must be able to join, and
members must see what the room is learning. Rooms are private (spec 007): a non-member cannot read one. The room id is a
random UUID, so holding the link is the invitation. The surface runs on the reader's origin and calls the social API on
another one, so the API must answer browsers from the reader's origins (CORS). When an account is deleted, the relay must
drop that user too (plan 6.3).

## Acceptance criteria

- AC-001 WHEN a signed-in user calls `POST /api/v1/rooms/{roomId}/members` for an existing room THE SYSTEM SHALL make
  them a `member` if they are not one and respond 200 with the room and their role; calling it again changes nothing and
  answers the same; the owner gets the room with role `owner`; a room that does not exist gets 404 `room.not_found`.
- AC-002 WHEN a member who is not the owner calls `DELETE /api/v1/rooms/{roomId}/members/me` THE SYSTEM SHALL remove their
  membership and respond 204; the owner gets 403 `room.owner_cannot_leave`; a non-member gets 404 `room.not_found`.
- AC-003 WHEN a member calls `GET /api/v1/rooms/{roomId}/status` THE SYSTEM SHALL answer `{live, ref, title,
participants}` from the relay's internal status read (2 s timeout, one retry on a network error or 5xx), and
  `{live: false, ref: null, title: null, participants: 0}` when the relay is not configured or does not answer; a
  non-member gets 404 `room.not_found`.
- AC-004 WHEN the account-deletion webhook deletes a user THE SYSTEM SHALL, after the deletion has committed, ask the relay
  to drop that user from every room they were a member of; a relay failure is logged (`relay.drop_failed`) and does not
  undo the deletion or fail the webhook.
- AC-005 WHEN a request carries an `Origin` listed in `SOCIAL_ALLOWED_ORIGINS` THE SYSTEM SHALL answer its CORS preflight
  with 204 (no token needed) and add `Access-Control-Allow-Origin` with that origin to every API response; a request from
  any other origin gets no CORS headers.
- AC-006 WHEN a signed-in viewer opens the lobby of a room they are not a member of THE SYSTEM SHALL show a Join button;
  pressing it joins and then shows the room's title; a signed-out viewer pressing Join gets `host.viewer.requestSignIn()`
  (R17) and no API call; a room that does not exist shows the room-not-found message.

## Out of scope

- Invitations by email, room roles beyond owner and member, public rooms.
- The presence list and entering the room (specs 012, 013).

## Notes for the planner

- Contracts in `app/src/server/api/contracts.ts`, services in `app/src/server/services/rooms.ts`, the relay client in
  `app/src/server/services/relay.ts` (`RELAY_INTERNAL_URL`, `RELAY_INTERNAL_SECRET`), then `npm run api:generate`.
- CORS sits in the endpoint wrapper so every route gets it; the route-enumeration test keeps proving 401 for every method.
- The prove-red CI job needs Postgres for new integration acceptance tests (they load on the merge base's integration
  project).
- The lobby reaches the API through `@sefaria-social/api-client` with `host.config.apiOrigin` and
  `host.viewer.identityToken()`; component tests give it a fake client with the same methods.
