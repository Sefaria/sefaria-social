---
id: "033"
title: A room member can get a LiveKit token to join the room's call
status: approved
features: [API-046, SESS-056]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [session, api, identity]
risk: high
contract_impact: api-minor
---

## Problem

Learners in a room want to see and hear each other while they learn, the way they would on a video call, without leaving the
reader (design: `docs/design/audio-video.md`). Media goes to LiveKit, and LiveKit admits only a client holding an access token
signed with our LiveKit API secret. That secret must stay on the social server, and the token must say exactly who the person
is (their Sefaria user id, never the hashed username) and what they may do in which room. Nothing today issues such a token.

## Acceptance criteria

- AC-001 WHEN a signed-in member of a room calls `POST /api/v1/rooms/{roomId}/call/token` and calls are available THE SYSTEM
  SHALL answer 200 with `{ url, token, expiresAt }`, where `url` is the configured LiveKit URL and `token` is a LiveKit access
  token for the room `room_<roomId>` with identity `u:<sefaria user id>`, the display name from the display cache, an expiry 10
  minutes after issue (equal to `expiresAt`), and metadata `{"v":1,"role":"owner"|"member"}` from `room_members`
- AC-002 WHEN a token is issued to a member or owner of a room THE SYSTEM SHALL grant `roomJoin` for that room only,
  `canSubscribe`, `canPublish` limited to the sources microphone, camera and screen share, and `canPublishData: false`
- AC-003 WHEN the caller is not a member of the room, or the room does not exist THE SYSTEM SHALL answer 404 with the same body
  in both cases and issue no token
- AC-004 WHEN the request has no Django identity token or an invalid one THE SYSTEM SHALL answer 401 and issue no token
- AC-005 WHEN calls are not available (any of `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` unset, or `CALLS_ENABLED`
  not `true`) THE SYSTEM SHALL answer 503 with error code `call.unavailable` to the token request, and `GET /api/v1/rooms/{id}`
  for a member SHALL include `calls: { available: false }` (`true` when available)
- AC-006 WHEN one user makes more than 20 token requests for the same room within a minute THE SYSTEM SHALL answer 429 with error code
  `request.rate_limited` and a `retry-after` header (seconds) to the excess requests
- AC-007 WHEN a token request is handled, successfully or not THE SYSTEM SHALL log neither the token, nor the API key, nor the
  API secret, nor the caller's Django token
- AC-008 WHEN the OpenAPI document is generated THE SYSTEM SHALL include the token endpoint and the `calls` field, and the
  generated client SHALL expose them; the change is additive (api-minor)

## Out of scope

- Shiur roles (a teacher who publishes and listeners who only subscribe): a later spec, when live shiurim have their own
  session (spec 032 starts them).
- Moderation (spec 039), webhooks and call status (spec 038), any client UI (specs 034, 035).
- Choosing LiveKit Cloud or self-hosted (owner decision D-AV1); the code is the same, only the three variables differ.

## Notes for the planner

- `livekit-server-sdk` `AccessToken` with `addGrant({ roomJoin, room, canSubscribe, canPublish, canPublishSources,
canPublishData })`, `ttl: "10m"`, `metadata`. `[CHECK]` the current SDK version and grant names.
- New `app/src/server/services/livekit.ts` (minting, later moderation and webhooks); thin route under
  `app/src/routes/api/v1/`. Configuration in `app/src/server/config.ts` beside `RELAY_INTERNAL_SECRET`.
- Membership check: the same query `GET /rooms/{id}` uses (decision 0008: a non-member gets 404).
- LiveKit only checks the token when a client connects, so the 10-minute expiry does not end a call; the client asks for a new
  token to reconnect (spec 034).
- Rate limiting: reuse the server's limiter if one exists; otherwise a small per-user window. `[CHECK]` what exists.
- Owner decision D-AV2 (who may publish in a room): this spec takes the proposed default, every member.
- Owner decision D-AV4 (minors) is open: `CALLS_ENABLED` stays `false` in production until it is answered.
