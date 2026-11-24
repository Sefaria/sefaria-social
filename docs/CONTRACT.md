# The surface contract (SurfaceHost v1)

The reader calls the surface; the surface receives a host object. This is the whole interface between social and the reader.
Source: [PLAN.md](PLAN.md) section 4.2.

## Where it lives

- Canonical source: `reader-next/contract/surface-host.v1.ts` in Sefaria-Project, plus a JSON Schema generated from it. Both are
  created by the reader seam (milestone A1).
- Social keeps a **pinned copy** in `packages/host-contract/pinned/` (`surface-host.v1.ts`, `surface-manifest.v1.ts`,
  `surface-manifest.v1.schema.json`), with `SOURCE.json` (reader repo, commit, sha256 per file) and `contract.sha256` (checked
  by `factory doctor`). Pinned from `Sefaria/Sefaria-Project` `feat/reader-social-beside` @ `ca53378349` (contract 1.1, spec
  029; not yet merged into `reader-next`). Types are re-exported from the pinned `.ts` file (`src/contract.ts`), never hand-copied; the reader generates a JSON
  Schema only for the manifest. Re-pin with `npm run pin -w @sefaria-social/host-contract -- <reader checkout> <commit>` (the
  `contract-sync` skill); `npm run check -w @sefaria-social/host-contract` (CI `contract` job) fails on a hand edit.
- **Re-pinned for 1.2 (spec 036):** `reader-next-surface-chrome` @ `6349c65f83` (Sefaria/Sefaria-Project#4148, not yet merged; re-pin from the merge commit once it lands — only `SOURCE.json` changes).
- `src/schemas.ts` validates every value that crosses the contract; `src/conformance.ts` proves at compile time that each
  schema's type equals the pinned type.

## Shape

```ts
// What the surface bundle exports (default export of the entry module)
interface Surface {
  id: "social";
  contract: 1; // SurfaceHost major version it was built for
  mountPage(el: HTMLElement, host: SurfaceHost): Unmount; // full-page view under /social/*; since 1.1 it may move, mounted, beside a text
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
  openBeside?(to: string): void; // since 1.1: a reader address opened beside the page (spec 029); absent on a 1.0 reader
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

## 1.1: a text beside the page (spec 029)

`openBeside(to)` opens a reader address beside the surface's page: the reader moves the page mount's element, still mounted, into
a column at the inline start and slides the text in beside it (a phone slides the text over the page). The address is the text's,
with `ctx=social.beside`. While it is open the page mount's `location` keeps reporting the social page that opened it; the
persistent mount's is the reader's. Back, Escape or the text's close button return to the page as it was. The page lays out by its
own width (`container: social / inline-size` on the frame), since the column is narrower than the window. A 1.0 reader has no
`openBeside`; the surface falls back to `commands.go`.

## Planned later

Decorations in (mark a segment for a person), segment actions out ("discuss this"), `prefetch(ref)`, `renderSegment(el, ref)`, and
a panel slot in the reader's workspace layout. Each needs its own spec and reader work.

## 1.2: the reader's chrome insets (spec 036)

`ui.chrome?: { get(): ChromeInsets; subscribe(cb) }` gives the CSS pixels at each edge of the viewport that the reader's own chrome
occupies now (the site header and sticky panel headers at the top, an open connections panel at the inline end), so the call
window keeps clear of them. Optional: on a 1.0 or 1.1 reader the surface uses fixed insets (top 64). Values are checked with
`chromeInsetsSchema` before use; a bad value or a `get()` that throws gives the fallback and one `av.error` `chrome_invalid`.
