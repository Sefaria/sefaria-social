# Plan: 038 cards and the lobby show who is on a call, and a deleted account leaves every call

## T-001 LiveKit webhooks into a call status (AC-001, AC-002, AC-003)

- **Access.** `server/http/endpoint.ts` gains a third access kind, `livekit-webhook`: read the raw body (64 kB cap as today),
  verify it with `livekit-server-sdk`'s `WebhookReceiver` (the `Authorization` header is a JWT signed with the LiveKit API secret
  whose `sha256` claim is the body's hash). Not configured: 503 `webhook.unavailable`; missing or wrong: 401
  `webhook.bad_signature`. Verification lives in `services/livekit.ts` (`verifyWebhook`), the only `livekit-server-sdk` importer.
- **Route.** `POST /api/v1/internal/livekit/webhook` (`routes/api/v1/internal.livekit.webhook.ts`), body schema loose (the
  fields used: `event`, `id`, `room.name`, `room.numParticipants`), answer `{ status: "processed" | "duplicate" | "ignored" }`
  like Django's webhook.
- **Store.** New table `call_status (room_id uuid pk → rooms on delete cascade, live, participants, started_at, updated_at)`,
  migration `0003_call_status.sql` (expand only). No user ids, so the deletion walk has nothing to remove there.
- **Apply** (`services/calls.ts`): one transaction — the receipt in `webhook_receipts` (a repeated event id is `duplicate`), then
  for `room_started`, `participant_joined`, `participant_left` an upsert with `participants = max(0, room.numParticipants)` and
  `live = participants > 0`; for `room_finished` `live = false, participants = 0`. A room name that is not `room_<uuid of an
existing room>` is `ignored`. Other events are `ignored`.
- Test: `app/src/api.call-status.int.test.ts`, webhooks signed in the harness with the test key and secret (`h.livekitWebhook`).

## T-002 "N on a call" in the lobby and on cards (AC-004)

- `services/calls.ts` `callStatusOf(roomIds)`; `getRoomStatus` and the feed's live rooms gain `call: { live, participants }`
  only while the call is live (absent otherwise, so existing responses and the tests that pin them are unchanged). Contracts and the
  generated client are additive.
- `features/room/RoomLobbyPage.tsx` reads the status (a `getStatus` on the rooms API) and shows "N on a call"; `FeedCard` shows it
  on live rooms. Strings in English and Hebrew.
- Tests: the integration test above for the API; `features/room/RoomLobbyPage.test.tsx` and `features/feed/FeedCard.test.tsx`
  for the text.

## T-003 deletion removes the person from live calls (AC-005, AC-006)

- After the deletion commits (outside the transaction, like the relay drop), `removeFromLiveCalls(userId)` calls LiveKit's
  `RoomServiceClient.removeParticipant(room_<id>, u:<userId>)` for every room whose call status is live. Not found counts as
  done; a failure is retried once, then logged as `livekit.remove_failed` and the deletion still succeeds.
- Test: the integration test with a local HTTP server playing LiveKit's Twirp `RoomService/RemoveParticipant`; the existing
  schema walk proves no table keeps the user (AC-006), with `call_status` seeded.
