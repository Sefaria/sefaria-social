# Plan: 001 pinned host contract and fake host

## Approach

Copy the three contract files from the reader commit into `packages/host-contract/pinned/` with `scripts/pin.mjs`, which also
writes `pinned/SOURCE.json` (repo, commit, sha256 per file); `pin.mjs --check` verifies the hashes (L3). `src/contract.ts`
re-exports the pinned types; `src/schemas.ts` holds zod schemas for every value that crosses the contract; `src/conformance.ts`
proves each schema's output type equals the pinned type. `src/fake-host.ts` implements `SurfaceHost` as a typed object literal
over a pluggable history (memory by default; the harness passes the browser's).

## Files

- `packages/host-contract/{package.json,pinned/*,scripts/pin.mjs,src/*}`; root `tsconfig.json` (type-check the package),
  `eslint.config.mjs` and `.prettierignore` (keep pinned files verbatim), `package.json`/`package-lock.json` (zod, workspace).

## Tests

- AC-001 `src/schemas.test.ts`; AC-002 `src/fake-host.test.ts`; AC-003 and AC-004 `src/pin.test.ts` (runs `pin.mjs --check` on
  an edited copy, and `tsc` on a copy whose pinned contract renames a member).

## Risks

The pinned commit is on an unmerged reader branch; re-pin after it merges.
