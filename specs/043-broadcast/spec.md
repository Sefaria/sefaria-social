---
id: "043"
title: A room's owner broadcasts live to view-only viewers, who follow the reader and watch the host but send nothing back
status: draft
features: [API-050, SESS-066]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [api, session, room-lobby, relay]
risk: high
contract_impact: api-minor
---

## Problem

A live room session is two-way: everyone may lead, talk and be seen, and the relay admits anyone who holds the room's id. A
teacher who wants to share a session with many people (a shiur, a class) needs the opposite: one host, and viewers who follow the
host's reader and watch and hear the host, without being able to move anyone, speak, appear, or even see who else is watching.
Hiding controls in the interface is not enough; the servers must refuse what a viewer sends. Design:
`docs/design/session-recording-and-broadcast.md` §6.

## Acceptance criteria

- AC-001 WHEN a room's owner posts `POST /api/v1/rooms/:roomId/broadcasts` THE SYSTEM SHALL start a broadcast and answer 201 with
  its id and link `/social/b/:id`; others SHALL get 403 (member) or 404; a second while one is live SHALL get 409; `POST
  /api/v1/broadcasts/:id/end` by its host SHALL end it
- AC-002 WHEN a signed-in user asks for a broadcast's ticket THE SYSTEM SHALL answer with a ticket signed with the relay secret
  naming the broadcast, the user, the role (`host` for its host, `viewer` for anyone else) and an expiry 10 minutes ahead; for an
  ended or unknown broadcast it SHALL answer 404
- AC-003 WHEN a socket connects to a broadcast relay room (`b_<id>`) THE SYSTEM SHALL require a valid ticket for that room and the
  token's user, and refuse it with 401 otherwise
- AC-004 WHILE a viewer is connected THE SYSTEM SHALL let through only its `join`, `leave`, `hello` and `resync`, make its join
  `isHost: false, canLead: false`, drop every other message it sends (state, presence, spotlight, raise-hand, mode, end), and send
  it a participants list that names the host only; the host's join SHALL be `isHost: true`
- AC-005 WHEN a user asks for a broadcast's call token THE SYSTEM SHALL grant its host publishing as a call owner, and a viewer
  `canPublish: false`, `canPublishData: false`, `canSubscribe: true`, `hidden: true`
- AC-006 WHEN the owner presses Broadcast in the lobby THE SYSTEM SHALL start it, show the link with Copy, publish the owner's
  reader to the broadcast room and offer to join its call; End broadcast SHALL end the session and the call
- AC-007 WHEN a signed-in user opens `/social/b/:id` and presses Watch THE SYSTEM SHALL take the reader to the host's text with
  `ctx=social.watch.<id>`, follow the host (breaking away on local input, with "Back to live"), show the host's audio and video in
  the floating window with no microphone or camera controls, and the number watching; signed out, it SHALL ask to sign in
- AC-008 WHEN the broadcast ends THE SYSTEM SHALL tell viewers "The broadcast has ended" and stop following and the media

## Out of scope

- Signed-out viewers, viewer chat or questions, more than one host, recording a broadcast separately from the room's recorder.

## Notes for the planner

- Ticket sign/verify: `app/src/server/broadcast-ticket.ts` and `packages/relay/src/ticket.ts`, same format, HMAC-SHA256 with
  `RELAY_INTERNAL_SECRET` (Web Crypto in both). Relay changes only in `packages/relay/src/` (not `wrangler.toml`).
- Migration `0006_broadcasts` (expand only). The schema walk covers `host_user_id`.
- The session client takes `canPublish: false` already; the viewer's socket adds `ticket.<ticket>` to its subprotocols.
