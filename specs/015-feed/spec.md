---
id: "015"
title: The feed — what is live, scheduled and recent for the viewer, at /social
status: proposed
features: [FEED-015, FEED-051]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, api]
risk: normal
contract_impact: api-minor
---

## Problem

`/social` is a placeholder. A signed-in learner opening social should see, on one page, the rooms they belong to that are
live right now, the shiurim coming up that they can attend, and their other rooms, without opening any connection to a room
(plan 4.5). The server already knows the viewer's rooms (spec 007) and can read a room's live status from the relay
(spec 011); the feed puts those together in one request.

## Acceptance criteria

- AC-001 WHEN a signed-in viewer calls `GET /api/v1/feed` THE SYSTEM SHALL answer 200 with `{live, scheduled, recent}`:
  `live` holds the viewer's rooms whose relay status has at least one participant, each with the room's id and title and
  the status's `ref`, `heRef`, `title` (the source's title) and participant count; `recent` holds the viewer's other rooms,
  most recently updated first; `scheduled` holds shiurim whose start is in the future and that the viewer teaches, belongs
  to the room of, or that are public, soonest first. Each list holds at most 20 items.
- AC-002 WHEN the relay does not answer THE SYSTEM SHALL still answer 200, with every room in `recent` and `live` empty;
  WHEN the request has no valid token THE SYSTEM SHALL answer 401; rooms the viewer is not a member of and private shiurim
  of other rooms never appear.
- AC-003 WHEN a signed-in viewer opens `/social` THE SYSTEM SHALL show the sections "Live now", "Scheduled" and "Recent"
  in that order, each a heading followed by a list of cards (spec 016), a section with no items saying so in a sentence;
  WHILE the page is open it SHALL read the feed again every 30 seconds and when the reader's interface language changes.
- AC-004 WHEN a signed-out viewer opens `/social` THE SYSTEM SHALL show a sentence that the feed needs signing in and a
  "Sign in" button that calls `host.viewer.requestSignIn()` (R17), and make no feed request; WHEN the feed cannot be
  loaded THE SYSTEM SHALL say so in an alert, not show an empty feed.
- AC-005 Every section heading and sentence the feed adds is in the interface language, inside an element whose `lang`
  and `dir` match it; the sections are reachable in order by keyboard and each list is a `<ul>` of `<li>` items. (Spec
  000's brand heading and diagnostic line stay above the sections, unchanged.)

## Out of scope

- A public feed for signed-out visitors and public rooms (needs a public endpoint and its own spec).
- Recorded shiurim and their playback (shiur contexts are not built yet); a shiur card links to the shiur page.
- Pagination beyond 20 items per section; pushing feed changes over a socket (the page polls; plan 4.5 forbids sockets).

## Notes for the planner

- Server: a `feed` service composes `listRooms` with `relayStatus` per room (in parallel, outside any transaction) and a
  query over `shiurim` joined to `room_members`. Contract in `server/api/contracts.ts`, route `api/v1/feed.ts`.
- `relayStatus` gains `heRef` from the relay's summary (spec 016 AC-004 adds it to the stream).
- The page: `features/feed/FeedPage.tsx` replaces the placeholder (spec 000's test moves with it); the API behind a small
  interface like `features/api/rooms-api.ts` so component tests inject a fake.
