# Plan: 043 broadcast to view-only viewers

Design: `docs/design/session-recording-and-broadcast.md` §6.

## T-001 Broadcasts, tickets and call grants on the server (AC-001, AC-002, AC-005)

- Migration `0006_broadcasts.sql` (expand only): `broadcasts (id uuid pk, room_id → rooms cascade, host_user_id bigint, title,
  status live|ended, started_at, ended_at)`, partial unique index on `room_id where status = 'live'`.
- `server/broadcast-ticket.ts`: `signTicket({ b, sub, role, exp }, secret)` / `verifyTicket(ticket, secret, now)`; payload and
  signature base64url, HMAC-SHA256 with Web Crypto (the relay uses the same code shape).
- `services/broadcasts.ts`: `startBroadcast` (room owner, one live), `endBroadcast` (host), `getBroadcast` (signed-in; title,
  host name, status, viewers from the relay status), `broadcastTicket` (role by user; 404 when ended; 503 without a relay secret),
  `broadcastCallToken` (`services/livekit.ts` `mintBroadcastToken`: host publishes, viewer `canPublish: false, canPublishData:
  false, canSubscribe: true, hidden: true`; room `bcast_<id>`).
- Routes: `rooms.$roomId.broadcasts.ts` (POST), `broadcasts.$broadcastId.ts` (GET), `broadcasts.$broadcastId.end.ts`,
  `broadcasts.$broadcastId.ticket.ts`, `broadcasts.$broadcastId.call.token.ts`. Contracts, OpenAPI, client. Deletion and the
  schema walk cover `host_user_id`.
- Tests: `app/src/api.broadcasts.int.test.ts`.

## T-002 The relay enforces the viewer role (AC-003, AC-004)

- `packages/relay/src/ticket.ts`: `ticketFromProtocols`, `verifyTicket` (same format as the server).
- `packages/relay/src/worker.ts`: for a room id starting `b_`, require a ticket for that room and the token's user, else 401; pass
  the role in `X-Relay-Role`. `packages/relay/src/broadcast.ts`: `admitFromViewer(text)` (only `control.join`, `control.leave`,
  `state.hello`, `state.resync`), `withRole(text, role)` (join flags), `forViewer(envelope, hostId)` (participants list with the host
  only). The `Room` object applies them per connection.
- Tests: `packages/relay/src/broadcast.test.ts` (pure filters) and cases in `relay.test.ts` (Miniflare: refused without a ticket,
  viewer cannot take the spotlight or publish).

## T-003 Broadcasting and watching in the surface (AC-006, AC-007, AC-008)

- `features/session/sessions.ts`: a connection may carry extra subprotocols (the ticket) and `canPublish`.
- `features/broadcast/broadcast-controller.ts` (host: start, publish the reader to `b_<id>` holding the spotlight, end; viewer:
  watch, follow the host with break away and "Back to live", ended), `BroadcastPanel.tsx` (lobby: Broadcast, link with Copy,
  viewers, End), `WatchPage.tsx` and route `social.b.$broadcastId.tsx`, persistent-mount bar for the viewer.
- Calls: `call-controller.ts` gains a token source and a `viewer` mode (no pre-join, no devices, controls hidden); the broadcast
  uses it with `bcast_<id>`.
- Strings in English and Hebrew. Tests: `features/broadcast/*.test.ts(x)`; `e2e/broadcast.spec.ts` with two browsers.
