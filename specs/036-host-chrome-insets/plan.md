# Plan: 036 the call window keeps clear of the reader's header and side panel (SurfaceHost 1.2 insets)

The reader side is Sefaria/Sefaria-Project#4148 (branch `reader-next-surface-chrome`): contract minor 2 with an optional
`ui.chrome: { get(): ChromeInsets; subscribe(cb) }`, measured from the reader's own chrome (`data-surface-chrome` on the site
header, sticky panel headers and the connections panel).

## T-001 pin contract 1.2 and give the fake host insets (AC-001, AC-005)

- `npm run pin -w @sefaria-social/host-contract -- <reader checkout> <commit>` copies `contract/surface-host.v1.ts` (and the
  manifest schema, unchanged) from the reader commit, writing `pinned/SOURCE.json` and `pinned/contract.sha256`. The pin is from
  the reader PR's branch; **when #4148 merges (a squash changes the sha), re-pin from the merge commit** — the files are the
  same, only `SOURCE.json` changes.
- `src/schemas.ts`: the host schema's `ui` gains an optional `chrome` (`get`, `subscribe` functions); `ChromeInsets` as a zod
  schema (four finite numbers ≥ 0) for checking values at run time. `src/conformance.ts` keeps proving schemas match types.
- `src/fake-host.ts`: `chrome` option (default insets `{ top: 0, … }`), `fake.setChrome(insets)` that notifies, and
  `besideSupported`-style `chromeSupported: false` to build a 1.1 host without it.
- Tests: `src/fake-host.test.ts` (AC-005), `src/pin.test.ts` and `factory doctor` (AC-001: hash and minor 2).

## T-002 the call window reads the insets (AC-002, AC-003, AC-004)

- `features/av/insets.ts`: `useChromeInsets()` subscribes to `host.ui.chrome` when present; a value that fails the zod schema,
  or is larger than the viewport, or a `get()` that throws, gives `FALLBACK_INSETS` and reports `av.error` `chrome_invalid`
  once per page. No host or a 1.1 host: the fallback, silently.
- `CallWindow` already re-places on inset changes (spec 035).
- Test: `surface/call-insets.test.tsx` (jsdom) with the fake host: 1.2 insets move the window out of an opened side panel's way;
  a 1.1 host gives the fallback; bad values report once.
