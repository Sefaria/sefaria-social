# Plan: 012 presence list

- `features/session/sessions.ts`: `acquire(roomId, reason)` returns a release function; the first hold opens a session
  client over the WebSocket transport, the last release stops it. `useRoomSession(roomId)` subscribes to it.
- `features/presence/PresenceList.tsx`: the list; strings in `features/shell/strings.ts`.

## Tests

- `features/presence/PresenceList.test.tsx` (AC-001..003, jsdom): the fake host, a fake WebSocket class installed on
  `globalThis` that records URLs and protocols and plays the room from `@sefaria-social/session`.
