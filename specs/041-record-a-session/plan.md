# Plan: 041 a room's owner records the live session

Design: `docs/design/session-recording-and-broadcast.md` §4.

## T-001 Recordings on the server (AC-001 – AC-006 server side)

- **Binary bodies.** `server/http/endpoint.ts`: an endpoint may declare `binaryBody: { maxBytes }` (the handler gets `bytes:
  Uint8Array`, 413 `request.too_large` over the cap, read after access is checked) and a response with `binary: true` (the handler
  returns `{ status, body: Uint8Array, contentType }` and the wrapper writes it as is). The OpenAPI generator describes both.
- **Tables.** Migration `0005_session_recordings.sql` (expand only): `session_recordings (id uuid pk default gen_random_uuid(),
  room_id → rooms on delete cascade, owner_user_id bigint not null, title text, status text check in (recording, ready, failed),
  mime text, started_at, finished_at, last_upload_at, duration_ms int, media_bytes bigint default 0, state_messages int default
  0, created_at)`, a partial unique index on `room_id where status = 'recording'`, `recording_media_chunks (recording_id →
  cascade, seq int, bytes bytea, pk(recording_id, seq))`, `recording_state_chunks (recording_id → cascade, first_seq int, last_seq
  int, messages jsonb, pk(recording_id, first_seq))`.
- **Store.** `services/recording-store.ts`: `RecordingStore { putMedia, mediaChunks, putState, stateMessages, remove }` and
  `postgresStore`.
- **Service.** `services/recordings.ts`: `startRecording` (owner, enabled, none running), `putMedia` (recorder, `recording`, next
  seq, ≤ 4 MB, total ≤ 700 MB), `putState` (session schema per message, seq continues), `finishRecording`, `listRecordings`,
  `getRecording`, `getRecordingState` (assembled `Recording` v1: `startedAt`, `duration`, `client: "sefaria-social"`, messages),
  `getRecordingMedia`, `deleteRecording`, `finaliseStale` (2 minutes since `last_upload_at`, on read), and `recordingOf(roomId)`
  for the room read and status. Starting and stopping set LiveKit room metadata `{ recording }` (`services/livekit.ts`
  `setRoomRecording`, best effort, logged on failure).
- **Config.** `RECORDINGS_ENABLED` (`"false"` turns it off; anything else, or unset, is on).
- **Routes.** `rooms.$roomId.recordings.ts` (GET list, POST start), `recordings.$recordingId.ts` (GET, DELETE),
  `recordings.$recordingId.finish.ts`, `recordings.$recordingId.state.ts` (GET, POST), `recordings.$recordingId.media.ts` (GET),
  `recordings.$recordingId.media.$seq.ts` (PUT). Contracts, OpenAPI and the generated client.
- **Rooms.** `getRoom` and `getRoomStatus` gain `recording: true` only while a recording runs (absent otherwise, so pinned
  responses are unchanged).
- **Deletion.** The user-deleted handler deletes `session_recordings` by `owner_user_id`; the schema walk lists the table.
- Tests: `app/src/api.recordings.int.test.ts` (AC-001 – AC-005, AC-006's `recording` field).

## T-002 The recorder in the owner's browser (AC-006 interface, AC-007, AC-008)

- `features/av/media.ts`: `CallMedia.audioTracks(): MediaStreamTrack[]`, and `subscribe` fires when tracks change; implemented in
  `livekit-engine.ts` (remote audio publications' tracks plus the local microphone) and `test-media.ts`.
- `features/av/tile-registry.ts`: `registerTileVideo(participantId, el)`; `Tiles.tsx` registers each tile's `<video>`.
- `features/recording/mixer.ts` (Web Audio mix that follows `audioTracks()`), `compositor.ts` (640×360 canvas, timer at 15 fps,
  grid of up to four registered tiles with names, initials otherwise, a title card without a call), `uploader.ts` (sequential
  PUT/POST with three retries and backoff), `recorder.ts` (`createSessionRecorder`: one clock, `MediaRecorder` with timeslice 5 s,
  state writer from `@sefaria-social/session` over the room's outgoing view, batches every 5 s, stop flushes), and
  `recording-controller.ts` (one per host: `start(roomId)`, `stop()`, `view()`; status from the room read; errors).
- Interface: `RecordButton.tsx` (owner only, in the lobby and the call window's controls), `RecordingBadge.tsx` (call window, strip,
  pill), the lobby line, the pre-join notice. Strings in English and Hebrew. `features/api/rooms-api.ts` gains the recording calls.
- Tests: `features/recording/recorder.test.ts` (fake MediaRecorder, canvas and uploads: AC-007, AC-008), `RecordingBadge.test.tsx`
  and `features/room/RoomLobbyPage.test.tsx` (AC-006).
