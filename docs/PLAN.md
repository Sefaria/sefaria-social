# Sefaria Social: implementation plan and software factory

Hand-off document for an implementing agent (Claude Opus, cloud session). Written 2026-11-22.

Read sections 0–3 before doing anything. Sections 4–7 are the build. Section 8 is the ordered work. Section 9 lists what a human must
do or decide; do not guess those.

---

## 0. How to use this document

- **You are building two things:** a product (Sefaria Social) and the factory that builds it (specs, gates, tests, review, retros).
  Build the factory first. Every product feature after milestone F1 goes through the factory, including your own work.
- **Verify before you rely.** Facts marked `[VERIFIED <path>]` were read from code on 2026-11-22. Facts marked `[CHECK]` come from
  documentation research or memory and must be confirmed against current docs before you depend on them (TanStack Start and Router
  APIs, `claude-code-action` inputs, Playwright agent commands, Cloudflare APIs). When code and this plan disagree, code wins; record
  the difference in `docs/decisions/`.
- **Stop and ask** when a step needs something in section 9 that has not been provided. Do not invent secrets, repo names, domains or
  policy.
- **Two repositories are touched.** The new repo (`sefaria-social`, Part B and the factory) and the existing `Sefaria-Project`
  (Part A: a small host seam in `reader-next/` plus two Django additions). A cloud session works in one repo; Part A is a separate
  session on a branch cut from `reader-next`. Part B does not wait for Part A: it develops against a fake host (section 4.6).

---

## 1. What we are building

Sefaria Social lets people learn together in the Sefaria reader: shared rooms, following another learner's place, presence on
segments, chat about refs, live and recorded shiurim, a feed of these. Later: audio and video.

### 1.1 Architecture in one picture

```
 browser, one document (www.sefaria.org, new reader only)
 ┌───────────────────────────────────────────────────────────────────────┐
 │ SHELL (reader-next root): header, sign-in, router, surface loader      │
 │  ├─ READER surface (built in)      routes: refs, library, search …     │
 │  └─ SOCIAL surface (loaded at runtime from the social deployment)      │
 │       ├─ page mount        /social/*          feed, lobby, shiur pages │
 │       └─ persistent mount  any route          room link, mini view,    │
 │                                               follow bar, later A/V    │
 └───────────────▲───────────────────────────────────────▲───────────────┘
                 │ SurfaceHost contract v1 (plain JS)     │
                 │ reader state API + versioned commands  │ HTTPS + Bearer token
                                                          ▼
   Django ── issues short-lived identity token ──▶  SOCIAL SERVER (TanStack Start, own Postgres)
   Django ── user-deleted webhook ───────────────▶  SOCIAL SERVER
                                                    RELAY (Cloudflare Worker + Durable Object per room)
```

### 1.2 Decisions already made (by the owner, in the design conversation)

1. Social is its own repo and ships on its own schedule.
2. The reader is the host. Social is a **surface** loaded into the reader page at runtime, the way the Library Assistant is. The
   reader is not embedded in social.
3. Social talks to the reader only through a contract: the reader state API, the versioned workspace commands, and a small host API.
4. Social has its own server and its own data. It learns who the user is from Django.
5. The social app is a TanStack Start app using TanStack Router.
6. In a feed, a shiur is a light card (library content, no reader). Enlarging it takes over the page's single reader with the
   shiur's state stream; the URL carries the room or shiur id.
7. The surface design must allow more surfaces later. Do not build a plugin framework: build for one surface, namespace everything.

### 1.3 Constraints that already bind (from the Sefaria wiki and the reader's decision log)

- The new reader is opt-in: nginx serves it only with the cookie `reader_version=next`. Social therefore reaches only those users.
- Labs features (follow me, recording, relay) are **off** at reader launch (reader decision D-10). Every new feature sits behind its
  own gate on top of the opt-in. Social gets its own lab gate, off by default.
- "The reader API" in this plan means two existing things plus a small host object. The **state API** (`getSnapshot`,
  `applySnapshot`, `subscribe`; `reader-next/src/lib/reader-state/core`) captures and restores what is on screen. The **workspace
  commands** (`current`, `go`, `href`, `canonicalize`; `reader-next/src/lib/workspace/commands.ts`) are the reader's own
  navigation layer underneath it: they read the open panels from the address, send a panel somewhere, and build links. The
  reader's decision log says other apps navigate through those commands. Social uses the state API to follow and restore, and the
  commands to open a ref or build a link. It never writes the reader's URL itself.
- No exits to the legacy client: every link social renders to a Sefaria page goes through the host's navigation.
- Browser error reporting must exist before real users see a feature (Datadog browser logs/RUM; Sentry is gone).
- User identity is django-allauth inside Django; there is no separate user-authentication service. (The Go `auth-service/` in
  Sefaria-Project classifies requests by API key, ships switched off, and does not authenticate people.) Section 6.1 has the
  facts and the options.
- Agent code review is advisory only (agents-platform decision). A human approves merges.
- Account deletion in Django does not currently notify anything outside Django, and already leaves some stores behind. Social's
  data must be covered explicitly (section 6.3).
- House rules: no ticket ids in source files; keep agent PRs small; the repo is public, so no personal data in fixtures.

---

## 2. The factory: principles

The factory is designed from current published practice (sources in section 10) and from the owner's library notes. Where sources
disagree, the choice and the reason are stated.

1. **Level 4, not a dark factory.** Agents write, test and review. Deterministic checks gate merges. A human approves every merge
   and every spec. Reason: published critiques of fully unreviewed factories (circular AI-judging-AI, maintainability erosion), and
   the wiki's advisory-only rule for agent review.
2. **The spec is the shared asset, and it is an artifact, not prose.** A spec is acceptance criteria plus executable acceptance
   scenarios plus, for UI, a mockup. Anyone may write it, an agent included; specs are open to agents to read and to draft.
   What makes it the shared asset is that **a human agrees to it** before any code is built from it, and agrees again to any
   change.
2a. **Every feature is recorded as it is built.** The repo keeps a feature atlas, like the reader's: one entry per feature,
   created when the spec is agreed, updated by the same PR that builds it, and checked against the tests (section 5.10).
3. **The work order is the deliverable agents execute.** A deterministic compiler turns an approved spec and its task list into
   `workorder.json`. Agents build from the work order, one task per session.
4. **No spec, no code — enforced twice.** A local hook refuses edits to product code without an active work order. A CI gate
   refuses a PR whose changes are not covered by one. Nobody has published such a gate; this one is ours, so it ships with negative
   tests that prove it fails when it should.
5. **Rules that must hold are code, not sentences.** "Always" and "never" live in hooks, linters, architecture tests and CI gates,
   each with a remediation message that tells an agent how to fix the failure. `CLAUDE.md` stays short and holds the map and the
   non-obvious gotchas.
6. **The writer never grades its own work.** Review, QA and scenario judging run in fresh contexts with separate prompts. Holdout
   scenarios live where the building agent cannot read them.
7. **Evidence, not assertion.** A claim of "verified" is a command and its output. A QA pass is a line from the tester's own
   session. "The code looks correct" is not evidence.
8. **A green check must prove something.** Every guard has a negative test (inject the fault, expect red). A scheduled check
   confirms that the tests that exist are the tests that ran.
9. **The factory is measured and pruned.** CI writes metrics on every run. A weekly retro agent reads them, tracks whether last
   week's actions were done, and proposes the smallest change. Harness parts that stop earning their cost are removed.
10. **Start simple.** One reviewer, one QA loop, one judge per scenario. Add machinery only when a recorded failure demands it.

---

