# Routing

How social reads and changes the address while it runs inside the reader. The reader's router owns the URL; social owns one path
prefix (`/social`) and one value namespace of one query parameter (`ctx=social.*`). Source: `docs/PLAN.md` sections 4.3 and 4.4.

## Enforcement today

| Rule         | Check                                                                                                                      | Status     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------- |
| R1           | ESLint `no-restricted-syntax` (`eslint.config.mjs`) and `test/architecture/history.test.ts` (`checkHistory` in `rules.ts`) | Live (F0)  |
| R2, R6       | Route-tree test                                                                                                            | P1         |
| R3           | Unit tests on the `ctx` codec (`app/src/lib/ctx.ts`)                                                                       | P1         |
| R4, R5       | Host-bridged history (`app/src/surface/host-history.ts`) and its tests                                                     | S1 / P1    |
| R7, R15, R18 | Failing-then-passing tests on the harness                                                                                  | P1         |
| R8–R14       | End-to-end on the harness and against the real reader                                                                      | P3         |
| R16, R17     | Reader seam (A1) and UI specs                                                                                              | A1 / later |

The only file allowed to call `history.pushState`/`replaceState`, `location.assign`/`replace`, or assign `location`/`location.href`
is `app/src/surface/host-history.ts`. The scan covers `app/src`, `packages/session`, `packages/api-client` and `packages/relay`;
`harness/` and `packages/host-contract/` play the reader (the host) and are not scanned.

## The rules

**Ownership**

- **R1.** The reader's router is the only owner of the address bar and of `window.history`. Social code never calls
  `history.pushState`, `history.replaceState`, `location.assign`, or sets `location.href`. [lint rule + architecture test]
- **R2.** Social owns exactly one path prefix: `/social`. It defines no route outside it. [route-tree test]
- **R3.** Social owns exactly one query-parameter namespace: values of the reserved `ctx` parameter that start with `social.`.
  It reads and writes no other parameter on reader URLs. [unit test on the ctx codec; lint rule]

**The surface's own router**

- **R4.** In surface mode, the router is created with `basepath: "/social"` and a **host-bridged history**
  (`app/src/surface/host-history.ts`): `getLocation` reads `host.location.get()`; `push` and `replace` call `host.navigate`;
  it notifies on `host.location.subscribe`. `[CHECK]` the current `@tanstack/history` custom-history API.
  _Resolved by S1 ([decision 0003](decisions/0003-two-builds.md), proposed): the API is `createHistory`; the surface router
  has **no basepath** and its route tree uses the same `/social/…` paths as the Start app's file routes, so shared links build
  the same address in both modes. Tests: `app/src/surface/host-history.test.ts`, `app/src/surface/mount.contract.test.tsx`._
- **R5.** In standalone mode (development, previews) the same routes run under a normal browser history at `/social`.
- **R6.** Path grammar, complete for v1:

  | Path                 | Page                                                 |
  | -------------------- | ---------------------------------------------------- |
  | `/social`            | Feed                                                 |
  | `/social/r/$roomId`  | Room lobby: who is here, what is being learned, Join |
  | `/social/s/$shiurId` | Shiur page: scheduled, live, or recorded             |
  | `/social/settings`   | Social settings                                      |

  Ids match `^[A-Za-z0-9_-]{8,128}$` (the relay's existing path rule `[VERIFIED reader-next/relay/worker.ts:14]`). Anything else
  under `/social` renders social's not-found page inside the surface, not the reader's 404.

- **R7.** Search parameters on `/social/*` paths belong to social and are validated per route with `validateSearch`. Unknown
  parameters are dropped. Use the reader's serializer conventions (plain `k=v`, `+` is a space), since the host's router parses
  the same address.

**Entering and leaving the reader (the "enlarge" and "minimise" moves)**

- **R8.** The shareable address of a room or shiur is its `/social/...` page. It is stable; the ref being learned changes.
- **R9.** Enlarging does this, in order: (1) take `host.reader.state.getSnapshot()` and store it in memory as the viewer's own
  place, if the current route is a reader route; (2) get the target snapshot (room stream or recording keyframe) and validate it;
  (3) `host.navigate(<snapshot.url with ctx=social.room.<id> or ctx=social.shiur.<id>>)` as a **push**; (4) once
  `host.reader.context.get()` equals the expected value, apply the snapshot with origin `"follow"` or `"playback"`.
- **R10.** While a context is active, changes that arrive from the stream are applied through the state API, which navigates with
  **replace**. One enlarge is one history entry. Back leaves the room and returns to the page the user enlarged from.
- **R11.** A reader URL carrying `ctx=social.*` is a complete entry point: on a cold load or refresh the reader renders that ref
  normally, the shell loads the social surface, and `mountPersistent` reconnects from the `ctx` value alone. Never depend on
  in-memory state to recover a context. Session storage may cache, never be the only source.
- **R12.** Minimising removes the context: navigate (push) to the room's or shiur's `/social/...` page, or back to the stored
  own-place snapshot if the user enlarged from a reader page. The persistent mount keeps the connection if the session is live.
- **R13.** The user's own display settings (font size, language, layout) are never overwritten by a stream. Apply only
  moment-scoped slices from other people; personal-scoped slices are ignored on apply
  `[VERIFIED scopes in reader-next/src/lib/reader-state/core/types.ts:38]`.
- **R14.** Outgoing snapshots never include the `ctx` parameter or anything personal. Strip before publish; assert in a unit
  test with a fixture that contains both.

**Links and navigation**

- **R15.** Every in-app link renders as a real `<a href>` built with `host.href()` and is intercepted to call `host.navigate()`.
  Links to refs and library pages go through `host.reader.commands.href`. No link may leave for the legacy client.
- **R16.** Server rendering: `/social/*` requests to the reader render the shell with an empty, sized placeholder; the surface
  hydrates nothing and mounts client-side. Reserve the placeholder's space so mounting does not shift the page.
- **R17.** Sign-in required: a signed-out visitor may open `/social` pages that are public (a public shiur page). Any action that
  needs identity calls `host.viewer.requestSignIn()`; never redirect to a login URL.
- **R18.** One page surface is active at a time (whichever owns the current path). The persistent mount is independent of the
  route and must render nothing when no context or live session exists.

## The `ctx` parameter (summary of plan section 4.4)

- Grammar `^[a-z][a-z0-9]*\.[A-Za-z0-9_.-]{1,160}$`: a surface namespace, a dot, an opaque rest.
- The reader preserves it through navigation, exposes it as `host.reader.context`, and leaves it out of canonical links, snapshot
  `url`, and the share links it produces. The reader side is milestone A1.
- Social's values: `social.room.<roomId>`, `social.shiur.<shiurId>`. Codec and tests: `app/src/lib/ctx.ts` (milestone P1).

## Enlarge and minimise: the state machine

The enlarge/minimise lifecycle is a **state machine** with a discriminated union, so illegal combinations cannot be represented:

```ts
type SessionView =
  | { kind: "idle" }
  | { kind: "card"; source: SourceRef } // in a feed, no reader involved
  | { kind: "entering"; target: ContextId; ownPlace: ReaderSnapshot | null }
  | { kind: "expanded"; context: ContextId; ownPlace: ReaderSnapshot | null; following: boolean }
  | { kind: "detached"; context: ContextId; ownPlace: ReaderSnapshot | null } // broke away, still connected
  | { kind: "leaving"; context: ContextId; returnTo: string };
```

Write the allowed transitions as a table in `app/src/features/session/machine.ts` and test every allowed and every forbidden one.
