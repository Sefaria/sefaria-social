---
id: "053"
title: The shiur player, a bar at the bottom with chapters, the talking head where the leader had it, open to anyone
status: proposed
features: [SHIUR-006]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [recording]
risk: normal
contract_impact: none
---

## Problem

The owner wants a shiur to play in the reader with a bar at the bottom: play, pause, seek, a marker for each text the leader
went to with its ref on hover, the talking head where the leader put it, and the video hideable or absent when there was none,
for anyone with the link (docs/plans/shiur.md D2, D13, D14; 4.6). Today the replay's controls are inside the floating window,
the seek bar has no chapters, the window sits wherever the viewer last left their call window, and only members can play.

## Acceptance criteria

- AC-001 WHILE a recording plays in the reader THE SYSTEM SHALL show a player bar docked at the bottom of the page (above the
  reader's own bottom chrome) with play or pause, the seek bar, a marker per chapter, back and forward 10 seconds, the speed,
  Hide video, the time and Close; the floating window keeps only the video
- AC-002 THE SYSTEM SHALL name each chapter marker by its ref (the Hebrew ref in a Hebrew interface) on hover and focus, go to the
  chapter on a click, and say which chapter is playing beside the time and in the seek bar's value text
- AC-003 WHILE the leader's camera was on THE SYSTEM SHALL show the video at the place the leader had their talking head, moving
  when they moved it; WHILE it was off, or the viewer pressed Hide video, it SHALL show no video window; an audio-only shiur
  SHALL show no video window and no Hide video
- AC-004 WHEN someone signed out opens a ready shiur's link and plays it THE SYSTEM SHALL load it through the public reads
  (spec 051); a signed-in viewer who is not in its room is answered the same way
- AC-005 WHILE the bar has focus THE SYSTEM SHALL play or pause on Space and move 5 seconds with the arrow keys, in the
  interface's reading direction

## Out of scope

- The transcript line under the bar (spec 054). Editing a shiur.

## Notes for the planner

- Replaces 042/AC-004's transport inside the floating window (the same controls, with the same data-action names, move to the
  bar) and 042's placement of the window from the viewer's own call window.
- Chapters and "has video" come from the manifest (spec 052); a recording not yet processed plays with no markers.
- The talking head's place is the `social.overlay` slice (spec 051) at the playing time; the window is pinned there, not dragged.
