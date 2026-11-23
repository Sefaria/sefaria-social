# Plan: 002 surface, harness and routes

## Approach

Decision 0003: two thin route trees (Start file routes; a code-based surface tree) over shared definitions in
`app/src/features/shell/social-routes.ts` and shared page components, same `/social/…` paths, no basepath. The surface router
uses `createHostHistory(host)` (`app/src/surface/host-history.ts`, TanStack `createHistory`). `app/src/surface/entry.ts`
default-exports the Surface: `mountPage` checks the host, creates the router and renders; `mountPersistent` renders the
ctx-driven view. The surface build (`app/vite.surface.config.ts` + `app/surface-build.ts`) writes the manifest and refuses
server imports. The harness (`harness/`) loads the build through the manifest into the fake host over the browser history.

## Tests

- AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-010, AC-012, AC-013: `app/src/surface/mount.contract.test.tsx` and
  `app/src/surface/host-history.test.ts` (jsdom, fake host).
- AC-008, AC-009: `app/src/route-trees.test.ts` (entry level, imports both trees).
- AC-001: `app/src/surface/build.contract.test.ts` (runs the real build).
- AC-011: `e2e/harness.spec.ts` (Playwright, desktop and phone, English and Hebrew).

## Risks

`createHistory` is not in TanStack's public docs; `host-history.test.ts` pins the behaviour we use.
