# The surface contract (SurfaceHost v1)

The reader calls the surface; the surface receives a host object. This is the whole interface between social and the reader.
Source: [PLAN.md](PLAN.md) section 4.2.

## Where it lives

- Canonical source: `reader-next/contract/surface-host.v1.ts` in Sefaria-Project, plus a JSON Schema generated from it. Both are
  created by the reader seam (milestone A1).
- Social keeps a **pinned copy** in `packages/host-contract/pinned/` (`surface-host.v1.ts`, `surface-manifest.v1.ts`,
  `surface-manifest.v1.schema.json`), with `SOURCE.json` (reader repo, commit, sha256 per file) and `contract.sha256` (checked
  by `factory doctor`). Pinned from `Sefaria/Sefaria-Project` `feat/reader-social-surface` @ `b90e19735d` (PR 4122, not yet
  merged). Types are re-exported from the pinned `.ts` file (`src/contract.ts`), never hand-copied; the reader generates a JSON
  Schema only for the manifest. Re-pin with `npm run pin -w @sefaria-social/host-contract -- <reader checkout> <commit>` (the
  `contract-sync` skill); `npm run check -w @sefaria-social/host-contract` (CI `contract` job) fails on a hand edit.
- `src/schemas.ts` validates every value that crosses the contract; `src/conformance.ts` proves at compile time that each
  schema's type equals the pinned type.

## Shape

```ts
// What the surface bundle exports (default export of the entry module)
interface Surface {
  id: "social";
  contract: 1; // SurfaceHost major version it was built for
  mountPage(el: HTMLElement, host: SurfaceHost): Unmount; // full-page view under /social/*
  mountPersistent(el: HTMLElement, host: SurfaceHost): Unmount; // survives navigation; mini view, room link
}

// What the reader hands it
interface SurfaceHost {
  contract: { major: 1; minor: number };
  location: {
    get(): { pathname: string; search: string; hash: string; state: unknown }; // full reader location
    subscribe(cb: () => void): Unsubscribe;
  };
  navigate(to: string, opts?: { replace?: boolean; state?: unknown }): void; // the only way to change the URL
  href(to: string): string; // for <a href>, respects host and language
  reader: {
    state: ReaderStateApi; // getSnapshot / applySnapshot / subscribe / onLocalInput / applying
    commands: WorkspaceCommands; // the reader's versioned commands: current / go / href / canonicalize
    context: {
      // the reserved `ctx` URL parameter (ROUTING.md)
      get(): string | null;
      subscribe(cb: () => void): Unsubscribe;
    };
  };
  viewer: {
    get(): { id: number; name: string; imageUrl?: string } | null;
    subscribe(cb: () => void): Unsubscribe;
    identityToken(): Promise<string>; // short-lived token from Django; rejects when signed out
    requestSignIn(): void; // opens the reader's sign-in
  };
  ui: { interfaceLang: "english" | "hebrew"; theme: "light" | "dark" | "sepia"; subscribe(cb: () => void): Unsubscribe };
  config: { apiOrigin: string; relayOrigin: string; environment: "local" | "staging" | "production" };
  report(event: { kind: "error" | "event"; name: string; data?: Record<string, unknown> }): void; // errors and analytics
}
```

`ReaderStateApi` is the reader's state API (`reader-next/src/lib/reader-state/core`); `WorkspaceCommands` are the reader's
workspace commands (`reader-next/src/lib/workspace/commands.ts`).

## Rules

- **Compatibility.** A minor version adds optional members only. Anything else is a new major, and the reader serves the previous
  major for a stated window. The surface checks `host.contract.major` on mount and renders a "please reload" state on mismatch.
- **Everything arriving is untrusted.** Snapshots from a room, `ctx` values and location state are parsed with zod before use. A
  TypeScript cast is not validation. The reader validates in `applySnapshot` as well; social validates before sending and after
  receiving.
- **Nothing React crosses.** No components, context or hooks; DOM elements and plain objects only. The surface bundles its own
  React, TanStack Router and Query, and never imports server code or the Start runtime (`test/architecture/`).
- **The fake host** (`packages/host-contract/src/fake-host.ts`, import `@sefaria-social/host-contract/fake-host`) implements this interface in memory and is typed from
  the generated contract, so a removed or renamed member stops it compiling. Never widen it to make a test pass.

## Planned for v1.1 (not in v1)

Decorations in (mark a segment for a person), segment actions out ("discuss this"), `prefetch(ref)`, `renderSegment(el, ref)`, and
a panel slot in the reader's workspace layout. Each needs its own spec and reader work.