## 3. Repository layout (new repo)

Use npm workspaces (the reader uses npm). Node version: match `reader-next/package.json` `engines`. Dev port **3200**
(3100 is the reader, 3000 is taken).

```
sefaria-social/
  CLAUDE.md                 # the map + non-negotiables + gotchas (≤150 lines)
  AGENTS.md                 # one line: "See CLAUDE.md" (for other agent tools)
  REVIEW.md                 # what the review agent checks, severity scale
  .claude/
    settings.json           # hooks, permission deny rules
    rules/                  # path-scoped rules (frontmatter `paths:`)
    skills/                 # shape-spec, plan-spec, build-task, verify, qa-plan, qa-run, retro, contract-sync
    agents/                 # reviewer, skeptic, qa-runner, test-writer
    hooks/                  # guard-paths.mjs, post-edit-check.mjs, stop-verify.mjs
  .github/
    workflows/              # section 5.8
    CODEOWNERS
  app/                      # the TanStack Start app
    src/
      routes/               # file routes: UI and `api/` server routes
      surface/              # entry.ts (mount), host-history.ts, host-context.tsx
      features/             # feed/, room/, shiur/, presence/, session/
      server/               # server-only: db/, auth/, services/, webhooks/
      lib/                  # pure, shared by both sides (schemas, ids, ctx codec)
      ui/                   # presentational components
    vite.config.ts          # Start build (server + standalone pages)
    vite.surface.config.ts  # library build of the surface bundle
  packages/
    host-contract/          # pinned copy of the reader's contract + zod schemas + the fake host
    session/                # room protocol and client
    relay/                  # Cloudflare Worker + Durable Object
    api-client/             # typed client generated from the server's OpenAPI document
  harness/                  # fake reader page that loads the surface (dev and e2e)
  e2e/                      # Playwright
  specs/                    # NNN-slug/{spec.md, acceptance.feature, mockup.html?, plan.md, tasks.yaml, workorder.json}
  factory/                  # compile, gate, doctor, metrics, prove-red, surface-map.yaml, quarantine.yaml, schemas/
  docs/                     # ARCHITECTURE.md, ROUTING.md, CONTRACT.md, decisions/, runbooks/, retros/, QUALITY_SCORE.md
```

**Layer order, enforced by an architecture test:** `lib` → (`server` | `ui`) → `features` → `routes` | `surface`.
`surface/`, `features/`, `ui/` and `lib/` never import from `server/`. `server/` never imports React.

---

## 4. Part B: the social app

### 4.1 One codebase, two builds

| Build | Config | Output | Runs |
|---|---|---|---|
| Start app | `vite.config.ts` | Node server | The social API (`/api/v1/*`), webhooks, health, and standalone pages used by development and previews |
| Surface | `vite.surface.config.ts` | ES module `surface.[hash].js`, chunks, one CSS file, `manifest.json` | Inside the reader page |

Rules:

- The surface bundle is **client only**. It must not import `@tanstack/react-start`, `createServerFn`, or anything under
  `server/`. It reaches the server only through `packages/api-client` over HTTPS. An architecture test enforces this, and the
  surface build fails on a forbidden import.
- The surface bundles **its own React** and its own TanStack Router and Query. Nothing React crosses the contract: no components,
  no context, no hooks. The contract is DOM elements and plain objects.
- Both builds use the same route components. The route tree's root renders a document shell (`<html>`) only in standalone mode;
  in surface mode it renders content only. Decide the mode from router context (`mode: "surface" | "standalone"`), the way the
  reader's root branches for standalone pages `[VERIFIED reader-next/src/routes/__root.tsx]`.
- `[CHECK]` Confirm against current TanStack docs that one generated route tree can back both a Start build and a plain
  `createRouter` library build. If it cannot, keep the route *components* shared and define two thin route trees. Record the
  outcome in `docs/decisions/0001-two-builds.md`. This is spike S1 and it comes first (section 8).

### 4.2 The surface contract (SurfaceHost v1)

The reader calls the surface; the surface receives a host object. Canonical source: `reader-next/contract/surface-host.v1.ts`
plus a JSON Schema generated from it (created in Part A). The social repo keeps a **pinned copy** in `packages/host-contract/`
with the reader commit it came from. Types are generated from the schema, never hand-copied.

```ts
// What the surface bundle exports (default export of the entry module)
interface Surface {
  id: "social";
  contract: 1;                                   // SurfaceHost major version it was built for
  mountPage(el: HTMLElement, host: SurfaceHost): Unmount;        // full-page view under /social/*
  mountPersistent(el: HTMLElement, host: SurfaceHost): Unmount;  // survives navigation; mini view, room link
}

// What the reader hands it
interface SurfaceHost {
  contract: { major: 1; minor: number };
  location: {
    get(): { pathname: string; search: string; hash: string; state: unknown };   // full reader location
    subscribe(cb: () => void): Unsubscribe;
  };
  navigate(to: string, opts?: { replace?: boolean; state?: unknown }): void;      // the only way to change the URL
  href(to: string): string;                                                       // for <a href>, respects host and language
  reader: {
    state: ReaderStateApi;                 // getSnapshot / applySnapshot / subscribe / onLocalInput / applying
    commands: WorkspaceCommands;           // the reader's versioned commands: current / go / href / canonicalize
    context: {                             // the reserved `ctx` URL parameter, section 4.4
      get(): string | null;
      subscribe(cb: () => void): Unsubscribe;
    };
  };
  viewer: {
    get(): { id: number; name: string; imageUrl?: string } | null;
    subscribe(cb: () => void): Unsubscribe;
    identityToken(): Promise<string>;      // short-lived token from Django, section 6.1; rejects when signed out
    requestSignIn(): void;                 // opens the reader's sign-in
  };
  ui: { interfaceLang: "english" | "hebrew"; theme: "light" | "dark" | "sepia"; subscribe(cb: () => void): Unsubscribe };
  config: { apiOrigin: string; relayOrigin: string; environment: "local" | "staging" | "production" };
  report(event: { kind: "error" | "event"; name: string; data?: Record<string, unknown> }): void;  // errors and analytics
}
```

Contract rules:

- **Compatibility.** A minor version adds optional members only. Anything else is a new major, and the reader serves the previous
  major for a stated window. The surface checks `host.contract.major` on mount and renders a "please reload" state on mismatch.
- **Everything arriving is untrusted.** Snapshots from a room, `ctx` values, and location state are parsed with runtime schemas
  (zod) before use. A TypeScript cast is not validation. Snapshot validation stays on the reader side as well (`applySnapshot`
  already validates); social validates before sending and after receiving.
- **Planned for v1.1 (not in v1; each needs its own spec and reader work):** decorations in (mark a segment for a person),
  segment actions out (a "discuss this" action on a segment or selection), `prefetch(ref)`, `renderSegment(el, ref)`, and a panel
  slot in the reader's workspace layout.

### 4.3 Routing rules when on social

These rules go, numbered, into `docs/ROUTING.md` and `.claude/rules/routing.md`. Each is enforced by the check named in brackets.

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
- **R5.** In standalone mode (development, previews) the same routes run under a normal browser history at `/social`.
- **R6.** Path grammar, complete for v1:

  | Path | Page |
  |---|---|
  | `/social` | Feed |
  | `/social/r/$roomId` | Room lobby: who is here, what is being learned, Join |
  | `/social/s/$shiurId` | Shiur page: scheduled, live, or recorded |
  | `/social/settings` | Social settings |

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

The enlarge/minimise lifecycle is a **state machine** with a discriminated union, so illegal combinations cannot be represented:

