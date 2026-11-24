# Plan: 039 a room's owner can mute a participant or remove them from the call

## T-001 the server (AC-001 to AC-005)

- **Endpoints** (`contracts.ts`, routes `rooms.$roomId.call.mute.ts`, `rooms.$roomId.call.remove.ts`), access `user`:
  `POST …/call/mute { participant, source: "microphone" | "camera" | "screen_share" }` and `POST …/call/remove { participant }`,
  both 204. Order of checks: calls available (else 503 `call.unavailable`), membership (404 `room.not_found`), owner (403
  `room.forbidden`), `participant` matches `^u:[1-9][0-9]{0,15}$` (else 404 `call.participant_not_found`, nothing called).
- **LiveKit** (`services/livekit.ts`): `muteTrack(roomId, identity, source)` reads the participant with `getParticipant`, finds
  the published track of that source and calls `mutePublishedTrack(…, true)`; `removeFromCall(roomId, identity)` calls
  `removeParticipant`. LiveKit's "not found" (not in the call, or no such track) becomes 404 `call.participant_not_found`.
- **Removal window**: new table `call_removals (room_id → rooms cascade, user_id, until)`, primary key `(room_id, user_id)`,
  index on `user_id` (migration `0004`). `remove` upserts `until = now() + 15 minutes`. The token endpoint (spec 033) answers 403
  `call.removed` while a removal holds. The deletion (`deleteUserData`) deletes the user's removals; the schema walk seeds it.
- Test: `app/src/api.moderation.int.test.ts`, a local server playing LiveKit's Twirp `GetParticipant`, `MutePublishedTrack` and
  `RemoveParticipant`.

## T-002 the call window (AC-006, AC-007)

- **Who owns the call**: the token's metadata carries the role (spec 033); the controller reads it from the token payload for
  display only (the server checks every action).
- **Tile menu**: for an owner, every other participant's tile gets a menu button with "Mute microphone" (if their microphone is
  on), "Turn off camera" (camera on), "Stop screen share" (sharing), and "Remove from call". The rooms API gains
  `moderate(roomId, action, participant, source?)`. Nobody else sees a menu.
- **What the muted and the removed see**: the media seam gains `onMutedByHost(cb)` (LiveKit's `TrackMuted` on a local track the
  viewer did not mute); the panel says "The host muted you" until the viewer turns the microphone on again. Removal already
  ends the call with "You were removed from the call" (spec 034's `removed` reason), and the room is untouched.
- Test: `surface/call-moderation.test.tsx` (jsdom, fake engine with `muteByHost` and a removal disconnect).
