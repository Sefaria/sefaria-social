---
id: "041"
title: A room's owner records the live session, its reader state together with the call's audio and video
status: draft
features: [API-049, SESS-064]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [api, session, room-lobby, identity]
risk: high
contract_impact: api-minor
---

## Problem

A room's session is gone when it ends: the reader moved through a text while people talked, and nothing of it can be watched
again. The reader already records its own state (reader-next's `recording` lab, the `Recording` v1 format), but not a shared
session and not with the call. Learners who missed a session, or want to go back over it, need a recording that keeps the text
and the voices together. Recording people needs their knowledge: everyone in the room must see that it is being recorded.
Design: `docs/design/session-recording-and-broadcast.md` §4.

## Acceptance criteria

- AC-001 WHEN a room's owner posts `POST /api/v1/rooms/:roomId/recordings` THE SYSTEM SHALL create a recording with status
  `recording` and answer 201 with its id; a member who is not the owner SHALL get 403, a non-member 404, a second start while one
  is recording 409 `recording.already_running`, and with `RECORDINGS_ENABLED=false` 503 `recording.unavailable`
- AC-002 WHEN the recorder uploads media chunks (`PUT /api/v1/recordings/:id/media/:seq`, at most 4 MB) and state batches
  (`POST /api/v1/recordings/:id/state`) THE SYSTEM SHALL store them in order; a chunk out of order, too large, from anyone but the
  recorder, or after the recording finished SHALL be refused with nothing stored; a state message that fails the session schema,
  or whose `seq` does not continue the stored ones, SHALL refuse the batch
- AC-003 WHEN the recorder posts `POST /api/v1/recordings/:id/finish { durationMs }` THE SYSTEM SHALL mark it `ready` with that
  duration; WHEN a recording has had no upload for 2 minutes THE SYSTEM SHALL treat it as `ready` with what arrived when it is
  next read (and delete it if nothing arrived)
- AC-004 WHEN a room member lists the room's recordings or reads one THE SYSTEM SHALL return them newest first with title, start,
  duration, status and owner; `GET …/state` SHALL return a document that parses as the reader's `Recording` v1; `GET …/media`
  SHALL return the media chunks concatenated in order with the recorded content type; non-members SHALL get 404
- AC-005 WHEN the recording's owner or the room's owner deletes a recording THE SYSTEM SHALL remove it with its chunks; anyone
  else SHALL get 403; WHEN a user is deleted their recordings SHALL be removed, and the deletion walk SHALL find no rows for them
- AC-006 WHILE a room is being recorded THE SYSTEM SHALL say so to everyone in it: the room's read and status include
  `recording: true`, the lobby shows "Recording", the call window, strip and pill show a Recording badge, and the pre-join step
  says the call is being recorded; WHEN the recording stops all of these SHALL disappear
- AC-007 WHEN the owner presses Record in the lobby or the call window THE SYSTEM SHALL start the recorder in the owner's
  browser: one clock for state and media, a state keyframe at the start, media chunks every 5 seconds containing the call's mixed
  audio and a composited video of the visible tiles (a card when there is no call), and Stop SHALL upload the last chunk and a
  final keyframe and finish the recording
- AC-008 WHEN an upload fails three times in a row THE SYSTEM SHALL stop recording, tell the owner, and keep what was stored

## Out of scope

- LiveKit Egress and object storage (seams in the design §3.1–3.2). Recording by anyone but the room's owner.
- Replay (spec 042). Broadcast (spec 043). Trimming, chapters, captions. Recordings longer than 2 hours or 700 MB (refused).

## Notes for the planner

- Migration `0005_session_recordings` (expand only): `session_recordings`, `recording_media_chunks`, `recording_state_chunks`.
  `bytea` chunks; the store sits behind `RecordingStore` (`services/recording-store.ts`).
- LiveKit room metadata `{ recording }` through `RoomServiceClient.updateRoomMetadata`, best effort (no call, no update).
- `CallMedia.audioTracks()` (new, both engines); tiles register their `<video>` in `features/av/tile-registry.ts`.
- The state writer is `createStreamWriter` from `@sefaria-social/session` over `room-reader.ts`'s outgoing view.