```ts
type SessionView =
  | { kind: "idle" }
  | { kind: "card";     source: SourceRef }                          // in a feed, no reader involved
  | { kind: "entering"; target: ContextId; ownPlace: ReaderSnapshot | null }
  | { kind: "expanded"; context: ContextId; ownPlace: ReaderSnapshot | null; following: boolean }
  | { kind: "detached"; context: ContextId; ownPlace: ReaderSnapshot | null }  // broke away, still connected
  | { kind: "leaving";  context: ContextId; returnTo: string };
```

Write the allowed transitions as a table in `app/src/features/session/machine.ts` and test every allowed and every forbidden one.

### 4.4 The reserved `ctx` parameter

Today the reader drops unknown query parameters within one navigation
`[VERIFIED reader-next/src/lib/reader/url-state.ts:51-71, src/lib/workspace/url.ts:232-238]`. The existing follow feature works
around this by reading its parameter, saving the id in session storage and stripping it
`[VERIFIED reader-next/src/features/reader-state/follow/adopt.ts:32-60]`. That does not satisfy R11 across devices and shares.

Part A therefore adds **one** generic reserved parameter to the reader:

- Name `ctx`. Value grammar `^[a-z][a-z0-9]*\.[A-Za-z0-9_.-]{1,160}$`: a surface namespace, a dot, an opaque rest.
- The reader validates the shape, preserves it through `validateReaderSearch`, `encodeWorkspace` and `canonicalize`, exposes it on
  `host.reader.context`, and otherwise ignores it. It is left out of `rel=canonical`, of snapshot `url`, and of share links the
  reader itself produces.
- Social's values: `social.room.<roomId>`, `social.shiur.<shiurId>`. Codec and tests live in `app/src/lib/ctx.ts`.

### 4.5 Cards, and what "small" means

- A card is a plain component: title, the current source's text, who is there. It does not mount a reader and does not open a
  socket.
- Live cards read a cheap status (current ref and title, participant count) from the social API, which gets it from the room.
  A socket opens only on enlarge (R9) or in the persistent mount for a session the user has joined.
- Until contract v1.1 provides `renderSegment`, a card fetches text from the public Sefaria text API and renders it with social's
  own minimal renderer. Keep that renderer in one file (`app/src/ui/SourceText.tsx`) so it is replaced in one place.
- The publisher's client adds a summary to its stream (`{ ref, heRef, title }`) so the server and cards never decode reader
  snapshots.

### 4.6 The fake host and the harness

`packages/host-contract/fake-host.ts` implements `SurfaceHost` in memory: a memory history, a scripted `ReaderStateApi` whose
snapshots are plain objects, a settable viewer, and a token minted with a test key. `harness/` is a static page that loads the
surface bundle into the fake host with a visible "reader" pane showing the current fake snapshot, so tests can assert what the
reader was told to do.

- All unit, component and most end-to-end tests run on the harness. They need no reader checkout.
- The fake must fail when the real surface would: when the pinned contract removes or renames a member, the fake stops compiling
  (it is typed from the generated contract types). Never widen the fake to make a test pass.
- A second end-to-end lane runs the same journeys against the real reader (section 5.5).

### 4.7 Styling, language, accessibility

- Use the reader's design tokens (`--sefaria-*`) `[VERIFIED reader-next/src/ui/tokens/tokens.css]`. No literal colours. Social's
  own CSS is CSS modules; no global selectors.
- The reader's global rules (`*`, `:lang(he)`, `:focus-visible`) apply to social's markup. Every text node that may be Hebrew
  carries `lang` and `dir`.
- Every screen works in English and Hebrew interface languages and in light, dark and sepia. Visual tests cover English, Hebrew
  and dark.
- The enlarged view, if it overlays, is a `<dialog>` opened with `showModal()`; otherwise it is a route. Keyboard and focus rules
  are acceptance criteria in every UI spec.

---

## 5. The factory, concretely

### 5.1 The pipeline

```
 idea ─▶ /shape-spec ─▶ spec.md + acceptance.feature (+ mockup.html)        SHARED ASSET (human approves)
            │
            ▼
        /plan-spec ─▶ plan.md + tasks.yaml                                  planner agent, human skims
            │
            ▼
   `npm run factory -- compile NNN` ─▶ workorder.json                       DELIVERABLE (deterministic)
            │
            ▼
        /build-task T-xxx  (one task, one session, one PR)                  builder agent
            │
            ▼
        /verify ─▶ evidence block in the PR                                 same session, commands + output
            │
            ▼
   CI: static → unit → integration → contract → build → e2e → spec-gate     deterministic, required
   Agents: review, QA run, security review                                  advisory, fresh context
            │
            ▼
        human approves ─▶ merge queue ─▶ release ─▶ nightly holdout scenarios ─▶ weekly retro
```

### 5.2 The spec (shared asset)

`specs/NNN-slug/spec.md`, validated against `factory/schemas/spec.schema.json`:

```markdown
---
id: 012
title: Join a room from its lobby
status: draft            # draft → approved → building → verified → shipped
approved_by:             # set by `factory approve` after a human owner's review; with the hash below
approved_sha:
features: [ROOM-012]     # atlas ids this spec adds or changes
owner: <github handle>
surfaces: [room-lobby, session]     # keys from factory/surface-map.yaml
risk: normal             # normal | high  (high = auth, tokens, deletion, migrations, contract, CI, hooks)
contract_impact: none    # none | host-minor | host-major | api-minor | api-major
---
## Problem
## Acceptance criteria
- AC-001 WHEN a signed-in user presses Join on a live room's lobby THE SYSTEM SHALL …
## Out of scope
## Notes for the planner
```

- `acceptance.feature` holds the same criteria as Gherkin scenarios tagged `@AC-001`.
- **Who writes, who agrees.** An agent may draft or generate the spec and the feature file, on its own initiative or when asked.
  Agreement is human: `specs/**` is in CODEOWNERS, so every change to a spec or feature file needs a human owner's approving
  review, whoever wrote it. `npm run factory -- approve NNN` (run after that review) records `approved_by` and the content hash
  of the spec and feature file in the frontmatter.
- **Changing an agreed spec** is allowed and goes the same way: edit, human review, re-approve. Because the hash changes, the
  work order stops matching and must be recompiled (section 5.3), so code can never be built against a spec nobody agreed to.
- The spec lists the features it adds or changes (`features: [ROOM-012, …]`), which become atlas entries (section 5.10).
- UI specs include `mockup.html` (static HTML using the tokens) or a link to the design.
- Size rule: a spec that needs more than about eight tasks is split.

### 5.3 The work order (deliverable)

`tasks.yaml` (written by the planner agent):

```yaml
- id: T-001
  title: ctx codec with validation
  acs: [AC-001, AC-003]
  files: ["app/src/lib/ctx.ts", "app/src/lib/ctx.test.ts"]   # globs the task may touch
  depends_on: []
  parallel: true
  verify: ["npm run test -- ctx", "npm run typecheck"]
```

`npm run factory -- compile NNN` is deterministic. It fails unless:

- the spec validates, is `approved`, and its content still matches `approved_sha`;
- every feature id it lists exists in the atlas or is created by this compile as `planned`;
- every AC has at least one `.feature` scenario and at least one task;
- every task names at least one AC, at least one file glob and at least one verify command;
- the dependency graph has no cycle;
- no task's globs include a protected path (section 5.6) unless the spec's `risk` is `high`.

