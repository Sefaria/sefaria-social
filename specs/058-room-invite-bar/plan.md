# Plan: spec 058

## Approach

- Migration: `room_invites` and `notifications.room_id`.
- `server/services/invites.ts`: `classifyEntry` (handle, email, invalid), `inviteToRoom(identity, roomId, to)` (member check,
  hourly count, handles resolved through `profiles`, membership, the 24-hour rule, notification in the same transaction).
  Email entries answer `invalid` until spec 059 (its own branch here).
- `server/services/people.ts`: the search (prefix on `lower(handle)`, `ilike` on name, `%` and `_` escaped).
- Notifications: kind `room_invite` with the room's id and title in the DTO.
- Client: `InviteBar.tsx` under the link in `InvitePanel` (combobox with a listbox of suggestions, chips, results), the
  `room_invite` sentence and Join in the activity page.

## Tests

`api.invites.int.test.ts` (L2) for AC-001..004; `invite-bar.test.tsx` and an activity test for AC-002 and AC-005 in jsdom;
the room journey in e2e invites a second user by handle and opens their activity.
