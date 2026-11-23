# Plan: 000 hello surface

## Approach

Add `app/src/lib/surface-info.ts` with the surface id, display name and the SurfaceHost contract version it targets
(`1.0`). `FeedPage` renders the name as the heading and one line with the id and version, built from that constant, so
the version is defined once (P1 will derive it from the pinned contract).

## Files

- `app/src/lib/surface-info.ts` (new): `SURFACE` and `CONTRACT_VERSION`.
- `app/src/features/feed/FeedPage.tsx`: render the line.
- `app/src/features/feed/FeedPage.test.tsx`: the acceptance test for AC-001.

## Tests

- AC-001: render `FeedPage` to static markup and compare the whole string. On the merge base `FeedPage` exists and renders
  only the heading, so the test fails on its assertion (prove-red), not on an import.
- Tagged `// @ac 000/AC-001` and `// @feature HOST-000 Social page shows the surface name and contract version`.

## Risks

None: no routes, no server, no contract members added.