It writes `workorder.json`: the tasks, the spec's content hash (`spec_sha`), the feature file's hash, and for each AC an entry
`{ "ac": "AC-001", "passes": false, "evidence": null }`. An agent may flip `passes` to `true` only by adding evidence (test ids
that ran green in CI on that commit). Entries are never removed or reworded by an agent.

### 5.4 Enforcement ("forcing the shared asset to be built")

**Locally (Claude Code hooks, registered in `.claude/settings.json`):**

| Hook | What it does |
|---|---|
| `PreToolUse` on Edit/Write → `guard-paths.mjs` | Blocks edits to protected paths (section 5.6). Blocks edits under `app/` and `packages/` unless `.factory/active.json` names a work order and task whose globs match the file. Prints how to fix it ("run /build-task T-xxx, or shape a spec"). |
| `PostToolUse` on Edit/Write → `post-edit-check.mjs` | Formats and lints the changed file only. Never blocks; prints findings. |
| `Stop` → `stop-verify.mjs` | Runs the fast check set (typecheck, lint, affected unit tests). On failure exits with code 2 so the agent continues with the errors as feedback. |

Hook rules: fast (seconds), no network, no nested agent runs, no git writes. One source of truth for registration
(`.claude/settings.json`); `factory doctor` fails if a referenced script is missing or an unregistered script exists.
`[CHECK]` current hook event names and exit-code behaviour in the Claude Code docs.

**In CI (`spec-gate` job, script `factory/gate.mjs`):**

1. Read the PR's trailers `Spec: NNN` and `Task: T-xxx` (one or more).
2. If the diff touches only docs, tests' snapshots, or files on the housekeeping list, pass.
3. **Trivial lane**, computed, not self-declared: at most 30 changed lines, no new files, no protected path, no dependency change.
   Pass with a notice. Anything larger needs a spec.
4. Otherwise require: the spec exists and is `approved` or `building`; `workorder.json` exists and its `spec_sha` matches the
   spec on the PR's base; every changed product file matches a glob of a named task; a PR that changes a spec or feature file
   does not also change product code (spec changes are agreed first, in their own PR); the atlas entries for the spec's features
   are updated in this PR when the task completes a feature (section 5.10).
5. Fail with a message that names the missing piece and the command that creates it.

`factory/gate.test.mjs` proves the gate: for each rule it builds a fixture repo that breaks the rule and asserts a non-zero exit.
`factory doctor` runs those negative tests; a guard without a negative test fails doctor.

### 5.5 The test system

| Level | What | Tooling | Gates a PR? |
|---|---|---|---|
| L0 | Types, lint, format, architecture tests, docs links, secret scan, dependency audit | tsc, ESLint + custom rules, Prettier, vitest, gitleaks | Yes |
| L1 | Unit and component tests | Vitest (jsdom; browser mode for components) | Yes |
| L2 | Integration: API against real Postgres; relay room logic in the Workers runtime; token verification with test keys | Vitest + a Postgres service container; Miniflare / `wrangler dev` `[CHECK]` | Yes |
| L3 | Contract: surface against the fake host; pinned contract hash; OpenAPI breaking-change check; migration compatibility | vitest, a diff tool for OpenAPI `[CHECK]` | Yes |
| L4a | End-to-end on the harness, including multi-user rooms (several browser contexts) and visual checks | Playwright | Yes |
| L4b | The same journeys against the real reader image at the pinned commit | Playwright + the reader's container | Merge queue and nightly |
| L5a | Agent QA run on the PR's ephemeral environment | qa-plan and qa-run skills | Advisory first; see promotion rule |
| L5b | Holdout scenarios judged by an evaluator agent | separate private repo | Nightly and before release |
| L5c | Mutation testing on changed files | Stryker `[CHECK]` | Advisory, nightly |

Rules for agent-written tests (go into `.claude/rules/tests.md`):

1. Every AC has at least one deterministic test tagged with its id (`// @ac 012/AC-001`). The compile step and the gate check the
   mapping.
2. **Red before green.** `factory/prove-red.mjs` runs each new or changed acceptance test against the merge base and requires it
   to fail there, for the right reason (the assertion, not a missing import). A test that passes without the feature proves
   nothing.
3. No test without an assertion. No branching inside a test. No bare truthiness assertions where a value can be compared.
   [custom lint rules]
4. Integration tests use real Postgres. Never SQLite, never a mock of social's own database. Fake an outside service by its real
   surface, so a removed method fails the test.
5. Sign-in helpers assert that the session is authenticated (token present and accepted), not that a page navigated.
6. When the behaviour is a DOM change, assert the change. Wait with polling conditions; never fixed sleeps.
7. Playwright's healer may change locators and waits only, never assertions or expected values, and may not skip a test. A skip
   is a failure until a human quarantines it.
8. Flaky tests go into `factory/quarantine.yaml` with a reason, an issue link and an expiry date. Quarantined tests still run and
   report; they do not gate. An agent may add an entry; only a human removes the gate permanently.
9. Test output is terse and structured (one line per failure, a JSON summary file). `npm run test:fast` runs the affected subset.

**Agent QA run (L5a)**, per pull request, on an environment built inside the job (Postgres, the social server, the harness, a
local relay):

- Surfaces under test are derived from the diff's file paths through the fixed map `factory/surface-map.yaml`, never from the PR
  description. Shared code maps to every surface that imports it. A changed surface with zero journeys blocks the report.
- The planner writes journeys into the PR as a checklist. A separate runner signs in as a persona and performs them in a browser.
  The runner re-derives surfaces itself; anything the plan missed is tested and logged as a planner gap.
- Personas: one identity across the browser and the API; the signed-out visitor is a persona too. A test-only route issues a
  persona session; it exists only when the environment name matches the test pattern **and** a shared-secret header is present,
  and it returns 403 otherwise. A test proves production refuses it.
- Seeding: one file per scenario; seeding twice creates nothing the second time; reset leaves zero rows per table, checked
  against the schema.
- The runner posts **one** evidence comment and never edits it, and files one issue per failure with its transcript.
- What a pass means: evidence is a line from the runner's own browser session. A retry after a failure is "failed then
  recovered", not a pass. A surface that could not be reached is "cannot reach" with the reason, never a pass. A separate
  skeptic agent recounts the results and names any assertion that would pass with the feature broken.
- **Promotion rule:** L5a starts advisory. It becomes a required check for a surface after 20 consecutive runs on that surface
  with no false failure, as recorded in the metrics. The retro agent proposes promotion; a human decides.

**Holdout scenarios (L5b):**

- Stored in a separate private repository that the building agents' credentials cannot read. Only the nightly and release
  workflows check it out, with a deploy key scoped to those workflows.
- A scenario is a user story with a rubric. An evaluator agent drives the staging build through a browser, three clean trials
  per scenario. It grades each rubric line pass, fail or unknown, with one judge per dimension. The job reports a satisfaction
  score (share of trials that satisfy the story) and its trend.
- A failure opens an issue that describes the symptom and the steps observed, never the scenario text or rubric.
- The judge is calibrated: each month a human labels about 20 recorded trials, and the judge's agreement is recorded. Below the
  agreed threshold, the judge prompt is fixed before its scores are trusted again.
- Known limit, stated honestly: an AI judging AI-built software is partly circular. Deterministic levels gate merges; scenarios
  are a signal, not proof.

### 5.6 Protected paths and ownership

Specs are **not** on this list: agents may edit `specs/**` freely, and CODEOWNERS alone makes a human agree to each change
(section 5.2).

`CODEOWNERS` requires a human owner's approval, and `guard-paths.mjs` blocks agent edits outside a `risk: high` work order, for:

