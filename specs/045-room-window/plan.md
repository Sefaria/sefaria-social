# Plan: 045 the room stays with you, in a designed room window

## T-001 Stay in the room while reading around (AC-001, AC-002)

- `features/session/controller.ts` `onContext`: when expanded or detached and the context is gone, and the location is a reader
  page that is not the stored own place, `host.navigate(withCtx(href, room), { replace: true })` instead of `contextLost`.
- Tests in `features/session/stay-in-room.test.ts` and the two-browser journey `e2e/room-window.spec.ts`.

## T-002 The room window (AC-003 – AC-006)

- `features/session/RoomWindow.tsx` (+ `room-window.module.css`): the card and the pill, used by `FollowBar` and `MiniView`, with
  the room's title from `useRoomTitle(roomId)` (rooms API, cached), the status dot, the actions, the who-is-here count and list;
  collapsed state in sessionStorage (`social.roomWindow`), read and written in try/catch.
- Lobby: "Video calls are not turned on here." when the room says calls are not available.
