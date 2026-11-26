---
id: "058"
title: Invite people to a room by @handle from a bar in the room, with suggestions, and they are told in Social
status: approved
features: [ROOM-055, API-052]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [room-lobby, notifications, api]
risk: high
contract_impact: api-major
---

## Problem

The owner wants a bar in the room where a member types handles (spec 057) and emails to invite people. Today the only way in is
to copy the room's link and send it oneself (specs 011, 044). This spec builds the bar, inviting by handle, and the invitation
in the invitee's activity; spec 059 adds email addresses. The owner kept rooms link-open: an invitation tells someone and takes
them to the room; it does not change who may join (decision 0008).

## Acceptance criteria

- AC-001 WHEN a member of a room sends `POST /api/v1/rooms/{roomId}/invites` with `{to: [...]}` (1–20 entries, each at most 320
  characters) THE SYSTEM SHALL answer 200 with one result per entry, in order: `invited` for a handle of a person who is not yet
  a member, `member` for one who already is, `self` for the caller's own handle, `not_found` for an unknown handle, `invalid`
  for an entry that is neither a handle nor an email address; a caller who is not a member, or an unknown room, answers 404
  `room.not_found`; more than 20 entries, or none, answers 400
- AC-002 WHEN a person is invited THE SYSTEM SHALL add a `room_invite` notification for them naming who invited them and the
  room's title, once per room and person in 24 hours however often they are invited; the activity page says "<name> invited you
  to <room>" with a Join button that opens the room's lobby, and the invitation shows as unread like the others
- AC-003 WHEN a caller has invited 50 people in the last hour THE SYSTEM SHALL refuse more with 429 `invite.rate_limited` and a
  `retry-after` header
- AC-004 WHEN a signed-in viewer sends `GET /api/v1/people?q=` with 1–30 characters THE SYSTEM SHALL answer up to 8 person
  profiles whose handle starts with the text (a leading `@` ignored) or whose name contains it, each with only id, handle, name
  and kind, handles that start with it first
- AC-005 WHILE a member is in the room's lobby THE SYSTEM SHALL show, under Invite people, a field labelled "Invite by @handle
  or email" where typing offers matching people (name and @handle, chosen with the arrow keys and Enter or by a click), Enter,
  comma or space turns the text into a chip, each chip can be removed, and Send invites sends them and then says, beside each
  entry, what happened; an entry that failed stays as a chip marked with its reason

## Out of scope

- Inviting by email (spec 059), invite-only rooms, revoking an invitation, invitations to a broadcast.

## Notes for the planner

- `room_invites`: one row per invitation (`room_id`, `inviter_user_id`, `invitee_user_id` or, for spec 059, `email_sha256`,
  `created_at`), used for the 24-hour repeat rule and the rate limit across server replicas (a count in Postgres, not the
  in-memory limiter).
- `notifications` gets `room_id` (cascade with the room) and the kind `room_invite`.
- An entry is a handle when it is `@` plus a handle, or a bare handle; an email when it has one `@` with text on both sides and
  a dot after it (length capped before any pattern).
- **API-major:** the notification `kind` gains `room_invite`. A surface built before this spec, still open in a browser,
  shows an invitation as "<name> posted" linking to the inviter's profile until it reloads; nothing fails. New request fields
  are optional and every other change adds.
