---
id: "029"
title: A source beside the feed — the reader slides in, the feed stays
status: approved
features: [FEED-069]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, post, profile]
risk: high
contract_impact: host-minor
---

## Problem

A post is anchored to a source. Clicking the source today sends the reader there and the feed is gone: Back reloads it, the tab and
the place in it are lost, and reading what a friend said about a verse means leaving the friend. Learners want both at once: the
feed moves aside and the text comes in beside it, as a chavruta keeps the sefer open next to the conversation.

## Acceptance criteria

- AC-001 WHEN a learner clicks the source of a post (in the timeline, on the post's page or on a profile) and the reader offers
  SurfaceHost 1.1 `openBeside` THE SYSTEM SHALL call `host.openBeside` with the reader's address for that source (the href from
  `commands.href`), not navigate away; the link is still a real `<a href>` to that address, and a modified click (new tab, new
  window) follows the href. WHEN the reader is 1.0 (no `openBeside`) THE SYSTEM SHALL send the reader there with `commands.go`, as
  before.
- AC-002 WHILE the page is shown in the reader's column beside a text THE SYSTEM SHALL lay out by its own width, not the window's:
  the frame is a size container and the home page's two-column layout and the profile header's row appear only when the frame is
  wide enough, so a 360–540px column shows one tidy column.

## Out of scope

- The reader's side (the column, the animation, closing, the address with `ctx=social.beside`): Sefaria-Project `reader-next`
  (SHL-079, contract 1.1). Opening rooms and shiurim beside the feed; resizing the column.

## Notes for the planner

- `app/src/features/host/ReaderRefLink.tsx` gains `beside`; `PostCard` uses it. The fake host records `openBeside` calls and can
  build a 1.0 host (`besideSupported: false`).
- Container queries: `container: social / inline-size` on `.frame` (`features/shell/shell.module.css`); `@container social` in
  `home.module.css` and `profile.module.css` instead of `@media`.
