# Verification evidence

Verified 2026-11-26 against origin/main `69361ca005` in a clean checkout with shared installed dependencies. The clean checkout excludes generated local Wrangler runtime files.

## npm run typecheck

```text
> sefaria-social@0.0.0 typecheck
> npm run typecheck -w app && tsc -p tsconfig.json --noEmit && tsc -p packages/relay/tsconfig.json --noEmit


> @sefaria-social/app@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit

```

## npm run lint

```text

> sefaria-social@0.0.0 lint
> eslint . --max-warnings=0

```

## npm run format:check

```text

> sefaria-social@0.0.0 format:check
> prettier --check .

Checking formatting...
All matched files use Prettier code style!
```

## npm test

```text
 Test Files  82 passed (82)
      Tests  496 passed (496)
```

## npm run test:arch

```text


 Test Files  6 passed (6)
      Tests  34 passed (34)
   Start at  13:26:15
   Duration  772ms (tests 46%, import 42%, transform 11%)

```

## npm run test:factory

```text


 Test Files  27 passed (27)
      Tests  207 passed (207)
   Start at  13:26:16
   Duration  9.95s (tests 97%, import 1%, transform 1%)

```

## npm run factory -- atlas --base origin/main

```text

> sefaria-social@0.0.0 factory
> node factory/cli.mjs atlas --base origin/main

atlas: PASS (132 feature(s), 424 tagged test(s), diff against origin/main checked)
```

## npm run factory -- gate --base origin/main

```text
> sefaria-social@0.0.0 factory
> node factory/cli.mjs gate --base origin/main

spec-gate: FAIL (lane: full, 26 changed file(s))
  x spec 061 not approved
    why: specs/approvals.json has no entry for 061; the work order was compiled with --draft.
    fix: A human code owner reviews specs/061-after-shiur-page/ in this PR, then runs 'npm run factory -- approve 061 --by <their email>' and 'npm run factory -- compile 061', and commits specs/approvals.json and specs/061-after-shiur-page/workorder.json.
```

## npm run factory -- prove-red --base origin/main

```text
prove-red: PASS (13 @ac test(s) run against merge base 69361ca005)
  ok app/src/server/jobs/chapters.test.ts › excludes navigation summaries and stale text summaries on navigation pages (061/AC-001): red on the merge base: AssertionError: expected [ 'texts', 'Genesis 1', …(3) ] to deeply equal [ 'Genesis 1', 'Malachi 1:7', …(1) ]
```

## npm run build:surface

```text
dist-surface/assets/chunk.vkTcyijW.js     41.78 kB │ gzip:  13.52 kB │ map:    88.47 kB
dist-surface/assets/chunk.CvJHXGCU.js     62.08 kB │ gzip:  22.19 kB │ map:   306.14 kB
dist-surface/assets/chunk.BIqN1VUa.js     92.16 kB │ gzip:  26.07 kB │ map:   528.80 kB
dist-surface/assets/surface.DaHnFyCW.js  254.14 kB │ gzip:  79.73 kB │ map: 1,211.11 kB
dist-surface/assets/call.BtmX5UnE.js     536.52 kB │ gzip: 139.48 kB │ map: 2,122.09 kB

✓ built in 181ms
```

## Application build

`npm run build` completed successfully in the primary checkout.

```text
[33m[INEFFECTIVE_DYNAMIC_IMPORT] [0msrc/server/services/recordings.ts is dynamically imported by src/server/services/rooms.ts but also statically imported by src/routes/api/v1/assets.$assetId.audio.ts, src/routes/api/v1/assets.$assetId.manifest.ts, src/routes/api/v1/assets.$assetId.media.ts, src/routes/api/v1/assets.$assetId.state.ts, src/routes/api/v1/assets.$assetId.transcript.ts, ..., dynamic import will not move module into another chunk.

✓ built in 172ms
```

## Browser verification

Locally exercised actual source excerpts, selected-source navigation, Hebrew/English display and layouts at widths 390, 700, 843, 1087 and 1440. Playback seeking and links back to Social were exercised in earlier local checks. Full Hebrew interface and 200% zoom remain to be checked.

## Merge status

Spec 061 is new and unapproved. This draft review intentionally awaits human code-owner approval; no approval record was modified by the agent. Usage tracking for the new itinerary, transcript search and source-selection interactions is flagged for technical review.

VERDICT: FAIL (spec-gate: human approval required)
