---
paths:
  - "app/src/surface/**"
  - "packages/host-contract/**"
  - "harness/**"
---

# Surface contract (SurfaceHost v1)

Summary of `docs/PLAN.md` section 4.2; details in `docs/CONTRACT.md`.

- The surface talks to the reader only through the host object it is handed. Nothing React crosses the contract: no components,
  context or hooks. The contract is DOM elements and plain objects. The surface bundles its own React, Router and Query.
- The surface bundle is client only: never import `app/src/server` or `@tanstack/react-start` (architecture test (b)).
- Check `host.contract.major` on mount; on a mismatch render a "please reload" state, never a half-working surface.
- A minor version adds optional members only; anything else is a new major.
- Everything arriving through the host is untrusted: parse snapshots, `ctx` values and location state with zod before use.
- The pinned contract (`packages/host-contract/pinned/**`) is a protected path: change it only with `contract-sync` from a named
  reader commit. Types are generated from the schema, never hand-copied.
- The fake host is typed from the generated contract and must fail when the real surface would. Never widen the fake to make a
  test pass.
