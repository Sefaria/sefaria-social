---
id: "056"
title: A posted room or broadcast card shows, live, the text its leader is on
features: [API-051, FEED-076]
status: proposed
owner: "@Sefaria/sefaria-social-owners"
surfaces: [api, relay, feed]
risk: high
contract_impact: api-minor
---

## Problem

Spec 055 turns a posted room, broadcast or recording link into a card, but the card does not say whether anyone is there or
what they are learning. The owner wants the card to show, live, the text the session is on (decision 0011, D9), without the
feed opening a socket per card. Plan: `docs/plans/shiur.md` 4.7 ("Live status", proposed mechanics).

## Acceptance criteria

- AC-001 WHILE people are connected to a room or broadcast THE SYSTEM (the relay) SHALL report the leader's current ref, Hebrew
  ref, title and the number connected to the social server, signed with the relay's internal secret, when any of these changes
  and at least once a minute, and once when the last person leaves, but never more than one report per room per 5 seconds
  (a change inside the 5 seconds is sent at their end)
- AC-002 WHEN the social server receives a report THE SYSTEM SHALL accept it only with a valid signature and a timestamp within
  5 minutes (401 otherwise) and keep the latest one per room; a report for a room or broadcast that does not exist SHALL be
  ignored
- AC-003 WHEN anyone, signed in or not, asks `GET /api/v1/live?ids=…` with 1 to 50 ids THE SYSTEM SHALL answer in one response
  `[{id, kind, live, ref, heRef, here, updatedAt}]` for each id that a post embeds, leaving out every other id; `live` SHALL be
  true only for a report under 3 minutes old with people connected (and, for a broadcast, while it is live); more than 50 ids
  SHALL be refused with 400; the answer SHALL carry an `ETag`, and a request whose `If-None-Match` equals it SHALL get 304
- AC-004 WHILE a post's live card is on screen and the tab is visible THE SYSTEM SHALL ask for the status of the cards on screen
  in one request every 15 seconds and show a Live badge, the ref (in Hebrew in the Hebrew interface) and that text, or, when
  not live, "Not live" with the last known ref; cards off screen and a hidden tab SHALL send no requests
- AC-005 WHEN the leader of a live room moves to another text THE SYSTEM SHALL show the new ref on the room's card in the feed
  within 20 seconds

## Out of scope

- WebSockets or server push to the feed, live state for recordings (they are never live), the number of people on a call.
- Whether a signed-out person may join a live room from the card (plan section 8).

## Notes for the planner

- Relay (`packages/relay/src/`): a pure throttle (`live-report.ts`: what changed, when the next report may go) used by the
  `Room` object; it POSTs to `SOCIAL_SERVER_URL` + `/api/v1/internal/relay/live` with `x-relay-signature: sha256=<hmac hex>`
  over the raw body (the format of `server/webhooks/signature.ts`) using `RELAY_INTERNAL_SECRET`. Unset URL: no reports.
  `SOCIAL_SERVER_URL` is a new relay variable: a setup-checklist step, not a change to `wrangler.toml` here.
- Server: access `relay-report` in `http/endpoint.ts`; table `live_status (relay_room text pk, room_id → rooms cascade, ref,
he_ref, title, participants, reported_at)`, migration `0008_live_status` (expand only, no user ids). When there is no fresh
  report the server may read the relay's status (`services/relay.ts`, as the feed does) so cards work where the relay has no
  server URL yet; both go through a 5-second in-memory cache.
- `GET /api/v1/live` is added to `PUBLIC_ENDPOINTS` with its reason: it answers only for sessions a post has made public (D9).
- The endpoint wrapper learns to send an `ETag` and answer 304 (no body) for a matching `If-None-Match`.
- Client: `features/post/live-status.ts` (one poller per page: IntersectionObserver + `visibilitychange`, ids batched) and
  `EmbedCard.tsx` from spec 055. The text comes from the reader's text API (`ui/SourceText`), as feed cards do.
