# Plan: 015 the feed

- `app/src/server/services/feed.ts`: `getFeed(identity)`: the viewer's rooms (`listRooms`), `relayStatus` for each (at most
  20 rooms asked, in parallel), split into live and recent; shiurim visible to the viewer with `scheduled_at > now()`.
- Contract `getFeed` (`GET /api/v1/feed`, secured) in `server/api/contracts.ts` and `ENDPOINTS`; route file
  `routes/api/v1/feed.ts`; `npm run api:generate`; the op list in `api.contract.test.ts`.
- `app/src/features/feed/feed-api.ts`: `FeedApi` interface, `createFeedApi(host)` over the api-client, `FeedApiContext`.
- `app/src/features/feed/FeedPage.tsx`: signed-out prompt, loading, error alert, the three sections; polls every 30 s.

## Tests

- `app/src/api.feed.int.test.ts` (AC-001, AC-002; real Postgres, the real relay in workerd).
- `app/src/features/feed/FeedPage.test.tsx` (AC-003..AC-005; jsdom, fake host, fake FeedApi).
