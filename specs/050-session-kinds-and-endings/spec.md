---
id: "050"
title: Session kinds and endings, one Record toggle, and Close, Finish and Leave
status: proposed
features: [SESS-074, SESS-075, ROOM-054]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [session, recording, rooms, broadcast]
risk: normal
contract_impact: none
---

## Problem

The owner's walkthrough (docs/plans/shiur.md D5, D8, D15; decision record 0011): recording is decided in the lobby before
entering and cannot be paused; the only way to end a room is to delete it; a follower and the leader both see Leave; and a
closed room cannot be used again. The owner decided that recording can be turned on and off during a session, that the leader
closes a room for everyone (which starts making the asset), that a follower leaves, and the words: a recording is finished, a
broadcast is ended, a room is closed by its leader and left by a follower.

## Acceptance criteria

- AC-001 WHILE the room's owner leads a session THE SYSTEM SHALL show one Record control in the room window; pressing it starts
  recording the room, pressing it again pauses, and again resumes, any number of times; every paused stretch is cut, so the
  recording's media and its reader timeline share one clock whose length is the sum of the recorded stretches
- AC-002 WHEN the owner presses Close room and confirms THE SYSTEM SHALL end the session for everyone: a recording in progress is
  finished and saved, the owner's call is left, and every participant is taken out of the room's context and told "The room was
  closed." with a link to the room's page
- AC-003 WHEN a participant who is not the owner presses Leave in the room window THE SYSTEM SHALL take only them out of the room
  and its call; the session goes on for everyone else
- AC-004 WHEN the owner of a closed room enters it again THE SYSTEM SHALL start a new session in it; while the relay still holds
  the closed session, a member who enters before the owner is told the room was closed
- AC-005 WHEN the room's owner has been gone from a live session for 2 minutes THE SYSTEM SHALL end it as AC-002 says; the owner
  coming back within the 2 minutes keeps it going
- AC-006 WHEN a person starts a room THE SYSTEM SHALL let them choose what it is — a room (people can join and talk), a broadcast
  (people watch), or just me (a recording) — and whether to record it (off for a room, on for a broadcast and for just me);
  the session starts that way
- AC-007 THE SYSTEM SHALL label the owner's ending by the session's kind: Finish and save (just me), End broadcast (broadcast),
  Close room (room); a participant's is Leave

## Out of scope

- Recording only the leader, the overlay track and the asset's storage (spec 051); processing (052); the player (053).
- Editing an asset after it is saved.

## Notes for the planner

- Pause and resume: `MediaRecorder.pause()`/`resume()`, and the state writer's clock skips the paused time (its `now` is the
  media's elapsed time, not the wall clock); no state message is sent while paused, and resuming sends a keyframe.
- Closing uses the protocol's `{type: "end"}`; the relay's room becomes `ended`. A host joining an ended room starts a new session
  (term + 1, the host holds the spotlight). The 2-minute end is the room's own timer (`tick`), counted from the moment no host is
  connected.
- The kind chosen at Start is kept for the tab per room (the label of AC-007); after a reload the owner sees Close room, and
  End broadcast while the room has a live broadcast.
- _Proposed (not decided by the owner):_ the 2-minute grace (AC-005), and that a closed room can host a new session (AC-004).
- The relay keeps a room in memory only; once everyone has left a closed room it may be unloaded and forgotten, and the next
  person to enter finds an empty room rather than a closed one. Remembering closed sessions belongs with the asset (spec 051).
