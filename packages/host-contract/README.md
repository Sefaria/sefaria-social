# @sefaria-social/host-contract

- `pinned/`: the reader's SurfaceHost v1 contract and manifest schema, copied verbatim from a reader commit (`SOURCE.json`,
  `contract.sha256`). Protected; never edit by hand. `npm run pin -- <reader checkout> <commit>` re-pins; `npm run check`
  verifies the hashes.
- `src/contract.ts`: the types, re-exported from the pinned file. `src/schemas.ts`: zod schemas for everything that crosses the
  contract; `src/conformance.ts` proves they match the types.
- `src/fake-host.ts` (`@sefaria-social/host-contract/fake-host`): the in-memory SurfaceHost for tests and the harness.

See [docs/CONTRACT.md](../../docs/CONTRACT.md) and plan sections 4.2 and 4.6.
