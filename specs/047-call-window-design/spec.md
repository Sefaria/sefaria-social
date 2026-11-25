---
id: "047"
title: The call window looks like a call — video tiles, initials when the camera is off, an icon control bar, a real pre-join
status: draft
features: [SESS-069]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [call]
risk: normal
contract_impact: none
---

## Problem

The floating call window (spec 035) has a designed frame, but its contents are browser-default buttons and bare text: no video
area, no sign of who is there when cameras are off, the microphone and camera buttons do not show whether they are on, and Leave
call looks like every other button. On the cauldron it read as unfinished.

## Acceptance criteria

- AC-001 WHILE in a call THE SYSTEM SHALL show each participant as a 16:10 tile on a dark background: their camera filling it when
  on, otherwise a circle with their initials; their name (and "you") on a label at the tile's bottom, a muted mark when their
  microphone is off, and a ring while they speak
- AC-002 WHILE in a call THE SYSTEM SHALL show the controls as one bar of round icon buttons, each with its accessible name
  (Microphone, Camera, Share screen), showing on and off apart (`aria-pressed` and a crossed icon when off), and Leave call as a red
  button at the bar's end
- AC-003 WHEN the pre-join step shows THE SYSTEM SHALL show a 16:10 preview area (the camera when on, otherwise "Your camera is off"),
  the microphone and camera as the same icon toggles, the device choosers as labelled selects, Join as the primary button and
  Cancel beside it; "Start audio" SHALL be a full-width notice button

## Out of scope

- The window's frame, sizes and placement (spec 035), the phone strip (spec 037), moderation (spec 039).

## Notes for the planner

- Markup changes stay small and keep every `data-` attribute and text the call tests read: icons are inline SVG (no text), the
  initials circle is `aria-hidden`.
