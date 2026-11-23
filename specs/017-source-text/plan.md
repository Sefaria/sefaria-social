# Plan: 017 source text and prefetch

- `app/src/lib/sefaria-text.ts`: `textUrl(ref)`, `TextAnswer` schema, `toPlainText`, `fetchText(ref)` with a cache,
  `refTitles(ref)` for spec 016.
- `app/src/ui/SourceText.tsx`, `source-text.module.css`: `useSourceText(ref, visible)`; `useNearViewport(el, 200)`.
- `harness/fixtures/texts/*.json` recorded by `harness/fixtures/record-texts.mjs` (trimmed to the fields used);
  `harness/serve.mjs` serves `/api/v3/texts/<ref>` from them (404 otherwise).
- `features/session/sessions.ts`: `Hold` gains `"prefetch"`; `features/session/controller.ts`: `prefetch(roomId)` holds for
  10 s unless an enlarge takes over; `features/feed/FeedCard.tsx` calls it on pointer down and Enter/Space.

## Tests

- `app/src/lib/sefaria-text.test.ts` (AC-002 plain text, cache).
- `app/src/ui/SourceText.test.tsx` (AC-001..AC-003, jsdom, a fake IntersectionObserver, recorded fixtures).
- `app/src/features/feed/FeedCard.test.tsx` (AC-004, test relay counts sockets, fake timers).
