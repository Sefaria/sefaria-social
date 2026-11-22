# Plan: 011 joining, status, CORS, deletion to the relay, lobby Join

- Server: `joinRoom`, `leaveRoom`, `getRoomStatus` contracts and services; route files
  `rooms.$roomId.members.ts`, `rooms.$roomId.members.me.ts`, `rooms.$roomId.status.ts`; `services/relay.ts` with timeout,
  one retry and fallback; the webhook handler collects the user's room ids before deleting and calls the relay after
  commit; CORS in `http/endpoint.ts` from `SOCIAL_ALLOWED_ORIGINS`.
- Surface: `features/api/` gives features an API client built from the host; `features/room/RoomLobbyPage.tsx` loads the
  room, shows Join for a non-member, and the title for a member.

## Tests

- `app/src/api.join.int.test.ts` (AC-001..005, real Postgres; a local HTTP server plays the relay's real internal routes).
- `app/src/features/room/RoomLobbyPage.test.tsx` (AC-006, jsdom, the fake host and a fake API client).
