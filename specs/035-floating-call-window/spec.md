---
id: "035"
title: The call floats over the reader in a window the learner can move and resize
status: approved
features: [SESS-060, SESS-061]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [session]
risk: normal
contract_impact: none
---

## Problem

A call is only useful beside the text: learners look at each other and at the sefer at once. If the video took a column, the
reader's layout would shift on every join and leave, and the text column would narrow (the reader already has a scroll-jump
bug when its side panel narrows the column). So the call sits in a floating window over the reader, top right by default, that
the learner can drag, resize, shrink to a pill and grow, with the keyboard as well as the mouse.

## Acceptance criteria

- AC-001 WHILE a call is live THE SYSTEM SHALL render the call window in the persistent mount with fixed positioning over the
  reader, and opening, moving, resizing or closing it SHALL leave the reader's text column box and scroll position unchanged
- AC-002 WHEN a call window opens with no saved position THE SYSTEM SHALL place it at the top inline-end corner (right in the
  English interface, left in the Hebrew one), 16px inside the inline-end inset and 16px below the top inset (insets from spec
  036, or its fallback)
- AC-003 WHEN the learner picks a size THE SYSTEM SHALL show it: pill (about 240 by 48: avatars, speaking ring, microphone
  toggle, expand), small, the default (about 320 by 200: the active speaker large, others in a strip), medium (about 480 by
  300: a grid of up to 4), large (a grid of up to 9, at most 60% of the viewport in each dimension); more participants than
  tiles show as "+N"
- AC-004 WHEN the learner drags the window by its handle THE SYSTEM SHALL move it with the pointer and, on release, snap it to
  the nearest corner 16px inside the insets; a drag that starts on a tile or a control SHALL not move it
- AC-005 WHEN the learner drags the corner resize handle THE SYSTEM SHALL resize the window between the small and large sizes,
  keeping the tile area at 16:10
- AC-006 WHEN the viewport, the window's size or the insets change THE SYSTEM SHALL keep the whole window inside the area
  within the insets
- AC-007 WHEN a window closes and a later call opens THE SYSTEM SHALL restore the last corner, offset and size from
  `localStorage`; WHEN storage is unavailable or holds an invalid value it SHALL use the default without an error
- AC-008 WHEN the handle has keyboard focus THE SYSTEM SHALL move the window 16px per arrow key (64px with Shift), offer a menu
  with the four corners and the sizes, and announce each move in a polite live region
- AC-009 WHILE the window is open THE SYSTEM SHALL not trap focus; Escape SHALL collapse it to the pill; every control SHALL be at
  least 24 by 24px with a visible focus ring and an accessible name
- AC-010 WHEN the learner prefers reduced motion THE SYSTEM SHALL move, snap and resize the window without animation
- AC-011 WHILE a participant's tile is not shown (pill size, beyond the visible tiles) THE SYSTEM SHALL not receive their video
  and SHALL keep playing their audio

## Out of scope

- Phones below 600px wide (spec 037 docks the window instead).
- The reader's insets themselves (spec 036). Pop-out with the Document Picture-in-Picture API (later).
- Captions (later; the window leaves room for a caption line under the tiles).

## Notes for the planner

- Design reference: `docs/design/audio-video.md` section 6.2 (no mockup in this repo yet; sizes and placement above are the
  contract). Use the social design tokens; no new colours.
- `features/av/window-geometry.ts`: pure functions (default placement, snap, clamp, save and load) with unit tests;
  `CallWindow.tsx` uses them. Translate with `transform` during a drag and commit the position on release; pointer capture on
  the handle, which is a real `<button>`.
- Saved value `{ v: 1, corner, offsetX, offsetY, size }`, relative to the corner, parsed with zod; every storage access in
  try/catch.
- Visible-tile subscription: LiveKit `adaptiveStream` handles hidden elements; check that the pill unsubscribes video.
