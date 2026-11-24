---
id: "034"
title: Join a room's call, choose devices, talk and leave, while the call survives reading
status: approved
features: [SESS-057, SESS-058, SESS-059]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [session, room-lobby]
risk: normal
contract_impact: none
---

## Problem

With a token available (spec 033), a learner in a room still has no way to join the call, pick a microphone and camera, hear
the others, or leave. The call must behave like part of the room, not like a page: it has to keep running while the learner
moves through the reader, it must never switch a camera or microphone on by itself, and readers who never join a call should
not download the media code at all.

## Acceptance criteria

- AC-001 WHEN the call state machine (`features/av/machine.ts`, states off, prejoin, connecting, in-call, reconnecting, ended)
  is given any event THE SYSTEM SHALL follow its transition table, and a test SHALL cover every allowed and every forbidden
  transition
- AC-002 WHEN a viewer is in a room (its lobby, or the reader with `ctx=social.room.<id>`) and the room says calls are available
  THE SYSTEM SHALL show a "Join call" button in the lobby and in the follow bar; WHEN calls are not available it SHALL show none
- AC-003 WHEN a page loads and the viewer has not clicked "Join call" THE SYSTEM SHALL not load the LiveKit client code, connect
  to LiveKit, or ask for camera or microphone access
- AC-004 WHEN the viewer clicks "Join call" THE SYSTEM SHALL show a pre-join step with microphone and camera both off, device
  choosers, and a camera preview once the viewer turns the camera on; "Join" connects with exactly the choices made there
- AC-005 WHEN the browser denies camera or microphone access THE SYSTEM SHALL say how to allow it, still let the viewer join to
  listen, and leave the room session as it was
- AC-006 WHILE in a call THE SYSTEM SHALL play every other participant's audio, show their video, and let the viewer turn their
  microphone and camera on and off and share their screen where the browser supports it
- AC-007 WHEN the viewer clicks "Leave call" THE SYSTEM SHALL disconnect from LiveKit, stop every local track (camera light off)
  and keep the viewer in the room; WHEN the viewer leaves the room THE SYSTEM SHALL leave its call first
- AC-008 WHEN the viewer joins a call in a second room while in a call THE SYSTEM SHALL ask first, and on confirmation leave the
  first call before joining
- AC-009 WHILE in a call, WHEN the viewer navigates inside the reader (another ref, enlarge, minimise, any `/social` page) THE
  SYSTEM SHALL keep the call connected without a new join
- AC-010 WHEN the page is loaded cold with `ctx=social.room.<id>` THE SYSTEM SHALL reconnect the room (R11) and offer "Join call",
  and SHALL NOT join the call or ask for devices by itself
- AC-011 WHEN the connection to LiveKit drops THE SYSTEM SHALL show that it is reconnecting, reconnect with a fresh token, and
  after 30 seconds without success end the call with a "Rejoin" button
- AC-012 WHEN the viewer joins, leaves, reconnects or hits an error THE SYSTEM SHALL report `av.join`, `av.leave`
  (`durationS`, `peakParticipants`), `av.reconnect` or `av.error` (`kind`) through `host.report`, with no names, identities or
  device labels

## Out of scope

- The window's look, size and placement (spec 035; this spec renders into it as a plain box). Phones (spec 037).
- Moderation (spec 039). Recording, captions, reactions, hand raise, background blur.

## Notes for the planner

- New `app/src/features/av/`: `machine.ts` (same style as `features/session/machine.ts`), `call-controller.ts` (one per host,
  like `session/controller.ts`; owns the LiveKit `Room`), `load-livekit.ts` (the only module that imports `livekit-client`,
  dynamically), `PreJoin.tsx`, `Tiles.tsx`, `Controls.tsx`.
- The call lives in the persistent mount (`app/src/surface/persistent.tsx`), which R18 keeps mounted across routes; AV1–AV7 in
  the design doc are the rules.
- LiveKit options: `adaptiveStream`, `dynacast`, simulcast for camera. Remote audio needs the Join click as the user gesture.
- A call never touches snapshots, `ctx` or share links (R14).
- `features/av` may import `features/session`, not the reverse; the follow bar gets the button through a slot or a small hook.
