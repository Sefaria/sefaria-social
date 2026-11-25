# Plan: 056 live cards

Plan: `docs/plans/shiur.md` 4.7 (proposed mechanics). Decision: `docs/decisions/0012-links-and-live-cards.md`.

## T-001 The relay reports each room's live state to the server (AC-001)

- `packages/relay/src/live-report.ts` (pure): `LiveReporter` with `observe(status, now)` → what to send now or when to look
  again; sends on a change of ref, heRef, title or the number connected, at least every 60 s while anyone is there, once more
  when the room empties, never two within 5 s (a change inside the window is sent at its end, with the latest values);
  `signReport(secret, raw)` (Web Crypto HMAC-SHA256, `sha256=<hex>`, the format of the server's webhook signature).
- `worker.ts`: `Env.SOCIAL_SERVER_URL` (unset: no reports). The `Room` object keeps a reporter, observes after every delivered
  message and on its once-a-second tick, and POSTs `{room, at, ref, heRef, title, participants}` to
  `/api/v1/internal/relay/live` (2 s timeout, no retry: the next change or the minute's report repeats it; `waitUntil`).
- `e2e/stack/start.ts` passes `SOCIAL_SERVER_URL` to `wrangler dev`.
- Tests: `packages/relay/src/live-report.test.ts` (the throttle with a fake clock: 3 moves in 2 s give 2 reports 5 s apart,
  the minute's report, the empty report, the signature) and a case in `relay.test.ts` (Miniflare posting to a local HTTP
  server: a publisher's move arrives signed).

## T-002 The server keeps reports and answers `GET /api/v1/live` (AC-002, AC-003)

- Migration `0008_live_status.sql` (expand only): `live_status (relay_room text pk, room_id uuid → rooms on delete cascade,
  ref, he_ref, title, participants int, reported_at timestamptz)`; holds no user ids.
- `http/endpoint.ts`: access `relay-report` (HMAC of the raw body with `RELAY_INTERNAL_SECRET`, 503 when unset, 401 on a bad
  signature); a handler may return `headers` (the `ETag`), and a declared 304 is sent without a body.
- `http/public-routes.ts`: `GET /api/v1/live`, with its reason.
- `services/live.ts`: `receiveReport` (timestamp within 5 minutes, else 401; maps `b_<id>` to its broadcast's room; ignores
  unknown rooms; keeps the newest by `at`); `liveStatus(ids)` (only ids some live post embeds; kind from the embed; `live` from
  a report under 3 minutes old with people there, and for a broadcast while it is live; when there is no fresh report, the
  relay's status read through `services/relay.ts`); a 5-second in-memory cache per id; the ETag is a hash of the answer.
- Contracts `relayLiveReport` (POST `/api/v1/internal/relay/live`) and `getLiveStatus` (GET `/api/v1/live`, `ids` a
  comma-separated list of 1–50 uuids), routes `internal.relay.live.ts` and `live.ts`, OpenAPI and the client.
- Tests: `app/src/api.live.int.test.ts` (real Postgres, signed reports, the public read, 50/51 ids, ETag/304, stale reports).

## T-003 The card polls and shows the text (AC-004, AC-005)

- `features/post/live-status.ts`: one poller per API object: cards register their id and element; an IntersectionObserver
  keeps the visible set; every 15 s, while `document.visibilityState === "visible"` and something is visible, one request
  for the visible ids (batches of 50) with `If-None-Match`; results go to subscribers. A hidden tab stops the timer; becoming
  visible reads at once.
- `EmbedCard.tsx`: for a room or broadcast, the Live badge or "Not live", the ref (heRef in Hebrew) and `SourceText`.
- `social-api.ts`: `liveStatus(ids)`.
- Tests: `features/post/live-status.test.ts` (fake timers, a fake IntersectionObserver and visibility: only visible ids, no
  request while hidden, one batched request) and `post-embeds.test.tsx` cases; `e2e/live-cards.spec.ts` (AC-005: a publisher
  that owns the room moves from Genesis 1 to Genesis 2 and the card in another browser shows Genesis 2 within 20 s).
