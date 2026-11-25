---
id: "042"
title: A recording plays back inside the reader, the video in the floating window driving the text
status: approved
features: [SESS-065]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [session, room-lobby]
risk: normal
contract_impact: none
---

## Problem

A recorded session (spec 041) is only useful if it plays back the way it happened: the voices and faces, and the text moving
with them. A video file alone loses the text; the reader's own recording loses the voices. Members need to open a recording,
play, pause and seek it, watch the reader follow along, wander off to read around, and come back to where the recording is.
Design: `docs/design/session-recording-and-broadcast.md` §5.

## Acceptance criteria

- AC-001 WHEN a room member opens the lobby THE SYSTEM SHALL list the room's ready recordings (title, date, length) with a link
  to each recording's page `/social/rec/:id`, which shows the title, date, length, Play, Download state and, for whoever may
  delete it, Delete
- AC-002 WHEN the member presses Play THE SYSTEM SHALL navigate the reader to the recording's first text with
  `ctx=social.rec.<id>` and open the player in the floating call window (the strip on a phone), loading the media with a progress
  indication and starting at 0
- AC-003 WHILE the recording plays THE SYSTEM SHALL keep the reader at the recorded state for the media's current time (the last
  keyframe at or before it, with the changes after it applied), through the reader state API with origin `playback` and without
  persisting, applying one state at a time
- AC-004 WHEN the member pauses, seeks with the scrubber or by 10 seconds, or changes speed (1×, 1.5×, 2×) THE SYSTEM SHALL do the
  same to the media and the reader together
- AC-005 WHEN the member reads around (local input in the reader) during playback THE SYSTEM SHALL stop moving the reader, keep the
  media playing, and offer "Back to the recording", which returns the reader to the recording's current point
- AC-006 WHEN the page is loaded with `ctx=social.rec.<id>` THE SYSTEM SHALL open the player paused at the start without playing
  by itself; WHEN the member closes the player THE SYSTEM SHALL stop the media, drop the context and leave the reader where it is
- AC-007 WHEN a replay is opened during a live call, or a call is joined during a replay THE SYSTEM SHALL ask first and close the
  other on confirmation; the two never share the window
- AC-008 WHEN the recording cannot be loaded (not found, not a member, a state track that fails the schema) THE SYSTEM SHALL say
  so in the window and leave the reader as it was

## Out of scope

- Editing, trimming, chapters, captions. Sharing a recording beyond the room. Offline playback.

## Notes for the planner

- The player is `features/replay/player.ts`: the clock is the `<video>` element; `snapshotAt(recording, t)` folds with
  `@sefaria-social/session`'s `fold`; an apply queue collapses requests. `fix-webm-duration` makes the fetched WebM seekable.
- The window reuses `CallFrame` and `window-geometry.ts`; the transport bar is new (`Transport.tsx`).
