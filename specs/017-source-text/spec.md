---
id: "017"
title: The source-text renderer, and prefetch on visibility and press
status: approved
features: [FEED-017, FEED-053]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, session]
risk: normal
contract_impact: none
---

## Problem

A card shows the text being learned, not only its name. Until contract v1.1 gives social `renderSegment`, social fetches the
text from Sefaria's public text API and renders it itself, in one file so it is replaced in one place (plan 4.5). Text from
an API is untrusted markup. A feed must not fetch texts nobody looks at, and the move from a card into the room should not
wait for things that could have started when the person reached for the card.

## Acceptance criteria

- AC-001 WHEN `SourceText` is given a ref THE SYSTEM SHALL fetch it from the public text API (the reader page's origin,
  `/api/v3/texts/<ref>`, primary and translation, `return_format=text_only`), validate the answer with a schema, and render
  the first segments of the Hebrew and the English version, each in an element whose `lang` and `dir` come from that
  version's language and direction; Hebrew comes first in the Hebrew interface, English first in the English interface.
- AC-002 WHEN the text holds markup or entities THE SYSTEM SHALL render plain text only (tags removed, a few entities
  decoded, no element or attribute from the API in the DOM, never `innerHTML`); WHEN the answer fails the schema or the
  request fails THE SYSTEM SHALL show a short "text unavailable" line instead, without throwing.
- AC-003 WHEN a card's text is not yet within 200px of the viewport THE SYSTEM SHALL not request it; when it comes that
  close the request starts; the same ref is requested at most once per page while its answer is cached.
- AC-004 WHEN the person presses a live room's card (pointer down, or Enter or Space on its focused link) THE SYSTEM SHALL
  prepare the room's session (one socket, a "prefetch" hold) so the room's place is in hand when the click lands, and
  release it after 10 seconds if no enlarge followed; without a press no socket opens (spec 016 AC-003 stays true).

## Out of scope

- Rendering footnotes, commentary links, or the reader's own typography; choosing versions (the API's defaults are used).
- `prefetch(ref)` for the reader's own text (contract v1.1).

## Notes for the planner

- `lib/sefaria-text.ts`: URL builder, zod schema, `toPlainText`, a per-page cache keyed by ref (promise), `prefetchText`.
- `ui/SourceText.tsx` (+ CSS module): presentational with a small hook; `IntersectionObserver` gates the fetch.
- The harness serves recorded answers (public data) from `harness/fixtures/texts/`, so tests never call Sefaria.
- Press prefetch: `Hold` gains `"prefetch"` in `features/session/sessions.ts`; `controller.prefetch(roomId)`.
