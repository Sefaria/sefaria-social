# 0003. Two builds: two thin route trees, a host-bridged history, no basepath

- Status: proposed (spike S1; the owner confirms by approving the PR)
- Date: 2026-11-23
- Deciders: spike S1 worker; a human owner confirms

This is the record the plan calls `0001-two-builds.md` (sections 4.1 and 8, S1). Number 0001 was left free by F0; the
orchestration asked for 0003.

## Context

Plan 4.1 asks one codebase to serve two builds: the TanStack Start app (server, API, standalone pages) and a client-only
surface library that the reader loads at runtime. It left three `[CHECK]` items: can one generated route tree back both
builds; what is the current custom-history API (`@tanstack/history`); and R4's router with `basepath: "/social"`.

What was tried (all in this repository, versions `@tanstack/react-router` 1.170.46, `@tanstack/history` 1.162.5,
`@tanstack/react-start` 1.169.7, Vite 8.3.8):

1. **Importing the generated tree into the surface.** `app/src/routeTree.gen.ts` ends with
   `declare module '@tanstack/react-start' { interface Register { ssr: true; router: … } }` and imports every file route.
   The root route renders `<html>` with `<Scripts />`, and from P2 on the tree contains `app/src/routes/api/*` server routes
   whose handlers import `app/src/server`. In the Start build the Start plugin strips server code from the client bundle; the
   surface's plain library build has no such transform. Importing the tree would put the Start runtime and server modules
   into the surface bundle (plan 4.1 forbids both; `test/architecture` rule (b) and the build's own guard refuse them).
2. **Custom history.** The docs (<https://tanstack.com/router/latest/docs/framework/react/guide/history-types>) document
   browser, hash, memory and server histories and passing one to `createRouter({ history })`; they do not document
   `createHistory`. It is exported from `@tanstack/react-router` and typed in
   `node_modules/@tanstack/history/dist/esm/index.d.ts`: `createHistory({ getLocation, getLength, pushState, replaceState,
go, back, forward, createHref, flush?, destroy?, getBlockers?, setBlockers?, notifyOnIndexChange? })`, returning a
   `RouterHistory` whose `notify(action)` re-reads the location and tells the router. `push`/`replace` add `__TSR_index` and
   `__TSR_key` to the state and call our `pushState`/`replaceState`, then notify. Because it is undocumented, it is pinned by
   our tests (`app/src/surface/host-history.test.ts`), not by the docs.
3. **`basepath: "/social"`.** The options docs
   (<https://tanstack.com/router/latest/docs/framework/react/api/router/RouterOptionsType>) describe basepath as a rewrite
   that strips the prefix on input and adds it on output (`router-core/dist/esm/rewrite.js`). A throwaway script with a
   basepath router over a memory history showed `/social/settings` matching `/settings`, `/settings` and `/Genesis.1`
   matching nothing, and `buildLocation({ to: "/settings" })` giving `/social/settings`. So basepath works, but its route
   paths are `/settings`, while the Start app's file routes are `/social/settings` (the Start app also serves `/api/v1/*`
   at the root, so it cannot take a `/social` basepath without moving the API).
4. **The whole loop in a real browser.** `npm run build:surface` emitted `assets/surface.<hash>.js`, four lazy/shared
   chunks, one CSS file and `manifest.json`. The harness (built page + `harness/serve.mjs`) loaded it through the manifest
   with `modulepreload` + SRI exactly as the reader does, mounted it on `/social/r/room-00001` (deep link), and a Chromium
   run went: room → Settings (push through `host.navigate`) → tab Notifications (push, `?tab=notifications` in the reader's
   plain serializer) → Back → Back (room) → Forward (settings); `/social/r/bad` and `/social/x/y` rendered social's
   not-found; `/Genesis.1?ctx=social.room.room-00001` showed the persistent mount's link, which navigated back into the
   room. The Start dev server rendered the same components for `/social/r/room-00001` (SSR HTML contains
   `data-social-page="room"`), and 404 with social's not-found for `/social/r/bad`.

## Decision

- **Two thin route trees, shared everything else.** The Start app keeps its file routes (`app/src/routes/social.*.tsx`,
  generated tree). The surface has a code-based tree (`app/src/surface/route-tree.tsx`). Both trees are a few lines per route
  over the same definitions in `app/src/features/shell/social-routes.ts` (path grammar R6, search validation R7, the id
  guard) and the same page components and frame. `app/src/route-trees.test.ts` fails if the two trees' paths differ or any
  path leaves `/social` (R2).
- **Same full paths, no basepath.** Both trees use `/social/…` paths. The surface router has no `basepath`, so a shared
  `<Link to="/social/settings">` builds the same address in both modes and type-checks against the one registered router.
  This is a deliberate change to R4's wording; R4's intent (the surface router only ever addresses `/social`) is kept by the
  paths themselves and the parity test.
- **Host-bridged history** (`app/src/surface/host-history.ts`): `createHistory` with `getLocation` reading
  `host.location.get()` (state validated with zod; entries the reader created get a stable `host:<href>` key), `pushState` /
  `replaceState` calling `host.navigate(path, { replace, state })`, `createHref` calling `host.href`, and
  `host.location.subscribe` calling `history.notify` (BACK/FORWARD by `__TSR_index`, deduplicated against our own pushes).
  `go`/`back`/`forward` are not in SurfaceHost v1: they report `surface-history-unsupported` and do nothing; the user moves
  through history with the browser and the reader notifies us.
- **No scroll restoration in the surface router**: TanStack's would write `window.history.scrollRestoration`, which is the
  reader's (R1).
- **The F0 layers rule is not relaxed.** The surface never imports the generated tree, so rule (a) stands as written. The
  parity test is an entry-level file (`app/src/route-trees.test.ts`), which may import both trees.
- **Surface build**: Vite library mode, ES format, `cssCodeSplit: false`, fixed names `assets/surface.[hash].js`,
  `assets/chunk.[hash].js`, `assets/social.[hash].css`; a plugin writes `manifest.json` validated against the pinned reader
  schema (sha384 per file); another refuses `@tanstack/react-start` and `app/src/server` imports at build time. The Vite
  config needs `--configLoader runner`, because the default loader runs the workspace package's TypeScript through Node.

## Consequences

- Plan 4.1 "Both builds use the same route components … decide the mode from router context": kept for components; the
  root differs by tree (the Start root renders `<html>`, the surface root never does), so no runtime mode switch is needed.
  The surface router's context still carries `{ mode: "surface", host }`.
- Plan R4 "created with `basepath: "/social"`": replaced by "the surface tree's paths start with `/social`; no basepath".
  `docs/ROUTING.md` notes this. `.claude/rules/routing.md` keeps R1–R18 verbatim and is a protected path; the owner should
  decide whether to amend it there too (listed in `docs/runbooks/setup-checklist.md`).
- Adding a page means one file route and one entry in the surface tree; the parity test catches a missed one.
- `history.back()` from social code is unavailable until the contract offers it (a v1.1 candidate: `host.back()`); minimise
  (R12) is specified as a push anyway.
- The surface bundle is identifier-mangled but keeps whitespace (Vite's library ES output); size work belongs to P5.
- `createHistory` is not in the public docs; a TanStack upgrade that changes it fails `host-history.test.ts` first.
