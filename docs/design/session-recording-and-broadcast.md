# Sefaria Social: recording a live session, and broadcasting one (architecture spec, draft)

Status: draft for the owner's review, written 2026-11-24 with specs 041–043. Builds on the live session (specs 009–014) and the
call (specs 033–040, `docs/design/audio-video.md`).

## 1. The ask

1. **Record a live session.** While a room's session runs, record what the session shows (the reader's state: the text, the
   scroll, the panels) together with the call's audio and video. The result is a shared asset: the room's members open it, and
   it plays back inside the reader, with play, pause, seek and speed, and they can leave the recording to read around and come
   back to it.
2. **Broadcast.** A host shares live to people who only watch. Viewers see the host's reader move and hear and see the host;
   they send nothing back: no state, no presence, no voice, no video, no control.

## 2. The answer in one paragraph

A recording is two tracks on one clock: the **state track** (the reader's own `Recording` v1 format: keyframes and changes,
`t` in milliseconds) and the **media track** (one WebM file: the call's mixed audio and a composited video). Both are captured
**in the recorder's browser** (the room owner's), uploaded in chunks while the session runs, and kept **in Postgres** behind a
`RecordingStore` seam, because Social has no object storage and no LiveKit Egress today; both can be swapped in later without
changing the format or the player. Playback runs in the persistent mount, like the call: the video plays in the same floating
window, the **video element is the clock**, and the reader is driven through the one API a surface has for this,
`host.reader.state.applySnapshot(…, { origin: "playback", persist: false })`. A **broadcast** is a session with one publisher and
read-only viewers: its own relay room (`b_<id>`) that admits a socket only with a server-signed **broadcast ticket** naming the
role, and drops everything a viewer sends except what it needs to receive (`join`, `hello`, `resync`); and its own LiveKit room
whose viewer tokens cannot publish and are hidden. Recording a broadcast is the same recorder.

## 3. Where it sits

```
 recorder's browser (room owner)                        Social server (app, Postgres)                 other members' browsers
 ┌──────────────────────────────────────┐   PUT media chunk   ┌─────────────────────────────┐   GET list / state / media
 │ reader ── host.reader.state ──► state │ ──────────────────► │ /api/v1/recordings/…        │ ◄──────────────────────────
 │                 writer (t, keyframes) │   POST state batch  │  session_recordings          │
 │ call (LiveKit) ── tracks ──► mixer +  │ ──────────────────► │  recording_media_chunks      │   replay in the reader:
 │        tile videos ─► canvas compositor│   POST finish       │  recording_state_chunks      │   <video> clock ─► fold ─►
 │          └──► MediaRecorder (WebM)     │                     │  (RecordingStore: Postgres)  │   host.reader.state.apply
 └──────────────────────────────────────┘                     └─────────────────────────────┘

 broadcast:  host ──(ticket role=host)──► relay room b_<id> ──► viewers (ticket role=viewer; their sends are dropped)
             host ──(token canPublish)──► LiveKit bcast_<id> ──► viewers (token canPublish=false, hidden=true)
```

### 3.1 Why capture in the browser and not with LiveKit Egress

Egress is the production-grade answer (a server records the room, nothing depends on one tab), but it needs an Egress service and
a bucket, neither of which exists (`docs/design/audio-video.md` §7; `app/scripts/release/storage.ts` has a stub bucket target).
Capture in the owner's browser works on every deployment we have today, including Coolify previews, and produces the same two
tracks. The cost is known and stated in the UI: closing the recorder's tab ends the recording (what was uploaded is kept), and a
backgrounded tab may freeze the video track (browsers throttle timers) while audio continues. **Seam:** the server only receives
chunks and a finish; an Egress job that writes the same chunks (or a bucket key) replaces the browser recorder without touching
replay.

### 3.2 Why Postgres and not a filesystem

