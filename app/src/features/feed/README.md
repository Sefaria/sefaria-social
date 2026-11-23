The feed at `/social` (specs 015–018): `Feed.tsx` (sections, polling, signed-out prompt), `FeedCard.tsx` (the light card: no
reader, no socket until a press), `enlarge-transition.ts` (the card grows into the reader), `feed-api.ts` (the API behind a
small interface; tests inject a fake through `FeedApiContext`). `FeedPage.tsx` is spec 000's frame around it. Decision 0009.
