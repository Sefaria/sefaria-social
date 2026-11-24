# Plan: 040 calls are held to a size budget and tested end to end with fake cameras and a local LiveKit

Built straight after spec 034 (its PR fails `surface:budget` until T-001 lands) and before 035, so every later call spec has
a real two-browser lane to run against.

## T-001 the call chunk's own budget (AC-001)

- `app/vite.surface.config.ts`: `chunkFileNames` becomes a function. A chunk that holds `livekit-client` or
  `features/av/livekit-engine.ts` is written as `assets/call.[hash].js`; every other chunk keeps `assets/chunk.[hash].js`.
- `app/scripts/release/budget.ts`: two optional keys in `app/surface-budget.json`.
  - `callChunkGzip`: the gzip limit for `assets/call.*.js`. The call chunk is measured on its own line and left out of
    `largestChunkGzip`, `totalGzip`, `totalRaw` and `files`, which keep measuring what every lab reader downloads. A build with
    a call chunk and no `callChunkGzip` fails with the fix.
  - `entryGzipBeforeCalls` (77,055 bytes: the entry measured on spec 033's branch, before spec 034) and the rule that the entry
    may be at most 4,000 bytes larger. Reported as `entryGrowthSinceCalls`.
- `callChunkGzip` is set to the measured call chunk (137.3 kB) plus about 15 % headroom: 158,000.
- Test: `factory/test/acceptance-040.test.mjs` drives the release CLI on fake builds (the same fixture block as
  acceptance-019): a call chunk within and over its limit, a call chunk with no limit, the call chunk not counted in the other
  totals, and the entry 4,001 bytes over the baseline. It fails on the base because the CLI ignores the call chunk there.

## T-002 the two-browser call journey (AC-002 to AC-005)

- `e2e/stack/start.ts` starts LiveKit in development mode beside the relay: the `livekit-server` binary when it is on the
  PATH, otherwise `docker run livekit/livekit-server:v1.13.11 --dev --bind 0.0.0.0 --node-ip 127.0.0.1` with ports 7880,
  7881 and 7882/udp. It waits for `http://127.0.0.1:7880`. The Start server gets `LIVEKIT_URL=ws://127.0.0.1:7880`,
  `LIVEKIT_API_KEY=devkey`, `LIVEKIT_API_SECRET=secret` (LiveKit's fixed development pair) and `CALLS_ENABLED=true`. Ports in
  `e2e/stack/config.ts`. `docker-compose.yaml` is the Coolify deployment (LiveKit Cloud there), so it gains no LiveKit service; instead its `app` service lists `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and `CALLS_ENABLED`, because Coolify passes a variable into a service only when the file names it. Coolify substitutes an empty string for an unset variable, so `app/src/server/config.ts` treats an empty call variable as unset (unit test `config.test.ts`); otherwise an unset variable would stop the server from starting.
- `e2e/calls.spec.ts`, on the desktop and phone projects: Chromium with `--use-fake-device-for-media-stream` and
  `--use-fake-ui-for-media-stream`, and `camera` and `microphone` permissions. Two contexts, A and B, in one room. Assertions
  go through the page, not test hooks: B's tile for A has a `video` element whose `videoWidth` is above 0 (frames arrived), and
  an `audio` element in B's page is playing; A's microphone off shows A muted in B's tile; A moves to another ref and A's panel
  stays `in-call` with one connection; A leaves the call, B's tile for A goes, and A still has the room's follow bar.
- AC-005: `factory/test/acceptance-040.test.mjs` also checks that CI's e2e job runs `npm run test:e2e` and that the
  Playwright config does not ignore `calls.spec.ts`. GitHub's Ubuntu runners have Docker, so the job needs no new step.

## Risks

- WebRTC between Chromium on the host and LiveKit in Docker on macOS needs `--node-ip 127.0.0.1` and the UDP port mapped; if UDP
  fails, LiveKit falls back to TCP on 7881.
- First run pulls the image (about 50 MB).
