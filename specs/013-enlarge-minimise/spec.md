---
id: "013"
title: Enlarge into a room's reader context and minimise out of it (R8–R14)
status: proposed
features: [SESS-013, SESS-046, SESS-047, SESS-048]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [room-lobby, session]
risk: high
contract_impact: none
---

## Problem

Being "in" a room means the page's one reader shows the room's place, with `ctx=social.room.<id>` in the address (plan
4.3–4.4). Entering and leaving must follow routing rules R8–R14 exactly: one history entry per enlarge, streamed moves as
replacements, the viewer's own place restored on the way out, the address alone enough to reconnect, and nothing personal
applied or sent. The moves go through the session state machine (spec 004) and the host (spec 001).

## Acceptance criteria

- AC-001 WHEN a member presses Enter in the lobby (or Enlarge in the mini view) THE SYSTEM SHALL, in order: keep
  `host.reader.state.getSnapshot()` in memory as the viewer's own place only if the current page is a reader page (not
  `/social/…`); take the followed stream's current snapshot, validated, as the target (or, with nobody publishing, the
  library `/texts`); call `host.navigate(<target url with ctx=social.room.<id>>)` as a push; and once
  `host.reader.context.get()` equals that value, apply the target with origin `follow` (R9).
- AC-002 WHEN moves arrive from the stream while the viewer is in the context THE SYSTEM SHALL apply them only through
  `applySnapshot` (which replaces) and never push, so one enlarge is one history entry; WHEN the viewer goes Back THE
  SYSTEM SHALL be on the page they enlarged from, out of the context, with the session machine idle and nothing more
  applied (R10).
- AC-003 WHEN the viewer minimises THE SYSTEM SHALL push the stored own place without `ctx` if they enlarged from a reader
  page, else the room's lobby, keep the connection, and show the mini view (the room's name, Enlarge, Leave) in the
  persistent mount (R12).
- AC-004 WHEN a reader address with `ctx=social.room.<id>` is loaded cold THE SYSTEM SHALL have the persistent mount
  connect to that room from the `ctx` value alone (no memory or storage) and resume following, with the session machine
  expanded (R11).
- AC-005 WHEN a snapshot from another participant is applied THE SYSTEM SHALL keep only the slices that are moment-scoped
  in the viewer's own reader (`getSnapshot({scope: "moment"})`), so personal slices such as settings, and slices the
  viewer's reader does not have, are never applied (R13).
- AC-006 WHEN the viewer's stream is published THE SYSTEM SHALL remove any `ctx` from its url, every slice that is not
  moment-scoped, and search words from `nav`, add the `social.summary` slice (`{ref, title}` from the reader's first
  panel), and publish only while the viewer is in that room's context; a unit test with a fixture holding both a `ctx` and
  a personal slice proves it (R14).

## Out of scope

- Shiur contexts and playback (`ctx=social.shiur.<id>`); cards in a feed (P4).
- An overlay `<dialog>`: the enlarged view is the reader page itself (a route), so plan 4.7's dialog rule does not apply.

## Notes for the planner

- `features/session/room-reader.ts`: the follow gate (what the session client sees as the reader state API) and the
  publish view; `features/session/controller.ts`: enlarge, contextReady, minimise and contextLost through `transition()`.
- The host's ctx is sticky: `applySnapshot` keeps it (the fake does the same).
