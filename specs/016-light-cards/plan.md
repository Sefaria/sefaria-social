# Plan: 016 light cards

- `lib/sefaria-text.ts`: `refTitles(ref)` cache (heRef, title) filled from the text API answer (shared with spec 017's
  fetch); `subscribe` so a publisher can republish when it lands.
- `features/session/room-reader.ts`: `summaryOf` adds `heRef`; `roomReader` emits a change when the lookup for the current
  ref lands. `packages/relay/src/internal.ts`: `summaryOf` and `RoomStatus` gain `heRef`. `server/services/relay.ts` parses
  it (optional, for a relay not yet redeployed).
- `features/feed/FeedCard.tsx`, `card.module.css`: article, stretched heading link, status line, ref line.
- e2e: `e2e/feed.spec.ts` (zero sockets), `e2e/feed-visual.spec.ts` (screenshots), `e2e/stack/publisher.ts` (raw sockets
  from a publisher page). The harness gets the reader's tokens and a `theme` option.

## Tests

- `room-reader.test.ts`, `packages/relay/src/relay.test.ts` (AC-004).
- `features/feed/FeedCard.test.tsx` (AC-001..AC-003, jsdom, test relay counts sockets).
- `e2e/feed.spec.ts` (AC-003), `e2e/feed-visual.spec.ts` (AC-005).
