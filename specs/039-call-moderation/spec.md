---
id: "039"
title: A room's owner can mute a participant or remove them from the call
status: proposed
features: [API-048, SESS-063]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [session, api]
risk: high
contract_impact: api-minor
---

## Problem

In a call, one open microphone with a television behind it, or one unwelcome person, ruins it for everyone. Rooms today let
anyone lead the reading (decision 0008), and nobody can silence or remove anyone. A room's owner needs to mute a participant's
microphone, camera or screen share, and remove someone from the call, without the power to do that being in every browser.

## Acceptance criteria

- AC-001 WHEN a room's owner calls `POST /api/v1/rooms/{roomId}/call/mute` with `{ participant, source }` (source one of
  microphone, camera, screen_share) THE SYSTEM SHALL mute that participant's track of that source through LiveKit's server API
  and answer 204
- AC-002 WHEN a room's owner calls `POST /api/v1/rooms/{roomId}/call/remove` with `{ participant }` THE SYSTEM SHALL remove the
  participant from the call through LiveKit's server API, answer 204, and keep them a member of the room
- AC-003 WHEN a removed user asks for a call token for that room within 15 minutes of removal THE SYSTEM SHALL answer 403
  with error code `call.removed`
- AC-004 WHEN the caller is a member but not the owner THE SYSTEM SHALL answer 403; WHEN not a member, 404; WHEN calls are not
  available, 503 as for the token
- AC-005 WHEN `participant` is not `u:<id>` of someone currently in that room's call THE SYSTEM SHALL answer 404 and call nothing
- AC-006 WHILE the viewer owns the room THE SYSTEM SHALL show on every other participant's tile a menu with "Mute microphone",
  "Turn off camera", "Stop screen share" and "Remove from call" (each only when it applies), and to others no such menu
- AC-007 WHEN a participant is muted by the owner THE SYSTEM SHALL tell them "The host muted you" and let them unmute
  themselves; WHEN removed, their window SHALL say "You were removed from the call" and they stay in the room

## Out of scope

- Blocking someone from the room, reporting to Sefaria staff, co-hosts. These belong to the moderation work that blocks P7
  (owner decision D-AV3).
- Muting everyone at once.

## Notes for the planner

- `RoomServiceClient.mutePublishedTrack(room, identity, trackSid, true)` needs the track sid: look it up with
  `getParticipant(room, identity)`. `removeParticipant(room, identity)`. `[CHECK]` current SDK names.
- New table `call_removals (room_id → rooms, user_id, until)`, indexed, covered by the deletion walk (spec 038 AC-006); the
  token endpoint (spec 033) checks it.
- The owner is the `room_members` row with role `owner`; ownership is checked on the server for every call.
