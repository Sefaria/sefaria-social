---
id: "016"
title: Light cards — a room's place and who is there, with no reader and no socket
status: approved
features: [FEED-016, FEED-052, SESS-054]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, session]
risk: normal
contract_impact: none
---

## Problem

A card in the feed must say what a room is learning and who is there at a glance, and stay cheap: no reader, no socket,
only the status the server read from the relay (plan 4.5, decision 6 in plan 1.2). For a card to show a ref in both
interface languages, the stream's summary needs the Hebrew ref as well as the English one, so the server and cards never
decode reader snapshots.

## Acceptance criteria

- AC-001 WHEN the feed shows a room or a shiur THE SYSTEM SHALL render it as an `<article>` labelled by its heading, whose
  heading holds the card's only link, stretched over the whole card; the link's `href` is the room's lobby
  (`/social/r/<id>`) or the shiur's page (`/social/s/<id>`), and a plain click on a room that is not live, or on a shiur,
  goes there through social's router (R15).
- AC-002 WHEN a card shows status THE SYSTEM SHALL take it from the feed (the server's status read) and say it in words —
  "Live", the number of people learning, "Not live now", or the shiur's start time — with any icon or colour only
  decorative (`aria-hidden`), and the ref in the interface language (`heRef` in Hebrew when known) with `lang` and `dir`.
- AC-003 WHEN the feed shows any number of live cards and nobody presses one THE SYSTEM SHALL open no WebSocket and mount
  no reader; a test counts sockets through the test relay (component) and Playwright's `websocket` events (end to end).
- AC-004 WHEN a publisher's stream is published THE SYSTEM SHALL carry `social.summary = {ref, heRef, title}`, where `heRef`
  and `title` come from the public text API's answer for that ref (null until it has answered, then published without
  waiting for the next move); the relay's status read and the server's status carry `heRef`.
- AC-005 Cards and the feed page are checked visually in English, Hebrew and dark on the harness (Playwright screenshots of
  the feed), and use only the reader's design tokens.

## Out of scope

- Avatars and names of the people in a room (the status read gives a count only).
- The source text itself (spec 017) and the enlarge move (spec 018).

## Notes for the planner

- `features/feed/FeedCard.tsx` (+ CSS module). The stretched link is the heading's `<a>` with an `::after` covering the
  article; nothing else in the card is interactive.
- Summary: `features/session/room-reader.ts` (`summaryOf` reads `heRef`/`title` from a ref-titles lookup in
  `lib/sefaria-text.ts`), `packages/relay/src/internal.ts` (`summaryOf`, `RoomStatus`), `server/services/relay.ts`.
- The end-to-end lane: live rooms are made by a publisher page that opens raw sockets to the local relay; the viewer's page
  is a separate page whose sockets are counted.
