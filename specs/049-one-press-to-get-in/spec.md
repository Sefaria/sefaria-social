---
id: "049"
title: One press to get in, starting a room lands you in it with the call, and an invitee's Join does everything
status: approved
features: [ROOM-052, ROOM-053, SESS-073]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [rooms, room-lobby, call, session]
risk: normal
contract_impact: none
---

## Problem

The owner's walkthrough (docs/plans/shiur.md D6, decision record 0011) counted the presses: Start a room, name it, Start, then
Enter the room, then Join call, then choose devices in a pre-join step, then Join. An invitee opens the link, presses Join, then
Enter, then Join call, then Join again, and until then sees no video of the leader. Getting in should take one press after
naming the room, and one press for an invitee.

## Acceptance criteria

- AC-001 WHEN a signed-in person names a new room and presses Start THE SYSTEM SHALL create the room and take them straight into
  it: the reader in the room's context (the library when they started from a Social page), and, when the server offers calls,
  the room's call connecting with their own last microphone and camera choice, without a lobby, an Enter press or a pre-join step
- AC-002 WHEN an invitee who is signed in opens a room's link and presses Join THE SYSTEM SHALL make them a member, take them into
  the room's context at the leader's place, and connect them to the call with microphone and camera off, so the leader's tile is
  on screen without another press
- AC-003 WHEN an invitee who is signed out presses Join THE SYSTEM SHALL ask the reader to sign them in, and once they are signed in
  on that room's page SHALL carry on with AC-002 by itself
- AC-004 WHEN a member presses Enter the room in its lobby THE SYSTEM SHALL take them into the room's context and connect them to
  its call as in AC-002 (the room's owner with their last choice)
- AC-005 WHILE the server does not offer calls THE SYSTEM SHALL do AC-001, AC-002 and AC-004 without a call
- AC-006 WHEN the room's owner turns their microphone or camera on or off in a call THE SYSTEM SHALL remember the choice in this
  browser for the next room they start or enter; the first time, the microphone is on and the camera off; an invitee always
  starts with both off

## Out of scope

- The session kinds (room, broadcast, recording) and Record in the start dialog, and every ending (spec 050).
- The "Join call" button stays for someone who left a call and comes back; it keeps its device choice step.

## Notes for the planner

- Replaces 044/AC-001's "opens its lobby" after Start: Start now lands in the room. The lobby stays the room's shareable page.
- `features/room/enter.ts`: one helper that enlarges the room (`RoomController.enlarge`) and, when calls are available, asks the
  call controller to `enter(roomId, { mic, camera })` straight through the pre-join step (the controller's `joinWith` does the
  same for broadcasts). The remembered choice lives in `localStorage` (`social.callDevices`, read and written in try/catch).
- A pending Join while signed out is kept in `sessionStorage` (`social.pendingJoin`), only for the same room id.
- _Proposed (not decided by the owner):_ first-time starter defaults to microphone on, camera off.
