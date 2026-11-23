# Architecture

Sefaria Social is a surface that runs inside the Sefaria reader page, plus its own server and relay. This file is the map of the
code; the design and its reasons are in [PLAN.md](PLAN.md) (sections 1, 3, 4 and 6).

## Runtime pieces

| Piece     | Where                                              | Runs                                                                                      |
| --------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Surface   | `app/src/surface` + shared routes, features and ui | Inside the reader page, loaded at runtime; client only                                    |
| Start app | `app/` (TanStack Start)                            | Node server: social API (`/api/v1/*`), webhooks, health, standalone pages (dev, previews) |
| Relay     | `packages/relay`                                   | Cloudflare Worker, one Durable Object per room                                            |
| Harness   | `harness/`                                         | Fake reader page for development and end-to-end tests                                     |

The reader is the host. Social reaches it only through the SurfaceHost contract ([CONTRACT.md](CONTRACT.md)) and changes the URL
only through the host ([ROUTING.md](ROUTING.md)). Identity comes from Django as a short-lived signed token (plan section 6.1).

## One codebase, two builds

| Build     | Config                       | Output                                                               |
| --------- | ---------------------------- | -------------------------------------------------------------------- |
| Start app | `app/vite.config.ts`         | Node server (`app/dist/server`) and client assets                    |
| Surface   | `app/vite.surface.config.ts` | ES module `surface.[hash].js`, chunks, one CSS file, `manifest.json` |

Both builds use the same route components and shared route definitions (`features/shell/social-routes.ts`) over **two thin
route trees**: the Start app's file routes (whose root renders the `<html>` shell) and the surface's code-based tree
(`surface/route-tree.tsx`, content only). Same `/social/…` paths, no basepath; `app/src/route-trees.test.ts` checks they match.
Why: [decisions/0003-two-builds.md](decisions/0003-two-builds.md). `npm run build:surface` writes `app/dist-surface/`
(`assets/surface.<hash>.js`, chunks, one CSS file, `manifest.json` in the reader's format with sha384 hashes).

## Layers in `app/src`

```
lib  →  (server | ui)  →  features  →  routes | surface
```

| Layer       | Holds                                                                               | May import                         |
| ----------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| `lib/`      | Pure code shared by both sides: schemas, ids, the `ctx` codec                       | `lib`                              |
| `server/`   | Server only: `db/`, `auth/`, `services/`, `webhooks/`, `http/`, `api/`, `log/`      | `lib`, `server`. Never React       |
| `ui/`       | Presentational components                                                           | `lib`, `ui`                        |
| `features/` | `feed/`, `room/`, `shiur/`, `settings/`, `presence/`, `session/`, `host/`, `shell/` | `lib`, `ui`, `features`            |
| `routes/`   | File routes: UI pages and `api/` server routes                                      | Everything to its left             |
| `surface/`  | `entry.ts` (mount), `host-history.ts`, `host-context.tsx`                           | `lib`, `ui`, `features`, `surface` |
| entry files | Files directly in `app/src` (`router.tsx`, the generated `routeTree.gen.ts`)        | Anything; no layer imports them    |

Rules, each checked by `test/architecture/` (Vitest project `architecture`, run in the CI `static` job):

- **(a) Layer order.** A layer imports only layers to its left, or itself. `server`/`ui` and `routes`/`surface` are siblings and do
  not import each other. A file in a folder that is not a layer fails.
- **(b) Client ban.** `surface`, `features`, `ui` and `lib` never import `app/src/server` or `@tanstack/react-start` (any subpath).
  They reach the server through `packages/api-client`.
- **(c) Server without React.** `server/` imports no `react`, `react-dom`, `@tanstack/react-router` or `@tanstack/react-query`, and
  holds no `.tsx` files.
- **(d) R1.** Only `app/src/surface/host-history.ts` calls the browser history or location write APIs.

Imports are read with the TypeScript parser: static imports, re-exports, `import()` and `require()`; type-only imports count. The
`~/` alias means `app/src`. Each rule has negative tests that write a violating tree to a temporary directory and assert the rule
reports it, so a rule that silently stops working turns CI red.

S1 outcome: the surface never imports the generated route tree (it carries the Start runtime and, from P2, server routes), so
rule (a) is unchanged. Tests that compare the two trees live directly in `app/src` (entry level).

## Packages

| Package                  | Holds                                                                  | Milestone |
| ------------------------ | ---------------------------------------------------------------------- | --------- |
| `packages/host-contract` | Pinned reader contract, generated types and zod schemas, the fake host | P1        |
| `packages/session`       | Room protocol and client                                               | P3        |
| `packages/relay`         | Worker + Durable Object                                                | P3        |
| `packages/api-client`    | Client generated from the server's OpenAPI document (built in P2)      | P2        |

## Other folders

`specs/` (spec system, F1), `factory/` (compile, gate, doctor, prove-red, F1), `e2e/` (Playwright, P1), `docs/decisions/`
(decision records), `docs/runbooks/` (human procedures).

## Server (P2)

API routes are TanStack Start server routes under `app/src/routes/api/v1/`; each handler is created with `bind()` from
`app/src/server/http/endpoint.ts` (access, validation, errors, one log line) and calls `app/src/server/services/*`. The
endpoint contracts in `app/src/server/api/contracts.ts` generate `packages/api-client/openapi.json`. Acceptance tests for
the API are `app/src/*.int.test.ts` (entry level, Vitest project `integration`, real Postgres). Details, environment
variables and the schema: [runbooks/server.md](runbooks/server.md); decisions 0005 and 0006.
