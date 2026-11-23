---
id: "018"
title: Enlarge from a card onto the card's source, with a transition and no reload
status: approved
features: [FEED-018, SESS-055]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, session]
risk: normal
contract_impact: none
---

## Problem

Pressing a live card takes the page's one reader into the room (decision 6 in plan 1.2, R9). The person should see the card
grow into the reader and land on the place the card showed, inside the same document: the reader page is not reloaded,
the surface keeps its state, and Back returns to the feed (R10). Motion must respect the person's reduced-motion setting.

## Acceptance criteria

- AC-001 WHEN a plain click (or Enter) lands on a live room card's link THE SYSTEM SHALL enlarge into that room through the
  room controller (R9: one push with `ctx=social.room.<id>`, then the room's place applied with origin `follow`), using the
  card's ref as the target when the room's stream has no state yet, so the reader lands on the card's source; the document
  is not reloaded (no navigation of the page, the harness keeps its in-memory state) and Back returns to `/social`.
- AC-002 WHEN the browser has `document.startViewTransition` THE SYSTEM SHALL run the enlarge inside a view transition in
  which the card is the named element and the update completes when the room's context is ready (at most 3 seconds);
  otherwise it SHALL animate the card with `transform` and `clip-path` towards the full viewport (at most 300 ms) and then
  enlarge.
- AC-003 WHEN the person prefers reduced motion THE SYSTEM SHALL run no animation and no view transition, and enlarge at once.
- AC-004 WHEN the click is modified (Ctrl, Cmd, Shift, Alt or a middle click) THE SYSTEM SHALL leave it to the browser (the
  lobby link opens as a link) and not enlarge.

## Out of scope

- Enlarging a shiur (shiur contexts and playback are later work); an overlay `<dialog>` (the enlarged view is the reader
  page itself, a route, as in spec 013).

## Notes for the planner

- `features/feed/enlarge-transition.ts`: `enlargeWithTransition(card, run, env)` picks view transition, fallback or none;
  view-transition pseudo-elements are animated from script (`element.animate` with `pseudoElement`), so no global CSS.
- `features/session/controller.ts`: `enlarge(roomId, { fallbackUrl })`, and a promise that resolves when the context is
  ready, for the transition's update callback.
