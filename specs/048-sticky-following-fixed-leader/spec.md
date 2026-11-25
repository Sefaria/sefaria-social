---
id: "048"
title: Following is sticky, the room's owner is its one leader, and you follow a person by clicking them
status: approved
features: [SESS-070, SESS-071, SESS-072]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [session, presence, call, api]
risk: high
contract_impact: api-minor
---

## Problem

The owner's walkthrough (docs/plans/shiur.md, decisions D3, D4 and D7; decision record 0011) found three things wrong with
following in a room:

- **Every click breaks following.** The session client pauses a follower on any input the reader reports
  (`api.onLocalInput(breakAway)` in `packages/session/src/client.ts`), including a click on Social's own room or call window,
  so a follower who presses Join call or opens the room window is suddenly "on their own".
- **Anyone can take the room.** Every participant joins as a host who may lead (decision 0008: the relay could not see room
  roles), and the room window offers Lead to everyone. The owner wants the room's owner to be its leader for the whole session.
- **Following a person is hidden and partial.** Follow buttons sit in a list; a video tile cannot be clicked. When the leader
  follows someone, the leader's followers stay behind: a change applied with origin `follow` is never published.

## Acceptance criteria

- AC-001 WHILE a follower is following someone in a room, WHEN they click or press keys anywhere (Social's room window, the
  call window, Join call, the reader) without their reader moving away from the followed person's place, THE SYSTEM SHALL keep
  them following (status `live`, the room window says "Following <name>")
- AC-002 WHILE a follower is following someone, WHEN their reader settles (no input or change for 400 ms) on a segment of the
  same section as the followed person's segment and fewer than 5 segments away, THE SYSTEM SHALL keep them following, and the
  followed person's next move SHALL bring them to the new place
- AC-003 WHILE a follower is following someone, WHEN their reader settles in another book or section, or 5 or more segments away
  in the same section, THE SYSTEM SHALL set them on their own (status `paused`, "You are on your own" with Follow again)
- AC-004 WHEN a signed-in member asks the social API for a relay ticket for a room (`POST /api/v1/rooms/{roomId}/ticket`)
  THE SYSTEM SHALL answer with a 10-minute ticket naming the caller and their role, `owner` for the room's owner and `member`
  for anyone else; a caller who is not a member SHALL get 404
- AC-005 WHEN a socket joins an ordinary room on the relay THE SYSTEM SHALL make the participant a host who may lead only when
  it offers a valid owner ticket for that room and that user; with a member ticket, no ticket, an expired or tampered ticket,
  or a ticket for another room or user, the participant SHALL join as a member who cannot lead, and a member's request to move
  the spotlight SHALL be refused
- AC-006 WHILE the viewer is in a room THE SYSTEM SHALL offer no Lead button and no leadership-mode control; the room's owner
  holds the spotlight from the moment they join
- AC-007 WHEN the viewer clicks another person, in the room window's list of who is here or on that person's call tile, THE
  SYSTEM SHALL follow that person; WHEN the viewer clicks the person they follow again, or the leader, THE SYSTEM SHALL return
  them to following the leader; WHEN the leader follows someone, the room window SHALL offer "Lead again", which returns the
  leader to leading
- AC-008 WHEN the leader follows person B, THE SYSTEM SHALL bring everyone who follows the leader to B's place, and keep doing
  so while the leader follows B; two people who follow each other SHALL NOT send each other their state more than once per move

## Out of scope

- Getting into a room in one press and the call joining by itself (spec 049); ending, closing and recording (spec 050).
- Removing members, or giving the lead to someone other than the owner. `hand-raise` and `open` stay in the protocol and are
  only no longer offered in the interface.
- Any change to the pinned host contract or to reader-next: the comparison of places is done in Social.

## Notes for the planner

- Replaces earlier acceptance lines: spec 014's "any input pauses a follower" and the Lead button of specs 014 and 045 (AC-003
  of 045 offered "Follow again, or Lead"). Decision 0008's "everyone may lead" is superseded by a decision record in this spec's
  PR.
- **Sticky rule:** a `drifted(mine, theirs)` option on the session client. Input starts a 400 ms settle timer (reset by more
  input or by a local change); when it fires and the client is still live, compare the follower's published snapshot with the
  stream reader's `current()`. Without the option the client keeps today's behaviour (any input breaks away). Social's
  comparator reads the first panel's anchor in `sefaria.scroll` (a segment ref), else `social.summary`'s ref, else the path.
- **Room tickets:** the broadcast ticket's format (`docs/design/session-recording-and-broadcast.md` 6.2) with roles `owner` and
  `member` for ordinary rooms; the relay accepts only `host`/`viewer` in a `b_` room and only `owner`/`member` elsewhere, so a
  ticket of one kind never opens the other. Without a valid ticket an ordinary room's join is a member (fail closed for
  leading; holding the link still admits, as decision 0008 says).
- **Leader takes followers along:** after an apply of the followed stream resolves, a client whose own stream is needed (it holds
  the spotlight or is followed) sends a keyframe of where it now is, unless that equals the last such keyframe it sent
  (the loop guard).
- Call tiles use LiveKit identities `u:<userId>`; the session's participant id is `<userId>`.
