---
id: "040"
title: Calls are held to a size budget and tested end to end with fake cameras and a local LiveKit
status: approved
features: [OPS-094, OPS-095]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [session]
risk: high
contract_impact: none
---

## Problem

The LiveKit client is large next to the rest of the surface, and readers who never join a call should pay nothing for it. The
surface's bundle budget (spec 019) does not know about a lazily loaded media chunk, so the call code could creep into the entry
without anyone noticing. Calls also cannot be trusted from unit tests alone: two real browsers have to join, see and hear each
other, and keep the call while reading, and that has to run in the e2e stack without real cameras or a cloud account.

## Acceptance criteria

- AC-001 WHEN the budget check runs THE SYSTEM SHALL hold the call chunk (the LiveKit client and `features/av` code behind the
  dynamic import) to its own gzip limit in `app/surface-budget.json`, and the entry chunk's gzip size SHALL grow by no more than
  4 kB over its size before spec 034
- AC-002 WHEN the e2e stack starts THE SYSTEM SHALL run a local LiveKit server in development mode beside the relay, and start the
  social server with its development key, secret and URL and `CALLS_ENABLED=true`
- AC-003 WHEN the call journeys run THE SYSTEM SHALL launch Chromium with fake media devices and automatic permission, on the
  desktop and the phone viewports
- AC-004 WHEN the two-browser call journey runs THE SYSTEM SHALL prove: A and B join room R's call; B receives A's video and
  audio tracks; A mutes and B sees A muted; A moves to another ref and stays connected; A leaves the call and B sees A gone while
  A is still in room R
- AC-005 WHEN CI runs the e2e job THE SYSTEM SHALL run the call journeys and fail the job if any fails

## Out of scope

- Load tests and media quality measurement. Tests against LiveKit Cloud.

## Notes for the planner

- Budget: spec 019's `npm run surface:budget` and `app/surface-budget.json`; add a named chunk limit with 10–20% headroom.
- LiveKit: `livekit-server --dev` (key `devkey`, secret `secret`) or its container, in `docker-compose.yaml` and the e2e stack
  scripts beside `wrangler dev`. `[CHECK]` that GitHub's runners can run it (UDP on localhost works; use TCP fallback if not).
- Chromium flags: `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`; Playwright `permissions:
["camera", "microphone"]`.
- Assert tracks through LiveKit's client state exposed for tests (the same pattern as `window.__SEFARIA_ANALYTICS__` in the
  reader), not through pixels.
- `risk: high` because the CI workflow may need a change for the LiveKit service.
