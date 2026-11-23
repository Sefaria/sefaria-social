# 0009. Feed cards: text from the page's origin, heRef from the text API, prefetch on press, transition from script

- Status: proposed
- Date: 2026-11-23
- Deciders: milestone P4 worker; a human owner confirms by approving the PR

## Context

P4 builds the feed, light cards, social's own source-text renderer and the move from a card into a room (plan 4.5, 4.7,
specs 015–018). The plan leaves open where the text comes from (contract v1 has no Sefaria API origin), where the summary's
`heRef` comes from (the reader's commands give only `ref`), what "prefetch on press" opens, and how a view transition is
styled without global CSS.

## Decision

- **Text from the reader page's own origin.** `SourceText` (via `lib/sefaria-text.ts`) requests
  `/api/v3/texts/<ref>?version=primary&version=translation&return_format=text_only` relative to the page. In the reader that
  is Sefaria's own API (same origin, no CORS); on the harness, `harness/serve.mjs` answers from recorded fixtures
  (`harness/fixtures/texts/`, public data, re-recorded with `harness/fixtures/record-texts.mjs`). `text_only` asks the API
  for plain text, and social still strips tags and decodes entities itself and renders text nodes only. When contract v1.1
  adds `renderSegment`, `ui/SourceText.tsx` is the one file to replace. If the reader's local development server does not
  serve `/api/v3/texts`, cards show "Text unavailable" there; a `sefariaOrigin` in `host.config` would be a v1.1 proposal.
- **`heRef` and the source's title from the text API's answer.** The publisher's summary slice is `{ref, heRef, title}`.
  `ref` comes as before (the first panel, else the address); `heRef` and `title` (the book's index title) come from the
  page's one text source, which the card renderer shares, so a ref is fetched once per page. Until the answer lands they
  are `null` and the ref, and the stream is republished when it lands (no move needed). The relay's status read and the
  server's `RoomStatus` and feed carry `heRef` (additive; the server accepts a relay that does not send it yet).
- **Prefetch on visibility is the card's text; prefetch on press is the room.** A card requests its text only within 200px
  of the viewport. A press (pointer down, Enter or Space) acquires the room's session with a new `prefetch` hold, so the
  stream's keyframe is usually in hand when the click lands; it is released after 10 s without an enlarge. Without a press
  no socket opens, which keeps plan 4.5 ("a socket opens only on enlarge") true for a feed that is only looked at.
- **Enlarge targets the stream, falling back to the card's ref.** `controller.enlarge(roomId, { fallbackUrl })`: the card
  passes `host.reader.commands.href()` of its ref, used only when the room's stream has no state yet.
- **The transition is driven from script.** Where `document.startViewTransition` exists, the card gets
  `view-transition-name` for the snapshot, the enlarge runs as the update (it resolves when the room's context is ready,
  at most 3 s), and the old snapshot is grown with `Element.animate({ pseudoElement: "::view-transition-old(...)" })`, so
  social ships no global `::view-transition-*` CSS (plan 4.7: no global selectors). Elsewhere the card animates
  `transform` and `clip-path` for 300 ms before the enlarge (the navigation unmounts it). `prefers-reduced-motion` skips
  both.
- **Card links are built by the host.** The heading link's href is `host.href("/social/r/<id>")` and a plain click goes
  through `host.navigate` (or the enlarge), like `HostLink`, rather than the router's `<Link>`; the host-bridged history
  makes the two equivalent, and the card then needs no router context in component tests.
- **Spec 000's heading stays.** `FeedPage` keeps "Sefaria Social" and the contract line (spec 000's exact-markup test is
  unchanged) and renders the feed as its children.

## Consequences

- A text API outage shows "Text unavailable" on cards; the feed, status and enlarge still work.
- Visual baselines are per platform (`e2e/feed-visual.spec.ts-snapshots/*-darwin.png` and `*-linux.png`); fonts differ by
  OS, so a baseline is regenerated on the platform that changed (CI uploads the actual images on failure).
- The feed polls every 30 s; a socket-driven feed would contradict plan 4.5 and needs its own spec.
