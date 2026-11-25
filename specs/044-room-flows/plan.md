# Plan: 044 room flows

Design: `docs/design/room-flows.md`.

## T-001 Rooms API client, Start a room, the rooms page (AC-001, AC-002, AC-007 rail)

- `features/api/rooms-api.ts`: `list()`, `create(title)`, `rename(id, title)`, `remove(id)`, `leave(id)` over the existing
  endpoints, each throwing `RoomsApiError(status)` on failure.
- `features/rooms/StartRoom.tsx`: the button and its dialog (`<dialog>`-like, labelled, Escape and Cancel close, focus returns),
  name input (`maxLength` 120), Start disabled while blank, navigate to `/social/r/$roomId` on success.
- `features/rooms/RoomsPage.tsx` and `routes/social.rooms.tsx` + `surface/route-tree.tsx` + `SOCIAL_PATHS.rooms`; flash message
  read from the router's history state (`roomsNotice`).
- `features/shell/SocialLayout.tsx`: Rooms nav item (signed in). `features/feed/Feed.tsx`: Start a room and All rooms in the rail.
- `factory/surface-map.yaml`: surfaces `rooms`, `call`, `recording`, `broadcast`.

## T-002 The lobby: invite, role, room settings, rename, delete, leave; Back to the room (AC-003 – AC-007)

- `features/room/InvitePanel.tsx`: the full link (`absoluteLink`), Copy with a polite "Copied", `ShareMenu`.
- `features/room/RoomSettings.tsx`: owner — rename form and Delete room with confirmation; member — Leave room with confirmation.
  Before deleting or leaving: `roomController.leave(roomId)` if that room is open, and the call controller's leave if its call is
  this room's. Then navigate to `/social/rooms` with `roomsNotice`.
- `RoomLobbyPage.tsx`: role line, InvitePanel, RoomSettings; the room id moves into the settings' details.
- `features/replay/RecordingPage.tsx`: "Back to the room" link.
- e2e `e2e/room-flows.spec.ts`: start → invite link → second person joins → rename → member leaves → owner deletes.