The app container is replaced on every deploy (Coolify, later GKE), so a filesystem needs a volume we do not have; Postgres is
already there, backed up, and covered by the user-deletion walk. Chunks are at most 4 MB (`bytea`), a recording at most 2 hours
and 700 MB. `RecordingStore` (`app/src/server/services/recording-store.ts`) has one implementation now (`postgresStore`) and is
the place an object store goes later (`shiur_recordings.storage_key` already anticipates one).

### 3.3 Why the reader's `Recording` format

`packages/session` already carries the reader's stream types, schema, `fold` and stream writer (copied from reader-next). Using
`Recording` v1 unchanged means: the state track validates with the reader's own schema; it can be downloaded and loaded into
reader-next's own "Load recording…" player; and Social's player can reuse `snapshotAt` semantics (last keyframe at or before `t`,
fold the changes after it).

## 4. Recording

### 4.1 Who, and consent

- Only the room's **owner** may start and stop a recording (the owner already moderates the call, spec 039).
- While a room is being recorded, everyone in it is told, everywhere they meet it: a red **Recording** badge in the call window,
  the phone strip and the pill; a line in the lobby; a notice in the pre-join step ("This call is being recorded"). The badge is
  driven by the room's `recording` field (lobby, status) and by LiveKit room metadata `{ recording: true }`, which the server sets
  on start and clears on stop, so clients in the call learn it at once.
- The feature is off when `RECORDINGS_ENABLED=false` (default on outside production, see §9 D-REC1).

### 4.2 The clock

`t0` is the moment the `MediaRecorder` starts. The state writer is created at the same moment with `now = () => performance.now()

- t0`, so a state message's `t`and the media's`currentTime * 1000` are the same timeline. The media track always spans the whole
  recording: when there is no call, or the recorder is not in it, the compositor draws a card (room title, "No call") and the mixer
  is silent, so the clock never runs out early.

### 4.3 State track

- Writer: `createStreamWriter` from `@sefaria-social/session` over the room's outgoing reader view (`features/session/room-reader.ts`:
  moment slices only, `ctx` stripped, `/social` pages never published). Keyframe at start, every 10 s or 50 changes, and at stop.
- Upload: batches every 5 s, `POST /api/v1/recordings/:id/state { messages }`, at most 256 KB per batch. The server checks each
  message with the session schema and that `seq` continues from the last one stored.

### 4.4 Media track

- **Audio:** a Web Audio graph mixes every audio track in the call (`CallMedia.audioTracks()`, new: remote tracks plus the local
  microphone) into one `MediaStreamAudioDestinationNode`. Tracks are added and removed as people join and leave.
- **Video:** a 640×360 canvas at 15 fps. The compositor draws the tiles the recorder's own window shows (each tile registers its
  `<video>` element in `features/av/tile-registry.ts`), in a grid of up to four, with names and the speaking ring; participants
  without video are drawn as initials. Drawn with a timer, not `requestAnimationFrame`, so a hidden tab slows it rather than
  stopping it.
- **Encoder:** `MediaRecorder(canvas.captureStream(15) + mixed audio)`, `video/webm;codecs=vp8,opus` (falls back to the first
  supported of `video/webm`, `video/mp4`), 600 kbps video, 64 kbps audio, `timeslice` 5 s. Each `dataavailable` blob is uploaded
  as the next chunk: `PUT /api/v1/recordings/:id/media/:seq` (octet-stream, ≤ 4 MB). A failed upload retries three times with
  backoff, then the recording stops with an error and keeps what was stored.

### 4.5 Lifecycle and data

```
session_recordings  id uuid pk · room_id → rooms (cascade) · owner_user_id · title · status recording|ready|failed
                    · mime · started_at · finished_at · duration_ms · media_bytes · state_messages · created_at
recording_media_chunks  recording_id → session_recordings (cascade) · seq int · bytes bytea · pk (recording_id, seq)
recording_state_chunks  recording_id → session_recordings (cascade) · seq int (first message seq) · messages jsonb
```