`.github/**`, `.claude/**`, `factory/**`, `CLAUDE.md`, `REVIEW.md`,
`app/src/server/auth/**`, `app/src/server/webhooks/**`, `app/src/server/db/migrations/**`, `packages/host-contract/pinned/**`,
`packages/relay/wrangler.toml`.

Changes to prompts, hooks, skills and `CLAUDE.md` are production changes: reviewed by a human, small, and noted in the next
retro.

### 5.7 Rules files and agent definitions

**`CLAUDE.md`** (root; at most 150 lines; has a named owner; reviewed like code). Contents, in this order:

1. What this repo is, in five lines, and the picture from section 1.1.
2. The map: one line per `docs/` file and per `.claude/rules/` file, saying when to read it.
3. How work flows: spec → work order → one task per session → verify → PR. The four commands.
4. **Non-negotiables** (each is also enforced by code; the file says which check):
   - No product code without an active work order.
   - A spec change is its own PR and needs a human owner's review; never change a spec and product code together.
   - A feature is not done until its atlas entry is updated and has a tagged test.
   - The surface never imports server code or the Start runtime.
   - Never touch `window.history` or `location`; navigate through the host.
   - Validate everything that crosses a boundary with a schema.
   - Tokens stay in memory. Never log a token, a request body or a header.
   - Real Postgres in tests. No mocks of our own database.
   - A claim of done is a command and its output.
5. Commands: install, dev, each test level, build, `factory doctor`.
6. Gotchas: a short, growing list of things that surprised an agent. The retro agent proposes additions; anything Claude already
   does unprompted is deleted.

It contains no long procedures (those are skills) and no facts that can be derived by running a command (ship the command).

**`.claude/rules/`** (each has `paths:` frontmatter so it loads only for matching files `[CHECK]`):
`routing.md` (R1–R18), `surface-contract.md`, `server-api.md`, `db.md`, `relay.md`, `tests.md`, `security.md`, `specs.md`,
`styling-i18n.md`.

**`.claude/skills/`**: each `SKILL.md` has a description that says what it does, when to use it and when **not** to; critical
instructions first; long material under `references/`; any non-trivial shell in a script file (a `$` followed by a digit inside
`SKILL.md` is replaced by skill arguments and silently breaks snippets — `factory doctor` greps for it).

| Skill | Does |
|---|---|
| `shape-spec` | Interviews the human, or works from a brief, and writes `spec.md`, the `.feature` file and the planned atlas entries as a spec PR. Never runs `approve`. |
| `plan-spec` | Reads an approved spec, explores the code, writes `plan.md` and `tasks.yaml`, runs compile. |
| `build-task` | Sets `.factory/active.json`, runs the baseline tests, builds one task test-first, runs verify. |
| `verify` | Runs each check; records the exact command, the real output, PASS or FAIL per check; adds one adversarial probe; ends with a VERDICT line. No PR on FAIL. |
| `qa-plan` / `qa-run` | The planner writes journeys; the runner writes evidence. Neither contains testing procedure beyond conditions to make true. |
| `contract-sync` | Updates the pinned reader contract from a given reader commit, regenerates types, runs contract tests, reports what changed. |
| `retro` | Section 5.9. |

**`.claude/agents/`**: `reviewer` (tools: Read, Grep, Glob only), `skeptic` (same), `qa-runner` (browser tools, no repo write),
`test-writer` (writes tests only; a different session from the one that writes the code under test).

**`REVIEW.md`** (read from the base branch, so a PR cannot weaken its own review):

- Severity: CRITICAL and HIGH are reported as blocking recommendations; MEDIUM may merge with a follow-up issue; LOW and INFO
  never block. Doubts are INFO questions.
- Always CRITICAL: an endpoint that fetches by id without an ownership check; auth that lists protected routes instead of
  protecting by default; a secret in the diff; an empty catch; a test with no assertion; a boundary input used without schema
  validation; a write to history or location outside the host.
- Always HIGH: a missing `await`; a cross-service call without connect and read timeouts; a retried write without an idempotency
  key; a schema change that breaks a rolling deploy.
- Context expansion: when a signature, type, environment variable or API shape changes, grep every caller and consumer outside
  the diff, including the pinned contract and the reader's reference surface.
- Output: at most ten comments, grouped by root cause; each states severity, rule, `file:line`, the quoted pattern, a measurable
  fact and a concrete fix; ends with a summary. Comment only on changed lines unless the change breaks unchanged code.
- Downgrades: tests, generated code, migrations and scripts drop one level, except secrets.

### 5.8 CI workflows

One required check, `result`, so the ruleset names a single job.

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | pull request, merge queue | `changes` → `static` → `unit` → `integration` → `contract` → `build` (both builds; bundle-size budgets) → `e2e-harness` (desktop and phone, English and Hebrew) → `spec-gate` → `prove-red` → `result` |
| `e2e-reader.yml` | merge queue, nightly | Start the reader image at the pinned commit with the social lab on; run the L4b journeys |
| `agent-review.yml` | pull request | Review agent with `REVIEW.md`; posts comments and a neutral check. Fresh context; an Opus-class model (do not downgrade the reviewer to save cost) |
| `agent-qa.yml` | pull request | Build the ephemeral environment; qa-plan, qa-run, skeptic; one evidence comment |
| `security-review.yml` | pull request from the same repo only | Security review action. It is not hardened against prompt injection: never run it on forks |
| `nightly.yml` | cron | Full L4 matrix; flake detection (run the suite three times, list tests with mixed results); L5b scenarios; L5c mutation; dependency audit; contract drift against the reader's default branch; **collection check** (the number of test files on disk equals the number executed, per level); docs freshness; `factory doctor` |
| `retro.yml` | weekly cron | Section 5.9 |
| `release.yml` | merge to main | Section 7 |

Details:

- Agent jobs use `anthropics/claude-code-action@v1` with an explicit `prompt`, `--max-turns`, `--model` and a minimal
  `--allowedTools` `[CHECK]`. Authenticate by OIDC if the organisation has it set up, otherwise a repository secret. Agent jobs
  get no deploy credentials and no access to the holdout repository except the two workflows that need it.
- Every agent job has a time limit and a turn limit. Never run uncapped.
- Every job appends one JSON line to the metrics store (section 5.9): run id, commit, model id, job, result, duration, counts of
  tests run, skipped and quarantined, tokens where known.
- Merge queue on. Ruleset: `result` required; one human approval; code owners required on protected paths; no direct pushes.
- Commits made by workflows with the default token do not trigger CI. Anything a workflow commits (metrics, retro notes) goes to
  a data branch that needs no CI.

### 5.9 Retros and factory health

**Metrics store:** branch `factory-data`, append-only JSON lines under `metrics/`, written by CI.

**Tracked:** CI duration and failure rate per job; flaky and quarantined test counts and ages; skipped tests; review findings by
severity, and how many a human overrode; QA runs: pass, failed-then-recovered, cannot-reach; planner gaps; scenario satisfaction
and judge agreement; mutation score on changed code; rework (reverts and fix-follow-up PRs within seven days of a merge); escaped
defects (issues labelled `escaped`, with the level that should have caught each); spec cycle time (approved → shipped); spec-gate
trivial-lane share; tokens and cost per merged PR.

**Weekly retro agent (`retro.yml`, isolated job with its own checkout; never from a session hook):**

1. Reads the metrics, the last four retros, open retro action items, the quarantine list, and a sample of agent transcripts
   from failed runs.
2. Writes `docs/retros/YYYY-Www.md`: what changed in the numbers; which past action items were done, not done, or dropped, and
   why; recurring problems with a count of weeks seen; rejected proposals kept with their reasons.
