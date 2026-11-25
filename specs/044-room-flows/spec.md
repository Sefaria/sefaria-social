---
id: "044"
title: People start, find, invite to, rename, delete and leave rooms from the interface
status: draft
features: [ROOM-046, ROOM-047, ROOM-048, ROOM-049, ROOM-050]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, rooms, room-lobby, recording]
risk: high
contract_impact: none
---

## Problem

The rooms API can create, list, rename, delete, join and leave rooms, but social's interface offers only Join. Nobody can start a
room, see all the rooms they are in, send an invitation without copying the address bar, rename or delete a room they own, or
leave one they joined. Calls, recording, replay and broadcast all hang off a room, so none of them can be tried from the interface
alone. Design: `docs/design/room-flows.md`.

## Acceptance criteria

- AC-001 WHEN a signed-in person presses Start a room (on the home rail, the rooms page, or an empty state) THE SYSTEM SHALL ask
  for a name (required, at most 120 characters, Start disabled while it is blank), create the room with `POST /api/v1/rooms`, and
  open its lobby, where the person is the owner; a failed create SHALL keep the dialog open and say "The room could not be
  created."; Cancel or Escape SHALL close it and return focus to the button
- AC-002 WHEN a signed-in person opens `/social/rooms` (social's navigation has a Rooms item) THE SYSTEM SHALL list every room
  they are a member of from `GET /api/v1/rooms`, newest first, each with its title, "Owner" or "Member", and a link to its lobby,
  plus Start a room; with none it SHALL say "You are not in any room yet."; signed out it SHALL ask them to sign in
- AC-003 WHEN a member opens a room's lobby THE SYSTEM SHALL show "Invite people" with the room's full link, Copy (announcing
  "Copied") and the Share menu, and say whether the viewer owns the room or is a member
- AC-004 WHEN the owner renames the room in the lobby's room settings THE SYSTEM SHALL save it with `PATCH /api/v1/rooms/:id`
  and show the new title; Save SHALL be disabled for a blank name and a failure SHALL say "The name could not be saved."
- AC-005 WHEN the owner presses Delete room THE SYSTEM SHALL ask "Delete “Title”? Its recordings will be deleted too, and no one
  will be able to open it." and, on Delete, close any session of that room in this browser, delete it with `DELETE
  /api/v1/rooms/:id`, and open `/social/rooms` saying "“Title” was deleted."
- AC-006 WHEN a member who is not the owner presses Leave room THE SYSTEM SHALL ask "Leave “Title”? You can come back with its
  link." and, on Leave, close any session of that room in this browser, leave with `DELETE /api/v1/rooms/:id/members/me`, and open
  `/social/rooms` saying "You left “Title”."; the owner SHALL not be offered Leave
- AC-007 WHEN the home rail is shown to a signed-in person THE SYSTEM SHALL offer Start a room and a link to all their rooms; WHEN a
  recording's page is shown THE SYSTEM SHALL link back to its room's lobby

## Out of scope

- A member list, removing members, public or discoverable rooms, starting a room from the reader at the current text, scheduling
  shiurim (no endpoints exist for these; see the design's follow-ups).

## Notes for the planner

- No API change: `features/api/rooms-api.ts` gains `list`, `create`, `rename`, `remove`, `leave` over the existing endpoints.
- Two route trees (file routes and `surface/route-tree.tsx`) both get `/social/rooms` through `SOCIAL_PATHS.rooms`.
- Risk is high only because T-001 maps the new and the unmapped feature folders in `factory/surface-map.yaml` (a protected
  path): `rooms`, `call`, `recording`, `broadcast`.
- Closing a live session uses the room controller's existing leave; the call controller leaves the room's call if it is in it.
