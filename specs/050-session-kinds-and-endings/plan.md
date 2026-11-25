# Plan: spec 050

## Approach

1. **The room (T-001).** `packages/session/src/room.ts`: a host who joins an ended room starts a new session (ended false, a new
   term, the spotlight theirs); anyone else joining an ended room keeps getting `ended`. A new `endAfterMs` (default 120 s): when
   the last connected host leaves a live session, the room remembers the time, and `tick` ends the session once that time has
   passed; a host joining clears it.
2. **Record toggle (T-002).** The session recorder gets `pause()` and `resume()`: MediaRecorder pauses, the clock it shares
   with the state writer stops (the writer's `now` subtracts paused time), the writer stops sending, and resuming sends a
   keyframe. The recording controller's view gains `paused`; `toggle(roomId)` starts, pauses or resumes. The room window shows
   one Record control for the owner who leads.
3. **Endings (T-003).** `RoomController.close(roomId)`: stop the recording (finish), end a live broadcast, send `end`, leave
   the call and the room. When a session ends under anyone else, the controller leaves the room's context and shows a notice
   with the room's page ("The room was closed."). The room window's footer: the owner's ending labelled by the kind
   (`session-kind.ts`, kept per room for the tab), Leave for everyone else. The start dialog offers the kind and Record; Start
   enters, then starts the broadcast or the recording.

## Tests

| AC            | Test                                                                                                                       | Fails on base because        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 001           | `recorder.test.ts`: pause/resume with a fake MediaRecorder and clock; duration is the recorded time                        | no pause                     |
| 002, 003, 007 | `surface/endings.test.tsx` with the test relay: Close room ends for the follower, notice shown; Leave leaves alone; labels | no Close, no notice          |
| 004, 005      | `room.test.ts`: a host's join reopens an ended room; 2 minutes after the last host leaves the room ends                    | ended is final; no end timer |
| 006           | `rooms.test.tsx`: the dialog's kind and Record; Broadcast starts a broadcast and a recording                               | no options                   |
