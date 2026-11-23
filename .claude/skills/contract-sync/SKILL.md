---
name: contract-sync
description: Updates the pinned copy of the reader's SurfaceHost contract in packages/host-contract/pinned from a given reader commit, regenerates types, records the hash, runs the contract tests and reports what changed. Use when the reader's contract changed or a spec has contract_impact host-minor/host-major. Do not use to hand-edit pinned files, to change the reader, or without a risk-high work order (pinned/** is protected).
argument-hint: "<reader commit sha>"
---

# Sync the pinned contract

**Critical rules — read first**

1. `packages/host-contract/pinned/**` is protected: you need an active `risk: high` work order whose task lists it.
2. Never edit pinned files by hand. Copy them from the reader commit; the commit sha goes in `pinned/SOURCE`.
3. After copying, write `pinned/contract.sha256` (`factory doctor` compares it with the files) and run the contract tests.

## Steps (the pinned folder and its tests arrive in P1; until then this skill reports "nothing pinned yet")

1. In the reader checkout (read-only), `git show <sha>:reader-next/contract/surface-host.v1.ts` and its JSON Schema.
2. Copy both into `packages/host-contract/pinned/`, write `SOURCE` (reader commit) and regenerate types from the schema.
3. Record the hash: `npm run factory -- doctor --skip-tests` prints the expected hash when it differs; write it.
4. Run the contract tests (L3) and report: members added, removed, changed; the version; anything that breaks the surface.
