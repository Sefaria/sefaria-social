# Plan: 018 enlarge transition

- `app/src/features/feed/enlarge-transition.ts`: the three modes; `prefers-reduced-motion` checked at the moment of the
  press.
- `app/src/features/session/controller.ts`: `enlarge(roomId, opts?: { fallbackUrl?: string })`; `whenEntered(roomId, ms)`.
- `app/src/features/feed/FeedCard.tsx`: the click handler.

## Tests

- `app/src/features/feed/enlarge-transition.test.ts` (AC-002, AC-003; jsdom with a fake startViewTransition and animate).
- `app/src/features/feed/FeedCard.test.tsx` (AC-001 at component level, AC-004).
- `e2e/feed.spec.ts` (AC-001 end to end: applied ref equals the card's, no reload, Back).
