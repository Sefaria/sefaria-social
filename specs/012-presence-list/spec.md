---
id: "012"
title: Who is in the room, live, in the lobby and the mini view
status: proposed
features: [ROOM-012]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [room-lobby]
risk: normal
contract_impact: none
---

## Problem

A member opening a room's lobby, or sitting in the room with the reader, wants to see who else is there: who leads, who
follows whom, who stepped away. The room's presence channel already carries this (spec 009). The surface needs one
connection per joined room, opened only when something needs it (plan 4.5: a socket opens only on enlarge or for a session
the user has joined), with a fresh identity token on every connection (spec 010).

## Acceptance criteria

- AC-001 WHEN a member has a room's lobby open THE SYSTEM SHALL connect to `<relayOrigin>/r/<roomId>` offering
  `sefaria-social.v1` and `bearer.<a fresh identity token>` as subprotocols, and list every participant by name, marking
  who leads (the spotlight), whom each follows, and who is away, updating as the room changes.
- AC-002 WHEN the viewer appears in the list THE SYSTEM SHALL mark their entry as "you" and offer no way to follow
  themselves; every name is rendered with `dir="auto"` so Hebrew names read correctly.
- AC-003 WHEN the connection drops THE SYSTEM SHALL say the room is reconnecting and keep the last list until the room
  answers again; WHEN nothing needs the room any more (the lobby closed, no context, no live session) THE SYSTEM SHALL
  close the connection.

## Out of scope

- Following from the list (spec 014), avatars, presence on segments.

## Notes for the planner

- `app/src/features/session/sessions.ts`: one session per room id, reference-counted holds ("lobby", "context",
  "live"); the transport is the session package's WebSocket transport with a `protocols` callback that awaits
  `host.viewer.identityToken()`.
- `app/src/features/presence/PresenceList.tsx` reads the session client's state through `useSyncExternalStore`.