- `POST /api/v1/rooms/:roomId/recordings` (owner) → `201 { id }`, status `recording`; 409 when the room already has one running.
- `POST /api/v1/recordings/:id/finish { durationMs }` (the recorder) → `ready`.
- A recording whose last upload is more than 2 minutes old is finalised on read (`ready` with what arrived; duration from the
  last state message). A recording with no media and no state is deleted then.
- `GET /api/v1/rooms/:roomId/recordings` (members): newest first. `GET /api/v1/recordings/:id` (members of its room): metadata.
  `GET /api/v1/recordings/:id/state`: the `Recording` v1 document (also the download). `GET /api/v1/recordings/:id/media`: the
  media file, chunks in order, `Content-Type` the recorded mime. `DELETE /api/v1/recordings/:id` (owner of the recording or the
  room).
- User deletion: a deleted user's recordings are deleted (the schema walk covers `owner_user_id`).

## 5. Replay in the reader

- **Where:** a recording's page `/social/rec/:id` (title, date, length, Play, Download state, Delete) and the lobby's
  "Recordings" list. **Play** navigates the reader to the recording's first `url` with `ctx=social.rec.<id>`; the persistent mount
  sees that context and opens the player, so a reload or a copied link restores it (paused at the start).
- **The window:** the call's floating window (`CallFrame`, the same geometry, sizes, snapping and keyboard rules as spec 035; the
  strip on phones, spec 037) shows the recorded video, with a transport bar: play/pause, a scrubber with the keyframes marked,
  back/forward 10 s, speed 1×, 1.5×, 2×, and Close. A replay and a live call never share the window: opening one asks to close the
  other.
- **Loading:** the media is fetched with the viewer's token as one blob (a progress bar while it loads; `<video>` cannot send our
  bearer token), its WebM duration is written into the header (`fix-webm-duration`) so seeking works, and it plays from an object
  URL. The state track is fetched once and parsed with the session schema.
- **Driving the reader:** on every `timeupdate`/`seeked` and on a 250 ms timer while playing, the player computes `snapshotAt(t)`
  and, when it differs from the last applied one, calls `host.reader.state.applySnapshot(snapshot, { origin: "playback", persist:
false })`, one at a time (newer requests collapse). Personal settings are never in the track (moment scope), so a replay never
  changes the viewer's language or layout preferences.
- **Leaving the recording:** local input in the reader (`onLocalInput`) detaches the reader: the media keeps playing, the bar
  says "You left the recording" with **Back to the recording**, which applies the current point. Pause pauses both. Close stops
  the media, drops `ctx` and leaves the reader where it is.

## 6. Broadcast

### 6.1 Model

- A **broadcast** belongs to a room and is started by its owner: `POST /api/v1/rooms/:roomId/broadcasts` → `{ id, link }`;
  `POST /api/v1/broadcasts/:id/end`. Table `broadcasts`: `id, room_id, host_user_id, title, status live|ended, started_at,
ended_at`. One live broadcast per room.
- **Who may watch:** anyone signed in who has the link `/social/b/:id` (not only room members: that is the point of a broadcast).
  Signed-out visitors are asked to sign in.
- **What a viewer gets:** the host's reader, followed (break away and come back, as when following in a room), the host's audio
  and video in the floating window, and the number watching. Nothing else.

### 6.2 Enforcement on the server side

- **Ticket:** `POST /api/v1/broadcasts/:id/ticket` returns `{ ticket, role, relayRoom, expiresAt }`. The ticket is
  `base64url(JSON { b, sub, role, exp }) + "." + base64url(HMAC-SHA256(RELAY_INTERNAL_SECRET, payload))`, valid 10 minutes, role
  `host` for the broadcast's host and `viewer` for everyone else, refused when the broadcast has ended.
- **Relay:** a room id starting `b_` is a broadcast room. The Worker requires a ticket in `Sec-WebSocket-Protocol`
  (`ticket.<ticket>`) besides the identity token, checks the signature, expiry, room and that `sub` is the token's user, and
  passes the role to the room object with the identity. In the room object, a viewer's `join` is rewritten to `{ isHost: false,