3. Opens at most three issues, each with an owner or the word `unassigned`.
4. May open **one** PR with the smallest useful edit to `CLAUDE.md`, a rule file or a skill. A human merges it. It never edits
   hooks, workflows or gates.
5. Once a month: proposes harness parts to delete (a check that never failed, a rule the model follows unprompted), with the
   evidence. Deletion is a human decision.

**`npm run factory -- doctor`** (runs in nightly and before every release) fails when: a hook is registered but missing, or
present but unregistered; a guard has no negative test, or its negative test passes; a required check named in the docs does not
exist in the workflows; a skill's frontmatter is invalid or contains `$<digit>`; a protected path has no code owner; the pinned
contract's hash differs from its recorded hash; `docs/` links are broken; `CLAUDE.md` exceeds its line limit.

**`docs/QUALITY_SCORE.md`**: a table per surface (tests per level, open escaped defects, flake count), generated by a script,
never typed by hand.

### 5.10 The feature atlas

A record of every feature, kept current as features are built. It follows the reader's atlas, which already works this way:
a canonical `docs/features/features.json`, tests tagged `// @feature ID`, and a coverage script that fails on unknown ids
`[VERIFIED reader-next/docs/features/features.json, reader-next/scripts/feature-coverage.mjs]`.

- **Canonical file:** `docs/features/features.json`. One entry per feature a user or another system can observe:

  ```json
  {
    "id": "ROOM-012",
    "area": "room",
    "name": "Join a room from its lobby",
    "description": "A signed-in user presses Join and their reader follows the room.",
    "status": "planned",
    "spec": "012",
    "acs": ["012/AC-001", "012/AC-002"],
    "surfaces": ["room-lobby", "session"],
    "depends_on": { "host_contract": "1.0", "api": ["POST /api/v1/rooms/{id}/join"] },
    "tests": [],
    "since": null,
    "changed": []
  }
  ```

  Areas (id prefixes): `FEED`, `ROOM`, `SHIUR`, `SESS` (enlarge, follow, presence), `IDENT`, `HOST` (the surface contract),
  `API`, `OPS`. Status: `planned` → `built` → `verified` → `retired`. Ids are never reused or renumbered.
- **When entries change:**
  - `factory compile` creates `planned` entries for the feature ids a spec lists.
  - The PR that completes a feature sets `built`, fills `tests`, and adds a line to `docs/features/CHANGELOG.md`.
  - CI on main sets `verified` and `since` (the release version) once the tagged tests have run green on main.
  - A later spec that changes a feature appends to its `changed` list (spec id and date); it does not rewrite history.
