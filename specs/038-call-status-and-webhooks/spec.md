---
id: "038"
title: Cards and the lobby show who is on a call, and a deleted account leaves every call
status: approved
features: [API-047, ROOM-045]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [api, room-lobby, feed, identity]
risk: high
contract_impact: api-minor
---

## Problem

A learner looking at a room's card or lobby cannot tell whether people are talking there right now, which is the main reason to
join. Cards must not open a socket to find out (PLAN 4.5), so the server has to know. LiveKit tells a server about joins, leaves
and finished rooms through signed webhooks. The same channel closes a gap in account deletion: when a Sefaria account is deleted,
that person must also be dropped from any call they are in.

## Acceptance criteria

- AC-001 WHEN LiveKit posts to `POST /api/v1/internal/livekit/webhook` THE SYSTEM SHALL verify the signature with the LiveKit
  API key and secret; WHEN it is missing or invalid it SHALL answer 401 and change nothing
- AC-002 WHEN the same webhook event (same event id) arrives twice THE SYSTEM SHALL apply it once, recorded in
  `webhook_receipts`
- AC-003 WHEN a `participant_joined`, `participant_left` or `room_finished` event for `room_<roomId>` is applied THE SYSTEM SHALL
  store that room's call status `{ live, participants, startedAt }` from the event's room information, never with fewer than 0
  participants, and with `live: false` after `room_finished`; events for rooms that do not exist SHALL be ignored
- AC-004 WHEN a member reads a room's status, or the feed lists a room, while the room's call is live THE SYSTEM SHALL include
  `call: { live: true, participants }`, and the lobby and room cards SHALL show "N on a call"; WHEN no call is live (or LiveKit
  is not configured) the field SHALL be absent, nothing SHALL show, and nothing errors
- AC-005 WHEN the user-deleted webhook for user U is handled THE SYSTEM SHALL remove identity `u:U` from every room where the call
  status is live, through LiveKit's server API; a failed removal SHALL be retried once and logged, and SHALL not stop the rest of
  the deletion
- AC-006 WHEN the deletion test walks the schema after deleting a user THE SYSTEM SHALL find zero rows for that user, including in
  any table this spec adds

## Out of scope

- Who is on the call by name (only a count). Recording and egress events.
- Using the call status to rank the feed.

## Notes for the planner

- `livekit-server-sdk` `WebhookReceiver.receive(body, authHeader)`; the raw body is needed for the signature.
  `[CHECK]` the event id field and the room information in each event (`numParticipants`).
- New table `call_status (room_id pk → rooms, live, participants, started_at, updated_at)`; no user ids, so the deletion walk
  has nothing to delete there. Migration expand-only.
- Status read: `app/src/server/services/rooms.ts` (spec 011) already joins the relay's status; add the call status beside it,
  with the same offline fallback. Cards: `features/feed` (spec 016).
- Deletion: `app/src/server/webhooks/user-deleted.ts`; `RoomServiceClient.removeParticipant(room, identity)`; a "not found"
  answer is success.
- The LiveKit webhook URL is configured in the LiveKit project (Cloud dashboard or server config): a setup checklist line.
