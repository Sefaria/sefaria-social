---
id: "037"
title: On a phone the call docks as a strip at the top instead of floating
status: proposed
features: [SESS-062]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [session]
risk: normal
contract_impact: none
---

## Problem

A draggable, resizable window does not work on a phone: there is no room beside the text, fingers drag the page instead of the
window, and a window in a corner covers a third of the text. Phones need a fixed, predictable place for the call that takes
little space by default. Phones also stop a hidden tab's audio, and the learner needs to know when that happened.

## Acceptance criteria

- AC-001 WHILE the viewport is narrower than 600px THE SYSTEM SHALL show the call as a full-width strip docked under the top
  inset, with no drag or resize handle
- AC-002 WHEN the strip is collapsed (the default) THE SYSTEM SHALL show it 48px high with participants' avatars, the speaking
  ring, the microphone toggle, Leave and Expand; WHEN expanded it SHALL show the active speaker at 16:9 across the width with the
  same controls, and Collapse SHALL return to 48px
- AC-003 WHEN the viewport crosses 600px in either direction during a call THE SYSTEM SHALL switch between the strip and the
  floating window without disconnecting
- AC-004 WHEN the tab becomes visible again after the browser suspended its audio or dropped the connection THE SYSTEM SHALL say
  the call was paused and offer one button that resumes audio or rejoins
- AC-005 WHILE collapsed, the strip SHALL not receive other participants' video

## Out of scope

- Native apps. Background audio while the browser is in the background (the browser decides). Picture-in-picture.

## Notes for the planner

- The breakpoint is social's own; the reader uses 842px for its single-panel layout and 600px in several places.
  `[CHECK]` with the reader's phone layout that the strip does not cover the reader's sticky header (use the top inset from
  spec 036).
- Reuse spec 035's controls and tiles; only the frame differs. Test on the phone viewport and a phone user agent (the e2e
  journeys already run there).
- Audio after a hidden tab: LiveKit `Room.startAudio()` needs a user gesture, hence the button.