canLead: false }` and a host's to `{ isHost: true, canLead: true }`; a viewer's messages other than `control.join`,
  `control.leave`, `state.hello` and `state.resync` are dropped before the room sees them; and the participants list a viewer
  receives lists the host only (viewers do not see each other). Ordinary rooms are unchanged.
- **LiveKit:** room `bcast_<id>`. `POST /api/v1/broadcasts/:id/call/token`: host → publish grant (as a call owner); viewer →
  `canPublish: false, canPublishData: false, canSubscribe: true, hidden: true`.

### 6.3 Client

- Host: the lobby's **Broadcast** button starts one and shows the link; the host's reader publishes to `b_<id>` (a second
  session connection, spotlight held by the host) and the host joins `bcast_<id>` with the call's pre-join step. **End broadcast**
  ends both. The host may record the broadcast with the same recorder.
- Viewer: `/social/b/:id` shows the title and **Watch**; Watch navigates to the host's current text with
  `ctx=social.watch.<id>`, connects as viewer, follows the host, and joins the LiveKit room with no devices (no pre-join, no mic
  or camera controls; the window has volume and Leave). When the broadcast ends, viewers see "The broadcast has ended".

## 7. Code layout

```
app/src/server/services/recordings.ts        create, append state/media, finish, list, read, delete, finalise-on-read
app/src/server/services/recording-store.ts   RecordingStore + postgresStore
app/src/server/services/broadcasts.ts        start, end, ticket, call token
app/src/server/broadcast-ticket.ts           sign/verify (shared shape with the relay)
app/src/routes/api/v1/rooms.$roomId.recordings.ts, recordings.$recordingId*.ts, rooms.$roomId.broadcasts.ts, broadcasts.$broadcastId*.ts
app/src/features/recording/  recorder.ts (state writer + uploads), compositor.ts, mixer.ts, recording-controller.ts,
                             RecordButton.tsx, RecordingBadge.tsx, RecordingsList.tsx, RecordingPage.tsx
app/src/features/replay/     player.ts (clock + snapshotAt + apply queue), replay-controller.ts, ReplayWindow.tsx, Transport.tsx
app/src/features/broadcast/  broadcast-controller.ts, BroadcastPanel.tsx, WatchPage.tsx
app/src/routes/social.rec.$recordingId.tsx, social.b.$broadcastId.tsx
packages/relay/src/ticket.ts, packages/relay/src/broadcast.ts (viewer filter)
```

## 8. Out of scope for the first version

LiveKit Egress and object storage (seams in §3.1–3.2); trimming, chapters and captions; recordings outside rooms (shiurim keep
`shiur_recordings` for later); public (signed-out) broadcasts; viewer chat or questions; Safari recording (its `MediaRecorder`
writes MP4, which the player plays but which is untested); recordings longer than 2 hours.

## 9. Decisions for the owner

- **D-REC1** Recording is on by default outside production (`RECORDINGS_ENABLED`), so previews can try it; production must opt
  in, after a consent and retention policy (minors, as D-AV4 for calls).
- **D-REC2** Retention: recordings are kept until deleted by their owner or the room's owner, or when the room is deleted. A
  default expiry (for example 90 days) is a one-line job later.
- **D-REC3** Who may watch a recording: the room's members. Sharing one beyond the room is a later spec.
- **D-BC1** Broadcast viewers are any signed-in user with the link, and their names are visible to the host only.
- **D-BC2** Browser capture now, Egress later (§3.1).

## 10. Work items

| Spec | What                                                                                        | Risk              |
| ---- | ------------------------------------------------------------------------------------------- | ----------------- |
| 041  | Record a room's session: tables, upload API, recorder (state + media), consent badges       | high (migration)  |
| 042  | Replay a recording in the reader: recording page, lobby list, player in the floating window | normal            |
| 043  | Broadcast to view-only viewers: tickets, relay viewer role, LiveKit viewer grants, Watch    | high (relay auth) |
