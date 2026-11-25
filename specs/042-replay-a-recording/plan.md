# Plan: 042 a recording plays back inside the reader

Design: `docs/design/session-recording-and-broadcast.md` §5.

## T-001 The player (AC-003, AC-004, AC-005, AC-006, AC-008)

- `features/replay/state-track.ts`: `parseStateTrack(json)` (the session schema's `recordingSchema` plus the reader's checks:
  keyframe first, seq +1, `t` never back) and `snapshotAt(recording, t)` (last keyframe at or before `t`, then `fold` the later
  changes up to `t`), with an index of keyframe positions for the scrubber.
- `features/replay/player.ts`: `createReplayPlayer({ media: HTMLMediaElement-like, track, state: ReaderStateApi })`: the media is
  the clock; on `timeupdate`, `seeked`, `play` and a 250 ms timer while playing it applies `snapshotAt(t)` when it differs from
  the last applied (by keyframe index and change count), one apply at a time, newer requests collapsing; `play`, `pause`,
  `seek(t)`, `skip(±10 s)`, `setRate(1 | 1.5 | 2)`; local input (`onLocalInput`) detaches (`following: false`), `rejoin()`
  re-applies the current point; `dispose()`.
- `features/replay/replay-controller.ts`: one per host; `open(recordingId, { autoplay })` loads metadata, state and media (the
  media as a blob with progress through the API client, then `fix-webm-duration` with the recorded duration, then an object URL),
  `close()` stops media, revokes the URL and drops `ctx`; reads `ctx=social.rec.<id>` from the host context on mount and opens
  paused; errors become a view state (`not-found`, `invalid`, `failed`).
- Tests: `features/replay/state-track.test.ts`, `player.test.ts` (a fake media element and a fake state API: AC-003 – AC-005),
  `replay-controller.test.ts` (AC-006, AC-008).

## T-002 Pages, window and the call (AC-001, AC-002, AC-007)

- `features/recording/RecordingsList.tsx` in the lobby; route `social.rec.$recordingId.tsx` with `RecordingPage.tsx` (Play,
  Download state, Delete for the recording's or room's owner).
- `features/replay/ReplayWindow.tsx` in the persistent mount (`surface/persistent.tsx`): `CallFrame` with the `<video>`, a loading
  bar, `Transport.tsx` (play/pause, scrubber with keyframe ticks, ±10 s, speed, Close), "You left the recording · Back to the
  recording", errors. On phones the strip (spec 037).
- Exclusivity: `features/av/window-owner.ts`, one owner of the window at a time (`call` or `replay`); opening one while the other
  holds it asks first (a confirm dialog in the window), and on confirmation leaves the call or closes the replay.
- Strings in English and Hebrew. Tests: `features/replay/ReplayWindow.test.tsx`, `features/recording/RecordingPage.test.tsx`,
  `surface/replay.test.tsx` (AC-002, AC-007); `e2e/recording.spec.ts` plays one back.