- **Checks (script `factory/atlas.mjs`, in the `static` job):**
  - every test tag `@feature ID` names an existing entry, and its name in the tag comment matches (wrong ids slipped into the
    reader's atlas more than once; print names next to ids);
  - every entry that is `built` or later has at least one tagged test that ran;
  - every AC of every shipped spec appears under exactly one feature;
  - a PR that adds a route, an API endpoint, or a member of the host contract without touching the atlas fails, with a message
    naming the new item.
- **Corrections go into the atlas.** When building shows an entry is wrong (mislabelled, missing, describes behaviour that is not
  there), fix the entry through a small idempotent script under `docs/features/tools/` and note it in the changelog, as the
  reader does. The atlas is the record of what the product does; specs are how it got there.
- **Reading it:** `npm run atlas:build` renders the JSON to a single HTML page (filter by area and status, links to spec and
  tests), published with each release. `docs/QUALITY_SCORE.md` is generated from the same file.

---

## 6. Server, identity and data

### 6.1 Identity from Django

What exists today `[VERIFIED 2026-11-23]`. The full write-up is in the Sefaria wiki:
`wiki/areas/engineering/repos/sefaria-project/identity-as-implemented.md`.

- **User identity is django-allauth inside Django** (allauth 65.8.0: `account`, `socialaccount` with Google and Apple,
  `headless`). There is no separate user-authentication service. The Go `auth-service/` is an API-key classifier for Envoy,
  off by default; it does not authenticate people.
- **Web:** the Django session cookie. The reader asks allauth headless who is signed in
  (`reader-next/src/lib/auth/session.ts`) and never holds a token.
- **Mobile:** simplejwt `{access, refresh}`, signed **HS256 with a shared secret** (`SIMPLE_JWT_SIGNING_KEY`).
- **Library Assistant and its MCP server:** AES-GCM encrypted user tokens with their own shared secrets, accepted in the
  `X-Session-ID` header by `SessionIDAuthMiddleware`.
- **Missing:** any public-key (JWKS) endpoint, token introspection, an OpenID Connect provider, asymmetric signing, an
  account-deletion hook. `allauth.idp` (allauth's identity-provider app) is not installed.
- The user's stable id is `auth_user.id`. `username` is a hash of the email and must never be used as an identifier.
- The relay checks only the Origin and the room id. It has **no token check** (`reader-next/relay/worker.ts`).

The principle: **the social server and the relay must be able to verify who a user is, and must never be able to mint it.**
Every existing token is a shared secret with exactly one consumer, so none can be reused: holding the secret means being able to
forge any user. Three ways to give social identity were considered.

| | Option | What it takes | Fits when |
|---|---|---|---|
| A | **A system that communicates it:** Django signs a short-lived token for social with a private key and publishes the public key | One endpoint, one JWKS view, one key pair. No upgrade. | Now. Smallest change; stays inside allauth's session. |
| B | **allauth's own identity provider** (`allauth.idp`, OpenID Connect): Django becomes a standard provider with discovery and JWKS | An allauth upgrade from 65.8.0 (the provider arrived in 65.9.0; JWT access tokens, introspection and later fixes run to 65.22), `oauthlib` 3.2.2 to 4.0 or later, a new app with database tables, a registered client, `IDP_OIDC_ACCESS_TOKEN_FORMAT = "jwt"`, and on the reader side a redirect or hidden-frame authorization-code flow, because its documentation describes no way to get a token straight from an existing session | More consumers are coming (native app, partners, more surfaces), or the bespoke Library Assistant and MCP tokens should be replaced by one standard |
| C | **Externalise authentication** into its own deployment | The open debate recorded in the wiki; nothing started | Not for this project. It would block social on a platform decision. |

**Decided by the owner, 2026-11-23: option A.** Django signs a short-lived token for social and publishes the public key.
It is the least work in Sefaria-Project and the normal pattern for first-party code running in a page that already has a
session. The token is a standard JWT with standard claims, verified from a JWKS URL the social server reads from configuration,
so adding option B later (for a native app or partners) changes one configuration value in social and nothing else. Do not
build B or upgrade allauth as part of this work.

Design for option A (Part A adds the Django side):

- New endpoint `POST /api/social/token`: session-authenticated, CSRF-protected, rate-limited per user. Returns
  `{ token, expires_at }`. The token is a JWT signed with RS256 by an RSA private key only Django holds. RS256 and an RSA key
  are what allauth's identity provider uses, so option B could later issue the same kind of token from the same key.
  Claims: `iss` (the site's origin), `aud: "sefaria-social"`, `sub: "<auth_user.id>"`, `name`, `picture`, `staff` (boolean),
  `iat`, `exp` (10 minutes), `jti`, and `kid` in the header. Claim names follow OpenID Connect where one exists.
- Put it in the `sso` app beside the other identity views, as a thin wrapper, following the existing pattern there.
- Public keys: a JWKS document at a stable Django URL, so keys can rotate. The social server and the relay cache it with a
  timeout and verify signature, `iss`, `aud`, `exp` and `kid` with a maintained library (`jose`). Never hand-roll verification.
- `[CHECK]` Django pins PyJWT 1.7.1 through simplejwt. Confirm RS256 signing works with that version and the installed
  `cryptography`, or sign with `cryptography` directly; do not upgrade PyJWT as a side effect of this work.
- `host.viewer.identityToken()` calls the endpoint, caches the token in memory until shortly before expiry, and refetches. Tokens
  are never written to storage, URLs or logs.
- The social server protects **by default**: every `/api/v1/*` route requires a valid token unless it is on an explicit public
  list (a public shiur page's data, health). Every read or write by id checks ownership or membership.
- The relay requires the same token on the WebSocket upgrade (first message or subprotocol; not in the URL), in addition to the
  Origin check. Add this to the copied relay before any use outside local development.
- Calls from the social server to Django or the text API have connect and read timeouts, retry with backoff and jitter on
  transient errors only, and a defined fallback.

### 6.2 Server shape

- TanStack Start server routes under `app/src/routes/api/v1/` `[CHECK current server-route API]`; handlers are thin and call
  `app/src/server/services/*`. Request and response schemas are zod; an OpenAPI document is generated from them and committed;
  `packages/api-client` is generated from it. CI fails on a breaking change without an `api-major` spec.
- Postgres with Drizzle (or the ORM chosen in decision 0002) and SQL migrations. Rules: every foreign key indexed; timestamps
  with time zone; no queries in loops; no I/O inside a transaction; migrations compatible with the previous server version
  (expand, deploy, contract).
- No shared tables with Django. Social stores Sefaria user ids as plain integers plus a small display cache (`name`, `img`)
  refreshed from token claims.
- Health endpoint checks the database connection and does not call downstream services.
- Logging: structured, static messages, a correlation id propagated from the surface; never bodies, headers or tokens.
- First tables: `rooms`, `room_members`, `shiurim`, `shiur_recordings` (a pointer to stored stream data), `user_display`,
  `deleted_users` (tombstones), `webhook_receipts` (idempotency).
- Content rule: store refs and stream data, never library text.

### 6.3 User lifecycle

- Django's `delete_user_account` (`sefaria/utils/user.py:17-74`) has no outgoing hook `[VERIFIED]`. Part A adds a step that
  queues a Celery task (async work in Sefaria goes through Celery) which POSTs a signed webhook to
  `POST /api/v1/internal/user-deleted` with retries.
- The social handler verifies the signature, is idempotent (`webhook_receipts`), deletes or anonymises every row for that user
  (membership, chat when it exists, recordings they own), writes a tombstone, and tells the relay to drop the user.
- A staff-only "purge user" command exists for the case where a webhook was lost.
- An integration test seeds every table with a user's rows, calls the handler, and asserts **zero** rows remain for that user in
  every table, by walking the schema, so a new table cannot be forgotten.
- A recording is a reading history. Treat it as personal data: private by default, deletable by its owner.

### 6.4 Realtime

- Start from the reader's existing code: copy `reader-next/src/lib/session/*` into `packages/session` and `reader-next/relay/*`
  into `packages/relay`, recording the source commit. The protocol already has `state`, `control`, `presence` and `chat` channels
  and limits (16 KB frames, 200 participants, 20 state messages per second) `[VERIFIED reader-next/src/lib/session/protocol.ts]`.
- Add the token check (6.1) and a status read (current summary and participant count) for cards (4.5).
- The reader's follow lab keeps its own copy until follow moves into social (milestone P6). Until then, do not let the two
  copies drift in protocol: a contract test in the social repo replays the reader's protocol fixtures.
- Audio and video are out of scope until P7 and need a provider decision (section 9).

---

## 7. Release and operations

- `release.yml`, on merge to main: build the surface; upload every file to immutable, versioned paths; write `manifest.json`
  with the version, the contract major, and an integrity hash for the entry **and every chunk and the CSS**; deploy the server;
  run smoke tests; then move the stable manifest pointer. Rollback is moving the pointer back; keep the last known-good version.
- The reader fetches the manifest from a host-controlled allowlist of origins, validates it against a schema, loads the entry
  with its integrity hash, and refuses a manifest whose contract major it does not support.
- The reader has **no Content-Security-Policy today** `[VERIFIED]`. Note this in `docs/runbooks/security.md`; when the reader
  adds one, the social asset origin must be listed.
- Kill switch: the reader's lab `feature.reader.labs.social` in remote config. Off means the reader never fetches the manifest.
- A surface in the reader page runs with the user's session. This is a first-party trust decision. Only Sefaria-owned surfaces;
  never a third-party one.
- Observability: errors and key events go through `host.report` to the reader's reporting, tagged with the surface version.
- Deployment follows the existing pattern for a standalone TanStack Start app outside the main chart (its own namespace and
  gateway). The agent prepares the Dockerfile, a values file and `docs/runbooks/deploy.md`; a human does the infrastructure work.

---

## 8. Ordered work

Each milestone ends with its exit test. Do not start the next one until the exit test passes in CI.

### F0. Bootstrap (no spec system yet; this is the one milestone built without it)

1. Create the workspace, the Start app scaffold, TypeScript strict, ESLint, Prettier, Vitest, Playwright.
2. Write `CLAUDE.md`, `AGENTS.md`, `REVIEW.md`, the rule files, `docs/ARCHITECTURE.md`, `docs/ROUTING.md`, `docs/CONTRACT.md`
   from this plan.
3. `ci.yml` with `static`, `unit`, `build`, `result`.
4. Architecture tests for the layer order and the surface import ban, each with a negative test.

Exit: CI green on an empty app; an injected forbidden import turns it red.

### F1. Spec system and gates

1. Schemas, `factory compile`, `factory approve`, `factory gate`, `factory doctor`, `prove-red`, and the feature atlas
   (`docs/features/features.json`, `factory/atlas.mjs`, `atlas:build`), with their negative tests.
2. Hooks and `.claude/settings.json`. Skills `shape-spec`, `plan-spec`, `build-task`, `verify`.
3. `spec-gate` and `prove-red` jobs; CODEOWNERS; `docs/runbooks/working-in-the-factory.md`.
4. Run spec `000-hello-surface` through the whole pipeline as the proof.

Exit: a PR with product code and no spec is refused locally and in CI; spec 000's work order compiles and its task merges; its
feature appears in the atlas as `built` with a tagged test, and removing the tag turns CI red.

### S1. Spike: two builds, bridged history (time-boxed; throwaway code allowed, findings are not)

Prove that the surface bundle mounts in the harness with a host-bridged history under `/social`, that Back and Forward work, and
that the Start build serves the same route components. Record the decision in `docs/decisions/0001-two-builds.md`.

Exit: the decision record, and a list of any plan changes it forces.

### P1. Contract, fake host, harness, routing (specs 001–004)

Contract types and schemas; the fake host; the harness page; the surface entry and router; the routes of R6 with placeholder
pages; the `ctx` codec; the session state machine with its transition tests; L3 and L4a lanes.

Exit: on the harness, every route in R6 loads and deep-links; R1–R7, R15 and R18 each have a failing-then-passing test.

### F2. Agent lanes

`agent-review.yml`, `agent-qa.yml` with personas, seeding and reset, `security-review.yml`, the metrics store, `nightly.yml`
(flake detection, collection check, doctor), the quarantine file, the holdout repository wiring and the first five scenarios
(written by a human), `retro.yml`.

Exit: a PR receives a review, a QA evidence comment and a skeptic recount; the nightly writes metrics; the first retro file exists.

### A1. Reader seam (separate session, `Sefaria-Project`, branch from `reader-next`)

1. Routing: add `social` to the client-owned prefixes (`reader-next/src/server/route-manifest.ts`) and regenerate the nginx path
   list; add it to the app-pages pattern so `isReaderPath("/social/…")` is false (`src/lib/reader/paths.ts`); add
   `src/routes/social.$.tsx` and `social.index.tsx` rendering a sized placeholder. Today `/social/foo` falls through to a 404 or
   is treated as a ref `[VERIFIED]`.
2. The surface loader (`src/lib/surfaces/`): lab `social` in `src/lib/labs.ts`; manifest fetch, schema validation, integrity,
   timeout, retry-on-next-page behaviour like `loadAssistantScript`; a development override gated by an environment flag; an
   error boundary so a failed surface never breaks the reader.
3. `SurfaceHost` v1 built from `window.sefariaReaderState`, the workspace commands, the router and the viewer query; the
   contract file `reader-next/contract/surface-host.v1.ts` and its generated schema; the persistent mount beside `<main>`.
4. The reserved `ctx` parameter (section 4.4), with tests that scroll and panel changes keep it and that canonical links and
   snapshots omit it.
5. A tiny reference surface in the reader's test fixtures and an end-to-end spec proving mount, navigation, snapshot apply,
   `ctx` survival, and the reader working with the surface failing to load.
6. Architecture rule: nothing in the reader imports surface code except the shell.
7. Harden what the state API doc promises but the code lacks: the lint or architecture rule keeping `core/` free of app and
   React imports, and the replay check script, both described in `docs/READER_STATE_API.md` and both absent `[VERIFIED]`.

Exit: with the lab on, the reference surface mounts at `/social`; with it off, `/social` is the reader's not-found page; the
reader's own suite is green.

### A2. Django additions (same repo, separate PR)

`POST /api/social/token`, the JWKS endpoint, key
settings and rotation notes; the deletion webhook step and its Celery task; tests for both. Update the agent docs for the files touched, without bumping the docs stamp.

Exit: a token minted locally verifies with the published key; deleting a test user queues the webhook.

### P2. Server and identity (specs 005–008)

Database, migrations, token verification, protect-by-default middleware, `rooms` CRUD, OpenAPI and the generated client, the
deletion handler and its walk-the-schema test, health, logging rules.

Exit: L2 green on real Postgres; an unauthenticated call to any non-public route is refused by a test that enumerates routes.

### P3. Rooms: join, presence, follow, enlarge and minimise (specs 009–014)

`packages/session` and `packages/relay` with the token check; lobby; join; presence list; following through the reader state
API; R8–R14 end to end; multi-user tests on the harness and against the real reader.

Exit: two browser contexts in one room: when one moves, the other's reader follows; refresh on a `ctx` URL reconnects; Back
leaves; the follower's own settings are untouched.

### P4. Feed and cards (specs 015–018)

Feed page, light cards, the status read, the source text renderer, prefetch on visibility, the enlarge transition.

Exit: a feed of live cards opens no sockets; enlarging lands on the card's source without a visible reload.

### P5. Release (specs 019–021)

`release.yml`, manifest with integrity for all files, pointer and rollback, smoke tests, runbooks, a rehearsed rollback.

Exit: a release and a rollback performed on staging, recorded in `docs/runbooks/`.

### Later (each needs shaping with the owner first)

P6 move follow and recording out of the reader into social; P7 chat on refs, recorded shiurim, audio and video; contract v1.1
(decorations, segment actions, panel slot, `renderSegment`); moderation.

---

## 9. What a human must provide or decide

**Before the first session**

1. Create the repository (suggested `Sefaria/sefaria-social`) and commit this file as `docs/PLAN.md`. A cloud session starts
   from the repository's default branch and cannot see files that are not pushed.
2. Create the private holdout repository and its deploy key (needed at F2).
3. Repository settings: ruleset with the `result` check, merge queue, code owners; Anthropic credentials for Actions.
4. Name the human owners: specs and acceptance files; `CLAUDE.md` and the factory; auth and migrations.

**Decisions with a default the agent will use unless told otherwise**

| # | Question | Default |
|---|---|---|
| D1 | Licence of the new repo | Same as Sefaria-Project |
| D2 | Where the server and assets are served | `social.sefaria.org`, own namespace and gateway; Bearer auth, no cookies |
| D3 | Database and ORM | Postgres with Drizzle |
| D4 | Who may join a room | Signed-in users; public shiur pages viewable signed out |
| D5 | How social gets identity (section 6.1) | **Decided 2026-11-23:** a Django-signed token with a published key, 10 minutes, RS256 |
| D8 | Keep a holdout scenario set that building agents cannot read (section 5.5) | Yes. It is a test set, not a spec; specs stay open to agents. Say no and L5b is dropped. |
| D9 | Who agrees to specs | The code owners of `specs/`, by PR review |
| D6 | Does the social page keep the site header | Yes |
| D7 | Reviewer model | Opus-class, set in a repository variable |

**Decisions with no default (work that depends on them stops)**

- Chat retention, moderation, and the policy for minors (blocks P7).
- Audio and video provider (blocks P7).
- Whether profiles and the follow graph are read from Sefaria or kept by social (blocks any "people" feature).
- Who does the infrastructure work for deployment, and when (blocks P5).
- Whether the `ctx` parameter and the surface loader are accepted into the reader (blocks A1; raise with the reader's owner).

---

## 10. Sources

Practice this plan is built on. Items marked (secondary) were read through summaries; confirm before quoting.

- StrongDM, software factory: scenarios as holdout tests, satisfaction score. https://factory.strongdm.ai/ ;
  commentary https://simonwillison.net/2026/Feb/7/software-factory/
- Dan Shapiro, five levels. https://www.danshapiro.com/blog/2026/01/the-five-levels-from-spicy-autocomplete-to-the-software-factory/
- Critiques: https://law.stanford.edu/2026/02/08/built-by-agents-tested-by-agents-trusted-by-whom/ ;
  https://posthog.com/newsletter/software-factories
- OpenAI, harness engineering: short agent file as a map, docs as the record, linters with remediation text, structural tests,
  gardening agents. https://openai.com/index/harness-engineering/
- Anthropic, harness design for long-running apps: separate sceptical evaluator, calibrated criteria, prune the harness.
  https://www.anthropic.com/engineering/harness-design-long-running-apps
- Anthropic, evals: multiple clean trials, calibrated judges, capability versus regression suites.
  https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Claude Code: instruction placement, hooks versus advice, verification, GitHub Actions, managed review.
  https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more ;
  https://code.claude.com/docs/en/best-practices ; https://code.claude.com/docs/en/github-actions ;
  https://code.claude.com/docs/en/code-review
- Spec-driven development and its limits: https://github.github.com/spec-kit/ (secondary) ; https://kiro.dev/docs/specs/
  (secondary) ; https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- Playwright test agents. https://playwright.dev/docs/test-agents
- Micro-frontend security: allowlisted remotes, pinned releases, integrity on every file.
  https://cheatsheetseries.owasp.org/cheatsheets/Micro_Frontend_Security_Cheat_Sheet.html
- Vercel, always-loaded agent file versus skills (secondary).
  https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals
- Not found in published practice, so designed here: a CI gate for "no code change without a spec"; a repeatable recipe for
  holdout scenarios; a combined manifest, integrity and contract-test scheme for a runtime-loaded surface.
- From the owner's library: agent QA rules (surfaces from the diff, personas, seeding, what a pass means); code-review severity
  and service-boundary rules; Sefaria's own lessons on uncollected tests, auth helpers, hooks and guard scripts.
